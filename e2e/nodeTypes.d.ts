/**
 * **e2e 用例用到的那几个 node 内建 API 的最小类型声明。**
 *
 * ## 为什么不是装 `@types/node`
 *
 * 装它会**改变应用代码的类型**：`@types/node` 一旦进了 `node_modules/@types`，所有没写
 * `types` 的 tsconfig（本仓库的 `apps/web` 与 `packages/*` 都是这样）都会**自动全局引入**它，
 * 于是 `setTimeout` 的返回类型从 `number` 变成 `NodeJS.Timeout` —— 那会牵动一堆现在好端端的代码
 * （例如检查器里那些 `useRef<number | null>` 的帧句柄）。为了给 e2e 补类型而动摇应用侧，
 * 代价明显不成比例。
 *
 * ## 所以这里只声明**用例真的用到的那一面**
 *
 * 刻意做成最小面（不是"node 的形状"）：一旦某条用例用到别的 node API，就得在这个文件里补一条 ——
 * 那是一次**看得见**的改动，而不是靠一整套 node 类型"顺便"通过。
 *
 * 注意 `e2e/global-setup.mjs` 不在本 tsconfig 的范围内（`allowJs: false`），它由 Playwright 自己跑。
 */

declare module "node:fs" {
  /** 用例一律按 `utf8` 读，读回来当字符串用（读了编码的调用点见 `solid-prism.spec.ts`）。 */
  export function readFileSync(path: string, encoding: "utf8"): string
  export function readdirSync(path: string): string[]
}

declare module "node:fs/promises" {
  /** 下载落盘后的 SVG 文本（`engineering-workbench.spec.ts` / `workbench.spec.ts`）。 */
  export function readFile(path: string, encoding: "utf8"): Promise<string>
  export function readFile(path: string): Promise<NodeBytes>
  export function mkdir(path: string, options?: { recursive?: boolean }): Promise<string | undefined>
  export function rm(path: string, options?: { recursive?: boolean; force?: boolean }): Promise<void>
  export function writeFile(path: string, data: string): Promise<void>
  export function readdir(path: string): Promise<string[]>
}

declare module "node:path" {
  export function join(...parts: string[]): string
  export function basename(path: string): string
  const path: { resolve(...parts: string[]): string; join(...parts: string[]): string }
  export default path
}

declare module "node:crypto" {
  export function createHash(algorithm: string): {
    update(data: string | Uint8Array): { digest(encoding: "hex"): string }
  }
}

declare const process: { cwd(): string; readonly env: Record<string, string | undefined> }

/** 用例实际消费的最小字节面：二进制读取与 base64 编码。 */
declare type NodeBytes = Uint8Array & { toString(encoding?: string): string }

/** 只声明 `Buffer.from` 这一面：用例把 JSON / PNG 字节交给上传或 base64 编码。 */
declare const Buffer: {
  from(input: string | readonly number[], encoding?: string): NodeBytes
}
