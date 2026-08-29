# 自托管部署头（ADR-032，NFR-SEC-07）

ADR-015 决定本项目不提供托管服务——`apps/web` 的构建产物（`pnpm run build` 的
`dist/`）是一堆静态文件，部署方式由你自己选。`<meta http-equiv="Content-Security-Policy">`
（`apps/web/index.html`）已经把严格策略写进产物本身，浏览器不需要任何服务器配置就
会执行它。

**但 `meta http-equiv` 有一条真实限制：它无法设置 `frame-ancestors` 之外的部分响应头
级安全指令**（例如 `X-Content-Type-Options`），且部分浏览器/扩展对 `meta` 形式的 CSP
支持早于响应头形式、行为略有差异。如果你的托管平台能设置真实 HTTP 响应头，优先设置，
两边内容必须完全一致——`tools/csp-check` 会用 `apps/web/public/_headers`（下面第一种
方式）与 `index.html` 互相核对，防止两者漂移。

## 方式一：`_headers` 文件（Netlify / Cloudflare Pages）

`apps/web/public/_headers` 已经提供，Vite 构建时会原样拷进 `dist/` 根目录——
这两个平台在部署时会自动识别并应用它，你不需要额外配置。

## 方式二：nginx

```nginx
location / {
  add_header Content-Security-Policy "default-src 'none'; script-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none';" always;
  try_files $uri $uri/ /index.html;
}
```

## 方式三：Caddy

```caddyfile
header {
  Content-Security-Policy "default-src 'none'; script-src 'self'; style-src-elem 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; object-src 'none';"
}
```

## 每条指令为什么放行了它（不是复制粘贴一份"看起来安全"的策略）

| 指令                             | 为什么                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------- |
| `default-src 'none'`             | 拒绝一切未被下面任何一条显式放行的资源类型——这是本次收紧的实质内容                            |
| `script-src 'self'`              | 构建产物只有同源 `<script src="/assets/...">`，零内联脚本（已用真实 `vite build` 输出核对）   |
| `style-src-elem 'self'`          | 同源 `<link rel="stylesheet">`；ADR-032 把 `AppShell.tsx` 唯一的内联 `<style>` 元素移出后达成 |
| `style-src-attr 'unsafe-inline'` | 虚拟列表/关系图的逐元素几何值（`style={{height}}`），改成 CSS 类不可行，见 ADR-032 的权衡     |
| `img-src 'self' data:`           | 同源图标 + 内联 `data:` 图像                                                                  |
| `connect-src 'self'`             | 本应用不代理任何服务端请求（ADR-005），一切网络访问都是同源                                   |
| `worker-src 'self'`              | Web Worker（校验引擎）与 Service Worker（ADR-029）均为同源脚本                                |
| `manifest-src 'self'`            | 同源 `manifest.webmanifest`                                                                   |
| `base-uri 'self'`                | 防止 `<base>` 标签注入改写相对链接的解析基准                                                  |
| `form-action 'self'`             | 本应用没有任何跨源表单提交                                                                    |
| `frame-ancestors 'none'`         | 本应用从不设计为被嵌入 `<iframe>`，防点击劫持                                                 |
| `object-src 'none'`              | 不加载任何插件内容                                                                            |

**故意没放行的**：`font-src`——本项目未使用任何 `@font-face`/自定义字体（已扫描构建产物
的 CSS 确认），加一条没有真实用途的放行只会制造"看起来更宽松但没人知道为什么"的噪声。
未来如果引入自定义字体，同源字体文件需要新增 `font-src 'self'`，并同步更新这份文档、
`_headers`、`index.html` 与 `tools/csp-check` 的期望值——四处任一漏改，`csp-check` 会
在 CI 上报红。
