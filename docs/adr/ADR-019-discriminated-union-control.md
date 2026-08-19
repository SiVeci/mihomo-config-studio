# ADR-019：判别式联合的 `variant` 控件

- 状态：Accepted
- 日期：2026-08-19
- 相关：[ADR-002](./ADR-002-declarative-schema-bundle.md)、[ADR-008](./ADR-008-interpreted-json-schema-validator.md)
- 来源：v0.3.0 先决项 1、PRD §8.4 FR-SCHEMA-02

## 背景

九种 P0 出站协议（HTTP / SOCKS / SS / VMess / VLESS / Trojan / Hysteria2 / TUIC /
WireGuard）在 `proxies` 里以 `type` 判别，是 JSON Schema 里的判别式联合
（`oneOf`/`anyOf`，各分支用 `const`/单值 `enum` 互斥）。`packages/schema-core` 的
`inferControl`/`planField` 在 v0.3.0 之前没有联合分支：`oneOf`/`anyOf` 一律落到
`unknown` 控件，联合分支的属性也不会被规划为子字段，`proxies` 模块做不出来。

## 决策

新增控件类型 `variant`（`ControlType` 联合的一个成员），而不是复用 `object`：

- **判别键发现是声明式的，不硬编码 `type`**：一个分支里凡是 `const` 或单值
  `enum` 的属性即候选判别键；多个候选时取所有分支都具备的第一个（按属性声明
  顺序，`form-plan.ts` 的 `analyzeVariant`）。九种协议按 `type` 判别只是这条
  通用规则的一个实例，Schema 作者不需要为 `proxies` 写任何特殊结构
  ——这正是 FR-SCHEMA-06「新协议只发 Bundle」的前提。
- **分支可以通过 `$defs` + `allOf` 声明共享字段**（`collectProperties` 递归
  展平，深度复用现有 `MAX_NESTING=8`）。`resolveRef` 只解析本地 `$ref`
  （ADR-008 已定），联合分支同样不能绕过这条边界。
- **找不到判别键不猜**：候选集在所有分支间没有交集时，`inferControl` 返回
  `'unknown'`（与联合类型加入前的行为一致），`planField` 在 `PlannedField`
  上记 `unknownReason: 'variant-no-discriminator'`（诊断用机器码，不作为
  用户可见文案）。合成的坏 Schema 不会让表单崩掉，只是退化成只读展示。
- **匹配分支的属性规划为 `children`，不引入额外路径层级**：`proxies[0].password`
  的路径是 `['proxies', 0, 'password']`，不是
  `['proxies', 0, 'ss', 'password']`——联合是"选哪个形状"的问题，不是文档
  结构的一部分，YAML 回写路径必须与文档实际形状一致。
- **切换判别值不删除任何字段**：规划器按当前判别值选一个分支做为 `children`
  来源，但仍把匹配分支的完整属性集（含判别键本身）交给既有的 `planObject`
  规划，再从结果里过滤掉判别键这一项（判别键由 `PlannedField.variant` 表达，
  不重复渲染为子字段）。文档里存在但当前分支未声明的属性，会经
  `planObject` 已有的"未声明属性"路径规划为 `unknown` 子字段，而不是消失
  ——这与基础/高级模式切换"不丢字段"是同一条保证的另一个入口（PRD §7.4、
  v0.3.0 决策 E4）。**这也是为什么判别键不能在传给 `planObject` 前被剔除**：
  剔除后它在文档里仍然存在，`planObject` 的"未声明属性"逻辑会把它当成
  未知字段重新冒出来，制造出重复的一行。
- **判别值不匹配任何分支时不规划子字段，但保留原始值**：字段的 `value`
  始终是文档里的实际值，不因为规划失败而被清空或替换。P1/P2 协议
  （AnyTLS、Mieru 等）落在这个分支：`type` 判别键存在，但值不在 P0 九种
  协议范围内，`matched: false`，用户仍能看到原始内容，只是不出现按字段
  编辑的表单。

### 为什么不复用 `object`

`object` 控件天然递归规划 `schema.properties`，语义是"这个值的形状是固定
的"。判别式联合的形状**取决于运行时值**（哪个分支命中），且需要一个独立的
选择器交互（切换判别值），复用 `object` 没有地方挂载"当前选中哪个分支"和
"候选分支列表"这两项状态。用一个新控件类型把这两项显式建模成
`PlannedField.variant`（`VariantInfo`：`discriminatorKey`、
`discriminatorPath`、`options`、`selected`、`matched`），渲染侧（#1）只需要
认识这一个新形状，不需要认识任何协议名。

### ADR-002 两级边界的定位

`ControlType` 是渲染器认识的闭集（`packages/schema-core/src/types.ts`），
新增一个值必须改应用代码——按 ADR-002 的两级扩展边界，这是 **Level 2**
变更（新控件类型），本版本是应用发布，做的就是这件事。做完之后，`variant`
控件本身对 Schema Bundle 开放：新增第十种协议、或任何其它模块里的判别式
联合，只需要在 `config.schema.json`/`ui.schema.json` 里加分支（Level 1，
签名 Bundle 即可分发），不需要再碰 `schema-core`/`form-renderer`。v0.3.0
#10 交付后五种协议时以"零代码改动"验证这一点。

## 结果

- `packages/schema-core/src/form-plan.ts` 新增 `analyzeVariant`/
  `collectProperties`/`discriminatorValue` 三个内部函数与
  `planVariantChildren`，`inferControl` 增加第三个可选参数 `rootSchema`
  （默认等于 `schema` 自身，兼容不带 `$ref` 的既有调用）。
- 代价：`PlannedField` 多一个可选字段 `variant`、一个诊断字段
  `unknownReason`；`UiFieldSpec` 多 `variantLabels?`。三者都是新增可选
  属性，不影响已有 Schema 模块（`sample-module.ts`、`BUILTIN_MODULE`）的
  类型检查。
- `collectProperties` 对自引用 `allOf` 环路有独立的深度上限（复用
  `MAX_NESTING`），恶意或错误 Schema 不能靠嵌套联合把规划器递归打爆
  （`form-plan.test.ts`「does not recurse forever on a self-referential
  allOf cycle」）。
- 渲染侧（判别值选择器控件、无障碍关系）留给 #1；本决策只覆盖规划侧的
  数据形状与算法。
