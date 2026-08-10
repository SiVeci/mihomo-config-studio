# ADR-007：工作区内部包直接导出 TypeScript 源码

- 状态：Accepted
- 日期：2026-08-10

## 背景

Monorepo 内部包如果都走 `build -> dist -> 消费` 的路径，会引入构建顺序依赖、
watch 模式下的陈旧产物问题，以及每个包一份 tsup/rollup 配置的维护成本。

## 决策

`packages/*` 与 `tools/*` 全部为 `private: true` 的内部包，`exports` 直接指向 `./src/index.ts`：

```json
{ "exports": { ".": "./src/index.ts" } }
```

- 类型检查由根级 `tsc -b tsconfig.build.json` 通过 project references 完成。
- 打包由消费方（Vite for `apps/web`）统一处理，天然获得 tree-shaking。
- Vitest 直接跑源码，无需先构建。

## 结果

- 无构建顺序问题，改一个包立即对所有消费者生效。
- 代价：这些包不能直接发布到 npm。如果将来需要独立发布，需为对应包补一层构建步骤；
  这被认为是可接受的、局部的后续工作。
- 约束：内部包不得依赖 `apps/**`；由 ESLint `no-restricted-imports` 强制（ADR-001）。
