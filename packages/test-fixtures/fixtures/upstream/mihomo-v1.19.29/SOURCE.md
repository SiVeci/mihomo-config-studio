# 来源说明

`config.yaml` 是上游 Mihomo 项目的官方示例配置文档，按字节 vendor 进本仓库，
**未做任何格式化或内容修改**。用途仅限于本仓库自己的 Schema 字段覆盖率回归
测试（`packages/test-fixtures/src/upstream.ts`）比对基线，不作为本项目功能的
一部分分发。

## 取回参数（写死，供回归断言核对）

| 项目             | 值                                                                 |
| ---------------- | ------------------------------------------------------------------ |
| 仓库             | `MetaCubeX/mihomo`                                                  |
| Tag              | `v1.19.29`                                                          |
| Commit SHA       | `e26714a181ac0e2fa803453c0a8e9a9ce94e31cb`                          |
| 文件路径         | `docs/config.yaml`                                                  |
| Git Blob SHA-1   | `0598d098e117c6ec3126beaacebc18108a292e45`                          |
| 字节数           | `134840`                                                             |
| SHA-256（本仓库计算，`upstream.test.ts` 断言用） | `47e5b8331499020cfcce75041e3612bcd7c4b94dced9d713c0107b0f70f90dbe` |
| 取回日期         | 2026-08-19                                                          |

## 取回方式与校验

通过 GitHub Blobs API **按已知的 Git Blob SHA-1 精确取回**
（`GET /repos/MetaCubeX/mihomo/git/blobs/0598d098e117c6ec3126beaacebc18108a292e45`），
而不是按分支/标签路径取回——按内容寻址的哈希取回，取到的字节就是该哈希对应
的字节，不依赖“当前 tag 指向哪个 commit”这种可能变化的间接引用。

落盘前做了两项独立校验：

1. 响应体的 `size` 字段为 `134840`，与预期一致。
2. 用响应体解码后的原始字节重新计算 Git Blob 哈希
   （`sha1("blob 134840\0" + 内容)`），结果与请求时使用的
   `0598d098e117c6ec3126beaacebc18108a292e45` 完全一致。

`SHA-256` 是本仓库另行计算并冻结的值（Git 用 SHA-1，为避免整条校验链只依赖
同一种哈希算法，回归测试改用 SHA-256）——`upstream.test.ts` 断言磁盘上这份
文件的 SHA-256 与上表一致，任何人事后"顺手整理"这份文件都会让该断言变红，
这是它能作为权威依据的前提。

## 许可证

上游仓库 `MetaCubeX/mihomo` 使用 **GNU General Public License v3.0
（GPL-3.0）**——直接读取该仓库在本提交点的 `LICENSE` 文件确认（首行为
"GNU GENERAL PUBLIC LICENSE / Version 3, 29 June 2007"）。**未采信** GitHub
仓库元信息 API（`GET /repos/MetaCubeX/mihomo`）返回的 `license` 字段：本轮
取回过程中该接口返回的 `description` 字段明显与本仓库无关（指向一个同名的
"崩坏：星穹铁道" 游戏数据 API 项目），怀疑是取回路径上的缓存或代理层返回了
错配的缓存内容，因此改为直接校验 `LICENSE` 文件内容本身，不依赖该接口。

本仓库**只把 `config.yaml` 作为比对基线引用**，不重新分发、不修改、不用于
本项目自身的运行时逻辑——仅供 `packages/test-fixtures/src/upstream.ts` 的
测试代码读取比对。
