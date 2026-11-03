import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { ModuleRail } from "./ModuleRail"

describe("module rail", () => {
  it("marks the active module and switches to the other one", () => {
    const onModuleChange = vi.fn()
    render(<ModuleRail activeModule="traditional" onModuleChange={onModuleChange} />)

    const traditional = screen.getByRole("button", { name: "传统工作区" })
    const agent = screen.getByRole("button", { name: "Agent 工作区" })
    expect(traditional.getAttribute("aria-pressed")).toBe("true")
    expect(agent.getAttribute("aria-pressed")).toBe("false")

    fireEvent.click(agent)
    expect(onModuleChange).toHaveBeenCalledWith("agent")
  })

})
