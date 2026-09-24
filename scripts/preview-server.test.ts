import { spawn } from "node:child_process"
import { once } from "node:events"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import path from "node:path"

import { expect, test } from "vitest"

const projectRoot = path.resolve(__dirname, "..")

/**
 * 这条用例测的是**服务器收到 SIGTERM 会不会退出**，与"产物里是什么"无关 ——
 * 所以它自己造一份最小产物、自己选端口，不再依赖 `build-check/` 里恰好有一份构建。
 *
 * ## 为什么必须这样（2026-09-25 CI 实测）
 *
 * 旧写法等的是 `http://127.0.0.1:4173/` 返回 200，而那需要 `build-check/mathcanvas-current`
 * 里有产物。本机一直有（跑过构建），所以它一直是绿的；**CI 上没有** —— 构建在另一个 job 里，
 * 于是 `vite preview` 对着空目录起了个"每个请求都 404"的服务器，轮询一直等到 vitest 的
 * 5 秒超时，日志里只剩 `Test timed out in 5000ms`，看不出真正原因。
 *
 * 现在：临时产物目录 + 随机端口 + 自己的超时，所以它在任何机器上都是自足的。
 */
test("preview server exits after receiving SIGTERM", async () => {
  // 放在 `build-check/` 之下（已被 .gitignore 忽略），用完即删。
  // **父目录要先建**：干净检出里没有 `build-check/`（它被忽略了），
  // `mkdtemp` 不会替你建父目录 —— 实测 CI 上就是这么红的（`ENOENT ... mkdtemp`）。
  const parent = path.join(projectRoot, "build-check")
  await mkdir(parent, { recursive: true })
  const dist = await mkdtemp(path.join(parent, ".sigterm-probe-"))
  await writeFile(path.join(dist, "index.html"), '<!doctype html><html><body><div id="root"></div></body></html>')
  const port = 4300 + Math.floor(Math.random() * 500)

  const child = spawn(process.execPath, ["scripts/preview-server.mjs"], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PREVIEW_OUT_DIR: dist, PREVIEW_PORT: String(port) }
  })

  try {
    await waitForPreviewServer(port)
    child.kill("SIGTERM")

    const exit = await Promise.race([
      once(child, "exit"),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 5_000))
    ])

    expect(exit).not.toBe("timeout")
  } finally {
    if (!child.killed) child.kill("SIGKILL")
    await rm(dist, { recursive: true, force: true })
  }
  /** 超时给足：这条用例的失败信息要落在**下面那句**上，而不是 vitest 的 `Test timed out`。 */
}, 30_000)

async function waitForPreviewServer(port: number) {
  const deadline = Date.now() + 15_000

  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`)
      if (response.ok) return
    } catch {
      // 还没起来：等一会儿再试。
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }

  throw new Error(`Preview server did not become ready on port ${port} — see the [preview-server] lines above`)
}
