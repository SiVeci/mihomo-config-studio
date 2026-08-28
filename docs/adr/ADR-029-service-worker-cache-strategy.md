# ADR-029：自建 Service Worker 与缓存版本策略

- 状态：Accepted
- 日期：2026-08-29
- 相关：[ADR-022](./ADR-022-self-built-virtualization-and-graph.md)、[ADR-026](./ADR-026-platform-capability-port.md)、[ADR-027](./ADR-027-minimum-webview-baseline.md)
- 来源：PRD §11.4；v0.6.0 执行计划 #7；退出条件 4、8

## 背景

Web 端需要两件事：断网可用（退出条件 4：打开→编辑→校验→导出全流程不依赖网络），
以及可安装成 PWA。两者都需要 Service Worker——前者靠它拦截请求、从 Cache Storage
返回构建产物；后者靠它 + `manifest.webmanifest` 满足浏览器的可安装性判定。

业界现成方案是 `vite-plugin-pwa`（内部封装 Workbox）。

## 决策

**自建 SW，不引入 `vite-plugin-pwa`（或 Workbox）。**

理由与 [ADR-022](./ADR-022-self-built-virtualization-and-graph.md) 一致的既有先例：
自建 i18n、自建路由、自建虚拟化——当真实需求比通用库小得多时，自建比引入依赖更便宜。
本片的真实需求只有三条：预缓存构建产物、按版本失效旧缓存、给用户一个强制刷新入口。
Workbox 解决的是更通用的问题（多种缓存策略组合、路由匹配 DSL、后台同步、推送通知），
本产品一条都用不到；引入它意味着构建期新增一个不透明的代码生成层（`vite-plugin-pwa`
会重写 `index.html`、注入自己的运行时），与本仓库"自建的东西必须可读、可测、可控"的
既定路线冲突。

离线优先本身就是 [ADR-022](./ADR-022-self-built-virtualization-and-graph.md) 提到的
"新依赖意味着更大的初始包体积"这条理由的直接体现——SW 本身也是要被缓存、被离线
执行的代码，越小越好。

## 缓存版本策略

- **构建时唯一 ID**：`vite.config.ts` 的 `SW_BUILD_ID = String(Date.now())`，通过
  `define.__SW_BUILD_ID__` 注入 `sw.ts`。这是本策略里最容易被忽略但最关键的一点：
  浏览器判断"SW 是否有新版本"靠**逐字节比较** `sw.js` 新旧两份内容，如果 `sw.ts`
  自己的源码在两次构建之间没有任何字符变化（例如只是资源列表变了，但资源列表本身
  是运行时 `fetch` 来的，不在 `sw.js` 的字节里——见下一条），浏览器根本不会发起新
  worker 的 `install`，缓存版本策略就会静默失效。`__SW_BUILD_ID__` 保证每次构建
  `sw.js` 的字节一定不同。
- **不把资源清单打进 `sw.js` 自己的 bundle**：`vite.config.ts` 新增的
  `precacheManifestPlugin`（`writeBundle` 钩子，此时 Rollup 已经写完其它所有产物、
  每个文件的最终哈希文件名都已知）把完整文件列表写成 `dist/precache-manifest.json`；
  `sw.ts` 在 `install` 时用 `fetch(..., {cache:'no-store'})` 读它。两者反过来做
  （把列表塞进 `sw.ts` 自己引用的模块再一起打包）需要在 `sw` 这个 Rollup 入口构建
  时就知道其它入口的最终文件名，而 Vite/Rollup 没有"先构建这些入口、再构建那个
  入口"的顺序钩子。
- **`install` 只预缓存，不 `skipWaiting()`**：新版本装好后停在 `waiting`，不自动
  接管页面——正在编辑的用户不应该在半路被换掉运行中的代码。`activate` 时清掉所有
  `mcs-precache-` 前缀但不等于当前 `CACHE_NAME` 的旧缓存。
- **导航请求 network-first，静态资源 cache-first**：`index.html` 走网络优先（能拿到
  新版本就用新版本，离线才退回缓存），因为它是唯一不带内容哈希的入口，必须每次都
  尝试要到最新的；其余资源（`assets/*-[hash].js` 等）走缓存优先，因为文件名本身就是
  内容哈希，缓存命中在语义上不可能是"过期"的，不需要向网络确认。
- **强制刷新入口**：`apps/web/src/pwa/UpdateBanner.tsx` 只在 `registerServiceWorker`
  报告有 worker 停在 `waiting` 且页面已经被别的 worker 控制（区分"这是更新"还是
  "这是第一次安装"）时渲染一个按钮；点击后 `postMessage({type:'SKIP_WAITING'})`，
  `sw.ts` 收到后 `skipWaiting()`，新 worker 接管触发 `controllerchange`，
  `register.ts` 监听到后 `location.reload()`。没有这个入口，缓存问题在用户侧
  无法自救——这条是版本文档明确要求的，不是可选项。

## Android 上不注册

`apps/android` 用 Capacitor 从本地 `https://localhost` 加载同一份 Web 构建产物
（[ADR-026](./ADR-026-platform-capability-port.md)）。`register.ts` 用既有的
`isNativePlatform()`（`platform/capacitor.ts`，本仓库唯一的 `@capacitor/*` 导入点）
在最开始就短路跳过整个注册流程——再套一层 Cache Storage 只会让"装了新 APK 还是
旧界面"这种问题更难查，Android 的更新方式就是装新 APK，不需要 SW 这层。

## 什么情况下应该 supersede 这条决策

- 如果未来真的需要 Workbox 提供的能力（后台同步、推送通知、更复杂的路由匹配
  策略），那是一个新的、独立的产品决策，不应该现在预先引入。
- 如果预缓存的资源体积增长到需要分优先级/分批加载（当前 `bootstrap.js` 约
  525KB gzip 后约 157KB，一次 `cache.addAll` 可接受），需要重新评估这条决策。

## 结果

- `apps/web/src/pwa/`：新建 `sw.ts`（SW 源）、`register.ts` + 测试（注册、更新
  探测、`applyUpdate`/`controllerchange` 均有覆盖）、`precache-manifest.ts` + 测试
  （共享类型与运行时校验）、`UpdateBanner.tsx` + 测试（三态：无更新/有更新/点击）。
- `vite.config.ts`：`sw` 作为第三个稳定命名的 Rollup 入口（`dist/sw.js`，不在
  `assets/` 下——SW 的默认作用域是"自己所在路径及以下"，放在 `assets/` 下就只能
  控制 `assets/*`）；`precacheManifestPlugin` 生成 `dist/precache-manifest.json`。
- `apps/web/public/`：新建 `manifest.webmanifest`（PWA 可安装性）+ `icon.svg`（零
  依赖手绘，与 `packages/ui` 的 `primary` 令牌同色）——两者都放 `public/` 而非走
  Rollup 资源管线，因为需要稳定、不带哈希的 URL 供 `manifest.webmanifest` 自身的
  `icons` 字段引用。
- `index.html`：链接 manifest/icon，CSP 新增 `worker-src 'self'`（此前隐式落到
  `script-src 'self'` 的 fallback 链，现在显式声明）。
