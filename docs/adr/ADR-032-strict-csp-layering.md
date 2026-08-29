# ADR-032：严格 CSP 的分层口径与部署头交付形态

- 状态：Accepted
- 日期：2026-08-29
- 相关：[ADR-008](./ADR-008-interpreted-json-schema-validator.md)、[ADR-015](./ADR-015-release-channel-and-license.md)、[ADR-029](./ADR-029-service-worker-cache-strategy.md)
- 来源：v0.9.0 切片 #4

## 背景

`apps/web/index.html` 的 CSP 从 v0.2.0 起就是 `default-src 'self'; ... style-src 'self'
'unsafe-inline'; ...`——一条脚手架起点声明，`default-src 'self'` 兜底了没有显式列出的
资源类型，`style-src` 的 `'unsafe-inline'` 从未被验证是否还需要。版本文档要求把它收紧
成一条能被 CI 核对的严格策略。

## 决策

**`default-src 'none'`，每条放行都必须对应真实用途；`tools/csp-check` 检查的是构建产物
（`apps/web/dist/**`），不是源码。**

### 最终策略：`<meta>` 与 HTTP 响应头不完全相同

```
# apps/web/index.html 的 <meta http-equiv="Content-Security-Policy">：
default-src 'none'; script-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline';
img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self';
base-uri 'self'; form-action 'self'; object-src 'none';

# apps/web/public/_headers / 自托管服务器的真实响应头（多一条 frame-ancestors）：
default-src 'none'; script-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline';
img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self';
base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none';
```

**这不是疏忽，是用真实浏览器验证过的必然结果（2026-08-29）**：`frame-ancestors`
写进 `<meta>` 时，Chrome 在控制台明确报错「The Content Security Policy directive
'frame-ancestors' is ignored when delivered via a `<meta>` element」——CSP 规范本身
规定 `frame-ancestors`（连同 `sandbox`、`report-uri`）只能通过真实 HTTP 响应头生效。
把它写进 `<meta>` 不是"多一层保险"，是**主动误导**：读代码的人会以为点击劫持防护已经
生效，实际上浏览器完全无视这一行。因此 `<meta>` 版本干脆不写它，只有 `_headers`／
自托管服务器配置里才有——`tools/csp-check` 的 `EXPECTED_META_CSP`/`EXPECTED_HEADER_CSP`
都从同一份 `DIRECTIVES` 表派生，结构上不可能手写出两份互相打架的策略；两者的差异
（仅 `frame-ancestors` 一条）由 `checkHeadersFile` 逐指令核对，而不是整串字符串比较。

### 内联样式分两类，CSP 指令不同，处理方式也不同

**样式分类前必须先弄清楚"内联样式"具体有几处——本轮实测比计划草稿设想的多一处**：

| 位置                                                          | 指令             | 处理                                                                     |
| ------------------------------------------------------------- | ---------------- | ------------------------------------------------------------------------ |
| `AppShell.tsx` 的 `<style>{RESPONSIVE_STYLE}</style>`         | `style-src-elem` | 移到真实 `.css` 文件（见下）                                             |
| `bootstrap.tsx` 的 `document.createElement('style')`          | `style-src-elem` | **计划未列出，真实浏览器测试当场抓到**——见下「设计令牌」一节             |
| `GraphView.tsx`/`RuleListPage.tsx` 的 5 处 `style={{height}}` | `style-src-attr` | 保留 `'unsafe-inline'`，虚拟列表/关系图的逐元素几何值不可能穷举成 CSS 类 |

**`style-src-attr 'unsafe-inline'` 为什么不削弱 XSS 防护**：`style` 属性无法执行脚本
（不像 `onclick=` 这类事件属性）；真正危险的 `script-src`、能注入任意选择器规则的
`style-src-elem` 都已收到 `'self'`，没有放开。

#### `AppShell.tsx` 的响应式断点

移进新建的 `AppShell.responsive.css`，断点值 `1024px` 字面写死。**这里有一处对计划
草稿的更正**：计划草稿写的是"768px（`BREAKPOINTS.mobile`）"，但读实际代码
（`AppShell.tsx` 原文、`AppShell.test.tsx` 既有断言）确认这个断点从一开始用的就是
`BREAKPOINTS.tablet.value`（`1024px`），从未是 `mobile`。字面值用错会造成真实的
布局回归（收窄时机整整差 256px），`AppShell.test.tsx` 新增一条测试直接读
`AppShell.responsive.css` 文件内容断言其中的 `1024px` 与 `BREAKPOINTS.tablet.value`
相等——令牌改了而 CSS 没跟着改，测试立刻红。

#### 设计令牌的 `:root` 注入——本片最大的真实发现

`bootstrap.tsx` 原来的写法：`document.createElement('style')` + `textContent =
cssVariables()` + `document.head.prepend(...)`——把全部 `--mcs-*` 设计令牌塞进一个
运行时创建的 `<style>` 元素。**这处完全不在计划列出的"三个文件五处内联样式"清单里**：
它不是 JSX，是裸 DOM 操作，静态审查（只搜 `<style` 和 `style=`）漏了它。真正暴露它的
是本片按流程要求做的**真实浏览器验证**（`vite preview` 加载真实构建产物）——收紧 CSP
后打开首页，控制台立刻报 `style-src-elem` 违规，且因为这个 `<style>` 元素承载了**全部
颜色/间距/圆角/密度/断点/字体令牌**，一旦被拦，整个应用的视觉样式全部失效
（背景色、按钮颜色、间距全部跌回浏览器默认值）——这不是一个可以退而求其次的边角情况，
是一次会当场影响生产环境视觉呈现的真实回归，必须修，不能记成已知缺口。

**修法**：新建 `apps/web/src/theme/apply-css-variables.ts` 的 `applyCssVariables()`，
解析 `cssVariables()` 输出的 `:root { --name: value; }` 文本，逐条 `target.style.
setProperty(name, value)` 直接设置到 `document.documentElement` 上——同一份数据，
换一种施加方式：从"创建一个带文本内容的 `<style>` 元素"（`style-src-elem` 管辖）
变成"直接改写 `style` 属性"（`style-src-attr` 管辖，与虚拟列表的高度值是**同一条**
已经放行的指令，不需要新开一个例外）。`packages/ui` 本身保持零 DOM 依赖不变
（`tsconfig.base.json` 的 `lib` 从未包含 `"DOM"`，这是有意的包/应用边界，本片不打破）
——改动完全限定在 `apps/web` 内，`cssVariables()` 仍是唯一数据源。

### `font-src` 为什么没有出现在最终策略里

计划草稿的策略字符串本身列了 `font-src 'self'`，但本片扫描真实构建产物的 CSS
（`grep -rn "@font-face\|url("`）确认本项目**不使用任何自定义字体**——全部文字走系统
字体栈。放一条没有真实用途的指令，恰好违反这条策略自己要求的"每一条放行都必须有
真实用途"，`tools/csp-check` 的存在意义也包括防止这种自我矛盾。真的引入自定义字体时，
`font-src 'self'`、`_headers`、`index.html`、`tools/csp-check` 四处要同步加，`docs/
self-hosting-headers.md` 写明了这条提醒。

## `tools/csp-check` 检查什么、不检查什么

检查**构建产物**（`apps/web/dist/index.html` 与 `apps/web/dist/_headers`），不检查
源码——源码层面的检查会漏掉构建插件或某个依赖在打包时偷偷注入的内容，而这正是本片
本身两次真实发现（响应式断点、设计令牌注入）想要机器化守住的那类问题。四层检查：
(a) 策略字符串与期望值逐字符相等；(b) 任意指令都不得含 `'unsafe-eval'`（独立于
(a)，防止未来改策略字符串时手滑带出来还没被 (a) 的比较对象跟着更新）；
(c) `script-src`/`style-src-elem` 不得含 `'unsafe-inline'`（`style-src-attr` 是唯一
例外）；(d) 产物里任何 `<script src>`/`<link href>` 不得指向外部源（含协议相对
`//host` 写法）。`_headers` 额外核对与 `index.html` 的逐指令一致性（`frame-ancestors`
是唯一允许的差异）。

## 不采纳的替代方案

- **给 `bootstrap.tsx` 的 `<style>` 元素加哈希来源**（Chrome 报错信息本身给出了
  `sha256-MblrqDoVRLCJTwWS//f3azOYI/cA4mOe5anlvT0fksI=`）。技术上可行，但设计令牌
  内容会随任何令牌改动而变化，哈希需要跟着重算——这是一个只有真实浏览器测试才会
  发现"哈希过期、样式又失效了"的隐蔽维护陷阱，而 `style-src-attr` 方案完全不需要
  维护任何派生值。
- **把 `AppShell.responsive.css` 的断点做成构建时代码生成**（从 `BREAKPOINTS.tablet`
  自动生成 `.css` 文件）。断点只有一个数字、几乎不变，字面值 + 测试断言相等已经是
  最小复杂度的正确做法；引入代码生成步骤对一个数字来说是过度工程。
- **`packages/ui` 新增一个 DOM 相关的 `applyCssVariables` 导出**，让 `apps/web` 直接
  调用。会给一个当前刻意保持零 DOM 依赖的包引入 `lib: ["DOM"]`，且 `cssVariables()`
  已经是这份数据的唯一来源，`apps/web` 侧解析它的输出文本就足够，不需要在 `packages/
ui` 里重复一遍令牌遍历逻辑。

## 结果

- `apps/web/index.html`：`default-src 'self'` → `'none'`，显式列出全部实际用到的
  资源类型。
- `apps/web/src/layout/AppShell.tsx`：不再渲染任何 `<style>` 元素。
- `apps/web/src/bootstrap.tsx`：设计令牌通过 `style` 属性而非 `<style>` 元素施加。
- 新增 `tools/csp-check`、`apps/web/public/_headers`、`docs/self-hosting-headers.md`。
- 真实浏览器验证（`vite preview` 加载 `apps/web/dist`，非 dev server）：控制台干净，
  应用视觉样式、项目导入、规则列表、关系图三个视图均正常渲染，无 CSP 违规。
- `.github/workflows/ci.yml` 新增 `csp-check` job（阻断，非 `continue-on-error`）。
