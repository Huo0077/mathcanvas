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
 * - **但本段的效力**：**有两次实地观察支持，仍非决定性**。为了验证，我写过仓外探针按同样形状造 `.tmpdir/<name>.tmp`
 *   （两种变体：写完就关；以及**持着文件句柄**不放开），**两次都没能让 vite 死掉** —— 也就是**没能复现**这个崩溃
 *   （真实崩溃看起来是**竞态**：EBUSY 本来就是"别人正拿着这个文件"）。
 *   但加上这段配置**之后**，同样的动作做过两次、**都没再崩**：① 控制器改 5 个 app 文件；② 实施者在一轮里对
 *   `ProviderEval.tsx` 触发**约 30 次** HMR 更新（日志里逐条可见）—— 期间没有出现过一次 EBUSY。
 *   相比之下，加它**之前**同样的动作**崩过两次**。
 * - **结论**：机制可信（被忽略的路径 chokidar 不会 `fs.watch`，而崩溃正发生在这一步）+ 两次实地观察；
 *   代价接近零（被忽略的只是 `.tmp` 与 `*.tmpdir/`，全是写入中间态，对构建没有意义）。
 *   **但如果它再次崩溃，不要以为"这段配置应该防住了"** —— 那时应当换一条路（例如 `usePolling`，
 *   或让编辑工具不要在源码目录里写临时文件），并把这里的结论一并更正。
 */
const ATOMIC_WRITE_ARTIFACTS = [/\.tmpdir[\\/]/, /\.tmp$/]

export default defineConfig({
  plugins: [react()],
  server: { watch: { ignored: ATOMIC_WRITE_ARTIFACTS } }
})
