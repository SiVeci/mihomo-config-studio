# ADR-026：平台能力端口与单一 Web 构建产物

- 状态：Accepted
- 日期：2026-08-28
- 来源：PRD §11.4；FR-AND-01/02/03；v0.6.0 执行计划 #2

## 背景

FR-AND-01/02/03 要求 Android 上「打开文件走系统文件选择器（SAF）」「保存到用户
选择位置」「通过系统分享面板分享」。ADR-001 已定「Web 与 Android 共享同一份
代码」——`apps/android` 的 Capacitor 壳加载的就是 `apps/web` 的构建产物，不是
两套 UI。这意味着 `ImportPanel.tsx`/`ExportDialog.tsx` 不能各自直接调用
Web 专属 API（`<input type=file>`、`showSaveFilePicker`）：同一份组件代码在
Android 上运行时，这些调用要落到 SAF 而不是浏览器 API。

`packages/storage/src/adapter.ts` 在 v0.2.0 已经预留过一次
`AndroidFileAdapter`（`bindSafDocument` 扩展 `StorageAdapter`），但全仓从未有
任何调用方，本片删除它——原因见下文「删除 `AndroidFileAdapter`」。

## 决策

### 1. 平台无关端口，两端各自实现

`apps/web/src/platform/port.ts` 定义 `PlatformFileService`：
`openDocument`/`saveDocument`/`shareDocument` 三个方法 + `capabilities` 只读
属性。Web 实现（`web.ts`，本片）用浏览器 API；Android 实现
（`capacitor.ts`，v0.6.0 #3）用 Capacitor 插件调 SAF。`ImportPanel.tsx`/
`ExportDialog.tsx` 只依赖端口接口，不知道、也不需要知道自己跑在哪个平台上。

`apps/web/src/platform/index.ts` 的 `resolvePlatformFileService()` 是唯一的
选择点。本片它总是返回 Web 实现——`capacitor.ts` 与 `@capacitor/core` 依赖都
还不存在（`apps/web/package.json` 至今没有 `@capacitor/*`），#3 补上后这里加
一个 `Capacitor.isNativePlatform()` 分支。`@capacitor/*` 只允许出现在
`apps/web/src/platform/capacitor.ts` 这一个文件（工程约束表已写明），
`index.ts` 现在不提前引用它，避免在真正的实现落地前引入一个空的耦合点。

### 2. 返回值形状本身承载"降级"，不是靠 catch

`saveDocument` 返回 `{kind:'saved'} | {kind:'downloaded'} | {kind:'cancelled'}`
三态而非布尔或抛错：`showSaveFilePicker` 不存在时落到 `downloaded`，是端口
主动做出的判断，UI 按 `kind` 选文案，不是在 try/catch 里"兜底"一个意外情况。
`openDocument` 同理返回 `{kind:'opened', text, name} | {kind:'cancelled'}`。
`shareDocument` 多一个 `{kind:'failed', code}`——Web 上恒为
`UNSUPPORTED_PLATFORM`（FR-AND-03 是 Android-only 需求，`capabilities.canShare`
在 Web 上恒 `false`，UI 靠这个标志决定要不要渲染分享按钮，`shareDocument`
本身理论上不会被调用，只是为了让接口完整）。

`capabilities.canSaveViaSystemPicker` 让 UI 在用户点击**之前**就知道按钮该显示
「另存为」还是「下载」（PRD §11.4，v0.6.0 #7 落地这条 UI 文案）——如果只靠
`saveDocument` 返回值事后再变文案，用户会先看到一个显示"另存为"、点了却变成
"下载"的按钮，这正是版本文档要求避免的"同一个按钮偷偷换行为"。

### 3. `openDocument` 走 `<input type=file>`，永不触碰可写句柄

Web 实现的 `openDocument`（`web.ts`）用 `document.createElement('input')` +
`File.text()`，不用 File System Access API 的 `showOpenFilePicker`——
NFR-REL-04（导入路径绝不覆盖原文件）此前就是靠"根本不持有可写句柄"这个结构性
事实成立的，`ImportPanel.test.tsx` 的源码扫描断言这一点仓库范围内不能被破坏。
`saveDocument` 里允许出现 `showSaveFilePicker`/`createWritable`，因为那条路径
本来就是"另存为一个新位置"，从未持有、也不需要持有原始导入文件的句柄。

`ImportPanel.tsx` 的两个文件按钮（主 YAML 导入、Provider 预览）都改走
`openDocument`——不新开一条独立的原生路径，保持组件内只有一种"打开文件"的
方式，避免 Android 上出现"某个按钮走 SAF、另一个偷偷还在用
`<input type=file>`"的不一致。拖放区（drag-and-drop）保持原生 DOM 事件不变：
它是纯 Web 的能力（Android 没有等价的拖入源），不经过端口，行为对齐但代码
路径不需要统一。

### 4. 删除 `AndroidFileAdapter`

v0.2.0 预留的 `AndroidFileAdapter extends StorageAdapter`（`bindSafDocument`）
基于一个后来证明不成立的假设：把 SAF 文档当成键值存储的一个条目。实际不是——
SAF 文档是用户在系统选择器里挑的**一次性文档句柄**（`content://` URI），跟
`StorageAdapter` 建模的"应用私有键值对"是两类不同的东西：

- 项目、Schema Bundle、历史快照留在 `IndexedDbStorageAdapter`（在 Android
  WebView 里落在应用私有数据目录，天然满足 FR-AND-04，不需要 SAF）。
- SAF 文档只在"用户主动打开/另存一个外部文件"这一刻存在，用完即弃——它是
  `PlatformFileService.openDocument`/`saveDocument` 的返回值，不是需要长期
  绑定 key 的持久化条目。

`bindSafDocument(key, uri)` 想解决的"记住上次打开的文件"需求，`Ed25519Verifier`
式的可插拔端口已经用另一种方式覆盖：`openDocument`/`saveDocument` 每次都是
一次完整的用户交互，不依赖跨会话记住 URI；真要做"重新打开上次文件"，也应该是
Android 实现内部（`capacitor.ts`/`SafFilePlugin.kt`）用
`takePersistableUriPermission` 自己管理，不需要下渗进 `StorageAdapter` 这个
通用键值端口。删掉它，`packages/storage` 的公开接口收敛回它原本该有的形状。

## 结果

- 新增 `apps/web/src/platform/port.ts`（接口定义）、`web.ts` + `web.test.ts`
  （Web 实现）、`index.ts`（`resolvePlatformFileService`）。
- `packages/storage/src/adapter.ts`/`index.ts`：删除 `AndroidFileAdapter`
  及其导出，全仓无其他引用。
- `ImportPanel.tsx`/`ExportDialog.tsx` 改走端口；`ProjectPage.tsx` 的
  `downloadFile` prop 重命名为 `saveDocument`（类型从 `DownloadFile` 换成
  `SaveDocument`），三个"closed loop"集成测试（`closed-loop.test.tsx`、
  `alpha-loop.test.tsx`、`rules-and-graph-loop.test.tsx`）同步更新注入方式。
- `docs/requirements-traceability.md` FR-AND-01/02/03 行补端口面证据（Web
  实现 Done，Android 实现留给 #3）。

## 相关

- [ADR-001：采用模块化单体，不建设微服务](./ADR-001-modular-monolith.md)（Web/Android 共享同一份代码）
- [ADR-018：`.mcsproj` 容器格式](./ADR-018-mcsproj-container.md)
