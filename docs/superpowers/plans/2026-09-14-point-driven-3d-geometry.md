# Point-Driven 3D Geometry Implementation Plan

> **For agentic workers:** Follow the repository testing and review workflow. Complete one slice at a time; do not mark a slice complete without its focused tests and recorded verification evidence.

**Goal:** 将 P6 从四种固定参数化实体升级为点、线、面、拓扑驱动的高中三维几何工作区，同时保留参数化实体快捷模板和 `schemaVersion: "0.1"` 兼容性。

**Architecture:** 扩展现有不可变 DSL 与 Scene Graph。geometry-kernel 只提供纯三维计算；Scene Graph 管理稳定 ID、依赖索引、派生重算和事务；React 管理工具与教学 UI；Three.js 管理渲染、材质、相机和 Raycaster。使用 Composite 表达拓扑，Factory/Strategy 注册模板，Observer 传播依赖，Command/Memento 沿用撤销/重做，Visitor 统一测量、导出和渲染准备。

**Tech Stack:** TypeScript、React、Vite、Vitest、Playwright、Three.js、现有 Geometry DSL 和 Scene Graph。

**Spec:** [`2026-09-14-point-driven-3d-geometry-design.md`](../specs/2026-09-14-point-driven-3d-geometry-design.md)

## 全局约束

- 保持 `schemaVersion: "0.1"`；旧 2D `.mgeo` 和旧 P6 四类实体必须继续可读。
- 点位置和稳定对象 ID 是三维构造真源；渲染网格、相机和临时动画状态不进入文档真源。
- 每个行为变化先写失败测试，确认失败原因正确后再写最小生产代码。
- 领域计算不放进 React 或 Three.js 组件；无效输入返回结构化诊断，不生成伪结果。
- 不修改 P4 Agent、P5 题图解析和 P7 工程制图范围。
- 每个切片完成后运行聚焦测试、全量测试、类型检查及适用的构建/E2E，执行 `git diff --check`，只读 review 后独立 commit；推送远端 `git push origin main` 在项目明确要求前暂缓，当前阶段只做本地提交。

## Slice 1：3D DSL 基础对象与兼容类型

**Files:** `packages/dsl/src/types.ts`、`packages/dsl/src/schema.ts`、相关 codec 测试和索引文件。

**Interfaces:** `Vector3`、`Point3`、`Line3`、`Segment3`、`Ray3`、`Plane3`、`Circle3`、`Edge3`、`Face3`、`Polyhedron3`、`SolidConstruction`。

**Status:** [x] 已实现并完成验证。

**Failing tests:** 新增 3D 对象合法解码、稳定 ID、点引用、三点定面和旧 2D/旧 P6 文件仍可解码的失败测试；覆盖重复点 ID、缺失引用、零方向、共线三点和未闭合面的错误。

**Implementation:** 扩展 discriminated union 和 schema 校验；保持旧类型分支；将旧固定实体映射为兼容拓扑视图，不改变现有 2D API。

**Verification:** `npm.cmd test -- packages/dsl/src/codec.test.ts`：23/23；全量 `npm.cmd test`：25 个测试文件、219 个用例；`npm.cmd run typecheck`：4 个 workspace；隔离目录 Vite build 通过；`git diff --check` 通过。完成后更新进度文档，commit `feat(p6): add point-driven 3d dsl` 并推送。

## Slice 2：纯三维几何与 builder 注册表

**Files:** `packages/geometry-kernel/src/geometry3d.ts`、新增 `solid-builders.ts` 及测试、package exports。

**Interfaces:** `Vector3` 运算、点线面关系、平面求交、法向量、`SolidBuilder`、`SolidBuildResult`、builder registry。

**Status:** [x] 已实现并完成验证。

**Failing tests:** 覆盖向量叉积/点积、三点定面、点到线/面距离、共面判断、棱柱/棱台/任意多面体拓扑闭合和退化输入。

**Implementation:** 保持不可变纯函数；用 Composite 组装顶点、棱、面；用 Factory/Strategy 注册 cube、pyramid、cylinder、cone，并增加通用 prism/frustum/fromPoints 入口。

**Verification:** geometry-kernel 聚焦测试 19/19；全量 `npm.cmd test`：26 个测试文件、235 个用例；`npm.cmd run typecheck`：4 个 workspace；隔离目录 Vite 生产构建通过；`git diff --check` 通过。完成后 commit `feat(p6): add extensible solid builders` 并推送。

## Slice 3：Scene Graph 依赖索引与拓扑重算
**Status:** [x] 已实现并完成验证。

**Files:** `packages/scene-graph/src/operations.ts`、`patches.ts`、`scene-store.test.ts`。

**Interfaces:** `createPoint3`、`createLine3`、`createFace3`、`createPolyhedron3`、`patchPoint3`、反向依赖索引、派生重算状态。

**Failing tests:** 先测试移动一个顶点只更新受影响对象；测试跨层依赖、循环引用、删除保护、事务回滚、无效拓扑诊断以及 undo/redo。

**Implementation:** 建立 source ID 到 dependents 的索引；按受影响分量拓扑排序重算；把模板输出作为子对象写入同一事务；失败时保留合法快照并返回诊断。

**Verification:** Scene Graph 聚焦测试 31/31；全量 `npm.cmd test`：26 个测试文件、240 个用例；`npm.cmd run typecheck`：4 个 workspace；`git diff --check` 通过。完成后 commit `feat(p6): propagate 3d point dependencies` 并推送。

## Slice 4：点线面构造工具与关键点交互

**Files:** `apps/web/src/App.tsx`、`GeometryToolbar.tsx`、`GraphicsView.tsx`、`PropertiesBar.tsx`、3D UI 测试。

**Interfaces:** point/line/segment/ray/plane/face tool state、三维坐标输入、点标签、选点构造命令、空间拾取事件。

**Failing tests:** 覆盖点创建、两点成线、三点成面、闭合面失败提示、A/B/C 标签、拖动点后拓扑更新和键盘坐标编辑。

**Implementation:** 复用平面图的工具、选择、锁定、删除和属性编辑模式；增加三维辅助平面/网格、坐标读数和明确的构造步骤反馈。

**Status:** [x] 已实现并完成 Slice 4 验证。

**Verification:** UI 聚焦测试 53/53；全量测试 26 个测试文件、245 个用例；四个 workspace 类型检查；隔离目录 Vite 生产构建；`git diff --check` 通过。浏览器验证受宿主环境浏览器绑定 `Cannot redefine property: process` 阻断，未标记为通过。完成后 commit `feat(p6): add point driven 3d construction tools` 并推送。

## Slice 5：固定实体迁移为统一拓扑模板

**Files:** `apps/web/src/threeScene.tsx`、3D 创建入口和 renderer adapter、DSL/Scene Graph 迁移测试。

**Interfaces:** template create/edit/split operations、`RenderObject3`、模板参数与生成点的关联。

**Failing tests:** 测试四类旧模板保存/恢复、拆解为点棱面、编辑生成点、旧文件迁移后 ID 稳定以及模板失败回滚。

**Implementation:** 让现有 cube/pyramid/cylinder/cone 通过 builder 生成统一拓扑；参数栏提供“编辑参数/编辑点”模式，兼容旧 UI 操作。

**Verification:** 迁移聚焦测试、全量测试、类型检查、生产构建和 Playwright 四模板回归。完成后 commit `refactor(p6): unify solids as topology templates` 并推送。

## Slice 6：拾取、约束与教学测量

**Files:** `packages/geometry-kernel/src/measurements3d.ts`、约束模块、`threeScene.tsx`、`AlgebraView.tsx`、`PropertiesBar.tsx` 及测试。

**Interfaces:** Raycaster hit result、point-on-line/plane、coplanar/parallel/perpendicular constraints、`Measurement3`、source explanation。

**Failing tests:** 覆盖点/棱/面拾取优先级、深度坐标、约束残差和冲突、长度/距离/角度/面积/体积、退化测量和来源解释。

**Implementation:** 将 Raycaster 结果转换为稳定 ID；加入约束诊断和测量 Visitor；Algebra View 展示顶点/棱/面子树，属性栏展示来源与精度。

**Status:** [x] 已实现并完成 Slice 6 验证。

**Verification:** 内核/Scene Graph/UI 聚焦测试：`measurements3d.test.ts` 6 个、`constraints3d.test.ts` 2 个、`patches.test.ts` 23 个、`scene-store.test.ts` 34 个、`AlgebraView.test.tsx` 5 个、`spatialTools.test.ts` 9 个、`store.test.ts` 1 个、`threeScene.test.ts` 13 个、`codec.test.ts` 25 个通过；全量 `npm.cmd test`：32 个测试文件、286 个用例通过；`npm.cmd run typecheck`：4 个 workspace 通过；Web 生产构建通过；Playwright 8 个用例通过（含空间点拾取并创建教学测量、顶点/棱/面子树展开）；`git diff --check` 通过。完成后 commit `feat(p6): add 3d constraints and measurements`（本轮按项目要求只提交到本地，未推送远端）。

## Slice 7：通用剖切与截面派生对象

**Files:** `packages/geometry-kernel/src/sections3d.ts`、DSL 派生类型、Scene Graph operations、3D renderer 和测试。

**Interfaces:** `Section3`、实体/平面来源引用、截面点序、无交/点交/线交/多边形交分类。

**Failing tests:** 覆盖任意多面体截面、平面穿棱、穿顶点、相切退化、无交、来源点移动自动更新和保存恢复。

**Implementation:** 按面边界求平面交，去重并排序截面点，建立截面边界和高亮渲染；诊断状态不生成虚假点。

**Status:** [x] 已实现并完成 Slice 7 验证。

**Verification:** 内核 `sections3d.test.ts` 8 个、Scene Graph 38 个、补丁校验 24 个、渲染 15 个、codec 26 个用例通过；全量 `npm.cmd test`：33 个测试文件、302 个用例通过；`npm.cmd run typecheck`：4 个 workspace 通过；Web 生产构建通过；Playwright 9 个用例通过（含剖切点驱动拓扑得到可见截面）；`git diff --check` 通过。完成后 commit `feat(p6): generalize solid sections`（本轮只提交本地）。

## Slice 8：展开布局与动画

**Files:** `packages/geometry-kernel/src/unfold3d.ts`、DSL 派生类型、`threeScene.tsx`、工作区控件和测试。

**Interfaces:** `UnfoldLayout`、根面、共享棱邻接、重叠诊断、折叠进度和动画会话。

**Failing tests:** 覆盖三棱柱/棱锥/多面体展开、面邻接、布局方向、重叠检测、进度 0/1、取消动画和不污染 undo history。

**Implementation:** 从根面传播局部坐标，以共享棱旋转相邻面；将临时折叠姿态与持久化布局分离，支持 reduced motion。

**Status:** [x] 已实现并完成 Slice 8 验证。

**Verification:** 内核 `unfold3d.test.ts` 8 个、Scene Graph 40 个、渲染 `threeScene.test.ts` 17 个用例通过；全量 `npm.cmd test`：34 个测试文件、316 个用例通过；`npm.cmd run typecheck`：4 个 workspace 通过；Web 生产构建通过；Playwright 10 个用例通过（含展开/折回点驱动拓扑）；`git diff --check` 通过。完成后 commit `feat(p6): add topology based unfolding`（本轮只提交本地）。

## Slice 9：二面角与空间关系教学标记

**Files:** `packages/geometry-kernel/src/geometry3d.ts`、测量/标记模块、3D renderer 和测试。

**Interfaces:** 有向二面角、内/外角选择、公共棱、法向量箭头、垂足/投影标记。

**Failing tests:** 覆盖内角/外角、法向量方向翻转、退化相邻面、来源点移动和近似精度说明。

**Implementation:** 统一法向量方向与公共棱方向，输出可解释角度来源；画布渲染角弧、法向量和辅助线，Algebra View 保留测量对象。

**Status:** [x] 已实现并完成 Slice 9 验证。

**Verification:** 内核 `markers3d.test.ts` 9 个、`measurements3d.test.ts` 7 个、渲染 `threeScene.test.ts` 18 个用例通过；全量 `npm.cmd test`：35 个测试文件、327 个用例通过；`npm.cmd run typecheck`：4 个 workspace 通过；Web 生产构建通过；Playwright 11 个用例通过（含二面角内角/外角与画布标记）；`git diff --check` 通过。完成后 commit `feat(p6): explain 3d dihedral angles`（本轮只提交本地）。

## Slice 10：工作区整合、兼容、文档与验收

**Files:** `apps/web/src/App.tsx`、`threeScene.tsx`、`AlgebraView.tsx`、`PropertiesBar.tsx`、codec、README、`docs/project-progress.md`、`docs/feature-catalog.md`。

**Interfaces:** `geometry3d` workspace、子部件树、属性面板、`.mgeo` import/export、错误状态和教学步骤。

**Failing tests:** 覆盖工作区切换、状态往返、旧 2D/旧 P6 文件、保存恢复、撤销重做、导出、WebGL 降级、无效构造提示和端到端主流程。

**Implementation:** 统一 UI 入口、对象树、属性字段、诊断提示和导出；补全文档与验证证据，不扩大到 Agent/CAD/题图解析。

**Verification:** 聚焦测试 `codec.test.ts` 27 个（含点驱动 3D 文档完整往返）、`App.test.tsx` 54 个（含 3D 工作区往返、WebGL 降级、导出门控、非法构造提示、单步撤销重做）、`exporters.test.ts` 7 个；全量 `npm.cmd test`：35 个测试文件、334 个用例通过；`npm.cmd run typecheck`：4 个 workspace 通过；生产构建通过；全量 Playwright 11 个用例通过；`git diff --check` 通过。完成后 commit `docs(p6): document point driven 3d rollout`（本轮只提交本地）。

## 完成定义

每个切片都必须留下测试或验证证据、独立 Git commit 和 `origin/main` 推送记录。最终验收必须证明：任意点驱动多面体可创建和编辑，现有四种模板仍可用，派生对象按来源重算，3D 对象可保存恢复并进入 Algebra View，错误和近似状态可解释。
