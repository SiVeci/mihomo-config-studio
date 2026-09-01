# 发布阻断项 → CI 映射（PRD §13.5）

本文件回答一个具体问题：PRD §13.5 列出的五条发布阻断项，哪些**由 CI 机器
回答**，哪些**仍然只能由人回答**。v0.9.0 #19 建立这份映射表，目的是让退出
条件 7（"五条阻断项全部由 CI 而非人工回答"）可以被直接核对，而不是靠印象。

**现状：4/5，退出条件 7 记 Partial，不宣告 Done。** 第五条（Android 保存/
重新打开可靠性）因决策 H3（[v0.9.0.md](releases/plans/v0.9.0.md) 决策表）
未进 CI，仍由本机模拟器人工执行 + 证据文件作证，不是机器在每次提交时自动
把关。想把这一条也转成机器回答，需要重开决策 H3（例如接受第三方 action 或
自托管带 KVM 的 runner），这本身是一个成本/收益取舍，不是本片能顺带解决的。

## 映射表

| #   | PRD §13.5 阻断项                                        | CI 表达                                                                                                                                                                                                                                                                                                                                                                      | 状态                     |
| --- | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ |
| 1   | 内置模板/模块示例/迁移结果未通过真实内核测试            | `.github/workflows/ci.yml` 的 `core-config-test` job（`stable` 轨阻断整条流水线；`beta` 轨 `continue-on-error: true`，只可见不阻断——两条轨道对应 ADR-031 的两套信任模型，`schema-release.yml` 判定发布资格时只认 `stable` 轨）                                                                                                                                               | 机器回答                 |
| 2   | 导入/导出丢失未知字段、注释或锚点                       | `check` job 新增的 **`Golden round-trip (release blocker)`** 步骤，单独跑 `packages/validator/src/golden.test.ts`（13 例）——原本混在 `Unit tests with coverage` 这一步 2000+ 个用例里，现在独立命名，失败时 GitHub Checks 列表直接显示是这一条阻断项                                                                                                                         | 机器回答                 |
| 3   | Bundle 携带可执行代码，或安装绕过签名校验               | `check` job 新增的 **`Schema static check (release blocker)`** 步骤，单独跑 `packages/schema-registry/src/static-check.test.ts`（v0.9.0 #17 从 `tools/schema-cli` 下沉迁移，扩展名允许清单/JSON 可执行内容检测/迁移操作码封闭集合）；`e2e-web` job 里 `e2e/update.spec.ts` 的 "rejects a Bundle signed by an untrusted key" 用例额外从真实浏览器安装流程验证签名校验确实拦截 | 机器回答                 |
| 4   | 敏感配置（密钥、订阅 URL 等）进入日志或未预期的网络请求 | `log-redaction` job（`apps/web/src` + `packages/**` 两遍扫描，禁止绕过 `@mcs/logging` 的直接 `console.*` 调用）+ `no-network-egress` job（`packages/**` 内网络调用必须落在固定允许清单内，且允许清单里那个文件不能带请求体）                                                                                                                                                 | 机器回答                 |
| 5   | Android 无法可靠保存并重新打开 YAML                     | `SafRoundTripTest.kt`（`connectedAndroidTest`，真实 UIAutomator）——**本机模拟器执行，未进 CI**（决策 H3：不引入第三方 action，不在无 KVM 的免费 runner 上跑模拟器），证据见 [v0.9.0-android-e2e-evidence.md](releases/plans/v0.9.0-android-e2e-evidence.md)（如实记录：四个场景中一个受阻于 UI 时序问题未能稳定通过，整体记 Partial）                                        | **仍由人回答 → Partial** |

## 为什么是"步骤"而不是新开两个 job

第 2、3 条选择在既有 `check` job 里新增两个命名步骤，而不是像第 1、4 条
那样开独立 job：这两个测试文件本来就是 `pnpm run test:coverage`（`check`
job 最后一步）会跑的内容，新增的步骤只是把它们**提前、单独再跑一次**，
让它们在失败时先于其余 2000+ 个用例报出来、名字直接说明是哪条阻断项。
开新 job 需要重复一遍 checkout/pnpm 安装的样板，对这两个已经很快的测试
文件而言不值得。

## 给 1.0 用

v1.0.0 版本文档的主题会是"发布阻断项清零"——那时候需要一份能逐条打勾的
清单，而不是重新翻一遍 PRD 和 CI 配置去确认状态。这份文件就是那份清单的
起点，后续版本只需要更新表格与状态，不需要重新设计映射方法。
