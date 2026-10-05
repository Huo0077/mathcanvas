/**
 * **Lean 4 runner 用到的那几个 node 内建 API 的最小类型声明。**
 *
 * ## 为什么不装 `@types/node`
 *
 * 与 `scripts/nodeTypes.d.ts` / `e2e/nodeTypes.d.ts` 同一条理由（那两份文件里有完整论证）：
 * `@types/node` 一旦进了 `node_modules/@types`，本仓库所有没写 `types` 的 tsconfig
 * —— `apps/web` 与**本包**都是这样 —— 都会**自动全局引入**它，
 * 于是 `setTimeout` 的返回类型从 `number` 变成 `NodeJS.Timeout`，牵动一批现在好端端的代码。
 * 为了给一个显式调用的适配器补类型而动摇应用侧，代价不成比例。
 *
 * ## 为什么声明在**包里**（这是这份文件存在的**唯一**理由）
 *
 * `scripts/nodeTypes.d.ts` 只在 `scripts/tsconfig.json` 的 include 范围内生效。
 * 适配器的 Node 那一层（`lean4Runner.ts`）住在包里 —— 它是**产品的**一部分
 * （会随包一起被引用），不是一次性脚本。`packages/agent-core/tsconfig.json` 的
 * `include: ["src"]` 会连这个 `.d.ts` 一起收进来，所以声明在这里才对得上。
 *
 * ## ⚠️ 一个必须写明的坑（我实测撞到过）：**两份声明可能互相遮蔽**
 *
 * TypeScript 里 `declare module "node:child_process"` 是**增强**，不是重载 —— 但
 * `packages/agent-core/src/proof/lean4NodeTypes.d.ts` 与 `scripts/nodeTypes.d.ts` 会同时进入
 * 某些程序（例如根目录起一次 `tsc`），而两份里**同名**的接口/函数会**合并**：
 * `ChildProcessLike` 的两个版本合起来，就变成了 `scripts/` 那个最小版本（没有 `stdout`/`on`）。
 * 症状是 runner 里冒出四五个"属性不存在"的错误。
 *
 * 处置：**把形状写成与 `scripts/nodeTypes.d.ts` 逐字相同的超集** —— 合并的结果就与任何一份
 * 单独生效时一致，于是"谁赢"不再影响类型。这不是漂亮的写法，但它是**两处声明并存**这件事
 * 唯一诚实的解法（另一条路是让包里那一层不复用 node 内建类型，而那要自己写一套进程启动）。
 */

declare module "node:child_process" {
  /** 与 `scripts/nodeTypes.d.ts` 逐字相同（合并后仍是这个形状），并补上 runner 需要的成员。 */
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

declare module "node:fs/promises" {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>
  export function mkdtemp(prefix: string): Promise<string>
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  export function writeFile(path: string, data: string, encoding?: string): Promise<void>
}

declare module "node:os" {
  export function tmpdir(): string
}

declare module "node:path" {
  const path: {
    join(...parts: string[]): string
    resolve(...parts: string[]): string
    normalize(part: string): string
    dirname(part: string): string
    relative(from: string, to: string): string
  }
  export default path
}
