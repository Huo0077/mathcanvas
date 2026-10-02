# 变更记录

> **这份文件记"改了什么"，不记"现在什么样"，也不记"当时怎么想的"。**
> - **当前状态**（门禁读数、做到哪一步、还差什么）看 [`docs/current-status.md`](docs/current-status.md) —— 那是"现在时"的**唯一**一处；
> - **过程与证据**（每一轮的 RED→GREEN、被推翻的判断、实测读数、误报清单）看 [`docs/project-progress.md`](docs/project-progress.md) —— 那是**归档**；
> - **架构与能力清单**看 [`docs/feature-catalog.md`](docs/feature-catalog.md)。

## 2026-10-01 —— 球体 Task 7：工程投影与导出

- **背景**：球在画布上、在截面里都通了，但**工程制图里没有它** —— `projectionVisuals.ts` 的 `templateTypes` 又是一张漏了 `sphere` 的硬编码名单（上一批已经预告过这一处）。
- **改动（1 个文件 + 1 个新测试文件 + 1 个新夹具 + 1 处 e2e）**：
  - `projectionVisuals.ts` 加球分支：**只画轮廓，不投影显示网格的三角形**。判据是球区别于所有多面体的那条性质 —— **正投影下球的轮廓永远是半径等于球半径的圆，与视线方向无关**（立方体在四个视图里是三个不同的矩形，球是四个同样大的圆）。
  - 采样结果仍是既有的 `polyline` 图元（`closed: true`），所以 `DrawingViewport` 与 `engineeringExporters` **一个字都不用改**（计划里那句"仅在共用契约需要变更时才改 exporters"因此不成立），`sourceId` 也仍是那个球。
  - 半径 / 段的采样复用既有的 `sampleProjectedEllipse`（构造一个长短半轴都等于球半径的椭圆），所以弦高容差、闭合处不重算 `t=2π` 这些既有约定全部继承。
- **验证（本轮实测）**：
  - 新增 `apps/web/src/sphereProjection.test.ts`（5 条）。**RED 起点 4/5 红**，症状是 `expected [] to have a length of 1`（球压根没被投影）。
  - **一处自查**：第 5 条"隐藏的球不出现"在实现之前**就是绿的** —— 球那时压根不投影，`toHaveLength(0)` 成立得毫无意义（本项目第四次踩这个坑）。已改成**反向对照**：同一份文档里放一个隐藏的球 + 一个可见的空间点，点必须照常投影、球必须不出现。
  - 四个视图的**半径相等**由单元用例钉住（逐个视图把采样点集的形心当圆心、逐点量半径，都等于 5）；"投影中心就是球心投影"单独钉一条（front 视图下形心 = (1,2)）。
  - 新增夹具 `e2e/fixtures/cad-sphere.mgeo`，`e2e/engineering-drawing.spec.ts` 增到 **5 条**：逐个视图点名（第 N 个视图里恰好一条球轮廓，而不是"总共 4 条"——否则"四条全挤在一个视图里"也会绿），并断言"暂无可投影的空间对象"提示消失、三件套（SVG / DXF / PDF）都能导出且扩展名正确。**5/5 通过**。
  - **全库**：`npx vitest run --maxWorkers=3` → **277 文件 / 3168 项通过 + 1 todo / 0 失败**。
  - `npm run typecheck` exit 0；`npm run lint` exit 0（**0 error / 13 warning**）。
- **如实说明**：新增那条 e2e 的 **RED 没有被独立观察到** —— 我只观察到单元用例的 RED（`expected [] to have a length of 1`）。e2e 断言的是 DOM 上的 `[data-source-id="sphere-1"]`，而那个属性只可能由投影产生，所以两者走的是同一条代码路径；但"e2e 在修改前必红"是**推理**，不是**实测**。
- **未做**：Task 8–9（Agent 创建球、完整产品门禁）。

## 2026-10-01 —— 球体 Task 6（上半）：从「常用立体」手工造一个球

- **背景**：Task 5 之后球已经能画、能选、能切，但**没有任何界面入口能造出一个球** —— 上一批的浏览器验收甚至得先建个立方体、再把草稿里的图元偷换成球才验得了。这一批把入口补上。
- **改动（3 个文件 + 2 个新测试文件 / 2 处既有测试更新）**：
  - `spatialSolidWizardModel.ts`：`SolidPreset` 加 `"sphere"`，草稿加 `radius`（默认 2，球心沿用 `origin` 那个字段）；`solidWizardInput` 里球**先判**并单独校验（半径有限正数、球心有限），报错文案点名"球"。
  - `spatialSolidCommands.ts`：`TeachingSolidInput` 加 `{ kind: "sphere"; center; radius }`；`buildTeachingSolid` 的球分支**只落一个图元**（解析实体，不像立方体 / 棱柱那样物化点 / 棱 / 面 / `polyhedron3`），标签 `球体 N`。
  - `components/SpatialSolidWizard.tsx`：预设列表加「球体」（六 → 七），球只渲染**球心 + 半径**两个入参 —— 底面 / 拉伸向量 / 顶点偏移那一整套都不显示（它们与球无关）。
- **为什么要"球先判"**：共用那套尺寸校验会让球平白背上 `width/depth/height` 的合法性约束，而且报错会与棱锥那条混成一句看不出所以然的话。实测 RED 就是这个现场：球预设当时**掉进棱锥分支**，报 `{ kind: 'pyramid' }`、`Cannot read properties of undefined (reading 'length')`。
- **验证（本轮实测）**：
  - 新增 `apps/web/src/spatialSphereWizard.test.ts`（7 条）。**RED 起点 5/7 红**，成因如上。
  - **一处自查**：其中两条（"半径非法要拒""球心非有限要拒"）在实现之前**就已经是绿的** —— 因为球那时走棱锥分支、棱锥分支同样会拒 0/NaN，等于什么都没钉住。已加断言要求**报错文案点名"球"**，改法之后它们在实现前是红的。
  - `SpatialSolidWizard.test.tsx`：把"六个课堂立体"更新为**七个**（并在断言里点名"球体"），另加一条"球只提供球心 + 半径，不出现底面宽 / 拉伸向量 / 顶点偏移"。
  - **浏览器验收** `e2e/geometry3d-sphere.spec.ts` 增到 **2 条**（新增"从「常用立体」造球"）：参数改完但**没点确认**之前文档里不该有球（预览只改画面）、画面确实有东西（"这里什么都没有"的提示消失）、半径填 0 时如实报原因且文档没动、确认后恰好一个球且球心/半径逐值相等。**2/2 通过**。
  - **全库**：`npx vitest run --maxWorkers=3` → **276 文件 / 3163 项通过 + 1 todo / 0 失败**。
  - `npm run typecheck` exit 0；`npm run lint` exit 0（**0 error / 13 warning**）。
  - 顺带修掉一处自己引入的类型错误：新测试里写了 `createEmptyDocument("geometry")`，而 `Workspace` 没有这个名字（合法值：`calculus` / `conics` / `cad` / `geometry3d`）—— 单测不报、`tsc` 当场报。
- **下半（属性栏编辑 + 截面按钮）也已落地**：
  - **属性栏编辑球心 / 半径**：`inspectorLabels.ts` 的 `SolidPrimitive` 与 `inspectorModel.ts` 的 `selectedSolid` 名单加入 `"sphere"`；`PropertiesBar.tsx` 加球的分支（**只有球心 + 半径 3D 两个字段**，用的是 Task 3 打通的 `updatePrimitive { center3, radius3 }`），并给"朝向"那块加 `selectedSolid.type !== "sphere"` 守卫 —— **球没有 `rotation` 字段**（解析体没有朝向），不加守卫 `tsc` 直接报错。
  - **工具栏「创建截面」对球可用**：`solidCommands.ts` 的 `solidTypes` 加入 `"sphere"`（它同时管着按钮的 `disabled` 与命令的守卫），对应测试的名单断言同步更新。
  - **还有一张更深的名单**：`packages/dsl/src/schema.ts` 里**另有一份** `solidTypes`，`section` 的校验写着"来源必须是实体" —— 不加球的话，界面点下去会被**文档校验层**挡掉，症状是"按钮可点但什么都没发生"。这一处是**跑 e2e 才暴露的**（单元测试全绿）。
- **验证（下半，本轮实测）**：
  - `e2e/geometry3d-sphere.spec.ts` 增到 **4 条**，新增两条：①"属性栏改球心 / 半径、一步撤销"（RED 起点是 `expect(locator).toHaveValue` 找不到"半径 3D"字段）；②"工具栏切一刀并记录精确圆"（断言 `data-section-count=1`、`data-section-exact-kind=circle`、`data-section-exact-status=exact`、交圆采样点 > 2）。**4/4 通过**。
  - **全库**：`npx vitest run --maxWorkers=3` → **276 文件 / 3163 项通过 + 1 todo / 0 失败**（含球布尔门禁那条 —— 说明 `schema.ts` 放开"球可当截面来源"之后，**"球不能参与布尔交"仍然成立**：那四处检查在查这张表**之前**先查 `hasSphereSource`）。
  - `npm run typecheck` exit 0；`npm run lint` exit 0（**0 error / 13 warning**）。
- **一处结构性发现（值得单独记）**：给这个项目**加一种实体**，要同时改**七八张硬编码的类型名单**。球这一路已经踩过：`visibleSolids`（否则不进场景）、`pickKind`（否则看得见选不中）、`hasGeometry`（否则说画布是空的）、`schema.ts` 的 `solidTypes`（否则截面被文档校验挡掉）、`solidCommands.ts` 的 `solidTypes`（否则按钮不可点）、`inspectorModel` + `inspectorLabels`（否则属性栏不认识）。每一处漏掉都**不报错**，只是那条功能静默失效 —— 而且单元测试全绿。**下一处已知的还没改**：`projectionVisuals.ts` 的 `templateTypes`（Task 7 的工程投影）。

## 2026-10-01 —— 球体 Task 5（上半）：画的球与"不许出现经纬网"

- **背景**：Task 1–4 让球在**文档层**完整（类型、解析截交、可编辑可测量、截面接入 + 布尔门禁），但画布上**根本没有球** —— `SolidPrimitive` 只含 cube/pyramid/cylinder/cone，球会掉进"圆锥"那条分支。
- **改动（2 个文件 + 1 个新测试文件）**：
  - `apps/web/src/threePrimitives.ts`：
    - `SolidPrimitive` 联合类型加入 `SpherePrimitive`；`visibleSolids` 的过滤列表加入 `"sphere"`（否则球压根不进场景）。
    - `createSolidMesh` 加球分支：`SphereGeometry(radius, 48, 32)`，位置是**球心**。
    - `createSolidGroup` 对球**不画任何线**（`solidOutline` 与 `hiddenEdgeOverlay` 都跳过）。理由写进了代码：两者都是 `EdgesGeometry`，套在球面上会拆出一整张**经纬网** —— 几十条看得见、也**选得中**的"棱"，用户点球面会选到一条虚构的边；而 spec 明确不要"密集的可选中经纬线"。球真正的轮廓是**视角相关**的屏幕空间剪影，不是网格边，所以这里如实不加，而不是加一圈"看着像轮廓"的假边。
    - 网格密度取 48×32（与圆柱默认 48 分段同一量级）并写明：**它只是显示缓存**，文档只存球心与半径，改这个数不会动 `.mgeo` 一个字节。
  - `apps/web/src/threePicking.ts`：`pickKind` 的实体列表加入 `"sphere"` —— 少了它，点球面不会被认成实体，球"看得见但选不中"。
- **验证（本轮实测）**：
  - 新增 `apps/web/src/threeSphere.test.ts`（5 条）。**RED 起点：4/5 全红**，症状逐条对上"球走了圆锥那条分支"：出现了 `LineSegments`（经纬网）、开了隐藏边后变成 2 条、**`mesh.position` 是 `[1, NaN, 3]`**（球没有 `height`，`center.y + undefined / 2` 直接是 NaN）、`visibleSolids` 返回空。
  - **GREEN**：同一条命令 **5/5 通过**。
  - **一处自查**：第 5 条"隐藏的球不进场景"在实现之前**就是绿的**（`visibleSolids` 当时压根不认球，返回空数组碰巧满足 `toHaveLength(0)`）—— 典型的"为错误的理由通过"。已改成**反向对照**：一份文档里同时放可见球与隐藏球，必须只留下可见那一个；改法之后它在实现前是红的。
  - **全库回归**（因改了 `SolidPrimitive` 这个核心联合类型）：`npx vitest run --maxWorkers=3` → **275 文件 / 3152 项通过 + 1 todo / 0 失败**。
  - `npm run typecheck` exit 0；`npm run lint` exit 0（**0 error / 13 warning**）。
- **下半（同一批的后续）也已落地**：
  - **相切的那一个点现在画得出来**（`threePrimitives.ts` 的 `createSectionMesh`）：此前第一行是 `points.length < 2 → return null`，于是**"相切"和"根本没切到"在画布上长得一模一样** —— 两个都是空的，用户无从分辨。新增 `points.length === 1` 分支：在切点画一个标记（`SphereGeometry(1,16,12)` 缩到手柄半径，与交点图元同一套尺寸语言），`visualRole = "section-tangent-point"`。空集仍然返回 `null`（反向对照：没切到**不许**出现假标记）。
  - **球的自动取景不用改**：`threeCamera.ts` 的取景是从**场景对象**算包围盒的（`contentRadiusExcluding`），球现在有了真网格，所以自动纳入 —— 这一条是"查实后确认不需要改"，不是漏做。
  - **`selectionCommands.ts` 里那张实体名单刻意不加球**（已加注释说明）：那句引导语是"点击棱或面默认选中整个实体；按住 Alt 点击可单独选中棱或面"，而**球既没有棱也没有面**（它是解析体，没有 `edge3`/`face3` 子对象）—— 给球弹这句引导是**误导**。
  - **新增浏览器实机验收** `e2e/geometry3d-sphere.spec.ts`（1 条）：球**还没有手工入口**（那是 Task 6），所以用例借应用自己的"添加立方体"落一份**合法**草稿、再把 `primitives` 换成球 —— 文档其余字段（图层 / 元数据）由应用保证，不在测试里手搓。断言：刷新后球的 C/r 逐值不变 → 对象树里以"球体 1"出现 → **刚刷新时快捷操作条不可见、在球心投影处点一下之后必须可见**（这是"真的画出来了"唯一的实机证据：没画出来的话这一点命不中任何物体）→ 轨道相机方位角确实变了、而文档里的 C/r 一个字节都没变。
- **验证（下半，本轮实测）**：
  - `apps/web/src/threeSphere.test.ts` 增到 **8 条**（球网格 5 + 相切标记 3）。**相切标记那条 RED 起点是 `expected null not to be null`**；另两条反向对照（空集仍 `null`、圆截面路径没被抢走）一开始就是绿的。
  - `e2e/geometry3d-sphere.spec.ts` → **1/1 通过**。**变异检查**：把 `"sphere"` 从 `visibleSolids` 拿掉 → 该用例当场红在 `expect(locator).toBeVisible()`（快捷操作条找不到）—— 证明它真的守着"球被画出来"这件事，不是只读文档。探针已还原。
  - **全库**：`npx vitest run --maxWorkers=3` → **275 文件 / 3155 项通过 + 1 todo / 0 失败**。
  - `npm run typecheck` exit 0；`npm run lint` exit 0（**0 error / 13 warning**）。
  - 一处**自查**：这份 e2e 的初版里我写了一句拿方位角**自己和自己比**的断言（`not.toBeCloseTo(同一个读数)`），它永远不可能满足、只会超时 —— 等于把"相机真的转了"这条判据写废了。已改成先记下拖动前的方位角再比。同一版还因为单次 `mouse.move` 没触发旋转而红过一次，改用 `{ steps: 8 }`（既有 spec 的成熟写法）后通过。
- **仍未做（Task 5 剩下的两条判据）**：**经界面**创建球并切一刀来验"切点可见"（球的截面按钮是 Task 4 的尾巴、手工入口是 Task 6）；"没有密集可选中经纬线"只有单元判据（浏览器里没有可读的读数能观察它）。
- **视觉验收抓出一处真缺陷并已修**（计划里"visually inspect an actual frame"那一条真的有用）：按要求把种子球那一帧截下来人工看一眼，发现球画得对（剪影干净、**没有经纬网**），但**画布中间压着一句"添加点、线或面开始探索三维空间。"** —— 场景里明明有球，应用却说这里是空的。
  - **根因**：`threeScene.tsx` 的 `hasGeometry` 又是一张**硬编码类型名单**（`point3/line3/…/cube/pyramid/cylinder/cone`），**漏了 `sphere`**，于是一份只含球的文档被判成空图纸。这和 `visibleSolids` 是同一类漏配 —— 又一次"同一个判断散在多张名单里"。
  - **为什么单元用例全绿也没抓到**：`hasGeometry` 是组件里的局部常量，只有真渲染那一帧才看得见。所以这条**唯一的判据就是看一眼截图**。
  - **修法**：名单加入 `"sphere"` 并写明理由。**回归**钉在 `e2e/geometry3d-sphere.spec.ts` 里：断言那句空图纸提示 `toHaveCount(0)`。
  - 证据（修复前那一帧）见提交信息与 `docs/project-progress.md` 的 Task 5 一节。

## 2026-10-01 —— 球体 Task 4（上半）：球的解析截面接进 `SectionPrimitive`

- **背景**：Task 2 有了"球 ∩ 平面"的解析式，Task 3 让球可编辑可测量，但**截面还是画不出来** —— `recomputeSection` 里球走不到任何一条分支，落进兜底那句 `classification:"insufficient-data" / status:"failed"`，诊断还写着"截面来源不是可剖切的实体"。本批把这条接上。
- **改动（2 个文件 + 1 个新测试文件）**：
  - `packages/scene-graph/src/sectionRecompute.ts`：
    - `analyticSectionBoundary` 认球 —— 球走 `spherePlaneSection3`，**不是**二次曲面那套矩阵表示（球没有 `bounds`，`sectionQuadric3` 对它会直接回退，压根到不了那一行）。三种结局 `circle` / `point` / `empty` 本来就在 `Conic3Kind` 里，不新造枚举。
    - `recomputeSection` 加球分支：圆 → `classification:"polygon"` / `status:"exact"` / `visible:true`；**切点 → `classification:"point"` / `status:"exact"` / `visible:true`**（spec §3 要求画布上有一个点标记；这点与多面体那条路径**刻意不同** —— 那边相切时把截面藏起来，因为多边形切在一点上确实没有可画的边界）；空集 → `classification:"none"` / `status:"undefined"` / `visible:false`。
    - `section.points` / `loops` 按 spec §3 只当**可再生显示缓存**：由 `conic3PointAt` 采样解析圆得到（48 段，与圆柱默认分段同一视觉密度），真几何在 `section.exact` 里。文件里写明了**不许**拿这 48 个点去算面积 / 弦长冒充精确圆。
    - `analyticSectionBoundary` 仍是"源 + 平面 → 解析边界"的**唯一**一处映射；球分支里重算的只是同一个纯函数在同一组入参上的几个浮点运算，规则没有写两遍。
  - `packages/scene-graph/src/solidGeometry.ts`：`sectionPlaneThroughSource` 对球返回**过球心**的水平面（`constant = -center.z`）。球没有顶点可算包围盒，但球心就是它的几何中心；过球心切出来的是大圆，既最容易看见、也最容易和"压根没切到"区分开。
- **验证（本轮实测）**：
  - 新增 `packages/scene-graph/src/sphereSection.test.ts`（7 条）。**RED 起点：7/7 全红**，失败原因如实是"球落进兜底分支"（`exact` 为 `undefined`、`points` 为空、`classification` 是 `"insufficient-data"`、默认平面返回 `null`），不是断言写错。
  - **GREEN**：同一条命令 **7/7 通过**。
  - **全库回归**（因改的是所有截面共用的 `recomputeSection`）：`npx vitest run --maxWorkers=3` → **274 文件 / 3144 项通过 + 1 todo / 0 失败**。
  - `npm run typecheck` exit 0；`npm run lint` exit 0（**0 error / 13 warning**，与基线一致）。
  - **插曲（如实记）**：第一次 typecheck 报 exit 2 —— 新测试把 `PrimitiveSpec` 从 `@draw/geometry-kernel` 导入，而那个类型属于 `@draw/dsl`。当时整套单测是绿的，因为那是个 `import type`，运行时会被擦除、vitest 不做类型检查。改对之后 typecheck exit 0，并按纪律**重跑了整套单测**（读数同上），没有拿"改动只是类型层面的"当借口跳过验证。
- **判据的两条实质**：
  1. 显示缓存里的点必须**真的落在球面上**（回代 `|X−C|²=r²` 残差 < 1e-9）**且在剖切面上** —— 两个条件缺一条就说明缓存是编出来的；
  2. 改半径之后，**显示缓存与解析系数两边都重算**（半径 5 → 交圆半径 4、系数 `−16`；半径 4 → 交圆半径 `√7`、系数 `−7`）。只更新一边就等于"画的和算的不是一件事"。
- **下半（布尔门禁）也已落地**：
  - `packages/dsl/src/schema.ts`：新增一处判据 —— 四种布尔图元（`intersectionLine` / `intersectionSolid` / `intersectionFace` / `intersectionPoint3`）的**来源里出现球**时，报一条点名球的 `unsupported` 诊断（`… does not support a sphere source (unsupported): only sphere ∩ plane is exact; sphere ∩ sphere and sphere ∩ polyhedron are not implemented`）。
  - **为什么必须单独一句话**：球**本来就是实体**，让它掉进下面那句 `sources must be solids`，用户看到的是"需要实体"、而他手里给的正是实体 —— 那句话对球既没错也**没用**。这正是这一条要修掉的东西。四处共用同一个 helper，判断只写一份。
  - 创建时即拒（`changed=false`）且**返回原文档本身**（同一引用，不是"改了一半又回滚"的等价副本）；旧文档里已缓存的球交集重算仍如实退化为 `insufficient-data` / `visible:false` / 空顶点，**不伪造多面体**。
- **验证（下半，本轮实测）**：
  - `sphereSection.test.ts` 增到 **10 条**：门禁 2 条（拒绝 + "两个立方体照样放行"的**反向对照**，否则"一律拒绝"也能让它变绿）与防御性重算 1 条。**RED 起点：这 3 条全红** —— 当时诊断是 `intersectionSolid sources must be solids`（不含 `unsupported`、也没点名球）。
  - 顺手纠正了自己测试里一处 API 误用：`recomputeDerivedObjects` 返回的是 `GeometryDocument` 本身，不是 `{ document }`（RED 时报 `Cannot read properties of undefined (reading 'primitives')`）。
  - **全库**：`npx vitest run --maxWorkers=3` → **274 文件 / 3147 项通过 + 1 todo / 0 失败**。
  - 点名的那组截面 / 交测试（16 个文件：`section-loops`、`section-quadric`、`sections3d`、`section-materialization`、`intersectionSolid`、`intersectionLine`、`intersection-surfaces`、三个 `intersectionPreview*`、`threeIntersectionSolid` 等）→ **163/163 通过**。
  - `npm run typecheck` exit 0；`npm run lint` exit 0（**0 error / 13 warning**）。
- **未做（Task 4 剩下的）**：`apps/web/src/solidCommands.ts` 的截面按钮在 UI 上"选中球就能切"这一步、以及球截面的 e2e；删除级联语义本身**未改**（全库含 `deletion-cascade` 全绿，说明没有连带破坏）。

## 2026-10-01 —— 球体 Task 3：球的场景事务与数值测量

- **背景**：承接 Task 2（球-平面解析数学）。Task 3 要让球成为**文档里可编辑、可测量、可保存**的普通对象，而不是一个"只能摆着看"的类型。
- **改动（4 个文件 + 2 个新测试文件）**：
  - `packages/scene-graph/src/transforms.ts`：
    - `translatePrimitive3` 加球分支（平移球心、半径不变）；
    - `EDITABLE_GEOMETRY_TYPES` 与 `isFreeDraggable3` 加入 `"sphere"`。**这两处是真正的门**：`apply.ts` 的 `updatePrimitive` 先查 `EDITABLE_GEOMETRY_TYPES`（不满足直接 `changed=false, error:"object is not editable"`），`translatePrimitive3` 先查 `isFreeDraggable3`。**只改 `apply.ts` 的分支是不够的** —— 这正是本批第一次跑 RED 时踩到的。
  - `packages/scene-graph/src/patches.ts`：`center3Types` / `radiusTypes` 加入 `"sphere"`（球心与半径是它自己的字段，与圆柱/圆锥/轨道圆同一套"有限、正数"校验），错误文案同步为 "only cylinders, cones, spheres and circle tracks support …"。没有测试钉着旧文案，已核对过。
  - `packages/scene-graph/src/apply.ts`：`updatePrimitive` 加球分支 —— 只有 `center3` 与 `radius3`，**没有** `segments` / 朝向（显示网格是画布缓存，不进文档）。
  - `packages/geometry-kernel/src/measurements3d.ts`：球的面积 `4πr²` 与体积 `4πr³/3`，均标 `exact-input`。
- **为什么测量要单独钉**：同一个球如果走"三角网格求和"，48 边形的结果会明显偏小，而且**随画布网格密度漂** —— 读数会跟着渲染设置变。球是解析实体，读数必须来自解析式，所以用例直接钉 r=2 → `16π` / `32π/3`，并额外断言体积按 r³ 走（3 倍半径 = 27 倍体积）。
- **验证（本轮实测）**：
  - 新增 `packages/scene-graph/src/sphereTransactions.test.ts`（7 条）与 `packages/geometry-kernel/src/sphereMeasurements.test.ts`（4 条）。
  - **RED 起点**：4 条失败，原因如实记录为"球的编辑/平移被两道白名单挡在门外"，不是断言写错。
  - **GREEN**：`sphere.test.ts` + `sphereMeasurements.test.ts` + `sphereTransactions.test.ts` → **3 文件 24/24 通过**。
  - **全库回归**（因为动了共享白名单，必须跑全套）：`npx vitest run --maxWorkers=3` → **272 文件 / 3134 项通过 + 1 todo / 0 失败**。
  - `npm run typecheck` exit 0；`npm run lint` exit 0（**0 error / 13 warning**，与既有基线一致）。
- **一处自查并已加固的地方**：`sphereTransactions.test.ts` 里"非法半径整笔拒绝"两条在实现之前**就已经是绿的** —— 因为球当时压根不支持改半径，`changed=false` 成立得毫无意义（典型的"为错误的理由通过"）。已加断言 `expect(rejected.error).toMatch(/radius must be positive/)`，把**拒绝的理由**也钉住。
- **未做**：Task 4–9（截圆接入 `SectionPrimitive`、3D 网格与拾取、工程投影、手工/预览入口、Agent 创建、完整产品门禁）。Task 3 的方框按计划纪律**等 CI 四项全绿之后再勾**。
- **交付闭环**：代码提交 `44353ad` 推送后核对远端 SHA = 本地；CI run `36964580061` 的 `checks` / `build` / `rust` / `e2e` **四项全部 success**。勾选前补了两件事：① 跑齐 Task 3 点名的四个既有聚焦文件（`scene-store` / `patches` / `recomputeConsistency` / `measurements3d`）= **126/126**，确认**没有回归**（本 Task 的 RED 来自新增聚焦文件，不是靠改既有文件制造红）；② 补上原本缺的**撤销/重做**覆盖 —— 新增 `apps/web/src/sphereHistory.test.ts`（3 条：改半径 = 一步撤销、撤销后球仍在、**被拒绝的编辑不压历史**，否则下一次 Ctrl+Z 会变成空操作）。球用例合计 **27/27**。
- **一处范围说明**：Task 3 原清单里的「source section recompute」**不在本 Task 交付** —— 球当时还不是 `SectionPrimitive` 的来源；该子项由 **Task 4** 覆盖。已写进计划，避免被读成漏做。

## 2026-10-01 —— 球体 Task 2：球-平面精确数学与退化（内核 `spherePlaneSection3`）

- **背景**：球体九块计划（[`docs/superpowers/plans/2026-10-01-sphere-and-sections-implementation-plan.md`](docs/superpowers/plans/2026-10-01-sphere-and-sections-implementation-plan.md)）此前只交付了 Task 1（DSL 类型 + 校验）。本批按计划做 **Task 2**：把"球 ∩ 平面"做成**解析**判定，而不是把球切成多面体再求交。
- **新增** `packages/geometry-kernel/src/sphere.ts`：
  - `spherePlaneSection3(sphere, plane)` —— 设 `n̂ = n/|n|`、有符号距离 `d = (n·C + constant)/|n|`，交圆圆心 `C − d·n̂`、半径 `√(r² − d²)`；三种结局 `circle` / `point` / `empty`，非法输入返回带 `code` 的 `invalid`（`invalid_sphere` / `invalid_plane`），**不编一个"看着像"的圆**。
  - 圆分支同时给出 `conic`（复用既有的 `circleConic3`，所以能直接进 `Conic3` / `section.exact` 那套）与 `loops` —— 球是无端面实体，整条交圆是一段完整参数域 `[0, 2π]`，**不需要**圆柱/圆锥那套端面弦裁剪（与 `section-quadric.ts` 形成对照）。
  - 退化到切点时**刻意不返回** `√(r²−d²)` 算出的"极扁圆"：那个数在 `|d| ≈ r` 的区间里完全是噪声。
- **判据两条（都写进了用例）**：
  1. **交圆上的点真的落在球面上** —— 逐点采样回代 `|X − C|² = r²`，残差 < 1e-9。而不是断言"坐标看起来是整数"。
  2. **退化容差与模型尺度同源**（相对量 `r·1e-9`，不是绝对阈值）。两个方向各一条用例：半径 `1e-6` 的球上 `1e-12` 的绝对间隙是**真实间隙**（空集），半径 `1e6` 的球上 `1e-6` 的间隙是**数值噪声**（相切）。绝对阈值在这两处会各错一次。
- **验证（本轮实测）**：
  - `npx vitest run packages/geometry-kernel/src/sphere.test.ts` → **13/13 通过**。RED 起点是 `Failed to resolve import "./sphere"`（模块不存在，不是测试环境问题）。
  - 连同 `quadrics.test.ts` + `section-quadric.test.ts` 三个解析层文件一起跑 → **35/35 通过**（确认没有破坏既有的圆锥曲线分类与有限实体裁剪）。
  - `tsc -p packages/geometry-kernel/tsconfig.json` exit 0；`eslint` 三个改动文件 exit 0。
  - **变异检查**：把 `tolerance = radius * RELATIVE_TOLERANCE` 改成绝对量 `RELATIVE_TOLERANCE` → **恰好**那两条尺度用例变红（其余 11 条不动），证明这两条断言不是空转；探针随后还原，`git grep MUTATION-PROBE` 无输出。
- **有意偏离计划原文一处**：计划把"不相交"拼作 `kind:"none"`，内核实现用 `"empty"`。理由是 `Conic3Kind`（`"circle" | "ellipse" | … | "empty" | "insufficient-data"`）已经是内核的既有枚举，而 `"none"` 是 DSL `Section3Classification` 的产品层拼法 —— 同一个概念在内核里再起一个同义名，正是这个项目吃过亏的"同一个判断写了两遍"。映射在 Task 4 的 `sectionRecompute` 一层做（`empty` → `classification: "none"`）。
- **未做**：Task 3–9（截圆接入 / 3D 渲染 / 工程投影 / 交互 / Agent 创建）一条都没动；`sectionQuadric3` 也**没有**被改成走球体（球没有 `bounds`，仍如实回退既有路径）。Task 2 的方框按计划纪律**等 CI 四项全绿之后再勾**。
- **交付闭环**：代码提交 `22bd7a2` 推送后核对远端 SHA = 本地；CI run `36963752920` 的 `checks` / `build` / `rust` / `e2e` **四项全部 success**，随后才在计划里勾上 Task 2，并把计划 Interfaces 行里"不相交"的拼法由 `"none"` 更正为 `"empty"`（附理由），避免计划与代码互相打架。

## 2026-10-01 —— `main` 未发布修复：相机最后一帧标签对齐

- `a4e2f40`：`threeSceneRender.render()` 在顶点/测量 HTML 标签投影前显式同步相机矩阵，不再依赖网格渲染的偶然副作用；浏览器用例移除松手后的额外指针抖动。无网格隔离测试修前约 386px 漂移、修后对齐。
- 本地全库 269 文件/3105 测试通过 + 1 todo、全量 e2e 171/171；GitHub CI run `36901742182` 四作业成功。**尚未为这批新代码重打桌面安装包**。

## 2026-10-01 —— `main` 未发布修复：实体体积数字浮现在画布

- `374daa0`：`polyhedron3` 体积测量以物化顶点求画布标签中心，缺顶点不画假数字；沿用原有测量标注样式。真实斜棱柱显示 48.000u³，保存重开仍可见。
- 本地全库 268 文件/3104 测试通过 + 1 todo、全量 e2e 171/171；GitHub CI run `36898807030` 的 checks/build/rust/e2e 四作业成功。**没有重新打包或安装桌面发行包**，不属于 v3.0.1 二进制内容。

## 2026-10-01 —— `main` 未发布功能：单顶点编辑（非 v3.0.1 安装包）

- `cc9f533`：棱柱与模板实体的单顶点数值编辑将受影响的非共面四边形改为有效三角片，保留严格共面规则；新增内部细分棱、稳定的面/棱引用与不同面名，重合顶点修改被原子拒绝。棱柱/模板保存重开、撤销重做、改后体积与截面均有回归。
- 本地：全库 268 文件/3103 测试通过 + 1 todo，全量 e2e 171/171；GitHub CI run `36895877862` 的 checks/build/rust/e2e 四作业通过。此次只更新 `main` 代码和文档，**未重新打出或安装桌面发行包**，不属于 v3.0.1 的二进制内容。

## 2026-10-01 —— v3.0.1：旋转环默认关闭 + z=0 网格"无限延伸"（顶点色淡出）；版本 3.0.0 → 3.0.1

- 本版内容与验证见 [`docs/release/v3.0.1.md`](docs/release/v3.0.1.md)；两处我自己造成的事故（着色器栅格"编译通过却没画出来"、PowerShell 把成对参数拆成字符导致两份文档连字符被替换）与合并处置也记在那份发布说明与本条提交信息里。
## 2026-09-30 —— 把"还差什么"集中成一份总清单（`current-status` §四），并同步到最新 `main`

- **用户要求"更新，同时查阅进度文档，看看现在有哪些未完成的任务"**。本轮先把本地 `main` 同步到最新（`0d22ab4` → 远端无新提交，`git ls-remote` 核对 = `1676452`），再通读各进度文档，把散落在五份文件里的"未完成"合并成**一处权威清单**：`docs/current-status.md` 的「**四、未完成任务总清单**」，分五类 ——
  - **A. 计划内未勾选 3 项**：Task 6 单顶点编辑（已定修法"拆三角形"，待实施）、Task 8 第 2 项的**根脚本 `npm run build` 整体命令**（桌面 `bundle` 已跑通，4 个 packages 的 `tsc` 未跑）、Task 8 第 3 项教师/学生走查（用户侧）。
  - **B. 计划外、已查实未修的缺口 3 项**：实体源（体积等）测量在画布上无数字（`pointPositions` 缺 `polyhedron3` 分支）、指针抬起前最后一次相机移动不触发渲染（差约 30px 且不自行收敛）、选中线时三色旋转环遮挡教学图面。
  - **C. 未复跑的门禁 3 条**：全量 `npm run test:e2e`（47 spec）、`test:perf`、`test:rust`。
  - **D. 发布与仓库收尾 3 项**：桌面产物未推 GitHub Release、未在本机安装 MSI/NSIS、已合并的远端功能分支未删除（且其 tip 的文档是过时版本）。
  - **E. 已决定或待决定未启动 4 项**：球体与球截面（**已决定启动**，需先另立方案）、题目截图→可编辑图、HTML/GeoGebra 导出、平面/函数逐题补缺。
- **顺带修掉一处残留的过时表述**：实施计划「执行快照」里还写着"桌面打包仍未做"，而同日 `632130a` 已经打出 exe/MSI/NSIS 并做了启动实测 —— 按事实改写，并把执行快照更新到 2026-09-30（含"计划外未做/未跑"那几条，且声明未完成清单的权威处在 `current-status.md` §四）。
- `docs/feature-catalog.md` 的「已知但未修的缺陷」加了一句指路，避免同一份事实在多处各说各话（本阶段已经吃过两次"过时清单被误读"的亏）。
- **同步结果**：`git fetch` 后远端 `main` 无新提交，本地 = 远端 = `1676452`（`git ls-remote` 核对）。本批**只改文档**，无可执行产物，故未跑代码门禁。

## 2026-09-30 —— 按最新 `main` 重做文档普查：补齐归档第四十九批、README、设计说明与当前状态

- **背景**：用户要求"所有进度文档都要更新"。先前那版普查（功能分支上的 `8c67346`）是在**知道 PR #1 合并之前**写的，只存在于功能分支，且把"未合并 `main` / 未打包"这类**当时已过时**的口径写了进去 —— 直接搬到 `main` 会把 `7729376`、`632130a` 已经更正过的事实**又改回错的**。所以本轮**在最新 `main`（`0d22ab4`）上重做**。
- **当时 `main` 上真正缺的四处**（已补）：
  1. **`docs/project-progress.md` 完全没有这批工作的记录** —— 新增「第四十九批」整节（Task 8 三批六类样题、两处缺陷修复含 RED→GREEN、各任务补充用例、本轮回归收口、三次自我更正与两条"两层独立守卫"、以及合并后 `main` 上的后续提交摘要），并给第四十八批那条"未完成六类样题组合验证"加前向指引；
  2. **`README.md`** 两处：把"六类教学题的完整组合验收……仍待完成"改正为**已完成 7/7**，并更新"下一步"那句；
  3. **设计说明 `docs/superpowers/specs/2026-09-29-…-design.md`** 的状态行：由"P0 与部分 P1……整期尚未验收"改为"已合并进 `main`、六类验收完成、桌面端已能打包"，并列出剩余项；
  4. **`docs/current-status.md`**：`P1 已在功能分支完成部分` → **`P1 已完成`**；Task 8 第 2 项改写为"代码侧四条门禁当次复跑 + 桌面端 `bundle` 已成功实测，**但根脚本 `npm run build` 作为整体命令仍未跑**"；本节"仍未完成"清单同步（去掉"桌面打包"、补上旋转环遮挡与根脚本 `npm run build`）。
- **不改的**：`docs/project-progress.md` 里各批次的**历史读数**（3066 / 44 项 / 8÷8 等）按该文件自己的体例保留 —— 它们是"写它的那一刻"的实测值。
- **核对**：本地 `main` 已由 `4d35b9d` 快进到 `origin/main` 的 `0d22ab4`（早先落后 53 个提交，已用 `git merge-base --is-ancestor` 验证是快进关系）。本批**只改文档**，无可执行产物，故未跑代码门禁。

## 2026-09-30 —— 桌面端（最新版）实际打包并启动实测：release exe + MSI + NSIS

- **为什么值得记**：此前"完整桌面打包"一直被记为**用户侧、没做**（还留着"P0 时一次 Rust 编译超过 180 秒而中止"的旧读数）。这一轮按要求**真的把它跑了**，产物落地、并做了启动实测，所以旧口径必须改。
- **命令与结果**：`npm --workspace @draw/desktop run bundle`（= `tauri build`；`beforeBuildCommand` 会先跑 `npm run build --workspace @draw/web`）→ **exit 0**。前端 `vite build` 输出到 `build-check/mathcanvas-current`（入口 `index-*.js` **1 694.94 kB** / gzip 490.28 kB，`engineeringExporters` 433.81 kB，`geometry.worker` 310.99 kB，CSS 100.34 kB；仍超 500 kB 的 chunk 警告是历史基线）；Rust `Finished \`release\` profile [optimized] target(s) in 27.43s`，随后 `candle`/`light` 出 MSI、`makensis` 出 NSIS。只多一条**无害**的 linker 警告（`linker stdout: 正在创建库 …dll.lib 和对象 …dll.exp`，`#[warn(linker_messages)]`）。
- **产物（2026-09-30 13:05，Windows x64，`FileVersion` / `ProductVersion` = 3.0.0，`ProductName` = MathCanvas）**：

  | 产物 | 路径（相对仓库根） | 大小 | SHA256 前 16 位 |
  | --- | --- | ---: | --- |
  | 免安装 exe | `apps/desktop/src-tauri/target/release/mathcanvas-desktop.exe` | 16.39 MB | `D2F6218A93721215` |
  | MSI 安装包 | `apps/desktop/src-tauri/target/release/bundle/msi/MathCanvas_3.0.0_x64_en-US.msi` | 6.53 MB | `8DD330974092E838` |
  | NSIS 安装包 | `apps/desktop/src-tauri/target/release/bundle/nsis/MathCanvas_3.0.0_x64-setup.exe` | 4.79 MB | `92690919FBD24D0A` |

- **启动实测**：release exe 直接启动后**存活满 12 秒并取得真实窗口句柄**（`MainWindowHandle=722346`）；期间 WebView2 与项目仓储按预期初始化（`%LOCALAPPDATA%\com.mathcanvas.desktop\EBWebView`、`%APPDATA%\com.mathcanvas.desktop\projects.db-shm` 都有对应时间戳）。
- **一处先前误判的更正**：早先这次会话里两次"起来几秒就没了"被我先怀疑成崩溃/环境不支持 GUI；**经用户确认是他自己关闭了窗口**。三条佐证与"崩溃"不符：stderr 只有关闭期噪声 `Failed to unregister class Chrome_WidgetWin_0. Error = 1411`（窗口类注销失败）、Windows 应用事件日志**无**崩溃记录、应用自己的日志文件 0 字节。**桌面端是能起的**。
- **仍然没跑（别读成整条门禁通过）**：根脚本 `npm run build`（= `build --workspaces`）**作为整体命令没跑过** —— 它除 web 与 desktop 的 `tauri build --no-bundle` 外，还要跑 4 个 packages 的 `tsc -p tsconfig.json`；本次跑的是 desktop 的 `bundle`（对 desktop 那一档是**超集**，但 4 个 packages 的 `tsc` 构建未跑）。完整 `npm run test:e2e`、`test:perf`、`test:rust` 本轮同样未复跑。所以实施计划 Task 8 第 2 项**仍不勾选**。
- 未提交/未发布：产物在 `target/` 下（git 忽略），**没有**推到 GitHub Release，也**没有**在本机安装 MSI/NSIS（"打包成功"≠"装过"）。

## 2026-09-30 —— 功能分支已合并进 `main`；文档里"尚未并入 main"的过时表述按事实改正

- **事实**：`feat/high-school-geometry-interaction` 已通过 **PR #1** 合并进 `main` —— 合并提交 **`3b1f770`**（2026-09-30 12:46:30；父提交 `4d35b9d`（合并前的 `main`）与 `e016f37`（分支 tip，"本轮总收口并暂停"那笔），两者都已用 `git merge-base --is-ancestor` 核实是它的祖先）。本地 `main` = `origin/main` = `3b1f770`，`.git/refs/remotes/origin/main` 于 **2026-09-30 12:50:19** 由 `fetch --all --prune --tags` fast-forward 到该提交；远端分支 `origin/feat/high-school-geometry-interaction` **仍存在（未删除）**。
- **改了什么**：把四处"尚未并入 `main` / 未合并"的**过时表述**按上述事实改正 —— `docs/current-status.md`（页首更新时间、本轮小节标题、"本轮结束时的交接"两条）、实施计划「执行快照」标题与末条、`docs/research/2026-09-29-high-school-geometry-interaction-progress.md`（页首与三处状态句）、`docs/feature-catalog.md`「本期收口」（引言与第 6 条）。`docs/project-progress.md` 是**归档**（记"当时实测"），其历史条目按该文件自己的体例**不改**。
- **没有变的**：桌面打包（`npm run build`，含 Tauri/Rust）**仍未做**；教师/学生走查**仍未做**；Task 6 单顶点编辑（已定修法：把受影响的面拆成三角形）**仍待实施**；球体与球截面**尚未启动**（需先另立方案与实施计划）。
- **核对（如实，分两步）**：写这份记录时第一次 `git ls-remote origin main` **失败**（`Connection was reset`，网络间歇），所以"远端 tip"一度只引用 2026-09-30 12:50 那次 fetch 的结果；**随后复跑成功，返回 `3b1f770`（当时的远端 `main` 就是这个合并提交）**；本批文档提交 **`7729376`** 推送后，`git ls-remote origin refs/heads/main` = `7729376` = 本地 `HEAD` = `origin/main`。
- 本批**只改文档**，无可执行产物。

## 2026-09-29 —— 本轮收尾并暂停：代码侧验证项做完，交接与后续方向已记录

- **按用户要求"暂停其他内容"**：本轮在此收尾。实施计划里**代码侧的验证项已全部完成** —— Task 1 / 2 / 3 / 4 / 5 / 7 全部勾选，Task 8 的第 1、4 项勾选。
- **只剩 3 项未勾选，且都不是"还没验"**：Task 6 的**单顶点编辑**（用户已定修法：把受影响的面拆成三角形，保持共面校验严格 —— **待实施**）、Task 8 第 2 项的 `npm run build`（桌面打包 Tauri/Rust，**用户侧**）、Task 8 第 3 项教师/学生走查（**用户侧**）。
- **用户已决定、尚未开始的两件**：把 `feat/high-school-geometry-interaction` **合并到 `main`**；**启动球体与球截面**（按计划需先另立方案与实施计划）。**本轮未启动**：截图识图、HTML/GGB 导出、平面/函数逐题补缺。
- 文档面同步收口：`docs/feature-catalog.md` 的「本期收口」按最新事实重写（新增"创建交互回归收口"一条；未交付各项标注用户的启动决定；**删掉两处已被更正的过时表述** —— "锁定对象仍可被拾取/吸附"与"属性栏改坐标被静默丢弃"）；`docs/current-status.md` 新增「本轮结束时的交接」一节；实施计划的执行快照写明三条剩余项与用户决定。
- **上传情况**：本轮共 9 次提交，全部推送到 `feat/high-school-geometry-interaction`，并以 `git ls-remote` **逐次核对**远端与本地一致（最后一次 `d3fb1ba`；其中一次 push 因 `github.com:443` 间歇性被挡重试到第 3 次才成功、一次到第 8 次）。**未合并 `main`，未打包桌面版本。**
- 本批**只改文档**，无可执行产物。

## 2026-09-29 —— 更正："锁定不被吸附"一直是实现的，是我记错了层次

- **要更正的是我自己先前的记录**：本文件与 `docs/current-status.md` 都把计划 Task 3 那条"隐藏或锁定对象不被当作可吸附目标"里的**锁定**一半记成**未实现**、并列进"如实缺口待定"。本轮核到**证据层**才发现那条**不成立**。
- **错在哪**：我当时只核对了纯函数 `resolveSpatialAnchor` —— 它**只按命中物回答、不认识文档**，所以它不认识 `locked` 本来就不奇怪。真正的过滤点在 `apps/web/src/threeSceneEffect.ts` 的 `resolveCreationAt`：
  ```ts
  const hit = primitive?.visible === false || primitive?.locked || (primitive?.type === "point3" && primitive.tessellation) ? null : picked
  ```
  三个条件各自挡一类：隐藏的、**锁定的**、以及生成的 `point3`（只该引用原点，不该吸附手柄球面）。
- **新增自带对照的 e2e**（`e2e/geometry3d-creation.spec.ts` 9→**10 项**，10/10 通过）：同一个屏幕坐标 —— 未锁定时读数 `已有点 (0.00, 0.00, 0.00)`；点属性栏「锁定图元」上锁后读数变成 `工作平面 XY (…)`（退回工作平面），同时断言**点本身仍在画布上**（锁定≠隐藏）；解锁后又读回 `已有点`。三个读数由同一个坐标产生，差别只可能来自锁定状态。
- **定向变异**：把 `primitive?.locked` 从那个过滤里摘掉 → 用例立刻红在 `Expected /^工作平面 XY \(/`、`Received "已有点 (0.00, 0.00, 0.00)"`。变异已恢复，产品文件与 HEAD **无差异**。
- **顺带澄清一处容易混的地方**：`primitiveVisibility.ts` 的 `isUserVisiblePrimitive` 确实**不看** `locked` —— 但那是对的，它是**渲染可见性**判据，而"锁定"本来就不该改变可见性（用户选的语义是"看得见、能选中，但不能当吸附目标"）。渲染可见性与吸附门禁是两件事，不在一个函数里。
- 本批读数：`tsc -p e2e/tsconfig.json` exit 0；`eslint` 该文件 exit 0；该 spec **10/10**；产品运行时代码零改动。

## 2026-09-29 —— Task 8 第 2 项门禁复跑（代码侧四条全绿；`npm run build` 属用户侧仍未跑）

- 实施计划 Task 8 那条"执行 `typecheck` / `lint` / `test` / `build` / 样题 e2e"的门禁，本轮把**代码侧四条**在同一个 HEAD 上复跑：
  - `npm run typecheck` **exit 0**（6 个 workspace + `e2e/` + `scripts/`）；
  - `npm run lint` **exit 0，0 error / 13 warning**（与既有基线一致）；
  - `npm test -- --maxWorkers=3` **266 文件 / 3072 项通过 + 1 todo / 0 失败**（241 s；比上一批多 6 项 = 创建状态机补的边界用例）；
  - `e2e/high-school-geometry-tasks.spec.ts` **7/7 通过**（六类代表题）。
- **唯一没跑的是 `npm run build`，原因已查实并写明**：根脚本是 `npm run build --workspaces`，**包含 `@draw/desktop` 的 Tauri/Rust 打包**；本轮目标明确把桌面打包划归用户侧、不在范围内（此前一次尝试在 180 s 超时中止）。所以这一项**保持未勾选**，不拿"web 构建通过"冒名顶替桌面打包。
- **未覆盖风险如实记录**：全量 `npm run test:e2e`（47 个 spec）仍未复跑 —— 本轮只跑了 3D 相关的两组共 15 个 spec 加样题 spec；`npm run test:perf` 与 `npm run test:rust` 未复跑。
- 本批**只改文档**（门禁复跑不产生代码变更）：`git diff --stat -- apps packages` 为空。

## 2026-09-29 —— Task 2 边界补齐：创建状态机的六条子句

- 实施计划 Task 2 那条"写失败测试"列的六件事，前四条与"三种结果"在模块新建那轮就已先红后绿；本轮把剩余边界补到 `apps/web/src/spatialCreationSession.test.ts`（4→**10 项**，模块本身**零改动**——补的是已实现行为的表征）：
  - `point3` 一个锚点即 `ready`；`line3` / `ray3` 两点 `ready`（补齐 `requiredAnchors` 表）；
  - **`face3` 无论多少个点都不会自作主张 `ready`**（4 点仍是 `needs-more`，只有 Enter 收尾）；
  - 收尾点与**首点重合**被拒，且**会话不前移**（多边形不会被悄悄封口又少一条边）；
  - **非有限坐标**（NaN）被拒并带自己的原因，脏数据不留进会话，拒后仍能正常继续；
  - 未完成图形拒绝提交时的**原因文案**逐字钉住。
- **"Esc / 切工作区取消后没有草稿对象"** 由两条 e2e 覆盖并各带定向变异（`geometry3d-creation.spec.ts` 的 Esc 取消、切换工作区取消），都断言对象行数为 0。
- **三处变异各自精确抓红**：去掉 `Number.isFinite` 守卫 / 去掉重合点守卫 / 把 `face3: 3` 塞进 `requiredAnchors` 表 → 恰好红在对应用例上。
- **顺带查明 `face3` 不自动完成有"两层独立守卫"**：① `requiredAnchors` 表里**没有** `face3` 条目（查表落空，`>= undefined` 恒假）；② 显式判断 `session.tool !== "face3"`。**只拆任一层都仍绿，两层同时拆才红** —— 与 Task 5 那条优先级守卫同一个模式，已写进文档。
- **类型门禁抓到一个 vitest 抓不到的问题**：第一版直接写 `finishSpatialCreation(...).reason`，运行时 10/10 绿，但 `tsc` 报 TS2339（联合类型 `SpatialCreationResult` 上 `reason` 只存在于 `rejected` 分支）。改成先断言 `status` 再按分支收窄后 `npm run typecheck` exit 0。
- 本批读数：`npm run typecheck` exit 0；`eslint` 该文件 exit 0；`spatialCreationSession.test.ts` **10/10**；产品运行时代码零差异。

## 2026-09-29 —— Task 1 基线补齐：Esc 分级 + Shift 两点建线端到端

- 实施计划 Task 1 那条"在现有 e2e 中增加基线用例（**不改运行时代码**）"里，`e2e/geometry3d.spec.ts` 缺两条，本轮补上（22→**24 项**，24/24 通过）：
  - **Shift 两点多选 → 创建空间直线**：原有用例只断言到"由选中点创建空间直线"按钮变可用就停了，**没有点下去**。现在补到真的建出"空间直线 1"，并用操作提示 `对象 3` 钉住"引用已有两点、没有偷偷另建点"。变异：让 `addLine3` 额外建两个重复点 → 当场红。
  - **Esc 基线**：查代码确认 3D 的 Esc 是**分级**的（`useKeyboardShortcuts.ts`：先撤进行中的创建/命令与指引，再关指引，最后才清空选择）。用例钉住最后一档的**不变量**：尘埃落定后属性栏不再编辑任何对象（`.inspector-selected-heading h3` 消失），而**对象行数一个不少** —— Esc 不是删除，Delete 才是。变异：把该档 `setSelectedIds([])` 改成 `deleteSelected()` → 红在行数断言。
- **一次假设出错并当场修正**：最初想用 `data-preview-face-count="6"` 证明"实体还在画布上"，实测拿到 **0** —— 那个属性数的是**交面预览**的虚面（模板实体下恒为 0），不是实体自己的六个面。改为 DOM 层面的"Esc 前后对象行数不变"，判据与语义都对得上。
- **如实标注**：这两条是**改造完成后补的对照回归**，不是改造前的基线。改造早已完成，"新增测试在改造前能验证旧行为"这一句已无法事后满足；计划 Task 1 表格行与两条勾选项都写明了这一点。
- 六条基线各自的落点已逐条记入计划：默认选择与 Alt 子图元在 `geometry3d.spec.ts` 自身，相机旋转在 `geometry3d-drag.spec.ts`，撤销在 drag/section/solid-prism，文档恢复在"打开图形后自动取景"与六类样题。
- 本批读数：`tsc -p e2e/tsconfig.json` exit 0；`eslint e2e/geometry3d.spec.ts` exit 0；`e2e/geometry3d.spec.ts` **24/24**；`spatialTools.test.ts` 16 + `threeScene.test.ts` 58 = **74/74**。**产品文件零改动**（`git diff --stat -- apps packages` 为空，两条变异均已恢复）。

## 2026-09-29 —— Task 5 清单收齐：从「选择工具」退出

- 实施计划 Task 5 那条"写失败 e2e"列的六件事，前五件与"步骤数明确"此前已各有覆盖，**只剩"从工具按钮可选『选择工具』退出"没有回归**。补上（`e2e/geometry3d-creation.spec.ts` 增至 9 项）。
- **先查代码再写用例**：这条**不需要新代码** —— `App.tsx` 的 `handleRibbonCommand` 对任何非 `draw-` 开头的命令统一先 `updateSpatialSession(null)` 再执行，`选择工具`（`ribbonCommands.ts` 的 `select-tool`）正好走这条。所以本批只补回归，没有产品改动。
- **用例判据**（不满足于"按钮点了没报错"）：绘制线段 → 点第一个锚点（`data-creation-anchors="1"`）→ 点「选择工具」→ 工具与锚点双双归零、对象行数仍为 0（未提交的锚点不落盘）→ **再点画布空白，仍然创建不出任何东西**（确认退出后回到的是"选择"语义，而不只是状态显示被清掉）。
- **变异检查**：把 `handleRibbonCommand` 里那句统一清会话改成"`select-tool` 时不清"，用例立刻红在 `data-creation-tool` 仍为 `segment3`。已恢复，`App.tsx` 与 HEAD **无差异**（`git diff --stat` 只有 spec 一个文件）。
- **六条子要求逐条复核后**才勾选计划项：① 选线段→提交 = 第 1 条用例，其中**第一点预览**由图元级单测 `threeCreationPreview.test.ts` 钉住（`segment3` + 1 已提交锚点 + 悬停点 → 折线 `[锚点, 悬停点]`，且会话对象未被改动）；② 空白落点/已有点引用 = XZ 用例；③ Esc 取消不改文档 = 第 2 条；④ 平面选择可见 = 工具条切 XZ 后落点 Y≈0、Z≈2；⑤ 选择工具退出 = 本批新增；⑥ 步骤数明确 = 第 1 条断言操作提示含"第 2"。
- 本批读数：`tsc -p e2e/tsconfig.json` exit 0；`eslint e2e/geometry3d-creation.spec.ts` exit 0；该 spec **9/9 通过**。**全库单测未复跑**：只改 `e2e/` 下的文件，而 `vitest.config.ts` 的 include 不含 `e2e/`。

## 2026-09-29 —— Task 5 收口：工作区切换取消 + 绘制优先于预览点击

- 实施计划 Task 5 第 2 项的最后两件没被钉住的事（悬停读数在上一节、模式切换取消由既有「互斥」用例覆盖）。两条都**先查代码确认已实现**，再补回归；该计划项至此可如实勾选。
- **切换工作区取消未提交状态**（`App.tsx` 的 `handleWorkspaceChange` 有 `updateSpatialSession(null)`）：用例 → 绘制线段 → 点第一个锚点后断言**未提交的第一步不落盘**（对象行数仍为 0）→ 切到平面几何再切回 → 工具退出、锚点归零、对象行数仍为 0。变异（摘掉那句清会话）当场红。
- **创建会话优先于预览点击**：指针压在交面预览上点一下，落地的必须是**空间点**、不能多出交面图元，且预览不被这一下消耗（夹具 `overlapping-cubes.mgeo`，配方同 `three-intersection-previews.spec.ts`）。
- **证伪花了三次，过程本身有价值**：① 只摘抬手的 `stopPropagation` → 仍绿；② 两处 `stopPropagation` 都摘 → 仍绿，而排查读数 `point|point3-1|precise|hover|front` 说明交互层确实看到了这次抬手，只是它自己的"点/棱优先于创建"规则让预览输了；③ 再把"预览总是赢"（`previewBeatsPick` 恒真）也打破 → 用例红，如实报出多出一个 `intersectionFace`。**结论：这条优先级有两层独立守卫**（组件捕获阶段拦截 + 拾取层的点/棱优先规则），只破一层不足以让它失效。三次变异全部恢复，三个产品文件与 HEAD **无差异**。
- 本批读数：`eslint` 该文件 exit 0；`tsc -p e2e/tsconfig.json` exit 0；该 spec **8/8 通过**（新增两条）。**全库单测未复跑**：只改 e2e 文件，`vitest.config.ts` 的 include 不含 `e2e/`。

## 2026-09-29 —— Task 5 补充：3D 绘制时的悬停读数（含一处"说一套做一套"的修正）

- 实施计划 Task 5 那条"**悬停辅助标记展示目标、世界坐标与工作平面，不渲染为持久图元**"里，**读数**部分落地（可视辅助——虚线引导 + 小球标记——此前已有）。做法沿用 2D 画布的既有形状：画布上一个只读小条 `[data-creation-readout]`（与 `data-coordinate-readout` 同款），全程不写文档。
- 新纯函数 `apps/web/src/creationHoverReadout.ts`：一个字符串说清三件事 —— 吸附到了什么（已有点 / 棱·线 / 面 / 工作平面）、世界坐标（两位小数）、落在哪张工作平面上。**吸附到对象时不提工作平面**：位置由那个对象决定，再说一句会让人以为它参与了定位；被拒绝时如实给原因。
- 接线走最小改动：`previewCreationAt` 由 `void` 改为**返回拾取结果**，`threeScene.tsx` 自己格式化（不必新增 ref/prop）；指针离开画布、切换工作平面时清掉读数。
- **顺带修掉一处"说一套做一套"**：吸附到已有点时，落点原来取的是**射线命中点**（点手柄球面上的一点，默认相机下实测 `(0.04, 0.04, 0.04)`），而创建出来的图元引用的又是那个点本身 —— 读数因此显示一个**不是那个点坐标**的数字。现在直接换成该点自己的坐标（预览标记也随之更准）。`resolveSpatialAnchor` 那一层不动：它只按命中物回答，不认识文档。
- 本批读数：`npm run typecheck` exit 0；`npm run lint` 0 error / 13 warning；全库单测 **266 文件 / 3066 项通过 + 1 todo / 0 失败**（248 s）；`e2e/geometry3d-creation.spec.ts` **6/6 通过**。变异检查（让读数不再区分吸附目标）精确抓红两条用例、另两条保持绿。

## 2026-09-29 —— 更正："改不动顶点"不是静默丢弃，而是被共面校验拒绝

- **要更正的是我自己的记录**：本文件同日「Task 6 补充」一节把"属性栏改棱柱顶点坐标"记成**静默丢弃（无任何提示）**。本轮走 UI 的真实路径（`commitPatch` —— `store.apply` 调的就是它）复核，那条**不准确**。
- **实测（两条独立证据）**：
  - 单测：`commitPatch(prism, patchPoint3("solid-1:v6", { x: 0, y: 0, z: 9 }))` → `changed=false`，`error = "the change would make the document invalid: face3 points are not coplanar…"`，文档一个字节都没动。
  - 浏览器（一次性探针，用完即删）：改坐标后输入框弹回原值，同时页面**确实有** `role="alert"`，文案就是这一句。
- **根因**：棱柱（与模板实体一样）的侧面是**四边形**；改一个顶点会让相邻三个面立刻不共面，而文档校验器要求 `face3` 的点共面 → **校验层**把整笔退回。存储层本身支持（`apply.ts` 会把描述翻成 `fromFaces` 再写顶点），它先过不了校验层 —— "存储层能改"不等于"属性栏能改"。
- **另一条现象很可能同源**：拖顶点手柄后 Ctrl+Z 被拒，报的是**同一条**信息（推断：那次拖动被拒、没有历史，于是 Ctrl+Z 撤掉了"创建棱柱"这一步，画面变空、`data-content-bounds` 读出 NaN）。**推断未逐条验证，已如实标注**。
- 新增**表征用例**（`scene-store.test.ts`）：钉住"被拒 + 明确原因 + 文档未变"。它不把"改不动"当成正确行为 —— 哪天真的能改，它会红，提醒改的人同时更新缺口记录与告警文案。
- **仍未修**（属产品决定）：给用户一条能改单顶点的路径（把受影响的面拆成三角形，或放宽共面要求）。
- 本批读数：`eslint` 该文件 exit 0；`npm run typecheck` exit 0；`scene-store.test.ts` **103/103**；全库单测 **265 文件 / 3062 项通过 + 1 todo / 0 失败**（277 s）；`npm run lint` 0 error / 13 warning。

## 2026-09-29 —— Task 7 补充：旋转视角后顶点标签仍逐点对齐

- 实施计划 Task 7 的最后一个未勾选项落地。前两条（教学虚线存/取仍是虚线、切换"隐藏边"只改显示层）已由 `threeTeachingLines.test.ts` 的既有用例覆盖并在本批复跑确认；**第三条此前没有覆盖**。
- 新增用例（`e2e/geometry3d-teaching-lines.spec.ts`，该 spec 增至 2 项）不满足于"标签还在画面上"，而是**逐点对齐**：钉住立方体原点 `(-2,-2,-2)`（4×4×4 ⇒ 八个顶点都是 `[-2,2]³` 的角，这条当前置条件先断言），再对每个 `[data-point-id]` 断言其锚点等于**它自己那个顶点**的投影 —— 期望值按 `pointLabels.ts` 的规则算（`left = (ndcX·0.5+0.5)·宽 + 10`、`top = (−ndcY·0.5+0.5)·高 − 10`），容差 2px；旋转前后各查一遍，并用 `data-camera-azimuth` 确认**真的转了**（否则这条会空过）。
- **变异检查**：把 `pointLabels.ts` 的横向偏移 `+10` 改成 `+60`，用例立刻报 **50px** 偏差（= 60−10）；变异已恢复，产品文件与 HEAD **无差异**。
- **顺带查实一条行为（已记入 `docs/current-status.md` 的如实缺口）**：**指针抬起前的最后一次相机移动不会触发渲染** —— 拖动结束后标签（连同画面）停在上一帧的相机状态，与当前相机读数差约 **30px**，且**不会自行收敛**（轮询 5 秒仍不齐），要等下一次交互才追平。用例因此在拖动后再抖 2px 强制重画一帧，才断言"已对齐的最终状态"。
- 本批读数：`eslint` 该文件 exit 0；`tsc -p e2e/tsconfig.json` exit 0；该 spec **2/2 通过**。**全库单测未复跑**：只改 e2e 文件，`vitest.config.ts` 的 include 不含 `e2e/`。

## 2026-09-29 —— 功能目录收口（Task 8 第 4 项）

- `docs/feature-catalog.md` 新增「**本期收口（2026-09-29）：实际已完成 / 未完成**」一节，放在「当前已实现」与「下一阶段功能」之间，回答"本期到底交付了什么、什么没有"：
  - **已交付**（每条都能指到当次测试证据）：立体画布直接绘制（P0）、常用立体参数面板（P1）、立体教学线型（P1）、截面与解析圆锥曲线读数（A1）、六类高中代表题的可重放验收（`e2e/high-school-geometry-tasks.spec.ts`，7 项）、两处缺陷修复。
  - **未交付、需要你决定是否启动**：① 球体与球截面（P2 独立评审；现有"外接球 / 内切球读数"**不是**球图元）；② 题目截图 → 可编辑数学图（独立质量门禁，当前发布门禁不允许宣称"一键生成"）；③ HTML / GeoGebra 导出（已交付的导出是 `.mgeo` / SVG / CSV / PNG 与工程图的 SVG / DXF / PDF）；④ 平面 / 函数题型逐题补缺；⑤ 教师 / 学生走查与完整桌面打包。
  - **已知但未修的缺陷**三条（锁定对象仍可拾取；棱柱"移动顶点"两条路都不通；实体源测量没有画布数字）。
- 同时修掉 `docs/current-status.md` 里两处**已经过时**的表述：第 59 行还把"六类教学样题的组合验收"列为未完成（Task 8 第 1 项已勾选），第 60 行还写着"`docs/feature-catalog.md` 收口还没做"。
- 本批只改文档（`docs/feature-catalog.md`、`docs/current-status.md`），**未跑** lint / 单测 / 构建：这里没有可执行产物；口径以当次已记录的读数为准。

## 2026-09-29 —— Task 4 补充：画布新建的空间图元也有 `.mgeo` 往返用例

- 计划 Task 4 的待办落地：**一步撤销**由既有用例覆盖（`spatialCreationCommands.test.ts` 的 "undoes the whole drawing gesture in one step through the real scene store"，本次复跑确认）；**保存/加载往返此前没有覆盖** —— `mgeoRoundTrip.test.ts` 原有 4 条只测工作台文档、绑定动点、点集多面体与双曲线绑定，**没有一条**测本期新加的"在 3D 画布上按步骤落点建图元"。本批补上第 5 条。
- 新用例走真实入口（`commitSpatialCreation` + `applyOperation`，与 App 落盘同一条路）：画线段 / 直线 / 面 → `recomputeDerivedObjects` → `encodeMgeo` → `decodeMgeo`，断言：
  - 图元数量与 id 集合不变（7 点 / 1 段 / 1 线 / 1 面，id 无重复）；
  - **依赖仍然指着存在的点** —— 线段 `pointIds`、直线 `definition.pointIds`、面 `pointIds` **各查一遍**（只查一条会漏掉另一种引用写法）；
  - 几何逐值不变；
  - **重开之后还能用**：在重开出来的文档上再画一条线段引用旧点，必须**复用**那个点（只新造另一个点）—— 沿用本文件"光断言字段还在不够"的惯例。
- **变异检查**：把 `commitSpatialCreation` 的复用分支禁掉后，只有这条新用例变红、其余 4 条保持绿；变异已恢复，`spatialCreationCommands.ts` 与 HEAD **无差异**。
- 顺带记一笔类型摩擦（**不是缺陷**）：`SpatialAnchor.position` 在类型上必填，而复用分支并不读它；用例给的是那个点自己的坐标，不是随手编的假值。
- 本批读数：`npm run typecheck` exit 0；`npm run lint` 0 error / 13 warning；全库单测 **265 文件 / 3061 项通过 + 1 todo / 0 失败**（277 s）；聚焦三文件 18/18。

## 2026-09-29 —— Task 6 补充：棱柱的量测与保存/恢复（"移动顶点"未落地）

- 计划 Task 6 的补充验收里，**量测 + 保存/恢复**落地（`e2e/solid-prism.spec.ts` 由 5 项增至 **6 项**，6/6 通过）：
  - **量测**：底面 4×4、垂直高 3 ⇒ **体积 48**（斜棱柱体积只取决于底面积与垂直高，与斜度无关 —— 同时验证"按向量拉伸"没把体积算错）。读数断言落在**属性栏的测量卡片**上。
  - **保存/恢复**：走页面自己的「保存 .mgeo」产物，核对棱柱以 `construction.kind === "prism"` 落盘、共 8 个顶点、**顶面四点 = 底面四点各加拉伸向量 `(1, 0.5, 3)`**；重新打开后包围盒与保存前**逐字一致**。
- **"移动顶点"这一半没有落地**（计划里该项保持未勾选）。探测过程查出两条实测记录：
  1. **属性栏改棱柱顶点坐标被静默丢弃**：输入框弹回原值、文档不变、**没有任何提示**。模板实体那条"按数值改顶点即翻成 `fromFaces`"的路径没有给棱柱这一支，而棱柱是**构造驱动**的（`base`+`vector` 是真源，8 个顶点只是缓存，见 `packages/dsl/src/types.ts`）。
  2. **拖顶点手柄后 Ctrl+Z 被校验拒绝**：`data-drag-target` 读到**不是**实体；随后撤销时报 `the change would make the document invalid: face3 points are not coplanar`。而从**实体中心**拖动那条既有用例撤销是好的 —— 差别就在抓取点。
- 两条都写进 `docs/current-status.md` 的如实缺口，**没有**在用例里把失败交互钉成"预期行为"；一度写出来的顶点拖拽用例**整条撤掉**（与既有"从中心拖动"重复，且期望值无法诚实钉住）。
- 顺带记一条读数缺口：`measurementVisuals.ts` 的 `pointPositions` **没有 `polyhedron3` 分支**，所以实体源（如体积）的测量**在画布上没有数字**，只能去属性栏读。
- 本批读数：`eslint` 该文件 exit 0；`tsc -p e2e/tsconfig.json` exit 0；该 spec **6/6 通过**。**全库单测未复跑**：只改 e2e 文件，`vitest.config.ts` 的 include 不含 `e2e/`。

## 2026-09-29 —— Task 3 补充：spatialPick 的四条边界用例

- 计划 Task 3 的第二条未勾选项落地：`apps/web/src/spatialPick.test.ts` 从 7 项增至 **11 项**，四条新用例各钉一条真性质：
  - **相机斜视**：斜射线落点精确等于射线与工作平面的交点（`z=0` → `(10,10,0)`；`z=3` 的已选面 → `(7,7,3)`）。
  - **面背侧**：命中点在工作平面**后面**时，落点是命中点本身 `(1,2,-4)`，**不是**该射线与 `z=0` 的交点 `(2,3,0)` —— 命中优先且不替用户猜深度。
  - **距离容差**：`1e-8` 阈值两侧都钉住 —— `1e-9` 如实拒绝；`1e-6` 接受、落点仍在平面上（`y=0`）但 `x > 1e5`，那个"远得离谱"正是阈值存在的理由。
  - **重叠点**：坐标完全重合的两个点，"复用哪一个"只由**命中**决定（回 `point-2` 的 id），不按坐标反查。
- **变异检查**：三次定向变异各自抓红对应用例、其余保持绿 —— 阈值 `1e-8`→`1e-12` 抓红容差用例；让"命中优先"失效抓红背侧与重叠点用例；交点参数减半抓红斜视用例。每次变异后都已恢复，`spatialPick.ts` 与 HEAD **无差异**（已核对）。
- **顺带核对计划同一条里的"隐藏或锁定对象不被当作可吸附目标"**：**隐藏**这一半成立且是构造性的（`threeSceneContent.ts` 先 `filter(isUserVisiblePrimitive)` 再建对象，隐藏图元根本不进场景）；**锁定**那一半不成立（该判据只看 `visible` 与 `tessellation`）。已记入 `docs/current-status.md` 的如实缺口，留作产品判断。
- 本批读数：`npm run typecheck` exit 0；`npm run lint` 0 error / 13 warning；该文件 **11/11** 通过。**全库单测未复跑**：本批只加测试文件、不涉及产品代码。

## 2026-09-29 —— 修复：「距离」测量不再依赖选择顺序

- **缺陷**（2026-09-29 查实）：属性栏只要"1 个空间点 + 1 个空间平面"就给出「距离」按钮，**与点击顺序无关**（`spatialTools.measurementOptionsFor`）；而内核 `evaluateMeasurement3` 的 distance 分支固定按 `sourceIds[0]` 是点、`[1]` 是平面/直线取数（`pointFromPrimitive` 对 `plane3` 返回 `null`）。于是**先点平面、再选点**会落到"距离需要两个空间点"的兜底：按钮可点、面板无数字、画布不出标签。
- **修法**：在 distance 分支开头把"点那一侧"换到前面（只在 `sources[0]` 不是点、`sources[1]` 是点时才换），取数与说明文案都用交换后的那一对；`measurement.sourceIds` 记的仍是**用户的选择顺序**。三种组合一起受益：点 + 平面(`pointNormal`)、点 + 平面(`throughPoints`)、点 + 直线。
- **TDD 证据（红 → 绿）**：内核新用例 `measurements3d.test.ts` 的 "measures a point-to-plane distance whichever of the two was selected first" 修复前红（plane-first 得到 `insufficient-data`、`value` 为 `undefined`），修复后绿（该文件 10/10）；浏览器侧回归（`e2e/high-school-geometry-tasks.spec.ts` 的线面关系用例）改成**两种顺序都必须量出 3.000u** —— 修复前"平面先选"画布上没有标签（`data-measurement-labels` = 0），修复后两种顺序都绿。说明文案也钉住了：必须写"由点 p 到平面 plane"，不能因为交换而说反。
- 本批读数：全库单测 **265 文件 / 3056 项通过 + 1 todo / 0 失败**（278 s；比上批多 1 项 = 新增的内核用例）；`npm run typecheck` exit 0；`npm run lint` 0 error / 13 warning（基线未变）；`npm --workspace @draw/web run build` exit 0；e2e 该文件 7/7 通过。

## 2026-09-29 —— 修复：恢复草稿后第一次改动不落盘（会丢用户数据）

- **缺陷**（2026-09-29 查实）：页面加载恢复草稿后，用户的**第一次改动不会写进草稿**。真机实测：刷新后加一个立方体 → 对象列表出现「立方体 1」，而 `mathcanvas:draft:geometry3d` 仍是 84 个 id；再加第二个才一次跳到 140。后果：刷新后只改一次就关页面，那次改动从 localStorage 草稿里丢失（桌面仓储那一份也在同一个 `return` 之后，一起被跳过）。
- **根因**：`apps/web/src/useDraftPersistence.ts` 自动保存里 `skipNextDraftSaveRef`（本意"刚恢复的内容不要立刻回写"）与 `restoreSettledRef` 的**判断顺序**错了。恢复那一侧先置 skip 再 `replace(...)`，而 settled 是在 restore 那个 promise 的 `.finally()` 里置位 —— 两者赛跑；恢复自身那次变化触发的 effect 若先跑，就在"还没 settled"那一步直接 return、**没有消费 skip**，这支"跳过"最终被用户恢复后的第一次改动吃掉。
- **修法**：把 skip 的消费移到 settled 判断**之前**（一行顺序调换）。不会变松：恢复**自身**那次变化消费掉 skip，用户的第一次改动照常写；"恢复没结束就一个字都不写"这条守卫仍在（skip 为假时依然先看 settled）。
- **回归测试钉在浏览器侧**（`e2e/high-school-geometry-tasks.spec.ts` 的旧文档用例）：刷新恢复后**第一次**改动必须写回草稿。它在本修复前是红的（Expected 112 / Received 84），修复后转绿 —— 所以这条回归确实抓得住。为什么不是单测：真机顺序是 React 调度与 promise `.finally` 的赛跑，而 `useDraftPersistence.test.tsx` 的 harness 里 `rerender` 发生在 `await` 之后、复现不出这条缝（那 9 条单测钉的是**语义**，本修复前后都绿，已复跑确认）。
- 本批读数：`npm run typecheck` exit 0；`npm run lint` 0 error / 13 warning；`npm test -- --maxWorkers=3` **265 文件 / 3055 项通过 + 1 todo / 0 失败**（280 s）；`npm --workspace @draw/web run build` exit 0；e2e 该文件 7/7 通过。

## 2026-09-29 —— Task 8 第三批：已有文档恢复与撤销（六类代表题齐了）

- 第三批落地第六类「已有文档恢复与撤销」，`e2e/high-school-geometry-tasks.spec.ts` 增至 **7 项**，六类代表题**全部覆盖**。
- 判据走两条真链路（夹具 `overlapping-cubes.mgeo`：**只有模板实体、没有拓扑**的三只立方体）：
  - **迁移**：打开后 `migrateLegacySolids` 物化子对象；夹具自己的图元**按原序在前**、子对象追加在后；总数 = 3 + 3×27（8 点 + 12 棱 + 6 面 + 1 多面体）。
  - **几何不变**：三只立方体的 `origin`/`size` 逐值不变；物化出来的拓扑按产品**自己**判定"已物化"的 `construction = { kind: "template", sourceIds: [模板 id] }` 认领来源，并核对每只 8 个顶点、包围盒恰为 `origin..origin+4`。
  - **恢复**：刷新后草稿仍在 localStorage、应用把它装回文档、**id 列表逐项相同**（把已物化的拓扑再迁一遍就会多出一套子对象，这条能抓住）。
  - **撤销**：加载旧文档后新建一个立方体再撤销，对象列表回到"只有旧文档"（含拓扑行），落库草稿也回到刷新前那一份。
- **变异检查**：把 `cube-far` 的期望原点改成 15 → 用例当场红（Expected 15 / Received 14）。
- **顺带查实第二处真缺陷（已记档、未修）**：**页面加载恢复草稿后，用户的第一次改动不会写进草稿**。实测：刷新后加一个立方体 → 对象列表出现「立方体 1」，而 `mathcanvas:draft:geometry3d` 仍是 84 个 id；再加第二个 → 草稿一次跳到 140（两次一起补上）。机制：`useDraftPersistence.ts` 的 `skipNextDraftSaveRef`（本意"刚恢复的内容不要立刻回写"）被**用户那次改动**吃掉，而不是被恢复自身那次变化吃掉。后果：刷新后只改一次就关页面，那次改动从草稿里丢失。用例没有把这条有缺陷的通道当观测口径，缺陷另见 `docs/current-status.md` 的如实缺口。
- **Task 8 第 2 项的门禁本轮补齐**（当次复跑）：`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**、`npm test -- --maxWorkers=3` **265 文件 / 3055 项通过 + 1 todo / 0 失败**（202 s）、`npm --workspace @draw/web run build` exit 0（入口 1 694.22 kB，与既有读数一致 —— 本批只改 e2e）。
- **仍未做**：全量 `npm run test:e2e`（只跑了本文件 7 项）；完整 `npm run build`（含桌面 Rust 打包）；教师/学生走查；`docs/feature-catalog.md` 的"已完成 / 未完成"收口。

## 2026-09-29 —— Task 8 第二批：圆锥截面与空间直线和平面的关系

Task 8 第二批落两类样题（六类累计五类）：**圆锥截面**与**空间直线与平面的关系**。判据全部取"算得出来的数"。

- **圆锥截面**按解析读数核对（`conicMetrics.ts`）：默认圆锥 `tanα = 1.5/3`，剖切面法向与锥轴夹角 θ ⇒ `e = sinθ / cosα`。水平切（默认刀口 z = 1.5）半径由 `r(z) = 1.5·(1 − z/3)` 算出 = 0.750、离心率 0、面积给闭式 `πr²` 且与半径自洽；绕 Y 转 60°（β = 30° > α）⇒ 椭圆，e ≈ 0.968；再转 15°（β = 15° < α）⇒ **双曲线**，e ≈ 1.080 —— 圆柱永远切不出这个结论，所以它是锥特有的判据。
- **变异检查**：把锥半径写成 2.0，期望半径算成 1.000，而应用报 **0.750** —— 断言非空，并反证默认刀口在 z = 1.5。
- 一步撤销：旋转走 `rotateSectionPlane`（**文档编辑**），退一步从双曲线回到椭圆，而不是把截面整块删掉。
- **空间直线与平面的关系**由**平面方程**判定：`plane3` 并不存法向，所以法向与常数在测试里由三点叉积独立算出。面内直线满足 `n·d ≈ 0` 且 `n·P + c ≈ 0`；平行不共面的那条 `n·d ≈ 0` 但偏移 = 3。两条线一起断言，才能把这两种关系区分开。产品自身的读数也测到了：点 F 到平面 z=0 的「距离」= **3.000u**，对象列表里该测量 `data-status=valid`。
- **顺带查实一处真缺陷（已记入 `docs/current-status.md` 的如实缺口，本批只记档不修）**：`spatialTools.measurementOptionsFor` 只要"1 个空间点 + 1 个空间平面"就提供「距离」，但内核 `evaluateMeasurement3` 的 distance 分支要求 `sourceIds[0]` 是点、`[1]` 是平面（`pointFromPrimitive` 对 `plane3` 返回 null）。**平面选在前**时按钮照样出现，却只得到一条 `invalid` 读数、画布不出数字。用例按可用顺序断言，没有把错误行为当正确行为钉住。
- 本批读数：该文件 **6/6 通过**（`e2e/high-school-geometry-tasks.spec.ts`）；`tsc -p e2e/tsconfig.json` exit 0；`eslint` 该文件 exit 0；全仓 lint **0 error / 13 warning**（基线未变）。**单测未复跑**：`vitest.config.ts` 的 `include` 不含 `e2e/`，本批只改 e2e 文件、不涉及产品代码。
- **未做**：第六类「已有文档恢复与撤销」；全量 `npm run test:e2e`；教师/学生走查；桌面打包。

## 2026-09-29 —— Task 8 第一批：四类立体样题的精确几何验收

Task 8（六类代表题整合验收）**分批落地**，本批先落四类：三棱锥、四棱锥、斜三棱柱、异长长方体。新增 `e2e/high-school-geometry-tasks.spec.ts`，每题断言类型与名称、**精确几何**、拓扑依赖、保存与一步撤销；期望值按 `spatialSolidWizardModel` 的口径独立算出，不照抄界面读数。

- 几何判据举例：三棱锥顶点 `(3,0,±5)`、四棱锥顶点 `(3,0.5,±5)`、斜三棱柱每个底点 `+(1,-2,5)`；保存断言走页面自己的「保存 .mgeo」下载产物，再重新打开核对顶点集合**逐点一致**。高度取绝对值：底面法向朝上/朝下由 `planeThroughPoints` 的定向决定，两种都是同一个棱锥，不算数学判据。
- **变异检查（证明断言非空）**：把顶点 x 的期望值改成 4，用例当场红（Expected 4 / Received 3）。
- 记下一处真实的结构差异：模板实体（立方体）的展开按钮是「展开 X **拓扑** 的子对象」，多面体实体（棱柱/棱锥）是「展开 X 的子对象」；用例按实际结构断言，并把差异写进注释。
- 本批复跑读数：全库单测 **265 文件 / 3055 项通过 + 1 todo / 0 失败**（236 s）、`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**（基线未变）、本文件 4/4 通过、e2e 的 `tsc -p e2e/tsconfig.json` exit 0（Web 构建由 e2e 的 `globalSetup` 现场执行）。
- **未做（不得读成六题验收完成）**：圆锥截面、空间直线与平面的关系、已有文档恢复与撤销三类样题；全量 `npm run test:e2e`；教师/学生走查；桌面打包。

## 2026-09-29 —— 高中数学立体绘图交互（功能分支，尚未发布）

- 立体工作区增加按步骤在画布放点并创建空间线段/直线/射线/平面/面的流程；新增 XY/XZ/YZ/已选面工作平面、暂态预览、取消与一步撤销，保留原有先选点后建图元的高级入口。
- 「常用立体」面板新增正方体、长方体、三/四棱柱（含倾斜）、三/四棱锥参数输入与**未保存**预览；确认后整族图元一次写入文档。原「添加立方体」新建默认边长更正为 `4×4×4`，旧 `.mgeo` 对象不改尺寸。
- 空间直线、线段、射线、棱的「教学线型」可保存实线/虚线/点线；Three.js 线材质使用线距离；教师手动线型独立于仅影响视图的「隐藏边」开关。修正两条仍按旧 `4×4×2` 断言截面与体内点范围的单测。
- 本批功能在 `feat/high-school-geometry-interaction` 分支，**不等同已发布的 v3.0 安装包**；通过全库单测 265 文件/3055 项（1 todo）、类型检查、lint 0 错/13 条既有警告、Web 构建，以及选定 7 个 3D e2e spec 的 44 项。完整 e2e、Rust 测试和新桌面打包本轮未完成。后续任务见 [实施计划](docs/superpowers/plans/2026-09-29-high-school-geometry-interaction-implementation-plan.md)。

## 2026-09-29 —— 发布 v3.0（带 typed tool loop 的桌面版）

版本号从 `0.2.0` 跳到 `3.0.0`（**项目自己的版本策略**，不是 semver 意义上的破坏性变更；tag 用 `v3.0`）。打包器里的版本必须是合法 semver，所以文件与安装包写 `3.0.0`，Release 标签写 `v3.0`。

- 改 `apps/desktop/src-tauri/tauri.conf.json` 与 `Cargo.toml` 的 version 为 `3.0.0`（`Cargo.lock` 由 cargo 自动跟进）。
- 重新打包，产出：免安装 `mathcanvas-desktop.exe`（16.38 MB）、NSIS `MathCanvas_3.0.0_x64-setup.exe`（4.79 MB）、MSI `MathCanvas_3.0.0_x64_en-US.msi`（6.52 MB）。**exe 内嵌版本经 Windows 文件属性核实为 `3.0.0`**。
- 发布说明见 [`docs/release/v3.0.md`](docs/release/v3.0.md)（含三个产物的 SHA-256、实测读数、以及**六条如实缺口**）。
- **如实**：两个安装包只验证了**构建成功**，没有在本机实际安装过；免安装 exe 在本机启动、渲染，并跑过真实 provider 链路。

## 2026-09-29 —— 第四十七批：Agent typed tool loop 六阶段收口（含真实 provider 实跑）

计划的六项未完成项逐项落地或**书面暂缓**，没有一项是静默缺失的。详细过程与逐条证据见 [`docs/research/2026-09-28-agent-tool-loop-progress.md`](docs/research/2026-09-28-agent-tool-loop-progress.md)，放行判据见 [`docs/acceptance/agent-release-gate.md`](docs/acceptance/agent-release-gate.md)。

- **Phase 1（阶段门槛达成）**：字段形状的真源从 `actionSchemas.ts` 的私有集合搬进 `actionRegistry`（`FIELD_KINDS` + 逐动作**必填**的 `rawFieldTypes`，拿到编译期保证）；`DISPATCHABLE_TOOL_IDS` 不再手抄，改为从 `readToolSchemas.toolInputs` **推导**。"工具目录 = schema = dispatcher" 两个方向都有测试守住。
- **Phase 2（判据完成，剩余按决策暂缓）**：多轮循环的额度判据抽成纯函数 `toolLoop.ts`；`draft.verify` 契约落地（结论取自 `verificationGate`，模型不能自选验证对象）。**模型面草稿工具按决策暂缓**，见 [`docs/decisions/2026-09-29-agent-phase2-draft-tools.md`](docs/decisions/2026-09-29-agent-phase2-draft-tools.md)：模型看不见草稿，现在启用会变成**盲验**。
- **Phase 3（完成且在生产中生效）**：完整判据链 —— `deriveAcceptance`（用户原话 → 验收条件）→ `taskAcceptance`（条件 → 报告）→ `verificationGate`（报告算不算证据）→ **协调器在 `validating` 之后拦截**。报告不构成证据时进不了确认面板。判题器新增截面/关系判据，**8 条代表任务里 7 条可判定**。
- **Phase 4（本地判据可判定）**：纯本地布局诊断（`renderEvidence.ts` + `layoutModel.ts`，不需 provider vision），`visual-fit-drawn` 靠它通过；标签叠加这半条接到真实投影。live 截图路径未接线。
- **Phase 5（已决策）**：Agent Worker 入口**明确禁用**（`AGENT_WORKER_READY` 从 `true` 改为 `false`——它原本与"只会回 `agent.unavailable`"自相矛盾），见 [`docs/decisions/2026-09-28-agent-worker-strategy.md`](docs/decisions/2026-09-28-agent-worker-strategy.md)。
- **Phase 6（除真实读数外完成）**：新增 `npm run eval:agent`；运行账本记录四个版本号与结构化工具痕迹（**痕迹也落库**，两个摘要走同一把脱敏尺子）；发布门禁文档 + 机器判据 + CI 接线。**离线 pass@1 = 4/8**（模式 `deterministic_local`，**不是模型准确率**）。
- **Review 修复（两处严重缺陷）**：`modelPlanner` 的只读工具批次改为**一趟判完、再原子执行**。修复前：①与只读调用同批到达的合法计划被**静默丢弃**（实测第一轮的计划无声消失、最终采用第二轮重发的）；②批次非原子（9 调的批次在执行 **4 个之后**才抛错，模型付了钱看不到结果）。现在任一调用不是已发布的只读工具即**整批显式拒绝、0 执行**，且所有判据都在第一个 `await` 之前跑完。
- **真实 provider 实跑（2026-09-29）**：用项目自己的 planner（真实提示词、动作登记表、原生工具通道），只把传输换成直连 DeepSeek（`deepseek-chat`，`tools` 能力已验证），喂一道椭圆题："中心在原点、焦点在 x 轴、过 P(2,1)、离心率 √2/2，求标准方程"。**模型自己推出 `x²/6+y²/3=1` 并给出两个动作**（建椭圆 + 标点 P），2.3 秒一轮完成；传输日志 `tools=5` 正是模型面那 5 个工具。**如实缺口**：单题不构成 pass@1；场景未接，多轮观察循环未被压到；`deriveAcceptance` 对圆锥曲线返回空（形状表里没有椭圆/抛物线/双曲线），所以这次运行的完成门禁仍是惰性的。
- **门禁**：`npm run typecheck` exit 0；`npx vitest run` **257 文件 / 3010 用例 + 1 todo / 0 失败**；`npm run test:rust` **242 例 + 3 ignored / 0 失败**；`npm run lint` 0 error / 13 warning（基线）。

## 2026-09-26 —— 第四十六批：修两处**现场故障**（"把正方体沿对角面剖开，标出截面"连挂两次）

这不是重构，是用户在**装好的桌面版里**连着碰到的两次失败。两处都在"Agent 说的话编译器没接住"，症状却完全不同 —— 一次报"找不到对象"，一次报"截面平面非法"。分开记。

### 故障一：同一份计划里刚建出来的对象，后一步引用不到（`target_not_found: no object cube`）

用户那句话，规划器给的是三步：建正方体 → 建截面 → 标出截面。后两步把前一步刚建的对象写成了**场景引用 / 裸名字**（`cube`、`diagSection`），而别名表只认 `{scope:"draft", alias:"cube"}` 那种显式草稿引用 —— 整轮死在 `compile_failed: target_not_found … no object cube`，第 2、3 步接着报 `no object diagSection`（级联，两个诊断其实是一个原因）。

判据本身没有歧义：**别名表里只有"这一份计划里、这一步之前"已经建出来的对象**，命中就是那个刚建的对象，不可能是别的。所以 `planCompiler.resolveReferences` 的两条分支（裸字符串 / 场景作用域）都改成：先按别名查，查不到再报 `target_not_found`。宽容是有边界的 ——

- **编造的 id 依旧被拒**（`section("nowhere")` 仍报 `target_not_found`）；
- **形状错误的引用仍在传输层就被拒**：`sourceId` 收的是裸 id 字符串，喂 `{documentId, entityId}` 这种对象形状报 `invalid_type`、路径落在 `envelope.actions[1].inputs.sourceId`，而不是拖到引用解析时变成一句"找不到对象"（两种失败的性质完全两样，混起来排障会走错方向）。

三条都钉进了 `planCompiler.test.ts`。

### 故障二：登记表承诺的"过三个点"，这一层根本没实现（`section plane is invalid`）

第一处修完，同一句话在第二批上又挂了，换了一个症状：

```
commit_rejected: action_compile: envelope.actions[1]: operation 0: section plane is invalid
   （随后级联 target_not_found … no object sec1）
```

根因在**两处口径不一致**。`actionRegistry` 里 `section.create` 把 `plane` 登记成可选 + 默认策略 `ask_user`，而那句默认问题**明确承诺了两种写法**："截面用哪个平面？给法向与常数，**或者说明它过哪三个点**。" 可 `actionInputs.parseActionInputs` 里**没有 `section.create` 分支** —— `plane` 走默认分支原样透传，"过三个点"那种写法（也就是"沿对角面剖开"最自然的写法）一路走到**文档校验器**才被拒（`packages/dsl/src/schema.ts` 只认 `{normal, constant}`）。更要命的是它报的是**动作级**路径（`envelope.actions[1]`），于是那条"一次性修复"够不到字段、改不动它 —— 用户看到的就只有一句"编译失败"。

修法：`actionInputs.ts` 补 `section.create` 分支 + `normalizeSectionPlane`，把**三种写法收成一种**（单位法向 + 常数）：

- 规范形 `{normal, constant}`；法向不是单位向量则归一化，**常数同步缩放**（`n·x + c = 0` 两边同除 `|n|`）—— 只归一化法向、常数不动，平面就被换掉了，在立方体上正好表现为"切歪"；
- **过三点** `{points: […3]}`（`throughPoints` 也收）：叉积求法向，常数由第一个点定；
- **点 + 法向** `{point, normal}`（`origin` 也收）；
- 坐标两种写法都收（`{x,y,z}` 与 `[x,y,z]`）—— 模型两种都会写。

失败时**错误路径落在字段上**（`action.inputs.plane` / `…plane.normal`），码是 `invalid_plane` / `degenerate_plane`（三点共线）—— 这样那条一次性修复才够得到它。

同批把 `sourceId` 的判据一并收进这个分支（裸 id 字符串，非字符串报 `invalid_type`）—— 它原先靠默认分支兜着，新分支一写就容易顺手丢掉。

`plane` **缺省仍旧放行**：它登记了 `ask_user`，由审计去问用户（`planCompiler.test.ts` 与 `parameterAudit.test.ts` 都钉着"缺平面 → `questions` 里出现 `envelope.actions[0].inputs.plane`"）。在传输层替用户挑一个平面，等于替他改题。

### 验收

`npm run typecheck` exit 0（含 `e2e/`、`scripts/` 三段）；`npm run lint` **0 error / 13 warning**；`npm test` **238 文件 / 2812 用例**通过 + 1 todo（新增 1 条平面归一化用例）；`npx playwright test` **141 用例全绿**；`npm run build` exit 0（web 产物 + 桌面外壳 `mathcanvas-desktop.exe` 16.34 MB，重建于 12:11）。

**实机复核做到哪一步（如实划界）**：桌面版**已重新构建并启动**（进程 `Responding=True`、窗口标题 `MathCanvas`），确认加载的是这一轮的产物；但**没有**在自动化里驱动真实模型把那句话复现一遍 —— 上面的证据都是**单元层与编译层**的（`schemas.test.ts` 三种平面写法等价 + 共线按字段路径拒绝；`planCompiler.test.ts` 别名回退 + 场景引用形状仍被拒）。**"实机走通"这句话此刻还没有证据**，它留给用户在窗口里确认。这条口径与本仓库其它地方一致：**没有读数的结论不写成结论**。

## 2026-09-25（续）—— 方案 2 第三十一批：Rust `lib.rs` 992→912，代理与密钥两组搬进 `src/commands/`

## 2026-09-25（续）—— 方案 2 第三十二批：Rust `lib.rs` 912→447，四组命令全部搬进 `src/commands/`

## 2026-09-25（续）—— 方案 2 第三十三批：Rust `lib.rs` 447→168 —— 拆分完成

## 2026-09-25（续）—— 方案 2 第三十四批：`agent-core/schemas.ts` 1300→560（切出三块）

## 2026-09-25（续）—— 方案 2 第三十五批：`schemas.ts` 560→180 —— 解析层切开，评审点名的六个文件全部拆完

## 2026-09-25（续）—— 方案 2 第三十六批：`operations.ts` 2670→2430（删除级联与种类判据）

## 2026-09-25（续）—— 方案 2 第三十七批：`operations.ts` 2430→2211（依赖图与绕定点旋转的喂料层）

## 2026-09-25（续）—— 方案 2 第三十八批：`operations.ts` 2211→1961（路径查询 + 解析类图元的重算）

## 2026-09-25（续）—— 方案 2 第三十九批：`operations.ts` 1961→1651（三维变换与可编辑性判据）

## 2026-09-25（续）—— 方案 2 第四十批：`operations.ts` 1651→1505（截面与交的重算）

## 2026-09-25（续）—— 方案 2 第四十一批：`operations.ts` 1505→1310（三维对象怎么解析成几何）

## 2026-09-25（续）—— 方案 2 第四十二批：`operations.ts` 1310→1152（交面 / 交点并入 sectionRecompute）

## 2026-09-25（续）—— 方案 2 第四十三批：`operations.ts` 1152→850（重算主族整块搬走）

## 2026-09-25（续）—— 方案 2 第四十四批：`operations.ts` 850→307 —— 写入口搬走，方案 2 收口

## 2026-09-25（续）—— 第四十五批：`scripts/` 纳入 `tsc`；推送恢复后 CI 四作业全绿

两件事，一件补门禁、一件收交付。

### 1. `scripts/` 纳入类型检查（补上最后一个已知缺口）

此前只有 `apps/web/src`、各 package 与 `e2e/` 被 `tsc` 检查，`scripts/preview-server.test.ts` 一直只被 vitest 转译执行 —— 它的类型错误不会在门禁里现形（几轮前那条 `mkdtemp` 的 ENOENT 就是这么漏到 CI 才发现的）。现在新增：

- `scripts/tsconfig.json`（与 `e2e/tsconfig.json` 同形：`extends` 基础配置 + `include: ["."]`）；
- `scripts/nodeTypes.d.ts`：**只声明脚本真的用到的** node 面（`spawn` / `once` / `mkdir` / `mkdtemp` / `rm` / `writeFile` / `path` / `process` / `__dirname`）；
- 根 `typecheck` 末尾追加 `tsc -p scripts/tsconfig.json`。

**继续刻意不装 `@types/node`**（与 `e2e/nodeTypes.d.ts` 同一条理由）：它一旦进 `node_modules/@types`，所有没写 `types` 的 tsconfig 都会自动全局引入，`setTimeout` 的返回类型从 `number` 变成 `NodeJS.Timeout`，动摇一批好端端的应用代码。实测：补完当场 `tsc -p scripts/tsconfig.json` **exit 0**（最小面刚好覆盖用例所用）。

### 2. 推送恢复，CI 四作业全绿

代理恢复之后 15 个提交一次性推上（`6aa8e95..1cfb322`），CI 在 **`1cfb322` 上四作业全部成功**（`checks` / `build` / `e2e` / `rust`）—— 也就是说：方案 2 的全部拆分（`operations.ts` 2817→307、`schemas.ts` 1300→180、Rust `lib.rs` 992→168、`threeScene.tsx`、`App.tsx`、`PropertiesBar.tsx`）在 CI 上**完整跑过一遍并全绿**。

**验收**：`npm run typecheck` exit 0（现含三段）、`npm run lint` **0 error / 13 warning**、`npm test` **238 文件 / 2810 用例**；CI run #5（`1cfb322`）四作业 success。

切出 `apply.ts`（564 行）：**文档层唯一的写入口** `applyOperation`，连同它自己用的四个 helper（`normalizeForComparison` / `documentChanged` / `requireFinite` / `applyDeletionPlan`）、`OperationResult` 与 `parameterIsReferenced`。

**为什么必须一起搬**：上一轮我试过只搬 `applyOperation`，`tsc` 当场列出四个**值级回头依赖**（那四个 helper 与 `parameterIsReferenced` 还留在 `operations.ts` 里）—— 那就是运行时环。把它们一起搬走，环自然消失。这一轮把"动刀前先查值级回头依赖"补进了流程，于是照单执行、一次过。

**`operations.ts` 最终 307 行**，只剩两样东西：文档层的**创建 / 更新命令**（`createPoint3` / `createLine3` / `createFace3` / `createPolyhedron3` / `patchPoint3`、类型 `DomainOperation` / `Patch` 族、`solidStatusReport`）与**十一个模块的再导出**（包的公开面一行未改）。

**验收**：`tsc -p packages/scene-graph/tsconfig.json` exit 0、包内 **326 用例**全过、`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**（搬完涨到 43，按读数清掉 30 个多余 import）、`npm test` **238 文件 / 2810 用例**、`npx playwright test` **141/141**。

切出 `recompute.ts`（323 行）：`recomputeDerivedObjects`（"改了一处之后按拓扑序把该跟着变的对象重算一遍"的唯一入口）连同它**内部的两个嵌套函数**（`pickSolution` / `recomputePrimitive`）与 `calculatePlanarMeasurement`。

嵌套是刻意的：它们要闭包持有 `primitiveMap` 与 `parameters`，每算完一个对象就就地更新，好让下游读到刚算出来的上游值。所以搬动**逐行原样、只导出外层那一个** —— 给嵌套函数加 `export` 在语法上非法，这正是前一轮回滚的原因。

## 上一轮中止之后改掉的做法（这一轮因此一次过）

上一轮我在"向上跳过注释行找函数结尾"这条规则上栽了（注释正文也被当成可跳过，边界退到注释内部）。这一轮换成**按大括号配平**从函数名向下找结尾：

1. 先跑一次**只读勘查**：算出 `recomputeDerivedObjects` 的 382..638、`calculatePlanarMeasurement` 的 652..681，并把两端行内容打出来核对；
2. 再一次性搬迁 382..681（含中间那段文档注释），接线、`tsc`、跑包内测试。

前半段一行未改，后半段只补 import（四轮，每轮以 `tsc` 收口）。搬完 lint 从 13 涨到 63，按读数清掉 **50 个多余 import**，回到 13。

**验收**：`tsc -p packages/scene-graph/tsconfig.json` exit 0、包内 **326 用例**全过、`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**、`npm test` **238 文件 / 2810 用例**、`npx playwright test` **141/141**。

这一批不是"再切一块"，而是**解环**：上一批发现 `recomputePrimitive` 调用 `recomputeIntersectionFace`，而后者留在 `operations.ts` 里 —— 只要 `recomputePrimitive` 还想搬走，就必须先把交面那一族挪到它该在的地方。

于是把 `recomputeIntersectionFace` / `recomputeIntersectionPoint3`（含它们的来源解析与区域认领）以及四个小几何辅助（`dedupePoints3` / `centroidOfPoints` / `extentOf` / `distanceBetween` / `dotBetween`）**并入 `sectionRecompute.ts`**（165→**326** 行）。现在 `operations.ts`（**1152** 行）里剩下的只有：文档层的创建 / 更新命令、重算主族（`recomputeDerivedObjects`，内含嵌套的 `pickSolution` / `recomputePrimitive`）、以及 `applyOperation` 那一族。

**验收**：`tsc -p packages/scene-graph/tsconfig.json` exit 0、包内 **326 用例**全过、`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**（搬完涨到 25，按读数清掉 12 个多余 import）、`npm test` **238 文件 / 2810 用例**、`npx playwright test` **141/141**。

切出 `resolve3d.ts`（217 行）：**绑定点的坐标怎么解**（`resolveBoundPoint` / `resolveBoundPoint3` / `dragBoundPoint`）、**宿主参数怎么取**（`bindingParameterValue` / `bindingTupleValue`）、**截面怎么物化**（`sectionMaterialization`）、**模板拓扑怎么同步**（`syncTemplateTopology`）、**交面 / 交体怎么由来源推出来**（`resolveIntersection`）。

## 一次失败的尝试与它的教训（这一批最值得记的）

我原本想一次把 535..1044 整块搬走（含 `recomputeDerivedObjects` / `recomputePrimitive`），结果编译器给出 `TS1184: Modifiers cannot appear here`：**`pickSolution` 与 `recomputePrimitive` 其实是 `recomputeDerivedObjects` 内部的嵌套函数**（这个文件的风格把嵌套声明也顶格写），我那句"给切片里每个顶层 `function` 加 `export`"的机械改写因此把修饰符加到了嵌套函数上。

更麻烦的是它还会带来**运行时环**：`recomputePrimitive` 调用 `recomputeIntersectionFace`，而后者留在 `operations.ts` 里。

处置：**整批回滚**（`git checkout` + 删掉半成品模块），改搬一个**不含嵌套函数、也不回调 operations 的连续区间**（535..733，纯解析层）。搬完一次 `tsc` 通过。教训很具体：**"整块搬走"之前先确认区间里有没有被嵌套定义的函数，以及被搬走的代码会不会回调留在原处的函数** —— 前者让改写非法，后者让模块成环。

**验收**：`tsc -p packages/scene-graph/tsconfig.json` exit 0、包内 **326 用例**全过、`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**（搬完涨到 35，按读数清掉 22 个多余 import）、`npm test` **238 文件 / 2810 用例**、`npx playwright test` **141/141**。

切出 `sectionRecompute.ts`（165 行）：**截面与交的重算** —— 截面（含解析边界：源是圆柱 / 圆锥时给出精确的圆锥曲线片段环，写进 `section.exact`）、交线 / 交体、以及交面图元（布尔交集的**一个区域**，按支撑曲面分组后的一块）。两条用户口径随代码搬走：**"我需要的交面只是一个表面，而不是所有相交的表面"**（分组之前圆柱侧面被切成 48 个细条）；**多边形来源不需要解析层**。`solidTopology3` 与那个私有联合类型 `SolidIntersectionOutcome` 跟着一起搬。

**过程**：这一批把"边界探测"的坑踩全了 —— 又是文档注释、又是把上一轮已经搬走的东西第二次插入（`SolidIntersectionOutcome` 出现两次 → 5 条类型错误全是它的连锁反应），最后一律靠"切完立刻 `tsc`"逐个收口。搬完 lint 从 13 涨到 28，按读数清掉 **15 个多余 import**，回到 13。

**验收**：`tsc -p packages/scene-graph/tsconfig.json` exit 0、包内 **326 用例**全过、`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**、`npm test` **238 文件 / 2810 用例**、`npx playwright test` **141/141**。

`packages/scene-graph/src/operations.ts` 从 1961 行降到 **1651 行**，切出 `transforms.ts`（约 320 行）：平移与旋转怎么落到文档上（`translatePrimitive` / `translatePrimitive3` / `rotatePrimitive3`）、以及"这个对象能不能被拖动 / 绕定点旋转"（`isFreeDraggable3` / `isRotatable3` / `managedPointIds` / `templateTopologyIds` / `EDITABLE_GEOMETRY_TYPES`）。三条口径随代码搬走：模板实体与物化拓扑必须**一起动**；棱柱构造描述可能不再成立时要**改记成显式面环**；旋转的判据是"有自己的一族点"。

`PrimitiveBounds` 这个私有 interface 也跟着 `primitiveBounds` 搬过去（它本来就是那只包围盒的形状）。

**过程**：边界探测又踩了同一种坑（把函数结尾定在下一段的文档注释上），这次直接用"向上跳过注释行再取 `}`"定住；随后补了四轮导入（`CurveRotation` / `SolidConstruction` / `WorldAxis3` / `curveRotationOf` / `rotatePointAboutAxis3` 等），每轮都以 `tsc` 收口。搬完 lint 涨到 30，按读数清掉 **17 个多余 import**，回到 13（基线）。

**验收**：`tsc -p packages/scene-graph/tsconfig.json` exit 0、包内 **326 用例**全过、`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**、`npm test` **238 文件 / 2810 用例**、`npx playwright test` **141/141**。

`packages/scene-graph/src/operations.ts` 从 2211 行降到 **1961 行**，切出 `analysisRecompute.ts`（272 行）。它装两半：

- **路径查询**：`pathConstraint` / `parameterWindow` / `projectOntoPath` —— 把一条曲线当成"带参数的路径"来问；
- **解析类图元的重算**：导数 / 切线 / 法线 / 割线 / 积分 / 分析集 —— 几何**全部**由来源函数算出来，自己不含独立参数。

两半**必须同一个文件**：解析类图元要按来源函数在自己的域上求值，而那正是路径查询那一层在做的事 —— 分开就会成环。这已经是本次拆分里第三次由**依赖方向**决定归属（前两次是 `primitiveKinds` 与 `curveRotation`）。

**这一批的过程值得记**：边界探测连着踩了两次坑 —— 先是把函数结尾定在了下一段的文档注释上（`block end mismatch: */`），改成"向上跳过注释行再取 `}`"才对；接着因为同一个 import 被两轮接线各写了一遍，`tsc` 报 7 条 `TS2300 Duplicate identifier`，最后按"同类 import 只留第一行"合并掉。**每一步都靠"切完立刻 `tsc`"才没有走远**。

**验收**：`tsc -p packages/scene-graph/tsconfig.json` exit 0、包内 **326 用例**全过、`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**（搬完涨到 39，按 lint 读数清掉 26 个多余 import）、`npm test` **238 文件 / 2810 用例**、`npx playwright test` **141/141**。

`packages/scene-graph/src/operations.ts` 从 2430 行降到 **2211 行**，切出两块：

- `graph.ts`（200 行）：**依赖图** —— `primitiveDependencies` / `templateRelations` / `getDependencyIndex` / `getAffectedPrimitiveIds` / `topologicalRecomputeOrder`，以及那两条**实测出来**的口径（"实体 → 子对象"这条边曾经不存在，导致绑定点留在原地；截面 / 交面只声明依赖实体，导致按数值改顶点后留下旧截面）；
- `curveRotation.ts`（61 行）：**绕定点旋转的"喂料层"** —— 把文档里的两种定点写法喂给内核的 `placedConic`（"圆心是点图元"的圆明确不参与，两种能力各自独立）。

`curveRotation.ts` 这次是被**编译器逼出来的**：`graph.ts` 需要 `curveRotationPivotId`，而它原本住在 `operations.ts` 里 —— 直接 import 就成环，所以先把这一族挪到两边都能引用的地方。这与上一批 `primitiveKinds` 的成因完全一样：**拆文件的顺序由依赖方向决定，不由行数决定**。

**踩到的两个坑（都记下来）**：

1. PowerShell 变量**大小写不敏感**：我又一次同时用了 `$g`（路径）与 `$G`（内容数组），后者覆盖前者，"写回补丁"静默失败 —— 上一批刚记过同一条，这一批又犯。这也是为什么每次都要**单独验证补丁是否真的落盘**；
2. `ConicPlacement` 属于 `@draw/geometry-kernel` 而不是 `@draw/dsl`（照抄 import 时想当然），`tsc` 当场报出来。

**验收**：`npx tsc -p packages/scene-graph/tsconfig.json` exit 0、包内 **326 用例**全过、`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**（搬完先涨到 22，按 lint 读数清掉 9 个多余 import）、`npm test` **238 文件 / 2810 用例**、`npx playwright test` **141/141**。

`packages/scene-graph/src/operations.ts` 从 2670 行降到 **2430 行**，切出两块：

- `deletion.ts`（238 行）：**删除的级联判据** —— `cascadeSources` / `deletionPlan` / `deletionTargets` / `unbindDeletedHost` / `topologyReferences` / `expandTopologyCluster` / `layerDescendantIds` / `DeletionPlan`。判据是**派生性**（交点、轨迹、连接完全由来源决定，自己不含独立几何）而不是"有没有人引用"；被引用的普通图元被删时，引用方要改指向或解绑；
- `primitiveKinds.ts`（37 行）：三个纯种类判据（`isPlaceableConic` / `isSourceIdConstruction` / `functionAnalysisSourceId`）。它们被 `deletion` 与 `operations` **两边**用到，放任何一边都会成环 —— 所以单独一个文件。

## 上一轮失败之后换回的做法（值得记下来）

上一轮我用"从函数起始行往后找第一行恰好是 `}`"来自动定边界，切错了括号配平（`tsc` 报 14 条 `TS1128`），整批回滚。这一轮换回**最笨但可靠**的三步：①先把起点/终点那几行**读出来逐行确认**（含注释归属，这个文件里相邻函数的文档注释会互相贴住）；②按行号切片；③**切完立刻 `tsc` + 包内测试**。三段都一次过。

顺带记一个我自己犯的**工具坑**（这轮真踩了）：PowerShell 变量**大小写不敏感**，我同时用 `$d`（路径）与 `$D`（文件内容数组）时后者把前者覆盖了，于是"写回补丁"这一步静默失败。表现是：补丁没写进去，但错误信息看起来像"代码还是错的"。

**验收**：`npx tsc -p packages/scene-graph/tsconfig.json` exit 0、包内 **326 用例**全过（含 `deletion-cascade` 与 `recomputeConsistency` 两个正对口的用例）、`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**（基线）、`npm test` **238 文件 / 2810 用例**、`npx playwright test` **141/141**。

`packages/agent-core/src/schemas.ts` 从 560 行降到 **180 行**（原始 **1300 → 180，−86%**）。这一批切出两块：

- `actionInputs.ts`（305 行）：**逐个动作的 inputs 校验**（那个最大的 switch）；
- `actionAudit.ts`（103 行）：**分类与审计说明**（哪些动作"登记了但还不支持"、每个动作对界面该说什么、修复请求怎么生成）。

`ActionId`（`keyof typeof ACTIONS`）也跟着登记表搬进 `actionRegistry.ts` —— 它是表的键，表在哪儿它就该在哪儿；`schemas.ts` 里只留 `export type { ActionId } from "./actionRegistry"`。

**结果**：评审 md 方案 2 点名的六个文件全部拆分完成（`PropertiesBar` 1069→298、`App.tsx` 2000→809、`threeScene.tsx` 1807→269 + 七个阶段模块、Rust `lib.rs` 992→168、`agent-core/schemas.ts` 1300→180、`operations.ts` 2817→2662 做过一轮）。**公开面照旧一行未改**（靠 `schemas.ts` 里的再导出）。

**这一批的收官复跑（全套门禁，各组单独跑）**：`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**（基线）、`npm test` **238 文件 / 2810 用例**、`npx playwright test` **141/141**、`npm run test:perf` exit 0（`addPrimitives/1000-planar` 4.3ms、`recomputeDerivedObjects/100-solid` 22.2ms、`solidStatusReport/100-solid` 5.5ms、`encodeMgeo/large` 5.0ms、`roundTrip/large-mgeo` 17.7ms、`denseIntersections/200x200` 1.7ms、`drag/300-frames` 702.8ms —— 与归档读数同一区间，**没有回归**）、`npm run test:rust` exit 0（232 例 + 3 ignored）。

`packages/agent-core/src/schemas.ts` 从 1300 行降到 **560 行**，切出三块：

- `schemaReaders.ts`（219 行）：**运行时校验的基础读取层** —— 有限数、有界字符串 / 数组、平面与空间坐标、作用域引用、字段白名单，以及"模型写的名字能不能原样写进诊断"的回显判据；
- `actionRegistry.ts`（436 行）：**动作登记表**（`ActionSpec` / `ACTIONS` / 种类常量 / `FieldPolicy` / `ActionAuditDescription`）；
- `hashing.ts`（145 行）：**确定性 ID 与规范化哈希**（`newRunId` / `newDraftId` / `canonicalContentHash` / `sha256Hex*`）。

## 这次拆分的**真正约束**是依赖方向，不是行数

第一版把回显判据（`isEchoableName`）和它的调用者 `rejectUnknownFields` 一起放进读取层，编译立刻报 `Cannot find name ACTIONS` —— 因为回显判据要读**登记表**。若把表留在 `schemas.ts`，就成了"读取层 → schemas → 读取层"的环。于是这一批真正的工作量落在**登记表先独立出来**：表是纯数据，切出去之后依赖方向变成 `schemas → schemaReaders → actionRegistry`，无环。这条顺序（先认清"谁是数据的真源"）比"哪一块行数多"重要得多。

## 公开面一行未改

`index.ts` 是 `export * from "./schemas"`，所以搬走的东西必须在 `schemas.ts` 里**转出去**：`export { isEchoableName } from "./schemaReaders"`、`export { canonicalContentHash, newDraftId, newRunId, sha256Hex, sha256HexBytes } from "./hashing"`、`export { ACTIONS, type ActionAuditDescription, type FieldPolicy } from "./actionRegistry"`。于是包外调用方（含 `apps/web` 的 Agent 运行时）一行都不用改。

**验收**：`npm run typecheck` exit 0、`npm run lint` **0 error / 13 warning**（回到基线；搬完先涨到 29 条，都是两个文件里多带的 import，按 lint 读数逐条清掉）、`npm test` **238 文件 / 2810 用例通过**、`npx playwright test` **141/141**。

`lib.rs` 从 447 行降到 **168 行**（原始 **992 → 168，−83%**）。这一批搬的是最后一组：`src/commands/providers.rs`（296 行）—— `provider_run` / `provider_cancel` / provider 配置的增删查与健康检查 / `provider_check` / `get_runtime_info`，加上只被它们用的 `ProfileStoreState` 与 `store_error`。

`lib.rs` 现在只剩：模块声明、六个 import、`RepositoryState` / `BlobState` 两个托管状态、`run()`（建托管状态 + 一张命令清单）。

接口税总计（三批累计）：命令加 `pub`；`RepositoryState.repository` / `BlobState.blobs` / `ProfileStoreState.store` 三个字段改成 `pub(crate)`（根模块的 `run()` 仍要构造它们）；`ProxyState` / `ProxyRuntime` 各加一个构造器；根模块导入从"什么都用"瘦到六个。

六组命令模块共约 925 行，`lib.rs` 减掉 824 行 —— 差额约 100 行就是这些模块头、导入与可见性成本，如实记在这里。

**验收**：`cargo check --all-targets` exit 0、`cargo clippy --all-targets` **零警告**、`npm run test:rust` **exit 0**（232 例通过 + 3 ignored，含那两条扫全树的守护性断言）。

`lib.rs` 从 912 行降到 **447 行**（原始 992 → 447，**−55%**）。这一批搬了两组：

- `src/commands/repository.rs`（372 行）：项目仓储 8 条 + 附件与 `.mcanvas` 6 条 + 运行账本 3 条，**合成一个文件**，因为它们碰的是同一份托管状态（SQLite 与附件目录）—— GC 与导入导出要同时问两边，分开只会让那条跨状态的判据难读。两个 base64 辅助函数（只被附件命令用）也一起搬过去；
- `src/commands/conversations.rs`（120 行）：「多会话」八条命令。

接口税与前一批同形：命令加 `pub`，`RepositoryState.repository` / `BlobState.blobs` 改成 `pub(crate)`（根模块里剩下的 provider 命令仍要读它们），`lib.rs` 侧不再需要 `CommitReceipt` / `CommitRequest` / `DocumentSnapshot` 三个导入。

**这一批只改了注释与 import 两处就通过**：`cargo check --all-targets` exit 0、`cargo clippy --all-targets` 零警告、`npm run test:rust` **exit 0**（232 例通过 + 3 ignored，含那两条守护性断言）。原因是上一批已经把可见性口径与守护断言的扫描范围都定下来了 —— **先搬小组合、把接口摸清，再搬大块**，这是这一批一次过的直接原因。

`apps/desktop/src-tauri/src/lib.rs` 从 992 行降到 **912 行**：

- `src/commands/mod.rs`（模块头，13 行）、`src/commands/proxy.rs`（`ProxyState` / `ProxyRuntime` + `proxy_session` / `proxy_cancel`，81 行）、`src/commands/secrets.rs`（`SecretStoreState` + 三个密钥命令，40 行）；
- 命令**逐行搬**，只加了可见性（`pub fn`、`pub(crate) session`）与两个构造器（`ProxyState::new` / `ProxyRuntime::new`）—— 那是 Rust 侧的"接口税"：字段私有 + 结构体在别的文件里，就必须有一个能构造它的入口；
- 读数是**逐条编译出来的**：先 `cargo check --all-targets` 把 10 条 `E0425`/`E0599`/`E0616` 一次列清（缺 `SecretStore` trait 导入、`lib.rs` 里剩下的 provider 命令仍在用 `ProxyState`/`SecretStoreState`、私有字段被根模块访问），修完 `cargo clippy --all-targets` 零警告。

## 拆这个文件的**真正障碍**：一份守护性断言把它钉住了

`tests/shell_smoke.rs` 原来要求**所有**命令都写在 `src/lib.rs`：它按 `lib.rs` 的文本数 `#[tauri::command]` 的条数（"不多不少"），并逐条在 `lib.rs` 里找 `fn <名字>(`。所以这个文件不是"没人拆"，而是**拆了必红**。这一批把那份断言的口径从"扫 lib.rs"改成"扫整棵树"（`src/lib.rs` + `src/commands/*.rs`）：**意图没变、覆盖面更大** —— 它守的仍是"只暴露具名命令、没有泛型命令、没有通用 shell / 文件读写出口"，登记清单也仍逐字写在测试里（比对时只取路径的最后一段，于是命令换文件不影响那份清单）。

顺带记一条**没能复现的现象**：改完注释空行后第一次 `npm run test:rust` 退出码 101（输出被丢弃，没留下现场），随后连跑三次都是 0。如实记在这里，不当作已解释。
## 2026-09-25 —— CI 的首次运行：三红一绿，三个红都是"门禁自己不自足"

推上去之后 CI 跑起来了（run #1，commit `96ff89f`）。四个作业里 **`e2e` 绿**（42 spec / 141 用例，含它自己重建 + preview），另外三个红。三条原因都不是产品代码的问题，而是**门禁默认了"本机恰好有的东西"**：

1. **`checks`** 红在 `scripts/preview-server.test.ts`（`Test timed out in 5000ms`）。它先等 `http://127.0.0.1:4173/` 返回 200，而那要求 `build-check/mathcanvas-current` 里有一份构建 —— **本机一直有**（跑过构建），CI 上没有（构建是另一个作业）。`vite preview` 对着空目录照样起得来，只是每个请求都 404，于是轮询一直到 vitest 的 5 秒超时。修法：这条用例测的是"服务器收到 SIGTERM 会不会退出"，与产物内容无关，所以**它自己造一份最小产物 + 自己选端口**（`PREVIEW_OUT_DIR` / `PREVIEW_PORT` 两道环境变量缝，默认值不变、e2e 那条路不受影响）；同时给用例自己的 30 秒超时，让失败信息落在"服务器没就绪"而不是 vitest 的超时上；`preview-server.mjs` 在产物缺失时**明确警告**（这类"起来了但都 404"的现象以前没有任何提示）。**复现方式**：把真实产物挪走再跑 —— 旧写法必红，新写法 384ms 绿。
2. **`build`** 红在根目录的 `npm run build`（= `--workspaces`）：它连带去跑 `apps/desktop` 的 `build`，而那个脚本是 `tauri build --no-bundle`，需要 WebKitGTK 之类的系统依赖（只有 `rust` 作业装了）。修法：这个作业**只构建 web 工作区** —— 与它自己注释里"Windows Tauri 打包刻意不进 CI"一致。
3. **`rust`** 红在 `shell_smoke` 的 `the_web_entry_the_shell_loads_exists_and_is_the_web_build`：它断言外壳加载的那份 web 产物**真的在**（`build-check/mathcanvas-current/index.html`，失败信息里就写着该跑哪条命令），而 `cargo test` **不会**执行 `tauri.conf.json` 的 `beforeBuildCommand`（那是 `tauri build` 的事）。修法：作业里先 `npm run build --workspace @draw/web` 再跑 `npm run test:rust`。

**同批补上的读数**：`npm run test:rust` 本机复跑 **232 例通过 + 3 ignored / 0 失败**（此前几个阶段一直标注"未复跑"）。**顺带记下的缺口**：`scripts/` 下的测试还没纳入 `tsc`（与 `e2e/` 当初一样），本阶段没做。

### 第二、三次运行：又两处"本机绿、Linux 红"，以及一条排查能力

`26763e7`（run #2）之后 **`build` 转绿**，`checks` 与 `rust` 仍红。按 **check 注解**逐条定位（注解是公开可读的，而 cargo/vitest 的日志下载要仓库管理员权限）：

4. **`checks`**：上一版修法自己在 CI 上红了 —— `mkdtemp` 报 `ENOENT`，因为干净检出里**没有** `build-check/`（被 `.gitignore` 忽略），而 `mkdtemp` 不会替你建父目录（本机有那个目录，所以本机看不出来）。修法：先 `mkdir(parent, { recursive: true })`。
5. **`rust`**：`runtime.rs` 的 `never_leaks_a_filesystem_path_beyond_the_data_root_directory_name` 用 `Path::new(r"C:\Users\...\AppData\Roaming\com.mathcanvas.app")` 造输入 —— **反斜杠在 Linux 上不是分隔符**，那边整串只有一段，`file_name()` 返回整串，于是"只留最后一段目录名"这条断言在 Linux 上必红（cargo 退出 101）。修法：改成 `Path::new("C:").join("Users").join(...)`，两边各按自己的分隔符分段，测的还是同一件事。

**顺带加的一条排查能力**：cargo 的失败只写在日志里，而日志要管理员权限 —— "哪条用例红了"在注解里看不到（第 5 条是靠读代码定位的）。所以 `rust` 作业在失败时把 `panicked at` 那几行抬成 `::error` 注解（注解公开可读），下次不必再猜。

**结果**：run #3 / `f10ee8e` —— `checks` / `build` / `e2e` / `rust` **四个作业全绿**。

## 2026-09-24 —— 按《MathCanvas 项目梳理与优化建议》逐方案落地

一条主线：**把"同一件事在两处各写一遍"这类结构性缺陷收掉**，并把评审点名的性能与工程问题按读数处理。逐方案结果：

**方案 1（P0）统一实体构造与拓扑物化**
模板实体在文档里本是**两件东西**（用户编辑的参数化图元 + 由它物化出来的一族拓扑），手工按钮落两件、`solid.create_template` 只落一件 —— 于是"用 Agent 建的立方体，旋转角不起作用"。修法是动作层加**唯一入口** `compileTemplateSolid`（刻意不传自定义 `BuilderContext`，与 `syncTemplateTopology` 的默认命名逐字一致），手工按钮改调同一入口。验收：手工与 Agent 同参数创建四类模板产出**逐字节相同**的文档。

**方案 2（P1）拆分过大的编排与领域文件**（进行中，已开三十批）
`operations.ts` 2817→2662（`solidGeometry.ts`）、`PropertiesBar.tsx` 1069→**298**（`inspectorFields.tsx` 字段控件 / `inspectorLabels.ts` 名字与归属 / `inspectorReadings.tsx` 派生读数组件 / `inspectorModel.ts` **检查器模型**：面板从此只负责画）、`App.tsx` 2000→**809**（`persistence/fileExports.ts`、`documentIds.ts`、`creationCommands.ts` 九条创建命令、`solidCommands.ts` 七条截面与宿主绑定命令、`recordCommands.ts` 五条记录命令、`structureCommands.ts` 三条结构命令、`anchorRotationCommands.ts` 两条定点旋转命令、`point3ToolCommands.ts` 六条三维工具命令、`previewCommands.ts` 两条预览创建命令、`selectionCommands.ts` 七条选择命令、`canvasStatusPrompt.ts` 状态栏推导、`draftingCommands.ts` 2D 创建流程、`appViewState.ts` **派生视图状态**：选中了谁 / 能不能建某类对象 / 活动图层能不能画 / 标注与定点旋转的入参够不够，23 个字段的纯计算、`useDraftPersistence.ts` **启动恢复与自动保存**：两个 effect + 它们之间的时序守卫 + "换一世"的 `reset` 入口、`commandDispatch.ts` **命令分发**：CAD 与功能区两张 switch 表 + 换 CAD 模式、`useKeyboardShortcuts.ts` **键盘快捷键**：Esc 分级 / Delete / 撤销重做）、`threeScene.tsx` 1807→**269**（那个 1445 行的挂载期效应整块搬进 `threeSceneEffect.ts`，随后按阶段切出**七块**：`threeSceneCamera`（相机取景）/ `threeScenePreviewHover`（预览悬停）/ `threeSceneRender`（一帧绘制 + 两层标签 + 容差档位与手柄缩放）/ `threeSceneGrid`（网格与坐标轴落位）/ `threeSceneInteraction`（指针按下·移动·抬起、拖拽会话、拾取判定）/ `threeSceneContent`（**内容同步**：`contentRecords` + `keepContent` 增量重建 + 整场 `syncContent` + `refreshPrimitiveObject`）/ `threeSceneDragVisuals`（**拖动期间的画面**：半径预览 / 手柄落位 / 场景重建后补画），效应本体 1445→**489** 行。七块合计 **1696** 行 —— 切出去的是 956 行，其余 **740** 行是各块的 `deps` 接口、工厂签名与头注释，这笔"接口税"如实记在这里。切成工厂的**直接收益**当场兑现：`threeSceneContent` 过去整块住在效应里、只能靠整页 e2e 从外面看，现在能喂一份文档进去问它"你到底重建了什么" —— 新增 6 条用例钉住重建粒度（沿用不换实例、只重建改动的那一个、删图元时记录回到 3 条静态对象、就地重建画在 `points` 表的坐标上、就地重建后整场同步不产生第二个对象）。`appViewState` 同理：那批派生状态过去只有**渲染整棵 App** 才能验，现在喂一份文档就能问 —— 新增 8 条用例钉住"空选中不算全锁定 / 全可见"、截面只认模板实体、交点只认 `@draw/dsl` 那张可采样表、空间工具"只认空间点"、线性与角标注各自独立计数（1 点 + 1 棱 → 线性可用而角不可用）、定点旋转要"一个点 + 一条未锁定的封闭曲线"、活动图层被隐藏 / 锁定时的那句提示。写这批用例时当场纠正了我自己的一个错判：混着选 1 点 + 1 棱时线性标注**是可用**的（那条棱自己就够），我原先以为两种入口都该关着。`useDraftPersistence` 是第三种收益：它那两条时序守卫本来**只能靠整页 e2e 间接证明**（一条是探针抓出来的、一条是 e2e 抓出来的），搬成 hook 时留了一道能控制 `restore()` 何时返回的缝，于是新增 9 条用例直接钉住它们 —— 恢复在途时一个字都不写、恢复自己带来的那次变化只跳过一次、用户先动手就不覆盖、切走工作区就不覆盖、网页版退回草稿、仓储本该可用却失败要如实说且照样放行自动保存、`not_a_desktop_shell` 不弹提示、保存失败只报一次，以及"换一世"那个入口。`commandDispatch` 是同一件事的第三次兑现：两张 switch 表过去与二十来个闭包 handler 挤在一起、只能点界面验，现在 12 条用例喂替身 handler 问"这一步该谁做、谁必须没被调到"（图层挡住时只提示不创建、`inspect-diagnostics` 必须拿到更新函数而不是布尔值、CAD 工作区里功能区命令整条转给 CAD 表 —— 连"只在功能区表里的 `create-cube` 在 CAD 工作区什么都不会发生"这条看着像 bug 的当前口径也钉住了）。搬键盘处理时**顺手修掉两处搬之前就存在的依赖问题**：①依赖数组里有 `document` 与 `apply`，函数体一个都没读 —— 后果不是"多订阅一次"：`document` 每次编辑都换身份，等于**每提交一笔操作就把键盘监听摘下来再挂回去**；②`deleteSelected` 漏写，而函数体真的调它（基线那条 lint 警告就是它），漏掉意味着"某次改动之后 Delete 走的还是旧的闭包"。修完基线 14 → **13** 条警告。9 条新用例直接往 `window` 发按键：撤销/重做按平台修饰键、输入框里 Ctrl+Z 不许撤销整篇文档、`Alt+Ctrl+Z` 不算快捷键、Esc 分级（先取消创建、再关指引、最后才清选择）、Delete/Backspace `preventDefault`、输入框里 Delete 不删对象、卸载后监听摘掉。切法是"**依赖对象 + 原文搬**"：跨阶段的可变值先变成**稳定容器**（`copy` / `clear` / 就地 push），搬动的行一行不改；每一步都以 `geometry3d-*` 那组 e2e 验收）。切的过程中又抓到第三条**顺序坑**：内容同步要用渲染工厂交出的 `syncPointHandleScales` 先把点手柄按屏幕尺寸缩放、再算内容包围盒与面片尺寸（否则同一份内容算出偏小的包围盒，实测 7.02 vs 7.11），所以内容工厂只能排在渲染工厂**之后** —— 这与"初始 `syncContent()` 必须排在工厂调用之后"其实是同一条约束的两端）。
`inspectorModel` 的接口刻意只写**三项**（选中的图元、选中的 id、一个更新回调），而不是整个 `PropertiesBarProps`（三十多个字段里绝大多数只被 JSX 透传）—— 于是这段逻辑第一次能**脱离整棵面板**直接测（新增 7 条用例：类型收窄、只对带斜率参数的直线显示该字段、锁定对象拒绝编辑、空选中不产出读数、标签回退到 id）。
口径：搬移一律**逐行原样搬**，并核对"新位置每一行都能在旧位置的删除行里找到"（`PropertiesBar` 搬走的 326 行、`structureCommands` 的 37 行、`anchorRotationCommands` 的 45 行、`point3ToolCommands` 的 65 行、`previewCommands` 的 85 行、`selectionCommands` 的 33 行、`draftingCommands` 的 74 行全部可追溯（`canvasStatusPrompt` 的 40 行里有 **1 行刻意改写**：`hoveredPreview !== null` 换成入参 `hovering`；`draftingCommands` 另有 4 行是把 `CreationStep` 这个一行类型别名**改写成等价的 interface**，字段没变；`threeSceneContent` 的 494 行里有 **1 行只动了换行**（旧位置把一句属于 `syncCounts` 的说明粘在了 `contentRecords` 那一行行尾，搬过去时放回它该在的那一行），`appViewState` 的 43 行里也有 **1 行只动了换行**（`cadAnnotationSources` 的箭头函数体被挤在同一行 —— 旧文件里的排版残留，拆开）；`useDraftPersistence` 是两个 effect：里面 **7 处 `useSceneStore.getState()` 换成了入参 `readLive()`**（守卫必须读"当前值"而不是 effect 闭包里的 `document`，这正是当初那三条用例失败的原因），另 **1 处**给持久化适配器留了注入缝（`persistence ?? createDocumentPersistence({`），其余逐行未改；两个依赖数组补上了 `setFileError`（它是 `useState` setter、身份稳定，但作为 hook 入参必须写进依赖，否则 lint 会如实报出来））；对不上的只有新写的签名 / 参数解构 / 返回值，以及 `anchorRotationCommands` 里**一处刻意**的改写：原来直接写 App 的 `pendingSelectionRef`，现在走依赖里的 `setPendingSelection` 回调）；组件与纯值分文件是 `react-refresh` 的硬要求（混在一起整块面板会丢热更新状态）。上面这批新模块各自补了用例（`creationCommands` 7、`solidCommands` 6、`recordCommands` 5、`structureCommands` 7、`anchorRotationCommands` 5、`point3ToolCommands` 6、`previewCommands` 7、`selectionCommands` 8、`canvasStatusPrompt` 8、`draftingCommands` 8、`inspectorModel` 7），把"该是空操作时空操作"（选中不是曲线的对象、动点没绑轨道、自由点没有宿主参数、没有选中就没有标注、来源不够不落盘、**锁定对象拒绝编辑**）、"删除走**与 Agent 同一份**动作编译器且整批一步撤销"、"切线定位写成对点的引用而不是坐标快照"、"标注锚点是对图元的引用"、"**空间点按格点摆放，前三点不共线**"、"圆轨道三点共线时如实拒绝、建完即与那些点脱钩"、"**线圆交点把线与圆的顺序摆正**（字段名有方向）"、"框选左→右只选完全包含、曲线两个方向都只按包含判"、"**加选是切换**（再点一次取消）、点选会清掉创建步骤"、"手工建实体时拓扑与参数化图元同一次落盘"这几条不变式钉住 —— 它们都是搬动中最容易悄悄走样的一类行为。

**方案 3（P1）接入几何 Worker** —— 已完成
实测依据：大文档上 `compilePlan` 要 **73 ms**，而过线程边界的复制只要 **1.0 ms**（**76 倍**）。落地为 `geometryWorkerClient`（按 `requestId` 配对、核信封、超时、丢弃过期响应）+ `geometryCompileStrategy`（两条路并排 + 等价性证据）+ `geometryWorkerHost`（**每页一份**的懒建单例、`pagehide` 终止、起不来时**如实降级**）。
接线过程中抓到两处"会静默变差"的地方并修掉：客户端此前**丢弃失败产物**（`repair`/`planDiagnostics`/`assumptions`/`questions` 到了主线程门口又被扔掉）；兜底路自己抄了一份"就地编译"却**漏传用户原话**，导致同一份计划在两条路上编出不同结果。

**方案 4（P2）工作区级代码分包** —— 入口单 chunk 2 066.63 kB → 约 1 636 kB（−21%），导出器另成 `engineeringExporters` 按需 chunk。

**方案 5（P2）正式 CI 门禁** —— `.github/workflows/ci.yml` 四个作业按成本分层（`checks` = typecheck + lint + Vitest + 性能趋势、`build`、`e2e`、`rust`）。
本轮补上：**e2e 也过类型检查**（此前 42 个 spec 只被 Playwright 转译、从不被 `tsc` 检查；补上后当场查出 23 个类型错误）。

**方案 6（P2）文档与过期注释收口** —— `docs/current-status.md`（现在时）与 `docs/project-progress.md`（归档）分开，归档头已降级说明；本文即评审点名的"版本变更记录"。

**方案 7（持续）大型场景性能基准** —— 八条 node 场景（1000 图元编辑、100 实体重算、密集两两相交、依赖 DAG 局部重算、连续拖动 300 帧、较大 `.mgeo` 存取等）+ 浏览器里的**主线程响应性**读数。
`longtask` API 在本机不可用（声称支持、连一次故意阻塞 200 ms 都不报，已用空白页探针证实），改用**帧间隔**并带量具标定断言。

**同批修掉的既有问题**（都不是新功能，是"早该如此"）：
- 确认面板的对象计数在方案 1 之后按新口径（一个立方体 28 个对象），两条还停在旧口径的 e2e 用例被改正 —— 而 `e2e` 是 CI 必修作业，等于 CI 此前一直是红的；
- 几何 Worker 的契约缺 `completionAssumptions` / `repair` / `planDiagnostics` / `assumptions` / `questions`，缺任何一项都会在接线后**静默降级**（确认面板变空、可修的计划变得不可修、该问用户的被报成"编译失败"）。

**门禁读数**（本机实测，明细见 `docs/current-status.md`）：`npm test` 238 文件 / 2810 用例通过 + 1 todo；`npm run typecheck` 6 workspace + e2e 全 exit 0；`npm run lint` 0 error / **13** warning（基线从 14 降 1 —— 见下"顺手修掉的两处依赖问题"）；`npx playwright test` 42 spec / 141 用例全绿。（**读读数要看每一条自己的 exit code**：把几条门禁串在一条命令里跑时，整条命令的退出码来自**最后一条**，前面某一条失败会被吞掉 —— 本阶段就因此漏看过一次 `tsc` 的失败，后来改成逐条取 `$LASTEXITCODE`。）
