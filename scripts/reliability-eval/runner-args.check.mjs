import assert from "node:assert/strict"
import { test } from "node:test"
import { parseReliabilityArgs } from "./runner.mjs"

test("paid reliability runner requires both confirmation and a request cap", () => {
  assert.throws(() => parseReliabilityArgs(["--allow-paid", "--max-requests", "3"]), /confirm-paid/)
  assert.throws(() => parseReliabilityArgs(["--allow-paid", "--confirm-paid"]), /max-requests/)
  assert.throws(() => parseReliabilityArgs(["--confirm-paid"]), /only applies/)
  assert.deepEqual(parseReliabilityArgs(["--allow-paid", "--confirm-paid", "--max-requests", "3"]),
    { mode: "live", paidConfirmed: true, maxRequests: "3" })
  assert.deepEqual(parseReliabilityArgs([]), { mode: "offline", paidConfirmed: false })
})
