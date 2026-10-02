import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"

import { SpatialSolidWizard } from "./SpatialSolidWizard"
import { DEFAULT_SOLID_WIZARD_DRAFT } from "../spatialSolidWizardModel"

describe("high-school solid creator", () => {
  it("shows seven classroom solids and keeps cube edge length as one input", () => {
    const onChange = vi.fn()
    render(<SpatialSolidWizard draft={{ ...DEFAULT_SOLID_WIZARD_DRAFT, preset: "cube" }} onChange={onChange} onCancel={() => {}} onConfirm={() => {}} />)
    expect(screen.getByRole("dialog", { name: "常用立体" })).toBeTruthy()
    const choices = screen.getByRole("combobox", { name: "立体类型" })
    // 六个多面体预设 + 球体（2026-10-01 加）。
    expect(choices.querySelectorAll("option")).toHaveLength(7)
    expect([...choices.querySelectorAll("option")].map((option) => option.textContent)).toContain("球体")
    expect(screen.getByRole("spinbutton", { name: "棱长" })).toBeTruthy()
    expect(screen.queryByRole("spinbutton", { name: "底面宽" })).toBeNull()
    fireEvent.change(screen.getByRole("spinbutton", { name: "棱长" }), { target: { value: "5" } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ width: 5 }))
  })

  it("offers only a centre and a radius for the sphere, and nothing about prisms or pyramids", () => {
    const onChange = vi.fn()
    render(<SpatialSolidWizard draft={{ ...DEFAULT_SOLID_WIZARD_DRAFT, preset: "sphere" }} onChange={onChange} onCancel={() => {}} onConfirm={() => {}} />)

    // 球只有这两个入参：底面 / 拉伸向量 / 顶点偏移那一整套都与它无关。
    expect(screen.getByRole("spinbutton", { name: "半径" })).toBeTruthy()
    expect(screen.getByRole("spinbutton", { name: "球心 X" })).toBeTruthy()
    expect(screen.queryByRole("spinbutton", { name: "底面宽" })).toBeNull()
    expect(screen.queryByRole("spinbutton", { name: "拉伸向量 Z" })).toBeNull()
    expect(screen.queryByRole("spinbutton", { name: "顶点偏移 X" })).toBeNull()

    fireEvent.change(screen.getByRole("spinbutton", { name: "半径" }), { target: { value: "5" } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ radius: 5 }))
  })

  it("moves keyboard focus into the form when it opens", () => {
    render(<SpatialSolidWizard draft={DEFAULT_SOLID_WIZARD_DRAFT} onChange={() => {}} onCancel={() => {}} onConfirm={() => {}} />)
    expect(document.activeElement).toBe(screen.getByRole("combobox", { name: "立体类型" }))
  })
  it("shows the selected-face option only when there is a usable face", () => {
    const onChange = vi.fn()
    const draft = { ...DEFAULT_SOLID_WIZARD_DRAFT, preset: "tri-prism" as const }
    const view = render(<SpatialSolidWizard draft={draft} onChange={onChange} onCancel={() => {}} onConfirm={() => {}} />)
    expect(screen.queryByRole("checkbox", { name: /选中面/ })).toBeNull()
    view.rerender(<SpatialSolidWizard draft={draft} selectedFaceLabel="面 ABC" onChange={onChange} onCancel={() => {}} onConfirm={() => {}} />)
    fireEvent.click(screen.getByRole("checkbox", { name: /选中面/ }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ useSelectedBase: true }))
  })

  it("blocks confirmation on invalid geometry and lets the user close the preview", () => {
    const onCancel = vi.fn()
    const onConfirm = vi.fn()
    render(<SpatialSolidWizard draft={DEFAULT_SOLID_WIZARD_DRAFT} error="高度必须大于零" onChange={() => {}} onCancel={onCancel} onConfirm={onConfirm} />)
    expect(screen.getByRole("alert").textContent).toContain("高度必须大于零")
    expect(screen.getByRole("button", { name: "确认创建" }).hasAttribute("disabled")).toBe(true)
    fireEvent.click(screen.getByRole("button", { name: "取消" }))
    expect(onCancel).toHaveBeenCalledTimes(1)
    expect(onConfirm).not.toHaveBeenCalled()
  })
})