# ADR-031：内核测试矩阵的双轨口径与 Beta 轨 digest 信任降级

- 状态：Accepted
- 日期：2026-08-29
- 相关：[ADR-012](./ADR-012-first-stable-compatibility-profile.md)、[D-003](../upstream-divergences.md)
- 来源：v0.9.0 切片 #3

## 背景

ADR-012 冻结了 Stable 兼容档案 = `v1.19.29`，D-003 记录了随之而来的妥协：上游不发布
checksum 清单，`KERNEL_DIGESTS` 表里的 sha256 是"GitHub 自己报告的资产摘要，人工核对
一次、此后固定不变"，而不是独立重新计算的值。这一整套信任模型建立在"版本号提前知道、
资产名字提前知道、digest 提前知道并被人看过"的前提上。

版本文档 §1 要求矩阵至少覆盖 **Stable `{v1.19.29}` + Beta `{latest}`**。"跟随
`latest`"直接打破上面三个前提中的两个：版本号与 digest 都只能在运行时才知道。
继续用 Stable 那套"人工核对一次、写死"的模型不可能成立——不存在"提前核对"这件事。

## 决策

**Beta 轨接受运行时解析的 digest，不假装它经过人工审阅，并且明确规定它的结论永远
不能被用来放行任何 Stable 产物。**

具体到三条：

1. **解析到的 tag 与 digest 必须打进 CI 日志**（`tools/core-test-runner/src/index.ts`
   的 `[beta] resolved upstream release ...` 一行）。这不是审计留痕的形式主义——
   它是"这次 Beta 运行到底测了上游哪一个具体构建"唯一的记录，因为仓库里不会有任何
   常量指向它。
2. **Beta 轨 `continue-on-error: true`，不阻断**（`.github/workflows/ci.yml` 的
   `core-config-test` matrix）。上游随时可能发一个改坏了什么的 `latest`，这不该让
   跟它无关的 Stable 相关工作被拦下。
3. **Beta 轨的结论不得被用来放行任何 Stable 产物**。`schema-release.yml` 新增的
   发布门只查 `core-config-test (stable)` 这一个 check 的结论，从不查 Beta、也不
   查"矩阵整体"——即使 Beta 恰好失败，Stable 该发布的还是能发布；即使 Beta 恰好
   通过，也不能拿它给 Stable 背书。

### 解析机制：`resolveLatestAsset()`（`tools/core-test-runner/src/download.ts`）

走 GitHub Releases API（`GET /repos/MetaCubeX/mihomo/releases/latest`），从返回的
`assets[]` 里挑出与 Stable 轨同一种"朴素"命名的资产
（`mihomo-linux-amd64-<version>.gz`），读取该资产**自己的** `digest` 字段
（GitHub 对通过其自身 CI 上传的资产会报告 `sha256:...`，与 D-003 已确认的
Stable 轨机制相同）作为验证依据。

**这一步比想象中更容易做错，已用真实 API 响应验证过一次（2026-08-29，
tag `v1.19.30`）**：单次 release 会同时发布几十个文件名含 `linux-amd64` 的资产——
`-compatible`、`-v1-`/`-v2-`/`-v3-`（GOAMD64 微架构级别）、多个锁定 Go 工具链版本
的构建、以及 `.deb`/`.rpm`/`.pkg.tar.zst` 包格式——朴素的子串匹配会非确定性地
选中数组里排序靠前的某个变体，而不是 Stable 轨对应的那个朴素版本。解法：正则
前后各锚定（`^mihomo-linux-amd64-v\d+\.\d+\.\d+\.gz$`），只匹配那一个精确形状。
`download.test.ts` 用真实响应形状的夹具（含全部这些干扰项）把这一点钉成回归测试。

这是 `tools/**` 的网络调用，不是 `packages/**`——`no-network-egress` job 只扫
`packages/**`，不受影响，但 `download.ts` 顶部注释显式写明这条边界，防止以后有人
把这段逻辑挪进 `packages/`。

### 不改 `KERNEL_DIGESTS` 表的结构

Beta 轨新增独立的类型（`LatestKernelAsset`）与函数（`resolveLatestAsset`/
`downloadAndVerifyLatestKernel`），不复用或改造 Stable 轨的 `KernelAsset`/
`KERNEL_DIGESTS`。两条轨的信任模型不同——一个是人工核对过的常量，一个是运行时
现学现验证的值——混进同一张表会让读代码的人分不清哪条数据经过了人工审阅。

### Alpha/开发中字段只能进 Beta Bundle

`tools/schema-cli` 新增 `checkNoUnstableFieldsForChannel()`：Bundle 目标 channel
为 `stable` 时，任何 JSON 文件里标了 `"x-unstable": true` 的字段一律拒绝打包
（`SCHEMA_CLI_UNSTABLE_FIELD_IN_STABLE_CHANNEL`）。`x-unstable` 是 JSON Schema
保留给厂商扩展的 `x-` 前缀关键字，本仓库现有校验器都不认识它，因此本身完全惰性——
这条检查是唯一赋予它含义的地方。`check`/`pack` 两个子命令都接一个可选的
`--channel`：`pack` 一定传（已知目标 channel），`check` 省略时跳过这条规则
（保持对现有调用方的向后兼容）。

### 发布门为什么查 `gh api` 而不是重新信任本工作流自己的内联步骤

`schema-release.yml` 的 `test-matrix` job 本来就会自己跑一遍 Stable 轨的内核测试
（第 56-57 行，历史遗留：跨 workflow 文件不能 `needs:`，只能重复步骤）。新增的
`gh api` 查询是另一层、独立的证据——它问的是"这个 commit 在 `main` 上被真实推送时，
`ci.yml` 的完整矩阵（现在含 Beta 轨）跑出了什么结果"，而不是"这次签发流程自己
临时又跑了一遍、恰好绿了"。两者证明的是不同的事：本工作流的内联步骤证明"此时此刻
能通过"，`gh api` 查询证明"这个具体提交在正常合入路径上已经被验证过"——签发生产
Bundle 应该要求后者。

## 不采纳的替代方案

- **Beta 轨也维护一张预先核对的 digest 表，定期人工更新**：版本文档"待你确认"
  Q4 明确问过这个问题，用户按默认做法选择跟 `latest`（真实可复现性代价已知，
  记在 v0.9.0 计划文件里，不在此重复）。
- **发布门改成重新拉取代码、在本工作流里重新跑一次 Beta 轨再综合判断**：Beta
  轨的结果本来就不该影响 Stable 发布决策（决策要点 3），跑了也不该用，等于白跑。
- **`x-unstable` 标记做成一个新的 JSON Schema 顶层 `required` 关键字或改
  `ModuleManifest` 形状**：`x-*` 厂商扩展是 JSON Schema 规范本来就留出的口子，
  不需要改任何既有类型定义；改 `ModuleManifest`/`config.schema.json` 的正式结构
  是完全不必要的重量级方案。

## 结果

- `tools/core-test-runner` 现在有两条独立的下载/校验路径，`--beta` 标志切换；
  `.github/workflows/ci.yml` 的 `core-config-test` 变成两行 matrix。
- `tools/schema-cli` 的 `check`/`pack` 都能识别 `x-unstable` 并按目标 channel
  裁决；现有全部调用方（含省略 `--channel` 的旧用法）行为不变。
- `schema-release.yml` 新增一道基于 `gh api` 的真实发布门，零新增第三方 action。
- **本版本尚未验证的部分（如实记录，非本片范围内可解决）**：本次执行环境无法
  推送触发真实 CI（见 v0.9.0 #2 的"实现记录"），因此 Beta 轨的 `resolveLatestAsset`
  在真实 GitHub Actions runner 上执行、以及 `schema-release.yml` 新发布门在真实
  `main` 提交上的行为，都还没有过一次真实运行的证据——`download.test.ts` 用真实
  API 响应形状的夹具验证了解析逻辑本身，但"这套逻辑在 CI 环境里真的跑得通"要等
  下次真实推送才能确认。
