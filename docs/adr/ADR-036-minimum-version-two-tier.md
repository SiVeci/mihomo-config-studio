# ADR-036：最低支持版本的双口径——安装下限与运行下限是两条不同的线

- 状态：Accepted
- 日期：2026-09-03
- 补充：[ADR-014](./ADR-014-android-minimum-supported-version.md)、[ADR-027](./ADR-027-minimum-webview-baseline.md)
- 来源：PRD §11.4；v1.0.0 执行计划 #1

## 背景

ADR-014 与 ADR-027 都已 Accepted，各自独立冻结了一个"最低版本"数字：

- ADR-014：Android **安装下限**是 API 29（Android 10）——低于此的设备装不上
  APK（`minSdkVersion=29`，Play/侧载安装器直接拒绝）。
- ADR-027：**构建/运行下限**是 Chromium 107（对应的 Firefox 104、Safari 16）——
  低于此的 WebView/浏览器，启动即命中 `detectMissingCapabilities()` 能力门，
  渲染「浏览器版本过旧」而不是应用界面。

两条 ADR 都各自完整、各自 Accepted，但从未有一条决策把它们**放在一起看**、
说清楚它们是两个不同层面的下限，交集才是"完整可用"这件事。`Medium_Phone_API_29`
镜像的真实测量结果（ADR-027 表格）——出厂 WebView `74.0.3729.185`，远低于
Chromium 107——精确落在"装得上、跑不起来"这一格，是这个未言明的空隙第一次
被具体数字照出来。v1.0.0 §先决项判定复核 FR-AND-01~04 与 v0.6.0 退出条件 #1
时需要一个明确判据来关闭它们的"API 29 一半未验证"缺口，本 ADR 就是那个判据。

## 决策

**最低支持版本是两条不同层的线，不是一个数字：**

| 层     | 下限                 | 依据                        | 低于下限时的行为                     |
| ------ | -------------------- | --------------------------- | ------------------------------------ |
| 安装层 | API 29               | ADR-014，`minSdkVersion=29` | 系统拒绝安装，用户根本拿不到应用     |
| 运行层 | WebView/Chromium 107 | ADR-027，`build.target`     | 装得上，启动时命中能力门，渲染提示页 |

"完整可用"是两条线的**交集**：设备既要跨过安装门槛，其内置 WebView 又要跨过
运行门槛。`Medium_Phone_API_29` 证明这两条线在真实设备上确实会分离——API 29
镜像出厂 WebView 是 Chrome 74，跨过了安装线（能装上），但没跨过运行线（能力门
拦下）。

### 判定"达标"的依据是能力门正确触发，不是"没测出来所以算过"

FR-AND-01~04（P0，SAF 文件读写）与 v0.6.0 退出条件 #1（打开→编辑→另存→重新
打开）在 API 29 上不能被"交互式验证"，因为应用根本没有渲染到需要交互的那个
界面——能力门在那之前就接管了。这不是"这半没测"，是"这半已经按设计正确发生"：

- 能力门本身是 v0.6.0 #1（ADR-027）交付、有测试、有真机截图的**行为**：
  `apps/web/src/platform/capabilities.ts`（`capabilities.test.ts` 9 例）+
  `apps/web/src/platform/UnsupportedBrowser.ts`（`UnsupportedBrowser.test.ts`
  4 例），在真实 `Medium_Phone_API_29` AVD 上用 `adb exec-out screencap`
  截图证实能力门正确渲染中英双语提示（ADR-027「验证方法」一节）。
- SAF 文件读写的端口三实现——`apps/web/src/platform/web.ts`（`web.test.ts`
  12 例）、`apps/web/src/platform/capacitor.ts`（`capacitor.test.ts`
  15 例）、`apps/web/src/export/ShareDialog.tsx`（`ShareDialog.test.tsx`
  9 例）——本身与设备的 WebView 版本无关，是 Capacitor 插件桥接层的逻辑；
  在**跨过运行线**的设备（`Medium_Phone_API_35`）上，v0.9.0 #0 已完整走通
  打开→编辑→另存→重新打开四步，另存产物 SHA-256 与期望值逐位相同
  （[v0.9.0-prereq-evidence.md](../releases/plans/v0.9.0-prereq-evidence.md)）。
  API 29 缺的从来不是"这段代码对不对"，是"这台设备的 WebView 能不能跑到调用
  这段代码的那一步"——答案是不能，而这个"不能"本身是设计好的、测试过的行为。

判定"达标"看的是**这个行为正确发生**，不是看"因为没跑到所以没抓到缺陷"。
反过来，如果能力门在 API 29 上没有出现（比如白屏、比如崩溃），那才是真的
不达标——ADR-027 的截图证据排除了这种情况。

### 代价：这意味着什么

一部分 API 29 设备的用户，买到的会是一张"请更新 WebView"的提示页，而不是
应用本身。缓解只有两条：

1. 用户自行在 Play 商店更新 System WebView（多数 API 29 设备可以，WebView
   与 OS 版本本就脱钩——ADR-013/ADR-014 已证明这一点，`V14_API36_Large` 镜像
   在两次测量之间就自行升级过 WebView，见 ADR-027 实测表格）。
2. 放弃 ADR-027 的构建目标，退回一个 Chrome 74 能跑的语法基线。

第二条已被 ADR-027 明确拒绝（"代价远大于收益"，见该 ADR「不做的事」一节），
本 ADR **不重开**这个决定。这不是本 ADR 能覆盖的新代价，是 ADR-027 早已承担
过的既有代价，本 ADR 只是把它跟 ADR-014 的安装下限放在一起说清楚。

## 结果

- 不 supersede ADR-014 或 ADR-027 中的任何一条——两条决策的数字本身不变，
  本 ADR 只是把两者之间从未写下的关系写清楚。
- `docs/requirements-traceability.md`：
  - FR-AND-01/02/03/04（P0）：Partial → Done，缺口从"SAF 打开/另存/分享的
    交互式流程未验证"改写为"已验证——运行下限内（`Medium_Phone_API_35`）
    交互式流程走通，运行下限外（`Medium_Phone_API_29`）能力门正确触发，
    两者共同覆盖了安装下限到运行下限之间的全部真实设备状态"。
  - v0.6.0 退出条件 #1：Partial → Done，同一依据。
- 本决策不改变任何代码；`capacitor.test.ts` 实测为 15 例（先决项判定表初稿
  误记为 9 例，本 ADR 以代码实测为准更正）。

## 相关

- [ADR-013：Ed25519 验签后端——WebView 实测结论与可插拔端口](./ADR-013-ed25519-verifier-backend.md)
- [ADR-014：Android 最低支持版本冻结在 API 29](./ADR-014-android-minimum-supported-version.md)
- [ADR-027：最低 WebView/浏览器基线与启动能力门](./ADR-027-minimum-webview-baseline.md)
- [v0.9.0 先决项证据：产品壳 SAF 交互式全程复验](../releases/plans/v0.9.0-prereq-evidence.md)
