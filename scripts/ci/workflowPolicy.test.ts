import { readFileSync } from "node:fs"

import { describe, expect, it } from "vitest"

const EXPECTED_ACTIONS: Readonly<Record<string, string>> = {
  "actions/checkout": "11d5960a326750d5838078e36cf38b85af677262",
  "actions/setup-node": "49933ea5288caeca8642d1e84afbd3f7d6820020",
  "actions/upload-artifact": "ea165f8d65b6e75b540449e92b4886f43607fa02",
  "dtolnay/rust-toolchain": "39008827e6b4319a349e9a42dfc90579dd25f1ca",
  "Swatinem/rust-cache": "d1527c8f67ef9af357290475d4af4b0fab8f12e0"
}

const EXPECTED_USE_COUNTS: Readonly<Record<string, number>> = {
  "actions/checkout": 4,
  "actions/setup-node": 4,
  "actions/upload-artifact": 1,
  "dtolnay/rust-toolchain": 1,
  "Swatinem/rust-cache": 1
}

function stepBlocks(workflow: string): string[] {
  const lines = workflow.split("\n")
  const blocks: string[] = []
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^ {6}- /.test(lines[index]!)) continue
    const block = [lines[index]!]
    let cursor = index + 1
    while (cursor < lines.length && !/^ {6}- /.test(lines[cursor]!) && !/^ {2}\S/.test(lines[cursor]!)) {
      block.push(lines[cursor]!)
      cursor += 1
    }
    blocks.push(block.join("\n"))
    index = cursor - 1
  }
  return blocks
}

function policyErrors(source: string, requireCompleteCi = false): string[] {
  const workflow = source.replaceAll("\r\n", "\n")
  const errors: string[] = []
  const preamble = workflow.split(/^jobs:/m)[0]!
  const permissions = /^permissions:\n(?: {2}[^\n]*(?:\n|$))*/m.exec(preamble)?.[0]
  if (permissions?.trimEnd() !== "permissions:\n  contents: read") {
    errors.push("top-level permissions must be exactly contents: read")
  }
  if (/^ {4}permissions:/m.test(workflow)) {
    errors.push("jobs must not request additional token permissions")
  }
  if (/^ {0,2}(?:pull_request_target|workflow_run|issue_comment):/m.test(workflow)) {
    errors.push("privileged trigger is not allowed")
  }
  if (/\$\{\{[^}]*(?:github\.head_ref|github\.event\.(?:issue|pull_request|comment|review|review_comment|commits|head_commit|pages))/.test(workflow)) {
    errors.push("untrusted event data must not enter action or shell inputs")
  }

  const blocks = stepBlocks(workflow)
  const references = blocks.flatMap((block) => {
    const match = /(?:^|\n) {6,8}(?:- )?uses: ([^\s#]+)/.exec(block)
    return match?.[1] === undefined ? [] : [match[1]]
  })
  const actualCounts = new Map<string, number>()
  for (const reference of references) {
    const separator = reference.lastIndexOf("@")
    const action = reference.slice(0, separator)
    const revision = reference.slice(separator + 1)
    const expected = EXPECTED_ACTIONS[action]
    if (expected === undefined) {
      errors.push(`unexpected action repository: ${action || reference}`)
    } else if (revision !== expected) {
      errors.push(`${action} must use its verified full commit SHA`)
    }
    actualCounts.set(action, (actualCounts.get(action) ?? 0) + 1)
  }
  if (requireCompleteCi) {
    for (const [action, count] of Object.entries(EXPECTED_USE_COUNTS)) {
      if (actualCounts.get(action) !== count) errors.push(`${action} must occur ${count} time(s)`)
    }
  }
  for (const block of blocks.filter((candidate) => /uses: actions\/checkout@/.test(candidate))) {
    if (!/^ {8}with:\n(?: {10}.+\n)* {10}persist-credentials: false\s*$/m.test(block)) {
      errors.push("checkout must disable persisted credentials")
    }
  }
  return errors
}

const validWorkflow = `name: CI
on:
  pull_request:
permissions:
  contents: read
jobs:
  checks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@${EXPECTED_ACTIONS["actions/checkout"]} # v4
        with:
          persist-credentials: false
      - run: npm ci
`

describe("GitHub Actions least-privilege policy", () => {
  it("holds the real CI workflow to the reviewed action identities and token boundary", () => {
    expect(policyErrors(readFileSync(".github/workflows/ci.yml", "utf8"), true)).toEqual([])
  })

  it("holds the multiplatform build workflow to the reviewed action identities and token boundary", () => {
    expect(
      policyErrors(readFileSync(".github/workflows/multiplatform-build.yml", "utf8"), false)
    ).toEqual([])
  })

  it("accepts a read-only workflow with an immutable checkout and no persisted token", () => {
    expect(policyErrors(validWorkflow)).toEqual([])
  })

  it.each([
    ["missing permissions", validWorkflow.replace("permissions:\n  contents: read\n", ""), /permissions/],
    ["write permissions", validWorkflow.replace("contents: read", "contents: write"), /permissions/],
    ["an additional write scope", validWorkflow.replace("  contents: read", "  contents: read\n  actions: write"), /permissions/],
    ["job permissions", validWorkflow.replace("    steps:", "    permissions:\n      checks: write\n    steps:"), /additional token/],
    ["a mutable action tag", validWorkflow.replace(EXPECTED_ACTIONS["actions/checkout"]!, "v4"), /full commit SHA/],
    ["an unknown action fork", validWorkflow.replace("actions/checkout", "unknown/checkout"), /unexpected action repository/],
    ["default checkout credentials", validWorkflow.replace("        with:\n          persist-credentials: false\n", ""), /persisted credentials/],
    ["persisted checkout credentials", validWorkflow.replace("persist-credentials: false", "persist-credentials: true"), /persisted credentials/],
    ["a privileged trigger", validWorkflow.replace("pull_request:", "pull_request_target:"), /privileged trigger/],
    ["PR data interpolated into a shell", validWorkflow.replace("run: npm ci", "run: echo \"${{ github.event.pull_request.title }}\""), /untrusted event data/]
  ])("rejects %s", (_label, workflow, expected) => {
    expect(policyErrors(workflow).join("\n")).toMatch(expected)
  })
})
