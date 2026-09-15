import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { GuidanceHint } from "./GuidanceHint"

describe("GuidanceHint", () => {
  it("announces the current hint and exposes a close control", () => {
    const onDismiss = vi.fn()
    render(<GuidanceHint text="二面角需要两个面" onDismiss={onDismiss} />)

    const hint = screen.getByRole("status", { name: "操作指引" })
    expect(hint.getAttribute("data-guidance")).toBe("true")
    expect(hint.textContent).toContain("二面角需要两个面")

    fireEvent.click(screen.getByRole("button", { name: "关闭操作指引" }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
