import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { WorkspaceHeader } from "./WorkspaceHeader"

describe("workspace top bar", () => {
  it("renders the system actions and removes workspace pills from the top bar", () => {
    render(<WorkspaceHeader activeWorkspace="conics" onWorkspaceChange={() => {}} onOpen={() => {}} onSave={() => {}} />)

    expect(screen.getByRole("banner").textContent).toContain("MathCanvas")
    expect(screen.getByPlaceholderText("搜索工具、命令或定理..."))
    expect(screen.getByRole("button", { name: "打开 .mgeo" })).toBeTruthy()
    expect(screen.queryByRole("button", { name: "立体几何" })).toBeNull()
  })
})
