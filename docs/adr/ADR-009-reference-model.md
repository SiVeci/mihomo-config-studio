# ADR-009：引用模型——实体标识、引用分类与规则解析口径

- 状态：Accepted
- 日期：2026-08-11
- 相关：[ADR-003](./ADR-003-yaml-document-ast.md)、[ADR-006](./ADR-006-two-tier-writeback.md)
- 来源：PRD §10、§17（ADR-009 预留）；M0-3 技术验证

## 背景

FR-REL-01/02/03/05 要求：改名不改变内部身份、改名级联更新所有引用、删除前列全引用方、
检测并阻断循环。这四件事共享同一个前提——需要一种稳定的方式，把"YAML 里的一个名字"
和"这是同一个东西"对应起来，且这个对应关系在改名后依然成立。

版本文档标注的技术难点是：路由规则里的引用不是独立 YAML 节点，而是标量值*内部*的
一个子片段（如 `DOMAIN,example.com,PROXY-GROUP` 里的 `PROXY-GROUP`）。索引必须能
定位到这个子片段的精确边界，级联改名才不会破坏规则文本的其余部分——这是 M0-3 真正
要验证的风险，不是建两个数据结构。

## 决策

### 1. 实体标识：位置槽位 + 会话内记忆，不从名字派生

`Entity = { id, kind, serializedName, sourcePath }`（`packages/config-model/src/entity.ts`）。
`EntityRegistry.extract(document)` 每次调用都从当前文档重新抽取全部实体，抽取到的每一项
先算出一个**槽位键**（`slotKey`：`kind` + 容器内位置，如 `proxy-group#0`；map 用枚举顺序
下标，`sub-rules` 用组名+组内下标，内置目标用固定名字），再与上一次 `extract()` 记住的
槽位比对：

- 槽位已存在 → 复用旧 `id`，只刷新 `serializedName`/`sourcePath`。
- 槽位是新的 → 用按 `kind` 维护的单调计数器铸造新 `id`（如 `proxy-group:3`）。
- 槽位这次没出现 → 从 Registry 里删除。

`id` **不对 `serializedName` 做哈希或其它派生**：如果 `id` 由名字派生，改名的瞬间 `id`
也会跟着变，FR-REL-01"重命名不改变内部身份"直接不成立——这不是实现细节，是需求本身
对 ID 生成方式的否定性约束。

代价是显式的：位置槽位在**纯改名**（`setScalarIn` 改 `name` 字段、`renameKeyIn` 改 map
key）下稳定，因为容器内位置不变；但在同一容器发生插入/删除、导致其它项位置整体前移或
后移时**不保证**同一实体的 `id` 不变（`Slot` 接口的注释已明确记录这一点）。这是有意的
取舍：`ReferenceIndex` 对任何结构性编辑本来就要求显式 `rebuild()`（见决策 2），再让 `id`
额外保证"扛得住任意重排"只会增加复杂度而不减少调用方的心智负担——调用方无论如何都要在
结构性编辑后重新走一遍"抽取实体 → 重建索引"。

`id` 只存在于内存中的 Registry，从不写入导出的 YAML（`entity.test.ts`「never writes an
assigned id into the serialised document」）。`sourcePath` 是配套但*可变*的定位信息，
故意与 `id` 分离：`id` 回答"是不是同一个东西"，`sourcePath` 回答"现在在文档的哪里"。

内置目标（`DIRECT`/`REJECT`/`REJECT-DROP`/`COMPATIBLE`/`PASS`/`PASS-RULE`，以及未被
用户在 `proxy-groups[]` 里自定义同名组时的 `GLOBAL`）作为 `kind: 'builtin'`、
`sourcePath: []` 的预置实体纳入 Registry——否则任何指向它们的引用都会被误判为断裂
引用。这七个保留字与 `GLOBAL` 的有条件行为取自 `MetaCubeX/mihomo` v1.19.29
`config.go#parseProxies` 逐字源码（`entity.test.ts`「registers the six unconditional
builtins plus an auto GLOBAL…」「defers to a user-defined GLOBAL proxy-group…」）。

### 2. 引用类型分类：三类改写手法互不相同

`Reference = { fromId, toId, path, referenceType }`（`packages/graph/src/reference-index.ts`），
`referenceType` 区分三类：

| 类型              | 出现位置示例                                                | 改写手法                                                                                       |
| ----------------- | ----------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `map-key`         | `proxy-providers.<key>`/`rule-providers.<key>` 实体自身声明 | `document.renameKeyIn()`；由 `Entity.kind`/`sourcePath` 在 `rename()` 内直接分发，不经扫描发现 |
| `seq-item`        | `proxy-groups[].proxies[i]`、`use[i]`                       | `document.setScalarIn(ref.path, newName)`，整项替换                                            |
| `scalar-fragment` | 规则串内的 target/payload 片段                              | 用偏移在原字符串内拼出新文本，再 `setScalarIn()` 整体写回                                      |

`map-key` 不由文档扫描产生：它是 `proxy-provider`/`rule-provider` 自身声明的改写路径。
本仓库不存在"实体 A 通过 map key 引用实体 B"的场景——map key 只用来承载实体*自己*的
名字——所以 `rename()` 直接依 `Entity.kind` 分发（map-key 类走 `renameKeyIn`，其余走
`setScalarIn`），不把自身声明当作一条需要被发现的 `Reference` 记录。`seq-item` 与
`scalar-fragment` 都走 `setScalarIn`，区别在于后者要先做偏移拼接（见决策 3）。三者都在
CST 模式下逐字节保真——引号风格、flow/block 样式、注释与锚点均不受影响，这是 ADR-006
两级回写策略在引用改写场景下的直接推论（`reference-index.test.ts` 断言改名后
`anchors()` 不变、`use: [prov-a, provider-b]` 仍是 flow 风格）。

**改名前先做冲突检查**：新名与同类实体重名时抛 `GraphError('GRAPH_NAME_CONFLICT')`，
检查发生在任何 `setScalarIn`/`renameKeyIn` 调用之前，不做半途改写
（`reference-index.test.ts`「rejects a rename that collides with another entity of
the same kind, without a half-done rewrite」）。

**索引不做增量维护**：结构性编辑（`appendIn`/`deleteIn`/`moveSeqItem`），以及任何改变
某个标量长度、导致同一行内其它 `scalar-fragment` 偏移随之失效的编辑，都会使索引过期。
`ReferenceIndex.rebuild()` 必须显式重新调用；`rename()` 对同一份索引只保证安全调用
一次，改第二个实体前必须先 rebuild（这是本仓库唯一记录在案、要求调用方自行规避的
索引陈旧风险，而不是靠运行时脏检查兜底——见"结果"一节的代价说明）。

### 3. 标量内子片段定位：偏移区间，不是文本替换

一条规则字符串一次性解析成 `{ type, payload, target, params[] }`，payload/target 各自
带 `[start, end)` UTF-16 偏移（`packages/config-model/src/rule-line.ts`）。级联改名时
用偏移在原字符串上切片拼接（`line.slice(0, start) + newName + line.slice(end)`），而
不是对整条规则串做字符串查找替换。

这个区别是本片的核心风险点：全局字符串替换在 payload 恰好包含目标名字子串时会误伤——
例如 `rule-providers.cn-domain` 改名，若按文本替换，`path: ./rules/cn-domain.mrs`
里的同名子串也会被一起改掉。偏移区间从解析阶段就绑定到*具体字段*，不依赖"内容里没有
歧义子串"这个假设。`reference-index.test.ts` 对 `comprehensive.yaml` 的四组改名
（`PROXY→PROXY-MAIN`、`provider-a→prov-a`、`cn-domain→cn-dom`、`AUTO→AUTO-URL`）
逐一用 `diffLines()` 断言：变更行集合恰好等于预期集合，且同名路径子串所在行
（`provider-a.yaml` 第 103 行、`cn-domain.mrs` 第 141 行）必须逐字节不变——这是唯一
能证伪"实现其实在做全局替换"的断言方式。

### 4. 规则解析口径来源：`MetaCubeX/mihomo` v1.19.29 `rules/common/base.go#ParseRulePayload`

`rule-line.ts` 的三分支解析逻辑不是自行设计的，是 `ParseRulePayload` 的逐字移植：

```go
item := trimArr(strings.Split(ruleRaw, ","))
tp = strings.ToUpper(item[0])
if len(item) > 1 {
	switch tp {
	case "MATCH":
		target = item[1]
	case "NOT", "OR", "AND", "SUB-RULE", "DOMAIN-REGEX", "PROCESS-NAME-REGEX", "PROCESS-PATH-REGEX":
		if needTarget {
			l := len(item)
			target = item[l-1]
			item = item[:l-1]
		}
		payload = strings.Join(item[1:], ",")
	default:
		payload = item[1]
		if len(item) > 2 {
			if needTarget {
				target = item[2]
				if len(item) > 3 {
					params = item[3:]
				}
			} else {
				params = item[2:]
			}
		}
	}
}
```

三条分支要点：

- `MATCH`：无 payload、无 params，`target = item[1]`。
- 逻辑/正则类（`NOT`/`OR`/`AND`/`SUB-RULE`/`DOMAIN-REGEX`/`PROCESS-NAME-REGEX`/
  `PROCESS-PATH-REGEX`）：target 取**最后一段**，payload 是中间各段重新拼接——因此
  含逗号的 payload（如 `AND,((DOMAIN,a),(DOMAIN,b)),PROXY`）不产生歧义，逗号不丢。
- 其余（default，含 `RULE-SET`/`DOMAIN-SUFFIX`/`IP-CIDR` 等）：`payload = item[1]`，
  target 是**固定的第 3 段** `item[2]`，不是最后一段。例如
  `IP-CIDR,198.18.0.0/16,REJECT,no-resolve` 的 target 是 `REJECT`，不是最后一段
  `no-resolve`。default 分支的 payload **不能含逗号**——上游本身也会静默错解，本仓库
  按上游行为实现，不做"更聪明"的补救；解析结果与用户意图不符时，由校验层（未来
  `FR-VAL-03`）产出 issue，不在解析层猜。

这是本仓库对上游行为的**硬依赖点**：升级兼容档案（ADR-004/ADR-012 锁定的 Mihomo
版本）时，若上游改变了 `ParseRulePayload` 的分支逻辑或字段顺序，本项目的级联改名会
在不知情的情况下算错偏移，进而改坏用户的规则文本而不报错。**升级兼容档案前必须先
复核这段源码是否仍与本 ADR 一致**；不一致则先更新 `rule-line.ts` 与本 ADR，再推进
版本锁定。

PRD 对规则解析算法本身未作表述，因此这不是"PRD 与上游有差异"，不需要记入
`docs/upstream-divergences.md`——这是"实现对齐上游"：PRD 只要求"级联更新引用"这个
结果，没有规定怎么解析规则字符串。

**已知缺口，非静默遗漏**：`SUB-RULE` 的 target 指向子规则*组名*，不是代理组
（上游对 `tp == "SUB-RULE"` 单独查 `subRules` 映射）。`packages/graph` 目前只把
`sub-rules.<key>[]` 里的每一行当作独立的 `sub-rule` 实体（与顶层 `rules[]` 对称，
两者都要经同一个 `parseRuleLine` 才能被级联改名覆盖），组名本身（map key）*未*建模
为可引用实体，因此 `SUB-RULE` 类型的 target 目前总是解析不出引用
（`referenceKindsForField` 显式将其目标类型集合置空，即使文档里恰好存在同名的
代理组，也不会误配——`cycles.test.ts`/`reference-index.test.ts` 均有专门用例覆盖）。
组名要不要单独建模为实体，留给 v0.4.0 关系图 UI（FR-REL-04/06）按实际需要决定。

## 结果

- FR-REL-01/02/03/05 的判定口径、改写手法与偏移定位方式已被
  `entity.test.ts`（12 例）、`rule-line.test.ts`（14 例）、`reference-index.test.ts`
  （15 例）、`impact.test.ts`（9 例）、`cycles.test.ts`（9 例）验证，M0-3 关闭。
- 代价：`rule-line.ts` 与上游 `ParseRulePayload` 强耦合，是本仓库唯一一处"改上游
  解析逻辑就必须同步改本仓库代码"的位置，必须在升级检查清单里显式复核（见决策 4）。
- 代价：`ReferenceIndex` 没有脏检查——调用方必须自己记得在任何文档结构性改动后
  重新抽取实体并 `rebuild()`；这是显式约定而非运行时保证，误用不会报错，只会得到
  基于过期偏移的错误改写。
- `SUB-RULE` 组名未建模为实体是已知缺口，留待 v0.4.0 评估。

## 相关

- [ADR-003：以 YAML Document/AST 作为可回写源](./ADR-003-yaml-document-ast.md)
- [ADR-006：两级 YAML 回写策略](./ADR-006-two-tier-writeback.md)
