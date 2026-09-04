# 安全策略

## 报告漏洞

请**不要**通过公开 Issue 报告安全问题。

**当前真实状态**（2026-09-05 用 `gh api repos/SiVeci/mihomo-config-studio/
private-vulnerability-reporting` 复查）：本仓库尚未启用 GitHub 的
[Private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
（`enabled: false`）——这是仓库 Settings → Security 里的一个开关，需要
仓库维护者本人开启，不是本文档能单方面声明"可用"就可用的。**在它被启用
之前，本仓库没有其它已验证的私密报告渠道**：不要把敏感的漏洞细节写进
公开 Issue，如果找到需要私下沟通的问题，请先用最小信息量开一个公开
Issue 说明"发现疑似安全问题，希望建立私下沟通渠道"，不要在其中包含
可利用细节。启用该功能后本节会更新为具体的提交入口。

报告中**请勿附带真实配置文件**：订阅 URL、密码、UUID、证书和私钥都是凭据。
如需提供复现样例，请把敏感值替换为占位符。

## 安全边界

本项目的威胁模型建立在以下不可协商的约束上。任何违反它们的改动都属于发布阻断项。

### 数据不出设备

- 默认不向任何服务器上传配置内容、节点信息、订阅 URL、UUID、密码、证书或私钥（NFR-SEC-01）。
  可执行的守卫：`no-network-egress` CI job 同时做路径级（`packages/**` 内的网络
  调用位置）与形态级（调用本身的写法）双层检查，白名单里唯一允许的网络调用是
  Bundle 更新用的 `updater.ts`，且该调用不允许带请求体。
- 不建设服务端订阅代理（[ADR-005](docs/adr/ADR-005-no-server-side-subscription-proxy.md)）。

### 遥测

MVP（含 1.0）**不开启任何遥测**（版本文档 §6）。未来若加入匿名统计，必须
单独征得用户同意（不是默认开启、事后可关闭），且只能记录功能事件与性能
数据，绝不记录配置路径、字段值或 URL——这条限制与本文件其余各节对"配置
值绝不离开本机/绝不进日志"的要求是同一约束，遥测系统不是例外。

### 日志与错误信息

- 日志和崩溃信息必须脱敏，不包含 YAML 内容和完整 URL（NFR-SEC-03）。
- 引擎抛出的错误只使用路径和错误码构造消息，不嵌入配置值。
  该约束由 `packages/yaml-engine/src/document.test.ts` 中的用例守护。
- 敏感字段（`password`、`uuid`、`secret`、订阅 URL、证书、私钥）在 UI 中默认遮罩，
  显示和复制需要显式操作（NFR-SEC-02）。可执行的守卫：`sensitivity-coverage.test.ts`
  对全部十个内置模块做逐字段走查，`SubscriptionField.tsx` 复制前不先在界面上
  显示明文。
- 导出、复制到剪贴板、系统分享三个出口在含敏感数据时会先提示，提示本身只携带
  `{segment, kind}` 这样的分类信息（例如"包含订阅地址"），`describeSensitivity()`
  从不把配置原文放进返回值（NFR-SEC-08）。

### Schema Bundle 供应链

- Bundle 只能包含声明式数据。**不存在**下载或执行远程 JavaScript / Wasm / 原生代码的通道
  （FR-UPD-07、NFR-SEC-05）。
- 安装前必须验证 manifest、文件哈希、数字签名、格式版本和应用最低版本（FR-UPD-03）。
- 校验失败一律拒绝安装，并继续使用最近一次可用版本（FR-UPD-04）。
- 手动导入的社区 Bundle 仍必须通过全部既有安全检查（哈希自洽、格式版本范围、
  静态内容检查），唯一豁免的是"签名必须由已知信任锚点签发"这一条；豁免后
  持久标记为未受信任，在 Bundle 管理页与每个使用它的项目上持续显示警告，且
  永远不能进入 Stable 通道（FR-UPD-09）。
- 应用内置一份经过测试的默认 Bundle，可完全离线工作（FR-UPD-01）。
- 签名算法为 Ed25519（Web/Android 共用同一份 Web Crypto 实现，部分环境回退到纯
  JS 实现），私钥托管、信任锚点内置与验签后端选择机制见
  [ADR-010](docs/adr/ADR-010-bundle-signing-and-key-custody.md)、
  [ADR-013](docs/adr/ADR-013-ed25519-verifier-backend.md)、
  [ADR-028](docs/adr/ADR-028-pure-js-ed25519-backend.md)。

### 不可信 YAML 输入

`packages/yaml-engine` 对所有导入内容施加限制（NFR-SEC-06），默认值见 `DEFAULT_YAML_LIMITS`：

| 限制            | 默认值 | 目的                           |
| --------------- | ------ | ------------------------------ |
| `maxBytes`      | 8 MiB  | 体积耗尽                       |
| `maxDepth`      | 64     | 深层嵌套导致的栈/时间耗尽      |
| `maxAliasCount` | 200    | 别名展开炸弹（billion laughs） |
| `maxDocuments`  | 4      | 多文档流                       |

超限时返回带错误码的诊断，**不**抛出未捕获异常，也不会部分加载。

### Web 部署

- 启用严格 CSP，不加载不必要的第三方脚本（NFR-SEC-07，
  [ADR-032](docs/adr/ADR-032-strict-csp-layering.md)）。`tools/csp-check`
  对**真实构建产物**（`pnpm run build` 的输出，不是 `vite dev`）核对，唯一
  保留的放行项是 `style-src-attr 'unsafe-inline'`，理由见该 ADR。
- 解析、全量校验和差异计算放入 Web Worker，避免恶意输入阻塞 UI（NFR-PERF-05）。

### Android

- 不申请 VPNService 权限，不启动后台网络服务（FR-AND-06、NG-02）。
- 不申请广泛存储权限；通过系统文件选择器和保存位置选择器访问用户选择的文件（FR-AND-02）。
- 项目、Schema Bundle 和历史快照存放在应用私有目录（FR-AND-04）。

## 已知边界与未覆盖项

如实列出 1.0 带着发布的缺口，而不是只写做到的部分——安全文档里藏缺口比不写
更糟：

- **Android 保存/重新打开可靠性（PRD §13.5 第五条发布阻断项）仍由人工验证，
  没有进 CI**。决策 H3：不为此引入第三方 action 或自托管带 KVM 的 runner，
  这一项因此是本仓库五条发布阻断项里唯一还不是"每次提交自动由机器把关"的一条，
  证据与映射见 [docs/release-blockers.md](docs/release-blockers.md)。
- **Android 端 E2E 整体不进 CI**（同一条决策 H3），验证仅在本机模拟器上执行。
- **NFR-PERF-01（首次可交互 < 2.5s）的达标口径是模拟器**，不是真机测量。
- 私钥托管虽满足 ADR-010 定义的算法与信任锚点结构，但 `schema-release`
  environment 的 required reviewers 当前是 **1 人**（仓库唯一维护者本人），
  低于 ADR-010 §2 原文的"≥ 2 人"——[ADR-024](docs/adr/ADR-024-single-maintainer-release-approval.md)
  记录了这条偏离与补偿措施，以及"出现第二名维护者时立即恢复"的回退条件。
- GitHub 的 Private vulnerability reporting 尚未启用，见上面「报告漏洞」一节。

这份清单会随后续版本更新；一个条目转为"已覆盖"需要指向具体的新证据，
不能只是把这一行删掉。

## 发布阻断条件

以下任意一条成立时不得发布：

1. 导入 / 导出会丢失未知字段。
2. Schema Bundle 可以执行代码或绕过签名验证。
3. 敏感配置进入日志或网络请求。
4. 任何内置模板未通过目标 Mihomo 内核配置测试。
5. Android 无法可靠保存和重新打开导出的 YAML。
