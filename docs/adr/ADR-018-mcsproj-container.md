# ADR-018：`.mcsproj` 容器格式：零依赖手写 ZIP，确定性字节输出

- 状态：Accepted
- 日期：2026-08-16
- 相关：[ADR-007](./ADR-007-source-only-workspace-packages.md)、[ADR-008](./ADR-008-interpreted-json-schema-validator.md)、[ADR-004](./ADR-004-project-locks-compatibility-profile.md)

## 背景

FR-PROJ-06 要求便携项目包 `.mcsproj`，PRD §8.1 定为 ZIP 容器，至少包含
`manifest.json`、`config.yaml`、`ui-state.json`、`schema-lock.json`。

业界默认选择是引入 [fflate](https://github.com/101arrowz/fflate) 或类似库。但：

1. 与 ADR-008 同一条供应链姿态——本仓库对"进代码库的第三方依赖"始终选择
   能力换掉后自己维护，而不是随手加一个包。ZIP 读写不是复杂算法，压缩本身
   平台已经提供。
2. **确定性字节输出**是本片验收的核心：「同一个项目导出两次必须逐字节相同」
   需要对条目顺序、时间戳、extra field、data descriptor 有完全控制。第三方库
   为了兼容性通常会写入当前时间戳或平台特定的 extra field，达成确定性反而要
   传一堆选项去关掉这些默认行为，不如自己写。

## 决策

`packages/project-format` 零依赖手写 ZIP 读写（`zip.ts`）：

- 压缩用平台内置 `CompressionStream('deflate-raw')` /
  `DecompressionStream('deflate-raw')`（原始 DEFLATE，对应 ZIP 压缩方法 8，
  无 zlib/gzip 包装）。Node ≥ 18 与现代浏览器均原生支持，Web 与未来 Android
  WebView 两端不需要 polyfill。
- CRC-32 自算——两个运行时都不把它当基础库函数暴露，ZIP 格式又强制要求，
  只能自己实现（标准查表法，`IEEE 802.3` 多项式 `0xEDB88320`）。
- 只实现读写自身产物所需的最小子集：local file header、central directory
  file header、End Of Central Directory record 三段，不支持多卷、ZIP64、
  加密条目——这些都不是 `.mcsproj` 的场景。

确定性约定（同一份内容导出两次必须逐字节相同）：

- **固定条目顺序**：`manifest.json` → `config.yaml` → `ui-state.json` →
  `schema-lock.json`，由调用方（`mcsproj.ts`）而非 ZIP 层保证。
- **固定 DOS 时间戳**：`1980-01-01 00:00:00`（该格式能表示的最早日期），
  而非真实写入时刻。
- **不写 extra field，不写 data descriptor**：每条目的大小和 CRC-32 在压缩
  完成后立即知道，不需要 data descriptor 这种"先写内容、后回填长度"的
  变通字段。
- JSON 三个文件（`manifest.json`/`ui-state.json`/`schema-lock.json`）用
  深度按键排序后的 `JSON.stringify` 序列化，而非直接对调用方传入的对象调用
  `JSON.stringify`——后者的键顺序取决于对象是如何被构造出来的，尤其
  `ui-state.json` 是开放的 app 自有数据袋，调用方构造顺序不受本包控制。

`config.yaml` 原样存取：进容器前不重新格式化，出容器后在交给
`MihomoYamlDocument.parse` 之前不做任何规范化——`writeMcsproj`/`readMcsproj`
只做 `TextEncoder`/`TextDecoder` 编解码，不触碰文本内容本身。否则 M0-1 的
无损往返性质会在项目包这一层被悄悄破坏。

`schema-lock.json` 只固定 `bundleVersion` + `compatibilityProfile`
（ADR-004 已定的最小集合），迁移逻辑不属于本片。

`describeSensitivity(project)` 只返回结构化判定
（`{segment: 'config.yaml', kind}`，`kind` 取
`subscription-url`/`password`/`uuid`/`private-key`），不返回匹配到的原文或
文案——文案渲染是 #15 的 i18n key。判定基于对 `configText` 的正则扫描而非
真正解析 YAML（不为此再拉一个 `@mcs/yaml-engine` 依赖），因此是**宁可错报，
不可漏报**的启发式，与 `schema-core` 对密钥形态字段名的遮罩策略
（NFR-SEC-02）同一立场。

## 结果

- 读写往返、确定性输出、CRC-32 校验、错误路径（缺条目/JSON 损坏/manifest
  字段类型错误/ZIP 签名不匹配/CRC 不匹配）均有测试覆盖，`zip.ts`/`mcsproj.ts`
  行/分支/函数覆盖率 100%。
- 代价：只支持自身产物结构；遇到其它工具产出的、带 data descriptor 或
  ZIP64 的大型归档会读取失败（`.mcsproj` 场景不会遇到，本仓库自己是唯一
  写入方）。
- `describeSensitivity` 是启发式，不保证零漏报；真正的敏感字段识别精度
  提升（例如按 Schema 字段级别而非整份文本）留待后续版本视需要处理。
