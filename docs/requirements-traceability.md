# 需求追踪表

状态口径（与"质量要求"一致，未满足者一律记为未完成）：

- **Done** —— 已实现，且类型检查、单元测试/端到端测试通过，有可复现的验证证据。
- **Partial** —— 已实现一部分，缺口在"证据 / 缺口"列写明。
- **Todo** —— 尚未开始。

> 本表随每个垂直切片更新。任何标记为 Done 的行都必须能指向具体测试文件。

最近一次核对：2026-08-11。`pnpm run test:coverage` 150 例全绿，行覆盖率 93.94%。

> 本表目前只覆盖 PRD §8.1、8.2、8.4、8.5、8.6、8.7、8.9、8.10 与 §11。
> §8.3 配置模块覆盖、§8.8 模板、§8.11 订阅地址管理尚未建行，需在 M2 开始前补齐。

## 里程碑映射

| 本仓库阶段        | PRD 里程碑 | 状态                      |
| ----------------- | ---------- | ------------------------- |
| M0 技术风险验证   | PRD M0     | 进行中（5 项中 3 项通过） |
| M1 骨架与配置内核 | PRD M1     | 进行中                    |
| M2 及以后         | PRD M2–M7  | 未开始                    |

## M0 退出条件

| #    | 验证项                   | 状态     | 证据 / 缺口                                                                                                                                                                                                                                                                                                                               |
| ---- | ------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M0-1 | YAML AST 无损 Round-trip | **Done** | `packages/yaml-engine/src/document.test.ts`（26 例）、`diff.test.ts`（6 例）、`path.test.ts`（5 例）                                                                                                                                                                                                                                      |
| M0-2 | Schema 驱动表单          | **Done** | `packages/schema-core/src/form-plan.test.ts`（13 例）、`condition.test.ts`（11 例）、`validate.test.ts`（19 例）、`packages/form-renderer/src/index.test.tsx`（9 例）。核心风险由「renders a brand-new field with no UI entry and no page code change」与「renders a field added by a bundle update with no renderer change」两例直接证明 |
| M0-3 | 引用模型与关系图         | **Done** | `packages/config-model/src/entity.test.ts`（12 例）、`rule-line.test.ts`（14 例）、`packages/graph/src/reference-index.test.ts`（15 例）、`impact.test.ts`（9 例）、`cycles.test.ts`（9 例）。ADR-009 记录实体标识策略、引用类型分类与规则解析口径来源                                                                                    |
| M0-4 | Schema Bundle 校验与回滚 | Todo     | 需要 `schema-registry` 与 `tools/schema-cli`；签名算法与密钥托管已冻结（[ADR-010](./adr/ADR-010-bundle-signing-and-key-custody.md)）                                                                                                                                                                                                      |
| M0-5 | Android 文件能力         | Todo     | 需要 `apps/android`；Android 最低支持版本待本项验证后冻结                                                                                                                                                                                                                                                                                 |

## 功能需求

### 8.1 项目管理

| ID         | 优先级 | 状态 | 证据 / 缺口                      |
| ---------- | ------ | ---- | -------------------------------- |
| FR-PROJ-01 | P0     | Todo | 依赖 `config-model`、`apps/web`  |
| FR-PROJ-02 | P0     | Todo | 依赖 `storage`                   |
| FR-PROJ-03 | P0     | Todo | 依赖 `storage`、`apps/web`       |
| FR-PROJ-04 | P0     | Todo | 依赖 `config-model` 的统一历史栈 |
| FR-PROJ-05 | P0     | Todo | 依赖 `storage`                   |
| FR-PROJ-06 | P0     | Todo | 依赖 `project-format`            |
| FR-PROJ-07 | P1     | Todo |                                  |

### 8.2 YAML 导入、编辑与导出

| ID         | 优先级 | 状态     | 证据 / 缺口                                                                                                                                                                                                                                                                                                              |
| ---------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-YAML-01 | P0     | Todo     | 引擎已就绪，缺少文件/剪贴板入口（依赖 `apps/web`）                                                                                                                                                                                                                                                                       |
| FR-YAML-02 | P0     | **Done** | `document.test.ts`「keeps comments, anchors and unknown fields after an edit」「appends a rule while retaining unknown fields」；表单侧另有 `form-plan.test.ts`「surfaces a value no schema property describes instead of ignoring it」与 `index.test.tsx`「surfaces an unknown field read-only instead of dropping it」 |
| FR-YAML-03 | P0     | **Done** | `document.test.ts`「reproduces an untouched document byte for byte」「confines a scalar edit to the edited line」「preserves flow style…」「preserves block scalars around an edit」                                                                                                                                     |
| FR-YAML-04 | P0     | Todo     | 需要编辑器组件；引擎侧 `locate()` 已提供行列定位                                                                                                                                                                                                                                                                         |
| FR-YAML-05 | P0     | Partial  | 引擎已提供 `hasSyntaxErrors` 用于冻结结构化视图；UI 未实现                                                                                                                                                                                                                                                               |
| FR-YAML-06 | P0     | Partial  | `diffLines()` 已实现并测试；UI 面板未实现                                                                                                                                                                                                                                                                                |
| FR-YAML-07 | P0     | Todo     |                                                                                                                                                                                                                                                                                                                          |
| FR-YAML-08 | P1     | Partial  | `SerializeOptions` 已支持 lineWidth/indent；其余偏好未实现                                                                                                                                                                                                                                                               |

### 8.4 Schema 驱动表单

| ID           | 优先级 | 状态     | 证据 / 缺口                                                                                                                                                                                                                                                                                                                             |
| ------------ | ------ | -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-SCHEMA-01 | P0     | **Done** | `form-plan.test.ts`「plans every declared property with values from the document」「resolves $ref and plans nested object children」；`index.test.tsx`「renders a control per planned field, chosen from the schema」                                                                                                                   |
| FR-SCHEMA-02 | P0     | Partial  | 字符串、数字、布尔、枚举、列表、映射、密钥、嵌套对象已覆盖（`form-plan.test.ts`「derives a control for every supported shape without UI metadata」）。**联合类型未实现**：`inferControl` 无 `oneOf`/`anyOf` 分支，判别式联合落入 `unknown` 控件，直接阻塞 §8.3 的九种 P0 出站协议                                                       |
| FR-SCHEMA-03 | P0     | Partial  | `visibleWhen`/`requiredWhen`、默认值、范围、正则已实现（`form-plan.test.ts`「applies visibleWhen and requiredWhen against sibling values」、`condition.test.ts` 11 例、`validate.test.ts`「checks enum, const and numeric bounds」「checks string length, pattern and format」）。互斥与跨字段依赖缺 `validation.rules` DSL（PRD §9.3） |
| FR-SCHEMA-04 | P0     | Partial  | `UiFieldSpec` 已定义 `docs`/`platforms`/`since`/`deprecatedSince`/`safety`，`form-renderer/src/index.tsx` 已渲染官方文档链接与废弃/实验/危险徽章；仅 `platforms` 有断言（`form-plan.test.ts`「hides platform-restricted fields on other platforms」），其余元数据缺测试                                                                 |
| FR-SCHEMA-05 | P0     | Partial  | 渲染侧不含任何字段专属代码路径已证明（`index.test.tsx` describe「SchemaForm (FR-SCHEMA-01, FR-SCHEMA-05)」）；模块发现、依赖解析与版本选择的 `schema-registry` 尚未建立                                                                                                                                                                 |
| FR-SCHEMA-06 | P0     | **Done** | `form-plan.test.ts`「renders a brand-new field with no UI entry and no page code change」；`index.test.tsx`「renders a field added by a bundle update with no renderer change」                                                                                                                                                         |
| FR-SCHEMA-07 | P1     | Todo     | 需要 `tools/schema-cli`                                                                                                                                                                                                                                                                                                                 |

### 8.5 引用与关系管理

| ID        | 优先级 | 状态     | 证据 / 缺口                                                                                                                                                                                                                                                                                                                                                                                        |
| --------- | ------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-REL-01 | P0     | **Done** | `packages/config-model/src/entity.test.ts`（12 例）：对 `comprehensive.yaml` 提取出 3 个 proxy、3 个 proxy-group、2 个 proxy-provider、2 个 rule-provider、10 条 rule；`renameKeyIn`/`setScalarIn` 改名后 `id` 不变；导出文本不含任何 `id` 字面量。内置目标（`DIRECT`/`REJECT`/`REJECT-DROP`/`COMPATIBLE`/`PASS`/`PASS-RULE`，以及未被用户覆盖时的 `GLOBAL`）作为预置实体一并纳入。ADR-009 §1      |
| FR-REL-02 | P0     | **Done** | `packages/config-model/src/rule-line.test.ts`（14 例，风险核心：规则字符串子片段偏移定位）+ `packages/graph/src/reference-index.test.ts`（15 例）：对 `comprehensive.yaml` 四组改名（`PROXY→PROXY-MAIN`、`provider-a→prov-a`、`cn-domain→cn-dom`、`AUTO→AUTO-URL`）用 `diffLines()` 断言变更行集合恰好等于预期集合，同名路径子串所在行字节不变；改名后 `anchors()` 与 flow 风格不变。ADR-009 §2/§3 |
| FR-REL-03 | P0     | **Done** | `packages/graph/src/impact.test.ts`（9 例）：`{replaceable, cascading}` 判定——规则 target/payload 与不会清空所属组的 `proxies[]`/`use[]` 项判为可替换；移除后代理组 `proxies` 与 `use` 同时为空则该组级联删除并递归展开，下游组仍有其它成员时正确止步                                                                                                                                              |
| FR-REL-04 | P0     | Todo     | 关系图可视化 UI，属 v0.4.0；`packages/graph` 已提供其所需的引用索引、影响分析与循环检测数据                                                                                                                                                                                                                                                                                                        |
| FR-REL-05 | P0     | **Done** | `packages/graph/src/cycles.test.ts`（9 例）：代理组互嵌（`group-mutual.yaml`：A→B→A）与 `dialer-proxy` 链路（`dialer-chain.yaml`：A→B→C→A，另有 D 拨入环内验证尾巴不被误报）两类边的 DFS 循环检测，返回环路节点序列而非布尔值；`comprehensive.yaml` 验证不误报                                                                                                                                     |
| FR-REL-06 | P1     | Todo     | 图上导航与筛选，依赖 FR-REL-04 的关系图 UI，属 v0.4.0                                                                                                                                                                                                                                                                                                                                              |

### 8.6 规则编辑器

| ID                     | 优先级 | 状态    | 证据 / 缺口                                       |
| ---------------------- | ------ | ------- | ------------------------------------------------- |
| FR-RULE-02             | P0     | Partial | `moveSeqItem()` 已实现并测试不丢项；UI 拖拽未实现 |
| FR-RULE-01/03/04/05/06 | P0/P1  | Todo    |                                                   |

### 8.7 校验与问题中心

| ID        | 优先级 | 状态     | 证据 / 缺口                                                                                                                                                                                                                                                                                                                                          |
| --------- | ------ | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-VAL-01 | P0     | Partial  | `YamlIssue`（severity/code/message/path/range）与 `SchemaIssue`（severity/code/keyword/path/message）并存且尚未统一；两者都缺 PRD §8.7 要求的 `module` 与 `fix`，`SchemaIssue` 另缺行列 `range`                                                                                                                                                      |
| FR-VAL-02 | P0     | Partial  | `MihomoYamlDocument#locate()` 已测试；跳转 UI 未实现                                                                                                                                                                                                                                                                                                 |
| FR-VAL-03 | P0     | Todo     | 依赖 `graph` 与 `validator`                                                                                                                                                                                                                                                                                                                          |
| FR-VAL-04 | P0     | Todo     | 依赖 `validator` 的安全检查阶段                                                                                                                                                                                                                                                                                                                      |
| FR-VAL-05 | P0     | **Done** | `form-plan.test.ts`「surfaces a value no schema property describes instead of ignoring it」「masks an unknown field whose name looks like a credential」；`validate.test.ts`「reports but does not escalate an undeclared field when additionalProperties is false」；`index.test.tsx`「surfaces an unknown field read-only instead of dropping it」 |
| FR-VAL-06 | P1     | Todo     |                                                                                                                                                                                                                                                                                                                                                      |

### 8.9 版本与 Schema Bundle 管理

| ID             | 优先级 | 状态 | 证据 / 缺口                                                                                                                                                                                  |
| -------------- | ------ | ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-UPD-01 … 09 | P0/P1  | Todo | M0-4。前置决策已冻结：签名算法与密钥托管见 [ADR-010](./adr/ADR-010-bundle-signing-and-key-custody.md)，首个 Stable 兼容档案见 [ADR-012](./adr/ADR-012-first-stable-compatibility-profile.md) |

### 8.10 Android 能力

| ID             | 优先级 | 状态 | 证据 / 缺口             |
| -------------- | ------ | ---- | ----------------------- |
| FR-AND-01 … 07 | P0/P1  | Todo | M0-5，需 `apps/android` |

## 非功能需求

| ID                    | 状态               | 证据 / 缺口                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| NFR-PERF-01 … 05      | Todo               | 需要 `apps/web` 与真机基线                                                                                                                                                                                                                                                                                                                                                                                                                           |
| NFR-REL-01 … 05       | Todo               | 依赖 `storage` / `project-format`                                                                                                                                                                                                                                                                                                                                                                                                                    |
| NFR-SEC-01            | **Done（结构性）** | 代码库中不存在任何网络上传路径；`.github/workflows/ci.yml` 的 `no-network-egress` job 已强制。注意：该检查目前全禁 `packages/**` 出网，M4 引入 Bundle 下载时必须改为白名单                                                                                                                                                                                                                                                                           |
| NFR-SEC-02            | **Done（表单层）** | `form-plan.test.ts`「masks credential-shaped keys even with no UI metadata」「masks an unknown field whose name looks like a credential」；`index.test.tsx`「masks a sensitive value until the user reveals it」。导出/剪贴板/分享提示属 NFR-SEC-08，仍为 Todo                                                                                                                                                                                       |
| NFR-SEC-03            | Partial            | `document.test.ts`「never puts configuration values into error messages」、`validate.test.ts`「reports type mismatches with a path but never the value」；日志脱敏工具未建                                                                                                                                                                                                                                                                           |
| NFR-SEC-04            | Todo               | M0-4；算法与密钥托管已定（ADR-010）                                                                                                                                                                                                                                                                                                                                                                                                                  |
| NFR-SEC-05            | Partial            | 条件 DSL 与校验器侧已证明：`condition.test.ts`「supports bounded string predicates but no regular expressions」「refuses to walk the prototype chain」「rejects an operator that is not in the closed set」；`validate.test.ts`「refuses remote and malformed references」「flags classic catastrophic-backtracking shapes」；ADR-008 已排除 `new Function`；ESLint 已禁止 `packages/**` 触碰 `node:fs`。Bundle 打包层的静态检查（FR-UPD-07）待 M0-4 |
| NFR-SEC-06            | **Done**           | `document.test.ts`「resource limits」5 例：体积、深度、多文档、别名炸弹、UTF-8 计量                                                                                                                                                                                                                                                                                                                                                                  |
| NFR-SEC-07            | Todo               | 需要 `apps/web` 部署配置                                                                                                                                                                                                                                                                                                                                                                                                                             |
| NFR-SEC-08            | Todo               |                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| NFR-MAINT 覆盖率 ≥85% | **Done（当前包）** | `vitest run --coverage` 全局 92.14% 行覆盖，阈值在 `vitest.config.ts` 中强制                                                                                                                                                                                                                                                                                                                                                                         |
| NFR-A11Y              | Partial            | `index.test.tsx`「labels every control and marks required fields non-visually」；容器控件用 `role="group"` + `aria-labelledby` 而非悬空 `<label>`。缺口：WCAG 2.2 AA 全面走查、拖拽的键盘替代操作，以及 [ADR-011](./adr/ADR-011-visual-design-system.md) 记录的三处对比度不达标修正                                                                                                                                                                  |
