# ADR-025：声明式迁移操作码的封闭集合

- 状态：Accepted
- 日期：2026-08-27
- 相关：[ADR-002](./ADR-002-declarative-schema-bundle.md)、[ADR-008](./ADR-008-interpreted-json-schema-validator.md)
- 来源：PRD §9.5、§10（`MigrationPlan`），v0.5.0 切片 #5

## 背景

Mihomo 字段随版本演进：改名、搬迁层级、加默认值、废弃、删除、收窄取值范围。PRD §9.5
要求这些变化能被声明式表达并进 Bundle 热更新（Level 1），但 ADR-002 已经把"Bundle 只能
包含数据"钉死——`migrations/*.json` 不能携带可执行代码，也不能引入新的操作码。这与
`packages/schema-core/src/condition.ts` 的 `Condition.op` 走的是同一条路：一组固定的、
由应用代码解释执行的操作码，Bundle 只能从这个集合里选，不能自己发明新的。

## 决策

`packages/migration` 定义七个封闭的迁移操作码（`MigrationOperation`，判别式联合，
判别字段 `op`）：

| 操作码             | 语义                                           | Lossy  |
| ------------------ | ---------------------------------------------- | ------ |
| `rename-field`     | 旧路径 → 新路径（同层级），值原样搬            | 否     |
| `move-field`       | 旧路径 → 新路径（可跨层级），值原样搬          | 否     |
| `set-default`      | 字段缺失时补上 Schema 声明的新默认值           | 否     |
| `deprecate-field`  | 标记废弃但仍保留、仍导出（PRD §9.5 第 5 条）   | 否     |
| `remove-field`     | 删除字段与其值                                 | **是** |
| `narrow-enum`      | 枚举取值收窄，落在新集合外的当前值无法表达     | **是** |
| `quarantine-field` | 移入项目隔离区（#9），不是删除，值仍可完整取回 | 否     |

**Bundle 不能引入第八个操作码**：装载 `migrations/*.json`（#6 的 `load.ts`）时，一旦遇到
不在这七个之内的 `op`，整份迁移规则拒绝装载，不跳过、不降级、不"尽力而为"。这与
`condition.ts` 遇到未知 `op` 直接 `throw ConditionError` 是同一姿态。

**与 `condition.ts` 同一封闭口径**：不引入正则算子、不引入表达式求值、不引入
`new Function` / `eval`（NFR-SEC-05、ADR-008 已确立的边界）。七个操作码全部是对路径和
（Schema 声明的）字面值的结构性操作，没有一个需要对用户文档的实际取值做条件判断或字符串
处理——`narrow-enum` 的"落在新集合外无法表达"是求值器（#8）在执行时用简单集合成员判断得出
的结果，不需要引入任何新的表达能力。

**`lossy` 是计算属性，不是声明属性**：`MigrationPlanInput` 类型本身没有 `lossy` 字段，
`buildMigrationPlan()` 是唯一的构造入口，`lossy` 永远等于
`operations.some(isLossyOperation)`。Bundle（或任何调用方）没有渠道声明一个与自己
`operations` 不一致的 `lossy` 值——这直接堵死"Bundle 谎报 `lossy: false` 却含
`remove-field`，绕过 NFR-REL-01 确认门"的路径。

**迁移警告只携带标识符**（NFR-SEC-03）：`MigrationWarning` 的形状是
`{ code, path, messageParams? }`，`messageParams` 的值域约定为路径、字段名、Schema
常量——不存在任何字段可以承载用户文档里的实际取值。这是结构性保证：类型上没有开口，
不是运行时过滤。后续切片（#8 求值、#9 隔离区）在真正处理文档时必须延续这个纪律；届时
它们各自的测试套件需要照抄本片 `plan.test.ts`「never serializes a real document value」
的手法（源自 `apps/web/src/worker/protocol.test.ts`）重新验证，因为那时才第一次有代码
路径真正接触用户文档的值。

## 何时必须上升到 Level 2（应用代码更新）

版本文档风险表要求记录"声明式迁移 DSL 表达不了某些结构变更"的案例，作为 DSL 演进的输入。
判据（任一命中即需要 Level 2，而不是勉强拿现有操作码拼凑）：

- 需要把一个标量字段拆成多个字段（或反过来合并），且拆分/合并规则依赖字段的**实际取值**
  而非固定映射——七个操作码都不读取值做分支。
- 需要把一个列表字段的**每个元素**按条件迁移到不同目标（不是整个字段搬迁）。
- 需要跨模块迁移（例如某字段从一个模块的 `root` 迁到另一个模块）——`MigrationOperation.path`
  的寻址范围是单个模块自己的文档作用域，同 `Condition.path` 的既有约定。
- 需要迁移后触发校验规则以外的副作用（写入历史记录之外的存储、调用外部能力）。

本版本（v0.5.0 #5–#9）截至目前**没有**遇到需要 Level 2 的真实案例；这里先把判据立好，
后续切片如果撞上，在这里补一行记录，不要在别处零散记录。

## 结果

- `packages/migration/src/plan.ts` 交付类型与两个纯函数（`isLossyOperation`、
  `buildMigrationPlan`），不含任何求值逻辑——求值器是 #8 的范围。
- 装载 Bundle 里的 `migrations/*.json` 并对照这七个操作码做封闭性校验是 #6 的范围
  （`packages/migration/src/load.ts`），本 ADR 只冻结操作码集合本身。
- `MIGRATION_OPERATION_KINDS` 导出为一个只读数组常量，供 #6 的装载校验与 `schema-cli`
  的静态检查（#13）复用同一份权威列表，不各自维护一份可能漂移的副本。
