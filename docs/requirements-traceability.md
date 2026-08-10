# 需求追踪表

状态口径（与"质量要求"一致，未满足者一律记为未完成）：

- **Done** —— 已实现，且类型检查、单元测试/端到端测试通过，有可复现的验证证据。
- **Partial** —— 已实现一部分，缺口在"证据 / 缺口"列写明。
- **Todo** —— 尚未开始。

> 本表随每个垂直切片更新。任何标记为 Done 的行都必须能指向具体测试文件。

## 里程碑映射

| 本仓库阶段        | PRD 里程碑 | 状态                      |
| ----------------- | ---------- | ------------------------- |
| M0 技术风险验证   | PRD M0     | 进行中（5 项中 1 项通过） |
| M1 骨架与配置内核 | PRD M1     | 进行中                    |
| M2 及以后         | PRD M2–M7  | 未开始                    |

## M0 退出条件

| #    | 验证项                   | 状态     | 证据                                                                                                 |
| ---- | ------------------------ | -------- | ---------------------------------------------------------------------------------------------------- |
| M0-1 | YAML AST 无损 Round-trip | **Done** | `packages/yaml-engine/src/document.test.ts`（26 例）、`diff.test.ts`（6 例）、`path.test.ts`（5 例） |
| M0-2 | Schema 驱动表单          | Todo     | —                                                                                                    |
| M0-3 | 引用模型与关系图         | Todo     | —                                                                                                    |
| M0-4 | Schema Bundle 校验与回滚 | Todo     | —                                                                                                    |
| M0-5 | Android 文件能力         | Todo     | —                                                                                                    |

## 功能需求

### 8.1 项目管理

| ID         | 优先级 | 状态 | 证据 / 缺口 |
| ---------- | ------ | ---- | ----------- |
| FR-PROJ-01 | P0     | Todo |             |
| FR-PROJ-02 | P0     | Todo |             |
| FR-PROJ-03 | P0     | Todo |             |
| FR-PROJ-04 | P0     | Todo |             |
| FR-PROJ-05 | P0     | Todo |             |
| FR-PROJ-06 | P0     | Todo |             |
| FR-PROJ-07 | P1     | Todo |             |

### 8.2 YAML 导入、编辑与导出

| ID         | 优先级 | 状态     | 证据 / 缺口                                                                                                                                                                          |
| ---------- | ------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FR-YAML-01 | P0     | Todo     | 引擎已就绪，缺少文件/剪贴板入口（依赖 apps/web）                                                                                                                                     |
| FR-YAML-02 | P0     | **Done** | `document.test.ts`「keeps comments, anchors and unknown fields after an edit」「appends a rule while retaining unknown fields」                                                      |
| FR-YAML-03 | P0     | **Done** | `document.test.ts`「reproduces an untouched document byte for byte」「confines a scalar edit to the edited line」「preserves flow style…」「preserves block scalars around an edit」 |
| FR-YAML-04 | P0     | Todo     | 需要编辑器组件；引擎侧 `locate()` 已提供行列定位                                                                                                                                     |
| FR-YAML-05 | P0     | Partial  | 引擎已提供 `hasSyntaxErrors` 用于冻结结构化视图；UI 未实现                                                                                                                           |
| FR-YAML-06 | P0     | Partial  | `diffLines()` 已实现并测试；UI 面板未实现                                                                                                                                            |
| FR-YAML-07 | P0     | Todo     |                                                                                                                                                                                      |
| FR-YAML-08 | P1     | Partial  | `SerializeOptions` 已支持 lineWidth/indent；其余偏好未实现                                                                                                                           |

### 8.4 Schema 驱动表单

| ID                | 优先级 | 状态 | 证据 / 缺口 |
| ----------------- | ------ | ---- | ----------- |
| FR-SCHEMA-01 … 07 | P0/P1  | Todo | M0-2        |

### 8.5 引用与关系管理

| ID             | 优先级 | 状态 | 证据 / 缺口                                                                                   |
| -------------- | ------ | ---- | --------------------------------------------------------------------------------------------- |
| FR-REL-01 … 06 | P0/P1  | Todo | M0-3；引擎侧 `renameKeyIn()` 已可无损改名（`document.test.ts`「renames a map key in place」） |

### 8.6 规则编辑器

| ID                     | 优先级 | 状态    | 证据 / 缺口                                       |
| ---------------------- | ------ | ------- | ------------------------------------------------- |
| FR-RULE-02             | P0     | Partial | `moveSeqItem()` 已实现并测试不丢项；UI 拖拽未实现 |
| FR-RULE-01/03/04/05/06 | P0/P1  | Todo    |                                                   |

### 8.7 校验与问题中心

| ID                 | 优先级 | 状态    | 证据 / 缺口                                                                          |
| ------------------ | ------ | ------- | ------------------------------------------------------------------------------------ |
| FR-VAL-01          | P0     | Partial | `YamlIssue` 含 severity/code/message/path/range；模块与修复建议字段待 validator 补全 |
| FR-VAL-02          | P0     | Partial | `MihomoYamlDocument#locate()` 已测试；跳转 UI 未实现                                 |
| FR-VAL-03/04/05/06 | P0/P1  | Todo    |                                                                                      |

### 8.9 版本与 Schema Bundle 管理

| ID             | 优先级 | 状态 | 证据 / 缺口 |
| -------------- | ------ | ---- | ----------- |
| FR-UPD-01 … 09 | P0/P1  | Todo | M0-4        |

### 8.10 Android 能力

| ID             | 优先级 | 状态 | 证据 / 缺口 |
| -------------- | ------ | ---- | ----------- |
| FR-AND-01 … 07 | P0/P1  | Todo | M0-5        |

## 非功能需求

| ID                    | 状态               | 证据 / 缺口                                                                                 |
| --------------------- | ------------------ | ------------------------------------------------------------------------------------------- |
| NFR-PERF-01 … 05      | Todo               | 需要 apps/web 与真机基线                                                                    |
| NFR-REL-01 … 05       | Todo               | 依赖 storage / project-format                                                               |
| NFR-SEC-01            | **Done（结构性）** | 代码库中不存在任何网络上传路径；CI 需补一条静态检查                                         |
| NFR-SEC-02            | Todo               |                                                                                             |
| NFR-SEC-03            | Partial            | `document.test.ts`「never puts configuration values into error messages」；日志脱敏工具未建 |
| NFR-SEC-04            | Todo               | M0-4                                                                                        |
| NFR-SEC-05            | Todo               | M0-4；ESLint 已禁止 `packages/**` 触碰 `node:fs`                                            |
| NFR-SEC-06            | **Done**           | `document.test.ts`「resource limits」5 例：体积、深度、多文档、别名炸弹、UTF-8 计量         |
| NFR-SEC-07            | Todo               | 需要 apps/web 部署配置                                                                      |
| NFR-SEC-08            | Todo               |                                                                                             |
| NFR-MAINT 覆盖率 ≥85% | **Done（当前包）** | `vitest run --coverage` 全局 89.21% 行覆盖，阈值在 `vitest.config.ts` 中强制                |
| NFR-A11Y              | Todo               |                                                                                             |
