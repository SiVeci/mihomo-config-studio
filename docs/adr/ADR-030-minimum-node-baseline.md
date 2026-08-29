# ADR-030：开发与 CI 的最低 Node 版本抬到 22.18

- 状态：Accepted
- 日期：2026-08-29
- 相关：[ADR-007](./ADR-007-source-only-workspace-packages.md)、[ADR-027](./ADR-027-minimum-webview-baseline.md)
- 来源：v0.9.0 切片 #1（本仓库首次真实 CI 运行）

## 背景

本仓库从 v0.1.0 起在 `package.json` 的 `engines`、`README.md` 与 `CONTRIBUTING.md`
里声明最低 Node **20.11**，CI 的 `actions/setup-node` 也固定 `node-version: 20`。
这个数字从未被验证过——本仓库在 v0.9.0 #1 之前**从未推送过 `origin`，CI 一次都没
真实运行过**，而本机开发环境是 Node 24。

v0.9.0 #1 首次真实推送后，两条独立的失败同时证明 20.11 这个数字是错的。

### 证据一：Node 20 上 38 个测试文件根本没运行，而且看起来像通过了

`check` job 的 `pnpm run test:coverage` 输出：

```
Test Files  81 passed (119)
     Tests  1509 passed (1509)
    Errors  38 errors
 Duration   26.76s (… environment 27ms …)
```

38 个 `Unhandled Error`，每一个都是同一条：

```
TypeError: webidl.util.markAsUncloneable is not a function
 ❯ new CacheStorage node_modules/undici/lib/web/cache/cachestorage.js:20:17
 ❯ Object.<anonymous> node_modules/jsdom/lib/api.js:12:33
```

`jsdom@30.0.1` 依赖 `undici@8.10.0`，后者在加载时调用
`webidl.util.markAsUncloneable`——这个 API 在 Node 22 才有。Node 20 上 jsdom 整个
装不起来，于是**全部 38 个 DOM 测试文件（`apps/web` 的 `.tsx` 与部分 `.ts`）一个都
没跑**。`environment 27ms`（本机是 53 秒）就是这件事的指纹。

**这一条最危险的地方不是失败，是它的失败形态**：vitest 把这 38 个文件记成
"unhandled errors" 而不是 "failed test files"，摘要行里写的是 `81 passed` 和
`1509 passed`——**没有一个红色的失败用例**。如果不是覆盖率闸门（64.2% < 85%）拦下来，
这次 CI 会报绿，而实际上三分之一的测试从未执行。

覆盖率阈值在这里不是"代码质量指标"，是**捕获静默不执行的最后一道防线**。这是保留
85% 硬阈值（v0.9.0 工程约束"不得放宽"）的一个此前没想到的理由。

### 证据二：编译后的 `tools/*` CLI 在 Node 20 上无法启动

`core-config-test` job：

```
TypeError [ERR_UNKNOWN_FILE_EXTENSION]: Unknown file extension ".ts"
  for …/packages/templates/src/index.ts
```

`tools/core-test-runner/dist/index.js`（`tsc` 产物）里 `import … from '@mcs/templates'`
的模块说明符被原样保留（`tsc` 从不改写它），Node 顺着 pnpm 的 workspace 链接解析到
`packages/templates/package.json` 的 `exports: "./src/index.ts"`——**这是
[ADR-007](./ADR-007-source-only-workspace-packages.md) 的既定契约**：工作区内部包直接
导出 TypeScript 源码。

ADR-007 当初考虑的消费者是 Vite、Vitest 和 `tsc`，它们自己就会处理 TS。它没有考虑
**"编译成 JS 后由裸 Node 执行"** 这一类消费者，而 `tools/*` 的 CLI 恰好全是这一类。
本机之所以一直没发现，是因为 Node 24 默认开启类型剥离（type stripping），直接就把
`.ts` 读进去了。

因此 ADR-007 隐含了一条从未被写下来的要求：**任何 import 工作区内部包的编译产物，
运行时的 Node 必须支持类型剥离**，即 Node ≥ 22.18（22.18.0 起默认开启，无需
`--experimental-strip-types`）。

## 决策

**最低支持的 Node 版本抬到 `>=22.18.0`。**

| 落点                             | 内容                            |
| -------------------------------- | ------------------------------- |
| `package.json` 的 `engines.node` | `>=20.11.0` → `>=22.18.0`       |
| 三个 workflow 的 `node-version`  | `20` → `22`（共十处）           |
| `README.md`「本地开发」          | 「Node.js ≥ 20.11」→「≥ 22.18」 |
| `CONTRIBUTING.md`                | 同上                            |

为什么是 22.18 而不是 22.0：类型剥离在 22.18.0 才默认开启。22.0–22.17 需要显式
`--experimental-strip-types`，把这个标志散进每个 CI 步骤和每个贡献者的命令行是更差的
选择。为什么不是 24：22 是当前 LTS 线，够用；把地板抬到刚够为止。

**不采纳的两个替代方案**：

- **只把 CI 的 `node-version` 改成 22，`engines` 保持 20.11。** 这等于让 CI 绿而
  声明的支持范围仍是假的——贡献者在 Node 20 上跑 `pnpm run check` 会撞上同样的
  38 个静默不执行，且没有覆盖率闸门保护时更难发现。声明与事实不符，比数字保守更糟。
- **改掉 ADR-007，让内部包导出编译产物。** 那是推翻一条已 Accepted 的决策来迁就一个
  可以用版本号解决的问题；ADR-007 的好处（无构建步骤、类型直达、改一处即生效）依然
  成立，代价只是"编译产物需要 TS-capable 的 Node"，抬版本号即可付清。

## 结果

- Node 20 不再受支持。这是**收窄**支持范围，不是扩大——但它只是把一个从来就不成立的
  声明改成事实，不是新增限制。此前任何"本仓库支持 Node 20"的说法都没有证据支撑。
- 两条 CI 失败一并消失：jsdom 能装起来（38 个测试文件恢复执行），编译后的
  `tools/*` CLI 能解析 ADR-007 的源码导出。
- **ADR-007 的隐含要求被显式记录下来**：以后再新增 `tools/*` CLI 时，"它 import 了
  工作区内部包"不再是一个会在 CI 上炸掉的意外。
- 代价：贡献者必须用 Node ≥ 22.18。考虑到 Node 20 已进入维护期尾声、22 是当前 LTS，
  这个代价可以接受。
- 历史文档（`docs/releases/plans/v0.1.0.md` 至 `v0.6.0.md` 的工程约束节、以及三份
  `*-perf-baseline.md` 里"未在最低支持版本 Node 20.11 上采样"的措辞）**不回改**——
  它们记录的是当时为真的状态，改写它们等于伪造历史。本 ADR 的日期就是分界线。
