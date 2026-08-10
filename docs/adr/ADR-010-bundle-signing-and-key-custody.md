# ADR-010：Bundle 签名算法与签名密钥托管

- 状态：Accepted
- 日期：2026-08-10
- 补充：[ADR-002](./ADR-002-declarative-schema-bundle.md)
- 来源：PRD §19 待冻结事项 5

## 背景

FR-UPD-03 要求更新前验证 manifest、哈希、签名、格式版本和应用最低版本；NFR-SEC-04
要求 Bundle 必须通过哈希与数字签名验证。PRD §18 把"Schema 更新供应链攻击"的缓解
措施写为「离线默认包、签名、哈希、不可执行格式、回滚**和双人发布审核**」。

这要求冻结三件事，而 PRD 只把它们列为待决策项：签名算法、私钥托管方式、发布审批流程。

## 决策

### 1. 算法：Ed25519 + 逐文件 SHA-256

签名与验签均通过 Web Crypto `SubtleCrypto` 完成。选择理由是 Web 与 Android
（Capacitor WebView）共用同一份实现，不必为客户端引入第三方密码学库——引入密码学
依赖本身就是 PRD §18 所列供应链风险的一部分。

manifest 的 `files` 字段对每个文件记录 SHA-256；签名覆盖 manifest 本身，因此哈希与
签名共同构成完整性链。

### 2. 私钥托管：GitHub Environment secret

私钥以 **PKCS#8 DER 的 base64** 存入 secret `SCHEMA_SIGNING_KEY_B64`。签发端用
`importKey('pkcs8', …)` 加载，客户端用 `importKey('spki'|'raw', …)` 加载公钥；两端格式
在本 ADR 中固定，避免签发与验证各自猜测编码。

必须是 **Environment secret，不是 repository secret**：

```text
Settings → Environments → schema-release
  ├─ Required reviewers：≥ 2 人      ← PRD §18 的"双人发布审核"由此实现
  ├─ Deployment branches：仅 tag 与 main
  └─ Secret：SCHEMA_SIGNING_KEY_B64
```

repository secret 没有任何审批闸门，任何能触发工作流的人都能用它签名，无法满足 §18。

### 3. 信任锚点内置，且内置为一组

公钥**随应用构建产物发布**，不随 Bundle 下发。若客户端跟着 Bundle 一起取公钥，能投毒
Bundle 的攻击者也能替换公钥，签名就失去全部意义。

客户端内置的是一个公钥**数组** `[current, next]`，而非单把公钥。单钥内置意味着轮换
等于发布新版应用，且旧版客户端会直接失去更新能力；预置 `next` 使一次轮换零停机。

### 4. 签名工作流约束

- 签名 job 独立，只消费**已构建且已通过测试矩阵**的产物，不在签名 job 内重新构建。
- 签名 job 内不引入任何第三方 action，`permissions` 最小化。
- 禁止 `pull_request_target`。
- 私钥经 stdin 传入 `schema-cli`，或解码到临时文件并以 `trap` 清理；不得 `echo`，
  不得开启 `set -x`。GitHub 只对 secret 的**精确字符串**做日志遮罩，base64 一旦被
  换行、切分或重新编码就不再遮罩。

## 结果

- §19 待冻结事项 5 关闭；M0-4 的验证范围从"只验签"扩展为"签发 + 验签 + 回滚"完整闭环。
- 密钥的妥协面等于 GitHub 账号与组织权限。接受该风险，因为 Stable 发布还要额外通过
  required reviewers；若日后要进一步收紧，可将 Stable 通道改为离线/硬件密钥而 Beta
  通道保留本方案，不影响本 ADR 的其余部分。
- **待验证风险**：Web Crypto 的 Ed25519 支持在部分浏览器与 Android System WebView 上
  较新。M0-4 必须在目标最低 Android 版本的 WebView 上实测；若不可用，退回到打包一份
  经审计的纯 JS Ed25519 实现，本 ADR 的托管与审批部分不变。
- `.gitignore` 已包含 `*.pem` / `*.keystore` / `*.jks` / `.env*`，防止私钥误提交；新增
  密钥材料时必须确认落在这些模式内。
