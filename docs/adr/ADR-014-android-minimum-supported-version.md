# ADR-014：Android 最低支持版本冻结在 API 29（Android 10）

- 状态：Accepted
- 日期：2026-08-13
- 补充：[ADR-013](./ADR-013-ed25519-verifier-backend.md)
- 来源：PRD §11.4；v0.1.0 执行计划 #13（M0-5 技术验证）

## 背景

PRD §11.4 未给出 Android 最低支持版本的具体数字，`docs/upstream-divergences.md`
待核对项 4 将其列为「需原型性能测试后冻结」。本机可用的 Android 系统镜像下限是
android-29（Android 10）；更低版本没有镜像，若要冻结在更低版本必须先补镜像实测——
执行计划 #13 把这一点定为硬约束：**下限不能低于实际验证过的 API 级别**。

## 冻结依据：只看冷启动，不看 WebView Ed25519 结论

执行计划 #13 原表述是"同时看冷启动是否达标、以及 #6 的 WebView Ed25519 结论，
两者可能指向不同下限，取更高者"。这一表述在执行时被 ADR-013 的实测结果否定，
已在计划文件 #13 的实现要点中补充说明并采用新结论：ADR-013 证明 WebView 版本
与 Android OS 版本脱钩（`V14_API36_Large` 镜像的 Chrome 133 反而比
`Medium_Phone_API_29` 镜像的 Chrome 74 更新，却仍早于 Ed25519 落地版本 Chrome 110、
更早于默认开启版本 Chrome 137），抬高 API 下限不能换来支持 Ed25519 的 WebView。
因此 WebView Ed25519 结论**不作为本决策的输入**；ADR-013 已把该风险按可插拔
`Ed25519Verifier` 端口处理，与最低系统版本无关。

本决策唯一的性能输入是 NFR-PERF-01（首次可交互 < 2.5s）的冷启动基线。

### 测量方法

`adb shell am start -W -n studio.mihomoconfig.m0spike/.MainActivity`，每次测量前
先 `am force-stop` 确保是真冷启动（而非复用已驻留进程的热启动）；每台设备测 7 次
（高于计划要求的 5 次下限），取 `TotalTime` 中位数。**全部数据来自模拟器**（本机
无可用真机）；真机复测属 v0.6.0 范围，本结论只在"模拟器口径"下成立。

### 结果

| 设备                                       | Android / API | TotalTime 中位数（7 次） | WaitTime 中位数（7 次） | NFR-PERF-01 阈值 | 结果     |
| ------------------------------------------ | ------------- | ------------------------ | ----------------------- | ---------------- | -------- |
| `Medium_Phone_API_29`                      | 10 / 29       | 412ms                    | 412ms                   | < 2500ms         | **通过** |
| `V14_API36_Large`（`sdk_gphone64_x86_64`） | 16 / 36       | 586ms                    | 587ms                   | < 2500ms         | **通过** |

原始 7 次采样值（ms，TotalTime）：

- `Medium_Phone_API_29`：590、475、452、391、412、331、347
- `V14_API36_Large`：986、511、486、524、709、592、586

两台设备的中位数均远低于 2500ms 阈值（API 29 富余 83%，API 36 富余 77%），
没有性能理由把下限抬高到高于 API 29。

## 决策

Android 最低支持版本冻结在 **API 29（Android 10）**——本机已验证的最旧系统镜像，
同时也是执行计划 #13 定的硬约束下限。

## 结果

- `docs/upstream-divergences.md` 待核对项 4（Android 最低支持版本）：
  待核对 → **已关闭**，依据即本 ADR，注明模拟器口径。
- `docs/requirements-traceability.md` 的 `NFR-PERF-01` 行填入上表基线数字。
- v0.1.0 的 `apps/android` 是一次性技术验证 spike（v0.6.0 起替换为产品壳），
  其 `variables.gradle` 当前的 `minSdkVersion = 23` 是 Capacitor 默认模板值，
  不代表产品决策——spike 目的只是验证平台能力，minSdk 收紧到 29 留给 v0.6.0
  实现产品壳时处理，本片不改 spike 的 Gradle 配置。
- 未采用的做法：把 #6 的 WebView Ed25519 结论当作候选下限输入。已按 ADR-013
  的分析排除，理由见上文「冻结依据」；错误地绑定两者会得到一个对实际问题
  无效的"更安全"下限，掩盖 WebView Ed25519 需要走可插拔端口这一真正的应对措施。

## 相关

- [ADR-013：Ed25519 验签后端——WebView 实测结论与可插拔端口](./ADR-013-ed25519-verifier-backend.md)
- [v0.1.0 执行计划 #13](../releases/plans/v0.1.0.md)
