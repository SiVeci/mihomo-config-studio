# ADR-024：单维护者仓库下的发布审批偏离

- 状态：Accepted
- 日期：2026-08-28
- 偏离：[ADR-010](./ADR-010-bundle-signing-and-key-custody.md) §2
- 来源：v0.5.0 切片 #14，决策 F2（2026-08-27 用户答复）

## 背景

ADR-010 §2 要求 `schema-release` environment 的 required reviewers **≥ 2 人**，
实现 PRD §18 "双人发布审核"的缓解措施。

`origin` 是个人仓库：`git config user` 只有一个真实身份（SiVeci），凑不出第二名可以
审批的维护者。若字面照搬 ADR-010 §2，`schema-release` environment 要么永远批不出去
（唯一维护者不能审批自己发起的部署），要么被迫把 required reviewers 设成允许发起者
自我批准——两者都不是"双人审核"，只是把约束写在纸面上而没有真实效力。

## 决策

**Required reviewers 降为 1 人**（仓库唯一维护者本人），并用四项补偿措施把
"个人仓库、单人可批准"这一现实约束下能拿到的安全边际提到最高：

1. **Deployment branches 限定为 tag（`v*`），不含 `main` 或任何分支**——比 ADR-010
   §2 原文"仅 tag 与 main"更紧：`main` 上的任何一次推送都不能触发发布，只有显式打的
   版本 tag 才行，缩小了"哪些提交有资格被签名发布"的范围。
2. **禁止 `pull_request_target`**——即使仓库将来接受外部 PR，发布工作流也不会在
   拥有 secret 访问权限的上下文里跑一份不受信任的 PR 代码。
3. **签名 job 零第三方 action**——只用 `actions/checkout`、`actions/setup-node`、
   `pnpm/action-setup`、`actions/upload-artifact`/`download-artifact`，与
   `ci.yml` 已经在用的同一组，不为发布流程新增任何供应链攻击面。
4. **`permissions` 最小化**——签名 job 仅有 `contents: write`（发 Release 需要），
   其余 job 一律 `contents: read`。

**不修改 ADR-010 原文**：ADR-010 §2 描述的是"这个仓库有多名维护者时"应该长成什么样，
仍然是本项目未来的目标状态，不是被推翻的决策。本 ADR 记录的是"当前只有一名维护者"这一
临时现实与 ADR-010 之间的偏离，以及为弥补它做了什么。

## 回退条件

**出现第二名维护者时，立即把 required reviewers 恢复到 ADR-010 §2 原文的 ≥ 2**，
不需要新的 ADR——本 ADR 本身就是那次恢复的触发条件。届时本 ADR 状态改为
Superseded，指向该次恢复的 PR。

## 结果

- `schema-release` environment 的 required reviewers = 1（仓库所有者本人）。
- 发布审批仍然是**结构性的闸门**（`workflow_dispatch`/`push: tags: v*` 触发后必须
  经过环境审批才能进入签名 job），而不是被完全跳过——"批准的人是谁"被削弱了，
  "有没有批准这一步"没有被削弱。
- 密钥妥协面与 ADR-010「结果」一节已经承认的一致：等于 GitHub 账号与组织权限；本 ADR
  额外承认"审批本身可被同一账号越过"这一现实，不假装两人审核帮不上唯一维护者的忙。
