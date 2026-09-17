import { describe, expect, it } from "vitest"

import { cameraDragMode } from "./threeCamera"

/**
 * 体检发现的真缺陷：3D 视口把 Shift 记在 **pointerdown 的快照**里（`pointerState.shiftKey`），
 * 而指针移动时只看那份快照。用户"先按住左键、再想起按 Shift"是最自然的顺序，
 * 于是 Shift 平移完全不生效；反过来拖动中松开 Shift 也不会回到旋转。
 * 判定改为读**当前**移动事件，并抽成纯函数以便钉住。
 */
describe("camera drag mode", () => {
  const base = { button: 0, shiftKey: false, ctrlKey: false, metaKey: false }

  it("rotates for a plain left drag", () => {
    expect(cameraDragMode(base, false)).toBe("rotate")
  })

  it("pans while Shift is held, even when it was pressed after pointerdown", () => {
    // pointerdown 时是普通左键（button 0、无修饰键），移动事件里 Shift 已经按下。
    expect(cameraDragMode({ ...base, shiftKey: true }, false)).toBe("screen-pan")
  })

  it("returns to rotation once Shift is released mid-drag", () => {
    expect(cameraDragMode(base, false)).toBe("rotate")
  })

  it("keeps middle-drag and pan-mode panning, and Ctrl/Cmd for depth panning", () => {
    expect(cameraDragMode({ ...base, button: 1 }, false)).toBe("screen-pan")
    expect(cameraDragMode(base, true)).toBe("screen-pan")
    expect(cameraDragMode({ ...base, ctrlKey: true }, false)).toBe("depth-pan")
    expect(cameraDragMode({ ...base, metaKey: true }, true)).toBe("depth-pan")
  })
})
