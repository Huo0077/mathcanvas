import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { CalculusWorkbench } from "./CalculusWorkbench"

describe("CalculusWorkbench", () => {
  it("renders 1D extrema global max/min and switches university presets cleanly", () => {
    render(<CalculusWorkbench document={createEmptyDocument("calculus")} />)

    expect(screen.getByRole("tab", { name: "一元极值与最值" }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByText("闭区间 [-2.2, 2.5] 全局最值")).toBeTruthy()
    expect(screen.getAllByText("9.125").length).toBeGreaterThanOrEqual(1)

    // Switch to rational function preset with vertical + oblique asymptotes
    fireEvent.click(screen.getByRole("button", { name: /有理函数与斜渐近线/ }))
    expect(screen.getByText("x = 1")).toBeTruthy()
    expect(screen.getByText("y = x + 1")).toBeTruthy()
  })

  it("shows Lagrange contour tangency diagnostics, snaps to KKT stationary points, and toggles 2D+3D split", () => {
    render(<CalculusWorkbench document={createEmptyDocument("calculus")} />)

    fireEvent.click(screen.getByRole("tab", { name: "拉格朗日乘数法" }))
    expect(screen.getByText("动点 P 梯度共线实时诊断")).toBeTruthy()
    expect(screen.getByText("KKT 条件驻点精确解（点击定位）")).toBeTruthy()

    // Switch to classic Tongji ellipse-inscribed rectangle preset
    fireEvent.click(screen.getByRole("button", { name: /椭圆内接最大矩形/ }))
    fireEvent.click(screen.getByRole("button", { name: "跳转全局最大相切" }))
    expect(screen.getByText(/梯度共线 · 等高线与约束相切/)).toBeTruthy()

    // Toggle 2D+3D split view cleanly
    fireEvent.click(screen.getByRole("button", { name: "2D+3D 联动" }))
    expect(screen.getByRole("button", { name: "2D+3D 联动" }).getAttribute("aria-pressed")).toBe("true")
  })

  it("supports ODE slope field, 2D phase plane stability table, and 3D surface Hessian diagnostics", () => {
    render(<CalculusWorkbench document={createEmptyDocument("calculus")} />)

    // 1st-order ODE slope field
    fireEvent.click(screen.getByRole("tab", { name: "ODE 斜率场" }))
    expect(screen.getByText(/当前特解初值列表（3）/)).toBeTruthy()

    // 2D Phase plane with damped pendulum equilibria + div/curl probe
    fireEvent.click(screen.getByRole("tab", { name: "相平面向量场" }))
    expect(screen.getByText("平衡点与雅可比稳定性分类")).toBeTruthy()
    expect(screen.getByText("向量场散度与旋度探针（鼠标悬停）")).toBeTruthy()
    expect(screen.getByText("稳定焦点")).toBeTruthy()
    expect(screen.getAllByText("鞍点（不稳定）").length).toBeGreaterThanOrEqual(1)

    // 3D Surface extrema & saddle classification
    fireEvent.click(screen.getByRole("tab", { name: "3D 曲面与鞍点" }))
    expect(screen.getByText("二元驻点 Hessian 判别（AC − B²）")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /极小值与鞍点共存曲面/ }))
    expect(screen.getByText("局部极小值")).toBeTruthy()
    expect(screen.getAllByText("鞍点").length).toBeGreaterThanOrEqual(1)
  })

  it("supports Phase 3 PDE simulation, Taylor/Fourier series, and Double Integral order swap", () => {
    render(<CalculusWorkbench document={createEmptyDocument("calculus")} />)

    // PDE module: step heat equation & switch to Poisson dipole
    fireEvent.click(screen.getByRole("tab", { name: "PDE 偏微分方程" }))
    expect(screen.getByText("PDE 数值场实时状态")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "单步推进" }))
    expect(screen.getByText("0.035 s")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /电偶极子稳态电势与电场线/ }))
    expect(screen.getByText("SOR 收敛迭代")).toBeTruthy()

    // Series module: Taylor polynomial & Fourier spectrum
    fireEvent.click(screen.getByRole("tab", { name: "泰勒 / 傅里叶级数" }))
    expect(screen.getByText("n 阶泰勒多项式展开式")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "傅里叶级数 SN(x)" }))
    expect(screen.getByText("傅里叶逼近与吉布斯过冲诊断")).toBeTruthy()
    expect(screen.getByRole("img", { name: "傅里叶谐波幅频谱柱状图" })).toBeTruthy()

    // Double Integral module: verify exact integral remains invariant under 1-click order swap!
    fireEvent.click(screen.getByRole("tab", { name: "二重积分与极坐标" }))
    expect(screen.getByText("0.216667")).toBeTruthy() // 13/60 = 0.2166666...
    expect(screen.getByText("dy dx")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /一键交换积分次序/ }))
    expect(screen.getByText("dx dy")).toBeTruthy()
    expect(screen.getByText("0.216667")).toBeTruthy()
  })

  it("supports Phase 4 Linear Algebra SVD/Eigen, Probability CLT, and Smart Problem Bar routing", () => {
    render(<CalculusWorkbench document={createEmptyDocument("calculus")} />)

    // Linear Algebra module
    fireEvent.click(screen.getByRole("tab", { name: "线性代数变换" }))
    expect(screen.getByText("SVD 奇异值分解（A = U Σ Vᵀ）")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: /秩 1 奇异矩阵/ }))
    expect(screen.getByText("奇异降维塌缩（面积为 0）")).toBeTruthy()

    // Probability & Central Limit Theorem module
    fireEvent.click(screen.getByRole("tab", { name: "概率统计与CLT" }))
    expect(screen.getByText(/95\.00%/)).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "中心极限定理抽样" }))
    expect(screen.getByText("经验样本均值 vs 理论正态极限")).toBeTruthy()

    // Smart Natural-Language Problem Bar jumps directly to target module & parameters
    const smartInput = screen.getByLabelText("智能读题直达输入框")
    fireEvent.change(smartInput, { target: { value: "矩阵 [[2, 1], [1, 2]] 的特征值与奇异值" } })
    fireEvent.click(screen.getByRole("button", { name: "解析直达" }))
    expect(screen.getByRole("tab", { name: "线性代数变换" }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByText(/已切入「线性代数矩阵变换」/)).toBeTruthy()
  })

  it("preserves legacy calculus document primitives in the compatibility card", () => {
    const legacyDoc = {
      ...createEmptyDocument("calculus"),
      primitives: [
        { id: "fn-1", type: "function" as const, expression: "x*x", domain: [-1, 1] as [number, number], label: "旧函数" }
      ]
    }
    render(<CalculusWorkbench document={legacyDoc} />)
    expect(screen.getByText("旧函数", { selector: ".object-name" })).toBeTruthy()
  })

  it("keeps right properties dock visible with resize handle, dock toggles, and non-blank syntax fallback", () => {
    render(<CalculusWorkbench document={createEmptyDocument("calculus")} />)

    // Right properties dock + resize handle exist by default
    expect(screen.getByLabelText("右侧属性与数值诊断面板")).toBeTruthy()
    expect(screen.getByRole("separator", { name: "调整属性栏宽度" })).toBeTruthy()

    // Mid-edit incomplete formula must NOT blank out the right dock: shows warning + last valid result
    const exprInput = screen.getByLabelText("函数表达式 f(x)") as HTMLInputElement
    fireEvent.change(exprInput, { target: { value: "x^3 - " } })
    expect(screen.getByText("表达式暂未完整 · 已保留上次有效诊断")).toBeTruthy()
    expect(screen.getAllByText("9.125").length).toBeGreaterThanOrEqual(1)

    // Collapsing & re-expanding right dock via bottom status bar works cleanly
    const rightToggle = screen.getByRole("button", { name: "右栏 ▶" })
    fireEvent.click(rightToggle)
    expect(screen.queryByRole("separator", { name: "调整属性栏宽度" })).toBeNull()
    fireEvent.click(screen.getByRole("button", { name: "右栏 ◀" }))
    expect(screen.getByRole("separator", { name: "调整属性栏宽度" })).toBeTruthy()
  })

  it("supports contextual math symbol keypad insertion, keyboard tab navigation, and quick prompt chips", () => {
    render(<CalculusWorkbench document={createEmptyDocument("calculus")} />)

    // Contextual keypad inserts token into focused formula input
    const exprInput = screen.getByLabelText("函数表达式 f(x)") as HTMLInputElement
    exprInput.focus()
    exprInput.setSelectionRange(exprInput.value.length, exprInput.value.length)
    fireEvent.click(screen.getByRole("button", { name: "x²" }))
    expect(exprInput.value.endsWith("^2")).toBe(true)

    // Keyboard ArrowRight switches tab on single-row tablist
    const tablist = screen.getByRole("tablist", { name: "高数模块切换" })
    fireEvent.keyDown(tablist, { key: "ArrowRight" })
    expect(screen.getByRole("tab", { name: "参数与极坐标" }).getAttribute("aria-selected")).toBe("true")

    // Quick-try smart prompt chip routes directly to Linear Algebra SVD
    fireEvent.click(screen.getByRole("button", { name: "2×2 SVD" }))
    expect(screen.getByRole("tab", { name: "线性代数变换" }).getAttribute("aria-selected")).toBe("true")
    expect(screen.getByText("SVD 奇异值分解（A = U Σ Vᵀ）")).toBeTruthy()
  })

  it("supports natural/LaTeX input preview, expandable full keyboard, 1D integral/limit/dual-curve, and parametric/polar tab", () => {
    render(<CalculusWorkbench document={createEmptyDocument("calculus")} />)

    // 1D right panel includes definite integral, symbolic derivative, and limit diagnostics
    expect(screen.getByText("定积分 · 弧长 · 旋转体体积")).toBeTruthy()
    expect(screen.getByText("极限与连续性诊断")).toBeTruthy()
    expect(screen.getByText(/f'\(x\) =/)).toBeTruthy()

    // Expand full math keyboard & verify natural LaTeX input works with live preview
    fireEvent.click(screen.getByRole("button", { name: /完整键盘/ }))
    expect(screen.getByRole("button", { name: "三角与对数" })).toBeTruthy()
    const exprInput = screen.getByLabelText("函数表达式 f(x)") as HTMLInputElement
    fireEvent.change(exprInput, { target: { value: "\\frac{\\sin(x)}{x}" } })
    expect(screen.getByText(/可去间断点/)).toBeTruthy()

    // Enable dual-curve comparison g(x)
    fireEvent.click(screen.getByLabelText(/叠加对比函数 g\(x\)/))
    expect(screen.getByText("双曲线对比：交点与围成面积")).toBeTruthy()

    // Switch to Parametric & Polar tab and verify Cardioid area & Parametric cycloid arc length
    fireEvent.click(screen.getByRole("tab", { name: "参数与极坐标" }))
    expect(screen.getByText("极坐标面积与弧长（高数上核心）")).toBeTruthy()
    fireEvent.click(screen.getByRole("button", { name: "参数方程 (x(t), y(t))" }))
    expect(screen.getByText("参数曲线弧长与瞬时几何量")).toBeTruthy()
  })
})
