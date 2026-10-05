import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

/**
 * **Rust 依赖许可证的机器门禁**（N6 的依赖审查收口）。
 *
 * ## 为什么是"快照 + 判据"而不是"跑一遍 cargo metadata"
 *
 * `cargo metadata` **需要联网**（`--offline` 实测 exit 101）。而**跑不起来的门禁等于没有门禁** ——
 * 所以判据只读两份本地文件：`rust-licences.json`（上次扫描的结论）与 `Cargo.lock`（依赖集合的真源）。
 *
 * ## 三条判据，各自挡一种"静默变坏"
 *
 * 1. **同步**：`Cargo.lock` 里出现了快照里没有的包 ⇒ 红。**这条最重要** —— 没有它，
 *    新加一个 GPL 依赖只要没人想起来跑扫描就永远查不出来；有了它，加依赖**必须**重新扫描并复核。
 * 2. **硬禁**：表达式里出现 GPL / AGPL / SSPL / CDDL / EUPL ⇒ 无条件红（**即使**它同时提供宽松选项 ——
 *    这一条比"能不能用"更严，因为要的是"依赖图里不要有它们"）。
 * 3. **copyleft-only 要逐包复核**：整个表达式**没有任何宽松选项**时（例如裸 `MPL-2.0`），
 *    只有**在 `exceptions.json` 里被复核过**才允许。
 *
 * ## 这一条在此前的台账里是"只靠我读过"
 *
 * 第 38 轮的反向验证台账把"Rust 传递依赖无 GPL/AGPL/SSPL"列为**没有守卫**的一条。这个文件把它
 * 升格成有守卫：**判据不依赖我记得去跑扫描**。
 */

const SNAPSHOT = "scripts/dependency-licences/rust-licences.json"
const EXCEPTIONS = "scripts/dependency-licences/exceptions.json"
const LOCKFILE = "apps/desktop/src-tauri/Cargo.lock"

/** 宽松许可证（**注意**：MPL-2.0 刻意**不在**这里 —— 它走"逐包复核"那条路）。 */
const PERMISSIVE = new Set([
  "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "Unlicense", "0BSD", "MIT-0",
  "CC0-1.0", "Unicode-3.0", "BSL-1.0", "CDLA-Permissive-2.0"
])

/** **无条件禁**：出现就红，即使它只是若干选项之一。 */
const FORBIDDEN = /(?:^|[^A-Za-z-])(?:A?GPL|SSPL|CDDL|EUPL)/

interface Snapshot {
  packageCount: number
  packages: Record<string, string>
}

interface Exceptions {
  allowCopyleftOnly: { id: string; license: string; reason: string }[]
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as Snapshot
const exceptions = JSON.parse(readFileSync(EXCEPTIONS, "utf8")) as Exceptions

/** `Cargo.lock` 里的**注册表**包：带 `source` 的才是外面来的，本工作区成员没有 `source`。 */
function lockPackages(): string[] {
  const text = readFileSync(LOCKFILE, "utf8")
  const found: string[] = []
  for (const block of text.split("[[package]]").slice(1)) {
    const name = /^\s*name\s*=\s*"([^"]+)"/m.exec(block)?.[1]
    const version = /^\s*version\s*=\s*"([^"]+)"/m.exec(block)?.[1]
    const hasSource = /^\s*source\s*=/m.test(block)
    if (name && version && hasSource) found.push(`${name}@${version}`)
  }
  return found
}

/** 一个"选项"（OR / 斜杠分隔的一支）是否宽松：`AND` 的每一节都必须宽松。 */
function isPermissiveAlternative(alternative: string): boolean {
  return alternative.split(/\s+AND\s+/i).every((part) => PERMISSIVE.has(part.replace(/\s+WITH\s+.*$/i, "").trim()))
}

function isAcceptable(expression: string, id: string): boolean {
  if (FORBIDDEN.test(expression)) return false
  /**
   * **先去括号再切分** —— 这一条是**门禁自己查出来的**：第一版没去括号，
   * `(MIT OR Apache-2.0) AND Unicode-3.0` 被切成了 `(MIT` 与 `Apache-2.0) AND Unicode-3.0)`，
   * 后者因为尾括号不在宽松表里而把 `unicode-ident` 判红 —— **是解析器的毛病，不是那个包的毛病**。
   *
   * 去括号在危险方向上是**保守**的：`(MIT OR GPL) AND X` 去掉括号后会被切成 `MIT`（看起来可用），
   * 但 `GPL` 已经被上面那条**无条件硬禁**抓住了 —— 所以不会漏。
   */
  const alternatives = expression.replace(/[()]/g, " ").split(/\s+OR\s+|\//i)
  if (alternatives.some(isPermissiveAlternative)) return true
  return exceptions.allowCopyleftOnly.some((entry) => entry.id === id)
}

describe("Rust 依赖许可证门禁（快照 + Cargo.lock）", () => {
  it("**同步**：`Cargo.lock` 里的每个外部包都必须在快照里（新加依赖必须重新扫描复核）", () => {
    const missing = lockPackages().filter((id) => !(id in snapshot.packages))

    expect(
      missing,
      `这些依赖在快照里没有：${missing.join("、")} —— 跑 \`npm run licences:scan\`，然后**逐个看它们的许可证**再提交。`
    ).toEqual([])
  })

  it("快照里每个包都要有非空的许可证（缺字段就是「没查」，不是「没问题」）", () => {
    const blank = Object.entries(snapshot.packages).filter(([, license]) => license.trim().length === 0 || license === "UNKNOWN")

    expect(blank.map(([id]) => id), "许可证未知的包：先查清，再决定用不用").toEqual([])
  })

  it("**硬禁**：依赖图里不许出现 GPL / AGPL / SSPL / CDDL / EUPL", () => {
    const offenders = Object.entries(snapshot.packages).filter(([, license]) => FORBIDDEN.test(license))

    expect(offenders, `这些包带强 copyleft：${offenders.map(([id, l]) => `${id} (${l})`).join("、")}`).toEqual([])
  })

  it("**copyleft-only**（表达式里没有任何宽松选项）必须逐包复核过", () => {
    const unreviewed = Object.entries(snapshot.packages)
      .filter(([id, license]) => !isAcceptable(license, id))
      .map(([id, license]) => `${id} (${license})`)

    expect(
      unreviewed,
      `这些包只有 copyleft 选项、且不在 exceptions.json 里：${unreviewed.join("、")} —— 要么换依赖，要么复核后写进例外（写明理由）。`
    ).toEqual([])
  })

  it("例外要**钉住**当年复核的那个许可证：包换了许可证，这条就过期", () => {
    const stale = exceptions.allowCopyleftOnly
      .filter((entry) => snapshot.packages[entry.id] !== entry.license)
      .map((entry) => `${entry.id}：例外里写 ${entry.license}，快照里是 ${snapshot.packages[entry.id] ?? "(没有了)"}`)

    expect(stale, `例外过期了：${stale.join("、")}`).toEqual([])
  })

  it("打印读数（`--silent=false` 就是给它看的）", () => {
    const counts: Record<string, number> = {}
    for (const license of Object.values(snapshot.packages)) counts[license] = (counts[license] ?? 0) + 1
    console.log(
      `LICENCES_GATE packages=${snapshot.packageCount} lockPackages=${lockPackages().length} ` +
        `distinct=${Object.keys(counts).length} exceptions=${exceptions.allowCopyleftOnly.length}`
    )
    expect(snapshot.packageCount).toBeGreaterThan(0)
  })
})
