# 安全策略

## 报告漏洞

请**不要**通过公开 Issue 报告安全问题。请使用 GitHub 的
[Private vulnerability reporting](https://docs.github.com/code-security/security-advisories/guidance-on-reporting-and-writing/privately-reporting-a-security-vulnerability)
提交。

报告中**请勿附带真实配置文件**：订阅 URL、密码、UUID、证书和私钥都是凭据。
如需提供复现样例，请把敏感值替换为占位符。

## 安全边界

本项目的威胁模型建立在以下不可协商的约束上。任何违反它们的改动都属于发布阻断项。

### 数据不出设备

- 默认不向任何服务器上传配置内容、节点信息、订阅 URL、UUID、密码、证书或私钥（NFR-SEC-01）。
- 不建设服务端订阅代理（[ADR-005](docs/adr/ADR-005-no-server-side-subscription-proxy.md)）。
- MVP 不开启遥测。未来若加入匿名统计，必须单独征得同意，且只记录功能事件与性能数据，
  绝不记录配置路径、值或 URL。

### 日志与错误信息

- 日志和崩溃信息必须脱敏，不包含 YAML 内容和完整 URL（NFR-SEC-03）。
- 引擎抛出的错误只使用路径和错误码构造消息，不嵌入配置值。
  该约束由 `packages/yaml-engine/src/document.test.ts` 中的用例守护。
- 敏感字段（`password`、`uuid`、`secret`、订阅 URL、证书、私钥）在 UI 中默认遮罩，
  显示和复制需要显式操作（NFR-SEC-02）。

### Schema Bundle 供应链

- Bundle 只能包含声明式数据。**不存在**下载或执行远程 JavaScript / Wasm / 原生代码的通道
  （FR-UPD-07、NFR-SEC-05）。
- 安装前必须验证 manifest、文件哈希、数字签名、格式版本和应用最低版本（FR-UPD-03）。
- 校验失败一律拒绝安装，并继续使用最近一次可用版本（FR-UPD-04）。
- 未受信任的手动导入 Bundle 默认拒绝或隔离，并显示警告（FR-UPD-09）。
- 应用内置一份经过测试的默认 Bundle，可完全离线工作（FR-UPD-01）。

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

- 启用严格 CSP，不加载不必要的第三方脚本（NFR-SEC-07）。
- 解析、全量校验和差异计算放入 Web Worker，避免恶意输入阻塞 UI（NFR-PERF-05）。

### Android

- 不申请 VPNService 权限，不启动后台网络服务（FR-AND-06、NG-02）。
- 不申请广泛存储权限；通过系统文件选择器和保存位置选择器访问用户选择的文件（FR-AND-02）。
- 项目、Schema Bundle 和历史快照存放在应用私有目录（FR-AND-04）。

## 发布阻断条件

以下任意一条成立时不得发布：

1. 导入 / 导出会丢失未知字段。
2. Schema Bundle 可以执行代码或绕过签名验证。
3. 敏感配置进入日志或网络请求。
4. 任何内置模板未通过目标 Mihomo 内核配置测试。
5. Android 无法可靠保存和重新打开导出的 YAML。
