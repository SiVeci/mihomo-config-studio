# ADR-020：内置 Bundle 的磁盘布局与再签发口径

- 状态：Accepted
- 日期：2026-08-19
- 相关：[ADR-002](./ADR-002-declarative-schema-bundle.md)、[ADR-008](./ADR-008-interpreted-json-schema-validator.md)、[ADR-010](./ADR-010-bundle-signing-and-key-custody.md)
- 来源：v0.3.0 切片 #6

## 背景

v0.1.0 #8 只交付了一个占位模块（`general` 的两个字段），写成 TS 字面量直接嵌进
`packages/schema-registry/src/builtin.ts`。v0.3.0 起要交付六个真实模块（PRD §8.3
P0 前半），且这些模块的磁盘形态就是 v0.5.0 `schema-cli pack` 要打包、逐文件
SHA-256、签名下发的那些文件——如果现在仍然写成 TS，发布时就要再做一次"TS → 磁盘
JSON"的转换，转换步骤本身就是"Bundle 只能是数据"这条断言失效的地方。

## 决策

### 磁盘布局

新建 `packages/schema-builtin` 包，每个模块是磁盘上的一个目录，固定七类文件：

```text
packages/schema-builtin/modules/<id>/
  module.manifest.json     # ModuleManifest
  config.schema.json       # JsonSchema
  ui.schema.json           # UiSchema
  validation.rules.json    # ValidationRule[]（没有真实约束时就是 []，不为凑数而编造）
  i18n/zh-CN.json           # Record<string, string>
  i18n/en.json               # Record<string, string>，key 集合与 zh-CN.json 完全相等
  examples/*.yaml           # 至少 valid/invalid/edge/unknown-fields 各一份
```

`packages/schema-builtin/src/index.ts` 用 `resolveJsonModule`（`tsconfig.base.json`
已开启）直接 `import` 前六类文件并组装成 `SchemaModule`，导出 `<ID>_MODULE`
常量与 `BUILTIN_MODULE_FILES: Record<bundle 内路径, SchemaModule>`。
`examples/*.yaml` **不在 `src/index.ts` 里读取**——`packages/**` 禁 `node:fs`，
这些文件只由测试代码（`builtin.test.ts`）在需要时读盘核对。

`packages/schema-registry/src/builtin.ts` 不再手写模块内容，改为从
`@mcs/schema-builtin` 取 `BUILTIN_MODULE_FILES`，自己只负责把这些模块内容
装进一个**签过名的** `BundleManifest`（`BUILTIN_MANIFEST`/`BUILTIN_BUNDLE`）。
这条边界是有意的：`schema-registry` 不需要知道模块是怎么"造"出来的，只需要知道
怎么验证和提供一个已验证的模块集合——`createRegistry`（v0.3.0 #5）的输入本来就是
`StoredBundle`，不关心它的来源。

### 再签发口径（E5）

`BUILTIN_MANIFEST.files[]` 里每一项的 `sha256` 是
`sha256(JSON.stringify(该模块的 SchemaModule 对象))`。凡是修改
`schema-builtin` 任何模块内容的切片（#7–#11 逐个新建/修改模块），该模块的
序列化字节都会变，对应的哈希、进而整份 manifest、进而其签名，全部失效。

**不允许静默失配**：`packages/schema-registry/src/builtin.test.ts` 新增一条
"再签发回归断言"——逐个重算 `BUILTIN_BUNDLE.modules` 的哈希，与
`BUILTIN_MANIFEST.files[]` 声明值比对，并另外跑一次完整 `verifyBundle`
确认签名对当前 `BUILTIN_TRUST_ANCHOR_PUBLIC_KEY_HEX` 有效。忘记重签会让这条
用例立刻变红，而不是在运行时才发现（或更糟，被 `resolveActiveBundle` 的
回退逻辑悄悄吞掉）。

**签发用一次性 bootstrap 密钥对**：离线生成 Ed25519 密钥对 → 用私钥对
`canonicalManifestJson(manifest)` 签名 → 把公钥十六进制写死进
`BUILTIN_TRUST_ANCHOR_PUBLIC_KEY_HEX` → **私钥当场丢弃，从不写入任何文件、
环境变量或提交历史**。这与 v0.1.0 #8 的既有做法一致，`builtin.ts` 里
"生产密钥重签仍是 v0.5.0 义务"的注释原样保留，不做改写。

### 为什么这不是生产签名密钥

ADR-010 §2/§3 定义的生产密钥托管（GitHub Environment `schema-release` +
`SCHEMA_SIGNING_KEY_B64`，`[current, next]` 双密钥轮换，≥2 人审批）**尚未
建立**：`.github/workflows/` 里没有任何签名 job，`schema-cli` 也没有
keygen 子命令。但内置 Bundle 是**编译进应用、从不下载**的离线兜底
（FR-UPD-01），其签名是自洽性检查（"这份内容确实是签发时的那份内容，没有
在编译或提交过程中被篡改或损坏"），不是供应链信任链的一环——Bundle
下载与更新通道整体是 v0.5.0 范围（PRD 明确 Out of scope）。用一次性
bootstrap 密钥重签，把"生产密钥托管"这件更重的事完整地留给 v0.5.0，
不提前用一把弱化的密钥去冒充它。

## 结果

- `packages/schema-builtin` 新增六个模块目录（本片交付 `general`，#7–#11
  逐个补齐 `dns`/`sniffer`/`inbound`/`proxies`/`proxy-providers`），每个都
  复用同一套七文件模板与同一套再签发流程。
- 代价：每个模块内容切片除了写 Schema/UI/规则/i18n/样例本身，还多一步
  "离线生成密钥对、重算哈希、重签、销毁私钥"的手工操作，且必须在提交前
  跑通再签发回归断言——这是本决策接受的直接代价，换来的是"内置 Bundle
  的内容与其签名不可能脱节"这条不变量始终可验证，而不是靠人记住。
- `general` 模块自身的字段选择、UI 分组与安全等级标注见提交历史与
  `packages/schema-builtin/modules/general/` 的文件本身，不在本 ADR 重复。
