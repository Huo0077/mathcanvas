> **当前状态**：见 [当前状态](../../docs/current-status.md) —— 它是"现在时"的唯一来源。此处原有的 2026-10-16 快照已移除：同一段文本曾被复制进 13 个文件并开始漂移，状态只维护一份。

<!-- progress-scope: active-reference -->
> **文档角色（2026-11-15 对齐）**：桌面技术/使用说明；发布、安全与真实provider状态只从统一入口读取。实时状态仅维护在[当前状态](../../docs/current-status.md)；执行总顺序以[完整实施主计划](../../docs/superpowers/plans/2026-11-15-main-restart-master-plan.md)为准，[机器任务合同](../../docs/superpowers/plans/2026-11-15-implementation-task-ledger.json)只定义依赖/文件/验收，不另维护完成率。历史数字不能代替本轮证据。
<!-- /progress-scope -->

/**
 * MathCanvas 桌面外壳（Tauri 2）—— **前端仍是 `apps/web` 那一份，不重复实现**。
 *
 * 这个包里只有两样东西：
 * - `src-tauri/`：Rust 侧的外壳与具名 IPC 命令（见 `src-tauri/src/lib.rs` 与 `runtime.rs`）；
 * - `tsconfig.json`：给 IDE 用的空壳配置（这个包**没有**自己的 TypeScript 源码）。
 *
 * ## 为什么前端不在这里复制一份
 *
 * 计划 Task 1.1 的接口要求原文："The desktop frontend imports the existing `apps/web`
 * application without duplicating the geometry store."
 * 所以 `tauri.conf.json` 的 `frontendDist` 直接指向 `apps/web` 的构建产物
 *（`build-check/mathcanvas-current`），`beforeDevCommand` / `beforeBuildCommand`
 * 也走 `npm run … --workspace @draw/web`。桌面外壳只是**换了一层壳**，
 * 几何文档、store、交互全都还是网页那一份 —— 复制一份 store 是这类项目最容易犯、
 * 也最难挽回的错（两份真相从第一天起就会分叉）。
 *
 * 前端的桌面能力探测与自述在 `apps/web/src/services/desktopRuntime.ts`。
 */
export {}
