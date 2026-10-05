/**
 * **真正去起 `lean.exe` 的那一层**（N5b）。与判据层**分开**是这个任务能上 CI 的原因：
 * `lean4Adapter.ts` 只认一个注入的 `Lean4Runner`，而这一层是它的 Node 实现。
 *
 * ## 为什么每跑一次都要写一个**新文件**
 *
 * Lean 是按**文件**编译的，而我们每次要证的命题都不一样（点名不同、正文不同）。
 * 所以生成的源码写进系统临时目录里**唯一命名**的文件，跑完删掉。
 *
 * **两处刻意的选择**：
 * - 文件写进**系统临时目录**，不写仓库树 —— 否则每一次证明都会在 git 里留下一个未跟踪文件。
 * - 文件名带随机段：并发两次证明不会互相覆盖（这个仓里已经有过"多个写者同时跑"的教训）。
 *
 * ## 为什么是 `lake env lean` 而不是直接 `lean`
 *
 * `import Mathlib.…` 要求 Lean 在搜索路径里找到 mathlib 的 `.olean`，而那条路径由 `lake`
 * 算出来（`.lake/packages/*`）。直接调 `lean` 只会得到 `unknown module prefix 'Mathlib'`（实测）。
 *
 * 所以：**给了 `lakePath` 就走 `lake env lean`**（正确的那条路）；没给就退化成直接调 `lean`
 * （那时 `unknown module prefix` 是**如实**的失败，不是掩盖）。
 *
 * ⚠️ **`lake` 是 elan 垫片时要慢一个量级**（实测 1657–1865 ms vs 直接 125–138 ms）。
 * `resolveLean4Toolchain` 因此优先返回工具链自己的 `bin/`。
 *
 * ## 这一层的**唯一**职责是"把原始读数交出去"
 *
 * 它没有一行判定逻辑：退出码 / stdout / stderr / 墙钟 / 有没有超时，原样返回。
 * "证明成没成"永远只有一个答案，在 `judgeLean4Run` 里。
 * 这样做的直接好处是：**判据层可以完全用假输出在 CI 上测**，而这一层不需要被测。
 */

import { spawn } from "node:child_process"
import { mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import type { Lean4RunRequest, Lean4RunResult, Lean4Runner } from "./lean4Adapter"

export interface CreateLean4RunnerOptions {
  /** 临时文件落在哪儿；缺省系统临时目录。测试可以注入。 */
  tempRoot?: string
}

/**
 * **生成一个真的会起进程的 runner**。
 *
 * 超时用 `AbortController`：到点就 abort ⇒ Node 杀掉子进程 ⇒ `close` 事件带着 `code = null`
 * 回来。**这一点很重要**：被墙钟杀掉的那次运行**不是**"Lean 说失败了"，
 * 判据层靠 `timedOut` 这两个字把它分流成 `timeout`，而不是拿半截输出当证据。
 */
export function createLean4Runner(options: CreateLean4RunnerOptions = {}): Lean4Runner {
  return async (request: Lean4RunRequest): Promise<Lean4RunResult> => {
    if (request.leanPath.trim().length === 0) {
      return {
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
        timedOut: false,
        unavailableReason: "没有可用的 Lean 可执行文件（`resolveLean4Toolchain` 返回 null）。"
      }
    }
    const root = await mkdtemp(path.join(options.tempRoot ?? tmpdir(), "draw-lean4-"))
    const fileName = `Goal_${Math.random().toString(36).slice(2, 10)}.lean`
    const filePath = path.join(root, fileName)
    await writeFile(filePath, request.source, "utf8")
    const started = Date.now()
    try {
      return await runOnce(request, filePath, started)
    } finally {
      // 无论成功失败都清掉：这个目录里只有我们生成的那一个文件。
      await rm(root, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}

async function runOnce(request: Lean4RunRequest, filePath: string, started: number): Promise<Lean4RunResult> {
  const useLake = request.lakePath !== null && request.lakePath.trim().length > 0
  const command = useLake ? request.lakePath! : request.leanPath
  // `lake env lean <file>`：让 lake 把 mathlib 的搜索路径算好再交给 lean。
  const argv = useLake ? ["env", "lean", filePath] : [filePath]

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, Math.max(1, request.timeoutMs))
  if (request.signal !== undefined) {
    request.signal.addEventListener("abort", () => controller.abort(), { once: true })
  }

  return await new Promise<Lean4RunResult>((resolve) => {
    let stdout = ""
    let stderr = ""
    let settled = false
    const finish = (result: Lean4RunResult) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    let child
    try {
      child = spawn(command, argv, { cwd: request.projectDir, signal: controller.signal, windowsHide: true })
    } catch (error) {
      clearTimeout(timer)
      resolve({
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: Date.now() - started,
        timedOut,
        unavailableReason: `无法启动 ${command}：${error instanceof Error ? error.message : String(error)}`
      })
      return
    }
    child.stdout?.on("data", (chunk: unknown) => {
      stdout += typeof chunk === "string" ? chunk : String(chunk)
    })
    child.stderr?.on("data", (chunk: unknown) => {
      stderr += typeof chunk === "string" ? chunk : String(chunk)
    })
    child.on("error", (error: Error) => {
      finish({
        exitCode: null,
        stdout,
        stderr: `${stderr}\n${error.message}`.trim(),
        durationMs: Date.now() - started,
        timedOut,
        ...(timedOut ? {} : { unavailableReason: `无法启动 ${command}：${error.message}` })
      })
    })
    child.on("close", (code: number | null) => {
      finish({
        exitCode: timedOut ? null : code,
        stdout,
        stderr,
        durationMs: Date.now() - started,
        timedOut
      })
    })
  })
}
