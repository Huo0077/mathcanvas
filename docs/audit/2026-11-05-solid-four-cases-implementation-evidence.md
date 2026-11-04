# 11 月 5 日四道立体几何题：实施证据（逐阶段记录）

- 计划：[逐任务实施计划](../superpowers/plans/2026-11-05-solid-geometry-four-cases.md)
- 设计：[修复设计与报告复核](../superpowers/specs/2026-11-05-solid-geometry-four-cases-design.md)
- 原报告：[2026-11-05 原报告归档](2026-11-05-solid-geometry-four-case-report.md)
- 仓库根：`D:\draw\draw`。本文件**只记录实际跑过的读数**；没跑的东西写"未运行"，不写成通过。

> **记录纪律**：每一块（T1–T8）落地后追加一节，写清 **HEAD、命令、原始读数、改了哪些文件、
> 哪些验收项仍未完成**。历史读数只对它当时的那个 HEAD 有效。

---

## T1 —— 四题可重复基线与证据

### 1. 执行基线

| 项 | 值 |
|---|---|
| 计划编写基线 | `ebccf313` |
| T1 执行前 HEAD | `ebccf313` |
| 执行前已有改动 | 三个未跟踪文档（原报告 / 设计 / 计划），无已修改的已跟踪文件 |
| 新增文件 | `packages/agent-core/src/fixtures/solidGeometryFourCases.ts`、`packages/agent-core/src/solidGeometryFourCases.test.ts` |

### 2. 已有 66 测试基线重跑

```text
npx vitest run packages/agent-core/src/lengthEquality.test.ts \
  packages/agent-core/src/solver/shapeGrammar.test.ts \
  packages/agent-core/src/solver/trapezoidPrism.test.ts \
  packages/agent-core/src/solver/examSolidVariants.test.ts \
  packages/geometry-kernel/src/pointNames.test.ts
```

结果：**5 文件 / 66 项通过，exit 0**。这与设计 §6 记录的 66 项一致 —— 定向基线没有被这轮改动碰坏。
它**只**说明既有能力，**不是**四题验收结果。

### 3. 最小复现清单（四题逐阶段实况）

跑法：`npx vitest run packages/agent-core/src/solidGeometryFourCases.test.ts`。
链路与产品一致：`parseObligationWithLegacy → specForPrompt → searchWitness`
（`searchWitness` 内部走 `compilePlan` 与 `verifyDiagramObligations`）。

| 题 | 解析（givens / 残留） | 形状描述 | 构造 + 编译 + 核验 | 卡在哪一层 |
|---|---|---|---|---|
| Case 1 直角梯形底棱锥 | 10 条 / 0 条 | `ok`：pyramid，底环 A B C D，顶点 P，垂足 A，无自由标量 | `unverified_instance` | **T5 命名分点**：`E` 没有落到 `PB` 上（`点名缺失：E`）。底面几何仍走"矩形"分支，`CD=1` 会与它冲突 |
| Case 2 正三棱柱 | 5 条 / 0 条 | `unrecognised` | 未开始 | **T2 入口层**：顶环 `A₁B₁C₁` 与内核 `A′` 命名约定对不上 ⇒ 形状从句整句返回 `null` |
| Case 3 菱形底棱锥 | 4 条 / **2 条残留** | `unrecognised` | 未开始 | **T4 派生垂足**：`PO⊥平面ABCD` 的两个端点都不在平面内（`O` 不是环顶点）。另有两条解析残留：`AC与BD相交于点O`、`底面ABCD是边长为2的菱形` |
| Case 4 原题 翻折 | 8 条 / 0 条 | `unrecognised` | 未开始 | **T6 翻折入口**：`在直角梯形ABCD中` 不在现有入口词表里；原题另有 `D→P` 与 `CD` 折前/折后的歧义 |
| Case 4 修订版 | 8 条 / 0 条 | `unrecognised` | 未开始 | 同上（与原文是两份固定题面，互不覆盖） |

**已经通过、只补回归、不重复实现的两项**（计划 T1 明说"若某项已经通过，只加回归"）：

1. **连等式展开**：`PA=AB=AD=2` 已被 `parseLengthChains` 展开成 3 条 `fixedLength` +
   2 条 `equalLength`（`AD=CD=1` 同理）。原报告"只解析首段赋值"的判断**不成立**。
2. **`如图，` 前缀**：`SHAPE_CLAUSE` 未锚定开头，Case 1 带前缀照样认出来了。
   原报告"`如图` 会导致入口失败"的判断**不成立**。

### 4. 两入口与浏览器

| 项 | 状态 |
|---|---|
| 本地确定性入口（`specForPrompt → searchWitness`） | 已跑，读数见上表 |
| 模型入口（离线桩） | **未运行**。它共用 `compilePlan`，按计划在 T7 一并验；本轮不拿本地读数冒充模型路径 |
| 浏览器 / Playwright | **未运行**。按计划在 T8 验；本轮不写"已通过" |
| 在线模型（`npm run eval:explicit-solid`） | **未运行**（费用/密钥另议，且它不是离线验收的替代品） |

### 5. T1 的断言形态（重要）

`solidGeometryFourCases.test.ts` 在 T1 阶段是**特征化基线**（characterization）：断言的是"今天的实况"，
让 T2–T7 每一刀都知道自己在改哪一格。**这些"实况 = 缺口"的断言会按任务逐条替换成目标断言**
（T2 → Case 2/4 入口；T3 → Case 1 底面；T4 → Case 3 垂足；T5 → 命名分点；T6 → 翻折；T7 → 目标证据）。
**最终验收时本文件不得残留任何"预期失败"的断言** —— 计划 §Global Constraints 的"不得把断言永久改成
预期报错来让测试变绿"由最后一节逐条核对。

### 6. T1 仍未完成

- 四题都还**没有**任何一道走通"题设通过 + 草稿可提交"的完整链路（这是 T2–T7 的活）。
- Case 4 的澄清文案与"用户回答后修订版可成图"**未实现**。
- 浏览器提交/撤销、模型入口离线桩**未验证**。

### 7. T1 判定

T1 的验收是"每项缺陷有固定题面、当前错误和期望，后续任务知道修哪一层"，**不要求**产品红测已修好。
本节的表格满足它。checklist 的四条（固定题面 / 产品集成断言 / 保存失败阶段 / 66 基线）已落。

---

## T2 —— 入口与关系保真

### 1. 执行基线

| 项 | 值 |
|---|---|
| T2 执行前 HEAD | `75059e23`（T1 提交） |
| 改动的文件 | `packages/agent-core/src/solver/shapeGrammar.ts`、`packages/agent-core/src/solver/witnessSearch.ts`、`packages/geometry-kernel/src/witness/constructors.ts`、`packages/agent-core/src/solver/shapeGrammar.test.ts`、`packages/agent-core/src/solidGeometryFourCases.test.ts` |

### 2. RED（先跑出来的缺口）

```text
npx vitest run packages/agent-core/src/solver/shapeGrammar.test.ts
```

5 条新用例失败：`ABC-A₁B₁C₁` 整句 `null`（顶环对应规则写死 `A′`）、`四棱锥P-ABCD中`（缺「在」）不认、
`以…为底面的四棱锥…中` 不认、`A_1` / `A_{1}` 排版变体不认、`P-ABCA` 重复点被收下。

### 3. 改了什么（只补入口与命名，不新造解析器）

1. **顶环后缀规则**（`shapeGrammar.ts`）：判据从"必须等于 `A′`"改成"**底环点名 + 同一个后缀**"，
   后缀收撇号与下标 1–6；混写（`A₁B′C₁`）与点数不同一律问路，**题面原名原样保留**
   （设计 §4.3"不让默认 `A′` 覆盖已给 `A₁`"）。
2. **有边界的下标归一**：`A_1` / `A_{1}` → `A₁`。ASCII `A1` **仍不认**（`pointNames` 的既有裁决），
   `A_10` 不归一。
3. **形状从句的两处语法边界**：`在` 可省；允许 `以…为底面的` 前缀（限 24 字，不吞后续题设）。
   正则不再把修饰词与数词吃掉（既有行为不变）。
4. **环内重复点**（`P-ABCA`）：`ringOf` 直接问路，不把同一个点收进环两次。
5. **正 / 直棱柱的 spec**（`witnessSearch.ts` 的 `specForRightPrism`）：`正` / `直` 修饰词 +
   入口语法给出的两个环 ⇒ 侧棱竖直是题面说的，不再报"没有给出侧棱⊥底面"。
   **没写修饰词、也没有"侧棱 ⊥ 底面"时仍然问路**（不替题面挑形状）。
6. **内核接受题面顶面点名**（`constructors.ts`）：`PrismConstructRequest.topNames` 可选；
   省略 = 原有 `withPrimes` 行为逐字不变。`spec.top` 是完整顶环时才传。

### 4. GREEN 读数

```text
npx vitest run shapeGrammar.test.ts lengthEquality.test.ts explicitSolidConditions.test.ts \
  witnessSearch.test.ts examSolidVariants.test.ts trapezoidPrism.test.ts \
  pointNames.test.ts constructors.test.ts solidGeometryFourCases.test.ts
```

**9 文件 / 227 项通过，exit 0**（含 `constructors.test.ts` 71 项：顶面命名的既有契约没被打破）。

`solidGeometryFourCases.test.ts` 里 Case 2 的阶段读数推进为：

| 阶段 | T1 | T2 |
|---|---|---|
| 解析 | 5 条 / 0 残留 | 5 条 / 0 残留 |
| 形状 | `unrecognised` | **`ok`**：prism，底环 `ABC`，顶环 **`A₁B₁C₁`** |
| 搜索 | 未开始 | `unverified_instance`：`点名缺失：D`、`点名缺失：E`（T5 的活） |

另外两条关系保真断言落了：**连等式每条长度都进题设**（Case 1 四条、Case 4 三条）、
**`BE=1` 是定长而不是中点**（中点只有 `D`），以及**目标不进入 givens**、**读不出的条件继续显形**。

### 5. 这一块**没有**做的

- **Case 2 的底面还不是正三角形**：`正三棱柱` 的"正"目前只用于判定"侧棱竖直"，
  底面仍走"普通三角形代表值"（`AC` 是自由标量）。这是 T3 的活（底面解析构造）。
- Case 4 的 `直角梯形` 入口、Case 3 的菱形/交点两句、四题的命名分点，都仍未动。

### 6. T2 判定

计划 T2 的五条 checklist 全落：参数化入口测试、Case 1/4 连等式与 `BE=1` 断言、RED 记录、
最小补语法（复用 `parseLengthChains` / `splitPointNames` / `canonicalPointName`，没有另造解析器）、
同命令复跑 + 残留断言。

---

## T3 —— 扩展既有底面解析构造（直角梯形 / 显式菱形角）

### 1. 执行基线

| 项 | 值 |
|---|---|
| T3 执行前 HEAD | `75059e23`（T1）＋ T2 的未提交改动 |
| 新增文件 | `packages/geometry-kernel/src/witness/basePolygons.ts`、`basePolygons.test.ts` |
| 改动的文件 | `witness/constructors.ts`、`witness/constructors.test.ts`、`geometry-kernel/src/index.ts`、`agent-core/src/solver/witnessSearch.ts`、`agent-core/src/solidGeometryFourCases.test.ts`、`agent-core/src/planCompiler.test.ts`（见 §5） |

### 2. 这一块真正缺的是什么

T1 的基线读数已经把两个缺口钉死，T3 就是把它们变成断言并修掉：

| 输入 | 修之前的实况 | 为什么是缺陷 |
|---|---|---|
| Case 1 底面：`AB ∥ CD`、`AD ⊥ AB`、`AB=AD=2`、`CD=1` | 落进"环首直角 ⇒ 矩形"那一支，`C=(2,2)`、`CD=2` | **静默建成矩形**：`CD` 的长度在那个分支里根本没被用上，候选随后在核验器上因 `CD=1` 失败 |
| `正三棱柱` 的底面 | 边长 `AB=2` 给定，`BC` 是**自由标量**（2 或 3 任选） | 题面说"正三棱柱"，画出来的却是斜三角形底 |
| 菱形 + `∠BAD=75°` | 一律取代表角 60° | 75° 的题被静默画成 60°（60° 的题恰好命中，看不出问题） |

RED 的形态：`basePolygons.test.ts` 的 9 条用例与 `constructors.test.ts` 的新增 7 条用例。
（诚实记录：`basePolygons.ts` 与它的单测是同一步写的，其中 2 条失败是**我自己的期望值写错**
——45°/135° 那个三角关系；真正的能力 RED 是 T1 基线里那三格，不是这两个单测。）

### 3. 改了什么

1. **`basePolygons.ts`（新）**：只做"数值 → 坐标"的纯计算，两类：
   - `rightTrapezoidPolygon({ width, height, top })` ⇒ `A(0,0) B(w,0) C(top,h) D(0,h)`；
   - `rhombusPolygon({ side, angleDegrees })` ⇒ `A(0,0) B(s,0) D(s·cosθ,s·sinθ) C=B+D`。
   两者都对零/负/非有限/0°–180° 之外给出**结构化拒绝**，且把浮点噪声按回 0（不放宽内核守卫）。
2. **`constructors.ts`**：
   - `rightTrapezoidEdges(names, relations)`：**按环上任意顶点**找"直角 + 一组平行边 + 另一组不平行"，
     返回 `AB`/`AD`/`CD` 三条成形边。**再点一个直角（`AB⊥BC`）就跳过** —— 那是矩形的活，不抢。
   - `deriveRightTrapezoidBase`：三个长度各自独立（题面给就用题面，没给取代表值），
     坐标按"直角顶点在环上的位置"**旋转回题面环序**，所以 `BCDA` 这种循环点序也认。
   - `deriveRegularTriangleBase`：`AB=BC=CA` 链式关系 ⇒ 正三角形（`AB=2` 就三条边都是 2）。
   - `deriveRhombusBase`：角度来源分成两路 —— 题面给了角就用题面的角（**不写进 `freeValues`**，
     因为那一列的含义是"系统替你定了什么"），没给才取代表角 60°。邻角写法按 `180° − θ` 换算，
     矛盾的角、对角线上的角、0°/90°/180° 全部拒绝。
3. **`witnessSearch.ts`**：`specForRightPrism` 在 `正` + 三角形底时补三条 `equal-length`，
   并且**先补齐关系再算自由标量**（否则 `BC` 仍会被说成系统自选）；
   `orderedBaseWithFreeEdges` 对直角梯形只把 `AB`/`AD`/`CD` 里**题面没给**的列为自由边，
   对正三角形只留一条边。
4. **`planCompiler.test.ts`**：那条"读不出的台体题面"原以 `ABCD-A₁B₁C₁D₁` 举例，
   而 T2 之后 `A₁` 顶环**已经能认** —— 前提不成立，改用后缀不一致的 `ABCD-A₁B₁C₁D₂`，
   断言本身（兜底理由必须是台体自己的）不变。

### 4. GREEN 读数

```text
npx vitest run packages/geometry-kernel packages/agent-core --maxWorkers=3
```

**240 文件 / 2724 项通过，exit 0**（其中 `constructors.test.ts` 78、`basePolygons.test.ts` 9、
`solidGeometryFourCases.test.ts` 10）。

`solidGeometryFourCases.test.ts` 新增的 T3 断言（**自己量**，不读构造方自述）：

| 题 | 断言 |
|---|---|
| Case 1 | `AB=2`、`AD=2`、`CD=1`、`AD⊥AB`、`AB∥CD`、`BC≠AD`（不是矩形）、底面 z=0、`P` 在 A 正上方 2 |
| Case 2 | `AB=BC=CA=2`（正三角形）、`AA₁=3` 且竖直、顶面点名是 `A₁B₁C₁` 而不是 `A′B′C′` |

### 5. 这一块**没有**做的

- **`正四棱柱` 的底面（正方形）**：四边相等在现有规则里先落到"菱形"那一支（代表角 60°），
  那是另一个形状。本批只在**三角形**底上补"正 ⇒ 正三角形"，四边形的"正"留给后续。
- 直角梯形的**其它平行组合**（`AD ∥ BC` 那一种已有独立分支，不是本期目标）未动。
- 菱形 + 显式角只覆盖**底环上的内角**；对角线上的角按"不支持"如实拒绝（不猜）。

### 6. T3 判定

计划 T3 的六条 checklist 全落；能力边界如实写在上面。原报告"必须新增两种公开宏动作"的判断
没有采用 —— 这一批全部走既有 `solid.create_polyhedron` / 既有 spec，没有新增动作。

---

## T4 —— 底面内部派生垂足（Case 3 的 `O`）

### 1. 执行基线

| 项 | 值 |
|---|---|
| 新增文件 | `packages/geometry-kernel/src/witness/derivedBasePoints.ts`、`.test.ts` |
| 改动的文件 | `witness/solidShapeSpec.ts`、`witness/constructors.ts`、`agent-core/src/solver/witnessSearch.ts`、`solver/solverContracts.ts`、`diagramObligations.ts`、`apps/web/src/agent/localPlanner.ts`、`solidGeometryFourCases.test.ts` |

### 2. 这一块真正缺的是什么

修之前 Case 3 的读数（T1 记录）：**4 条题设 + 2 条残留**，形状描述 `unrecognised`，
理由是"`PO ⊥ 平面ABCD` 的两个端点都不在所点名的平面内"。两层缺口：

1. **解析层**：`AC 与 BD 相交于点 O` 与 `底面 ABCD 是边长为 2 的菱形` 两句都读不出（残留）；
2. **构造层**：`constructPyramidWitness` 要求垂足**必须是底面环顶点**，`O` 不是环顶点 ⇒ 拒绝。

把 `O` 换成 `A`（顶点位置变了）或把 `O` 塞进底环（底面多一个顶点）都是改题面 —— 这条纪律写在
`derivedBasePoints.ts` 的头注释里。

### 3. 改了什么

1. **解析层（`diagramObligations.ts`）**：
   - 菱形读取器补两处语法：`底面` 前缀、`边长为 N 的` 定语；给了边长再补一条 `fixedLength`。
   - 新增"对角线交点"读取器：`AC 与 BD 相交于点 O` ⇒ **两条** `pointOnSegment`（`O∈AC`、`O∈BD`）。
     **不新增判据种类** —— 两条都成立就是"这两条线段相交于 O"，核验器零改动。
2. **spec 层（`solidShapeSpec.ts`）**：新增 `DerivedBasePoint`（`name` + `kind` + `lines`）与
   可选字段 `derivedBasePoints`。**底面环不变**。
3. **内核（`derivedBasePoints.ts`）**：解对角线交点。拒绝：引用缺失、重名、自引用、
   平行/重合、交点不在两条线段内部、两条线异面。
4. **内核（`constructors.ts`）**：`constructPyramidWitness` 先解底面 → 再解派生点 → 再放顶点；
   垂足可以是环顶点**或**派生点。派生点作为 `auxiliaryPoints` 带 `hostEdge` + `parameter` + `source`
   返回，**不进 `names`/`points`**（那两列与 `faces` 共用下标空间，塞进去会报 `unused-vertex`）。
   `deriveApexHeight` 的侧棱定长分支改成按"已知点"判（派生点也算已知），
   `PO=√3` 于是走 `h = √(L² − 0²) = L`。
5. **落盘（`witnessSearch.ts` + `localPlanner.ts`）**：新增 `auxiliaryPointActions` /
   `solidWitnessActions`，把辅助点落成 `dynamic.create_bound_point`：
   - 宿主是多面体的一条棱 ⇒ 直接 `hostEdge` 绑定；
   - 宿主是对角线 ⇒ 先建那条线段再绑定（O 落在 `A→C` 上、参数 1/2）。
   见证搜索（`envelopeFor`）与产品入口（`localPlanner` 两处）**共用同一份**动作链。

### 4. GREEN 读数

```text
npx vitest run witnessSearch.test.ts diagramObligations.test.ts solidGeometryFourCases.test.ts \
  planCompiler.test.ts apps/web/src/agent/localPlanner.test.ts packages/geometry-kernel/src/witness
```

**9 文件 / 412 项通过，exit 0**。

`solidGeometryFourCases.test.ts` 的 Case 3 读数推进为：

| 阶段 | T1 | T4 |
|---|---|---|
| 解析 | 4 条 / **2 条残留** | 10 条 / **0 条残留**（菱形 ⇒ 3 等长 + 1 边长；交点 ⇒ 2 条点在线上） |
| 形状 | `unrecognised` | **`ok`**：pyramid，底环 `ABCD`，顶点 `P`，垂足 **`O`** |
| 构造 | 未开始 | 四个底点 + `P`；**辅助点 `O`** 在 `AC` 上参数 1/2 |
| 核验 | 未开始 | 只有 `点名缺失：M`（T5 的活）—— 其余题设全部通过 |

内核层另有独立断言（不看构造方自述）：底面四边都等于 2、`∠BAD=60°`、
`O` 同时是 `AC` 与 `BD` 的中点（两条对角线交点）、`P` 在 `O` 正上方且 `PO=√3`、底面 z 全为 0。

### 5. 这一块**没有**做的

- `M 为 PC 的中点` 仍未被构造（T5 的命名分点）。
- 派生点只在**菱形底情形**走通了整条链；一般四边形的对角线交点没有单独回归。
- 浏览器里"辅助点可见、绑定点跟随宿主"未验（T8）。

---

## T5 —— 确定性计划适配与命名分点

### 1. 执行基线

| 项 | 值 |
|---|---|
| 新增文件 | `packages/agent-core/src/parametricSolidPlan.ts`、`parametricSolidPlan.test.ts` |
| 改动的文件 | `witness/constructors.ts`（+ `.test.ts`）、`agent-core/src/solver/witnessSearch.ts`、`solver/solverContracts.ts`、`agent-core/src/index.ts`、`apps/web/src/agent/localPlanner.ts`、`solidGeometryFourCases.test.ts`、`witnessSearch.test.ts`（见 §5） |

### 2. 这一块真正缺的是什么

T4 之后，Case 1/2/3 的搜索仍然停在 `点名缺失：E / D / M`。缺的不是坐标，而是**"题面点名的
辅助点"没有任何出口**：

- 内核的候选只有 `A…D`（+ 顶点），`E` 为 `PB` 中点这件事**不进候选**；
- 见证候选 → 动作用的是**单个** `solid.create_polyhedron`，没有地方放第二个点；
- 两个产品入口（`localPlanner` 的两支）各写一遍这条动作链。

### 3. 改了什么

1. **内核关系词表 +2**（`WitnessRelation`）：`midpoint` 与 `point-on-segment`。
   `kernelRelations` 把 `midpoint` / `pointOnSegment` 义务翻过去。它们**不参与底面定形**
   （`deriveBasePolygon` 只读它认得的那几档）。
2. **内核 `resolveNamedPointRelations`**：按**最终坐标**算辅助点：
   - 中点 ⇒ 参数 `1/2`；
   - 棱上点 ⇒ `t = 距离 / |宿主|`；题面从**另一端**给长度时换算成 `1 − d/|宿主|`
     （`EB₁=2` 与 `BE=1` 必须落到同一处）。题面只说"在棱上"、没给长度 ⇒ **不落点**；
   - 参数不在 `(0,1)` 内 ⇒ `degenerate-base`；与已有顶点重名 ⇒ `duplicate-name`。
3. **`assembleCandidate` 统一挂辅助点**：派生点（T4 的 `O`）与命名点（T5 的 `D/E/M`）走
   **同一条** `auxiliaryPoints` 通道 —— 都不进 `names`/`points`/`faces` 的下标空间。
4. **落盘统一**（`auxiliaryPointActions` / `solidWitnessActions`）：
   宿主是多面体的一条棱 ⇒ 直接 `hostEdge` 绑定；是底面对角线 ⇒ 先建线段再绑定。
5. **`parametricSolidPlan.ts`（新）**：题面 → spec → 见证候选 → 动作链收成**一处**，
   两个产品入口都从 `tryBuildParametricSolidPlan` 取。`solidShapeIntentFor` 里那段
   自己拼动作的代码删掉，改调它（`localPlanner` 的行为因此与见证搜索完全同步）。

### 4. GREEN 读数

```text
npx vitest run packages/agent-core/src/parametricSolidPlan.test.ts \
  packages/agent-core/src/solidGeometryFourCases.test.ts \
  packages/geometry-kernel/src/witness/constructors.test.ts
```

- `parametricSolidPlan.test.ts` **8 项通过**（Case 1/2/3 全链、反向边、宿主跟随、负测）；
- `solidGeometryFourCases.test.ts` **11 项通过** —— **Case 1/2/3 全部 `verified_instance`**；
- `constructors.test.ts` **83 项通过**（含 T5 新增 5 项）。

四题阶段读数（终态）：

| 题 | 解析 | 形状 | 搜索 | 辅助点 |
|---|---|---|---|---|
| Case 1 | 10 条 / 0 残留 | `ok` pyramid ABCD/P | **`verified_instance`** | `E@PB:1/2` |
| Case 2 | 5 条 / 0 残留 | `ok` prism ABC/A₁B₁C₁ | **`verified_instance`** | `D@AC:1/2`、`E@BB₁:1/3` |
| Case 3 | 10 条 / 0 残留 | `ok` pyramid ABCD/P(foot O) | **`verified_instance`** | `O@AC:1/2`、`M@PC:1/2` |

`parametricSolidPlan.test.ts` 从**编译后的文档**里自己量：

- 三个案例都 `compilePlan.ok === true` 且 `diagramVerification.status === "passed"`；
- `E`/`D`/`M`/`O` 的 `binding.kind === "onHost"`（**绑定点**，不是自由点），参数分别是
  `1/2`、`1/2`、`1/2`、`1/2`、`1/3`；
- 动作链里 `E` 的 `hostEdge` 就是 `{from:"B", to:"B₁"}`；
- **宿主动了绑定点跟着走**：整只实体沿 +z 平移 3，`E` 也沿 +z 移动 3，参数不变。

### 5. 两处既有测试的断言**方向**改了（说明理由）

1. `witnessSearch.test.ts` 的 `PYRAMID_MIDPOINT`（`O为BD的中点`）原先钉的是"中点没有出口 ⇒
   未核验"。T5 把它变成了可核验 —— 断言改为 `verified_instance` + 绑定在 `BD` 上参数 1/2，
   **同时保留**"判性不明的条件仍然不许升格"那半条（合成一条 `judgeability: "ambiguous"` 的
   `proposition` 义务，结果仍是 `unverified_instance`）。
2. `planCompiler.test.ts` 的台体题面在 T2 已改（见 T3 §3.4）。

这两处都是**能力变化**，不是为了让测试变绿而放宽判据。

### 6. 这一块**没有**做的

- `segmentRatio`（`AE:AD=2:5` 这类**比例**写法）还没有映射成辅助点；当前只认中点与
  "定长/边长"两种。
- 辅助点的**参数滑块**（`parameterId`）没有接 —— 落盘用的是固定 `parameter`。
- 浏览器里"辅助点可见、拖动宿主后仍正确"未验（T8）。

---

## T6 —— 梯形翻折、显式状态及一次澄清

### 1. 执行基线

| 项 | 值 |
|---|---|
| 新增文件 | `packages/agent-core/src/polygonFoldPlan.ts`、`polygonFoldPlan.test.ts` |
| 改动的文件 | `agent-core/src/index.ts`、`agent-core/src/solver/witnessSearch.ts`（导出 `kernelRelationsFromObligations`）、`apps/web/src/agent/localPlanner.ts`（+ `.test.ts`）、`solidGeometryFourCases.test.ts` |

### 2. 这一块的判据（为什么原题**不能**出图）

原题有两处必须由用户说清：

1. 「将 △ACD 沿 AC 折起成 △PAC」按**有序顶点**读会移动折痕端点（`A→P`、`C→A`、`D→C`）；
   通常意图是 `D→P`，但题面没有明说；
2. 目标里的 `CD`：折前的那条线段，还是折后 `CP`？

两者任一没说清 ⇒ **一条**合并澄清（不是两轮追问），且**不出计划**。明确修订版
（"点 D 绕 AC 旋转 90° 得到 P" + "CD 指折前"）才建立数值验收。

### 3. 改了什么

1. **`polygonFoldPlan.ts`（新）**：
   - 只认 3 种折起写法，`destinationExplicit` 只在 **apex-to-point** 语序（"点 D 绕 AC 旋转
     n° 得到点 P"）为真 —— `折起成 △PAC` 只说明折后三角形的三点，**不算**把 `D→P` 说死；
   - 折角：明写 `n°`，或"平面…⊥平面…"这条确定的 `90°`；两样都没有 ⇒ 问折角（不默认）；
   - 底面复用 **T3** 的 `rightTrapezoidEdges` + `rightTrapezoidPolygon`，不另写一套梯形；
   - 折后位置用既有的 `foldPointAboutHinge`（Rodrigues）；镜像由 `branch = ±1` 决定；
   - 出计划前**自检**：折痕不动、折片刚性、转过的角等于给定角（不通过就澄清，不出半对的图）；
   - 动作：`solid.create_face`（固定片）+ `solid.fold`（折片）。`M 为 PB 中点` 落成
     `solid.create_segment` + `dynamic.create_bound_point`（**绑定点**，参数 1/2）。
2. **`localPlanner`**：新增 `POLYGON_FOLD` 意图（`梯形` + 折起/翻折/旋转/折前，`allowWhenAsking`），
   三种终态（plan / clarification / 不支持）各自翻译成信封。
3. **`kernelRelationsFromObligations` 导出**：翻折层读的是**同一份**题设翻译，不另抄一张表。

### 4. GREEN 读数

```text
npx vitest run polygonFoldPlan.test.ts solidGeometryFourCases.test.ts localPlanner.test.ts
```

**3 文件 / 90 项通过，exit 0**；矩形折叠回归
`rectangleFold / rectangleFoldPlan / rectangleFoldStateVerification / foldChain.sequence / userFoldClauses`
**5 文件 / 66 项通过**。

`polygonFoldPlan.test.ts`（5 项）从**编译后的文档**自己量：

| 断言 | 结果 |
|---|---|
| 原题 ⇒ 一条澄清、无 `plan` | ✔（同时含 `D→P` 与 `CD`，`reason = ambiguous-destination`） |
| 修订版 ⇒ `compilePlan.ok` | ✔ |
| 折痕两端不动 | ✔（与折前坐标差 < 1e-9） |
| 折片刚性 `|AP|=|AD|=1`、`|CP|=|CD|=1` | ✔ |
| 折角 90° | ✔ |
| 平面 `PAC` ⊥ 平面 `ABC` | ✔（法向点积 < 1e-9） |
| `P = (1/2, 1/2, ±1/√2)` | ✔（与设计 §3 的参考坐标一致） |
| `M = (P+B)/2` | ✔ |
| 镜像分支 | ✔（`z` 互为相反数；落盘动作只带折角，执行层按自己的规则选一侧） |
| 折角缺失 ⇒ 问折角；折痕不在折片上 / 无梯形底面 ⇒ `not-applicable` | ✔ |

### 5. 这一块**没有**做的

- 原题**不出图**是刻意的（设计 §3 的验收口径）；本次没有实现"用户答完之后把澄清答案接回计划"
  的多轮会话闭环（那属于会话层，T7/T8 只验两种固定题面）。
- 目标层（`AP⊥CD` 是假、二面角 `acos(1/√3)`）留给 T7。
- 折后的 `D` 不再作为图上的点出现（`apexAs = P`）；题面若要求同时保留折前 `D` 的显示，
  需要另立一个"折前状态"图层，本文档没有做。

---

## T7 —— 目标结果与题设核验分离，接通两种规划入口

### 1. 执行基线

| 项 | 值 |
|---|---|
| 新增文件 | `packages/geometry-kernel/src/solidGoalMeasurements.ts`、`.test.ts`、`packages/agent-core/src/solidGoals.ts`、`.test.ts` |
| 改动的文件 | `agent-core/src/parametricSolidPlan.ts`、`polygonFoldPlan.ts`、`agent-core/src/index.ts`、`geometry-kernel/src/index.ts`、`apps/web/src/agent/agentRunner.ts`、`systemPrompt.ts`（+ `.test.ts`） |

### 2. 这一块的判据

四道题的目标**不是同一类**：

| 题 | 目标 | 真假 | 量 |
|---|---|---|---|
| Case 1 | `AE⊥平面PBC` | **假**（残差非零） | — |
| Case 1 | `sin∠(PC, 平面ADE)` | 数值 | `1/√2` |
| Case 2 | `A₁C∥平面B₁DE` | **假** | — |
| Case 2 | `cos∠(A-DE-B₁)` | 数值 | `0` |
| Case 3 | `PA∥平面BDM` | 真 | — |
| Case 3 | `d(A, 平面PBD)` | 数值 | `√3` |
| Case 4 修订版 | `AP⊥CD`（CD 指折前） | **假** | — |
| Case 4 修订版 | `cos∠(P-AB-C)` | 数值 | `1/√3`（≈54.7356°） |

**三种角不许共用一个数**：线面角用 `sin = |d·n|/(|d||n|)`、二面角用**半平面**夹角
（**不取绝对值**，120° 就是 120°）、平面夹角才取锐角 `|n₁·n₂|`。

### 3. 改了什么

1. **内核 `solidGoalMeasurements.ts`（新）**：`linePlaneSine` / `pointPlaneDistance` /
   `dihedralCosine` / `dihedralDegrees` / `planeAngleCosine` / `planeNormalOf`。
   退化输入全部返回结构化拒绝（**不返回 NaN**）。先检索过既有量测：二面角复用
   `dihedralAngleDetail3` 的同一套半平面口径，其余三个没有既有同义函数才新增。
2. **`solidGoals.ts`（新）**：读目标（既有 obligation 里的线面垂直/平行、线段垂直，
   加上四种数值写法）、对**已通过题设核验**的点表求值、产出 `holds / disproved / measured /
   unverified` 四种状态与非零残差，再落成用户文案：
   - 不成立 ⇒「**不成立**：…。题设本身仍然通过核验 —— 图形可以保留，但这条结论不成立。」
   - 成立 ⇒「在所构造的图形中**成立**（坐标核验；**这是实例证据，不等于形式化证明**）」
   - 数值 ⇒ 量测值；**从不出现 `formally_proved` / "整题已证明"**。
3. **接线**：
   - `parametricSolidPlan` 在题设核验通过后求目标，把文案放进计划的 `answer`（与 `assumptions` 分栏）；
   - `polygonFoldPlan` 用**折前 ∪ 折后**的点表求目标，于是"`AP⊥CD`（CD 指折前）"这种跨状态目标也量得出来；
   - `deterministicPlanForPrompt`：识别完整且题设已核验时，**模型入口也直接取这份计划**
     （`agentRunner.selectPlanner` 在问 provider 之前先试它；返回 `null` 才走原路）；
   - `systemPrompt` 新增两条纪律：**不要手算顶点坐标**（只报结构/参数）、
     **目标结论与题设核验分开说**（不成立要给量值与残差）。

### 4. GREEN 读数

```text
npx vitest run packages/geometry-kernel/src/solidGoalMeasurements.test.ts \
  packages/agent-core/src/solidGoals.test.ts \
  packages/agent-core/src/solidGeometryFourCases.test.ts \
  apps/web/src/agent/systemPrompt.test.ts apps/web/src/agent/agentRunner.test.ts
```

- `solidGoalMeasurements.test.ts` **6 项通过**（四个参考值 + 二面角不取绝对值 + 退化拒绝）；
- `solidGoals.test.ts` **6 项通过**（四题目标真假与量值、文案口径、计划 `answer` 字段）；
- `systemPrompt.test.ts` **30 项通过**（新增两条纪律）；
- `agentRunner.test.ts` + `agentRuntime.test.ts` **93 项通过**（接入确定性前置后模型入口不回归）。

### 5. 这一块**没有**做的

- **UI/权限测试**（只读证明请求、目标为假但题设可画、题设自身矛盾、解析未完成的界面呈现）
  本轮**没有**新增 —— `answer` 走既有的计划文案通道，但界面上的分栏呈现与权限断言未做。
- 在线模型（真实 provider）未跑：`deterministicPlanForPrompt` 的接入用离线单测覆盖，
  **不拿桩结果冒充在线准确性**。
- `sampled` / `formally_proved` 的**证明产物**链路不在本期（本层只给实例证据）。





