# ADR-023：批量编辑是一次原子写入，不是合并窗口

- 状态：Accepted
- 日期：2026-08-26
- 相关：[ADR-007](./ADR-007-source-only-workspace-packages.md)
- 来源：v0.4.0 切片 #10（FR-RULE-03，退出条件 4）

## 背景

v0.4.0 需要批量选择规则后一次性移动、复制、删除或替换目标策略，且**一次
undo 必须回退整批**。`HistoryStack`（v0.3.0 #15）已经有一个 `mergeKey` +
时间窗口机制——同一个 `mergeKey` 在 `mergeWindowMs`（默认 1s）内的连续
`record()` 调用会合并成一条历史项，这是为了让「在一个字段里连续打字」不会
每敲一个字符就压一条撤销记录。批量操作表面上很像：也是「多次修改收敛成
一条历史项」。

## 决策

**批量操作不复用 `mergeKey` 合并窗口，而是把整批补丁包进
`historyStack.record()`的同一次 `mutate` 回调里。**

两者语义不同，不能混用：

- `mergeKey` 合并窗口是**时间驱动的启发式**——「用户看起来还在编辑同一个
  东西」，靠时间窗口猜测，猜错的代价是可接受的（多一条或少一条历史项，
  用户几乎感知不到）。批量操作要的是**语义上的原子性**——「这些补丁本来
  就是同一个操作的不同部分，从来不是几个独立编辑碰巧挨得近」，如果用
  `mergeKey` 实现，批量操作和它之后 1 秒内的任何其他编辑（哪怕来自完全
  无关的 UI）都会被误合并，「一次 undo 回退整批」就不再成立。
- 因此 `handleApplyBatch`（`apps/web/src/worker/protocol.ts`）调用
  `historyStack.record()` **不传 `mergeKey`**——`record()` 自身的文档已经
  写明「省略 `mergeKey` 的编辑绝不合并」，这正是批量操作要的边界。

**全成功或全不改**：`mutate` 回调内部自己包一层 try/catch——任一补丁抛错，
立刻把 `state.parseResult` 重新指向对 `beforeText`（批量开始前的文本）的
一次全新 `MihomoYamlDocument.parse()`，再重新抛出。这是因为 `record()`
本身只保证「`mutate` 抛错则不记历史项」，不保证**已经被部分修改的
`MihomoYamlDocument` 实例本身**回滚——那是一个运行时对象，`record()` 拿到
的只是前后两份文本快照，没有能力把已经执行过的
`setScalarIn`/`appendIn`/`moveSeqItem` 撤销回去。用「重新解析已知完好的
文本快照」来复原，和 `handleUndo`/`handleRedo` 已经在用的手法完全一样，
不是新发明的机制。

**补丁构造是纯函数，和 Worker 写入分离**：`apps/web/src/rules/batch.ts`
的四个函数（移动/复制/删除/替换目标）只读 `rules` 数组和选中下标，返回
`IssueFix[]`，从不触碰文档。这让下标运算（复制要 `append` 到末尾再
`move` 回正确位置、删除要倒序避免下标漂移）可以在 node 环境精确单测，
不需要真实 Worker 或真实 YAML 文档。

## 什么情况下应该 supersede 这条决策

- 如果未来出现「批量操作之间需要合并」的真实需求（例如连续两次批量替换
  目标应该算一次撤销）——目前没有这个需求，`mergeKey` 机制本身没有变，
  届时可以评估给 `ApplyBatchRequest` 也加一个可选 `mergeKey`，但那是一个
  新的、独立的产品决策。
- 如果补丁数组大到需要流式/分块应用（例如一次批量操作触及数万行）——
  目前的批量场景（用户手动勾选的规则）不会到这个量级，`mutate` 回调
  同步跑完整个循环足够快；真出现这个量级时应该重新评估，而不是现在
  预先加分块逻辑。

## 结果

- `apps/web/src/worker/protocol.ts`：新增 `ApplyBatchRequest`/
  `ApplyBatchResponse`、`handleApplyBatch`；`client.ts` 新增
  `applyBatch(patches)`。
- `packages/validator/src/issue.ts`：`IssueFix` 本身不需要新增成员——批量
  操作复用已有的 `set`/`append`/`remove`/`move` 四种（`move` 是 #9 已经
  加的），只是这次一次性发送一批，不是 Worker 协议新概念。
- `apps/web/src/rules/batch.ts`：四个纯函数 + 专门测试倒序删除下标不漂移、
  非连续多选按整体最小..最大区间移动、复制的 `append`+`move` 下标推导。
- 代价：批量操作永远单独占一条历史项，即使和相邻编辑时间上紧挨着——这是
  刻意的，不是遗漏。
