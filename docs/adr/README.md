# 架构决策记录（ADR）

每条记录描述一个决策、它的背景、结果和代价。已接受的决策不再反复讨论，
除非出现明确的技术证据证明其不可行——此时新增一条记录来 supersede 它，而不是原地改写。

| 编号                                                        | 标题                                                | 状态     | 来源            |
| ----------------------------------------------------------- | --------------------------------------------------- | -------- | --------------- |
| [ADR-001](./ADR-001-modular-monolith.md)                    | 采用模块化单体，不建设微服务                        | Accepted | PRD §17         |
| [ADR-002](./ADR-002-declarative-schema-bundle.md)           | 采用声明式 Schema Bundle 热更新                     | Accepted | PRD §17         |
| [ADR-003](./ADR-003-yaml-document-ast.md)                   | 以 YAML Document/AST 作为可回写源                   | Accepted | PRD §17         |
| [ADR-004](./ADR-004-project-locks-compatibility-profile.md) | 项目锁定兼容档案，更新不自动迁移                    | Accepted | PRD §17         |
| [ADR-005](./ADR-005-no-server-side-subscription-proxy.md)   | 不提供服务端订阅代理                                | Accepted | PRD §17         |
| [ADR-006](./ADR-006-two-tier-writeback.md)                  | 两级 YAML 回写策略（CST + AST）                     | Accepted | M0 技术验证     |
| [ADR-007](./ADR-007-source-only-workspace-packages.md)      | 工作区内部包直接导出 TypeScript 源码                | Accepted | M1 骨架         |
| [ADR-008](./ADR-008-interpreted-json-schema-validator.md)   | 自建解释型 JSON Schema 子集校验器                   | Accepted | M0 技术验证     |
| [ADR-009](./ADR-009-reference-model.md)                     | 引用模型：实体标识、引用分类与规则解析口径          | Accepted | M0 技术验证     |
| [ADR-010](./ADR-010-bundle-signing-and-key-custody.md)      | Bundle 签名算法与签名密钥托管                       | Accepted | PRD §19         |
| [ADR-011](./ADR-011-visual-design-system.md)                | 视觉设计令牌来源与应用层扩展                        | Accepted | M1 骨架         |
| [ADR-012](./ADR-012-first-stable-compatibility-profile.md)  | 首个 Stable 兼容档案锁定 v1.19.29                   | Accepted | PRD §19         |
| [ADR-013](./ADR-013-ed25519-verifier-backend.md)            | Ed25519 验签后端：WebView 实测结论与可插拔端口      | Accepted | M0 技术验证     |
| [ADR-014](./ADR-014-android-minimum-supported-version.md)   | Android 最低支持版本冻结在 API 29                   | Accepted | M0 技术验证     |
| [ADR-015](./ADR-015-release-channel-and-license.md)         | 发布渠道仅 GitHub Releases；许可证 MIT              | Accepted | PRD §19         |
| [ADR-016](./ADR-016-ui-language-scope.md)                   | 界面语言范围：1.0 简体中文 + 完整英文 i18n 结构     | Accepted | PRD §19         |
| [ADR-017](./ADR-017-text-bearing-color-layer.md)            | 文字承载色层：覆盖 canvas 与 surface-card 两个底色  | Accepted | v0.2.0 骨架     |
| [ADR-018](./ADR-018-mcsproj-container.md)                   | `.mcsproj` 容器格式：零依赖手写 ZIP，确定性字节输出 | Accepted | v0.2.0 骨架     |
| [ADR-019](./ADR-019-discriminated-union-control.md)         | 判别式联合的 `variant` 控件                         | Accepted | v0.3.0 先决项 1 |

ADR-001 至 ADR-005 直接来自 PRD §17，本仓库补全其背景与工程约束。
ADR-006 起为实施阶段新增的决策。
