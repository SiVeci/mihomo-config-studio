# ADR-035：内部相对导入改用字面 `.ts` 扩展名，修复裸 Node 对多文件包的解析

- 状态：Accepted
- 日期：2026-08-29
- 相关：[ADR-007](./ADR-007-source-only-workspace-packages.md)、[ADR-030](./ADR-030-minimum-node-baseline.md)
- 来源：v0.9.0 切片 #2

## 背景

ADR-030 记录了"编译后的 `tools/*` CLI 在 Node 20 上无法启动"，把最低 Node 版本抬到
22.18 让类型剥离（type stripping）默认开启，结论是"以后再新增 `tools/*` CLI 时,
'它 import 了工作区内部包'不再是一个会在 CI 上炸掉的意外"。这个结论只验证过一种
情况：`@mcs/templates`——一个**单文件**包（`src/index.ts` 只有 JSON 导入和一条
跨包 type-only 导入，包内部没有任何相对导入）。

**更正（v0.9.0 #3 复核时发现）**：上一段"这个结论只验证过一种情况"的说法过头了。
`tools/schema-cli/src/index.test.ts`（v0.5.0 #13）里已经有一条测试明确写着：
"plain `node dist/index.js` cannot run this repo's multi-file source-only
`packages/**` exports (ADR-007) without a TS-aware loader, so this exercises
the identical `checkDirectoryFiles` code path through vitest instead"——也就是
说，这个缺口早在 v0.5.0 就被发现过一次，只是当时选择绕过（测试逻辑改走 Vitest，
不再声称验证"裸 Node 执行编译产物"这条路径），没有升级成 ADR 或修掉。v0.9.0 #2
是第一次有人**必须**让裸 Node 真正跑通这条路径（`tools/core-test-runner` 的
`--dry-run`/真实执行都要用），逃不掉才修——不是第一次撞见问题，是第一次问题
挡住了路必须解决。`tools/schema-cli` 本身至今仍未被任何 CI job 用裸 Node 执行
（只有 `android-manifest-check`/`egress-check`/`core-test-runner` 三个工具会），
所以它依赖的 `@mcs/schema-registry` 目前**不在**下面的修复范围内——那条已知限制
继续存在，且继续被同一条 v0.5.0 #13 测试如实记录着，直到某天真有 `tools/*` CLI
在运行时需要它。

v0.9.0 #2 让 `tools/core-test-runner` 第一次在运行时（而不只是 typecheck/Vitest）
import 一个**多文件**包（`@mcs/yaml-engine`，随后发现整条链：`@mcs/schema-core`、
`@mcs/config-model`、`@mcs/migration`、`@mcs/storage`）。裸 `node
tools/core-test-runner/dist/index.js --dry-run` 立刻炸掉：

```
Error [ERR_MODULE_NOT_FOUND]: Cannot find module
'…/packages/yaml-engine/src/document.js' imported from
'…/packages/yaml-engine/src/index.ts'
```

Node 22.18+ 的类型剥离只对**被加载文件自身**生效：它能读懂 `index.ts` 里的 TS 语法，
但不会把这份源码里 NodeNext 风格的相对导入说明符（`from './document.js'`，
指向"编译产物将会在的位置"，而这里从未真正编译出那个 `.js`）重新映射到磁盘上
真实存在的 `document.ts`。`tsc`、Vite、Vitest 都会做这层映射（它们本来就要处理
TS 模块图），只有"裸 Node 执行编译产物"这一种消费者不做——这正是 ADR-030 遗留的
缺口，只是当时唯一测过的包没有内部相对导入，没能把它暴露出来。

### 排除的两个"看起来能修"的方案

- **自定义 ESM 加载器钩子**（`node:module` 的 `register()` API，`resolve` 失败时把
  `.js` 换成 `.ts` 重试）。已实测：Node 对这种"深层" TS-to-TS 解析走的是同步链接路径
  （`ModuleJob.syncLink` → `ModuleLoader.resolveSync`），**不会**经过用户注册的异步
  `resolve` 钩子——加了调试日志确认钩子从未被调用。这条路线在 Node 24.12 上验证为
  死路，不是配置错误。
- **把内部相对导入去掉扩展名**（`from './document'`）。`moduleResolution: "Bundler"`
  下 `tsc` 认，但裸 Node 的 ESM 解析器对相对说明符**从不猜扩展名**，同样
  `ERR_MODULE_NOT_FOUND`。已实测确认。

### 验证可行的方案

把内部相对导入的说明符从 `'./document.js'` 改成字面的 `'./document.ts'`。TypeScript
5.7+ 的 `allowImportingTsExtensions` + `rewriteRelativeImportExtensions`
（本仓库 TS 5.9.3，两者都可用）让这个写法在**保持正常 emit** 的前提下合法：

- `tsc` 接受源码里的字面 `.ts` 扩展名（不再要求先设 `noEmit`）。
- `tsc` 编译产物里自动把它改写回 `.js`（`rewriteRelativeImportExtensions` 的定义
  行为），所以 `dist/**` 仍是传统意义上"扩展名正确"的 JS，不给未来某个直接消费
  `dist/` 的场景挖新坑。
- 裸 Node 直接执行 `src/**/*.ts`（本仓库 ADR-007 的运行时路径）时，说明符字面
  就是磁盘上真实存在的文件——不需要猜测、不需要钩子、不需要同步/异步链接路径的
  任何配合。

三选一均已用最小复现脚本实测（而非查文档假设），过程记录在 v0.9.0 #2 的实现笔记里。

## 决策

**`tsconfig.base.json` 新增两个编译选项，且 `@mcs/yaml-engine`、`@mcs/schema-core`、
`@mcs/config-model`、`@mcs/migration`、`@mcs/storage` 这五个包（`tools/core-test-runner`
运行时依赖链的全部多文件包）的内部相对导入统一改用字面 `.ts` 扩展名。**

| 落点                                                                                       | 内容                                                                                                                               |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| `tsconfig.base.json`                                                                       | 新增 `"allowImportingTsExtensions": true`、`"rewriteRelativeImportExtensions": true`                                               |
| `packages/{yaml-engine,schema-core,config-model,migration,storage}/src/*.ts`（非测试文件） | `from './x.js'` → `from './x.ts'`（110+6 处，纯机械替换）                                                                          |
| `packages/schema-builtin/src/index.ts`                                                     | 顺带修复：56 处 JSON 导入缺失 `with { type: 'json' }` import attribute（同一类"从未被裸 Node 加载过"的问题，同一次调试会话里发现） |

**范围边界，明确不做的事**：`packages/{config-model,form-renderer,graph,project-format,
schema-registry,templates,ui,validator}` 里凡是本次运行时依赖链没有触达的模块，
`.js` 扩展名维持不动——它们目前只被 Vite/Vitest/`tsc` 消费，这条从未成立的隐患对
它们还不成立。**这不是"以后不用管"**：任何未来的 `tools/*` CLI 如果在运行时
import 到这些包，会撞上同一个 `ERR_MODULE_NOT_FOUND`，届时的修法就是把该包也纳入
这张表——这正是 ADR-030 那句"不再是意外"应该被读成的样子：意外的是错误本身，
不是修法（修法现在已经确定并写在这里）。

**不采纳的替代方案**：

- 改 ADR-007，让内部包导出 `dist/` 编译产物而非源码。ADR-030 已经明确拒绝过这条
  （"推翻一条已 Accepted 的决策来迁就一个可以用版本号解决的问题"），本决策同一
  立场：`.ts` 扩展名迁移比推翻 ADR-007 代价小得多，且不影响 ADR-007 的任何既有收益
  （无构建步骤、类型直达、改一处即生效）。
- 引入 `tsx`/`ts-node` 之类第三方运行时加载器。会新增一个运行时 devDependency；
  而字面 `.ts` 扩展名不需要任何加载器，Node 内建解析器直接能用。
- 把 `tools/core-test-runner` 打包（bundle）成单文件产物。引入构建工具链新依赖，
  且与其余 `tools/*`"`tsc -b` 直接产出、不打包"的既有惯例不一致。

## 结果

- `node tools/core-test-runner/dist/index.js --dry-run`（以及不带 `--dry-run` 的真实
  路径）现在能正确穿过五个多文件包解析到底。
- `pnpm run check`、`pnpm run format:check`、`pnpm run test:coverage` 三条在改动后
  重跑全部保持绿（119 文件 / 1944 例，覆盖率 96.76% / 93.67% / 96.41% / 96.76%）。
- `tsconfig.base.json` 的两个新编译选项对未采用字面 `.ts` 扩展名的现有代码完全
  无感——它们只是"允许"这种写法，不强制、不改变任何未触碰文件的语义。
- ADR-030 的结论被这条 ADR **补充而非推翻**：Node ≥ 22.18 仍是能加载 `.ts` 源码的
  必要条件；这条 ADR 解决的是"加载到了但包内部相对导入解析不到"的下一层问题。
