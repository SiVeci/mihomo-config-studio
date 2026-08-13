# ADR-017：文字承载色层——独立于填充色板，覆盖 canvas 与 surface-card 两个底色

- 状态：Accepted
- 日期：2026-08-14
- 来源：v0.2.0 执行计划「已确认的决策」D1

## 背景

ADR-011 §2 按 WCAG 2.x 相对亮度公式复算过一次色板，但只检查了 `canvas` 一个底色，
且只针对当时已知会被当作文字使用的六个组合。`packages/ui` 落地令牌时补做了更完整的
复算（独立实现同一公式，并用 ADR-011 §2 已有的 `body`/`canvas` = 10.34:1 反向验证
实现无误），暴露出两类 ADR-011 未处理的问题：

1. **`canvas` 上更多填充色作为按钮文字不达标**：白字 on `primary` #cc785c 已由
   ADR-011 §2 记录为 3.28:1（不通过）；本次复算同一系列的 `warning` #d4a017、
   `success` #5db872、`accent-teal` #5db8a6、`accent-amber` #e8a55a，白字对比度
   分别只有约 2.37 / 2.45 / 2.37 / 2.11:1，全部远低于 4.5:1 的 AA 门槛。
2. **`surface-card` #efe9de 是本项目实际会用到的第二个正文底色**（问题面板、
   卡片内容），ADR-011 §2 从未在这个底色上验证过任何颜色。复算发现连已经通过
   `canvas` 检查的组合在 `surface-card` 上也不达标：`muted` #6c6a64 = 4.48:1、
   `primary-active` #a9583e = 4.19:1、`error` #c64545 = 4.01:1（均已用同一公式
   独立复算确认）。

版本文档的退出条件要求「CI 对比度断言通过」（#8 落地）。如果不处理，这两类问题
会让该断言必然失败，且失败的不是边缘情况，而是 FR-VAL-01 需要的 Error / Warning /
Info 三级问题展示这种核心路径。

## 决策

### 1. 新增独立的文字承载色层，不复用填充色板

`DESIGN.md` / ADR-011 的调色板定位是**填充层**：设计给大面积背景、按钮、徽章使用，
不保证在文字尺寸下达标。`packages/ui` 新增一层 `text-*` 角色令牌，专门用于文字，
且要求在 `canvas` 与 `surface-card` **两个底色上都** ≥ 4.5:1：

| 角色           | 值        | on canvas | on surface-card | 白字 on 该色 |
| -------------- | --------- | --------- | --------------- | ------------ |
| `text-primary` | `#98502f` | 5.66      | 4.93            | 5.96         |
| `text-error`   | `#a63838` | 6.14      | 5.36            | 6.47         |
| `text-warning` | `#7d5c0d` | 5.85      | 5.10            | 6.16         |
| `text-success` | `#356b45` | 5.97      | 5.20            | 6.29         |
| `text-info`    | `#33608f` | 6.21      | 5.41            | 6.54         |
| `text-muted`   | `#64625c` | 5.79      | 5.05            | 6.10         |
| `text-teal`    | `#356b61` | 5.82      | 5.07            | 6.13         |

`text-primary`（on canvas 5.66:1）与 `muted`/`primary-active`（on surface-card
4.48/4.19:1）两组数值均已用独立实现的 WCAG 公式复算确认，与规划阶段的人工计算
精确一致。

`text-info` 是新引入的蓝系角色——原调色板没有 info 色，而 FR-VAL-01 要求
Error / Warning / Info 三级问题分类，蓝色是这一级别的常规语义色。

### 2. 严重级徽章配套浅底色

`error-tint` #f7e8e5、`warning-tint` #f7f0dd、`success-tint` #e8f2e8、
`info-tint` #e7eef7。对应 `text-*` 在其上 ≥ 5.42:1，`body` 在其上 ≥ 9.15:1，
`text-muted` 在其上 ≥ 5.12:1，全部达 AA。

### 3. 填充层标注 `fillOnly`——短显式列表，不是每个令牌一个字段

`packages/ui` 用一个显式列表（`FILL_ONLY_COLORS`）而不是给每个 `ColorToken` 都加
`fillOnly` 字段来记录这条边界：`primary`、`warning`、`success`、`accent-teal`、
`accent-amber` 五个——都是曾经可能被误用作文字的饱和品牌/语义色，白字对比度只有
2.1～3.3:1 之间，承载不了文字，只能做大面积填充或非文字表面（图标、进度条）。
`primary-active` #a9583e（白字 5.06:1）、`error` #c64545（白字 4.84:1）、
`surface-dark` #181715（白字 17.91:1）刻意**不**在这份列表里——这是与
`fillOnly` 五色紧邻、容易混淆但结论相反的三个颜色，是这条边界最需要显式记录的
反例。`canvas`、`hairline`、`surface-*` 等结构性背景色从未被当作文字颜色的候选，
不属于这条边界要回答的问题，因此既不进列表也不作`fillOnly: true/false`的判断——
给它们编造一个"是否能承载文字"的答案没有意义。

**ADR-011 §2 的结论不改写**：`primary-active` 升为承载文字的珊瑚色、`muted-soft`
不用于说明文字，这两条判断依旧成立，只是现在有了更完整的第二底色验证。

### 4. 每个令牌显式标注来源

`packages/ui` 的所有令牌导出携带 `source: 'design-system' | 'mcs-extension'`：
照搬自 `DESIGN.md` 的标 `design-system`，本 ADR 新增或 ADR-011 §5 列出的应用层
扩展（密度尺度、表单状态全集、亮/暗主题对、hover 规范、严重级非颜色标记）标
`mcs-extension`。后续贡献者据此判断哪些可以直接改、哪些改动会偏离设计来源。

## 结果

- `packages/ui/src/tokens.ts` 是本决策的落地：`COLORS` 表新增 7 个 `text-*` 角色
  和 4 个 `*-tint` 角色，`FILL_ONLY_COLORS` 列表记录填充层边界。
- 对比度数值本身以 #8 的自动化断言（`contrast.ts` + 表驱动测试）为准，本 ADR
  的表格是人工复算结果，接入 CI 前不是最终事实来源。
- 与 ADR-011 的关系是叠加，不是替代：ADR-011 §1（令牌体系采纳）、§3（字体替换）、
  §4（品牌资产隔离）、§6（CI 断言的原则）不变；本 ADR 只扩展 §2 未覆盖的
  文字承载色与 §5 未定值的应用层扩展令牌。

## 相关

- [ADR-011：以 DESIGN.md 为视觉设计令牌来源，并在应用层扩展](./ADR-011-visual-design-system.md)
