# ADR-001：采用模块化单体，不建设微服务

- 状态：Accepted
- 日期：2026-08-10
- 来源：PRD §9.1、§17 ADR-001

## 背景

产品职责是在用户设备上生成和管理 Mihomo 配置。配置内容包含订阅 URL、密码、UUID、证书和私钥（PRD §3）。
产品明确不运行内核、不提供 VPN、不做云同步（NG-01、NG-02、NG-03）。

## 决策

Web 与 Android 共享一组本地 TypeScript 包，不引入业务后端、数据库或微服务。
Web 以静态资源部署，Android 通过 Capacitor 复用同一份 Web 代码与共享包。

## 结果

- 配置数据默认不离开设备，直接满足 NFR-SEC-01。
- 不存在服务端订阅代理，规避 SSRF 与订阅密钥泄露（ADR-005）。
- 所有平台必须跟随同一个核心版本；包边界由 ESLint `no-restricted-imports` 规则强制维护，
  `packages/**` 不允许 import `apps/**`、`@capacitor/*` 或 `node:fs`。

## 备选方案

- 服务端渲染 + 配置托管：被 NG-03、NG-04 排除。
- 微服务：本地文件处理没有伸缩需求，只会增加隐私与运维成本。
