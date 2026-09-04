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
的就是签名后用户会看到的。

`preview` 的完整用法、`check`/`diff` 等其余本地验证子命令、以及
`node dist/index.js` 字面调用当前不可用（需要用 vitest 跑同一段逻辑）这条
已知限制，统一写在 [Schema 开发指南](docs/schema-authoring-guide.md#本地预览与验证)
里，这里不重复一份——两处各写一半容易漂移。

## 发布流程

三条边界，贡献者与协作的 AI 助手都不应该越过：

- **内置 Bundle**（编译进应用、随构建产物发布的默认 Bundle）走
  `schema-release.yml`，签名发生在 GitHub `schema-release` environment 保护
  的 job 里。私钥只以 `SCHEMA_SIGNING_KEY_B64` 存在该 environment 的 secret
  中，签名 job 只消费已构建、已过测试矩阵的产物，从不在 job 内重新构建
  （[ADR-010](docs/adr/ADR-010-bundle-signing-and-key-custody.md) §2/§3）。
  **贡献者与协作的 AI 助手都不接触私钥**——本仓库当前是单维护者仓库，
  `schema-release` environment 的 required reviewers 按
  [ADR-024](docs/adr/ADR-024-single-maintainer-release-approval.md) 降为
  1 人（仓库唯一维护者本人），并用「deployment branches 仅限版本 tag、禁止
  `pull_request_target`、零第三方 action、`permissions` 最小化」四项措施
  补偿；这是记录在案、有回退条件的偏离，不是把双人审核这条要求悄悄删掉。
- **Stable 通道**只放行已经通过 `core-config-test (stable)` 这一个 check
  的版本——`schema-release.yml` 的发布门只查这一个结论，从不查 Beta 轨、也
  不查"矩阵整体"：即使 Beta 轨恰好失败，Stable 该发布的还是能发布；即使
  Beta 轨恰好通过，也不能拿它给 Stable 背书
  （[ADR-031](docs/adr/ADR-031-kernel-matrix-dual-track.md)）。
- **社区 Bundle** 走手动导入路径（FR-UPD-09），仍必须通过全部既有安全检查
  （哈希自洽、格式版本范围、静态内容检查），唯一豁免的是"签名必须由已知信任
  锚点签发"这一条；豁免后**持久标记为未受信任**，在 Bundle 管理页与每个使用
  它的项目上持续显示警告，且**永远不能进入 Stable 通道**（见
  [SECURITY.md](SECURITY.md)）。**不是默认拒绝，也不是隔离**——手动导入本身
  是被支持的路径，只是永久带着"未验证来源"的标记，不会被静默拒绝或额外
  沙箱化。

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
