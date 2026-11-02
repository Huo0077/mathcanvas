import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { cleanup, fireEvent, render, screen } from "@testing-library/react"
import { createEmptyDocument } from "@draw/dsl"

import { App } from "./App"
import { useSceneStore } from "./store"
import { worldToSvg } from "./viewport"

describe("Block 3: 动点在轨直接绑定与画布直通", () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    cleanup()
  })

  it("在画布上将自由点拖拽到曲线上时自动触发磁吸并建立在轨绑定", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 3, label: "圆 1" },
      { id: "point-free", type: "point", x: 6, y: 0, label: "P" }
    ]
    useSceneStore.setState({
      document,
      workspaceDocuments: { [document.workspace]: document },
      history: [],
      future: [],
      error: null,
      expandedIds: ["sheet-1"],
      treeTab: "model"
    })

    render(<App />)

    const canvas = screen.getByRole("img", { name: "几何画布" })
    const pointHandle = canvas.querySelector('circle[data-primitive-type="point"][data-hit-target="true"]') as SVGCircleElement
    expect(pointHandle).toBeTruthy()

    const startPos = worldToSvg({ x: 6, y: 0 })
    const targetPos = worldToSvg({ x: 3, y: 0 })

    fireEvent.pointerDown(pointHandle, { clientX: startPos.x, clientY: startPos.y, pointerId: 10 })
    fireEvent.pointerMove(canvas, { clientX: targetPos.x, clientY: targetPos.y, pointerId: 10 })
    fireEvent.pointerUp(canvas, { clientX: targetPos.x, clientY: targetPos.y, pointerId: 10 })

    const updated = useSceneStore.getState().document.primitives.find((p) => p.id === "point-free")
    expect(updated?.type).toBe("point")
    if (updated?.type === "point") {
      expect(updated.binding?.kind).toBe("onPath")
      if (updated.binding?.kind === "onPath") {
        expect(updated.binding.pathId).toBe("circle-1")
        expect(updated.binding.parameterId).toBe("t-point-free")
        expect(useSceneStore.getState().document.parameters["t-point-free"]).toBeDefined()
      }
    }
  })

  it("拖动自由点靠近曲线时展示磁吸提示与徽标", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 3, label: "圆 1" },
      { id: "point-free", type: "point", x: 6, y: 0, label: "P" }
    ]
    useSceneStore.setState({
      document,
      workspaceDocuments: { [document.workspace]: document },
      history: [],
      future: [],
      error: null,
      expandedIds: ["sheet-1"],
      treeTab: "model"
    })

    render(<App />)

    const canvas = screen.getByRole("img", { name: "几何画布" })
    const pointHandle = canvas.querySelector('circle[data-primitive-type="point"][data-hit-target="true"]') as SVGCircleElement
    expect(pointHandle).toBeTruthy()

    const startPos = worldToSvg({ x: 6, y: 0 })
    const nearCurvePos = worldToSvg({ x: 3.1, y: 0 })

    // 拖动靠近曲线，触发 activeCurveSnap
    fireEvent.pointerDown(pointHandle, { clientX: startPos.x, clientY: startPos.y, pointerId: 11 })
    fireEvent.pointerMove(canvas, { clientX: nearCurvePos.x, clientY: nearCurvePos.y, pointerId: 11 })

    // 验证吸附光环与贴轨指示徽标渲染
    const snapBadge = canvas.querySelector('text[data-snap-badge="true"]')
    expect(snapBadge).toBeTruthy()
    expect(snapBadge?.textContent).toContain("贴轨「圆 1」")

    fireEvent.pointerUp(canvas, { clientX: nearCurvePos.x, clientY: nearCurvePos.y, pointerId: 11 })
  })

  it("动点属性栏提供直观滑轨 (range slider) 与解绑按钮", () => {
    const document = createEmptyDocument("conics")
    document.primitives = [
      { id: "circle-1", type: "circle", center: { x: 0, y: 0 }, radius: 4, label: "圆 1" },
      { id: "p-dyn", type: "point", x: 4, y: 0, label: "M", binding: { kind: "onPath", pathId: "circle-1", parameter: 0, parameterId: "t-p-dyn" } }
    ]
    document.parameters["t-p-dyn"] = { id: "t-p-dyn", value: 0, min: 0, max: Math.PI * 2, step: 0.01, label: "M 的路径参数" }
    useSceneStore.setState({
      document,
      workspaceDocuments: { [document.workspace]: document },
      history: [],
      future: [],
      error: null,
      expandedIds: ["sheet-1"],
      treeTab: "model"
    })

    render(<App />)

    // 在代数区点击 M，使其成为当前选中对象
    const pointRow = screen.getByText("M", { selector: ".object-name" })
    fireEvent.click(pointRow)

    // 验证滑轨存在
    const slider = screen.getByLabelText("路径滑轨") as HTMLInputElement
    expect(slider).toBeTruthy()
    expect(slider.type).toBe("range")

    // 滑动滑轨
    fireEvent.change(slider, { target: { value: "1.57" } })
    const param = useSceneStore.getState().document.parameters["t-p-dyn"]
    expect(param.value).toBeCloseTo(1.57)

    // 点击解绑为自由点
    const unbindBtn = screen.getByRole("button", { name: "解绑为自由点" })
    expect(unbindBtn).toBeTruthy()
    fireEvent.click(unbindBtn)

    const unboundPoint = useSceneStore.getState().document.primitives.find((p) => p.id === "p-dyn")
    if (unboundPoint?.type === "point") {
      expect(unboundPoint.binding?.kind).toBe("free")
    }
  })
})
