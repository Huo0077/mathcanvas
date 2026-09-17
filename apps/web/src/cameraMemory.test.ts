import { beforeEach, describe, expect, it } from "vitest"

import { forgetRememberedCamera, loadRememberedCamera, rememberCamera } from "./cameraMemory"
import { createCameraState } from "./threeCamera"

/**
 * 相机记忆：切走再切回立体几何时，视角必须回到用户离开时的样子。
 *
 * 3D 场景组件随工作区切换**卸载重建**，相机状态原本是组件里的 `useRef`，
 * 于是回来时永远是默认视角（再叠上"换文档就取景"的既有逻辑，用户转过的角度和缩放全丢）。
 * 这里记的是"某个文档配某个相机状态"，换文档不恢复——新文档应当重新构图。
 */
describe("camera memory", () => {
  beforeEach(() => forgetRememberedCamera())

  it("has nothing to restore before a camera was remembered", () => {
    expect(loadRememberedCamera("doc-1")).toBeNull()
  })

  it("hands back the remembered camera for the same document", () => {
    const state = { ...createCameraState(), azimuth: 123, distance: 4.5 }
    rememberCamera("doc-1", state)

    expect(loadRememberedCamera("doc-1")).toEqual(state)
  })

  it("ignores a camera remembered for another document", () => {
    rememberCamera("doc-1", createCameraState())

    expect(loadRememberedCamera("doc-2")).toBeNull()
  })

  it("keeps its own copy, so later mutations of the caller's object do not leak in", () => {
    const state = createCameraState()
    rememberCamera("doc-1", state)

    state.distance = 999
    state.target.x = 42

    expect(loadRememberedCamera("doc-1")?.distance).toBe(createCameraState().distance)
    expect(loadRememberedCamera("doc-1")?.target.x).toBe(0)
  })

  it("hands back a copy too, so the scene cannot corrupt what is stored", () => {
    rememberCamera("doc-1", createCameraState())

    const loaded = loadRememberedCamera("doc-1")!
    loaded.distance = 999
    loaded.target.z = -5

    expect(loadRememberedCamera("doc-1")?.distance).toBe(createCameraState().distance)
    expect(loadRememberedCamera("doc-1")?.target.z).toBe(0)
  })

  it("forgets on demand", () => {
    rememberCamera("doc-1", createCameraState())

    forgetRememberedCamera()

    expect(loadRememberedCamera("doc-1")).toBeNull()
  })

  /**
   * 体检发现的真缺陷：记忆只有一个槽位。交替打开两个 3D 文档时，后者的相机会把前者的覆盖掉，
   * 切回第一个文档就只能重新取景（用户转过的角度、缩放、视点全丢）。
   */
  it("keeps a camera per document when two documents alternate", () => {
    const first = { ...createCameraState(), azimuth: 100, distance: 5 }
    const second = { ...createCameraState(), azimuth: -40, distance: 9 }
    rememberCamera("doc-1", first)
    rememberCamera("doc-2", second)

    expect(loadRememberedCamera("doc-1")).toEqual(first)
    expect(loadRememberedCamera("doc-2")).toEqual(second)

    // 切回 doc-1 再写回：两个都还在（后写的不会挤掉前者）。
    rememberCamera("doc-1", { ...first, distance: 6 })
    expect(loadRememberedCamera("doc-2")).toEqual(second)
    expect(loadRememberedCamera("doc-1")?.distance).toBe(6)
  })

  it("bounds how many documents it remembers", () => {
    for (let index = 0; index < 6; index += 1) rememberCamera(`doc-${index}`, { ...createCameraState(), azimuth: index })

    // 最近访问的必须还在；最早的会被淘汰（内存不随文档数无限增长）。
    expect(loadRememberedCamera("doc-5")?.azimuth).toBe(5)
    expect(loadRememberedCamera("doc-4")?.azimuth).toBe(4)
    expect(loadRememberedCamera("doc-0")).toBeNull()
  })
})
