# ADR-022：虚拟化与关系图一律自建，不引入新运行时依赖

- 状态：Accepted
- 日期：2026-08-26
- 相关：[ADR-007](./ADR-007-source-only-workspace-packages.md)、[ADR-018](./ADR-018-mcsproj-container.md)
- 来源：v0.4.0 切片 #7（决策 E2）

## 背景

v0.4.0 需要两块新 UI 能力：万级规则列表的虚拟滚动（#7/#9/#15），以及
节点/组/规则关系图（#12/#13）。业界现成方案很多——`react-window`、
`@tanstack/virtual` 解决前者；`d3`、`elkjs`、`cytoscape` 解决后者。

## 决策

**一律自建，不引入任何一个上述依赖。**

理由与本仓库既有先例一致：`apps/web/src/router.tsx` 自建 hash router、
`apps/web/src/i18n/` 自建 i18n（不用 i18next）、`packages/project-format`
零依赖手写 ZIP（ADR-018）。这些先例的共同逻辑是「当真实需求比通用库小得多时，
自建比引入依赖更便宜」，本次两个需求都符合：

- **虚拟滚动只需要定高单列表**：规则是一维数组、每行等高（FR-RULE-02 的
  序号常显本身就要求行高固定，否则序号位置会跳动）。`react-window` 这类库
  解决的是变高、双向虚拟化、动态测量等更通用的问题，本仓库的实际形状
  用不到那些能力。
- **关系图只需要三层固定 DAG**：节点/Provider → 代理组 → 规则（PRD §8.5
  FR-REL-04 的原文结构，`packages/graph/src/layout.ts`，#12 交付）。这不是
  一个需要通用图布局引擎解开的任意图——层间顺序、层内排序都是数据决定的
  确定性输出，`d3-force`/`elkjs` 解的是「布局未知、需要迭代收敛」的问题，
  本仓库的图从来不需要迭代。

**离线优先与 Android WebView 体积是两个额外的独立理由**（不是唯一理由，
但都指向同一个结论）：NFR-SEC-01 与版本文档退出条件都要求「离线可运行」，
新依赖意味着更大的初始包体积；`apps/android` 用 WebView 加载同一份 Web
构建产物，包体积直接影响下载与安装体验。

## 能力边界（自建方案实际能做到什么）

- `packages/ui/src/virtual-list.ts` 的 `computeVirtualWindow`：纯函数，
  给定总行数、定高、容器高度、滚动位置，算出当前需要渲染的行区间与
  上下留白高度。不支持变高行、不支持横向虚拟化、不支持动态测量——这些
  都不是当前任何一个 P0 场景需要的能力。
- `apps/web/src/rules/RuleListPage.tsx`：容器高度优先用 `ResizeObserver`
  实测（真实浏览器），测试环境（jsdom 没有布局引擎）显式传入
  `containerHeight` 属性代替测量，两条路径共用同一个纯函数，行为完全一致。
- 关系图（#12/#13）：`packages/graph/src/layout.ts` 产出的坐标是纯数据
  （层号 + 层内序号），UI 侧用内联 SVG 按坐标直接画，不做任何布局计算、
  不做力导向迭代。

## 什么情况下应该 supersede 这条决策

- 如果未来真的需要**任意深度、非层级化**的图（例如用户可以任意连接任意
  两个实体，不再是「节点→组→规则」三层结构），三层固定 DAG 的假设就不
  成立，需要一个真正的图布局算法——那时候引入 `elkjs` 之类的库是合理的，
  但那是一个新的、独立的产品决策，不应该现在预先引入。
- 如果规则列表需要变高行（例如每行展开成多行详情），当前定高虚拟化就
  不够用，需要扩展 `computeVirtualWindow` 或换用支持变高的方案。
- 在那之前，继续自建：多写了几十行纯函数，换来的是离线体积、无第三方
  升级/安全维护负担、以及与本仓库既有自建先例一致的心智模型。

## 结果

- `packages/ui`：新增 `virtual-list.ts`（`computeVirtualWindow`，无 DOM、
  无 React，Node 环境精确测试 10,000 行边界：首屏、末屏、中间滚动、
  容器比内容还高）。
- `apps/web/src/rules/`：新增 `RuleListPage.tsx`，序号来自
  `startIndex + offset`（数据），不来自 DOM 顺序或渲染次序。
- 代价：#12/#13 的关系图如果需求超出三层 DAG，需要重新评估这条决策——
  已在上一节写明，不是意外发现的缺口。
