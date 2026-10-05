import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

/**
 * **把编辑器 / 工具的原子写临时文件排除在文件监视之外**（2026-10-05）。
 *
 * ## 现场（实测两次，栈逐字相同）
 *
 * 本仓的编辑工具写文件时，会先在**同目录**建 `.<文件名>.<pid>.<uuid>.tmpdir/<文件名>.tmp`，
 * 写完再改名过去。而 vite 的 watcher（chokidar）会去 watch 那个临时文件 —— 在 Windows 上撞到
 * `EBUSY: resource busy or locked`。关键在于：那是 watcher 的**未捕获 `'error'` 事件**，
 * 于是 **vite 进程直接退出**，`tauri dev`（它的 `beforeDevCommand`）随之结束，
 * 桌面端窗口当场变成僵尸。两次分别发生在 `components/settings/ProviderEval.tsx` 与
 * `agent/fixtures/benchmarkPlanningEval.test.ts` 上（栈都落在 `node:internal/fs/watchers`
 * 的 `createFsWatchInstance` → `Object.watch`）。
 *
 * ## 这段配置**能**做什么、**不能**做什么（别把它读成"已验证的修复"）
 *
 * - **机制上**：被 `ignored` 匹配到的路径，chokidar **不会**去 `fs.watch` 它 ——
 *   而现场那次崩溃正好发生在"watch 这个临时文件"这一步。所以这些路径被排除之后，
 *   **那一处调用不可能再因为它们的锁而抛出**。
 * - **但本段的效力没有被演示过**：为了验证，我写了仓外探针按同样的形状造 `.tmpdir/<name>.tmp`
 *   （两次变体：写完就关；以及**持着文件句柄**不放开），**两次都没能让 vite 死掉** ——
 *   也就是说我**没能复现**这个崩溃，因此**无法证明**这段配置真能防住它。真实崩溃看起来是**竞态**
 *   （EBUSY 本来就是"别人正拿着这个文件"），合成探针打不中那个窗口。
 * - **结论**：这是一条**机制可信、效力未验证**的缓解。它只会让"哪些路径被监视"变少
 *   （被忽略的只是 `.tmp` 与 `*.tmpdir/`，全是写入中间态，对构建没有意义），代价接近零。
 *   **如果它再次崩溃，不要以为"这段配置应该防住了"** —— 那时应当换一条路（例如
 *   `usePolling`，或让编辑工具不要在源码目录里写临时文件），并把这次的结论一并更正。
 */
const ATOMIC_WRITE_ARTIFACTS = [/\.tmpdir[\\/]/, /\.tmp$/]

export default defineConfig({
  plugins: [react()],
  server: { watch: { ignored: ATOMIC_WRITE_ARTIFACTS } }
})
