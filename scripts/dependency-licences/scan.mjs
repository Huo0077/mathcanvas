#!/usr/bin/env node
/**
 * **刷新 Rust 依赖的许可证快照**（`npm run licences:scan`）。
 *
 * 为什么要有"快照"这一步：`cargo metadata` **需要联网**（实测 `--offline` 在本机 exit 101 ——
 * registry 索引不全）。而门禁**不能**依赖网络：跑不起来的门禁等于没有门禁。
 * 所以拆成两半：
 *
 * - **这里（要联网）**：把 `cargo metadata` 的结论落成一份**只含结论**的 JSON 快照；
 * - **`licences.test.ts`（不联网）**：拿快照 + `Cargo.lock` 做判据 —— 其中一条是
 *   **"`Cargo.lock` 里出现了快照里没有的包就红"**，于是**新加依赖不会被漏过去**。
 *
 * 忘了刷新？那条同步判据会红，并告诉你跑这个脚本。
 */
import { execFileSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import path from "node:path"

const REPO = process.cwd()
const MANIFEST = path.join("apps", "desktop", "src-tauri", "Cargo.toml")
const OUT = path.join("scripts", "dependency-licences", "rust-licences.json")

/** 允许出现在快照里的字段：**只留结论**，不留路径、不留作者、不留校验和。 */
function summarize(metadata) {
  const members = new Set(metadata.workspace_members)
  const packages = {}
  for (const pkg of metadata.packages) {
    if (members.has(pkg.id)) continue
    packages[`${pkg.name}@${pkg.version}`] = pkg.license ?? (pkg.license_file ? "SEE-LICENSE-FILE" : "UNKNOWN")
  }
  /** 稳定输出：按 key 排序，这样"只刷新不改变结论"时 diff 是空的。 */
  const sorted = {}
  for (const key of Object.keys(packages).sort()) sorted[key] = packages[key]
  return {
    note: "由 `npm run licences:scan` 生成。**不要手改** —— 判据在 licences.test.ts，改了这里不会让红的变绿。",
    manifest: MANIFEST.replace(/\\/g, "/"),
    packageCount: Object.keys(sorted).length,
    packages: sorted
  }
}

const raw = execFileSync(
  process.execPath,
  [path.join("scripts", "toolchain.mjs"), "cargo", "metadata", "--format-version", "1", "--manifest-path", MANIFEST],
  { cwd: REPO, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }
)

const snapshot = summarize(JSON.parse(raw))
writeFileSync(path.join(REPO, OUT), `${JSON.stringify(snapshot, null, 2)}\n`, "utf8")

const counts = {}
for (const expression of Object.values(snapshot.packages)) counts[expression] = (counts[expression] ?? 0) + 1
console.log(`LICENCES_SCANNED packages=${snapshot.packageCount} distinctExpressions=${Object.keys(counts).length}`)
for (const [expression, count] of Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
  console.log(`  ${String(count).padStart(4)}  ${expression}`)
}
console.log(`LICENCES_WROTE ${OUT.replace(/\\/g, "/")}`)
