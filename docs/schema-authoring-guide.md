# Schema 开发指南

写给要新增或修改一个 Schema 模块（`packages/schema-builtin/modules/<id>/`）的
贡献者。覆盖模块的磁盘结构、受限 DSL 的能力边界、以及如何在签名前本地预览与
验证。项目级的贡献流程（分支、测试、PR 检查单）见
[CONTRIBUTING.md](../CONTRIBUTING.md)，这里不重复。

## 模块结构

每个模块是 `packages/schema-builtin/modules/<id>/` 下的一个目录，固定七类
文件（[ADR-020](./adr/ADR-020-builtin-bundle-layout-and-reissue.md)）。下面
以真实的 `general` 模块为例：

```text
packages/schema-builtin/modules/general/
  module.manifest.json     # ModuleManifest：id、root、version、mihomo 版本信息
  config.schema.json       # JsonSchema：字段的类型/必填/取值约束
  ui.schema.json            # UiSchema：控件种类、分组、可见性条件、遮罩
  validation.rules.json    # ValidationRule[]：没有真实约束就是 []，不为凑数编造
  i18n/zh-CN.json           # Record<string, string>：字段标签/说明的中文文案
  i18n/en.json               # 同一 key 集合的英文文案，两份 key 必须完全相等
  examples/valid.yaml       # 至少 valid / edge / invalid / unknown-fields 四份
  examples/edge.yaml
  examples/invalid.yaml
  examples/unknown-fields.yaml
```

`module.manifest.json` 长这样（真实内容）：

```json
{
  "id": "general",
  "root": [],
  "version": "1.0.0",
  "mihomo": {
    "minVersion": "1.19.29",
    "maxTestedVersion": "1.19.29",
    "upstreamCommit": "e26714a181ac0e2fa803453c0a8e9a9ce94e31cb",
    "docsSnapshot": "2026-08-19"
  }
}
```

`root` 是该模块在文档树里挂载的路径（`general` 挂在文档根，`dns` 模块的
`root` 是 `["dns"]`）；`mihomo.upstreamCommit`/`docsSnapshot` 记录这份 Schema
是对照官方哪一个 commit、哪一天的文档写的——字段核实到期后要回来更新这两个值，
不是写完就不再管。

四份 `examples/*.yaml` 不是摆设：`valid`/`edge` 会被 `tools/core-test-runner`
拼进最小完整配置，跑真实 Mihomo 内核的 `-t -f`；`invalid`/`unknown-fields`
由本仓库自己的校验流水线（`runPipeline`）验证会/不会报出预期的问题。四份缺
一份，模块的测试套件通不过。

`packages/schema-builtin/src/index.ts` 用 `resolveJsonModule` 直接 `import`
前六类文件（**不含** `examples/*.yaml`——`packages/**` 禁 `node:fs`，样例只由
测试代码读盘），组装出 `<ID>_MODULE` 常量。改动任何一个文件的内容都会改变该
模块序列化后的字节，进而使内置 Bundle 的哈希与签名失效——见下面「本地预览与
验证」一节的再签发提醒。

## 受限 DSL 能做什么，不能做什么

Bundle 只能包含声明式数据（[ADR-002](./adr/ADR-002-declarative-schema-bundle.md)）：
没有地方能放一个函数、一段表达式字符串或一个模块说明符。三处 DSL 都是同一姿态——
固定的封闭操作集合，遇到集合之外的操作直接拒绝，不跳过、不降级：

### 1. `validation.rules.json` 的条件 DSL（`Condition`）

能用的算子是这十六个（`packages/schema-core/src/condition.ts`），逻辑组合
（`and`/`or`/`not`）之外都是对一个路径取值做结构性判断：

| 类别     | 算子                                 |
| -------- | ------------------------------------ |
| 逻辑组合 | `and`、`or`、`not`                   |
| 存在性   | `exists`、`empty`                    |
| 相等     | `eq`、`ne`                           |
| 数值比较 | `gt`、`gte`、`lt`、`lte`             |
| 集合成员 | `in`、`notIn`                        |
| 字符串   | `startsWith`、`endsWith`、`contains` |
| 长度     | `length`（`gte`/`lte` 两个可选边界） |

**不能做什么**：没有正则表达式算子，没有表达式求值，不能拼字符串再判断，
路径解析会拒绝走到 `__proto__`/`constructor`/`prototype`（不能借路径逃出
当前文档对象）。想要的判断如果落在这十六个之外，说明需要的不是新算子，而是
应用代码本身的改动（不是 Bundle 能表达的范围）。

### 2. `migrations/*.json` 的迁移操作码（`MigrationOperation`）

七个封闭操作码（[ADR-025](./adr/ADR-025-declarative-migration-opcodes.md)）：

| 操作码             | 语义                               | 是否有损 |
| ------------------ | ---------------------------------- | -------- |
| `rename-field`     | 旧路径 → 新路径（同层级）          | 否       |
| `move-field`       | 旧路径 → 新路径（可跨层级）        | 否       |
| `set-default`      | 字段缺失时补上新默认值             | 否       |
| `deprecate-field`  | 标记废弃但仍保留、仍导出           | 否       |
| `remove-field`     | 删除字段与其值                     | **是**   |
| `narrow-enum`      | 收窄枚举取值范围                   | **是**   |
| `quarantine-field` | 移入项目隔离区（不是删除，可取回） | 否       |

`lossy` 是从 `operations` 算出来的，Bundle 没有渠道声明一个和自己操作不一致
的 `lossy` 值。装载迁移规则时一旦遇到不在这七个之内的 `op`，整份规则拒绝
装载，不是跳过那一条。**如果你需要的迁移依赖字段的实际取值做分支、需要把一个
列表的每个元素分别迁移、或者需要跨模块搬字段**——这七个操作码表达不了，需要
Level 2（应用代码更新），不要硬拼现有操作码凑合。

### 3. 静态检查（打包/手动导入社区 Bundle 时都会跑）

允许清单而不是黑名单（`packages/schema-registry/src/static-check.ts`）：

- 文件扩展名只允许 `.json`、`.yaml`、`.md`，其余一律拒绝
  （`SCHEMA_CLI_DISALLOWED_EXTENSION`）。
- 每个 `.json` 文件的每一个字符串值都会被扫描"像不像可执行代码"
  （`SCHEMA_CLI_EXECUTABLE_CONTENT`）：函数声明/箭头函数语法、
  `eval`/`Function`/`require`/`import` 调用、看起来像相对路径或
  `node:`/`npm:`/`.js`/`.wasm`/`.so` 等模块说明符的字符串，命中任意一种即拒绝。
- `migrations/*.json` 里出现前面第 2 节七个操作码之外的 `op` 会被单独识别
  为 `SCHEMA_CLI_UNKNOWN_MIGRATION_OPCODE`。
- Stable 通道额外拒绝任何带 `x-unstable` 标记的字段
  （`SCHEMA_CLI_UNSTABLE_FIELD_IN_STABLE_CHANNEL`）。

这不是一个通用恶意软件扫描器，只是机械地核实"Bundle 里确实没有放可执行内容"
这条不变量——写正常的 Schema/UI/规则/迁移 JSON 不会碰到这些检查，除非你的字段
说明文案恰好写出了看起来像函数调用的句子（真实遇到过的例子：写"调用
`someFunc()` 前"这种字段描述会被判定为可执行内容，需要换一种措辞）。

## 本地预览与验证

改动一个模块后，在提交签名前用真实工具核对，而不是靠肉眼读 JSON：

```bash
# 只跑静态检查（打包前的本地闸门），--channel 可选，加上会额外核对 Stable 专属规则
node tools/schema-cli/dist/index.js check --source packages/schema-builtin/modules/general
node tools/schema-cli/dist/index.js check --source packages/schema-builtin/modules/general --channel stable

# 对比两个模块目录之间的字段级差异，输出适合贴进发布 PR 的文本报告
node tools/schema-cli/dist/index.js diff --old <旧目录> --new packages/schema-builtin/modules/general

# 渲染成每字段一行的表单预览，确认控件种类/是否必填/是否遮罩/可见条件与预期一致
# ——渲染逻辑就是应用自己用的 @mcs/schema-core 的 buildFormPlan，不是另一套解释
node tools/schema-cli/dist/index.js preview packages/schema-builtin/modules/general
node tools/schema-cli/dist/index.js preview packages/schema-builtin/modules/general --json
```

`pack`（打包并签名，需要私钥）与 `sign`（对已打包的 manifest 单独签名）是
发布流程的一部分，见 CONTRIBUTING.md「发布流程」一节——贡献者本地开发不需要
用到这两个子命令，私钥也从不应该出现在贡献者的机器上。

> **已知限制**：`tools/schema-cli` 依赖 `packages/**` 的源码导出
> （`.ts` 文件直接作为包入口，不预编译），纯 `node` 无法在不借助 TS-aware
> loader 的情况下解析这些包之间的相对导入——上面几条命令字面执行会报
> `ERR_MODULE_NOT_FOUND`。这不是某个子命令独有的问题，五个子命令都一样，
> `schema-release.yml` 的真实 CI 也因此改用 vitest 跑同一段逻辑。本地想验证，
> 用 vitest 跑通同一份代码：
>
> ```bash
> pnpm exec vitest run tools/schema-cli/src/preview.test.ts -t "loads and previews"
> ```
>
> 或参照 `tools/schema-cli/src/preview.test.ts` 写一个几行的临时测试文件，
> 直接调用 `loadModuleFromDirectory`/`buildModulePreview`/`renderModulePreviewText`
> 之类的导出函数并 `console.log` 结果——vitest 自己的 TS 转换不经过这条 Node
> 原生 ESM 解析路径，不受此限制。

改动内容会让内置 Bundle 的哈希与签名一起失效——这是设计使然
（[ADR-020](./adr/ADR-020-builtin-bundle-layout-and-reissue.md)「再签发口径」），
`packages/schema-registry/src/builtin.test.ts` 的再签发回归断言会在你忘记重签时
立刻变红。重签使用一次性 bootstrap 密钥对（离线生成、签完即弃，从不写入任何
文件或提交历史），流程与 ADR-020 记录的一致。

## 如何提 PR

一次改动的完成标准、包边界、测试要求、以及提交前不能带真实凭据的要求，都已经
写在 [CONTRIBUTING.md](../CONTRIBUTING.md) 里，这里不重复一份——两处各写一半
容易漂移。涉及 Schema 的改动额外要满足 CONTRIBUTING.md「一次改动的完成标准」
第 6 条：schema、示例、校验和测试是同一次提交的一部分，且提交前跑过上面的
`preview` 命令确认渲染结果符合预期。
