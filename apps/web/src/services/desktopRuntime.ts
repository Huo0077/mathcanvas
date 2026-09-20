/**
 * **桌面运行时自述**（Task 1.1 Step 4 的前端那一半）。
 *
 * Rust 侧的 `get_runtime_info` 回答"我跑在什么上面、哪些部件是好的"；这里负责把它取回来，
 * 并明确区分三件事：
 *
 * 1. **这不是桌面外壳**（在浏览器里跑）：`invoke` 不存在 → 如实回 `null`，
 *    **不抛异常、不假装**。同一个 web 产物既要能当网页打开、也要能在 Tauri 里跑，
 *    所以"没有原生侧"必须是**正常状态**而不是错误。
 * 2. **自述取不回来**（IPC 失败）：回 `unavailable` 并带上原因码，让界面能说"没问到"
 *    而不是显示一份编出来的信息。
 * 3. **某个部件还没实现**：自述里那三个健康字段会说 `not_implemented`，
 *    界面据此**不能**把"没有"显示成"有"（G1 的后续任务完成之前它们就是这个值）。
 *
 * 为什么"是不是桌面外壳"不去读 `navigator.userAgent` 之类：那是**猜**。
 * Tauri 注入的是 `window.__TAURI_INTERNALS__.invoke`，有就是有、没有就是没有。
 */

export type DesktopComponentHealth = "ready" | "missing" | "not_implemented"

export interface DesktopRuntimeInfo {
  platform: string
  appVersion: string
  runtime: string
  webviewVersion: string
  /** 应用数据根**目录名**（不含绝对路径 —— 绝对路径不出 Rust 侧）。 */
  dataRoot: string
  secretStore: DesktopComponentHealth
  repository: DesktopComponentHealth
  transport: DesktopComponentHealth
}

export type DesktopRuntimeResult =
  /** 在网页里跑：没有原生侧，这是正常情况。 */
  | { ok: true; desktop: false; info: null }
  | { ok: true; desktop: true; info: DesktopRuntimeInfo }
  /** 在桌面外壳里，但自述没取回来 —— 如实说"没问到"。 */
  | { ok: false; desktop: true; code: string; detail: string }

/** Tauri 注入的 IPC 入口。**只认它**，不去猜 userAgent。 */
interface TauriInternals {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>
}

/**
 * **在浏览器里调了只属于桌面外壳的命令**。
 *
 * 做成一个类而不是返回 `null`，是为了让调用方能**区分**两件完全不同的事：
 * "没有原生侧"（正常状态，界面该显示"这个功能需要桌面版"）与"IPC 调用失败"
 *（真的出错了，该显示原因）。把它们混成一个 `Error` 会让界面只能给一句模糊的失败。
 */
export class NoDesktopShellError extends Error {
  constructor(command: string) {
    super(`no desktop shell is available for ${command}; this build runs in a browser`)
    this.name = "NoDesktopShellError"
  }
}

function internals(): TauriInternals | null {
  const candidate = (globalThis as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  if (!candidate || typeof candidate !== "object") return null
  const invoke = (candidate as { invoke?: unknown }).invoke
  return typeof invoke === "function" ? (candidate as TauriInternals) : null
}

/** 现在是不是跑在桌面外壳里。**只看注入的 IPC 入口**。 */
export function isDesktopShell(): boolean {
  return internals() !== null
}

/**
 * 调一个**具名**桌面命令。没有原生侧时抛 `NoDesktopShellError`。
 *
 * 与 `readDesktopRuntime` 的分工：那边是"问自述"，失败也要**如实回一个结果对象**
 *（因为自述读不到本身就是一种要显示给用户的状态）；这里是"做一件事"，
 * 失败就该抛给调用方去决定怎么显示。
 */
export async function invokeDesktop<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const ipc = internals()
  if (!ipc) throw new NoDesktopShellError(command)
  return (await ipc.invoke(command, args)) as T
}

export async function readDesktopRuntime(): Promise<DesktopRuntimeResult> {
  const ipc = internals()
  if (!ipc) return { ok: true, desktop: false, info: null }

  try {
    const raw = await ipc.invoke("get_runtime_info")
    return { ok: true, desktop: true, info: asRuntimeInfo(raw) }
  } catch (error) {
    return { ok: false, desktop: true, code: "runtime_info_failed", detail: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * 把 IPC 回来的 `unknown` 收窄成自述。
 *
 * 缺字段一律填 `not_implemented` / `unknown` 而不是抛异常：一份**不完整**的自述
 * 仍然比"整块看不见"有用，而"缺的字段默认可用"才是真正危险的那种默认值。
 */
function asRuntimeInfo(raw: unknown): DesktopRuntimeInfo {
  const value = (raw ?? {}) as Record<string, unknown>
  const health = (candidate: unknown): DesktopComponentHealth =>
    candidate === "ready" || candidate === "missing" || candidate === "not_implemented" ? candidate : "not_implemented"
  const text = (candidate: unknown, fallback: string): string => (typeof candidate === "string" && candidate.length > 0 ? candidate : fallback)

  return {
    platform: text(value.platform, "unknown"),
    appVersion: text(value.appVersion, "unknown"),
    runtime: text(value.runtime, "unknown"),
    webviewVersion: text(value.webviewVersion, "unknown"),
    dataRoot: text(value.dataRoot, "unknown"),
    secretStore: health(value.secretStore),
    repository: health(value.repository),
    transport: health(value.transport)
  }
}

const HEALTH_LABELS: Record<DesktopComponentHealth, string> = {
  ready: "可用",
  missing: "这台机器上没有",
  not_implemented: "还没实现"
}

/**
 * 给界面用的一句话。**三态各有各的词** —— 把 `not_implemented` 说成"不可用"，
 * 用户会以为是机器的问题，而实际是软件还没做。
 */
export function describeRuntime(info: DesktopRuntimeInfo | null): string {
  if (!info) return "在浏览器里运行，没有桌面外壳（本地密钥库与项目仓库不可用）。"
  return [
    `桌面外壳 ${info.appVersion} · ${info.platform} · WebView2 ${info.webviewVersion}`,
    `数据目录 ${info.dataRoot}`,
    `密钥库 ${HEALTH_LABELS[info.secretStore]} · 项目仓库 ${HEALTH_LABELS[info.repository]} · 本地代理 ${HEALTH_LABELS[info.transport]}`
  ].join("\n")
}
