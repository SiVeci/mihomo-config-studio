# ADR-003：以 YAML Document/AST 作为可回写源

- 状态：Accepted
- 日期：2026-08-10
- 来源：PRD §8.2 实现要求、§17 ADR-003

## 背景

`parse -> plain object -> stringify` 会丢失注释、键顺序、锚点、引号风格，以及当前 Schema 尚未认识的字段。
FR-YAML-02、FR-YAML-03 与 G-05 要求这些内容必须保留。

## 决策

使用 [`yaml`](https://eemeli.org/yaml/)（eemeli）包的 Document/CST 能力，保留三层表示：

1. `sourceText` —— 导入时的原始字节，永不修改。
2. CST（具体语法树，`keepSourceTokens: true`）—— 用于原地手术式修改。
3. `Document`（AST）—— 用于结构化读取与结构性修改。

领域投影（plain JS 对象）只作为**读视图**，不是唯一真相。

## 结果

- 未修改导出可做到逐字节一致（已由 `packages/yaml-engine` 的 round-trip 测试证明）。
- 双向同步与列表重排实现复杂度上升，必须以 Golden / Round-trip 测试兜底。
- Mihomo 使用 `gopkg.in/yaml.v3` 解析，支持 `<<` 合并键，因此 Composer 开启 `merge: true`，
  使领域投影语义与内核一致；合并键在文本层仍原样保留。

## 相关

- [ADR-006：两级 YAML 回写策略](./ADR-006-two-tier-writeback.md)
