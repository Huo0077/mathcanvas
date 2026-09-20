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
