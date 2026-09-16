import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { Ribbon, type RibbonGroup } from "./Ribbon"

const groups: RibbonGroup[] = [{
  id: "base",
  label: "基础图元",
  commands: [{ id: "add-point", label: "添加点", icon: "point", prompt: "在空白处单击以创建点" }]
}, {
  id: "edit",
  label: "作业操作",
  commands: [{ id: "delete", label: "删除对象", icon: "delete" }]
}]

describe("ribbon", () => {
  it("renders grouped commands and reports selected commands", () => {
    const onCommand = vi.fn()
    render(<Ribbon groups={groups} activeTab="home" expanded={true} pinned={false} onTabChange={() => {}} onCommand={onCommand} onExpandedChange={() => {}} onPinnedChange={() => {}} />)

    expect(screen.getByText("基础图元")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "添加点" }))
    expect(onCommand).toHaveBeenCalledWith("add-point")
  })

  it("collapses from the ribbon control and exposes the pin state", () => {
    const onExpandedChange = vi.fn()
    const onPinnedChange = vi.fn()
    render(<Ribbon groups={groups} activeTab="home" expanded={true} pinned={false} onTabChange={() => {}} onCommand={() => {}} onExpandedChange={onExpandedChange} onPinnedChange={onPinnedChange} />)

    fireEvent.click(screen.getByRole("button", { name: "收起功能区" }))
    fireEvent.click(screen.getByRole("button", { name: "固定功能区" }))
    expect(onExpandedChange).toHaveBeenCalledWith(false)
    expect(onPinnedChange).toHaveBeenCalledWith(true)
  })

  it("collapses with Ctrl+F1", () => {
    const onExpandedChange = vi.fn()
    render(<Ribbon groups={groups} activeTab="home" expanded={true} pinned={false} onTabChange={() => {}} onCommand={() => {}} onExpandedChange={onExpandedChange} onPinnedChange={() => {}} />)

    fireEvent.keyDown(window, { key: "F1", ctrlKey: true })

    expect(onExpandedChange).toHaveBeenCalledWith(false)
  })

  it("renders the two multimodal conversions as visibly unavailable commands", () => {
    const multimodalGroups: RibbonGroup[] = [{
      id: "multimodal",
      label: "多模态输入",
      commands: [
        { id: "input-text-conversion", label: "文字转换", icon: "text", disabled: true, disabledReason: "文字转换服务尚未接入，暂不可用" },
        { id: "input-image-conversion", label: "图片转换", icon: "image", disabled: true, disabledReason: "图片转换服务尚未接入，暂不可用" }
      ]
    }]
    const onCommand = vi.fn()
    render(<Ribbon groups={multimodalGroups} activeTab="home" expanded={true} pinned={false} onTabChange={() => {}} onCommand={onCommand} onExpandedChange={() => {}} onPinnedChange={() => {}} />)

    const textConversion = screen.getByRole("button", { name: "文字转换" }) as HTMLButtonElement
    const imageConversion = screen.getByRole("button", { name: "图片转换" }) as HTMLButtonElement
    expect(textConversion.disabled).toBe(true)
    expect(imageConversion.disabled).toBe(true)
    expect(textConversion.title).toBe("文字转换服务尚未接入，暂不可用")
    expect(imageConversion.title).toBe("图片转换服务尚未接入，暂不可用")
    expect(screen.queryByRole("button", { name: "抢答题" })).toBeNull()
    expect(screen.queryByRole("button", { name: "画笔标注" })).toBeNull()

    fireEvent.click(textConversion)
    expect(onCommand).not.toHaveBeenCalled()
  })
})
