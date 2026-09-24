/**
 * 立体几何里"圆"类实体的默认分段数。
 *
 * 圆柱与圆锥是**多边形近似**（内核只有多面体），分段数直接决定屏幕上看着圆不圆：
 * 原来写死 24 段，半径 1.5 的圆柱在常见取景下每个侧面跨 15°，轮廓看得出明显的棱
 *（用户反馈："圆柱不圆"）。48 段把每个面的跨度减半、弦高误差降到约 0.7 像素，
 * 同时相交计算的面数（48 个侧面 + 两个底面 + 少量切口面）仍在预览配额之内。
 *
 * **真源已经搬到内核**（`@draw/geometry-kernel` 的 `DEFAULT_SOLID_SEGMENTS`，与
 * `MAX_SOLID_SEGMENTS` 相邻）：动作层的 `solid.create_template` 也要写这个数，
 * 而它不许反向依赖 Web。这里保留名字只是为了让既有调用点与测试继续读得通。
 */
export { DEFAULT_SOLID_SEGMENTS as ROUND_SOLID_SEGMENTS } from "@draw/geometry-kernel"
