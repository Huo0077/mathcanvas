import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

interface RootManifest {
  packageManager?: string
  devDependencies?: Record<string, string>
}

interface LockPackageEntry {
  version?: string
  devDependencies?: Record<string, string>
}

interface PackageLock {
  packages?: Record<string, LockPackageEntry>
}

interface AuditExceptionRecord {
  id: string
  severity: "critical" | "high" | "moderate" | "low"
  owner: string
  mitigation: string
  expiresOn: string
}

const MINIMUM_PATCHED_VERSIONS: Readonly<Record<string, string>> = {
  vitest: "4.1.12",
  "@vitest/mocker": "4.1.12",
  vite: "7.3.8",
  "source-map-js": "1.2.2",
  zod: "4.6.7",
  eslint: "10.15.0",
  "typescript-eslint": "8.72.2"
}

function compareSemver(a: string, b: string): number {
  const pa = a.replace(/^[^\d]*/, "").split("-")[0]!.split(".").map((n) => Number.parseInt(n, 10))
  const pb = b.replace(/^[^\d]*/, "").split("-")[0]!.split(".").map((n) => Number.parseInt(n, 10))
  for (let i = 0; i < 3; i += 1) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function dependencyGateErrors(
  manifest: RootManifest,
  lock: PackageLock,
  ciWorkflow: string,
  unresolvedAdvisories: readonly { id: string; severity: AuditExceptionRecord["severity"]; exception?: AuditExceptionRecord }[]
): string[] {
  const errors: string[] = []
  if (manifest.packageManager !== "npm@11.16.0") {
    errors.push(`unexpected packageManager: ${String(manifest.packageManager)}`)
  }
  const normalizedCi = ciWorkflow.replaceAll("\r\n", "\n")
  if (!/^\s*- run:\s*npm ci$/m.test(normalizedCi) || /\b(?:pnpm|yarn)\s+(?:install|add|ci)\b/i.test(normalizedCi)) {
    errors.push("CI workflow must use npm ci consistently without mixed package managers")
  }
  const lockRootDeps = lock.packages?.[""]?.devDependencies ?? {}
  for (const [pkg, spec] of Object.entries(manifest.devDependencies ?? {})) {
    if (lockRootDeps[pkg] !== spec) {
      errors.push(`lockfile root devDependency drift on ${pkg}: manifest=${spec} lock=${String(lockRootDeps[pkg])}`)
    }
  }
  for (const [pkg, minVer] of Object.entries(MINIMUM_PATCHED_VERSIONS)) {
    const lockedVer = lock.packages?.[`node_modules/${pkg}`]?.version
    if (!lockedVer) {
      errors.push(`missing locked package node_modules/${pkg}`)
      continue
    }
    if (compareSemver(lockedVer, minVer) < 0) {
      errors.push(`unpatched vulnerable version for ${pkg}: locked=${lockedVer} < required=${minVer}`)
    }
  }
  for (const advisory of unresolvedAdvisories) {
    if (advisory.severity === "critical" || advisory.severity === "high") {
      errors.push(`unacceptable ${advisory.severity} advisory without fix: ${advisory.id}`)
      continue
    }
    const ex = advisory.exception
    if (!ex || ex.id !== advisory.id || !ex.owner.trim() || !ex.mitigation.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(ex.expiresOn)) {
      errors.push(`missing complete exception metadata for unresolved advisory ${advisory.id}`)
    }
  }
  return errors
}

describe("R11 dependency lock parity, single package manager CI, and audit accountability", () => {
  const manifest = JSON.parse(readFileSync("package.json", "utf8")) as RootManifest
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8")) as PackageLock
  const ciWorkflow = readFileSync(".github/workflows/ci.yml", "utf8")

  it("rejects lockfile version drift, mixed package managers in CI, and unhandled advisories", () => {
    const driftedLock: PackageLock = {
      packages: {
        ...lock.packages,
        "": { devDependencies: { ...(manifest.devDependencies ?? {}), vitest: "^4.1.11" } },
        "node_modules/vitest": { version: "4.1.11" }
      }
    }
    expect(dependencyGateErrors(manifest, driftedLock, ciWorkflow, [])).toEqual(
      expect.arrayContaining([
        expect.stringContaining("lockfile root devDependency drift on vitest"),
        expect.stringContaining("unpatched vulnerable version for vitest")
      ])
    )

    const mixedCi = ciWorkflow.replace("- run: npm ci", "- run: pnpm install --frozen-lockfile")
    expect(dependencyGateErrors(manifest, lock, mixedCi, [])).toEqual(
      expect.arrayContaining([expect.stringContaining("mixed package managers")])
    )

    expect(
      dependencyGateErrors(manifest, lock, ciWorkflow, [
        { id: "GHSA-g3hv-75wg-m249", severity: "moderate" }
      ])
    ).toEqual(expect.arrayContaining([expect.stringContaining("missing complete exception metadata")]))

    expect(
      dependencyGateErrors(manifest, lock, ciWorkflow, [
        { id: "GHSA-high-example", severity: "high", exception: { id: "GHSA-high-example", severity: "high", owner: "dev", mitigation: "none", expiresOn: "2026-12-31" } }
      ])
    ).toEqual(expect.arrayContaining([expect.stringContaining("unacceptable high advisory")]))
  })

  it("enforces aligned patched lockfile versions and single-package-manager CI on the repository", () => {
    const errors = dependencyGateErrors(manifest, lock, ciWorkflow, [
      {
        id: "GHSA-g3hv-75wg-m249",
        severity: "moderate",
        exception: {
          id: "GHSA-g3hv-75wg-m249",
          severity: "moderate",
          owner: "repo-maintainers",
          mitigation: "dev-only ESLint TypeScript parser glob matching; prod --omit=dev 0 advisories",
          expiresOn: "2026-12-31"
        }
      }
    ])
    expect(errors).toEqual([])
  })
})
