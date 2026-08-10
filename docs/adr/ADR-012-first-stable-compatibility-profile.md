# ADR-012：首个 Stable 兼容档案锁定 Mihomo v1.19.29

- 状态：Accepted
- 日期：2026-08-10
- 补充：[ADR-004](./ADR-004-project-locks-compatibility-profile.md)
- 来源：PRD §19 待冻结事项 2

## 背景

ADR-004 决定每个项目锁定一个兼容档案，但首个 Stable 档案对应哪个 Mihomo 版本一直
挂在 PRD §19 与 `upstream-divergences.md` 的待核对项里。这个值不确定，下列工作全部
无法开始：

- `CompatibilityProfile.coreRange` 没有初值。
- `schema-builtin` 的 manifest 填不出 `mihomo.minVersion` / `maxTestedVersion` /
  `upstreamCommit` / `docsSnapshot`。
- `core-test-runner` 不知道该下载哪个内核二进制。
- §8.3 的 P0 出站协议字段集合没有权威比对对象。

## 决策

首个 Stable 兼容档案锁定 **Mihomo v1.19.29**。

| 落点                     | 内容                                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| `config-model`           | `CompatibilityProfile.coreRange` 首值 = `v1.19.29`                                                                                     |
| `schema-builtin`         | manifest 的 `mihomo.minVersion` 与 `maxTestedVersion` = `v1.19.29`；`upstreamCommit` 填该 tag 的 commit SHA；`docsSnapshot` 填核对日期 |
| `tools/core-test-runner` | CI 固定下载 v1.19.29 二进制并**校验官方 checksum** 后运行配置测试                                                                      |
| `tools/upstream-watch`   | 以 v1.19.29 为 diff 基线监控上游文档与完整示例变化（FR-UPD-08）                                                                        |
| Beta 通道                | 跟随上游最新版本，开发中字段只进 Beta Bundle（PRD §13.3）                                                                              |

## 结果

- §19 待冻结事项 2 关闭，`upstream-divergences.md` 的待核对项 1 关闭。
- 派生两项前置任务，必须在对应版本开工前完成，否则 Schema 缺少权威依据：
  - **M2 前**：对照 v1.19.29 的 `docs/config.yaml` 冻结 §8.3 的 P0 出站协议字段集合。
  - **M3 前**：在 v1.19.29 上核实 `rule-providers` 的 `format: mrs` 对 `behavior` 的取值约束。
- 本 ADR 只冻结版本号，**未核实 v1.19.29 的具体发布内容**。按既有规则，当 PRD 与
  Mihomo 实际行为冲突时以官方行为为事实依据，差异记入 `upstream-divergences.md`，
  不得静默修改需求。
- 代价：Stable 通道会滞后于上游。这是 ADR-004 的既定取舍——项目锁定档案，应用或
  Schema 更新不自动迁移用户配置。
