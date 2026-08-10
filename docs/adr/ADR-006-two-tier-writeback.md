# ADR-006：两级 YAML 回写策略（CST 手术式 + AST 结构式）

- 状态：Accepted
- 日期：2026-08-10
- 补充：[ADR-003](./ADR-003-yaml-document-ast.md)

## 背景

M0 技术验证发现：`Document#toString()` 虽然保留注释、锚点、键顺序和未知字段，
但会规范化部分书写细节。实测证据（`yaml@2.9.0`）：

```text
输入：           list:\n  - &an {k: v}\n  - *an
toString 输出：  list:\n  - &an { k: v }\n  - *an     ← 流式映射被补上内侧空格
CST.stringify：  list:\n  - &an {k: v}\n  - *an       ← 逐字节一致
```

而 CST（`Parser` + `Composer({keepSourceTokens:true})` + `CST.stringify`）在未修改时
可逐字节复原输入。

## 决策

`MihomoYamlDocument` 维护一个回写模式：

| 模式  | 触发                                 | 序列化方式                           | 保真度                                         |
| ----- | ------------------------------------ | ------------------------------------ | ---------------------------------------------- |
| `cst` | 初始状态；仅发生标量赋值 / 键改名    | `tokens.map(CST.stringify).join('')` | 除被改动的片段外逐字节一致                     |
| `ast` | 发生结构性修改（增删节点、重排序列） | `Document#toString()`                | 保留注释、锚点、顺序、未知字段；可能规范化空白 |

一旦进入 `ast` 模式不再退回，直到调用 `commit()`（重新序列化并重新解析）。
`commit()` 通常在保存点调用，而不是每次按键。

### 标量写入的正确性护栏

`CST.setScalarValue` 会自动按需加引号，但它不知道**类型意图**。因此：

1. 写入非字符串（number/boolean/null）时强制 `type: 'PLAIN'`。
2. 写入的字符串若会被 YAML 1.2 core 解析成其它类型（`1234`、`true`、`null`、`0x1F` 等），
   强制 `type: 'QUOTE_DOUBLE'`。
3. 写入后用 `CST.resolveAsScalar` 读回校验；不一致时**放弃 CST 路径**，降级到 AST 模式，
   而不是输出一份语义已经改变的文档。

## 结果

- 表单单字段编辑的差异被限制在单行（已由测试断言行号集合证明）。
- 结构性编辑仍然安全，只是不再保证空白逐字节一致。
- 代价：两条写入路径需要各自的测试覆盖；`locate()` 需要在文本变化后重新解析以计算行列。
