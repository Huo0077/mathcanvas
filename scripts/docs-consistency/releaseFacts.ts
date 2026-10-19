/**
 * 发布事实的**唯一读取处**：版号、发布说明、发布日期。
 *
 * 抽出来是因为"读版号"这件事现在有两个判据要用（版本一致、CHANGELOG 不落后）。
 * 本仓吃过"同一个判断写两遍一定会分叉"的亏（见 current-status 里记的那两次），
 * 所以读取只写一份；两条判据各自只负责自己的断言。
 */
import { readdirSync, readFileSync } from "node:fs"
import path from "node:path"

export const TAURI = "apps/desktop/src-tauri/tauri.conf.json"
export const CARGO = "apps/desktop/src-tauri/Cargo.toml"
export const RELEASE_DIR = "docs/release"
export const CHANGELOG = "CHANGELOG.md"

/** `4.0` / `4.0.0` / `v4.0.1` 一律归一成三段数字，便于逐段比较。 */
export function segments(version: string): number[] {
  const cleaned = version.trim().replace(/^v/, "")
  const parts = cleaned.split(".").map((part) => Number(part))
  if (parts.some((part) => !Number.isFinite(part))) {
    throw new Error(`读不出合法版号：${version}`)
  }
  while (parts.length < 3) parts.push(0)
  return parts.slice(0, 3)
}

export function compareVersions(left: string, right: string): number {
  const a = segments(left)
  const b = segments(right)
  for (let index = 0; index < 3; index += 1) {
    if (a[index] !== b[index]) return a[index]! - b[index]!
  }
  return 0
}

export function tauriVersion(): string {
  const parsed = JSON.parse(readFileSync(TAURI, "utf8")) as { version?: unknown }
  if (typeof parsed.version !== "string") throw new Error(`${TAURI} 里没有字符串 version`)
  return parsed.version
}

export function cargoVersion(): string {
  const text = readFileSync(CARGO, "utf8")
  // 只读 `[package]` 那一段里的 version，别被依赖里的 `version = "1.0"` 骗了。
  const section = /^\[package\]([\s\S]*?)(?=^\[)/m.exec(text)
  if (section === null) throw new Error(`${CARGO} 里找不到 [package] 段`)
  const matched = /^version\s*=\s*"([^"]+)"/m.exec(section[1]!)
  if (matched === null) throw new Error(`${CARGO} 的 [package] 段里没有 version`)
  return matched[1]!
}

export interface ReleaseDoc {
  file: string
  version: string
  published: string | undefined
}

export function releaseDocs(): ReleaseDoc[] {
  return readdirSync(RELEASE_DIR)
    .filter((entry) => /^v\d+(?:\.\d+)*\.md$/.test(entry))
    .map((entry) => {
      const text = readFileSync(path.join(RELEASE_DIR, entry), "utf8")
      const date = /\*\*发布日期：\*\*\s*(\d{4}-\d{2}-\d{2})/.exec(text)
      return {
        file: path.join(RELEASE_DIR, entry),
        version: entry.replace(/^v/, "").replace(/\.md$/, ""),
        published: date?.[1]
      }
    })
}

export function newestRelease(): ReleaseDoc {
  const docs = releaseDocs()
  if (docs.length === 0) throw new Error(`${RELEASE_DIR} 里一份发布说明都没有`)
  return docs.reduce((newest, current) => (compareVersions(current.version, newest.version) > 0 ? current : newest))
}

/** CHANGELOG 里最新一条 `## YYYY-MM-DD` 标题的日期。 */
export function newestChangelogDate(): string | undefined {
  const text = readFileSync(CHANGELOG, "utf8")
  const dates = [...text.matchAll(/^##\s+(\d{4}-\d{2}-\d{2})/gm)].map((match) => match[1]!)
  return dates.sort((left, right) => right.localeCompare(left))[0]
}
