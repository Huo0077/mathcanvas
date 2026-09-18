# 立体几何最后一轮：约束轨道 / 拖动旋转 / 测量数字 / UI 对齐（实施计划）

> **状态（2026-09-17）**：**全部 7 片已交付**（约束轨道内核 + 圆轨道图元 + `rotatePrimitive3` + 画布旋转环 + 测量数字常驻 + UI 令牌对齐 + 文档收尾）。用户已确认方向（推荐项 A/A/A/A），设计见 `docs/superpowers/specs/2026-09-17-3d-tracks-rotation-and-measurement-labels-design.md`。本文件是切片计划，逐步勾选只记录"这一片做完了"，**数字一律实测后回填**（下面的数字都是跑完门禁后回填的实测值：**121 文件 / 1421 用例**、lint **0 error / 14 warning**、Playwright **102/102**）。
> **纪律**：每片先写失败用例（RED，贴真实失败输出）再实现（GREEN）；不新增运行时依赖；模型层不许 import three.js；每片完成更新 `docs/project-progress.md` + `docs/feature-catalog.md`（必要时 README 基线），跑全套门禁，提交并推送，`git rev-parse HEAD` 与 `git ls-remote` 两端核对。仓库文件一律用编辑工具改（不要走 PowerShell 文本管道）。

## 门禁（每片都跑）

```
npm.cmd run typecheck
npm.cmd test
npm.cmd run lint              # 0 error，warning 与基线（14）一致
npm.cmd run build --workspace @draw/web
npx playwright test
```

---

## Slice 1：圆轨道宿主（内核）

- [ ] `packages/geometry-kernel/src/hosts3.ts`：`Host3Kind` 加 `"circle"`；新增 `circleHost3(center, normal, radius): Host3 | null`（域 `u ∈ [0, 2π]` + `closedU: true`；帧 `u = normalize(cross(axis, seed))`、`v = cross(axis, u)`；`evaluate` 与 `closestParameter` 互逆；`radius ≤ 0` / 零法向 / 非有限 → `null`）。
- [ ] `host3FromPrimitive` 的 `circle3` 分支（解析 `centerId`，缺失 → `null`）。
- [ ] RED→GREEN：`packages/geometry-kernel/src/hosts3.test.ts` 新增用例——参数闭合（`evaluate(0) === evaluate(2π)`）、`evaluate(closestParameter(p))` 落在圆上且残差 = 点到圆的真实距离、拖过一整圈后参数仍折回 `[0, 2π)`、退化输入返回 `null`、以及 `host3FromPrimitive` 对 `circle3` 的接线（中心点存在 / 缺失两种）。
- [ ] 变异检查：把 `closedU` / 归一化拿掉 ⇒ 闭合用例失败；把半径守卫拿掉 ⇒ 退化用例失败。

## Slice 2：圆轨道图元（DSL / 场景图 / web）

- [ ] `packages/scene-graph/src/operations.ts`：`managedPointIds` 加 `circle3 → [centerId]`；`isFreeDraggable3` 允许 `"circle3"`；`packages/scene-graph/src/patches.ts` 允许并校验 `radius3`（正、有限）与 `normal`（非零、有限）。
- [ ] `apps/web/src/ribbonCommands.ts` + `App.tsx`：新命令「添加空间圆轨道」——选 1 个空间点 = 圆心（法向 +Z、半径 1.5）；2 个点 = 圆心 + 圆周点（半径 = 距离）；3 个点 = 三点定平面（法向 = 三点法向、圆心 = 第一个点）；给 `canCreateCircle3Track` 门控与提示文案。
- [ ] `apps/web/src/pointHostOptions.ts`：`circle3` 出「（圆轨道）」条目（`host:<id>`）；`hostLabel` 加 `circle3 → 圆轨道`。
- [ ] `apps/web/src/components/PropertiesBar.tsx`：选中 `circle3` 的属性块（半径 / 圆心 / 法向读数 / 可编辑半径）。
- [ ] 测试：`pointHostOptions.test.ts`（条目与取值）、`App.test.tsx`（命令创建三种选点情况 + 撤销一步）、scene-graph 单测（平移圆 = 移动圆心点）；e2e 新用例 `e2e/three-orbit-tracks.spec.ts`：建圆轨道 → 建一个空间点 → 绑到轨道 → 拖它 → 断言点在圆上（`data-host-residual` ≈ 0）且参数在域内。

## Slice 3：`rotatePrimitive3`（场景图 + 属性栏）

- [x] 域操作 `rotatePrimitive3 { id, axis, degrees, pivot? }`：点驱动图元旋转其拥有的点（枢轴缺省 = 形心）；模板实体按组合矩阵反解 X→Y→Z 写 `rotation`；`patches.ts` 校验角度有限、轴合法。**实现要点（与计划的差异，均已落地）**：旋转统一走内核 `rotation3d.ts`（`eulerRotationMatrix3` / `composeEuler3` / `eulerFromRotationMatrix3`），模板实体写的是 `composeEuler3(旧朝向, axis, θ)` 而不是"反解后直接覆盖某个字段"；点驱动对象**额外**把文档里存的朝向向量（`circle3.normal`、`pointNormal`、`pointDirection`）一起转过去（只转点不转法向 = 画面不跟手）；带 `pivot` 时模板实体连锚点一起挪（`templateSolidPivot` 从内核导出，属主中心单一来源）；孤立 `point3` 无朝向可转、如实拒绝。
- [x] 单测（`operations.test.ts` + `patches.test.ts` + `App.test.tsx` + `hosts3.test.ts`）：旋转圆 → 圆心不动、法向转过 90°、半径不变；旋转空间面 → 形心不动、边长不变、法向转过 90°；旋转实体 → `rotation` 字段与手算一致（从未旋转状态绕 X 90° ⇒ `x = π/2`）、与 `composeEuler3` 矩阵等价、给枢轴时中心真的绕过去、物化顶点跟过来；一次操作一步撤销。**RED 证据**：10 条断言先红（`expected 1 to be close to +0`、`(0 , templateSolidPivot) is not a function`、`expected { valid: true } to deeply equal { valid: false, … }`…）。
- [x] 属性栏：`circle3` / `face3` 的「朝向」角度输入（写 `rotatePrimitive3`），并把当前取向（法向）显示成读数（`data-object-orientation`；用法向与内核判定共用 `polygonNormal3`）。**与计划的差异**：这两类对象没存欧拉角，"绝对角度输入"会永远读回 0，所以做成"选轴 + 填角度 + 应用"的相对旋转（每次一步撤销），并在注释与页脚说明里写清为什么。

## Slice 4：画布旋转手柄（三色环 + 拖动 + 吸附）

- [x] `threePrimitives.ts`：`createRotationHandles(center, size, activeAxis)` —— 三个环（X/Y/Z 轴色，`visualRole: "rotation-handle"`、`userData.rotationAxis`、`excludeFromFit`）。**实现要点**：环不挂 `primitiveId`（按 id 遍历的逻辑必须跳过它）、`depthTest: false` + 高 `renderOrder`（被实体挡住的半圈也要看得见抓得到）、环平面与轴垂直；另加 `ROTATION_AXIS_COLORS` / `ROTATION_HANDLE_ROLE` 两个常量；手柄几何（环心 + 半径）由 `threeDrag.ts` 的 `rotationHandleGeometry` 算（模板实体取 `templateSolidPivot`、点驱动对象取拥有点的形心，与域操作的枢轴规则同源）。
- [x] `threeScene.tsx`：选中**恰好一个**可转对象（模板实体 / `circle3` / `face3`）时画环；`pointerdown` 命中环进入旋转会话（轴、枢轴、起始角）；`pointermove` 累加角度并按 15° 量化（Alt 不量化），画面用临时旋转；`pointerup` 提交 `rotatePrimitive3`；读数 `data-rotation-handles` / `data-rotation-axis` / `data-rotation-degrees`。**实现要点**：环的优先级最高且**不需要先开「自由拖动」**；抬手先撤销临时旋转再提交（否则提交后重建的场景会再转一次）；没真正转过不提交；平移拖动时环的位置跟着图形走（朝向不变——它是世界轴的参照）。另加读数 `data-rotation-handle-pivot` / `data-rotation-handle-radius` / `data-rotation-frames`。
- [x] `threeDrag.ts`：旋转会话的纯函数（指针 → 绕轴角度、量化、临时旋转矩阵应用）单独成函数并单测；`threeScene.test.ts` 覆盖"命中环才开会话""量化到 15°""无位移不提交"。**落在哪里**：纯函数与它们的用例集中在新的 `apps/web/src/threeRotation.test.ts`（13 条，覆盖手柄几何 / 环命中 / 角度基与右手法则 / 最短弧 / 15° 吸附与 Alt / 无位移不提交 / 临时旋转的撤销与"组+子对象只转一次"），组件那一层只做接线。
- [x] e2e：`e2e/three-rotation-handle.spec.ts` —— 选圆柱 → 断言三个环 → 拖 X 环到 ~90° → 断言 `rotation.x ≈ π/2`（属性栏读数与文档）且一次撤销回到 0。**实际四条**：拖 X 环到 90°（读数 90.00 / 属性栏 90 / 一次撤销回 0）、Alt 不吸附（−25° 而不是 −30°）、环外按下不旋转、多选时不给环。**两处测试自身的错**已修正并记在 spec §8：抓取点原本落在两个环的**交点**上（命中谁取决于深度排序，实测不稳定）；滚轮缩放的断言没有等待异步生效。

## Slice 5：测量数字常驻（2D + 3D）

- [x] 3D：`threeScene.tsx` 的 `measurementVisuals` 过滤条件改成"有效且值有限"；标签常驻、选中时高亮；辅助线与二面角标记保持按选中显示；读数 `data-measurement-labels`。**落点**：过滤抽成 `measurementVisuals.ts` 的 `measurementVisualsForDocument(document)`（**没有选择参数**，所以"常驻"不靠调用方自觉），退化/无值仍在 `resolveMeasurementVisual` 拦；标签加 `dataset.selected` + CSS `[data-selected="true"]`；旧读数 `data-measurement-label-count` 保留。
- [x] 2D：新增 `apps/web/src/planarMeasurementVisuals.ts`（纯函数：长度 / 距离 / 角度 / 面积的位置与文本，退化不产出）+ `GraphicsView.tsx` 的 `<text>` 渲染（白描边、`pointer-events: none`）+ `data-measurement-labels`。**与计划的差异**：角度标签的位置取"顶点沿角平分线外偏 `max(0.2, 0.25·min(边长))`"，平角（角平分线退化为零向量）时改取该边的法向——两种情形都如实算，不产出 `NaN` 坐标。
- [x] 单测：`planarMeasurementVisuals.test.ts`（四类位置与退化）；`threeScene.test.ts`（不选中任何对象时仍有标签、退化测量无标签）。**落点**：3D 那条放进了 `measurementVisuals.test.ts`（`threeScene.test.ts` 不挂载组件，纯函数才是这里能断言的东西）。
- [x] e2e：新用例断言**不选中任何对象**时两个画布都出现数字（2D：`e2e/planar-measurement-labels.spec.ts`；3D：并入既有 3D 测量用例或新建）。**落点**：两条合成一个文件 `e2e/measurement-labels.spec.ts`——都走"建测量 → 读数字 → **点空白清空选择** → 数字仍在 → 改几何数字跟着变"，2D 那条还断言标签落在两点中点对应的屏幕区间。

## Slice 6：UI 令牌对齐（立体几何 ↔ 平面几何）

- [x] `threeScene.tsx`：3D 外壳加 `data-canvas-surface="graph-paper"`（或 `graph-paper-3d`，二者取一并在 CSS 里统一）。**落点**：用与平面**同名**的 `graph-paper`（规则直接复用，不新增一套）；另外把 `scene.background` 改成 `null`，让画布透出 CSS 的纸色——原来 three.js 里的 `#fbfcff` 与 CSS 令牌是两个真源。
- [x] `styles/global.css`：把 `graph-paper` 选择器扩到 3D 外壳（底色 / 内沿阴影 / 纸纹 `::before` / 水印），控件样式与平面几何对齐；纸纹强度与平面同级或略淡。**落点**：底色与工作台渐变搬同一组值，`.three-render-target` 承担平面 `.canvas-card` 的角色（纸色 + 内沿暖色投影），纸纹与平面同级（同一个 `--paper-grain-opacity`），水印 `∴`；控件只改边框与底色，位置与分组不动。
- [x] `threeScene.tsx`：`GridHelper` / `AxesHelper` 颜色换成与 `--color-graph-grid-minor/major` 对齐的暖色常量，并注明"两端同源"。**一处按理由偏离**：只换**栅格**（`#e8dfc2` / `#d5c79f`，与令牌逐字相同），**坐标轴保留 X 红 / Y 绿 / Z 蓝**——那是语义，与切片 4 的旋转环一一对应，暖化成灰会让"轴的颜色"与"环的颜色"对不上（平面几何的轴本来也没有三色语义）。"两端同源"由 `threeGrid.test.ts` + 浏览器读数 `data-grid-colors`（e2e 与 `getComputedStyle` 逐字比对）守卫。
- [x] 验收：截图对照（平面 vs 立体）+ e2e 断言主题标记；既有 e2e 全部保持通过（布局未动）。**落点**：`e2e/three-ui-tokens.spec.ts`（主题标记 + 栅格色与令牌逐字相同 + 纸色确实是暖色）；截图对照人工看过两张（`build-check/paper-planar.png` / `paper-spatial.png`）。顺带修掉一条既有 e2e 抖动（自动取景动画与投影抢时间，已抓出真因并固定相机）。

## Slice 7：文档收尾

- [x] `docs/project-progress.md`：新增本轮条目（四件事的做法、每片 RED/变异证据、门禁数字、如实边界：Euler 反解可能改多个字段、正 n 边形不做）。**落点**：「立体几何最后一轮」一节按切片 1–6 逐条记录，含两处自己写错的测试、2D 模块 RED 落空后改用变异实验补证、平面角弧度 / 立体角度数的不一致、以及本轮实测到的既有布局缺陷（窄画布下 `自动取景` 被 `自由拖动` 盖住）。
- [x] `docs/feature-catalog.md`：新增「约束轨道」「拖动旋转」「测量数字常驻」「立体几何视觉令牌」条目；把"剖切平面 / 测量只在属性栏"等过时表述一并更正。**落点**：四条新条目分别落在「自由拖动」附近（轨道 / 旋转 / 测量 / 令牌），测量那条明确写了"不用选中任何对象"与"退化不画假数字"。
- [x] `README.md`：立体几何一节补这四项，基线数字更新。**落点**：三维几何工作区新增 4 条（轨道 / 旋转 / 测量常驻 / UI 令牌），顶部「当前状态」段落收束到"最后一轮四件事全部交付"，验证基线更新为 **121 文件 / 1421 用例**、Playwright **102/102**，文档索引 16 份计划 / 13 份设计。
- [x] 本 spec 与计划的状态行改为"已交付"。
