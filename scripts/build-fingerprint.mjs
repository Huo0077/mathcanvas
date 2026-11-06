import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath, URL } from "node:url"

export function buildFingerprint() {
  const root = fileURLToPath(new URL("../", import.meta.url))
  const version = JSON.parse(readFileSync(resolve(root, "apps/desktop/src-tauri/tauri.conf.json"), "utf8")).version
  const builtAt = new Date().toISOString()
  const git = (...args) => execFileSync("git", ["-c", `safe.directory=${resolve(root).replaceAll("\\", "/")}`, ...args], {
    cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024
  })
  try {
    const revision = git("rev-parse", "--short=12", "HEAD").trim()
    const scope = ["apps", "packages", "package.json", "package-lock.json", "scripts/build-fingerprint.mjs"]
    const digest = createHash("sha256").update(git("diff", "--binary", "HEAD", "--", ...scope))
    for (const name of git("ls-files", "--others", "--exclude-standard", "-z", "--", ...scope).split("\0").filter(Boolean)) {
      digest.update(name).update("\0").update(readFileSync(resolve(root, name))).update("\0")
    }
    return `${version}+${revision}.${digest.digest("hex").slice(0, 12)} @ ${builtAt}`
  } catch {
    return `${version}+source-unknown @ ${builtAt}`
  }
}
