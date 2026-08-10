# ADR-008：自建解释型 JSON Schema 子集校验器，不使用编译型校验库

- 状态：Accepted
- 日期：2026-08-10
- 相关：[ADR-002](./ADR-002-declarative-schema-bundle.md)

## 背景

FR-SCHEMA 要求结构约束采用 JSON Schema 2020-12。业界默认选择是 Ajv。

但 Ajv 的工作方式是**把 schema 编译成 JavaScript 函数**（`new Function`）。这与两条硬约束冲突：

1. **NFR-SEC-07：Web 部署启用严格 CSP。** `new Function` 需要 `unsafe-eval`，
   一旦开启，CSP 对 XSS 的防护基本失效。
2. **FR-UPD-07 / NFR-SEC-05：Bundle 不能执行代码。** 如果下载来的 schema 数据
   最终会被转换成可执行函数，"Bundle 只是数据"这句话就不再成立——它只是换了一种执行形式。
   签名验证通过与否，和"这份数据会不会变成代码"是两个独立问题。

Ajv 提供 standalone 预编译模式，但那要求所有 schema 在**构建期**已知，
与"Schema Bundle 可独立于应用发布"（ADR-002）直接矛盾。

## 决策

自建一个**解释型**校验器（`packages/schema-core/src/validate.ts`），覆盖产品实际需要的关键字：

`type`、`enum`、`const`、`required`、`properties`、`additionalProperties`、`propertyNames`、
`items`、`prefixItems`、`minItems`、`maxItems`、`uniqueItems`、
`minimum`、`maximum`、`exclusiveMinimum`、`exclusiveMaximum`、`multipleOf`、
`minLength`、`maxLength`、`pattern`、`format`、
`allOf`、`anyOf`、`oneOf`、`not`、`$ref`（仅 `#/$defs/*`）。

配套约束：

- `$ref` **只允许本地** `#/$defs/<name>`。远程引用一律拒绝——能联网取回的 schema
  等于绕过了签名验证。
- `format` 是**封闭集合**，每个都有手写的、无嵌套量词的检查函数。
- `pattern` 只在长度 ≤ 4096 的输入上执行；`isRiskyPattern()` 在 Bundle 校验阶段
  拦截 `(a+)+`、`(a|a)*` 这类回溯炸弹形状。
- 递归深度和 issue 数量都有上限，恶意 schema 无法让校验过程无限进行。
- 组合关键字（`anyOf`/`oneOf`/`not`）的分支在隔离状态下求值，分支失败不污染主结果。

## 明确不支持

`unevaluatedProperties`、`unevaluatedItems`、`dependentSchemas`、`if/then/else`、
`contains`/`minContains`、动态锚点（`$dynamicRef`）。

跨字段与跨对象逻辑改用受限规则 DSL（`Condition`），它同样是封闭操作码集合。
若将来确有需要，新增关键字属于 **Level 2 应用代码更新**，不能由 Bundle 引入。

## 结果

- 严格 CSP 可以开启，无 `unsafe-eval`。
- "Bundle 不能执行代码"成为一个可以在代码评审中核对的结构性事实。
- 代价：需要自己维护校验器与其测试；不支持完整 2020-12 规范。
  当前实现有 `validate.test.ts` 覆盖，包括合法、非法、边界、递归深度与 issue 上限。
