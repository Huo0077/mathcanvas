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
  /** 只声明本仓库用到的形状：起一个子进程、发信号、看它有没有被杀。`stdio` 用数组形式（与 node 一致）。 */
  export interface ChildProcessLike {
    killed: boolean
    kill(signal?: string): boolean
  }
  export function spawn(
    command: string,
    args?: readonly string[],
    options?: { cwd?: string; stdio?: readonly string[]; env?: Record<string, string | undefined> }
  ): ChildProcessLike
}

declare module "node:events" {
  /** `once(emitter, "exit")` → Promise<[code, signal]>；这里只需要"某一刻 resolve"这一面。 */
  export function once(emitter: unknown, event: string): Promise<unknown[]>
}

declare module "node:fs/promises" {
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>
  export function mkdtemp(prefix: string): Promise<string>
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  export function writeFile(path: string, data: string): Promise<void>
}

declare module "node:path" {
  const path: {
    resolve(...parts: string[]): string
    join(...parts: string[]): string
  }
  export default path
}

declare const process: {
  readonly execPath: string
  readonly env: Record<string, string | undefined>
  cwd(): string
}

declare const __dirname: string
