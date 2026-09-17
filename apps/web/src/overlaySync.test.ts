import { beforeEach, describe, expect, it } from "vitest"

import { forgetOverlay, syncOverlay, type OverlayEntry } from "./overlaySync"

/**
 * 覆盖层增量同步的用例。
 * 关键是"没变化就不动 DOM"：3D 视口每帧都会同步这两层覆盖层，
 * 一旦退化成整体重建，读屏软件会把 `role="status"` 的测量标注当成新消息反复播报，
 * 元素的入场动画也会随重建不停重播（拖动时表现为闪烁）。
 */

let host: HTMLElement

beforeEach(() => {
  document.body.innerHTML = '<div class="overlay"></div>'
  host = document.querySelector(".overlay") as HTMLElement
  forgetOverlay(host)
})

const label = (overrides: Partial<OverlayEntry> & { key: string }): OverlayEntry => ({
  text: overrides.key,
  visible: true,
  left: 10,
  top: 20,
  ...overrides
})

const createSpan = () => {
  const span = document.createElement("span")
  span.className = "label"
  return span
}

function countChildMutations(target: HTMLElement, run: () => void): number {
  let childMutations = 0
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList") childMutations += 1
    }
  })
  observer.observe(target, { childList: true, subtree: true, attributes: true })
  run()
  observer.takeRecords()
  observer.disconnect()
  return childMutations
}

describe("syncOverlay", () => {
  it("creates one node per entry, in order, with text, dataset and position", () => {
    const result = syncOverlay(host, [label({ key: "a", text: "A", dataset: { pointId: "a" } }), label({ key: "b", text: "B", left: 30 })], createSpan)

    expect(result).toEqual({ created: 2, updated: 2, removed: 0 })
    const nodes = Array.from(host.children) as HTMLElement[]
    expect(nodes.map((node) => node.textContent)).toEqual(["A", "B"])
    expect(nodes[0].dataset.pointId).toBe("a")
    expect(nodes[1].style.left).toBe("30px")
    expect(nodes[1].style.top).toBe("20px")
  })

  it("touches nothing when the entries are unchanged", () => {
    const entries = [label({ key: "a" }), label({ key: "b" })]
    syncOverlay(host, entries, createSpan)
    const before = Array.from(host.children)

    let result: ReturnType<typeof syncOverlay> = { created: -1, updated: -1, removed: -1 }
    const mutations = countChildMutations(host, () => {
      result = syncOverlay(host, entries, createSpan)
    })

    expect(result).toEqual({ created: 0, updated: 0, removed: 0 })
    expect(mutations).toBe(0)
    // 同一个节点对象被复用：这正是 role="status" 不被反复播报的原因
    expect(Array.from(host.children)).toEqual(before)
    expect(host.children[0]).toBe(before[0])
  })

  it("moves and retitles an existing node in place", () => {
    syncOverlay(host, [label({ key: "a", text: "A" })], createSpan)
    const node = host.children[0] as HTMLElement

    const result = syncOverlay(host, [label({ key: "a", text: "A′", left: 44, top: 55 })], createSpan)

    expect(result).toEqual({ created: 0, updated: 1, removed: 0 })
    expect(host.children[0]).toBe(node)
    expect(node.textContent).toBe("A′")
    expect(node.style.left).toBe("44px")
    expect(node.style.top).toBe("55px")
  })

  it("updates dataset attributes and drops the ones that disappear", () => {
    syncOverlay(host, [label({ key: "a", dataset: { pointId: "a", pointLabel: "A" } })], createSpan)
    const node = host.children[0] as HTMLElement
    expect(node.dataset.pointLabel).toBe("A")

    syncOverlay(host, [label({ key: "a", dataset: { pointId: "a" } })], createSpan)

    expect(node.dataset.pointId).toBe("a")
    expect(node.dataset.pointLabel).toBeUndefined()
  })

  it("hides a node that leaves the frustum, then reuses it when it comes back", () => {
    syncOverlay(host, [label({ key: "a" })], createSpan)
    const node = host.children[0] as HTMLElement

    const hidden = syncOverlay(host, [label({ key: "a", visible: false })], createSpan)
    expect(hidden).toEqual({ created: 0, updated: 1, removed: 0 })
    expect(node.hidden).toBe(true)
    expect(host.children[0]).toBe(node)

    const shown = syncOverlay(host, [label({ key: "a", left: 99 })], createSpan)
    expect(shown.updated).toBe(1)
    expect(node.hidden).toBe(false)
    expect(node.style.left).toBe("99px")
  })

  it("removes nodes whose key is gone, and recreates them if they return", () => {
    syncOverlay(host, [label({ key: "a" }), label({ key: "b" })], createSpan)
    const removed = host.children[1] as HTMLElement

    const result = syncOverlay(host, [label({ key: "a" })], createSpan)

    expect(result).toEqual({ created: 0, updated: 0, removed: 1 })
    expect(removed.isConnected).toBe(false)
    expect(host.children).toHaveLength(1)

    const again = syncOverlay(host, [label({ key: "a" }), label({ key: "b" })], createSpan)
    expect(again.created).toBe(1)
    expect(host.children).toHaveLength(2)
  })

  it("keeps the DOM order matching the entry order", () => {
    syncOverlay(host, [label({ key: "a", text: "A" }), label({ key: "b", text: "B" })], createSpan)

    syncOverlay(host, [label({ key: "b", text: "B" }), label({ key: "a", text: "A" })], createSpan)

    expect(Array.from(host.children).map((node) => node.textContent)).toEqual(["B", "A"])
  })
})
