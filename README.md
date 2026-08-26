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

**M1（骨架与配置内核）已完成（v0.2.0）**：不安装任何 Schema 模块即可走通
「导入 → 原文编辑 → 差异 → 导出」完整闭环。**M2（Schema 表单与前半配置模块）
已完成（v0.3.0）**：六个 P0 模块（general/dns/sniffer/inbound/proxies/
proxy-providers）均有 Schema 驱动表单、Golden 往返测试与内置模板；全部退出条件见
[需求追踪表](docs/requirements-traceability.md)，切片记录见
[版本执行计划](docs/releases/plans/v0.3.0.md)。**M3（规则与图谱，v0.4.0）进行中**，
见[执行计划](docs/releases/plans/v0.4.0.md)。尚未发布可用版本。

## 仓库结构

```text
apps/
  web/                 Web、PWA、静态部署                     ✅ 三栏布局壳、导入/编辑/差异/导出闭环、Worker 边界（v0.2.0 全部切片）
  android/             Capacitor Android 壳与原生适配         🚧 M0-5 模拟器验证，Partial（真机推迟 v0.6.0）
packages/
  config-model/        领域实体、引用和项目模型               ✅ M0 已验证
  yaml-engine/         AST 解析、局部修改、序列化、差异        ✅ M0 已验证
  schema-core/         JSON Schema、UI Schema 和类型          ✅ M0 已验证
  schema-registry/     模块发现、依赖解析和版本选择           ✅ M0 已验证
  schema-builtin/      随应用发布的默认 Bundle                ✅ 磁盘 JSON 布局 + general 模块（v0.3.0 #6）
  form-renderer/       Schema 驱动表单与控件映射              ✅ M0 已验证
  validator/           语法、结构、语义、引用和安全检查        ✅ 骨架 + 流水线 + 1MB 导入基准（v0.2.0 #1-2、#16）
  migration/           声明式迁移计划与预览                    🚧 规划中（v0.5.0）
  graph/               引用索引、循环检测和关系图数据         ✅ M0 已验证
  templates/           模板定义与变量                          ✅ 四个内置模板（v0.3.0 #20、v0.4.0 #16）
  storage/             Web/Android 存储抽象                  ✅ 端口 + 内存/IndexedDB + 自动保存/快照裁剪（v0.2.0 #4-5）
  project-format/      .mcsproj 导入导出                     ✅ ZIP 往返 + 导出接线（v0.2.0 #6、#15）
  ui/                  通用 UI、主题与无障碍组件               ✅ 设计令牌 + 文字色层 + 对比度断言（v0.2.0 #7-8）
  test-fixtures/       官方样例、边界样例和 Golden Files      ✅ 含确定性大语料生成器（v0.2.0 #16）
tools/
  schema-cli/          Bundle 校验、签名、差异和发布           ✅ M0 已验证
  android-manifest-check/ Android 清单 VPN 权限断言（CI 强制） ✅ M0 已验证
  webcrypto-probe/     Ed25519 WebCrypto 可用性实测载体        ✅ M0 已验证（ADR-013）
  upstream-watch/      上游文档 / 示例变更监控                 🚧 规划中，未建
  core-test-runner/    Mihomo 配置测试矩阵                     ✅ v1.19.29 下载+校验+内核测试 + CI job（v0.3.0 #21）
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

`apps/web` 的开发服务器：

```bash
pnpm run dev
```

```bash
pnpm run build
```

## 文档

- [架构决策记录（ADR）](docs/adr/README.md)
- [设计系统](docs/design-system.md)
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
