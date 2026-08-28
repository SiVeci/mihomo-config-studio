# ADR-027：最低 WebView/浏览器基线与启动能力门

- 状态：Accepted
- 日期：2026-08-28
- 补充：[ADR-013](./ADR-013-ed25519-verifier-backend.md)、[ADR-014](./ADR-014-android-minimum-supported-version.md)
- 来源：PRD §11.4；v0.6.0 执行计划 #1（决策 G2）

## 背景

`apps/web/vite.config.ts` 此前从未显式设置 `build.target`，构建产物的语法基线由
Vite 的默认值（`'modules'`，约等于"支持原生 ESM 的浏览器"）隐式决定。这个隐式基线
从未与本产品实际调用的**运行时 API**（而非语法）对齐——例如 `i18n/index.ts` 已在用
`String.prototype.replaceAll`（Chrome 85+），本片新增的能力探测还会用到
`indexedDB`、`Worker`、`crypto.subtle`、`Array.prototype.at`、`Object.hasOwn`。
esbuild 的 `target` 只转译**语法**（可选链、类字段等），从不为运行时方法打 polyfill，
所以低于基线的 WebView 上会在某个深层调用点直接抛
`TypeError: ... is not a function`——用户看到的是白屏或卡死，不是任何可读的提示。

ADR-013 已经证明「WebView 版本与 Android OS 版本脱钩，抬高 `minSdk` 对此无效」；
ADR-014 冻结 `minSdk=29` 时明确排除了 WebView 结论作为输入。因此本决策的路线是
决策 G2 定的两步：① 显式冻结一个构建基线数字；② 启动时探测运行时能力，
不达标时渲染一句人话而不是任由白屏发生。

## 实测方法

用 `adb shell dumpsys package com.google.android.webview | grep versionName` 在
决策 G1 的三台 AVD（API 29 / 35 / 36）上各取一次真实值。API 36 设备上该命令返回
了两个不同的 `versionName`（新旧两代包信息共存于 `dumpsys package` 输出中），
改用 `adb shell dumpsys webviewupdate` 的 `Current WebView package` 行取权威值——
这行是 WebView 更新服务实际生效的版本，不受历史包记录干扰。API 29 / 35 两台设备
上两种方法读数一致，无需交叉核对。

## 实测结果

| 设备                  | Android / API | WebView `versionName`（权威值） | 备注                                                                                                                                                                                                                                                                     |
| --------------------- | ------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Medium_Phone_API_29` | 10 / 29       | `74.0.3729.185`                 | 与 ADR-013（2026-08-12）一致，镜像未获得过 WebView 更新                                                                                                                                                                                                                  |
| `Medium_Phone_API_35` | 15 / 35       | `124.0.6367.219`                | 新测，此前无记录                                                                                                                                                                                                                                                         |
| `V14_API36_Large`     | 16 / 36       | `150.0.7871.181`                | **高于** ADR-013 记录的 `133.0.6943.137`——镜像在两次测量之间通过 Play 商店自动更新通道升级过 WebView（`dumpsys package` 里仍能看到 133 这条历史记录，`dumpsys webviewupdate` 确认 150 才是当前生效版本），再次印证 ADR-013「WebView 独立于 OS 版本、且会自行漂移」的结论 |

三个 Chromium 主版本号：**74 / 124 / 150**。API 29 大幅落后于任何可能的冻结基线；
API 35、36 均已跨过 Chrome 137（Ed25519 WebCrypto 默认开启的版本），这一点记入
#10 的前置观察，但**不改变**本 ADR 的决策（下一节）。

## 决策

### 1. 构建基线冻结为 Chromium ≥ 107 / Firefox ≥ 104 / Safari ≥ 16

`apps/web/vite.config.ts` 的 `build.target` 显式写为
`['chrome107', 'edge107', 'firefox104', 'safari16']`——Vite 6
`baseline-widely-available` 基线的字面含义，比 PRD §11.4「最近两个主要版本」更宽松
（不构成偏离：更宽松意味着覆盖更多设备，PRD 的字面要求仍被满足）。这是**语法**基线，
决定构建产物用不用某些较新语法；它不隐含、也不能替代下面的运行时能力探测。

**不做的事**：不降级构建目标去将就 API 29 的 Chrome 74（ADR-013 已证明抬高
`minSdk` 对 WebView 版本无效，把构建目标降到能兼容 Chrome 74 意味着放弃过去
几年的语法特性，代价远大于收益）；不引入运行时 polyfill 包（`core-js` 之类）——
下面的能力门用可读的提示替代了"强行让旧浏览器跑起来"，成本更低、行为更诚实。

### 2. 启动时按运行时 API 探测，不按 UA 字符串探测

`apps/web/src/platform/capabilities.ts` 的 `detectMissingCapabilities(global)`
检查六项运行时能力是否存在：`indexedDB`、`Worker`、`crypto.subtle`、
`String.prototype.replaceAll`、`Array.prototype.at`、`Object.hasOwn`——均为本产品
真实调用过的、Chrome 74 上缺失或行为不确定的 API,而非猜测性地选取。UA 嗅探被
排除：WebView 的 UA 版本号与实际组件版本可能被厂商 ROM 篡改或冻结，运行时能力
探测直接问"这个方法存在吗"，不依赖字符串解析。

`apps/web/src/main.tsx` 在挂载 React 之前先调用这个探测；有缺失能力时渲染
`apps/web/src/platform/UnsupportedBrowser.ts` 的能力门页面，不再加载应用主体。

### 3. 能力门必须是独立的 Rollup 入口，不能靠"写在前面"

第一版实现只是把探测逻辑写在 `main.tsx` 顶部、`createRoot(...).render(...)`
之前，其余照旧静态 `import` React/`@mcs/ui`/`App`。**在真实 Chrome 74 AVD 上
实测，这版直接白屏**——原因不是逻辑顺序，是**语法**：Rollup 默认把一个入口能
到达的所有静态 `import` 打进同一个（或按 `import()` 拆分的）产物文件；只要这个
文件里**任何位置**出现 `build.target=chrome107` 允许的语法（哪怕只是可选链
`?.` 这一个字符），Chrome 74 的解析器就会在解析整个文件时抛 `SyntaxError`——
解析失败发生在**执行任何一行代码之前**，探测逻辑自己写得再靠前也不会运行。
`capabilities.ts` 初版恰好用了 `global.crypto?.subtle` 这类可选链，成了第一个
反例：报告"浏览器版本过旧"的代码自己先被判了语法死刑。

改用**两个独立的 Rollup 入口**（`vite.config.ts` 的 `build.rollupOptions.input`）：

- `main.tsx`：入口 chunk，只含探测逻辑本身（`capabilities.ts` +
  `UnsupportedBrowser.ts`），**手写规避 `?.`/`??`**（用 `&&` 短路链代替），
  是全部产物里唯一保证在 Chrome 74 上能被解析的文件。
- `bootstrap.tsx`：原 `main.tsx` 的全部内容（React、`@mcs/ui`、`App` 整棵树），
  独立入口，产物文件名固定为 `assets/bootstrap.js`/`assets/bootstrap.css`
  （`entryFileNames`/`assetFileNames` 特判，不参与内容哈希）。

`main.tsx` 探测通过后，用 `document.createElement('script')`/`('link')`
**手动**把这两个固定文件名注入 `<head>`，而不是 `import('./bootstrap.js')`。
这一步同样是实测出来的：Vite 的 `import()` 转换**无条件**给动态导入包一层
`__vitePreload` 运行时 helper（读 CSP nonce、按需预加载关联 CSS），这层 helper
自己的代码用了 `?.`——`modulePreload:false`、`cssCodeSplit:false` 都试过，
都无法关掉这层包装，因为它由 Rollup 的导入分析插件在检测到 `import()` 语法时
无条件注入，不是由这些公开配置项控制的。原生 `document.createElement`
调用对 Vite 的导入分析完全不可见，不会触发任何包装。

**验证方法**：不是读代码猜"这样应该行"，是每改一版就重新 `pnpm run build`，
用 `adb reverse` + `adb shell am start -a android.intent.action.VIEW`
把构建产物在 API 29 AVD 的真实 Chrome 74 里打开一次，`adb exec-out screencap`
截图确认——第一版白屏、去掉 `?.` 后仍白屏（`__vitePreload` helper）、拆成两个
入口后能力门正确渲染中英文文案。桌面 Chromium（本机 Browser 面板）交叉验证了
"有能力"分支：真实按钮渲染、`getComputedStyle` 读到 `@mcs/ui` 的设计令牌
自定义属性、控制台零报错，确认拆分后应用主体未被破坏。

### 4. 能力门页面零依赖，是 i18n 规则的唯一例外

`UnsupportedBrowser.ts`（刻意不用 `.tsx`）不 `import` React、不 `import`
`apps/web/src/i18n`、不使用 `replaceAll`/`.at()`/`Object.hasOwn` 等它自己正在
检测的 API——它要报告的正是这些东西缺失，用到它们就是自相矛盾。文案中英双语直接
内联在源码里，不走 i18n key。这是仓库 i18n 约定（`docs/releases/plans/v0.6.0.md`
工程约束）的唯一例外，在该文件与本 ADR 中都写明原因，避免后来者当成疏漏"修复"掉。
渲染本身也只用 `document.createElement`/`.textContent`/`.appendChild`——连
`ChildNode.replaceChildren()`（Chrome 86+）都不用，同一课教训的延伸。

页面给出可执行的下一步（更新 Android System WebView / 更新浏览器），**不提供
"仍要继续"的逃生入口**——缺 `indexedDB` 或 `Worker` 时继续只会在下一个操作点崩在
别处，一个更晚、更难定位的错误不比现在这个诚实的提示更好。

## 结果

- `apps/web/vite.config.ts`：`build.target` 从隐式改为显式
  `['chrome107', 'edge107', 'firefox104', 'safari16']`；`build.rollupOptions`
  新增 `main`/`bootstrap` 双入口与固定文件名规则；`modulePreload: false`。
- 新增 `apps/web/src/platform/capabilities.ts`（`detectMissingCapabilities`，
  刻意不用可选链/空值合并）、`apps/web/src/platform/UnsupportedBrowser.ts`
  （零依赖能力门渲染）。
- `apps/web/src/main.tsx`：瘦身为纯探测入口；有能力时用 `<script>`/`<link>`
  标签手动加载 `apps/web/src/bootstrap.tsx`（新建，原 `main.tsx` 的挂载逻辑）。
- `vitest.config.ts` 覆盖率排除列表新增 `bootstrap.tsx`（与既有 `main.tsx` 同一
  "纯接线、无自身逻辑"理由）。
- API 29 AVD（Chrome 74）在真实构建下触发能力门，已用截图证实——这是设计行为，
  不是缺陷。记入 `docs/releases/plans/v0.6.0.md` 风险 R1，退出条件 1 在该设备上
  的观察目标相应调整为"能力门正确出现"。
- `docs/requirements-traceability.md` 新增 PRD §11.4 一行，指向本 ADR 与
  `capabilities.test.ts`。
- `docs/upstream-divergences.md` 不需要新增条目：这不是 PRD 与上游（Mihomo 内核）
  行为的冲突，是客户端浏览器兼容性的工程决策。
- 未采用的做法：`import()` + 运行时 polyfill 关闭项（试过 `modulePreload:false`、
  `cssCodeSplit:false`，均无法消除 `__vitePreload` helper 里的 `?.`，见上文
  「不是靠写在前面」一节）；`/* @vite-ignore */` 逃逸动态导入分析（能去掉
  helper，但拿不到构建期重写后的哈希文件名，需要额外机制固定输出名——双 Rollup
  入口直接解决了文件名固定的问题，不需要这层额外逃逸）。

## 相关

- [ADR-013：Ed25519 验签后端——WebView 实测结论与可插拔端口](./ADR-013-ed25519-verifier-backend.md)
- [ADR-014：Android 最低支持版本冻结在 API 29](./ADR-014-android-minimum-supported-version.md)
