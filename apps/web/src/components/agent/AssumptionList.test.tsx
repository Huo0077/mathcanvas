import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { AssumptionList } from "./AssumptionList"

/**
 * **假设清单**。
 *
 * 这一节此前在整条链上都是空的：`ConfirmationPanel` 有 `assumptions` 这个 prop，
 * 但**没有任何地方会传值** —— 计划信封里根本没有这个字段（见 `EnvelopeAssumptions`）。
 * 数据面补上之后，这里钉住的是"界面怎么读它"。
 *
 * 断言只用原生 matcher（`.toBeNull()` / `.textContent`）：这个仓库没有装 jest-dom
 * （`test-setup.ts` 只补 storage 与 PointerEvent），写 `toBeEmptyDOMElement` 会直接报
 * "Invalid Chai property"，看起来像测试失败、其实是用了不存在的断言。
 */
describe("assumption list", () => {
  it("lists each assumption as its own item so the user can judge them one by one", () => {
    const { container } = render(<AssumptionList assumptions={["把「直径 6」读作半径 3", "底面落在地面上"]} />)

    const items = container.querySelectorAll("li")
    expect([...items].map((item) => item.textContent)).toEqual(["把「直径 6」读作半径 3", "底面落在地面上"])
  })

  it("renders nothing at all when no assumptions were declared", () => {
    const { container } = render(<AssumptionList assumptions={[]} />)

    // 关键：**不是**渲染一个空的"系统替你做的假设"标题 ——
    // 那会让用户以为"它检查过、确实没有"，而实际是我们**不知道**。
    expect(container.firstChild).toBeNull()
  })

  it("treats a missing field the same as no assumptions", () => {
    const { container } = render(<AssumptionList />)

    expect(container.firstChild).toBeNull()
  })

  it("uses the caller's wording for the heading", () => {
    render(<AssumptionList assumptions={["半径取 3"]} title="这一步我替你定了" />)

    expect(screen.getByRole("heading", { name: "这一步我替你定了" })).toBeTruthy()
  })
})
