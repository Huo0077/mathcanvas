/**
 * **密钥客户端**（Task 1.2 Step 4，前端那一半）。
 *
 * 计划原文：`saveSecret(profileId, value): Promise<SecretState>`、
 * `removeSecret(profileId): Promise<void>`、`hasSecret(profileId): Promise<boolean>`；
 * **none returns plaintext**。
 *
 * ## 三条纪律
 *
 * 1. **明文只有一个方向**：只有 `saveSecret` 收它，且**收完就调用方负责清空** ——
 *    这里提供 `clearSecretInput()` 让"清空"成为一个**函数**而不是一句口号
 *    （口号会忘，函数可以被测试）。
 * 2. **没有 `getSecret`**。这个模块**不导出**任何能取回明文的函数，类型上也没有
 *    `string` 的明文出口。要"用一次密钥"，将来走 Rust 侧的回环代理（Task 1.5），
 *    密钥根本不需要到前端来。
 * 3. **不在浏览器里跑时如实说"没有桌面外壳"**，而不是抛异常 ——
 *    同一个 web 产物既要能当网页开、也要能在 Tauri 里跑（与 `desktopRuntime.ts` 同一口径）。
 */

import { invokeDesktop, NoDesktopShellError } from "./desktopRuntime"

export type SecretState = "saved" | "missing" | "error"

export type SecretResult<T> =
  | { ok: true; value: T }
  /** 在浏览器里跑：没有原生侧，写不了密钥库。这是**正常状态**，不是错误。 */
  | { ok: false; code: "no_desktop_shell"; detail: string }
  /** 桌面外壳里但 IPC 失败。 */
  | { ok: false; code: "ipc_failed"; detail: string }

function failure(code: "no_desktop_shell" | "ipc_failed", detail: string): { ok: false; code: "no_desktop_shell" | "ipc_failed"; detail: string } {
  return { ok: false, code, detail }
}

/** 收窄 IPC 回来的状态：**只认三个已知值**，别的都当 `error`。 */
function asState(raw: unknown): SecretState {
  return raw === "saved" || raw === "missing" ? raw : "error"
}

export async function saveSecret(profileId: string, value: string): Promise<SecretResult<SecretState>> {
  const id = profileId.trim()
  if (id.length === 0) return { ok: false, code: "ipc_failed", detail: "a profile id is required" }
  // 空密钥**在本地就拒**：它会被后端拒（`EmptySecret`），但那时用户已经看到一次"失败"，
  // 而真正的意思是"你还没填"。前端先拦下，界面就能直接说"请先填密钥"。
  if (value.length === 0) return { ok: false, code: "ipc_failed", detail: "an empty secret must not be saved" }

  try {
    const raw = await invokeDesktop<unknown>("save_secret", { profileId: id, secret: value })
    return { ok: true, value: asState(raw) }
  } catch (error) {
    return failure(error instanceof NoDesktopShellError ? "no_desktop_shell" : "ipc_failed", messageOf(error))
  }
}

export async function removeSecret(profileId: string): Promise<SecretResult<void>> {
  const id = profileId.trim()
  if (id.length === 0) return { ok: false, code: "ipc_failed", detail: "a profile id is required" }

  try {
    await invokeDesktop("remove_secret", { profileId: id })
    return { ok: true, value: undefined }
  } catch (error) {
    return failure(error instanceof NoDesktopShellError ? "no_desktop_shell" : "ipc_failed", messageOf(error))
  }
}

export async function hasSecret(profileId: string): Promise<SecretResult<boolean>> {
  const id = profileId.trim()
  if (id.length === 0) return { ok: false, code: "ipc_failed", detail: "a profile id is required" }

  try {
    return { ok: true, value: (await invokeDesktop<unknown>("has_secret", { profileId: id })) === true }
  } catch (error) {
    return failure(error instanceof NoDesktopShellError ? "no_desktop_shell" : "ipc_failed", messageOf(error))
  }
}

/**
 * **清空一个密钥输入框**（计划原文："Clear the input after a successful save"）。
 *
 * 做成函数而不是"调用方记得清"：口号会忘，函数可以被测试。它接受任何带 `value` 的对象，
 * 所以对 `<input>` 与受控组件都适用 —— 而**返回是否真的清掉了**，
 * 让调用方可以断言"界面上已经看不到那串字符了"。
 */
export function clearSecretInput(input: { value: string } | null | undefined): boolean {
  if (!input || typeof input.value !== "string") return false
  input.value = ""
  return input.value === ""
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
