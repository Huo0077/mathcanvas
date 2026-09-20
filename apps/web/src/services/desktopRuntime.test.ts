import { afterEach, describe, expect, it } from "vitest"

import { describeRuntime, isDesktopShell, readDesktopRuntime, type DesktopRuntimeInfo } from "./desktopRuntime"

/**
 * 桌面自述的前端那一半（Task 1.1 Step 4）。
 *
 * 最要紧的一条性质：**在浏览器里跑是正常状态，不是错误**。同一个 web 产物既要能当网页打开、
 * 也要能在 Tauri 里跑，所以"没有原生侧"必须如实回 `null` 而不是抛异常 —— 否则
 * `npm run dev` 一打开就报错，开发体验直接坏掉。
 */
const internalsKey = "__TAURI_INTERNALS__"

function installInvoke(invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>) {
  Object.defineProperty(globalThis, internalsKey, { configurable: true, writable: true, value: { invoke } })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, internalsKey)
})

const sample: DesktopRuntimeInfo = {
  platform: "windows",
  appVersion: "0.1.0",
  runtime: "webview",
  webviewVersion: "153.0.4234.48",
  dataRoot: "com.mathcanvas.desktop",
  secretStore: "not_implemented",
  repository: "not_implemented",
  transport: "not_implemented"
}

describe("desktop runtime detection", () => {
  it("reports a plain browser as 'not a desktop shell' instead of failing", async () => {
    expect(isDesktopShell()).toBe(false)

    const result = await readDesktopRuntime()

    expect(result.ok).toBe(true)
    expect(result.desktop).toBe(false)
    // 收窄后再断言：`expect(...)` 不改类型，所以只有 `if` 能让 `info` 可访问。
    if (result.ok) expect(result.info).toBeNull()
  })

  it("reads the runtime info through the injected IPC command", async () => {
    const calls: string[] = []
    installInvoke(async (command) => {
      calls.push(command)
      return sample
    })

    const result = await readDesktopRuntime()

    // 命令名必须是那个**具名**命令（不是通用 eval / shell）。
    expect(calls).toEqual(["get_runtime_info"])
    expect(result.ok).toBe(true)
    // 逐层收窄：`ok` 为真**且**是桌面时才有 `info`（判别联合的两个维度都要收）。
    if (result.ok && result.desktop) expect(result.info).toEqual(sample)
  })

  it("says honestly that it could not read the info instead of inventing one", async () => {
    installInvoke(async () => { throw new Error("ipc closed") })

    const result = await readDesktopRuntime()

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.desktop).toBe(true)
      expect(result.code).toBe("runtime_info_failed")
      expect(result.detail).toContain("ipc closed")
    }
  })

  it("treats missing or unknown fields as 'not implemented' rather than 'available'", async () => {
    // 危险的那种默认值是"缺字段就当成可用" —— 前端会以为密钥库在，然后走一条不存在的路径。
    installInvoke(async () => ({ platform: "windows" }))

    const result = await readDesktopRuntime()

    expect(result.ok).toBe(true)
    if (result.ok && result.desktop) {
      expect(result.info?.secretStore).toBe("not_implemented")
      expect(result.info?.repository).toBe("not_implemented")
      expect(result.info?.transport).toBe("not_implemented")
      expect(result.info?.appVersion).toBe("unknown")
    }
  })
})

describe("runtime description for the interface", () => {
  it("says plainly when there is no desktop shell", () => {
    expect(describeRuntime(null)).toContain("浏览器")
  })

  it("keeps the three component states distinct in words", () => {
    const text = describeRuntime(sample)

    // "还没实现"与"这台机器上没有"必须分开说：前者是软件的事，后者是机器的事。
    expect(text).toContain("还没实现")
    expect(text).not.toContain("这台机器上没有")
    expect(text).toContain("windows")
    expect(text).toContain("153.0.4234.48")
  })

  it("shows the data root directory name without any absolute path", () => {
    const text = describeRuntime(sample)

    expect(text).toContain("com.mathcanvas.desktop")
    expect(text).not.toContain(":\\")
    expect(text).not.toContain("Users")
  })
})
