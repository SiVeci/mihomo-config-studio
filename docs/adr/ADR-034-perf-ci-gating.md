# ADR-034：性能基准的 CI 阻断阈值，与"阈值对着什么硬件说"

- 状态：Accepted
- 日期：2026-08-30
- 相关：[ADR-030](./ADR-030-minimum-node-baseline.md)
- 来源：v0.9.0 切片 #10；退出条件 5（NFR-PERF-02/03/04）；PRD §11.1

## 背景

`perf-baseline` job 自 v0.2.0 起只记录 `import.bench.ts`/`scale.bench.ts` 的
数字，`continue-on-error: true`，从不阻断。本片要把它变成真闸门。

计划本身预期"现有余量极大，阻断的真实风险在 CI 噪声造成假失败，不在指标
本身不达标"——v0.9.0 #1 拿到本仓库第一批真实 CI 数字后，这个前提被推翻了
一半：

| 指标（CI 实测，`ubuntu-latest`，10 次采样）         | 数值                          | PRD 门槛 | 结论                                   |
| --------------------------------------------------- | ----------------------------- | -------- | -------------------------------------- |
| `parse + first validation pass (total)`             | mean 4086.22ms（3922–4605ms） | 2000ms   | **超标约 2 倍**                        |
| `single moveSeqItem`                                | 0.0102ms                      | 100ms    | 余量约 9800×                           |
| `100 consecutive moves`                             | 1.9544ms                      | 100ms    | 余量约 51×                             |
| `applyBatch-equivalent replacing 1000 rule targets` | 78.2492ms                     | 100ms    | 余量仅约 1.28×                         |
| `runPipeline, all stages`                           | 21604.24ms                    | （无）   | 已知的批量校验开销，不在本片门槛范围内 |

同一台本机（未受本会话并发负载干扰的历史基线，`docs/releases/plans/v0.2.0-perf-baseline.md`）
上 `parse + first validation pass (total)` 是 580.57ms——CI 比本机慢约 7 倍。
PRD §11.1 给 NFR-PERF-01（应用首次可交互）明确写了"中端 Android 设备"，但
NFR-PERF-02（1 MB YAML 导入解析）**没有指定硬件**。这个空白必须先填上，否则
"阻断"这件事本身没有对象：是要求 CI runner 在 2 秒内跑完，还是要求真实用户
的设备在 2 秒内跑完？

## 决策

**NFR-PERF-02/03/04 的毫秒数字，描述的是真实终端用户设备上的体验，不是
GitHub Actions 共享 runner 的算力。** 理由：

1. NFR-PERF-01 已经明确把"首次可交互 < 2.5 秒"这个同类指标锚定在"中端
   Android 设备"——这是本产品的 Web 界面在真实移动 WebView 里的目标体验。
   NFR-PERF-02 描述的是同一个 Web 界面处理一份大配置文件的体验，没有理由
   换一套度量对象。
2. GitHub 免费共享 runner（2 vCPU、与其他租户共享、时钟频率不保证）是已知
   的弱且不稳定的算力来源，不代表任何真实用户会用来跑这个 Web 应用的设备
   ——无论是移动端 WebView 还是桌面浏览器。用它的墙钟时间直接对照 PRD 的
   终端用户体验数字，测的是"这台 runner 今天有多快"，不是"这个产品是否达标"。
3. 但**不是所有指标都受这个问题影响**：`single moveSeqItem`/`100 consecutive
moves` 在 CI 上有 51×~9800× 的余量，任何合理的 runner 算力波动都不可能
   吃掉这个量级的差距——对这两条，CI 墙钟时间和真实设备体验之间的换算误差
   可以忽略，直接拿 PRD 原始数字（100ms）做阈值。真正受硬件差异问题影响的
   只有 `parse + first validation pass (total)`（7 倍差距、且贴着门槛）和
   `applyBatch-equivalent`（1.28× 余量，同样贴着门槛）。

**因此阻断阈值分两类，都进 `tools/perf-gate/thresholds.json`（进仓库、可
评审）：**

- **PRD 原始数字直接生效**（`single moveSeqItem`、`100 consecutive moves`：
  100ms）——硬件差异不足以影响判断。
- **CI 校准阈值**（`parse + first validation pass (total)`：7000ms；
  `applyBatch-equivalent replacing 1000 rule targets`：150ms）——由已观测到的
  CI 实测最大值乘以一个明确写出的余量倍数得到（约 1.3×~1.9×），职责是**在
  CI 上捕捉相对回归**（这次改动是不是比上次明显更慢），不是断言"这就是
  终端用户会看到的时间"。PRD 数字本身（2 秒、100ms）作为终端用户体验目标
  继续有效，但要在真实终端硬件（或至少一台有代表性的桌面浏览器/移动
  WebView）上核实，本机口径记入版本证据文档，不由这个 CI job 断言——这与
  决策 H3（Android 冷启动走本机模拟器、不进 CI）是同一个原则的延伸。

**取中位数，不取单次值或均值。** `vitest bench` 每个 `bench()` 调用本身
已经在一次调用内产生多个样本（`BENCH_OPTIONS = { time: 3000 }` 加上单次
迭代耗时较长时 tinybench 的最小采样保证，本仓库两个 bench 文件实测每条有
10~14 个样本），JSON 输出（`--outputJson`）里每条 benchmark 自带
`tinybench` 算好的 `median`/`mean`/`p75`/`min`/`max`——`tools/perf-gate`
只读 `median` 字段，不需要额外跑多次 CI job 来凑样本量。

**只阻断 PRD 数字或其直接派生量确实覆盖到的 benchmark。** `parse`/
`first validation pass (pre-parsed document)` 是 `total` 的两个分量，PRD
只对 `total` 给了数字，不阻断分量本身（继续显示在 CI 日志里，供排查用）；
`runPipeline, all stages` 是已知的全量重新校验开销（追踪表早已记录的
`schemaStage` 瓶颈），不是"常规编辑反馈"，PRD 没有给它单独的数字，本片不
凭空发明一个。

## 计划文本的一处修正

计划原文的验收命令写的是 `vitest bench --run --reporter=json
--outputFile=perf.json`——实测（直接跑一次核实，而非照抄）`--reporter=json`
在 `vitest bench` 模式下不是合法的 reporter 名（`Failed to load url json`），
`vitest bench --help` 列出的真正标志是 `--outputJson <filename>`。已按实测
结果改写验收命令与 CI 步骤，计划文件本身不改历史记录，只在本片实现记录里
注明。

## 不采纳的替代方案

- **直接用 PRD 的 2000ms/100ms 原始数字阻断所有指标**：会让 `parse +
first validation pass (total)` 这条从引入阻断的第一天起就是假红——不是
  因为产品变慢了，是因为测量对象（CI runner）从来不是数字描述的对象（终端
  用户设备）。这正是"红了但没人管，大家学会忽略"的反面教材，与
  `pnpm run check`/覆盖率闸门"必须真实可信"的既定原则相悖。
- **保持 `continue-on-error: true`，只加日志/告警**：不满足本片"变成真闸门"
  的目标，也是版本文档退出条件 5 明确要求关闭的缺口。
- **完全不阻断 NFR-PERF-02，只阻断 03/04**：回避了 #1 已经摆在桌面上的真实
  发现（"2 秒对着什么硬件说"这个问题终究要回答），把决策推给未来某次真的
  遇到 CI 长期不稳定时再处理，属于本片计划要求明确回答而非搁置的问题。
- **引入 `reactivecircus/android-emulator-runner` 之类的第三方 action 换更强
  的 CI 算力**：不解决"墙钟时间与终端用户设备不对应"这个根本问题（换一台
  更快的 CI 机器，PRD 数字描述的仍然是终端用户设备，不是这台新 CI 机器），
  且与既定的"零新增第三方 action"姿态冲突。

## 结果

- 新增 `tools/perf-gate/`（`src/gate.ts` 纯函数、`src/index.ts` CLI 包装，
  与 `egress-check`/`csp-check` 同款结构）+ `thresholds.json`（进仓库）。
- `.github/workflows/ci.yml` 的 `perf-baseline` job 去掉
  `continue-on-error`，两个 `vitest bench` 步骤加 `--outputJson`，新增一步
  跑 `tools/perf-gate` 断言。
- 四条指标进阻断范围（两条 PRD 原始数字、两条 CI 校准数字，见上表）；
  `parse`/`first validation pass` 分量与 `runPipeline, all stages` 继续
  只记录不阻断。
- 真实终端设备上的 NFR-PERF-02/03/04 核实仍是人工口径（本片不新增终端
  设备测量能力），CI 校准阈值捕捉的是"相对这次 CI 基线是否明显变慢"，不是
  "是否达到终端用户体验目标"——两件事分开记录，不互相冒充。
