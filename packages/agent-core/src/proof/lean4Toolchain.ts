/**
 * **去哪儿找 Lean**（N5b 的 §三"工程放哪"那条裁决的另一半）。
 *
 * ## 这一层要解决的问题（简报里点名的那个环境坑）
 *
 * 本仓的开发机装的是 **elan**（Lean 的版本管理器），它把 `lean.exe` / `lake.exe` 放在
 * `<ELAN_HOME>/bin/` 下。而那是 **elan 的垫片（shim）**：每次调用它都要解析 `lean-toolchain`、
 * 定位真正的工具链、再转发 —— 实测 `lean --version` 走垫片是 **1657 / 1799 / 1865 ms**，
 * 而直接调工具链自己的 `bin/lean.exe` 是 **138 / 134 / 125 ms**。差了**一个量级**，
 * 而证明路径上每次调用都要付这份钱。
 *
 * 所以解析顺序是：**先找真正的工具链 `bin/`**，垫片只当兜底。
 *
 * ## 解析顺序（每一步都"查得到才算"，查不到就往下走）
 *
 * 1. **显式配置**（`DRAW_LEAN4_TOOLCHAIN_BIN`）：给部署方一个不靠猜的入口。
 * 2. **elan 的工具链目录**：`<ELAN_HOME>/toolchains/*<name>/bin` 或
 *    `<USERPROFILE>/.elan/toolchains/*<name>/bin` —— 同名工具链取**版本最高**的那个
 *    （按数字段比较，不是字符串比较：`v4.35.0-rc3` 必须排在 `v4.34.1` 前面）。
 * 3. **PATH**：`lean` / `lake` 能找到就用（可能是垫片，也可能是真工具链）。
 * 4. **`<ELAN_HOME>/bin` / `<USERPROFILE>/.elan/bin`**：垫片兜底。
 * 5. 一处都没有 ⇒ **返回 `null`，由调用方如实报"后端不可用"**（fail-closed）。
 *
 * ## 为什么**不**写死机器路径
 *
 * `D:\...` / `C:\Users\某个人\...` 写进产品代码就等于"这台机器上能跑"。
 * 这条链的每一步都是**环境变量或用户目录**，所以同一份代码在只装了 elan 的机器上成立；
 * 不成立时它**说出来**，而不是去猜一个看起来对的路径。
 *
 * ## 这个模块**没有任何 import**
 *
 * 它是一个**纯函数 + 注入的文件系统探针**：`existsSync` / `readdirSync` 由调用方通过
 * `Lean4ResolveOptions` 传进来。理由不是洁癖 —— 这个包（`@draw/agent-core`）会被**浏览器**
 * 打包，而它今天在 `packages/agent-core/src` 里**一个 `node:` import 都没有**；
 * 为了让"找个可执行文件"这件事把整包的这条性质弄坏并不划算。
 * 而且：**没有注入探针时它返回 `null`**（"查不到"），这正是浏览器里的正确答案。
 *
 * ## 已知的粗糙处（写出来，不藏着）
 *
 * - **目录枚举不做 glob**：`toolchains` 下的名字不是严格可预测的
 *   （`leanprover--lean4---v4.34.1` 这种是 elan 自己拼的），所以这里 `readdir` + 前缀筛。
 * - **版本比较只看版本号里前三段**：够用来在同名工具链之间挑新的那个；它不是语义化版本的
 *   完整实现（预发布号如 `-rc3` 不参与比较，被当作与正式版同级）。
 * - **`PATH` 那一步不区分垫片与真工具链**：PATH 上第一个是垫片就用垫片（慢，但正确）。
 *   要拿快的那个，部署方应当用第 1 步显式配置。
 * - **`resolvedBy` 是给人看的**：报告里要能说清"这次是怎么找到它的"。
 */

/** 一次解析的结果。 */
export interface Lean4Toolchain {
  /** `lean` 可执行文件的绝对路径。 */
  leanPath: string
  /** `lake` 可执行文件的绝对路径；同一目录下没有 `lake` 时为 `null`（core-only 也能工作）。 */
  lakePath: string | null
  /** 它是怎么被找到的（写进报告与错误信息，便于诊断）。 */
  resolvedBy: string
  /** 这个 `bin` 目录（找 `lake` 与诊断用）。 */
  binDir: string
}

export interface Lean4ResolveOptions {
  /** 环境变量；缺省用 `process.env`（没有 `process` 时用 `{}`）。 */
  env?: Record<string, string | undefined>
  /** "这个文件在不在"。**不传就永远返回 `null`** —— 浏览器里没有文件系统，那正是正确答案。 */
  fileExists?: (candidate: string) => boolean
  /** 目录列举。不传就当作空目录。 */
  listDir?: (dir: string) => string[]
  /** 可执行文件后缀；缺省按 `process.platform` 推（没有 `process` 时为 `.exe`）。 */
  exeSuffix?: string
  /** PATH 分隔符；缺省按平台推。 */
  pathSeparator?: string
}

/**
 * 从工具链目录名里抠出版本段。
 *
 * 例：`leanprover--lean4---v4.34.1` ⇒ `[4, 34, 1]`；`...v4.35.0-rc3` ⇒ `[4, 35, 0]`
 * （预发布号不参与比较，见文件头"已知的粗糙处"）。
 */
export function toolchainVersionParts(dirName: string): number[] {
  const match = /v(\d+(?:\.\d+)*)/.exec(dirName)
  if (match === null) return []
  return match[1]!.split(".").map((part) => Number.parseInt(part, 10))
}

/** 版本段逐个比大小。**返回正数表示 `a` 更新**；版本号相同时退回目录名字符串比较（只为了稳定）。 */
export function compareToolchainDirs(a: string, b: string): number {
  const pa = toolchainVersionParts(a)
  const pb = toolchainVersionParts(b)
  const length = Math.max(pa.length, pb.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (pa[index] ?? 0) - (pb[index] ?? 0)
    if (difference !== 0) return difference
  }
  return a < b ? -1 : a > b ? 1 : 0
}

/** 手写拼接（而不是 `node:path`）：这个模块必须能在浏览器包里被解析。 */
function joinAll(parts: readonly string[]): string {
  return parts
    .filter((part) => part.length > 0)
    .map((part) => part.replace(/[/\\]+$/, ""))
    .join("/")
    .replace(/\/{2,}/g, "/")
}

/**
 * **在浏览器里也要能被解析**：`process` 不是 DOM 的东西，所以这里不去碰它的全局类型，
 * 而是从一个**运行时才查**的位置取（没有就当作"没有环境变量"）。
 *
 * 为什么值得这样绕：`@draw/agent-core` 会被**浏览器**打包，而这一层只在那条显式调用
 * 证明后端的路径上用到。让"找个可执行文件"这件事把整包的浏览器可用性弄坏并不划算。
 */
interface Lean4ProcessLike {
  readonly env?: Record<string, string | undefined>
  readonly platform?: string
}

function runtimeProcess(): Lean4ProcessLike | undefined {
  return (globalThis as { process?: Lean4ProcessLike }).process
}

function defaultEnv(): Record<string, string | undefined> {
  return runtimeProcess()?.env ?? {}
}

function defaultSuffix(options: Lean4ResolveOptions): string {
  if (options.exeSuffix !== undefined) return options.exeSuffix
  return runtimeProcess()?.platform === "win32" ? ".exe" : ""
}

function defaultSeparator(options: Lean4ResolveOptions): string {
  if (options.pathSeparator !== undefined) return options.pathSeparator
  return runtimeProcess()?.platform === "win32" ? ";" : ":"
}

function fromBinDir(binDir: string, resolvedBy: string, suffix: string, fileExists: (candidate: string) => boolean): Lean4Toolchain | null {
  const leanPath = joinAll([binDir, `lean${suffix}`])
  if (!fileExists(leanPath)) return null
  const lakePath = joinAll([binDir, `lake${suffix}`])
  return { leanPath, lakePath: fileExists(lakePath) ? lakePath : null, resolvedBy, binDir }
}

/**
 * 找 Lean。**找到就返回它，找不到返回 `null`** —— 绝不抛，也绝不猜一个看起来对的路径。
 *
 * 调用方（适配器）拿到 `null` 时要说的是"**后端不可用**"，而不是"证明失败"：
 * 这两件事对用户的意义完全不同（一个是"这台机器没装 / 没配上"，一个是"证不出来"）。
 */
export function resolveLean4Toolchain(options: Lean4ResolveOptions = {}): Lean4Toolchain | null {
  const env = options.env ?? defaultEnv()
  const suffix = defaultSuffix(options)
  const fileExists = options.fileExists
  const listDir = options.listDir ?? (() => [] as string[])
  // **没有文件系统探针就没有答案**：浏览器、或调用方忘了注入。
  if (fileExists === undefined) return null

  // 1. 显式配置（部署方的入口）。
  const configured = env.DRAW_LEAN4_TOOLCHAIN_BIN
  if (configured !== undefined && configured.trim().length > 0) {
    const found = fromBinDir(configured.trim(), "env:DRAW_LEAN4_TOOLCHAIN_BIN", suffix, fileExists)
    if (found !== null) return found
  }

  /**
   * **两串候选目录，语义不同，别混**：
   * - `ELAN_HOME` **本身就是** elan 的根目录（它下面直接是 `bin/` 与 `toolchains/`）；
   * - `USERPROFILE` / `HOME` 是**用户家目录**，elan 默认装在它下面的 `.elan/` 里。
   *
   * 早先的版本对两者套同一个模板（一律拼 `.elan/`），那对 `ELAN_HOME` 是错的 ——
   * 会在 `C:\Users\x\.elan\.elan\...` 这种不存在的路径上白找一轮。
   */
  const elanRoots: string[] = []
  for (const value of [env.ELAN_HOME, env.DRAW_LEAN4_HOME]) {
    if (value !== undefined && value.trim().length > 0) elanRoots.push(value.trim())
  }
  for (const value of [env.USERPROFILE, env.HOME]) {
    if (value !== undefined && value.trim().length > 0) elanRoots.push(joinAll([value.trim(), ".elan"]))
  }

  // 2. elan 的工具链目录（**真正的** `bin/`，快的那条路）。同名工具链取版本最高的。
  for (const root of elanRoots) {
    const toolchainsDir = joinAll([root, "toolchains"])
    const candidates = listDir(toolchainsDir)
      .filter((name) => name.startsWith("leanprover"))
      .sort(compareToolchainDirs)
      .reverse()
    for (const name of candidates) {
      const found = fromBinDir(joinAll([toolchainsDir, name, "bin"]), `elan-toolchain:${name}`, suffix, fileExists)
      if (found !== null) return found
    }
  }

  // 3. PATH（可能是垫片，也可能是真工具链 —— 找到就用，正确性优先）。
  const pathValue = env.PATH ?? env.Path ?? ""
  for (const dir of pathValue.split(defaultSeparator(options))) {
    const trimmed = dir.trim()
    if (trimmed.length === 0) continue
    const found = fromBinDir(trimmed, "PATH", suffix, fileExists)
    if (found !== null) return found
  }

  // 4. 垫片兜底（`<elan 根>/bin`，对 ELAN_HOME 与 `~/.elan` 两种来源都成立）。
  for (const root of elanRoots) {
    const found = fromBinDir(joinAll([root, "bin"]), "elan-shim", suffix, fileExists)
    if (found !== null) return found
  }

  /** 5. 一处都没有 ⇒ `null`。调用方把它翻译成"后端不可用"那条**明确的**状态。 */
  return null
}
