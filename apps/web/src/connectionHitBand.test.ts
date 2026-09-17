import { describe, expect, it } from "vitest"

import { insetSegment } from "./connectionHitBand"

/**
 * 连线的命中带要从两端缩进。
 *
 * 用户反馈："把动点放在轨道上，动点又和另一个定点连了线，那我移动轨道会带着设置好的定点一起移动"。
 * 取证（Playwright 探针，读指针事件的 target）发现真正的毛病是：连线在点**之后**渲染，
 * 命中带又有 18px 宽（±9px），于是端点正中心那一下指针按下落在连线上；连线是派生对象、
 * 拖不动，拖动还会退化成框选——端点点起来"抓不住"。
 */
describe("connection hit band", () => {
  it("pulls the hit band back from both endpoints so the points keep their own grab area", () => {
    const band = insetSegment({ start: { x: 0, y: 0 }, end: { x: 10, y: 0 } }, 1.5)

    expect(band.start.x).toBeCloseTo(1.5, 9)
    expect(band.end.x).toBeCloseTo(8.5, 9)
    expect(band.start.y).toBeCloseTo(0, 9)
    expect(band.end.y).toBeCloseTo(0, 9)
  })

  it("keeps at least half of a very short connection selectable", () => {
    // 缩进不能把整条命中带吃掉，否则短连线没法点选。
    const band = insetSegment({ start: { x: 0, y: 0 }, end: { x: 2, y: 0 } }, 5)
    expect(band.start.x).toBeCloseTo(0.5, 9)
    expect(band.end.x).toBeCloseTo(1.5, 9)
  })

  it("leaves a degenerate connection alone instead of producing NaN", () => {
    const zero = insetSegment({ start: { x: 1, y: 1 }, end: { x: 1, y: 1 } }, 1)
    expect(zero.start).toEqual({ x: 1, y: 1 })
    expect(zero.end).toEqual({ x: 1, y: 1 })
  })
})
