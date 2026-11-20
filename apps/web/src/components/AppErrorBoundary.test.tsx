import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { AppErrorBoundary } from "./AppErrorBoundary"

function Bomb({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("boom in render")
  return <div>正常内容</div>
}

describe("AppErrorBoundary", () => {
  it("catches render crashes and allows recovering the view", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {})
    try {
      const { rerender } = render(
        <AppErrorBoundary scope="canvas3d">
          <Bomb shouldThrow={true} />
        </AppErrorBoundary>
      )
      expect(screen.getByRole("alert").textContent).toContain("三维视图渲染出现异常，已自动隔离")
      expect(screen.getByRole("alert").textContent).toContain("boom in render")

      rerender(
        <AppErrorBoundary scope="canvas3d">
          <Bomb shouldThrow={false} />
        </AppErrorBoundary>
      )
      fireEvent.click(screen.getByRole("button", { name: "恢复视图" }))
      expect(screen.getByText("正常内容")).toBeTruthy()
    } finally {
      spy.mockRestore()
    }
  })
})
