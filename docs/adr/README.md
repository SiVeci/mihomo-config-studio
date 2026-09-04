# 架构决策记录（ADR）

每条记录描述一个决策、它的背景、结果和代价。已接受的决策不再反复讨论，
除非出现明确的技术证据证明其不可行——此时新增一条记录来 supersede 它，而不是原地改写。

| 编号                                                                | 标题                                                              | 状态     | 来源            |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- | -------- | --------------- |
| [ADR-001](./ADR-001-modular-monolith.md)                            | 采用模块化单体，不建设微服务                                      | Accepted | PRD §17         |
| [ADR-002](./ADR-002-declarative-schema-bundle.md)                   | 采用声明式 Schema Bundle 热更新                                   | Accepted | PRD §17         |
| [ADR-003](./ADR-003-yaml-document-ast.md)                           | 以 YAML Document/AST 作为可回写源                                 | Accepted | PRD §17         |
| [ADR-004](./ADR-004-project-locks-compatibility-profile.md)         | 项目锁定兼容档案，更新不自动迁移                                  | Accepted | PRD §17         |
| [ADR-005](./ADR-005-no-server-side-subscription-proxy.md)           | 不提供服务端订阅代理                                              | Accepted | PRD §17         |
| [ADR-006](./ADR-006-two-tier-writeback.md)                          | 两级 YAML 回写策略（CST + AST）                                   | Accepted | M0 技术验证     |
| [ADR-007](./ADR-007-source-only-workspace-packages.md)              | 工作区内部包直接导出 TypeScript 源码                              | Accepted | M1 骨架         |
| [ADR-008](./ADR-008-interpreted-json-schema-validator.md)           | 自建解释型 JSON Schema 子集校验器                                 | Accepted | M0 技术验证     |
| [ADR-009](./ADR-009-reference-model.md)                             | 引用模型：实体标识、引用分类与规则解析口径                        | Accepted | M0 技术验证     |
| [ADR-010](./ADR-010-bundle-signing-and-key-custody.md)              | Bundle 签名算法与签名密钥托管                                     | Accepted | PRD §19         |
| [ADR-011](./ADR-011-visual-design-system.md)                        | 视觉设计令牌来源与应用层扩展                                      | Accepted | M1 骨架         |
| [ADR-012](./ADR-012-first-stable-compatibility-profile.md)          | 首个 Stable 兼容档案锁定 v1.19.29                                 | Accepted | PRD §19         |
| [ADR-013](./ADR-013-ed25519-verifier-backend.md)                    | Ed25519 验签后端：WebView 实测结论与可插拔端口                    | Accepted | M0 技术验证     |
| [ADR-014](./ADR-014-android-minimum-supported-version.md)           | Android 最低支持版本冻结在 API 29                                 | Accepted | M0 技术验证     |
| [ADR-015](./ADR-015-release-channel-and-license.md)                 | 发布渠道仅 GitHub Releases；许可证 MIT                            | Accepted | PRD §19         |
| [ADR-016](./ADR-016-ui-language-scope.md)                           | 界面语言范围：1.0 简体中文 + 完整英文 i18n 结构                   | Accepted | PRD §19         |
| [ADR-017](./ADR-017-text-bearing-color-layer.md)                    | 文字承载色层：覆盖 canvas 与 surface-card 两个底色                | Accepted | v0.2.0 骨架     |
| [ADR-018](./ADR-018-mcsproj-container.md)                           | `.mcsproj` 容器格式：零依赖手写 ZIP，确定性字节输出               | Accepted | v0.2.0 骨架     |
| [ADR-019](./ADR-019-discriminated-union-control.md)                 | 判别式联合的 `variant` 控件                                       | Accepted | v0.3.0 先决项 1 |
| [ADR-020](./ADR-020-builtin-bundle-layout-and-reissue.md)           | 内置 Bundle 的磁盘布局与再签发口径                                | Accepted | v0.3.0 切片 #6  |
| [ADR-021](./ADR-021-declarative-rule-type-catalog.md)               | 声明式规则类型目录                                                | Accepted | v0.4.0 切片 #3  |
| [ADR-022](./ADR-022-self-built-virtualization-and-graph.md)         | 虚拟化与关系图一律自建，不引入新运行时依赖                        | Accepted | v0.4.0 切片 #7  |
| [ADR-023](./ADR-023-atomic-batch-edit.md)                           | 批量编辑是一次原子写入，不是合并窗口                              | Accepted | v0.4.0 切片 #10 |
| [ADR-024](./ADR-024-single-maintainer-release-approval.md)          | 单维护者仓库下的发布审批偏离（补充 ADR-010 §2）                   | Accepted | v0.5.0 切片 #14 |
| [ADR-025](./ADR-025-declarative-migration-opcodes.md)               | 声明式迁移操作码的封闭集合                                        | Accepted | v0.5.0 切片 #5  |
| [ADR-026](./ADR-026-platform-capability-port.md)                    | 平台能力端口与单一 Web 构建产物                                   | Accepted | v0.6.0 切片 #2  |
| [ADR-027](./ADR-027-minimum-webview-baseline.md)                    | 最低 WebView/浏览器基线与启动能力门                               | Accepted | v0.6.0 切片 #1  |
| [ADR-028](./ADR-028-pure-js-ed25519-backend.md)                     | 纯 JS Ed25519 验签后端（`@noble/ed25519`）                        | Accepted | v0.6.0 切片 #10 |
| [ADR-029](./ADR-029-service-worker-cache-strategy.md)               | 自建 Service Worker 与缓存版本策略                                | Accepted | v0.6.0 切片 #7  |
| [ADR-030](./ADR-030-minimum-node-baseline.md)                       | 开发与 CI 的最低 Node 版本抬到 22.18                              | Accepted | v0.9.0 切片 #1  |
| [ADR-031](./ADR-031-kernel-matrix-dual-track.md)                    | 内核测试矩阵的双轨口径与 Beta 轨 digest 信任降级                  | Accepted | v0.9.0 切片 #3  |
| [ADR-032](./ADR-032-strict-csp-layering.md)                         | 严格 CSP 的分层口径与部署头交付形态                               | Accepted | v0.9.0 切片 #4  |
| [ADR-033](./ADR-033-e2e-layering.md)                                | Playwright 端到端测试的分层与被测对象                             | Accepted | v0.9.0 切片 #7  |
| [ADR-034](./ADR-034-perf-ci-gating.md)                              | 性能基准的 CI 阻断阈值，与"阈值对着什么硬件说"                    | Accepted | v0.9.0 切片 #10 |
| [ADR-035](./ADR-035-relative-import-extensions-for-node-runtime.md) | 内部相对导入改用字面 `.ts` 扩展名，修复裸 Node 对多文件包的解析   | Accepted | v0.9.0 切片 #2  |
| [ADR-036](./ADR-036-minimum-version-two-tier.md)                    | 最低支持版本的双口径：安装下限（API 29）与运行下限（WebView 107） | Accepted | v1.0.0 切片 #1  |
| [ADR-037](./ADR-037-import-corpus-and-success-rate.md)              | 1 MB 导入成功率的语料集构成与判据（N=30，零阻断失败）             | Accepted | v1.0.0 切片 #3  |

ADR-001 至 ADR-005 直接来自 PRD §17，本仓库补全其背景与工程约束。
ADR-031–034 编号由 `docs/releases/plans/v0.9.0.md` 预先分配给切片 #3/#4/#7/#10；
ADR-035 是 #2 执行过程中新增、未被计划预留编号的决策，编号从 030 之后顺延，
避免与那四条预留号冲突。
ADR-006 起为实施阶段新增的决策。
