import path from "node:path"
import { existsSync } from "node:fs"
import { preview } from "vite"

const root = path.resolve(process.cwd(), "apps/web")

/**
 * 产物目录与端口**可以用环境变量覆盖**（测试用）。默认值就是 e2e 与桌面外壳约定的那一份 ——
 * `tauri.conf.json` 的 `frontendDist` 指的也是它。
 */
const outDir = path.resolve(process.cwd(), process.env.PREVIEW_OUT_DIR ?? "build-check/mathcanvas-current")
const port = Number(process.env.PREVIEW_PORT ?? 4173)

/**
 * 产物不存在时**明确说一句**：`vite preview` 对着空目录照样会起来，只是每个请求都 404，
 * 于是调用方看到的是"服务器起来了、页面打不开"，而不是"你没构建"。
 *
 * 这不是假想的：2026-09-25 CI 上 `checks` 里那条"preview server 收到 SIGTERM 会退出"的用例
 * 就是这么红的 —— 它先等 `http://127.0.0.1:4173/` 返回 200，而那个 job 里没有构建产物，
 * 轮询一直到 vitest 的 5 秒超时，日志里只剩 `Test timed out in 5000ms`，看不出真正原因。
 */
if (!existsSync(path.join(outDir, "index.html"))) {
  console.warn(`[preview-server] 产物目录里没有 index.html：${outDir}`)
  console.warn("[preview-server] 先跑 `npm run build --workspace @draw/web`；否则每个请求都会 404。")
}

const server = await preview({
  root,
  configFile: false,
  build: { outDir },
  preview: { host: "127.0.0.1", port, strictPort: true }
})

const close = async () => {
  await server.close()
  process.exit(0)
}

process.once("SIGINT", close)
process.once("SIGTERM", close)
