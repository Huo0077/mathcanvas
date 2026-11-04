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
