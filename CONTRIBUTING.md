# 贡献指南

## 环境

- Node.js ≥ 22.18（[ADR-030](docs/adr/ADR-030-minimum-node-baseline.md)：22.18 起
  默认开启类型剥离，`tools/*` 的编译产物才能加载 ADR-007 的源码导出；且 Node 20 上
  jsdom 装不起来，DOM 测试会静默不执行）
- pnpm 10（`corepack enable pnpm` 或 `npm i -g pnpm@10`）

```bash
pnpm install && pnpm run check
```

## 一次改动的完成标准

以下条件**没有全部满足时，不得把功能标记为完成**：

1. `pnpm run typecheck` 通过。
2. `pnpm run lint` 通过。
3. `pnpm run test` 通过，且新增代码有对应测试。
4. 涉及 YAML 的改动：未知字段、注释、锚点在 round-trip 后不丢失。
5. 涉及引用的改动：重命名后不留下断裂引用。
6. 涉及 Schema 的改动：同时补齐 schema、示例、校验和测试；提交签名前，用
   `schema-cli preview <module-dir>`（见下）确认渲染结果与预期一致。
7. [需求追踪表](docs/requirements-traceability.md) 中对应行已更新，并指向具体测试文件。

不接受占位实现、空函数或"看起来能跑"的测试。

## 工作方式

- 一次只提交一个边界清晰、可以独立验证的垂直切片。
- 新增配置模块时，schema、UI schema、校验规则、示例和测试是**同一次改动**的一部分。
- 与第三方库或平台能力相关的改动，请核对其当前官方文档，不要凭记忆写。
- 若发现 PRD 与 Mihomo 官方当前行为冲突：以官方行为为准，
  并在 [docs/upstream-divergences.md](docs/upstream-divergences.md) 记录差异。**不要静默修改需求。**

## Schema 预览（FR-SCHEMA-07）

在一个模块的 Bundle 被签名前，用 `schema-cli` 的 `preview` 子命令把它渲染成
每字段一行的纯文本，确认控件种类、是否必填、是否遮罩、显示条件与预期一致——
渲染逻辑与应用本身完全相同（`@mcs/schema-core` 的 `buildFormPlan`），预览看到
的就是签名后用户会看到的。判别式联合字段会展开列出每个分支各自的字段。

```bash
node tools/schema-cli/dist/index.js preview packages/schema-builtin/modules/dns
node tools/schema-cli/dist/index.js preview packages/schema-builtin/modules/dns --json
```

> 注意：`tools/schema-cli` 依赖 `packages/**` 的 ADR-007 源码导出（`.ts` 直接
> 作为包入口，不预编译），纯 `node` 目前无法在不借助 TS-aware loader 的情况下
> 解析这些依赖之间的相对导入。这不是 `preview` 独有的限制——`pack`/`check`/
> `diff`/`sign` 四个既有子命令同样如此，`schema-release.yml` 的 CI 也因此改为
> 用 vitest 跑同一段逻辑，而不是字面调用 `node dist/index.js`。本地想验证某个
> 模块目录，可以直接用 vitest 跑通同一份代码：
>
> ```bash
> pnpm exec vitest run tools/schema-cli/src/preview.test.ts -t "loads and previews"
> ```
>
> 或参照 `preview.test.ts` 写一个几行的临时测试文件，直接调用
> `loadModuleFromDirectory`/`buildModulePreview`/`renderModulePreviewText`
> 并 `console.log` 结果——vitest 自己的 TS 转换不经过这条 Node 解析路径，
> 不受此限制。

## 包边界

`packages/**` 是平台无关的领域代码，由 ESLint 强制：

- 不得 import `apps/**`
- 不得 import `@capacitor/*`、`node:fs` —— 平台能力一律走 `@mcs/storage`

模块之间只能通过稳定接口通信：领域模型、引用 Registry、`ValidationIssue`、YAML Patch。
模块不能直接访问其它模块的 UI 状态或平台文件系统。

## 测试要求

单元测试覆盖率目标 ≥ 85%（在 `vitest.config.ts` 中作为硬阈值强制）。

必须覆盖的类别：

- 合法、非法和边界 Schema
- YAML round-trip 与 Golden Files
- 未知字段、注释、锚点和特殊字符串
- 引用重命名、删除、替换和循环
- Schema 安装、签名失败、版本不兼容和回滚
- 迁移的幂等性、可逆性和有损提示
- 超大、深层嵌套和恶意 YAML 输入

### Golden fixtures

`packages/test-fixtures/fixtures/**` 下的文件是**逐字节敏感**的，
已在 `.prettierignore` 和 `.gitattributes` 中排除格式化与换行符转换。修改它们会使 round-trip 断言失效，请谨慎。

## 提交 PR 前

请确认你没有在代码、测试、fixture 或 Issue 中附带真实的订阅 URL、密码、UUID、证书或私钥。
fixture 中的所有凭据必须是明显的占位符。
