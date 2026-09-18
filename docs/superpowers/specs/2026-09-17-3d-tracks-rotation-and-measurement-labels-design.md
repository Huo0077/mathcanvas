# 立体几何最后一轮：约束轨道、拖动旋转、测量数字与 UI 对齐（设计）

> **状态**：用户已确认方向（2026-09-17，四个问题分别选定推荐项 A/A/A/A）。**一处按建议调整并已获"继续"确认**：旋转手柄用**世界轴三色环**（X 红 / Y 绿 / Z 蓝，与坐标轴同色），而不是"屏幕法向 / 水平 / 竖直"——理由见 §3.2。
> **用户原话**：「对于立体，我们再做最后一步优化，我想要增加一些可以旋转，平移的平面图元，只需要圆和多边形就可以，这个主要作用是作为约束轨道」；「我希望能给立体图形增加旋转功能，就像我想要一个横着的圆柱，可以在图中拖着圆柱旋转，也可以在右侧属性栏设置为 90 度」；「我希望数学测量的结果能在图中浮现一个数字，而不是非要去看右侧属性栏（这一点无论是平面几何还是立体几何都要优化）」；「优化立体几何的 ui 设计，主要参考平面几何的 ui 设计」。
> **不在本轮**：正 n 边形生成器、实体朝向改用四元数存储、测量标签可点击选中、把实体真正切开做布尔。

---

## 1. 背景（都是实测出来的现状）

| 事实 | 证据 |
| --- | --- |
| 空间多边形 `face3` **已经**能当动点宿主 | `host3FromPrimitive` 的 `face3` 分支 → `faceHost3`；绑定下拉 `pointHostOptions` 已列 `face:` 条目 |
| 空间圆 `circle3` 存在、**能渲染成真曲线**（A1 起），但**没有创建入口**、**不能当宿主** | `circle3` 只出现在渲染 / 投影 / 导出；`host3FromPrimitive` 对它返回 `null`；Ribbon 立体几何没有创建命令 |
| 圆的平移也走不通 | `managedPointIds` 与 `isFreeDraggable3` 的类型清单里都没有 `circle3` |
| 实体旋转**属性栏已经能做** | 属性栏「朝向」三轴角度 + 归零 + 各轴 ±90°（`rotation3` 补丁 → `primitive.rotation`）；`buildSolidTemplate` 用 `rotateAboutPivot` 把旋转落进生成的顶点 |
| 实体旋转**画布拖动没有** | 3D 只有「自由拖动」（平移）与相机轨道；`threeDrag` 里没有任何旋转会话 |
| 3D 测量数字**只在选中来源时**才出现 | `threeScene.tsx` 的 `measurementVisuals` 过滤条件是 `sourceIds.some(id => selectedIds.includes(id))` |
| 2D 平面画布**完全不画测量数值** | `GraphicsView.tsx` 里没有任何 measurement 渲染；平面测量（长度/角度/面积/距离）只在右侧属性栏 |
| 3D 画布是冷色工作台 | `.three-canvas-shell { background: #fbfcff }`；平面几何才有 `data-canvas-surface="graph-paper"` 那套（纸底色 / 纸纹 / 暖色网格） |

## 2. 目标与验收

1. **约束轨道**：能用「由选中点创建」的方式造出**空间圆**与**空间多边形**；两者都能在画布上平移、也能旋转（画布手柄 + 属性栏数值）；把它们当宿主绑定动点后，拖点沿轨道滑动（参数是唯一真源，残差 ≈ 0）。
2. **拖动旋转**：选中一个可转对象后画布出现**世界轴三色环**，拖环即转、15° 吸附（Alt 不吸附）、一次拖动一步撤销；属性栏「朝向」三个字段与 ±90° 按钮读数同步变化。
3. **测量数字常驻**：2D 与 3D 画布都**不需要选中**就能看到有效测量的数值；选中测量时标签高亮；退化 / 数据不足的测量**不画假数字**。
4. **UI 对齐**：立体几何用与平面几何同一套视觉令牌（草稿纸底色、纸纹、暖色网格与坐标轴、同一套字号/圆角/卡片与按钮样式），**布局与按钮分组不变**。

## 3. 架构

### 3.1 内核：圆轨道宿主（`packages/geometry-kernel/src/hosts3.ts`）

```ts
export type Host3Kind = ... | "circle"                      // 新增
export function circleHost3(center: Vector3, normal: Vector3, radius: number): Host3 | null
```
- 域 `u ∈ [0, 2π]` 且 **`closedU: true`**（首尾相接的闭合轨道；`normalizeAzimuth` 就是给这种宿主准备的，参数不会无限增长）。
- 帧：`u = normalize(cross(axis, seed))`（`seed` 取与法向最不对齐的世界轴，和 `plane3` 分支同一招）、`v = cross(axis, u)`——与 `circleConic3` 的帧同源思路，保证"点沿圆滑动的参数"和"圆的解析表示"一致。
- `evaluate(u) = center + R·(u cos u + v sin u)`；`closestParameter(p)` = 把 `p − center` 投到 `u/v` 上取 `atan2` 再归一。
- 退化：`normal` 长度为 0、`radius` 非有限或 ≤ 0 → 返回 `null`（**不编一个轨道**）。
- 接线：`host3FromPrimitive` 的 `circle3` 分支解析 `centerId` → `circleHost3`；中心点缺失 → `null`。

### 3.2 拖动旋转（web，`threePrimitives` + `threeScene` + `threeDrag`）

- **手柄**：选中**恰好一个**可转对象时，在它的中心画三个圆环（世界 X/Y/Z，半径按对象尺寸自适应，线宽 1px，用与坐标轴相同的轴色）。环是拾取目标（`visualRole: "rotation-handle"` + `userData.rotationAxis`），**不参与自动取景**（`excludeFromFit`，与预览同一套理由）。
- **会话**：`pointerdown` 命中环 → `dragSessionRef` 进入 `rotate` 形态（枢轴 = 对象中心、轴 = 环的轴）。`pointermove` 里把"指针绕枢轴在当前轴屏幕投影上转过的角度"累加，**按 15° 量化**（按住 Alt 不量化），画面上用与平移拖动同一套临时偏移机制（不改文档）；`pointerup` 一次提交。
- **提交**：模板实体 → 组合旋转矩阵 `R = R_axis(θ)·R_euler` 再按 **X→Y→Z** 反解回三个角度字段（`rotation3` 补丁）；点驱动平面图元（`circle3` / `face3`）→ 新的场景图操作 `rotatePrimitive3`（见 §3.3）。
- **为什么用世界轴而不是屏幕轴**（这一处与最初选项不同，已说明）：拖红环就是"绕 X 转"，属性栏三个角度字段一一对得上；屏幕轴会让"拖一下"同时改两个字段，读数看起来像乱动。**如实边界**：当对象已有其他轴角度时，绕世界轴旋转后反解出的三个角度一般不再"只有被拖的那个变"——这是 Euler 存储的固有性质，spec 记在这里；要彻底解决需要把朝向改成四元数存储（不在本轮）。首次从未旋转状态拖红环到 90° 的常见路径（"我要一个横着的圆柱"）读数是精确的 `X = 90`。
- 读数：`data-rotation-handles`（环数）、`data-rotation-axis`（当前轴）、`data-rotation-degrees`（当前量化角），供 e2e 断言。

### 3.3 DSL / 场景图

- `managedPointIds` 加 `circle3` → `[centerId]`；`isFreeDraggable3` 允许类型加 `"circle3"`。于是圆的平移走既有 `translatePrimitive3`（它本来就"移动引用点"，`circle3` 的圆心是引用、不存副本）。
- 新增域操作 `rotatePrimitive3 { id, axis: "x"|"y"|"z", degrees, pivot? }`：
  - 点驱动图元（`circle3` / `face3` / `line3` / `segment3` / `ray3` / `edge3` / `plane3` / 点驱动 `polyhedron3`）：把**它拥有的点**绕枢轴（默认取这些点的形心）旋转；
  - 模板实体：按 §3.2 的矩阵组合写 `primitive.rotation`；
  - 枢轴缺省 = 图元自身中心（实体是 `center` / 棱锥 `baseCenter` 等）。
  - 旋转不改长度、不改参数域，因此**半径、夹角、面积读数不变**；重算后下游（截面 / 交线 / 交面 / 绑定）照常跟随。
- `patches.ts`：`circle3` 的 `radius` / `normal` 纳入可编辑字段校验（有限、正半径、非零法向）。
- 属性栏：选中 `circle3` 给「半径 / 圆心 / 法向 / 朝向角度输入」；选中 `face3` 给「顶点数 / 法向 / 朝向角度输入」；实体继续用现有「朝向」块。

### 3.4 测量数字常驻（web）

- **3D**：`measurementVisuals` 的过滤条件从"来源被选中"改成"`status === "valid"`（且 `value` 是有限数）"——数字常驻；**辅助线段**与二面角标记仍按"来源被选中"显示（避免画布被几十条辅助线刷满）。选中测量时标签加高亮类。
- **2D**：新增纯函数 `planarMeasurementVisuals(document)`（`apps/web/src/planarMeasurementVisuals.ts`）：
  - 读数取 `measurement.value`（内核已算好），单位照旧；
  - 位置按类型：长度 = 两点中点；距离 = 垂足与第三点的中点；角度 = 顶点外偏一点（角平分线方向）；面积 = 三个来源点的形心；来源点缺失 / 退化 → 不产出；
  - `GraphicsView` 用 `<text>` 渲染（白描边 halo，叠在图形上也读得清），`data-measurement-labels` 给出条数。
- 两个画布都不给标签指针事件（`pointer-events: none`），拾取行为一字不变。

### 3.5 UI 令牌对齐（CSS + three.js 颜色）

- 3D 外壳加 `data-canvas-surface="graph-paper"`，并把现有 `graph-paper` 选择器从 `.graphics[...]` 扩到 `.three-canvas-shell[...]`（纸底色、内沿阴影、纸纹 `::before`、右上角水印都复用；纸纹强度与平面几何同级或略淡）。
- three.js 的 `GridHelper` / `AxesHelper` 颜色换成与 CSS 令牌对齐的**暖色**常量（`--color-graph-grid-minor/major` 的对应值），代码里注明"两端同源，改一处要改两处"。
- 「显示控制 / 视角控制」两排按钮沿用平面几何那套控件样式（字号 / 圆角 / 边框 / 悬停），**位置与分组不动**（e2e 依赖现在的布局）。
- 验收：截图对照 + e2e 断言 3D 外壳带上了主题标记。

## 4. 退化与诚实

| 情形 | 结论 |
| --- | --- |
| 圆的法向为零 / 半径为 0 或非有限 | 不生成宿主（`null`）、不生成圆图元；属性栏报"数据不足" |
| 圆轨道的圆心点被删 | 圆图元随引用失效而不可用（既有引用保护会拦住删除，除非用户先解绑） |
| 旋转环上没有可用轴 / 拖动量为 0 | 不提交（不进撤销历史） |
| 已有其他轴角度时绕世界轴旋转 | 反解可能改动多个字段：**如实写在读数与 spec 里**，不假装只改一个 |
| 测量退化（点重合、三点共线求面积等） | 标签**不画**，状态栏仍说明原因（既有诊断） |
| 2D 测量来源点缺失 | 不产出标签（不猜位置） |
| three.js 颜色与 CSS 令牌漂移 | 两侧都写常量并互相注明；截图对比作为守卫 |

**交付后补记的三条**（实现与设计不同或设计没说清的地方，如实记在这里）：

| 事项 | 结论 |
| --- | --- |
| 模板实体绕世界轴旋转的**反解** | 实现不"反解某个字段"，而是 `composeEuler3(旧朝向, axis, θ)`（`R_axis · R_euler`）后统一分解回 X→Y→Z。已有其它角时**可能改动多个字段**——Euler 表示的固有性质，不假装只改一个（`rotation3d.ts` 的注释与单测都写着）。 |
| 平面角的**数值单位** | 平面测量的 `value` 存的是**弧度**（单位 `rad`，内核 `evaluatePlanarMeasurement` 的约定），3D 的角存的是**度**（单位 `°`）。两个画布都做到"画布上的数与属性栏一致"，但 2D / 3D 之间没统一；改成度要动内核读数契约，**不在本轮范围**，留作后续。 |
| 抓取旋转环的**位置** | 三个环两两相交于 ±X / ±Y / ±Z 六个点，从交点按下时"抓住的是哪个环"取决于深度排序（实测同一段脚本一会儿给 x、一会儿给 z）。所以环上的**判定点**要避开交点；e2e 取 45° 处（只有该环经过）。这条不影响用户操作（用户看得见自己抓的是哪个环），只影响测试的确定性。 |

## 5. 切片与测试策略（每片 RED→GREEN→门禁→文档→提交→推送）

1. **轨道内核**：`circleHost3` + `Host3Kind` + `host3FromPrimitive` 接线；`hosts3.test.ts`（参数闭合、`evaluate∘closestParameter` 落在圆上、残差、退化返回 null）。
2. **圆轨道图元**：`managedPointIds` / `isFreeDraggable3` / `patches` 半径与法向校验 / Ribbon「添加空间圆轨道」(1 点 / 2 点 / 3 点) / `pointHostOptions` 加"圆轨道"条目；scene-graph 单测 + e2e（建轨道 → 绑点 → 拖点沿圆滑动、`data-host-residual ≈ 0`）。
3. **`rotatePrimitive3`**：场景图操作 + 校验 + 单测（旋转圆：中心不动、法向变、半径不变；旋转多边形：形心不动、边长不变）+ 属性栏角度入口。
4. **旋转手柄**：三色环渲染 + 旋转会话 + 15° 吸附 + 提交 + 读数 + e2e（拖 X 环 90° 后 `primitive.rotation.x ≈ 90°`）。
5. **测量数字**：3D 常驻（改过滤条件 + 高亮）+ 2D `planarMeasurementVisuals` + `<text>` 渲染 + 单测 + e2e（两个画布各断言一个数字可见且不选中任何对象）。
6. **UI 令牌**：`data-canvas-surface` + CSS 选择器扩展 + three.js 暖色 + 截图对照 + e2e 断言。
7. **文档收尾**：`project-progress.md`、`feature-catalog.md`、README 基线、本 spec 的状态行。

**门禁（每片）**：`npm.cmd run typecheck`、`npm.cmd test`、`npm.cmd run lint`（0 error）、`npm.cmd run build --workspace @draw/web`、`npx playwright test`；数字一律实测后写进文档。
