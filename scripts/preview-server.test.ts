import { spawn } from "node:child_process"
import { once } from "node:events"
import path from "node:path"

import { expect, test } from "vitest"

const projectRoot = path.resolve(__dirname, "..")

test("preview server exits after receiving SIGTERM", async () => {
  const child = spawn(process.execPath, ["scripts/preview-server.mjs"], {
    cwd: projectRoot,
    stdio: ["ignore", "pipe", "pipe"]
  })

  try {
    await waitForPreviewServer()
    child.kill("SIGTERM")

    const exit = await Promise.race([
      once(child, "exit"),
      new Promise<"timeout">((resolve) => setTimeout(() => resolve("timeout"), 3_000))
    ])

    expect(exit).not.toBe("timeout")
  } finally {
    if (!child.killed) child.kill("SIGKILL")
  }
})

async function waitForPreviewServer() {
  const deadline = Date.now() + 10_000

  while (Date.now() < deadline) {
    try {
      const response = await fetch("http://127.0.0.1:4173/")
      if (response.ok) return
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  throw new Error("Preview server did not become ready")
}
