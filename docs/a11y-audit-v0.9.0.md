# v0.9.0 #12：WCAG 2.2 AA 走查

本文件是 [v0.9.0 执行计划](./releases/plans/v0.9.0.md) 切片 #12 的走查记录，关掉
`docs/requirements-traceability.md` NFR-A11Y 行挂了七个版本的"WCAG 2.2 AA
全面走查"缺口。每一条要么指向一个具体测试文件，要么如实记为未覆盖——不写
"应该没问题"这类无依据判断。

## 对比度：从"令牌声明"扩到"实际使用"

`packages/ui/src/contrast.test.ts`（ADR-011 §2、ADR-017）已经用 WCAG 2.x 公式
表驱动校验了每一条声明过的令牌组合，但只覆盖**理论上可能用到**的组合
（`text-*` × `{canvas, surface-card}`、severity tint 等），不保证**真实 CSS
文件实际配对**的组合都在表里。

新建 `packages/ui/src/contrast-usage.test.ts`：静态扫描 `apps/web/src/**/*.css`
与 `packages/ui/**/*.css`，找出同一条规则里同时设置 `color` 与
`background`/`background-color`（两边都用 `var(--mcs-color-*)`）的组合，断言
每一对都在 `contrast-cases.ts`（从 `contrast.test.ts` 拆出的共享数据模块）的
`CASES` 或 `EXEMPTIONS` 表里有对应行——新写一条 CSS 用了没审过的组合，这个
测试立刻报红，机制与"新增 `text-*` 不进表就报错"的既有覆盖守卫一致，只是从
令牌声明侧扩到了使用侧。

**走查过程中真实发现三条此前未审查过的组合**（如实记录，不是凭空举例）：

| 组合                           | 位置                                  | 对比度     | 处理                                                                                                              |
| ------------------------------ | ------------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------------- |
| `text-muted` on `surface-soft` | `YamlEditor.css` 工具栏区域           | 5.38:1     | 达 AA，补进 `CASES`                                                                                               |
| `ink` on `canvas`              | `index.css` 的 `body` 基础文字色      | 17.50:1    | 达 AA，补进 `CASES`（`ink` 与 `body`/`text-primary` 是不同的令牌角色）                                            |
| `muted` on `primary-disabled`  | `ImportPanel.tsx` 的 `:disabled` 按钮 | **4.10:1** | **不达 AA**，但这是 WCAG 2.2 SC 1.4.3 明确豁免的"非激活 UI 组件"，补进 `EXEMPTIONS`（不是 `CASES`），不假装它通过 |

第三条不是"降低标准让它过"——`EXEMPTIONS` 是一张与 `CASES` 结构不同、需要
逐条写明豁免理由的独立表，`contrast-usage.test.ts` 分别检查两张表，任何
**新的**低于 AA 的组合仍然会被拦下，除非有人也为它写一条同样需要理由的
豁免记录。

**ADR-011 §2 的两条既有修正，重新验证为机器断言**（不再只是文字约定）：

- `primary`/`warning`/`success`/`accent-teal`/`accent-amber`（`FILL_ONLY_COLORS`）
  从未在任何 CSS 规则里被用作 `color`（文字色）——扫描全部真实 CSS 文件后
  确认零命中，并把"零命中"本身变成一条会随未来改动持续验证的断言。
- `muted-soft` 从未与 13px 的 `caption` 字号在同一条规则里出现——同样扫描
  确认零命中并写成断言。

证据：`contrast.test.ts`（47 例，含两条从 `contrast-cases.ts` 导入 `CASES` 后
仍然通过的既有断言）、`contrast-usage.test.ts`（5 例）。

## 错误不得只用颜色表达（PRD §11.6）

`IssuePanel.tsx` 本身早已给每个 severity 配了非颜色的字形标记
（`✕`/`▲`/`ℹ`，`aria-hidden` 装饰性图标，文字标签才是真正的无障碍名来源）——
这是既有实现，本片新增的是**真实浏览器证据**：`e2e/a11y.spec.ts`「every
severity shows a distinct glyph alongside its text」用一份真实触发全部三种
severity 的语料（`reference.missingTarget` 错误、`ruleOrder.domainShadowed`
警告、`unknown-field` 提示），断言分组标题与每一条问题条目都同时带着字形
标记与文字，不只是 tint 背景色。

## 键盘可达性与焦点可见（PRD §11.6）

`e2e/a11y.spec.ts`「every visible interactive control is keyboard-reachable
with a visible focus indicator」：真实浏览器里从空焦点开始连续按 Tab，收集
访问到的每一个候选交互元素（`button`/`a[href]`/`input`/`select`/`textarea`/
`[tabindex]`，排除 `tabindex="-1"`、禁用、零尺寸的），断言：

1. 每一步聚焦的元素，其计算样式的 `outline` 都不是 `none`/`0px`——浏览器
   原生焦点环从未被 `outline: none` 之类的规则关闭（全仓库唯一一处显式
   `outline` 声明在 `BundlePage.css`，且只是设置颜色，不是关闭）。
2. 被标记的候选集合与真实通过 Tab 访问到的集合完全一致——不是"按了几次
   Tab 落到了某处"就算数，而是要求**全部**候选都被访问到。

**走查过程中发现并修复了一个真实的键盘可达性 bug**：`UnknownFieldTree.tsx`
原来用 `<details open={false}>`/`<summary>` 包裹内容，但 `open` 是硬编码的
`false`（从未接状态或点击处理器去切换），配套 CSS 也从未真正隐藏"关闭"时
的内容——**每个用户看到的都是展开状态**。但浏览器对"关闭的 `<details>`"
排除其内容进入 Tab 序列这件事，是**原生行为**，与 CSS 的 `display` 覆盖
完全无关——也就是说，视觉上一直可见的"跳到 YAML 行"/"搜索官方文档"按钮，
键盘用户实际上**永远按 Tab 都到不了**，只有鼠标点击才能碰到。这正是本片
存在的意义：jsdom 没有真实 Tab 序列（不会区分"关闭的 details"），只有真实
浏览器测试才能抓到。

**修复**：这个组件从来没有真正实现过展开/折叠（没有状态、没有点击切换），
CSS 也一直让它保持展开——与其为了"看起来合理"去补一套没人要求过的折叠交互，
不如让标记匹配一直以来的真实行为：去掉 `<details>`/`<summary>`，改成普通
`<section>` + `<h2>`。证据：`UnknownFieldTree.test.tsx` 新增一例断言不再有
`<details>` 标签且按钮可正常访问；`e2e/a11y.spec.ts` 的键盘可达性断言修复后
转绿。

## 拖拽的键盘替代（NFR-A11Y、WCAG 2.5.7）

`RuleListPage.tsx` 的 `Alt+↑/↓/Home/End` 与原生 HTML5 拖拽共用同一个
`handleMove(from, to)` 写回路径，`RuleListPage.test.tsx`/`ProjectPage.test.tsx`
早已有 jsdom 层证据。真实浏览器层面：

- **Alt+ArrowDown**：`e2e/web.spec.ts`「reorders rules with the keyboard,
  Alt+ArrowDown」（v0.9.0 #7 已交付）——追踪表 NFR-A11Y 行原先记着"Alt 组合键
  在人工浏览器核对中受限于自动化工具自身的按键模拟能力，未能重复触发"，
  Playwright 的 `keyboard.press()` 没有这个限制，这条测试已经补上那个缺口。
- **Alt+Home / Alt+End**：本片新增 `e2e/a11y.spec.ts` 的两个场景，验证移动到
  列表首/尾位置，与 ArrowDown 场景互补，不重复实现同一个操作。

## WCAG 2.2 新增准则逐条走查

| 准则                                | 结论                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.4.11 Focus Not Obscured (Minimum) | **达标（推理 + 结构核对，非自动化）**。全仓库只有两处 `position: fixed`：`BottomNav.css`（基准规则即 `display: none`，仅窄屏 `@media` 内启用；`AppShell.responsive.css` 同一 `@media` 块给 `.app-shell__main` 加了 `padding-bottom: calc(...+56px)`，专门为不被这个固定导航条遮住而预留空间）、`UpdateBanner.css`（小尺寸、底部居中的胶囊按钮，`z-index: 1000`，只在真有新版本时短暂出现）。AA 级别（Minimum）只要求焦点元素不被**完全**遮挡，两处都不构成结构性风险。未写自动化断言——真正决定性的证据需要真实触发这两种場景并测焦点元素的可见区域，超出本片时间范围，如实记为推理结论而非测试证据。 |
| 2.5.7 Dragging Movements            | **达标**：本仓库唯一的拖拽交互是 `RuleListPage` 的规则重排，`Alt+↑/↓/Home/End` 是完整的单指针替代——见上一节。`GraphView` 是只读关系图，没有拖拽交互。                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 2.5.8 Target Size (Minimum)         | **达标**：ADR-011 §2 已确认 36px 图标按钮满足 24×24（AA 口径，`DESIGN.md` 自称的"slightly under 44"是 AAA/SC 2.5.5 口径，不适用）。本片额外核对了复选框：`RuleListPage.css` 的 `.rule-list__checkbox` 与 `form-renderer/controls.tsx` 的 `type="checkbox"` 都没有任何宽高/内边距覆盖——尺寸完全由浏览器原生渲染决定，命中 SC 2.5.8 "user agent control"豁免条款（作者从未修改过原生控件的默认尺寸），不构成违反。                                                                                                                                                                                     |
| 3.2.6 Consistent Help               | **不适用**：本应用没有全局"帮助/联系/关于"入口，唯一近似"帮助"的东西是逐字段的"查看官方文档"链接——这是**跟随具体 schema 字段**渲染的上下文帮助，不是跨"页面"（本应用也没有传统多页面导航模型）反复出现、需要保持相对顺序一致的全局机制，SC 3.2.6 描述的场景在本应用里没有对应物。                                                                                                                                                                                                                                                                                                                    |
| 3.3.7 Redundant Entry               | **不适用**：本应用是本地优先的单用户配置编辑器，没有账号注册、结账、分步向导之类会要求用户在同一流程内重复填写同一信息的场景（项目名称、描述、导出文件名等都只需要填一次）。SC 3.3.7 描述的场景在本应用里没有对应物。                                                                                                                                                                                                                                                                                                                                                                                |

## 结果

- `packages/ui`：新增 `contrast-cases.ts`（从 `contrast.test.ts` 拆出
  `CASES`/`ContrastCase`/`TEXT_ROLES`/`SEVERITY_TINTS`/`TEXT_ROLE_BY_TINT`，
  新增 `EXEMPTIONS`/`ContrastExemption`）、`contrast-usage.test.ts`（新建，
  5 例）；`contrast.test.ts` 改为导入而非本地声明，行为不变（47 例，较此前
  45 例多两条新审查的真实组合）。
- `e2e/a11y.spec.ts`（新建，4 例）：非颜色表达、键盘可达性+焦点可见、
  Alt+Home、Alt+End。
- 修复一个真实 bug：`apps/web/src/form/UnknownFieldTree.tsx` 去掉从未真正
  工作过的 `<details>`/`<summary>` 折叠外壳（视觉上一直展开，但键盘用户
  永远访问不到其内容），改为普通 `<section>` + `<h2>`；
  `UnknownFieldTree.test.tsx` 新增一例回归断言。
- `docs/requirements-traceability.md`：NFR-A11Y 行 Partial → Done。
