# Mihomo Config Studio · Mihomo 配置工坊

> Schema-driven visual Mihomo configuration manager for Web and Android. Local-first, modular, and privacy-friendly.

面向 Web 与 Android 的、本地优先、Schema 驱动的 Mihomo 配置生成与管理工具。

## 这是什么，不是什么

**是**：一个图形化创建、导入、理解、校验、维护和导出 Mihomo YAML 配置的工具。

**不是**：

- ❌ 不运行 Mihomo 内核
- ❌ 不是代理 / VPN 客户端，不申请 Android VPNService 权限
- ❌ 不提供账号、云同步或在线配置托管
- ❌ 不通过项目服务器代抓订阅
- ❌ 不保证配置里的节点、DNS 或订阅实际可达

配置数据默认**只在本地处理**。订阅 URL、密码、UUID、证书和私钥不会被上传到任何服务器。

## 核心设计

| 设计           | 说明                                                                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| YAML 不失真    | 以 Document/CST 为可回写源，注释、键顺序、锚点、引号风格和**未知字段**全部保留（[ADR-003](docs/adr/ADR-003-yaml-document-ast.md)、[ADR-006](docs/adr/ADR-006-two-tier-writeback.md)） |
| Schema 驱动    | 字段知识放在版本化、签名的 Schema Bundle 里，与应用发布周期解耦（[ADR-002](docs/adr/ADR-002-declarative-schema-bundle.md)）                                                           |
| 版本明确       | 每个项目锁定兼容档案，应用或 Schema 更新**不会**自动迁移你的配置（[ADR-004](docs/adr/ADR-004-project-locks-compatibility-profile.md)）                                                |
| 不执行远程代码 | Schema Bundle 只能包含声明式数据，禁止 JavaScript / Wasm / 原生代码                                                                                                                   |

## 项目状态

**早期开发中（M0 技术风险验证阶段）**，尚未发布可用版本。

进度见 [需求追踪表](docs/requirements-traceability.md)。

## 仓库结构

```text
apps/
  web/                 Web、PWA、静态部署
  android/             Capacitor Android 壳与原生适配
packages/
  config-model/        领域实体、引用和项目模型
  yaml-engine/         AST 解析、局部修改、序列化、差异   ✅ M0 已验证
  schema-core/         JSON Schema、UI Schema 和类型
  schema-registry/     模块发现、依赖解析和版本选择
  schema-builtin/      随应用发布的默认 Bundle
  form-renderer/       Schema 驱动表单与控件映射
  validator/           语法、结构、语义、引用和安全检查
  migration/           声明式迁移计划与预览
  graph/               引用索引、循环检测和关系图数据
  templates/           模板定义与变量
  storage/             Web/Android 存储抽象
  project-format/      .mcsproj 导入导出
  ui/                  通用 UI、主题与无障碍组件
  test-fixtures/       官方样例、边界样例和 Golden Files ✅
tools/
  schema-cli/          Bundle 校验、签名、差异和发布
  upstream-watch/      上游文档 / 示例变更监控
  core-test-runner/    Mihomo 配置测试矩阵
```

## 本地开发

需要 Node.js ≥ 20.11 和 pnpm 10。

```bash
pnpm install
```

```bash
pnpm run check
```

`check` 依次执行类型检查、ESLint 与全部单元测试。单独运行：

```bash
pnpm run typecheck
```

```bash
pnpm run test
```

```bash
pnpm run test:coverage
```

## 文档

- [架构决策记录（ADR）](docs/adr/README.md)
- [版本执行计划](docs/releases/README.md)
- [需求追踪表](docs/requirements-traceability.md)
- [PRD 与上游行为差异记录](docs/upstream-divergences.md)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)

## 声明

本项目是社区工具，与 MetaCubeX 官方**无隶属或背书关系**。
Mihomo 名称和上游项目归其相应权利人所有。

本项目不提供、也不鼓励用于规避所在地区法律、平台限制或组织安全策略的功能。

## 许可证

[MIT](LICENSE)
