import { afterEach, describe, expect, it } from "vitest"

import { clearSecretInput, hasSecret, removeSecret, saveSecret } from "./secretClient"

/**
 * 密钥客户端（Task 1.2 Step 4）。
 *
 * 最要紧的两条性质：
 * 1. **明文只有一个方向** —— 只有 `saveSecret` 收它，而且**后端回来的东西里没有它**；
 * 2. **"没有桌面外壳"与"IPC 失败"是两件事** —— 前者是正常状态（网页版就是这样），
 *    后者才该显示原因。
 */
const internalsKey = "__TAURI_INTERNALS__"

function installInvoke(invoke: (command: string, args?: Record<string, unknown>) => Promise<unknown>) {
  Object.defineProperty(globalThis, internalsKey, { configurable: true, writable: true, value: { invoke } })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, internalsKey)
})

describe("secret client", () => {
  it("sends the secret to the named command and gets only a state back", async () => {
    const calls: { command: string; args?: Record<string, unknown> }[] = []
    installInvoke(async (command, args) => {
      calls.push({ command, args })
      return "saved"
    })

    const result = await saveSecret("openai", "sk-test-1234")

    expect(calls).toEqual([{ command: "save_secret", args: { profileId: "openai", secret: "sk-test-1234" } }])
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe("saved")
  })

  it("never asks the shell for the plaintext back", async () => {
    const commands: string[] = []
    installInvoke(async (command) => {
      commands.push(command)
      return command === "has_secret" ? true : null
    })

    await hasSecret("openai")
    await removeSecret("openai")

    // 只有"查有没有"与"删"两个命令 —— **没有**任何取回明文的命令。
    expect(commands).toEqual(["has_secret", "remove_secret"])
  })

  it("reports a browser as 'no desktop shell' instead of throwing", async () => {
    const saved = await saveSecret("openai", "sk-x")
    const present = await hasSecret("openai")

    expect(saved.ok).toBe(false)
    if (!saved.ok) {
      expect(saved.code).toBe("no_desktop_shell")
      // 说清"这是浏览器"，而不是一句含糊的失败。
      expect(saved.detail).toContain("browser")
    }
    expect(present.ok).toBe(false)
  })

  it("distinguishes an IPC failure from a missing shell", async () => {
    installInvoke(async () => { throw new Error("ipc closed") })

    const result = await saveSecret("openai", "sk-x")

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.code).toBe("ipc_failed")
      expect(result.detail).toContain("ipc closed")
    }
  })

  it("refuses an empty profile id or an empty secret before touching the shell", async () => {
    const calls: string[] = []
    installInvoke(async (command) => { calls.push(command); return "saved" })

    expect((await saveSecret("   ", "sk-x")).ok).toBe(false)
    expect((await saveSecret("openai", "")).ok).toBe(false)
    // 关键：**一次 IPC 都没发** —— 空输入不该变成一次"失败"，那会误导用户以为后端坏了。
    expect(calls).toEqual([])
  })

  it("treats an unknown state from the shell as an error rather than as success", async () => {
    // 危险的默认值是"不认识就当成功" —— 界面会显示"已保存"而实际什么都没存。
    installInvoke(async () => "something-else")

    const result = await saveSecret("openai", "sk-x")

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe("error")
  })
})

describe("clearing the secret input", () => {
  it("clears the field and reports that it is empty", () => {
    const input = { value: "sk-test-1234" }

    expect(clearSecretInput(input)).toBe(true)
    expect(input.value).toBe("")
  })

  it("does not pretend to have cleared something that is not there", () => {
    expect(clearSecretInput(null)).toBe(false)
    expect(clearSecretInput(undefined)).toBe(false)
  })
})
