# ADR-033：Playwright 端到端测试的分层与被测对象

- 状态：Accepted
- 日期：2026-08-30
- 相关：[ADR-022](./ADR-022-self-built-virtualization-and-graph.md)、[ADR-027](./ADR-027-minimum-webview-baseline.md)、[ADR-029](./ADR-029-service-worker-cache-strategy.md)
- 来源：v0.9.0 切片 #7；退出条件 2（Web 线）；PRD §13.4

## 背景

本仓库至此只有 vitest + jsdom 一层测试。jsdom 没有布局引擎、没有真实
Service Worker/Cache Storage 实现、没有真实 File System Access API、没有
真实键盘事件的浏览器原生行为——版本文档 §13.4 要求的 Web 线七个场景
（创建、导入、修改引用、规则排序、差异、导出、离线恢复）里，导出场景需要
真实的浏览器下载事件，离线恢复场景需要真实断网 + 真实 Service Worker
接管，都不是 jsdom 能验证的。

## 决策

**引入 Playwright 作为独立于 vitest 的第二套测试运行器，只服务于需要真实
浏览器的场景；不自建浏览器驱动。**

### 与 ADR-022 的边界：为什么这次不是"自建"

ADR-022 的决策是"虚拟化与关系图一律自建，不引入新运行时依赖"，管的是
**运行时依赖**——最终产物 `dist/**` 会不会因为这个决策变大、会不会多背一个
第三方包的安全维护负担。Playwright 是**开发期测试运行器**：`@playwright/test`
只出现在 `devDependencies`，`e2e/**` 不被任何 `tsconfig.build.json` 之外的
构建流程处理，不进 `apps/**`/`packages/**` 的依赖图，不影响
`dist/assets/bootstrap.js` 一个字节。ADR-022 挡的是"这个决策会不会让离线包
体积变大"，Playwright 的答案是不会——它从未随产物一起发布给最终用户。

不自建的理由也不是"图省事"：ADR-022 能自建成功，是因为虚拟列表、关系图的
真实需求（定高单列表、三层固定 DAG）远小于通用库解决的问题。真实浏览器
自动化则相反——Playwright/Puppeteer 这类工具的核心价值是把 Chrome DevTools
Protocol 的连接管理、执行上下文隔离、跨进程序列化、Windows/macOS/Linux
差异这些正确性要求极高又与本产品业务逻辑无关的基础设施做对了；自建一个
"够用"的 CDP 客户端，风险与成本都远高于虚拟列表那道纯函数。

### 被测对象是构建产物，不是 dev server

`playwright.config.ts` 的 `webServer` 是：

```ts
command: 'pnpm run build && pnpm --filter @mcs/web exec vite preview --port 4173 --strictPort',
```

不是 `vite dev`。这不是偏好，是硬约束：`apps/web/src/main.tsx` 硬编码
`/assets/bootstrap.js`/`/assets/bootstrap.css`（ADR-027 两入口拆分的稳定
文件名），只有真实 `vite build` 产物才有这两个文件——v0.6.0 #6 已经在
dev server 下踩过这个坑，`vite dev` 不产出这两个文件，页面直接白屏。

### 七个场景与命名

每个场景一个 `test()`，测试名里写明对应的 FR/ADR 编号，与本仓库既有测试
命名习惯一致（`e2e/web.spec.ts`）：

| 场景     | 覆盖       |
| -------- | ---------- |
| 创建项目 | FR-PROJ-01 |
| 导入配置 | FR-YAML-01 |
| 修改引用 | FR-REL-03  |
| 规则排序 | FR-RULE-02 |
| 差异     | FR-YAML-06 |
| 导出     | FR-PROJ-06 |
| 离线恢复 | ADR-029    |

导出场景用 Playwright 的 `download` 事件拿到真实文件，逐字节比对内容
（`readFile` 与 `createReadStream` 两条独立路径都校验），不是断言"按钮点了
就算数"。离线恢复场景用 `context.setOffline(true)` 真实断网、`page.reload()`
真实重新导航，验证 ADR-029 的 Service Worker 确实接管了这次导航——不是
mock `fetch` 或 mock `navigator.serviceWorker`。

### `pnpm run check` 不跑 E2E

E2E 是独立命令（`pnpm run e2e`）、独立 CI job（`e2e-web`）。`check` 是每片
必跑的快速闸门（本轮约 24 秒），真实浏览器启动 + `vite build` 会让它变成
分钟级——一旦一个理应几十秒跑完的闸门变成分钟级，人就会开始跳过它。两个
运行器的取舍原则不同：`check` 要快到没有理由不跑，E2E 要真实到能抓到
jsdom 抓不到的问题，两者不可兼得，所以分开。

### 与 vitest 的边界：`include` 模式互不相交

`vitest.config.ts` 的 `include` 全部锚定在
`packages/*/src/**`、`tools/*/src/**`、`apps/web/src/**` 之下，`e2e/**`
在仓库根、不在这三者任何一个之下，结构上不可能被匹配到——现有模式无需
改动。但"结构上现在不会"不等于"以后不会"：`vitest.config.ts` 内新增了一条
运行时断言（用 `node:path` 的 `matchesGlob`），对着 `e2e/web.spec.ts` 等
代表性路径逐条检查全部 `include` 模式，任何一条意外匹配就直接抛错——防的
是未来有人把某条模式改宽（例如误改成不限目录的 `**/*.test.ts`）而不自知，
让 Playwright 的浏览器场景被 vitest 用 jsdom 又跑一遍。`.spec.ts`（E2E）与
`.test.ts`（vitest）的后缀差异是第一道防线，这条断言是结构性的第二道。

### CI 只装 Chromium

`pnpm exec playwright install --with-deps chromium`，不装 Firefox/WebKit。
ADR-027 的基线就是 Chromium 107 起的 Chromium 系 WebView + 桌面 Chrome，
这个产品的"受支持浏览器"故事本来就是单引擎，没有理由为了这套 E2E 多装两个
从未在生产环境目标范围内的引擎。

## 实现中发现的真实可测试性问题

真实浏览器暴露了两类 jsdom 环境下不可见、且与本产品业务逻辑无关的纯
测试基础设施问题（均已在 `e2e/web.spec.ts`/`playwright.config.ts` 修好，
细节见 `docs/releases/plans/v0.9.0.md` #7 的实现记录，这里只记结论）：

- **`e2e/tsconfig.json` 的 `outDir` 落在 `e2e/dist/` 内**（`tsc -b` 的项目
  引用图要求真实产出），而 Playwright 默认递归扫描 `testDir` 下所有
  `*.spec.ts`/`*.spec.js`——`tsc -b` 编译出的 `e2e/dist/e2e/web.spec.js`
  会被当成第二份独立测试重复执行。修法与 `eslint.config.js` 排除 `dist/`
  的方式一致：`playwright.config.ts` 新增 `testIgnore: '**/dist/**'`。
- **`platform/web.ts` 的 `showSaveFilePicker` 分支在真实 Chromium 下必然
  命中**：该 API 打开一个 Playwright 无法驱动的原生 OS 对话框，既不触发
  `download` 事件，也不会在没有人工干预时自行结束——导出场景若不处理，
  会挂到 Playwright 自己的超时，而不是清楚地失败。测试里用
  `page.evaluate` 把 `window.showSaveFilePicker` 遮蔽为 `undefined`
  （它是 `window` 自身的可配置属性，不是原型链上的只读值，`Object.defineProperty`
  覆盖即可、无需 `delete`），强制走 `<a download>` 回退
  路径——这条路径本来就是老浏览器的真实行为，用它验证字节内容完全成立。
  连带发现：`ExportDialog.tsx` 会依据这同一个能力位切换按钮文案
  （`导出 config.yaml` vs `下载 config.yaml`），测试里等待的按钮名要跟着换。

这两个问题都是"测试怎么可靠地观察真实浏览器行为"层面的问题，不是产品
代码缺陷，因此修法都在 `e2e/**`/`playwright.config.ts` 内，没有触碰
`apps/web/src/platform/web.ts`/`ExportDialog.tsx` 的产品逻辑本身。

另有一项真实**产品**缺陷是通过这套 E2E 才被发现的——`apps/web/src/pwa/register.ts`
在首次安装（`navigator.serviceWorker.controller` 此前为
`null`）时也会触发页面刷新，与 ADR-029 自己"正在运行的会话不应被换掉"的
原则相悖；修法与记录见 ADR-029 原文附近的 `register.ts`/`register.test.ts`
改动和本片的实现记录，不在此 ADR 重复——这是 ADR-029 决策范围内的实现
纠偏，不改变 ADR-029 本身的任何决策点，因此不新开或修改 ADR-029。

## 不采纳的替代方案

- **只在 CI 里跑，本地不跑**：真实浏览器测试的价值恰恰在于能抓到需要
  "真的看一眼渲染结果"才能发现的问题（本片的 Service Worker 首装竞态就是
  例子），本地能跑才能在提交前而不是 CI 红了之后发现。
- **用 `vitest-browser`/`@vitest/browser` 统一到一套运行器**：这类方案
  仍然依赖真实浏览器驱动（多数场景下也是 Playwright），并不能省掉"引入
  真实浏览器自动化"这个决策本身，反而会把两种测试哲学（jsdom 快速单元
  测试 vs 真实浏览器集成测试）糅进同一个配置文件，与本片"两者取舍不同、
  应该分开"的结论矛盾。
- **`sw.ts` 的 `clients.claim()` 只在真正的更新流程里调用**：讨论过让
  Service Worker 自己区分"首次安装"和"更新"，但 `clients.claim()` 在首次
  安装时立刻接管页面本身是合理且常见的做法（离线能力从第一次访问就可用），
  真正的问题在 `register.ts` 把"控制权变化"等同于"用户请求的更新"——修
  下游的错误假设，而不是改上游本来正确的行为。

## 结果

- 新增 `playwright.config.ts`（仓库根）、`e2e/web.spec.ts`、`e2e/fixtures.ts`、
  `e2e/tsconfig.json`。
- `package.json`：新增 `@playwright/test`（精确版本）devDependency 与
  `pnpm run e2e` 脚本。
- `eslint.config.js`：`e2e/**` 允许 `console`、禁止 `.only`。
- `vitest.config.ts`：新增运行时断言，防止 `include` 模式未来意外覆盖
  `e2e/**`。
- `.github/workflows/ci.yml`：新增独立的 `e2e-web` job（阻断）。
- 顺带修好一个真实生产缺陷：`apps/web/src/pwa/register.ts` 首次安装触发
  的多余页面刷新（详见上文与本片实现记录）。
