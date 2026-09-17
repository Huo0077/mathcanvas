import { DEFAULT_MAX_BOOLEAN_PAIRS, DEFAULT_MAX_FACES_PER_PAIR, MAX_PAIRS } from "./intersectionPreviews3d"

export type PromptCreationMode = "line" | "segment" | "ray" | "polyline" | "circle" | "arc" | null

/** Display control currently switched on in the 3D scene. They are temporary display state, never document state. */
export type SceneControlMode = "normals" | "dihedral-demo" | "free-drag"

interface StatusPromptState {
  mode: PromptCreationMode
  selectedCount: number
  selectedLabel: string | null
  hasCenter: boolean
  hasStart: boolean
  pointCount: number
  sceneControl?: SceneControlMode | null
  /**
   * 选中的是「点」时的绑定状态。用来回答用户反馈的那个问题：
   * "动点的内容完全没有提示，我也不知道如何将点固定到我创立的曲线或直线轨迹上面。"
   * 绑定能力一直在属性栏里（「路径绑定」下拉 + 路径参数 + 记录轨迹），缺的只是说出来。
   */
  pointBinding?: { bound: boolean; hasPaths: boolean; pathLabel?: string | null } | null
  /** 选中的是一条**能当路径**的曲线/直线：提示用户"再选一个点，把它绑到这条线上"。 */
  pathSelected?: boolean
  /**
   * 绕定点旋转的提示状态。
   *
   * `ready` 表示"点 + 圆/椭圆"都已经选中（Ribbon 的「绕定点旋转」此刻可用）；
   * `available` 表示文档里既有可当定点的点、又有封闭曲线，只是还没两样都选中。
   * 这是个纯几何能力，不说出来用户不会知道它存在——与路径绑定当初的缺口一模一样。
   */
  rotationAnchor?: { ready: boolean; available: boolean } | null
  /**
   * 选中的是一条**以某个点为定点的曲线**（"动圆"）。
   *
   * 它同时也是一个合法的路径宿主（`pathSelected` 也为真），但用户此刻关心的是"它在绕谁转、半径多大"，
   * 而不是"把别的点绑到它上面"，所以这条要压过路径绑定提示。
   */
  movingCircleSelected?: boolean
}

/**
 * The 3D scene's own display switches need an explanation, because "测量二面角" only draws a sample angle
 * for the axes — it does not measure the faces the user selected. Say so, and name the real workflow.
 */
export function resolveSceneControlPrompt(sceneControl: SceneControlMode): string {
  if (sceneControl === "normals") return "法向量已显示：每个可见面的外法向量由面顶点顺序算出，随朝向和剖切结果一起更新。"
  if (sceneControl === "free-drag") return "自由拖动已开启：左键按住图形整体移动（在屏幕平面内，深度不变）。实体、点、以及由点驱动的棱/线/面/平面都能拖；拖动时视角不会旋转。"
  return "这里显示的是坐标轴夹角的示例值，不读取你的选择；要测量实际二面角，请按住 Alt 点实体表面单独选两个面，再在右侧属性区点「二面角内角」或「二面角外角」。"
}

/**
 * 3D 虚线预览的状态提示。预览分两级（设计规格第 8 节）：未选中对象时只在状态栏说明，
 * 选中两个对象后画布给出完整预览与标签。
 */
export function resolveIntersectionPreviewPrompt(preview: { kind: string; label: string; reason?: string } | null, hovering: boolean): string | null {
  if (!preview) return null
  if (preview.kind === "insufficient") return preview.reason ?? null
  if (preview.kind === "none") return null
  if (preview.kind === "section") {
    // "已选中…" itself carries information the user needs, so an un-hovered section preview must not
    // replace it. The cut gets explained once the user actually points at it.
    // 用户反馈："我需要的是交面、交线和交点"——所以这里点名三者：圆点是交点、虚线圈是交线、点出来的才是交面。
    if (hovering) return `${preview.label}：一圈虚线是这一刀的交线、圆点是交点，点击即创建截面（交面）；创建后选中截面，在自由拖动模式下拖动或按方向键可移动剖切面。`
    return null
  }
  if (preview.kind === "face") {
    // 交面 = **一个**平面面片（用户口径："我需要的交面只是一个表面"），不是"一刀切出来的截面"。
    return hovering
      ? `${preview.label}：这一块半透明面片是两个实体公共区域的一个面，点击即创建这一面的交面图元；它的边就是交线、顶点就是交点。`
      : `${preview.label}：把指针移到半透明面片上，点击即可创建为交面图元。`
  }
  if (preview.kind === "point") {
    /**
     * 能点到的圆点必定是交线的**拐点**：光滑交线（圆柱↔圆柱一类）现在一个点标记都不给，
     * 标记只留给转折 ≥ 18° 的角点、悬挂端与分叉点（用户口径："曲线相交时交点太多了"）。
     */
    return hovering
      ? `${preview.label}：这个圆点是交线上的拐点（两个表面公共边上的转折处），点击即创建交点图元；它会跟着两个来源重算。`
      : `${preview.label}：把指针移到圆点上，点击即可创建为交点图元。`
  }
  return hovering ? `${preview.label}：点击即可创建为交线图元。` : `${preview.label}：把指针移到虚线上可创建为交线图元。`
}

/**
 * 画布上"自动铺开的交线 / 交点 / 交面有多少、哪些没画全"的状态提示。
 *
 * 用户反馈过："画布上有东西，但完全没有任何提示"。自动枚举意味着预览不再依赖选择，
 * 所以只要画布上真画了交点 / 交线 / 交面、或者本来该画却没画出来，就必须在状态栏说明。
 *
 * 两种"没画出来"要分开说，因为它们的原因和后果不同：
 * - `truncated`：这一对确实相交，但布尔交集配额用尽（或面数超过单对上限），所以这次交面没画全。
 * - `dropped`：实体对多到超过单次扫描上限，这一对连交线都没算。
 */
export function resolvePreviewInventoryPrompt(inventory: { lines: number; points: number; faces: number; truncated: number; dropped: number; truncatedPoints?: number }): string | null {
  const parts: string[] = []
  if (inventory.lines > 0) parts.push(`${inventory.lines} 处交线`)
  if (inventory.points > 0) parts.push(`${inventory.points} 处交点`)
  if (inventory.faces > 0) parts.push(`${inventory.faces} 个交面`)
  const notes: string[] = []
  if (inventory.truncated > 0) notes.push(`另有 ${inventory.truncated} 对来源的交面没画全（一次最多算 ${DEFAULT_MAX_BOOLEAN_PAIRS} 对、每对最多 ${DEFAULT_MAX_FACES_PER_PAIR} 个面，改动来源后会补上）`)
  if (inventory.dropped > 0) notes.push(`另有 ${inventory.dropped} 处相交对超出单次扫描上限（最多 ${MAX_PAIRS} 对），这次连交线都没画`)
  if (parts.length === 0 && notes.length === 0) return null
  const drawn = parts.length > 0 ? `已自动标出 ${parts.join("、")}：点虚线创建交线，点圆点创建交点，点面片创建交面。` : ""
  return [drawn, ...notes.map((note) => `${note}。`)].join("")
}

export function resolveStatusPrompt({ mode, selectedCount, selectedLabel, hasCenter, hasStart, pointCount, sceneControl = null, pointBinding = null, pathSelected = false, rotationAnchor = null, movingCircleSelected = false }: StatusPromptState): string {
  if (mode === "line") return hasCenter ? "第2步：点击确定直线的第二个点（按住 Shift 锁定水平/垂直）" : "第1步：点击确定直线的第一个点"
  if (mode === "segment") return hasCenter ? "第2步：点击确定线段的终点" : "第1步：点击确定线段的起点"
  if (mode === "ray") return hasCenter ? "第2步：点击确定射线的经过点" : "第1步：点击确定射线的起点"
  if (mode === "polyline") return `点击添加折线顶点（当前 ${pointCount} 个），双击结束`
  if (mode === "circle") return hasCenter ? "第2步：移动鼠标并点击确定通过点" : "第1步：点击确定圆心位置"
  if (mode === "arc") {
    if (!hasCenter) return "第1步：点击确定圆心位置"
    return hasStart ? "第3步：点击确定圆弧终点" : "第2步：点击确定圆弧起点"
  }
  if (sceneControl) return resolveSceneControlPrompt(sceneControl)
  /**
   * 动圆：它是**曲线**，所以 `pointBinding` / `pathSelected` 都不适用 —— 用户此刻要的是
   * "拖它绕定点转、改半径、或换一个定点"，说清这三件事。
   */
  if (movingCircleSelected) return `${selectedLabel ?? "这条曲线"} 是动圆 · 直接拖曲线就是绕定点转；「半径」在右侧改；删掉那个定点，它会一起消失`
  // 绕定点旋转优先于路径绑定提示：两样都选中时用户此刻要办的就是"把曲线定在这个定点上"。
  if (rotationAnchor?.ready) return "已选中一个点与一条封闭曲线 · 点功能区的「绕定点旋转」，曲线就定成绕这个定点转，转过任意角度都仍然过这个定点"
  if (pointBinding) {
    const name = selectedLabel ?? "这个点"
    if (pointBinding.bound) {
      return `${name} 是动点，绑在「${pointBinding.pathLabel ?? "路径"}」上 · 直接拖动它会严格沿这条路径滑动，也可以用「路径参数」精确摆位；点「记录轨迹」能画出它的运动轨迹`
    }
    if (pointBinding.hasPaths) {
      return `${name} 现在是自由点 · 在右侧「路径绑定」里选一条曲线或直线，它就成为动点，之后可以直接在画布上拖它`
    }
    return `${name} 现在是自由点 · 先画一条路径（直线 / 圆 / 函数等工具），再在右侧「路径绑定」里选它，${name} 就成为沿这条路径滑动的动点`
  }
  if (pathSelected) return `${selectedLabel ?? "这条曲线"} 可以当路径用 · 选中一个点后在它的「路径绑定」里选这条线，那个点就成为动点（可沿它拖动）`
  if (selectedCount > 0) return `已选中${selectedLabel ?? "图元"} · 拖动控制点调整形态，按 Delete 键删除`
  if (rotationAnchor?.available) return "想画「过定点的旋转曲线」？选中一个点，再点右侧的「创建动圆」，曲线就绕着它转"
  return "点击图元查看属性，或在画布中拖拽框选多个对象"
}
