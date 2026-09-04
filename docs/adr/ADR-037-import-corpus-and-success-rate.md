# ADR-037：1 MB 导入成功率的语料集构成与判据

- 状态：Accepted
- 日期：2026-09-04
- 来源：版本文档 §14.1 质量指标第 5 项；v1.0.0 执行计划 #3

## 背景

版本文档 §14.1 第 5 项写的是「1 MB 文件导入成功率 ≥ 99%（合法测试语料）」。
在本决策之前，仓库里唯一的 1 MB 语料是 `generateLargeCorpus()`——一个**确定性
单样本**（固定种子），且只覆盖 `proxies`/`proxy-groups`/`rules` 三个模块，
从未声称过是「语料集」，也没有任何「成功率」的计算口径。这条指标因此从来
没有被真正回答过。本 ADR 定义三件事：什么是「合法测试语料」、什么是「导入
成功」、样本量 N 与判据怎么定，让这条指标第一次能被 CI 机器直接回答。

## 决策

### 1.「合法测试语料」是什么

由 `packages/test-fixtures/src/generate-large.ts` 新增的
`generateImportCorpus(options)` 确定性生成（固定种子，`seed`/`seed+1`/…
逐个取不同种子构成语料集，不是把同一份语料复制 N 份）。每份语料：

- **覆盖全部十个内置 P0 模块**：`general`/`inbound`（根级字段）、
  `sniffer`、`dns`（`HEADER` 自带）、`proxies`、`proxy-groups`、
  `proxy-providers`、`rule-providers`、`rules`、`sub-rules`——不是
  `generateLargeCorpus()` 那种只覆盖三个模块的窄语料。
- **包含真实 YAML 特性**：至少一个锚点 + 合并键（`&common-provider` /
  `<<: *common-provider`，仿照 `packages/test-fixtures/fixtures/yaml/
comprehensive.yaml` 自己的 `health-check` 写法）、周期性注释（沿用
  `generateLargeCorpus` 已有的"每 37 个代理一条注释"节奏）、**恰好一个**
  刻意未建模字段探针（`unknown-field-probe` 代理的 `smux` 块，与
  `schema-builtin` 自己的 `proxies/examples/unknown-fields.yaml` 用的是
  同一个字段）。
- **不包含**故意构造的非法样本——那是 `invalid.yaml`/`invalid` 语料的职责。
  这条指标问的是"合法输入能不能导入成功"，把非法样本混进分母会让这个数字
  失去意义（这是版本文档原文点名要避免的口径混淆）。

**不复用 `generateLargeCorpus()` 的 `proxyEntry()`**：那个函数给每个 `ss`
代理写了一行 `udp: true`——`udp` 是真实的 Mihomo 字段，但不在 P0 `proxies`
schema 的 `ss` 分支建模范围内（`config.schema.json` 只声明了 `type`/
`cipher`/`password`/`plugin`/`plugin-opts`），所以 `generateLargeCorpus()`
产出的每一个 `ss` 代理都会**意外地**触发一次 unknown-field。这对
`generateLargeCorpus()` 自己的用途（性能基准，不是成功率语料）是合理的
真实感来源，但对本语料是错误的——会让"刻意的一个探针"淹没在系统性噪声里，
也会把下面第 3 点的判据搅乱。`generateImportCorpus()` 用自己的
`p0OnlyProxyEntry()`，只发 P0 建模字段，`generateLargeCorpus`/
`generateScaleCorpus` 的输出字节完全不受影响。

### 2.「导入成功」是什么

`MihomoYamlDocument.parse()` 无 syntax issue，且 `runPipeline()`（真实
`@mcs/schema-registry` 解析出的十个模块）产出的 issue 里**没有 blocking
项**——与 `apps/web/src/worker/protocol.ts` 的 `handleParse` 走同一条真实
路径，不另起一套判定。未知字段（本语料刻意埋的那一个）是 `severity: 'info'`
`blocking: false`，属于"成功"的一部分，不是失败。

### 3. 样本量与判据：N = 30，零阻断失败

版本文档字面写的是"≥99%"。**N = 100 时一条失败正好卡在阈值上**——这是一个
真实的脆弱点，本 ADR 不含糊过去：与其在 N 上做文章凑一个能被"99%"整除的
数字，本 ADR 把判据定为**零阻断失败**（`blockingCount === 0` 对每一份语料
都成立），比"≥99%"更严格，字面上蕴含"≥99%"（对任何 N ≥ 1，0 次失败 =
100% ≥ 99%），且不需要为了凑分母去猜一个"恰好允许 1 次失败"的 N。

N 取 **30**：

- 统计意义：30 个不同种子的语料，覆盖十个模块的不同随机取值组合（域名、
  端口、UUID、密码、规则目标、代理组成员……），比"1 个固定语料"更能代表
  "合法语料通常都能导入"这句话，同时不需要 N=100 那种规模。
- 运行时间：**先实测，再定数字**，不是猜的。修复下面第 4 点的真实缺陷前，
  单份语料的 `runPipeline()` 因为一个真实 bug 要 130+ 秒（见下）；修复后
  单份语料生成 + 解析 + 全量校验合计约 **2.3 秒**（本机实测，
  `generateImportCorpus()` 默认 ~1 MB，含全部十模块）。30 份语料串行约
  **70 秒**，作为 `check` job 里一个命名步骤（沿用 v0.9.0 #19「阻断项用
  命名步骤而非新 job」的先例）可接受，不需要独立 job。

### 4. 执行中发现并修复的真实缺陷：`rules:` 的每一条都被误判为 unknown-field

构建本语料的过程中，`runPipeline()` 对着一份含真实规模 `rules:` 列表
（约 13,000 条）的语料跑出了 **13,095** 个 `unknown-field` issue——几乎
等于规则总数，且让单次 `runPipeline()` 调用耗时 **138 秒**。定位：
`packages/validator/src/pipeline.ts` 的 `schemaStage` 认定一个字段"已知"
有两条路径——`buildFormPlan` 产出的具名属性（`registerKnownPath`），和
`registerDictionaryKnownPaths`（要求 `schema.type === 'object'` 且带
`additionalProperties`）。`RULES_MODULE.schema` 是 `{type:'array',
items:{type:'string'}}`——**根 schema 本身直接是数组**，不落在这两条路径
的任何一条里：`buildFormPlan`（`planObject` 只走 `schema.properties`）
对它产出 **零个** `PlannedField`；`registerDictionaryKnownPaths` 的
`schema.type !== 'object'` 守卫直接放行退出。结果是 `rules:` 数组的每一个
元素在 `document.leafPaths()` 那一步都读不到"已知"标记，全部落进
unknown-field 分支。

**这不只是语料生成的问题，是应用本身的真实缺陷**：任何真实项目只要装了
`rules` 模块（十个内置模块之一，永远都装）且有真实规则，`runPipeline()`
就会为每一条规则报一个虚假的"未知字段"info 级提示——非阻断，但真实存在、
此前从未被发现（`golden.test.ts` 的 unknown-field 存活断言用的 `MODULES`
列表本就不含 `RULES_MODULE`；`ModuleFormPage` 对一个 `buildFormPlan` 规划
不出字段的模块也渲染不出任何东西，用户在表单页看不到这个模块，自然也看
不到它的问题）。

**已修复**：`schemaStage` 现在对每个模块的根 scope 都调用一次
`registerKnownPath`（之前只在 `registerDictionaryKnownPaths` 命中或
`buildFormPlan` 产出字段时才调用）——`registerKnownPath` 本身已经支持
"schema 是标量数组则登记每个元素下标"的逻辑（v0.4.0 #3 就有），只是此前
从未被喂过一个根 schema 直接是数组的模块。修复对象-根模块是空操作（只是
多登记一次模块根路径本身，无副作用）。

**意外的连带收益**：这个 bug 同时也是 NFR-PERF-04"17.2 秒全量校验"（
`docs/releases/plans/v0.9.0-perf-baseline.md`）的主因之一——10,000 条规则
里的每一条都被误判触发一次 `MihomoYamlDocument#locate()`（O(n) 的
`toText()` 整份重新序列化），修复后同一个 1,000 实体/10,000 规则的
`generateScaleCorpus()` 基准，`runPipeline()` 从 **17,202.54ms 降到
522.91ms**——约 33 倍。这不是本 ADR 的正题（正题是语料集与判据），但如实
记录在这里，留给 #9 判断 NFR-PERF-04 是否还需要改期 1.x（大概率不需要了）。

## 结果

- 新增 `packages/test-fixtures/src/generate-large.ts` 的
  `generateImportCorpus`/`ImportCorpusOptions`/`p0OnlyProxyEntry`——不改动
  `generateLargeCorpus`/`generateScaleCorpus` 的既有签名与输出字节。
- 修复 `packages/validator/src/pipeline.ts` 的 `schemaStage`：为每个模块
  的根 scope 补一次 `registerKnownPath` 调用。
- 新增 `packages/validator/src/import-success-rate.test.ts`：30 份语料
  （`seed: BASE_SEED + i`），断言每份语料 syntax issue 为空、
  `hasBlockingIssues` 为 false，汇总分子/分母/失败样本写进测试输出。
- `docs/requirements-traceability.md`：NFR-PERF-02 行追记语料集扩面；
  NFR-PERF-04 行更新真实数字（17.2s → 0.52s）；§14.1 指标 5 的证据指针
  留给 #12 汇总时引用本文件。

## 相关

- [v0.9.0-perf-baseline.md](../releases/plans/v0.9.0-perf-baseline.md)：
  NFR-PERF-04 数字更新的完整记录
- [v1.0.0 执行计划 #3](../releases/plans/v1.0.0.md)
