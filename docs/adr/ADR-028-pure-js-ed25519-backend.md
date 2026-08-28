# ADR-028：纯 JS Ed25519 验签后端（`@noble/ed25519`）

- 状态：Accepted
- 日期：2026-08-29
- 补充：[ADR-013](./ADR-013-ed25519-verifier-backend.md)、[ADR-010](./ADR-010-bundle-signing-and-key-custody.md)
- 来源：ADR-013「结果」节的待兑现项；v0.6.0 执行计划 #10（决策 G3）

## 背景

ADR-013 用真机实测确认：两台测试设备（`Medium_Phone_API_29`/Chrome 74、
`V14_API36_Large`/Chrome 133）均不支持 `crypto.subtle` 的 Ed25519 算法——
Chromium 在 110 版实现、137 版才默认开启，两台设备的 WebView 版本都落在
这个区间之外（更早或"够新但仍不到 137"）。ADR-013 当时的决策是把验签做成
可插拔端口（`Ed25519Verifier`），但**不在 v0.1.0 引入纯 JS 实现**——那时
内置 Bundle 离线可用，不走联网验签路径，买这个供应链风险不划算。本片
（v0.6.0 #10）是"真正开始联网更新 Bundle"的时点，需要兑现这个推迟项。

## 决策：引入 `@noble/ed25519`，不自己实现

在"自己写 Ed25519"与"引入一个被广泛审计的零依赖实现"之间选后者。
`@noble/ed25519` 是 `noble-curves`/`noble-hashes` 系列的一部分（作者
paulmillr，MIT 协议），零运行时依赖、体积小（~4KB min+gzip）、长期被
多个安全审计覆盖——这条选择本身不是"图省事"，是 ADR-010 §背景已经指出的
"密码学代码自己写是供应链风险"这一原则的直接应用：真正的风险不是"用不用
第三方库"，是"用一个没人审计过的自制实现"。

**精确版本锁定**：`apps/web/package.json` 写 `"@noble/ed25519": "2.3.0"`
（非 `^2.3.0`），`pnpm-lock.yaml` 记录 integrity hash。依赖只落在
`apps/web`，`packages/schema-registry`（乃至整个 `packages/**`）不新增
任何依赖——`Ed25519Verifier` 接口是唯一耦合点，验证代码本身不知道也不
关心具体后端是 `crypto.subtle` 还是 `@noble/ed25519`。

选 v2.x 而非当前更新的 v3.x：v2 的 `verifyAsync`/`etc.sha512Async` 这套
async-first、显式可覆盖哈希实现的 API 形状是本片全部实现细节（见下）的
依据；v3 是新的大版本，API 是否兼容未经验证，没有必要在"验证一个已经
够用的纯 JS 后端"这个任务里同时承担"验证一个未知的新大版本"的额外风险。

## 实现要点

- **能力探测而非假设**（沿用 ADR-013 的方法论）：`verify-options.ts` 的
  `resolveEd25519Verifier()` 在启动时用 RFC 8032 §7.1 TEST 1 的固定向量
  （与 `tools/webcrypto-probe/probe.html`、ADR-013 同一组，已用 Node 自带
  `crypto` 独立验证过）真的调一次 `crypto.subtle.importKey` +
  `crypto.subtle.verify`，成功才用原生后端，失败（含 `crypto.subtle`
  整体缺失）一律退到 `NobleEd25519Verifier`。不按 UA 或"是否 Android"
  判断——ADR-013 已经证明 WebView 版本与 Android OS 版本脱钩，同一个
  判断逻辑放到 iOS Safari／未来任何平台上都成立。探测结果按会话缓存
  （`cachedVerifierPromise`），不是每次验签都重新探测。
- **显式注入 sha512，不依赖库默认值**：noble v2 的 `verifyAsync` 需要
  `etc.sha512Async`，其默认实现本身也是走 `crypto.subtle.digest('SHA-512')`
  ——但 `noble-verifier.ts` 仍然显式赋值这个钩子，不依赖"库的默认值恰好
  是这个"这件事在未来版本里保持不变。ADR-013 两台测试设备均确认
  `digest('SHA-512')` 可用（`digest('SHA-256')` 已测通，`SHA-512` 是
  WebCrypto 同一张算法注册表里的另一个条目，属于同一结论覆盖范围）。
- **`zip215: false`**：noble 的 `verify`/`verifyAsync` 默认按 ZIP215 规范
  （更宽松，接受部分非规范编码的签名）；本仓库全程用"RFC 8032"称呼这个
  算法（ADR-010/ADR-013、`tools/webcrypto-probe`），因此显式选 RFC 8032
  严格模式，不引入一个只有这个后端才认、`crypto.subtle` 后端不认的宽松
  接受面。本仓库所有真实签名都来自 `tools/schema-cli` 自己的签发流程
  （Node `crypto.sign('ed25519', ...)`），只产出规范编码，严格模式不会
  拒绝任何合法签名。
- **`packages/schema-registry/src/verify.ts` 只改注释**：`Ed25519Verifier`
  接口本身、`VerifyBundleOptions.verifier` 可选字段、`SubtleCryptoEd25519Verifier`
  实现都是 ADR-013 就定好的，本片不改一行逻辑代码——这正是可插拔端口
  设计的意义所在。

## 测试

`noble-verifier.test.ts`：RFC 8032 §7.1 TEST 1 正例、篡改签名、篡改消息、
错误公钥（后者用 `@noble/ed25519` 自己的 `utils.randomPrivateKey()` +
`getPublicKeyAsync()` 现场生成一个无关但合法的公钥，不手抄第二组固定
向量——抄错会产出一个不在曲线上的"公钥"，导致用例因为"输入格式非法"
而失败，而不是因为想测的"公钥不对"）；另加两条一致性用例，断言
`NobleEd25519Verifier` 与 `SubtleCryptoEd25519Verifier` 对同一真实输入
（含篡改后的输入）给出相同结论——Node 本身两个后端都支持（ADR-013
执行计划基线已确认），这条用例能在本机直接跑，不需要真机。

## 真机复验（退出条件 7）

`Medium_Phone_API_35` 模拟器：真实构建（测试更新源指向 `apps/web/public/`
下两个用 `tools/schema-cli` 同款真实签名流程生成的临时 Bundle，同源、
不需要 `adb reverse`）+ `cap sync` + `assembleDebug` + 安装，通过
`chrome://inspect` 同款的 WebView DevTools Protocol（`adb forward` 转发
`webview_devtools_remote_<pid>` 抽象 socket）直接对页面下 JS 命令，比
`adb shell input tap` 靠坐标猜测更精确、也更适合脚本化。

**先确认这台设备真的不支持原生 Ed25519**：`crypto.subtle.importKey('raw', ..., {name:'Ed25519'}, ...)`
直接抛 `NotSupportedError: Algorithm: Unrecognized name`——与 ADR-013 对这个
Chrome 版本区间（124，介于 110 与 137 之间）的预判一致。

**四步状态迁移全部通过 UI 文案确认，与 v0.6.0 #0 桌面复验同一验收口径**：
①首次安装（`builtin`/`0.5.0` → `android-e2e`/`0.9.0`，"安装成功，已切换到
新版本"）；②二次安装（→ `0.9.1`，"没有可回滚的历史版本"文案消失，回滚
按钮可用）；③回滚（→ `0.9.0`，"已回滚到上一版本"）。第一步安装成功本身
就是结论：这台设备的原生后端已经确认不可用，安装能走通只能是
`NobleEd25519Verifier` 真的验证了一次真实签名。

**复验过程中意外发现的一个真实 bug**：`packages/schema-registry/src/updater.ts`
的 `${source.fileBaseUrl}/${entry.path}` 无条件拼接一个 `/`——第一次用带
末尾斜杠的 `fileBaseUrl` 测试时产出双斜杠 URL，静态资源服务器上直接
404（"下载 Bundle 失败"）。核实后这是**测试夹具自己的用法错误**，不是
生产代码的 bug：`fileBaseUrl` 的隐含约定就是不带末尾斜杠，去掉后问题
消失。记录在此是因为这条约定目前只活在这一行拼接逻辑里，没有写进
`BundleSource` 类型的文档注释——真发生过一次真实的踩坑，值得挂在这里
而不是让下一次踩到同一个坑的人从头猜。

**另一个更值得记录的发现**：用 `VAR='...json...' pnpm --filter @mcs/web run build`
这种"命令前内联环境变量"的写法在本机 Git Bash 上，`MCS_BUNDLE_UPDATE_SOURCES_JSON`
这类含花括号的 JSON 值经过 bash → pnpm → vite 的多层进程转发后，构建产物
里的字符串**多出一个 `}`**（`}}` 变成 `}}}`），导致 `JSON.parse` 在运行时
静默失败（`resolveUpdateSources`/`parseOverride` 都设计成"解析失败就返回
空结果"，不抛错——这个设计本身是对的，代价是这类 corruption 不会在构建期
或启动时报错，只会表现成"更新源好像没配置"）。改用 v0.6.0 #0 同款方法论
（Node 脚本内直接 `process.env.X = ...` 后调用 Vite 的 `build()`/`createServer()`
API，不经过 shell 做多层环境变量转发）后问题消失。两次真机复验（本片、
#0）都在 shell 与 Node 之间的环境变量传递上踩了不同的坑，指向同一个结论：
**任何需要真实值精确无损传递的构建期配置，一律走 Node 脚本直调 Vite API，
不依赖 shell 内联环境变量或 `.claude/launch.json` 的 shell 解析。**

复验用的临时文件（测试签名 Bundle、CDP 辅助脚本、Node 直调构建脚本）均已
在复验完成后删除，不进入提交；复验完毕已重新执行一次不带测试更新源的
正常 `pnpm run build`，`dist/` 恢复到生产配置状态。

## 结果

- ADR-013「结果」节的待兑现项关闭：纯 JS Ed25519 回退已落地，联网 Bundle
  更新在两台已知不支持 `crypto.subtle` Ed25519 的目标 WebView 上可用。
- `packages/schema-registry` 保持零 `@noble/*` 依赖；`apps/web` 新增一个
  精确版本锁定的运行时依赖，`no-network-egress` CI job 覆盖面不变（该
  依赖不发起任何网络调用，纯计算）。
- 未采用的做法：让 `packages/schema-registry` 直接依赖 `@noble/ed25519`
  并在其中做能力探测——这会让密码学库的选择渗透进这个包，破坏 ADR-013
  已经定好的"验证代码只依赖接口"边界；能力探测与后端选择留在 `apps/web`，
  与 SAF/分享/PWA 等其它平台适配代码放在同一层。

## 相关

- [ADR-013：Ed25519 验签后端——WebView 实测结论与可插拔端口](./ADR-013-ed25519-verifier-backend.md)
- [ADR-010：Bundle 签名算法与签名密钥托管](./ADR-010-bundle-signing-and-key-custody.md)
