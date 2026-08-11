# ADR-013：Ed25519 验签后端——WebView 实测结论与可插拔端口

- 状态：Accepted
- 日期：2026-08-12
- 补充：[ADR-010](./ADR-010-bundle-signing-and-key-custody.md)
- 来源：ADR-010「待验证风险」；M0-4 技术验证

## 背景

ADR-010 把 Bundle 签名验证定在 Web Crypto `SubtleCrypto`（Ed25519 + SHA-256），
但把「Android System WebView 是否支持 `subtle.importKey`/`subtle.verify` 的
Ed25519 算法」列为**待验证风险**：Web Crypto 的 Ed25519 支持在浏览器中是相对
新近的能力，AOSP/模拟器镜像自带的 WebView 版本可能落后。本片给出实测答案。

## 实测方法

探测页 `tools/webcrypto-probe/probe.html`（无构建、无依赖单页）用固定的
RFC 8032 §7.1 TEST 1 向量（公钥、空消息、签名），而非现场 `generateKey`——
`generateKey` 可用不代表 `verify` 可用，两者在浏览器实现里可能是独立的代码路径。
向量在写入页面前已用 Node 自带的 `node:crypto`（`createVerify`/`createPublicKey`
走 SPKI DER）独立验证过签名有效，排除向量本身出错的可能。页面依次记录四项：
`subtle.importKey('raw')`、`subtle.importKey('spki')`、
`subtle.verify({name:'Ed25519'}, ...)`、`subtle.digest('SHA-256')`（后者作为
基线——如果连 SHA-256 都跑不通，说明问题是 WebCrypto 整体不可用或处于非安全
上下文，而不是 Ed25519 这一个算法的支持问题）。

宿主机用 `python -m http.server` 起静态服务，**没有**直接用计划里建议的
`http://10.0.2.2:<port>/`，而是改用 `adb reverse tcp:<port> tcp:<port>` 把
宿主机端口映射进设备的 `localhost`：`10.0.2.2` 是普通私网地址，不在 Chromium
"potentially trustworthy origin" 的例外名单里，用它访问很可能先撞上
`isSecureContext === false` 导致 `crypto.subtle` 整体缺失，得到的是「非安全
上下文」假阴性而非「不支持该算法」的真结论。`adb reverse` + `localhost`
从根上避免了这个混淆源；探测结果里 `isSecureContext: true` 印证了这点。

访问方式是用 `adb shell am start` 拉起 `com.android.chrome`（AVD 镜像自带，
`android.intent.action.VIEW` 指向探测页），而非搭一个承载 `<WebView>` 的宿主
App——`apps/android` 的 Capacitor 壳属于 #11，本片不提前做。用
`adb shell dumpsys package com.google.android.webview` 确认两台设备上
`com.google.android.webview` 包的 `versionName` 与 Chrome 自报的
`userAgent` 版本号**完全一致**，说明这两个镜像上 Chrome 与 WebView 共享同一个
Chromium 构建；WebCrypto 的算法注册表是 Chromium/Blink 引擎的属性，不是
"Chrome 壳" 与 "WebView 壳" 各自的差异化行为，因此 Chrome 测得的结果可以代表
同版本 WebView 组件会有的行为。结果通过 `adb exec-out screencap` 截图读取
（探测页把结果同时渲染成人类可读摘要与原始 JSON），未使用 computer-use 之类
需要额外授权的桌面控制工具。

## 实测结果

| 设备                  | Android / API | Chrome / WebView `versionName` | `importKey('raw'\|'spki')`                              | `verify` | `digest('SHA-256')` |
| --------------------- | ------------- | ------------------------------ | ------------------------------------------------------- | -------- | ------------------- |
| `Medium_Phone_API_29` | 10 / 29       | `74.0.3729.185`                | 失败：`NotSupportedError: Algorithm: Unrecognized name` | 跳过     | ok                  |
| `V14_API36_Large`     | 16 / 36       | `133.0.6943.137`               | 失败：`NotSupportedError: Algorithm: Unrecognized name` | 跳过     | ok                  |

两台设备的 `isSecureContext`/`hasSubtle` 均为 `true`，`digest('SHA-256')`
均成功——WebCrypto 本身可用，失败精确定位在 Ed25519 这一个算法上，不是环境
配置问题。

**结论：两台设备（含实验室现有镜像中最新的 API 36）均不支持 Ed25519 WebCrypto，
预判成立。**

## 结果为什么是这样：不是"版本太旧"，而是"默认关闭"

外部资料核实（Chromium 官方 Intent-to-Ship 与 Igalia 博客的实现时间线）：
Ed25519 于 **Chrome 110**（2022-11）落地，但藏在 `WebCryptoEd25519` 实验性
flag 后面；直到 **Chrome 137**（2025-05）才**默认开启**，无需 flag。

`Medium_Phone_API_29` 的 74 版远早于 110，代码根本不存在。`V14_API36_Large`
的 133 版**晚于** 110、**早于** 137——代码已经在，只是默认关闭；生产 App
无法替最终用户打开 `chrome://flags`，所以对这台"实验室里能拿到的最新镜像"
而言，Ed25519 同样不可用。

**这个结论与 Android OS 版本本身没有必然关系**：WebView 在有 Play 商店的设备
上走独立更新通道，OS 版本号不直接决定 Chromium 版本号。API 36 的镜像反而
测出比 API 29 更"新但仍不够新"的 WebView，恰好说明二者脱钩——一台运行较旧
Android 但 WebView 保持自动更新的真机，理论上可能比本机任何一个模拟器镜像
都更早用上 Chrome 137；反之，企业定制 ROM 或长期离线设备可能永远停在
137 以下。**因此"抬高最低支持 Android 版本"对这个风险无效**，不是 #13
需要权衡的选项——把它当成"改 Android 版本号就能解决"的问题会得出错误结论。

## 决策：验签走可插拔端口，不直接耦合 `crypto.subtle`

```ts
interface Ed25519Verifier {
  verify(publicKey: Uint8Array, signature: Uint8Array, message: Uint8Array): Promise<boolean>;
}
```

- v0.1.0（#8）只提供一个实现：`SubtleCryptoEd25519Verifier`，内部调用
  `crypto.subtle.importKey`/`verify`。这是 Node 测试环境与桌面 Web 场景下
  当前唯一需要的路径（Node 侧 Ed25519 WebCrypto 已实测可用，见执行计划基线）。
- `packages/schema-registry` 的验证代码只依赖 `Ed25519Verifier` 接口，不直接
  `import`/调用 `crypto.subtle`，因此换后端不改调用方。
- **不在 v0.1.0 引入纯 JS Ed25519 实现**：引入第三方密码学代码本身是供应链
  风险（ADR-010 §背景已指出），且 v0.1.0 完全不含任何 Bundle 下载逻辑
  （#7 的内置 Bundle 离线可用，不需要联网验签）——在没有真实需求点之前买
  这个风险不划算。纯 JS 回退推迟到 v0.5.0（M4，真正开始联网更新 Bundle 时）
  再引入，到时候通过实现同一个 `Ed25519Verifier` 接口接入，无需改 #8/#9 的
  调用方代码。
- 这条决策与实测结论正负无关——即使两台测试设备都支持，也应该按可插拔端口
  设计，只是那样 v0.5.0 可能不需要纯 JS 回退；本片按此设计并非临时补救。

## 结果

- ADR-010「待验证风险」关闭：Android WebView 不支持 Ed25519 WebCrypto 的结论
  已实测确认，覆盖模拟器可得的最旧与最新镜像。
- `packages/schema-registry` 的验签实现（#8）必须以 `Ed25519Verifier` 接口
  为唯一耦合点，不得直接依赖 `crypto.subtle`。
- v0.1.0 范围内不受影响：内置 Bundle 不走网络验签路径。真正受影响的是
  v0.5.0 的联网 Bundle 更新——届时必须已经有纯 JS 回退，或者已经确认目标
  用户群的 WebView 版本分布足以只依赖 SubtleCrypto（后者需要真实遥测数据，
  当前无法预判）。
- `docs/upstream-divergences.md` 不需要新增条目：这不是"PRD 与上游行为
  冲突"，是 ADR-010 明确列为待验证的技术风险，本片是按计划完成验证。
- 未采用的做法：抬高最低支持 Android 版本。上一节已说明这对本风险无效，
  错误地绑定两者会误导 #13 的最低版本冻结决策。

## 相关

- [ADR-010：Bundle 签名算法与签名密钥托管](./ADR-010-bundle-signing-and-key-custody.md)
