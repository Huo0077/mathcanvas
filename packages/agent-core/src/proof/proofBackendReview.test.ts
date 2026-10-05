import { describe, expect, it } from "vitest"

import { WIRED_PROOF_BACKENDS } from "./proofArtifact"
import {
  isReviewPassed,
  PROOF_BACKEND_REVIEWS,
  PROOF_BACKEND_REVIEW_FIELDS,
  PROOF_PROCESS_MODELS,
  reviewProblems,
  type ProofBackendReview
} from "./proofBackendReview"

/**
 * **接一个证明后端之前的准入契约**（实施计划 N5）。
 *
 * 计划的原话是"没有审查结论**不得**接入默认构建"。这一层把它做成可执行的门：
 * 接后端 = 交一份十栏填齐、结论为 `passed` 的记录，而不是往一个字符串数组里加名字。
 */

function review(overrides: Partial<ProofBackendReview> = {}): ProofBackendReview {
  return {
    name: "lean4",
    version: "4.12.0",
    license: "Apache-2.0",
    processModel: "child-process",
    nativeOrWasmDependencies: [],
    startupBudgetMs: 2000,
    timeoutPolicy: "30 秒后杀进程，报 timeout，不返回半成品",
    failureBehaviour: "报 failed，绝不降级成 verified",
    cacheAndSandbox: "只读挂载 mathlib，沙箱内无网络",
    verdict: "passed",
    ...overrides
  }
}

describe("证明后端的审查记录（N5 的准入契约）", () => {
  it("十栏填齐**且**结论是 passed 才叫通过", () => {
    expect(reviewProblems(review())).toEqual([])
    expect(isReviewPassed(review())).toBe(true)
  })

  it("缺哪一个字段都会点名（一栏都不许被悄悄跳过）", () => {
    for (const field of PROOF_BACKEND_REVIEW_FIELDS) {
      const broken = review() as unknown as Record<string, unknown>
      delete broken[field]
      expect(reviewProblems(broken), field).toContain(`缺少字段 ${field}`)
    }
  })

  it("填齐了但结论不是 passed，同样不许接入 —— 两种「不算」要分得清", () => {
    // 不是"没填"（reviewProblems 是空的），而是"填了、评审结论是拒绝"。
    expect(reviewProblems(review({ verdict: "rejected" }))).toEqual([])
    expect(isReviewPassed(review({ verdict: "rejected" }))).toBe(false)
    expect(isReviewPassed(review({ verdict: "not-reviewed" }))).toBe(false)
  })

  it("没有原生/WASM 依赖要写**空数组**：不能省掉这一栏，也不能留空项", () => {
    expect(reviewProblems(review({ nativeOrWasmDependencies: [] }))).toEqual([])
    expect(reviewProblems(review({ nativeOrWasmDependencies: undefined as unknown as readonly string[] })).length).toBeGreaterThan(0)
    expect(reviewProblems(review({ nativeOrWasmDependencies: ["libz3.so", " "] })).some((problem) => problem.includes("空项"))).toBe(true)
  })

  it("启动耗时必须是**有限的非负数** —— 写「很快」不算", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, -1, "2000" as unknown as number]) {
      expect(reviewProblems(review({ startupBudgetMs: bad })), String(bad)).toContain("startupBudgetMs 必须是有限的非负数（单位毫秒）")
    }
  })

  it("进程模型要落在词表里（自由文本做不到「一眼看出会不会起子进程」）", () => {
    expect(
      reviewProblems(review({ processModel: "child" as unknown as ProofBackendReview["processModel"] })).some((problem) => problem.includes("不在词表里"))
    ).toBe(true)
    for (const model of PROOF_PROCESS_MODELS) expect(reviewProblems(review({ processModel: model })), model).toEqual([])
  })

  it("说明性文字只要求非空 —— 本层不判断它写得对不对", () => {
    expect(reviewProblems(review({ timeoutPolicy: "   " }))).toContain('timeoutPolicy 必须是非空字符串（"没查"不能写成空）')
    // 非空就算过，哪怕内容很虚：判断对错是**人的审查结论**，不是这一层的职责。
    expect(reviewProblems(review({ timeoutPolicy: "不知道" }))).toEqual([])
  })

  it("**接入不变量**：`WIRED_PROOF_BACKENDS` 里每个名字都必须有一份 passed 记录", () => {
    // 这条钉住的是**"推导"这件事本身** —— 哪天有人把 `WIRED_PROOF_BACKENDS` 改回手写数组，它会红。
    // 名单的**精确字面量**只写在 `proofBackendAdmission.test.ts` 里（一处，不是两处）。
    for (const name of WIRED_PROOF_BACKENDS) {
      const record = PROOF_BACKEND_REVIEWS.find((entry) => entry.name === name)
      expect(record, `${name} 被接上了却没有审查记录`).toBeDefined()
      expect(isReviewPassed(record)).toBe(true)
    }
    expect(WIRED_PROOF_BACKENDS).toEqual(PROOF_BACKEND_REVIEWS.filter((entry) => isReviewPassed(entry)).map((entry) => entry.name))
  })

  it("今天的实况：**恰好一条**审查记录（`lean4`），而它不是空表", () => {
    // 这一条原来是 `toEqual([])`（一个后端都没接）。2026-10-06（N5b）接上 `lean4` 之后，
    // 它按设计红了 —— 现在改成"记录条数恰好是一、而且第一条就是它"，
    // 于是"哪天记录被误删/多出一条"仍然会红（不是被删掉，也不是被放宽）。
    expect(PROOF_BACKEND_REVIEWS).toHaveLength(1)
    expect(PROOF_BACKEND_REVIEWS[0].name).toBe("lean4")
    expect(WIRED_PROOF_BACKENDS).toEqual(["lean4"])
  })

  it("不是对象（模型直接给了一段话 / 一个数组）要拒，且**不抛**", () => {
    for (const value of [null, "lean4", 42, []]) expect(reviewProblems(value)).toEqual(["审查记录必须是一个对象"])
  })
})
