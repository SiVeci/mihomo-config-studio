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
proxy-providers）均有 Schema 驱动表单、Golden 往返测试与内置模板。**M3（规则与
图谱）已完成（v0.4.0）**：剩余四个 P0 模块（proxy-groups/rule-providers/rules/
sub-rules）补齐，规则列表（重排、批量操作）、关系图（导航、环路、异常关系筛选）、
1,000 实体+10,000 规则规模下的虚拟化与性能基准均已交付；全部退出条件见
[需求追踪表](docs/requirements-traceability.md)，切片记录见
[版本执行计划](docs/releases/plans/v0.4.0.md)。**M4（Bundle 更新、签名、迁移与
回滚，v0.5.0）已收口**：Stable/Beta 双通道、三类否定用例、迁移引擎（预览+执行同一份
`MigrationPlan`+快照+隔离区）、项目升级 UI、缺失 Bundle 只读保护、`schema-cli`
完整化均已交付并有真实测试证据；十条退出条件 9 项 Done、1 项 Partial（发布工作流
本身与 [ADR-024](docs/adr/ADR-024-single-maintainer-release-approval.md) 已就位，
真实签发与审批拦截验证需要 GitHub Environment/生产密钥两项先决项由用户在网页侧
完成后才能执行），如实记录不宣告，见[需求追踪表](docs/requirements-traceability.md)
与[版本执行计划](docs/releases/plans/v0.5.0.md)。**M5（Android 集成与 PWA，
v0.6.0）已收口（Partial）**：产品 Android 壳、PWA 离线、生命周期恢复、存储压力
降级、Ed25519 纯 JS 回退、冷启动基线、接收其他应用分享（FR-AND-07，可选）均已
交付并有真机（模拟器）验证证据；十一条退出条件 9 项 Done，1 项 Partial（SAF
交互式流程未验证），1 项（GitHub Releases 发布）按用户明确决定本次收口不等待
——发布工作流本身已就绪，真实推送与密钥配置留给用户完成。如实记录不宣告，见
[需求追踪表](docs/requirements-traceability.md)、
[版本执行计划](docs/releases/plans/v0.6.0.md)与
[真机验证记录](docs/releases/plans/v0.6.0-android-evidence.md)。**M6（发布加固与
P1 功能收尾，v0.9.0）已收口（Partial）**：CI 首次真实推送并全绿、内核测试矩阵扩到
模块示例与迁移结果并加 Beta 轨、严格 CSP、日志脱敏、Web/更新 E2E 线、性能预算 CI
阻断、WCAG 2.2 AA 走查、敏感字段遮罩全量走查、项目标签搜索、可关闭警告规则、静态
规则解释器、手动导入社区 Bundle（未受信任持续警告）、`schema-cli preview`、PRD
§13.5 五条发布阻断项的 CI 映射均已交付；九条退出条件 4 项 Done，5 项 Partial——其中
四项（内核 Beta 轨/模块示例、E2E 三线、性能阻断、§13.5 映射）同出一个已知代价
（决策 H3：Android 线不进 CI，`origin/main` 自身也只被真实推送过一次，多数验证仍是
本机结构性证据），第五项（公开 Beta 发布）真正卡在用户尚未完成的 GitHub 网页侧
配置。如实记录不宣告，见[需求追踪表](docs/requirements-traceability.md)与
[版本执行计划](docs/releases/plans/v0.9.0.md)。**尚未发布可用版本。**

## 仓库结构

```text
apps/
  web/                 Web、PWA、静态部署                     ✅ 三栏布局壳、导入/编辑/差异/导出闭环、Worker 边界（v0.2.0）；+Schema 表单/规则列表/关系图（v0.3.0-v0.4.0）；+Bundle 管理/项目升级/只读保护 UI（v0.5.0 #10-#12）；+PWA 离线缓存、窄屏布局、生命周期恢复、存储压力降级、Ed25519 纯 JS 回退（v0.6.0 #6-#11）
  android/             Capacitor Android 壳与原生适配         ✅ 产品壳（appId `studio.mihomoconfig.app`、minSdk 29）+ 生命周期恢复、接收其他应用分享（FR-AND-07）；模拟器验证 Done、真机推迟（决策 G1）；GitHub Releases 发布留给用户（v0.6.0 #12）
packages/
  config-model/        领域实体、引用和项目模型               ✅ M0 已验证
  yaml-engine/         AST 解析、局部修改、序列化、差异        ✅ M0 已验证
  schema-core/         JSON Schema、UI Schema 和类型          ✅ M0 已验证
  schema-registry/     模块发现、依赖解析和版本选择           ✅ M0 已验证；+通道/双槽安装回滚/更新器/信任锚点（v0.5.0 #0-#4）
  schema-builtin/      随应用发布的默认 Bundle                ✅ 磁盘 JSON 布局 + general 模块（v0.3.0 #6）
  form-renderer/       Schema 驱动表单与控件映射              ✅ M0 已验证
  validator/           语法、结构、语义、引用和安全检查        ✅ 骨架 + 流水线 + 1MB 导入基准（v0.2.0 #1-2、#16）
  migration/           声明式迁移计划与预览                    ✅ 封闭操作码 + 契约装载 + 字段差异 + 执行器/快照/隔离区（v0.5.0 #5-#9，ADR-025）
  graph/               引用索引、循环检测和关系图数据         ✅ M0 已验证
  templates/           模板定义与变量                          ✅ 五个内置模板，全部接入内核测试矩阵（v0.3.0 #20、v0.4.0 #16-17）
  storage/             Web/Android 存储抽象                  ✅ 端口 + 内存/IndexedDB + 自动保存/快照裁剪（v0.2.0 #4-5）
  project-format/      .mcsproj 导入导出                     ✅ ZIP 往返 + 导出接线（v0.2.0 #6、#15）
  ui/                  通用 UI、主题与无障碍组件               ✅ 设计令牌 + 文字色层 + 对比度断言（v0.2.0 #7-8）
  logging/             日志/崩溃文本脱敏核心                  ✅ 零依赖纯函数 redact() + createLogger()，已在 apps/web/src、packages/** 全量接线（v0.9.0 #5/#6，NFR-SEC-03）
  test-fixtures/       官方样例、边界样例和 Golden Files      ✅ 含确定性大语料生成器（v0.2.0 #16）
tools/
  schema-cli/          Bundle 校验、签名、差异、发布和预览     ✅ `pack`/`check`/`diff`/`sign`/`preview` 子命令，迁移操作码封闭集合检查（v0.5.0 #13 ADR-025；`preview` 为 v0.9.0 #18，FR-SCHEMA-07）
  android-manifest-check/ Android 清单 VPN 权限断言（CI 强制） ✅ M0 已验证
  webcrypto-probe/     Ed25519 WebCrypto 可用性实测载体        ✅ M0 已验证（ADR-013）
  upstream-watch/      上游文档 / 示例变更监控                 ⏸ 改期 1.x（决策 H4，FR-UPD-08）
  core-test-runner/    Mihomo 配置测试矩阵                     ✅ v1.19.29 下载+校验+内核测试 + CI job（v0.3.0 #21）
  egress-check/        packages/** 出网白名单守卫（CI 强制）   ✅ 路径级+形态级双层校验，四条原否定用例保留（v0.5.0 #3）
  csp-check/           apps/web 构建产物严格 CSP 守卫（CI 强制） ✅ 策略/unsafe-eval/unsafe-inline/外部脚本四层核对，_headers 与 index.html 一致性（v0.9.0 #4，ADR-032）
  log-redaction-check/ 日志脱敏静态守卫（CI 强制）             ✅ 路径级白名单，拒绝 apps/web/src、packages/** 里未经 @mcs/logging 的直接 console.* 调用（v0.9.0 #6，NFR-SEC-03）
  perf-gate/           性能基准 CI 阻断（CI 强制）             ✅ NFR-PERF-02/03/04 中位数阈值，两条 CI 校准、两条 PRD 原始数字（v0.9.0 #10，ADR-034）
e2e/                   Playwright 端到端测试（独立于 vitest）  ✅ Web 线七场景：创建/导入/修改引用/规则排序/差异/导出/离线恢复（v0.9.0 #7，ADR-033）
```

## 本地开发

需要 Node.js ≥ 22.18 和 pnpm 10（版本下限的来由见
[ADR-030](docs/adr/ADR-030-minimum-node-baseline.md)）。

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

真实浏览器（Chromium）跑 Web 端到端测试——独立于 `check`，见
[ADR-033](docs/adr/ADR-033-e2e-layering.md)：

```bash
pnpm run e2e
```

## 文档

- [用户指南](docs/user-guide.md)
- [Schema 开发指南](docs/schema-authoring-guide.md)
- [架构决策记录（ADR）](docs/adr/README.md)
- [设计系统](docs/design-system.md)
- [版本执行计划](docs/releases/README.md)
- [需求追踪表](docs/requirements-traceability.md)
- [发布阻断项 → CI 映射](docs/release-blockers.md)
- [PRD 与上游行为差异记录](docs/upstream-divergences.md)
- [自托管部署头（CSP 等）](docs/self-hosting-headers.md)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)

## 声明

本项目是社区工具，与 MetaCubeX 官方**无隶属或背书关系**。
Mihomo 名称和上游项目归其相应权利人所有。

本项目不提供、也不鼓励用于规避所在地区法律、平台限制或组织安全策略的功能。

## 许可证

[MIT](LICENSE)
