# 立体几何最后一轮：约束轨道 / 拖动旋转 / 测量数字 / UI 对齐（实施计划）

> **状态（2026-09-17）**：用户已确认方向（推荐项 A/A/A/A），设计见 `docs/superpowers/specs/2026-09-17-3d-tracks-rotation-and-measurement-labels-design.md`。本文件是切片计划，逐步勾选只记录"这一片做完了"，**数字一律实测后回填**。
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

- [ ] 域操作 `rotatePrimitive3 { id, axis, degrees, pivot? }`：点驱动图元旋转其拥有的点（枢轴缺省 = 形心）；模板实体按组合矩阵反解 X→Y→Z 写 `rotation`；`patches.ts` 校验角度有限、轴合法。
- [ ] 单测（`operations.test.ts` / `intersectionSolid` 同族或新建 `rotation3d.test.ts`）：旋转圆 → 圆心不动、法向转过 90°、半径不变；旋转空间面 → 形心不动、边长不变、法向转过 90°；旋转实体 → `rotation` 字段与手算一致（从未旋转状态绕 X 90° ⇒ `x = π/2`）；一次操作一步撤销。
- [ ] 属性栏：`circle3` / `face3` 的「朝向」角度输入（写 `rotatePrimitive3`），并把当前取向（法向）显示成读数。

## Slice 4：画布旋转手柄（三色环 + 拖动 + 吸附）

- [ ] `threePrimitives.ts`：`createRotationHandles(center, size, activeAxis)` —— 三个环（X/Y/Z 轴色，`visualRole: "rotation-handle"`、`userData.rotationAxis`、`excludeFromFit`）。
- [ ] `threeScene.tsx`：选中**恰好一个**可转对象（模板实体 / `circle3` / `face3`）时画环；`pointerdown` 命中环进入旋转会话（轴、枢轴、起始角）；`pointermove` 累加角度并按 15° 量化（Alt 不量化），画面用临时旋转；`pointerup` 提交 `rotatePrimitive3`；读数 `data-rotation-handles` / `data-rotation-axis` / `data-rotation-degrees`。
- [ ] `threeDrag.ts`：旋转会话的纯函数（指针 → 绕轴角度、量化、临时旋转矩阵应用）单独成函数并单测；`threeScene.test.ts` 覆盖"命中环才开会话""量化到 15°""无位移不提交"。
- [ ] e2e：`e2e/three-rotation-handle.spec.ts` —— 选圆柱 → 断言三个环 → 拖 X 环到 ~90° → 断言 `rotation.x ≈ π/2`（属性栏读数与文档）且一次撤销回到 0。

## Slice 5：测量数字常驻（2D + 3D）

- [ ] 3D：`threeScene.tsx` 的 `measurementVisuals` 过滤条件改成"有效且值有限"；标签常驻、选中时高亮；辅助线与二面角标记保持按选中显示；读数 `data-measurement-labels`。
- [ ] 2D：新增 `apps/web/src/planarMeasurementVisuals.ts`（纯函数：长度 / 距离 / 角度 / 面积的位置与文本，退化不产出）+ `GraphicsView.tsx` 的 `<text>` 渲染（白描边、`pointer-events: none`）+ `data-measurement-labels`。
- [ ] 单测：`planarMeasurementVisuals.test.ts`（四类位置与退化）；`threeScene.test.ts`（不选中任何对象时仍有标签、退化测量无标签）。
- [ ] e2e：新用例断言**不选中任何对象**时两个画布都出现数字（2D：`e2e/planar-measurement-labels.spec.ts`；3D：并入既有 3D 测量用例或新建）。

## Slice 6：UI 令牌对齐（立体几何 ↔ 平面几何）

- [ ] `threeScene.tsx`：3D 外壳加 `data-canvas-surface="graph-paper"`（或 `graph-paper-3d`，二者取一并在 CSS 里统一）。
- [ ] `styles/global.css`：把 `graph-paper` 选择器扩到 3D 外壳（底色 / 内沿阴影 / 纸纹 `::before` / 水印），控件样式与平面几何对齐；纸纹强度与平面同级或略淡。
- [ ] `threeScene.tsx`：`GridHelper` / `AxesHelper` 颜色换成与 `--color-graph-grid-minor/major` 对齐的暖色常量，并注明"两端同源"。
- [ ] 验收：截图对照（平面 vs 立体）+ e2e 断言主题标记；既有 e2e 全部保持通过（布局未动）。

## Slice 7：文档收尾

- [ ] `docs/project-progress.md`：新增本轮条目（四件事的做法、每片 RED/变异证据、门禁数字、如实边界：Euler 反解可能改多个字段、正 n 边形不做）。
- [ ] `docs/feature-catalog.md`：新增「约束轨道」「拖动旋转」「测量数字常驻」「立体几何视觉令牌」条目；把"剖切平面 / 测量只在属性栏"等过时表述一并更正。
- [ ] `README.md`：立体几何一节补这四项，基线数字更新。
- [ ] 本 spec 与计划的状态行改为"已交付"。
