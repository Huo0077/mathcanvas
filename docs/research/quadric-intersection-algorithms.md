# 二次曲面求交：外部实现与算法调研（A2 的输入）

> **性质**：只读调研记录，2026-09-17。所有链接都指向一手来源；**标 `NOT CONFIRMED` 的条目我没有读到原文，不得当作事实引用**。
> **用途**：A1（平面 ∩ 二次曲面）的设计参考 + A2（二次曲面互交）的输入。A1 设计见 `docs/superpowers/specs/2026-09-17-analytic-quadrics-design.md`。

## 0. 一句话结论

教学软件里**只有"平面 ∩ 二次曲面"是精确的**；曲面互交大家都停在"球 ∩ 球"，其余返回未定义。真正可用的路线是：**先把容易的闭式情形做全，再决定要不要写追踪器**——因为课程里出现的圆柱/圆锥相交，绝大多数落在那几个闭式情形里。

---

## 1. GeoGebra：精确到什么程度（源码级）

仓库 `geogebra/geogebra`，分支 `main`，文件路径均在 `source/shared/common/src/main/java/org/geogebra/common/` 下。

### 1.1 数据模型：精确、有分类、不是网格
- `geogebra3D/kernel3D/geos/GeoQuadric3D.java`：二次曲面存成 4×4 对称矩阵的 10 个独立系数（类注释给出了排布）；`classifyQuadric()` 用 **3×3 主子式 `detS` 与 `max³ · Kernel.STANDARD_PRECISION_CUBE` 比较**（`max` 是最大系数绝对值——**立方缩放的容差**），再分发到 `classifyMidpointQuadric()` / `classifyNoMidpointQuadric()`，终点是 `ellipsoid() / cone() / cylinder() / hyperbolicCylinder() / parabolicCylinder() / hyperbolicParaboloid() / hyperboloidOneSheet() / hyperboloidTwoSheets() / intersectingPlanes() / parallelPlanes() / singleLine()`。特征分解交给 Apache Commons Math。
- 类型词表：`kernel/kernelND/GeoQuadricNDConstants.java`（`QUADRIC_CYLINDER / CONE / SPHERE / ELLIPSOID / PARALLEL_PLANES / INTERSECTING_PLANES / SINGLE_POINT / LINE / DOUBLE_LINE / PARALLEL_LINES / PARABOLIC_CYLINDER / HYPERBOLIC_CYLINDER / HYPERBOLIC_PARABOLOID / EMPTY / NOT_CLASSIFIED` …）。
- 点在曲面上：`isInRegion(coords)` = `DoubleUtil.isZero(coords · (Q · coords))`。

### 1.2 平面 ∩ 二次曲面 = **精确圆锥曲线**
- `geogebra3D/kernel3D/algos/AlgoIntersectPlaneQuadric.java`：`intersectPlaneQuadric()` 只做**一次矩阵乘法** `cm = Pᵀ · Q · P`（`Q` = 曲面 4×4 对称矩阵，`P` = 平面坐标系的 3×4 参数矩阵），输出 `GeoConic3D` 并 `setCoordSys(平面坐标系)` + `setMatrix(cm)`。命令 `IntersectPath`（[文档](https://geogebra.github.io/docs/manual/en/commands/IntersectPath/)）；`Intersect(Plane, Quadric)` 同样给圆锥曲线。
- **这验证了 A1 §5.1 的做法：我们抄的就是这个。**

### 1.3 有限实体的裁剪：也是精确的
- `algos/AlgoIntersectPlaneQuadricLimited.java`：继承上面的算法先拿到**精确圆锥曲线**，再用两个 `AlgoIntersectPlaneConic` 把它与上/下端面圆相交，最后把结果存成**四个路径参数**：`GeoConicSection.setParameters(bottom1, bottom2, top1, top2)`；输出类型 `GeoConicSection`。
- 退化分支写得很实：`conic.setUndefined()`、`setSinglePoint(p1, p2)`、`Double.isNaN(bottomParameters[0])`、以及按对象自身尺寸的相对容差 `DoubleUtil.isEpsilonToX(min − parameter, max − min)`（`planeOutsideAxis()`）。
- **它自己的诚实缺口**：`default: // degenerate conics not handled` —— 退化圆锥曲线 + 有限实体这条组合它没处理。我们比它多覆盖一点就算赢，但要在文档里说明我们覆盖到哪。
- **对 A1 §5.3 的意义**：我们的"片段环（圆锥曲线弧 + 端面弦）"与它的"四个路径参数"是同一个想法的两种表示；它把弧压在一条圆锥曲线上用参数区间表达，我们用片段列表表达（能同时容纳弦段）。两种都可，我们的表示更一般。

### 1.4 渲染：**段数由当前视图尺度决定**
- `geogebra3D/euclidian3D/draw/DrawConic3D.java`：`updateForItSelf()` 按类型分发到解析绘制器——`updateEllipse` → `brush.arcEllipse(...)`；`updateCircle` → `longitude = brush.calcArcLongitudesNeeded(e1, π, getView3D().getScale())` 然后 `brush.circle(...)`；`updateHyperbola` → `brush.hyperbolaBranch(...)`；`updateParabola` → `brush.parabola(...)`；退化类型各有分支。
- **这是本仓库"按屏幕误差细分"政策的外部同款实现**：曲线是符号存储的（中心 + 正交特征向量标架 + 半轴），段数是**当前缩放算出来的**，既不固定 48 也不烘进几何。A1 §5.6 与之同源，可直接引用。
- 真正无法解析的隐式曲线才走采样：`kernel/implicit/GeoImplicitCurve.java` 用**自适应四叉树**（`AdaptiveQuadTree`，marching-squares 掩码 `MASK = {0x9,0xC,0x6,0x3}`）画成 `GeoLocus` 折线；`implicit3D/AlgoIntersectImplicitSurface.java` 沿直线求根（`SAMPLE_SIZE = 100`）。**GeoGebra 的"糊成一片"就是这条回退路径**——正是用户抱怨的那种东西。

### 1.5 曲面 ∩ 曲面：**只有球 ∩ 球**
- `algos/AlgoIntersectQuadricsAsCircle.java`：球/球时按根轴平面算圆（`x = (d + (r1²−r2²)/d)/2`、`radius = √(r1²−x²)`），含同心、相等半径、相离、相切各分支；**其它所有组合的最后一条语句是 `circle.setUndefined();`**（注释 `// other cases`）。
- 来源确认方式：调研者用 GitHub trees API 枚举了 `geogebra3D/kernel3D/algos/` 的**完整文件列表**（`"truncated": false`，约 190 个文件），其中**没有** `AlgoIntersectQuadricQuadric`。
- 工具 `Intersect Two Surfaces` 只接受两平面 / 两球 / 平面+实体（[文档](https://geogebra.github.io/docs/manual/en/tools/Intersect_Two_Surfaces/)）。
- **结论：在 GeoGebra 3D 里让两个圆柱相交，用户得到的是"未定义"，不是曲线。**

### 1.6 相关论文（存在性确认，正文未读到）
- Trocado / Gonzalez-Vega / Dos Santos, *Intersecting Two Quadrics with GeoGebra*, CAI 2019, DOI 10.1007/978-3-030-21363-3_20（[zbMATH](https://zbmath.org/1434.68718)）。**正文被 Springer/ACM 挡住，算法内容 `NOT CONFIRMED`**；它的存在本身说明"通用二次曲面互交"在 GeoGebra 是研究课题而非内核功能。
- 另有 torus/quadrics 与博士论文两条（`ria.ua.pt/handle/10773/30478`、`/30491`），页面打不开，`NOT CONFIRMED`。

## 2. 其它数学工具

| 项目 | 二次曲面表示 | 平面 ∩ 曲面 | 曲面 ∩ 曲面 | 备注 |
| --- | --- | --- | --- | --- |
| **JSXGraph** | `JXG.Circle3D(center, normal, radius)` 符号存储 + 正交标架，绘成参数曲线 `[c + r(c·f1 + s·f2)]`，域 `[0, 2π]`；半径 NaN ⇒ 不显示（**空交集约定**） | 支持 | 只支持 plane∩plane / plane∩sphere / sphere∩sphere（[官方参考](https://jsxgraph.org/beta/docs/symbols/JXG.Math.Geometry.html)）；**3D 里根本没有 cylinder/cone 元素**（`src/3d/` 只有 sphere3d） | 它的平面曲线求交文档写明了取舍：`meetCurveCurve` 的"分段求交更稳但在切点有问题，阻尼牛顿很快但有时混沌"（`src/math/geometry.js`） |
| **Cindy3D** | 不表示，**片元着色器里光线投射**（`cylinder-frag.glsl` 等；每个圆柱加一个 8 顶点 TRIANGLE_STRIP 包围代理） | — | **完全没有求交曲线对象** | 说明"逐像素光线求交"是一条真实存在的路线（A1 明确不做，理由是拿不到几何对象） |
| **MathBox** | — | — | — | 调研者未读其源码，**无证据**（`NOT CONFIRMED`） |
| **three.js** | 无 CSG 内核；常用 `three-bvh-csg` 是三角形/BSP 布尔，**按构造就是多边形** | — | — | 仅二手讨论页佐证 |

## 3. OpenCascade `IntAna_QuadQuadGeo`：CAD 的参考实现（源码级）

`src/IntAna/IntAna_QuadQuadGeo.cxx`（读的是 V7_6_0 标签）、`IntAna_ResultType.hxx`、[类参考](https://occt3d.com/dev/doc/refman/html/class_int_ana___quad_quad_geo.html)。

- 头注释直接写明契约："Geometric Intersection between two Natural Quadric. **If the intersection is not a conic, analytical methods must be called.**"
- 结果枚举：`IntAna_Point / Line / Circle / PointAndCircle / Ellipse / Parabola / Hyperbola / Empty / Same / NoGeometricSolution`。
- **`NoGeometricSolution` 是"我知道有答案，但我拒绝猜"的显式状态**——这是最值得抄的一个设计（见 §6）。
- **圆柱 ∩ 圆柱**：
  - 平行轴 → `Same`（同轴等半径）/ `Empty` / 1 或 2 条**精确直线**（切向判定 `(4·aR1R1·aSin2) < Tol·Tol`）；
  - 轴相交且 `|R1−R2|/max(R1,R2) ≤ 1e-13` → **`IntAna_Ellipse`，两条精确椭圆**，`param1 = R/sin(A/2)`、`param2 = R/cos(A/2)`（`A` = 两轴夹角）；
  - 轴间距离 = `R1+R2`（容差内）→ 一个相切点；
  - **其它一切 → `NoGeometricSolution`**。
- **⚠️ 更正（同日补充调研）**：`NoGeometricSolution` 只表示**几何类**（`IntAna_QuadQuadGeo`）拒绝作答，OCCT 还有第二个类接着做——`IntAna_IntQuadQuad`（"used when the geometric intersection returns no geometric solution"，圆柱/圆锥对 `IntAna_Quadric`，返回最多 12 条 `IntAna_Curve` 参数曲线 + 触点）与数值追踪的 `IntPatch_ImpImpIntersection`（平面/圆锥/圆柱/球的**补片**求交，输出 `IntPatch_Point` + 追踪出的 `IntPatch_Line`，带 `TolArc`/`TolTang` 与 `IntStatus_OK / InfiniteSectionCurve / Fail`）。**所以正确说法不是"OCCT 不做"，而是"OCCT 有三层：精确几何分类 → 解析四次曲线代数（多周工作量）→ 数值追踪"。** 详见 §9.1。
- 平面 ∩ 圆柱：轴平行于平面 → 1 条切线或 2 条平行线 / 空；否则用**半径缩放的容差** `sint < Tol/radius` 决定"圆"还是"椭圆"（`param1 = radius/cost`、`param1bis = radius`）。
- 平面 ∩ 圆锥：顶点在平面内（`|dist| < Tol`）→ 点 / 1 线 / 2 线；否则按 `cost < Tolang` 双曲线、`|costa| < Tolang` 抛物线、`sint < Tolang` 圆、`cost < sina` 双曲线、其余椭圆（`costa = cost·cosa − sint·sina`，源码注释：判断平面是否含一条母线）。
- 球 ∩ 球：`Alpha = 0.5(R1²−R2²+d²)/d`、`Beta = √(R1²−Alpha²)`，`Beta ≤ myEPSILON_MINI_CIRCLE_RADIUS` 时**降级为一点**（诚实的相切处理）。
- 容差：`InitTolerances()` 里是**绝对**容差（`1e-14`、`Precision::Confusion()` 等），依赖"CAD 模型在归一化单位空间里"这个前提。**调研者没找到明文说明这个前提的 OCCT 文档页（`NOT CONFIRMED`）**——这也是我们不该照抄绝对容差的原因（见 §5）。

## 4. 一个小而可读的 SSI 实现：`sth-v/cmmcore`

- [github.com/sth-v/cmmcore](https://github.com/sth-v/cmmcore) `cmmcore/ssx.h`：NURBS 曲面互交走**层次细分 + 全局相交判定**（包围盒 → `SAT3D` 分离轴 → **Gauss 映射可分离性**判定"这一对补片是单分支、可以安全追踪"→ 否则 4×4 细分递归）；点修正用 `improve_uv`（三个 2×2 子式里挑条件数最好的一个）+ `point_inversion_surface`；`newthon2.h` 是通用修正器（中心差分梯度/Hessian + Cholesky + Levenberg 阻尼 + Armijo 回溯）。
- **必须记档的风险：该仓库 `license: null`（GitHub API 返回），自述 WIP，5 星，最后推送 2024-12-05。只能当阅读材料，不能把代码搬进产品。**
- 有用的可借思想：**"Gauss 映射可分离 ⇒ 单分支 ⇒ 可以追踪"**是一个具体的"什么时候追踪才安全"判据。

## 5. 数值稳健性（有据可依的三条）

1. **容差必须按被比较量的量纲缩放**，三个一手例子：GeoGebra 的 `detS` 对比 `max³ · STANDARD_PRECISION_CUBE`（三次量用立方缩放）；OCCT 平面∩圆柱的 `sint < Tol/radius`（按半径缩放）；OCCT 圆柱∩圆柱的相对半径差 `|R1−R2|/max(R1,R2) ≤ 1e-13`。
2. **不要照抄绝对容差**：OCCT 的 `1e-14` 依赖归一化单位空间；学生在一个作图里建半径 1000 的圆柱、另一个里建 0.01 的，绝对容差必然失效。
3. **精确判定 vs 数值追踪是两种东西**：圆锥曲线分类是系数的高次（三次）判定，可以做到稳；追踪出的折线是一阶、受容差限制的近似。二者在文档与界面里必须区别对待（A1 的 `Conic3.kind` 属于前者）。

## 6. 算法清单与难度（按"课程里真的会出现"排序）

| 情形 | 是否有闭式 | 依据 | 难度 |
| --- | --- | --- | --- |
| 平面 ∩ 圆柱/圆锥 | ✅ 圆锥曲线 | GeoGebra `PᵀQP`；OCCT 分支 | 易 |
| 球 ∩ 球 | ✅ 根轴平面上的圆 | GeoGebra / OCCT 两处 | 易 |
| 同轴 / 平行轴圆柱对 | ✅ 0/1/2 条直线、重合、空 | OCCT 平行分支 | 易 |
| **等半径、轴相交的圆柱对** | ✅ **两条椭圆** `p = R/sin(A/2)`、`q = R/cos(A/2)`（垂直时即 Steinmetz：`x = ±z, y = ±√(r²−z²)`，两平面切出两条圆锥曲线） | OCCT `IntAna_Ellipse`；[MathWorld Steinmetz Solid](https://mathworld.wolfram.com/SteinmetzSolid.html) | 中 |
| **垂直、不等半径圆柱对** | ✅ 闭式参数化 `x = a cos t`、`y = a sin t`、`z = ±√(b² − a² sin²t)`（两支，周期） | [MathWorld Steinmetz Curve](https://mathworld.wolfram.com/SteinmetzCurve.html) | 中 |
| 共轴回转体（球/锥/柱） | ✅ 圆（仅轴平行且重合时） | OCCT 同分支 | 中 |
| 圆锥 ∩ 平面过顶点 | ✅ 点 / 1 线 / 2 线 | OCCT 平面∩圆锥分支 | 易 |
| **一般斜交异半径圆柱对 / 其它四次曲线** | ❌ 四次空间曲线（等半径正交时 `z = ±x` 是特例，仍是两条圆锥曲线；**异半径时 `z` 不是 `x,y` 的线性函数，曲线非平面，不是圆锥曲线**） | 几何类返回 `NoGeometricSolution`；另有解析类与数值追踪（§9.1）；CAI 2019 论文是研究性工作 | 追踪器 = 难；**但可先追踪再吸附成圆锥曲线（§9.2）** |

**追踪器的难度（predictor–corrector）**：得到一条折线是一天的工作；做到"①不漏分支 ②近切时不跳支 ③闭环闭合 ④近相切时行为正确"是 CAD 领域几十年的问题。参考文献存在性已确认（Bajaj/Hoffmann/Hopcroft/Lynch 1988 CAGD；Grandine & Klein 1997 CAGD；Sarraga 1983；Levin 1976；Miller 1987；Sederberg & Meyers 1988 环路检测；Hohmeyer 1991），**但调研者未读到任何一篇全文，因此不得引用其中的说法**。Patrikalakis & Maekawa 的经典教材（Springer 2002, DOI 10.1007/978-3-642-04074-0）**在线版已 404，未读到**。

## 7. 退化清单（A2 的测试面）

- **重合**（同一张曲面）→ 必须报 `Same`，不能静默成空或无穷。
- 同轴等半径圆柱 → `Same`；同轴异半径 → 空。
- 平行轴圆柱：轴距 `> R1+R2` → 空；`= R1+R2` → 一条切线；`∈ (|R1−R2|, R1+R2)` → 两条线；`= |R1−R2|` → 一条切线。
- 等半径轴相交 → **两条椭圆**（不是四次曲线）。
- 沿整条曲线相切（`∇f × ∇g ≡ 0`）——追踪器最坏情形。
- 曲线上的孤立奇点（两梯度在该点平行）。
- 追踪病态：分支在非边界处交叉（经典跳支）、闭环必须闭合且不能追两遍、开曲线止于边界、一对种子出多个连通分量、近相切处收紧或停下并如实报告。

## 8. 未确认清单（**不得当作事实引用**）

CAI 2019 论文正文；`ria.ua.pt` 两条；Patrikalakis & Maekawa 全文；Bajaj 1988 / Grandine 1997 / Sarraga 1983 / Miller 1987 / Sederberg & Meyers 1988 / Levin 1976 全文（仅经索引确认存在）；Hohmeyer 1991 的出处（只有 dblp 作者索引）；MathBox（无证据）；three.js CSG 插件的源码级结论（只有二手页）；"二次曲面束 `det(Q1 + λQ2) = 0` 的退化成员"这一手（数学上是标准的，但本次没有读到来源）；Trocado 的工作是否曾进入 GeoGebra 主线（已发布内核的证据说没有通用算法，但不能排除插件）。

## 9. 补充调研（同日第二份，四改三补）

### 9.1 更正：OCCT 的三层结构

- 几何类：[`IntAna_QuadQuadGeo`](https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/master/src/ModelingData/TKGeomBase/IntAna/IntAna_QuadQuadGeo.cxx)（精确分类，只给圆锥曲线类结果）。
- 解析类：[`IntAna_IntQuadQuad`](https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/master/src/ModelingData/TKGeomBase/IntAna/IntAna_IntQuadQuad.hxx) —— 头注释写明它是给几何类"没有几何解"时用的；圆柱/圆锥 × `IntAna_Quadric`，输出最多 **12 条 `IntAna_Curve`**（`HasNextCurve` / `NextCurve` 链式）＋最多 2 个触点 + 显式曲面上的参数。**这是"解析四次曲线代数 + 分支记账"，也是移植成本最高的那块（多周量级）。**
- 数值类：[`IntPatch_ImpImpIntersection`](https://raw.githubusercontent.com/Open-Cascade-SAS/OCCT/master/src/ModelingAlgorithms/TKGeomAlgo/IntPatch/IntPatch_ImpImpIntersection.hxx) —— 平面/圆锥/圆柱/球的**补片**求交，输出追踪出的 `IntPatch_Line`（带 `TolArc` / `TolTang`）与状态 `IntStatus_OK / InfiniteSectionCurve / Fail`。

**对 A2 的意义**：话术要改——不是"做不到"，而是"能追踪、暂时不能精确，OCCT 的精确版本要移植多周"。

### 9.2 最值得抄的一条：先近似追踪，再**吸附**成精确圆锥曲线

BRL-CAD `src/libbrep/intersect.cpp`（[raw](https://raw.githubusercontent.com/BRL-CAD/brlcad/main/src/libbrep/intersect.cpp)，文件自述"Implementation of intersection routines openNURBS left out"）里的 `curve_fitting()`：

1. 先对追踪出的折线做直线拟合；
2. 取样 **6 个点**，用 `ON_GetConicEquationThrough6Points` 解出过这 6 点的圆锥曲线；
3. 用 `ON_IsConicEquationAnEllipse` 判类型；
4. **如果所有采样点都在容差内**，就把整条曲线**重新表示成精确的 `ON_Ellipse`**；拟合不通过就退回折线。

**为什么这条对我们价值最高**：等半径双圆柱、以及所有平面切割，几乎都会吸附成功——于是用户看到的是真圆 + 解析细分，而我们**不必实现完整的二次曲面配对分类器**。它同时也是"诚实"的：拟合有明确的验证步骤（全部采样点都在容差内才提升），不通过就如实退回折线。

### 9.3 精确分类的现成参考（比自己手写更稳）

David Eberly, **Geometric Tools**，Boost 1.0 许可（**可以合法移植**）：[`GTE/Mathematics/QuadricSurface.h`](https://raw.githubusercontent.com/davideberly/GeometricTools/master/GTE/Mathematics/QuadricSurface.h) 用 `C + BᵀX + XᵀAX` 表示一般二次曲面，`GetClassification()` 给 16 种情形（ELLIPTIC_CYLINDER / HYPERBOLIC_CYLINDER / PARABOLIC_CYLINDER / ELLIPTIC_CONE / HYPERBOLOID_ONE_SHEET / TWO_SHEET / ELLIPSOID / TWO_PLANES …），**关键是它用精确有理数（`BSRational<UIntegerAP32>`）+ 笛卡尔符号法则做分类，不用 epsilon**；说明见 [Classifying Quadrics](https://www.geometrictools.com/Documentation/ClassifyingQuadrics.pdf)。TS 侧要移植就得配一个小的 `BigInt` 有理数层，但**只需要用在分类这一步**。
（另：GTE 里 `IntrCylinder3Cylinder3.h` 只有布尔 SAT 判定，没有曲线；`IntrQuadric3Quadric3.h` / `IntrQuadric3Plane3.h` 是 404——GTEngine 没有一般二次曲面配对求交类。）

### 9.4 可直接对照的小型闭式例程

openNURBS / Rhino `opennurbs_intersect.cpp`（[raw](https://raw.githubusercontent.com/mcneel/opennurbs/8.x/opennurbs_intersect.cpp)）里有这些各自 30-80 行的重载，可当**规格说明**用来交叉校验我们自己的实现：`ON_Intersect(Plane, Sphere, ON_Circle&)`、`(Line, Sphere, A, B)`、`(Line, Cylinder, A, B)`（在柱面坐标系里对直线参数解二次）、`(Circle, Circle, P0, P1)`、`(Sphere, Sphere, ON_Circle&)`（圆 / 点 / 0 / 3=同一球）。**该文件头写的是 "AS IS"，许可证未声明——不要照抄，自己写。**

### 9.5 负面结果（省得再花时间）

- **SISL**（AGPL-3.0，商用不可用）：`s1859.c` 的 B 样条曲面互交是"细分到简单问题再牛顿迭代"，输出参数域点序列 = 折线，**没有任何二次曲面配对特例**。
- **SingSurf**（Java）：`IntersectionClip.java` 是网格裁剪算子（按符号翻转逐边二分再重新三角化），需要先有网格，不可用。它的 `EulerMethodIC` / `HeunMethodIC` / `MidpointMethodIC` / `RC4MethodIC` 若将来真要写 predictor-corrector，可当模板。
- `aygxywlw/Surface-Intersection`：无许可、7 KB、源码不可读，且自述是"NURBS 曲面 ∩ 平面"的 CNC 剖切，无关。
- **没有任何纯 JS / Dart / WASM 库做精确二次曲面互交**；libfive 是等值面/CSG，不是 SSI。
- CindyJS 的补充：光线投射的二次曲面着色器是真的（`plugins/cindy3d/src/js/Cylinders.js` 的着色器接线由调研者自己读过），示例在 `examples/cindygl/44_raycasting_symbolic.html` 与 `44_raycasting_aberth.html`（后者在着色器里做 Aberth-Ehrlich 多项式求根，示例路径经搜索/提交元数据确认，未逐行读）。**无论如何它没有求交曲线 API。**

### 9.6 双圆柱最终结论

- **轴相交、等半径 → 恰好两条平面椭圆**（OCCT `IntAna_Ellipse` ×2，半轴 `R/sin(A/2)` 与 `R/cos(A/2)`）；正交时 `x = a cos t, y = a sin t, z = ±√(b²−a²sin²t)` 退化为 `z = ±x`，仍是两条圆锥曲线。
- **异半径 → 曲线不是圆锥曲线**：`z` 不是 `x,y` 的线性函数，曲线非平面，是四次空间曲线（MathWorld 的异半径 Steinmetz 体积要用完全椭圆积分）。精确处理只存在于 OCCT（`IntAna_IntQuadQuad` 解析 / `IntPatch` 数值）。
- **对推荐的影响**：第 1-5 阶段不变；第 6 阶段多了一个更便宜的选项——先只做 (a)-(e) 闭式情形 + **§9.2 的吸附**，就能把用户看到的折线几乎清干净，而不必移植任何四次代数。
