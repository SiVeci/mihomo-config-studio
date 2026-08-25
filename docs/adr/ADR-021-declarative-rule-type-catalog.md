# ADR-021：声明式规则类型目录

- 状态：Accepted
- 日期：2026-08-26
- 相关：[ADR-002](./ADR-002-declarative-schema-bundle.md)、[ADR-008](./ADR-008-interpreted-json-schema-validator.md)、[ADR-020](./ADR-020-builtin-bundle-layout-and-reissue.md)
- 来源：v0.4.0 切片 #3

## 背景

`rules:` 是字符串数组，`sub-rules:` 是「名字 → 字符串数组」的映射——两者都不是
`buildFormPlan`/`buildArrayFormPlan` 能表达的形状。前者假设根 Schema 描述一个
带 `.properties` 的对象；后者假设集合条目是判别式联合的对象（`proxies`/
`proxy-groups`/`proxy-providers`/`rule-providers` 都是这个形状）。规则行本身
（`DOMAIN-SUFFIX,example.com,DIRECT`）不是键值对的集合，是一个由逗号分隔、
按类型决定分段含义的字符串——把它硬塞进 JSON Schema 表单机制，要么发明一个
不对应磁盘真实形态的包装对象（重蹈 `PROXIES_MODULE`/`PROXY_PROVIDERS_MODULE`
已经踩过的「一份 Schema 描述的是元素还是集合」的形状错位），要么放弃
FR-SCHEMA-06「新增字段不改代码」的保证。

## 决策

### 目录取代表单

新增 `packages/schema-core/src/rule-catalog.ts`：`buildRulePlan(catalog, rawLine)`
把 `@mcs/config-model` 的 `parseRuleLine`（v0.1.0 已实现、14 例测试覆盖含子片段
偏移定位）产出的片段，与目录里的条目对齐，产出 `{kind:'structured', spec,
payload, target, params}` 或 `{kind:'raw', text}`。**这个函数不解析规则字符串
本身**——分段已经由 `parseRuleLine` 完成，本函数只做「片段 → 类型语义」的对齐。

目录条目（`RuleTypeSpec`，`packages/schema-core/src/types.ts`）是纯数据：

```ts
interface RuleTypeSpec {
  type: string; // 大写，与 ParsedRuleLine.type 一致
  payloadKind: RulePayloadKind; // 封闭枚举，控件按它选，不按 type 做 switch
  needsPayload: boolean; // 仅 MATCH、SUB-RULE 为 false（可以只有裸 target）
  params: string[]; // 该类型接受的已知附加参数（如 no-resolve、src）
  docsUrl?: string;
  since?: string;
  safety?: SafetyLevel;
}
```

`payloadKind` 是封闭枚举（`domain`/`domain-suffix`/`ipcidr`/`port`/`process`/
`geo`/`rule-set`/`sub-rule`/`none`）——新增一种「已有形状」的规则类型（例如未来
一个新的域名匹配变体）只改 `rule-types.json` 数据，`schema-core`/`form-renderer`/
`apps/web` 零改动。这与 v0.3.0 #10「加第十种协议只改数据」的 FR-SCHEMA-06
断言是同一条保证在规则侧的落地，`builtin.test.ts` 有一条对应用例
（合成第十一种规则类型，`buildRulePlan` 立即可用）。

**与执行计划原文的一处偏差**：计划文本写的字段名是 `needsTarget`，但
`config-model/src/rule-line.ts` 的既有不变量是「`rules:`/`sub-rules:` 上下文里
target 恒必需」（`parseRuleLine` 的文件头注释：`needTarget: false` 只适用于
本应用从不解析的 rule-provider 文件体）——目录里真正**变化**的是「是否需要
payload」（仅 MATCH、SUB-RULE 可以只有裸 target），故字段改名为 `needsPayload`
更准确地描述它实际表达的差异，`payloadKind: 'none'` 与 `needsPayload: false`
两者对 MATCH 同时成立，语义不重复（前者是「payload 的形状」，后者是「payload
是否存在」）。

### 认不出就保留原文

`catalog.find(entry => entry.type === parsed.type)` 找不到时返回
`{kind:'raw', text: rawLine}`——不抛错、不丢弃、不猜测。这是 FR-RULE-05
「规则编辑器必须保留无法解析的规则为原始文本」的数据层落点，与「未知字段不丢」
是同一条保真承诺在规则侧的入口。逻辑规则（`NOT`/`AND`/`OR`，PRD §8.3 明确
P1/P2）**不进目录**，因此永远走这条路径——本版本不解析嵌套括号表达式，
但原始文本完整保留、可编辑（#8 会给它一个「按原始文本编辑」的入口，不是
禁用编辑）。

### 十六个 P0 类型，双来源核实

`rule-types.json`（`packages/schema-builtin/modules/rules/`）收录 PRD §8.3
「路由规则」P0 范围的十六个类型：`DOMAIN`/`DOMAIN-SUFFIX`/`DOMAIN-KEYWORD`/
`DOMAIN-WILDCARD`/`DOMAIN-REGEX`/`GEOSITE`/`IP-CIDR`/`IP-CIDR6`/`IP-ASN`/
`GEOIP`/`DST-PORT`/`PROCESS-NAME`/`PROCESS-PATH`/`RULE-SET`/`SUB-RULE`/`MATCH`。
十二个在仓库内已 vendor 的 v1.19.29 官方样例中直接出现（`rules:`/`sub-rules:`
段或语法等价的 DNS `fake-ip-filter` 段）；`GEOIP`/`DST-PORT`/`PROCESS-NAME`/
`PROCESS-PATH` 该样例未演示，改用官方 Meta-Docs 源码核实（`docs/config/rules/
index.md`，commit `89c2f10`）——与 D-004（`proxy-providers.filter`）同一先例。
完整核对记录、`payloadKind` 归类理由、证据分级见
`packages/test-fixtures/src/upstream.ts` 的 `UPSTREAM_RULE_TYPES`（v0.4.0 #0）；
`builtin.test.ts` 对 `RULES_MODULE.ruleTypes` 做双向断言（目录声明了上游没有的
P0 类型 → 红；上游 P0 类型目录没声明 → 红），与 `UPSTREAM_P0_FIELDS` 在其余
模块上的既有用法同一手法。

### `rules`/`sub-rules` 两个模块，共享目录数据

`manifest.root` 分别是 `['rules']`（数组）与 `['sub-rules']`（映射）——形状
不同，合并成一个模块只会让消费方多一层分支（是数组还是映射）。两者的
`SchemaModule.schema`/`.ui` 是刻意留空的最小值（`{type:'array',
items:{type:'string'}}` / `{type:'object', additionalProperties:{...}}` 与
`{}`），不像 ADR-020 的六文件模板那样有独立的 `config.schema.json`/
`ui.schema.json`/`validation.rules.json`——这两个模块从不经过
`buildFormPlan`/`ModuleFormPage`，没有字段级 UI 元数据要描述；规则行的编辑
元数据全部在 `ruleTypes[]` 自己身上（`docsUrl`/`safety`），不需要第二份平行
数据。`schema` 仍然是真的、有用的：让 `schemaStage` 白得一条结构检查
（`rules:` 必须真的是字符串数组）。

`rule-types.json` 的内容在两个模块目录下**各自独立存一份**（而不是
`sub-rules` 交叉引用 `rules` 的文件）——子规则内部的规则行用的是完全同一套
DSL，两份内容目前逐字相同，但每个 Bundle 模块文件被设计为独立可打包、可
签名的单元（ADR-020），让一个模块的文件引用另一个模块的磁盘路径会破坏这个
独立性假设。代价是手工同步：这两个模块的 `rule-types.json` 未来如有分歧
（目前没有理由分歧），必须手动同步，`builtin.test.ts` 有一条
`SUB_RULES_MODULE.ruleTypes` 与 `RULES_MODULE.ruleTypes` 逐字相等的断言
兜底，忘同步立刻报红。

### 副产品：修复两处已存在的假阳性未知字段

实现 `rules`/`sub-rules` 时发现 `packages/validator/src/pipeline.ts` 的
`schemaStage` 有两处既有（v0.3.0 #12 起就存在）的未知字段假阳性：

1. **标量数组字段**：`buildFormPlan` 只为数组字段本身产出一个 `PlannedField`
   （如 `dns.nameserver`），从不展开数组元素；但 `document.leafPaths()`
   无条件展开每一个序列节点，产出逐元素的叶子路径。exact-match 比对下，
   **任何** 数组字段的每一个元素都会被判定未知字段——只是既有字段的数组
   通常只有几项，容易被忽略；`rules:` 上万条时这条假阳性直接淹没问题面板。
2. **字典型字段**（`{type:'object', additionalProperties:{...}}`，无命名
   `.properties`，`sub-rules:` 正是这个形状）：`planObject` 只认
   `.properties` 声明的键，字典的任意键统统落进「未声明属性」分支，
   判定为未知。

两处都不是规则专属的缺陷（本身与 Mihomo 规则语义无关），是 `form-plan.ts`
从未被教会「数组」「字典」这两种收集形状的通用缺口，只是被这版本第一次
建的大规模数组字段放大到无法忽略。修复是 `pipeline.ts` 里两个新增的小函数
（`registerKnownPath`/`registerDictionaryKnownPaths`），刻意只覆盖标量数组与
无命名属性的字典这两种明确无歧义的情况，不去动 `isArrayEntryModule` 那条
既有的、语义不同的路径（判别式联合条目未匹配分支时，其子字段仍需要被单独
判定未知——这条不能被「祖先路径已知就抑制全部后代」的简单前缀匹配掩盖，
故没有采用那个更简单但会误伤的方案）。回归用例见
`pipeline.test.ts`（`dns.nameserver` 数组、合成的字典模块）。

## 结果

- `packages/schema-core`：新增 `rule-catalog.ts`（`buildRulePlan`）、
  `types.ts` 的 `RuleTypeSpec`/`RulePayloadKind`，`module.ts` 的
  `validateModuleShape` 新增 `ruleTypes` 形状检查（封闭 `payloadKind` 集合、
  `type` 去重）。新增对 `@mcs/config-model` 的依赖（`parseRuleLine`），
  依赖方向安全（`config-model` 不依赖 `schema-core`）。
- `packages/schema-builtin`：`modules/rules/`（`module.manifest.json`、
  `rule-types.json`、`i18n/*.json`、`examples/*.yaml`，无
  `config.schema.json`/`ui.schema.json`/`validation.rules.json`）与
  `modules/sub-rules/{...}` 同构，成为第九、第十个内置模块。内置 Bundle
  重签（十个模块）。
- `packages/validator`：`schemaStage` 的未知字段判定修复两处既有假阳性
  （见上），非规则专属，惠及所有既有模块的数组/字典字段。
- 代价：`rule-types.json` 在两个模块目录下重复一份，需要手工保持同步
  （已有断言兜底忘同步）；`needsPayload`/`payloadKind` 是两个独立维度，
  新增规则类型时必须同时想清楚两者而非合并成一个字段——本 ADR 判断这点
  额外的认知负担换来的是二者语义不重叠、互不隐含，比强行合并成一个字段
  更不容易在未来产生歧义。
