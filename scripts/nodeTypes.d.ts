/**
 * **`scripts/` 用例真正用到的那几个 node 内建 API 的最小类型声明。**
 *
 * ## 为什么不装 `@types/node`
 *
 * 与 `e2e/nodeTypes.d.ts` 同一个理由：装它会**改变应用代码的类型** —— `@types/node` 一旦进了
 * `node_modules/@types`，所有没写 `types` 的 tsconfig（本仓库的 `apps/web` 与 `packages/*` 都是这样）
 * 都会**自动全局引入**它，于是 `setTimeout` 的返回类型从 `number` 变成 `NodeJS.Timeout`，
 * 牵动一批现在好端端的代码。为给脚本补类型而动摇应用侧，代价明显不成比例。
 *
 * ## 所以这里只声明**脚本真的用到的那些**
 *
 * 刻意做成最小面（不是 node 的形状）：一旦某个用例用到别的 node API，就得在这个文件里补一条 ——
 * 那是一次**看得见**的改动，而不是靠一整套 node 类型"顺便"通过。
 */

declare module "node:child_process" {
  /**
   * 只声明本仓库用到的形状：起一个子进程、看两个输出流、等它关闭或报错。
   *
   * **⚠️ 这个形状必须与 `packages/agent-core/src/proof/lean4NodeTypes.d.ts` 里的**逐字相同**。
   * 理由不是洁癖：一份 `.d.ts` 被另一个程序（这里是 `scripts/tsconfig.json` 的那一次 `tsc`）
   * 收录时，它**看不到**另一个程序里那份声明 —— 所以两边各写一份时，**谁被收录谁生效**。
   * 写成同一个超集，结果就与"谁赢"无关（实测撞到过：包里那份的成员在这里被遮蔽，
   * runner 报了四五个"属性不存在"）。
   */
  export interface ChildProcessLike {
    stdout: { on(event: "data", listener: (chunk: unknown) => void): unknown } | null
    stderr: { on(event: "data", listener: (chunk: unknown) => void): unknown } | null
    killed: boolean
    kill(signal?: string): boolean
    on(event: "close", listener: (code: number | null) => void): unknown
    on(event: "error", listener: (error: Error) => void): unknown
    on(event: "exit", listener: (code: number | null, signal: string | null) => void): unknown
  }
  export function spawn(
    command: string,
    args?: readonly string[],
    options?: {
      cwd?: string
      stdio?: readonly string[]
      env?: Record<string, string | undefined>
      signal?: unknown
      windowsHide?: boolean
    }
  ): ChildProcessLike
}

declare module "node:events" {
  /** `once(emitter, "exit")` → Promise<[code, signal]>；这里只需要"某一刻 resolve"这一面。 */
  export function once(emitter: unknown, event: string): Promise<unknown[]>
}

declare module "node:os" {
  /**
   * 系统临时目录。当前用户是 `packages/agent-core/src/proof/lean4Runner.ts`
   *（把生成的 Lean 文件写在**仓库树之外**，跑完删掉）。
   */
  export function tmpdir(): string
}

declare module "node:fs/promises" {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>
  export function mkdtemp(prefix: string): Promise<string>
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  export function writeFile(path: string, data: string, encoding?: string): Promise<void>
}

declare module "node:fs" {
  /**
   * 只声明本仓库真的用到的形状（与上面 `node:fs/promises` 同一条纪律）。
   * `agent-eval.ts` 用它判断 vitest 的 CLI 入口在不在，好在缺失时说清"装依赖"，
   * 而不是抛一个 `MODULE_NOT_FOUND` 让调用方猜。
   */
  export function existsSync(path: string): boolean
  /**
   * 列目录。当前用户是 `scripts/proof-spike/lean4EndToEnd.test.ts`
   *（判断仓内那个 Lean 工程的 mathlib 缓存有没有展开 —— 那是真实端到端用例的 gate 条件）。
   */
  export function readdirSync(path: string): string[]
  /**
   * 读仓库里的文件。当前用户是 `scripts/docs-consistency/*.test.ts`（计划 / `current-status.md` /
   * 三张能力表）与 `scripts/dependency-licences/licences.test.ts`（许可快照与 `Cargo.lock`）。
   *
   * **不再有 benchmark 的用户**：题集（原 `scripts/agent-benchmark/cases.jsonl`）在 N4a 搬进了
   * `packages/agent-core/src/benchmark/cases.ts`，因为应用侧是浏览器、不能 `node:fs` ——
   * 所有相关用例改成从包根 **import** 那份文本常量，这里不再为它留一个理由。
   *
   * 用**相对 cwd 的路径**而不是 `URL`：这些用例跑在 jsdom 环境里，`import.meta.url`
   * 不是 `file:` 协议，传 URL 给 `readFileSync` 会抛 ERR_INVALID_URL_SCHEME。
   */
  export function readFileSync(path: string, encoding: "utf8"): string
}

declare module "node:path" {
  const path: {
    resolve(...parts: string[]): string
    join(...parts: string[]): string
  normalize(part: string): string
  dirname(part: string): string
  relative(from: string, to: string): string
  }
  export default path
}

declare const process: {
  readonly execPath: string
  readonly env: Record<string, string | undefined>
  cwd(): string
}

declare const __dirname: string
