# 30 题离线扫题（2026-10-25，重建后）

> 基线：本地 `main` = `2f1a850`（远端同步后）；桌面端重建产物 `MathCanvas_4.0.1`。
> 本文记录一次**一次性**的 30 题扫题：目的是看"重建后的确定性管线对这 30 道题是什么表现"。

## 0. 这不是模型评测

全部 30 道题都走**本地确定性路径**（题设抽取 → 折片构造/核验），没有任何模型响应。
因此这里的读数**不能**当成"模型准确率"，也不能与历史 30 题评测的数字直接比较
（那些读数来自真实 provider，需要服务配置与预算授权）。

## 1. 30 道题怎么组成

| 来源 | 数量 | 说明 |
| --- | --- | --- |
| `BENCHMARK_CASES_JSONL`（21 条） | 21 | 欠定 / 矛盾 / 未支持写法 / 点名打乱 / 二面角 / 动态请求 / 全称命题，七类 × 3 |
| 四族代表题面 | 4 | 三角形、圆锥曲线、函数切线、立体证明各一条（考的是抽取） |
| 折片族 | 5 | 用户原题（`AE:AD=2:5` 写法）、两次顺序折叠、换点名、尺度 ×2、欠定折角 |

跑法（临时 vitest 用例，跑完即删；读数见下）：

```ts
parseBenchmarkDataset(BENCHMARK_CASES_JSONL).forEach((c) => parseObligationIR(c.prompt))
// 折片族：给"只有四边形"的计划，交给 compilePlan 的折片构造/反求
compilePlan(quadOnlyPlan, { prompt, document: createEmptyDocument("geometry3d") })
```

## 2. 读数

### 2.1 题设抽取（25 道，非折片族）

| 结论 | 数量 |
| --- | --- |
| 抽出 ≥1 条、且**没有**未核验从句（"抽取完全"） | **20 / 25** |
| 有未核验从句或一条都没抽出 | 5 |

5 条落在"没抽出来/有残留"的恰好都是**设计上就该如实标未核验**的那几类：
`unsupported-expression`、`dynamic-drag-request`、`dynamic-drag-midpoint`、
`dynamic-animate-perpendicular`，以及 `exam-triangle-2021`（"求 c" 这类问法里有 2 条未核验）。
它们没有从句子里消失，而是进了 `unverified` —— 与"未识别题设不得从验收分母里消失"一致。

### 2.2 折片构造 + 整题核验（5 道）

| 题目 | 首轮读数 | 修完后 |
| --- | --- | --- |
| `fold-user`（用户原题，`AE:AD=2:5`） | **failed**：`AD=5√3 实测 8.6452` | **passed** |
| `fold-chain`（两折，90°/60°） | passed | passed |
| `fold-renamed`（P/Q/R/S + M/N/T） | passed | passed |
| `fold-scaled`（整体 ×2） | passed | passed |
| `fold-underdetermined`（无折角、无终态约束） | passed（带 `witness.foldAngleAssumed` 披露） | passed |

**修完后 5/5 通过。**

## 3. 扫题发现并修掉的一个真实缺陷

`fold-user` 用的是**用户原话的写法**：`点E在AD上，且AE:AD=2:5`。
折片构造层的比例解析只认 `AE=2/5 AD`，于是这条题面在构造路径上直接落空 ——
退回模型坐标后 `AD` 实测 8.6452（正确值 5√3 ≈ 8.6603），核验如实失败。

修法（`packages/agent-core/src/planCompiler.ts`）：比例解析增加第二种写法
`AP:AB = p:q`（两个前缀必须同起点），与既有的 `AP=p/q AB` 合并进同一张 `ratios` 表。
回归用例：`planCompiler.foldConstruction.test.ts` 的
"ratio phrasing in ratio:length form"。

**这条修复的价值**：浏览器里那条单折用例之所以一直通过，是因为本地规划器的夹具
**直接给了 E/F 的绑定动作**；一旦计划只给四边形（更接近真实模型可能给出的形状），
用户原话的写法就是必须支持的那一种。

### 3.1 修复带来的两个既有负例变化（已处理）

比例解析修好后，"规范重建"在两条**负例**上开始生效，原断言（`ok=false`）随之失效。
这里没有把断言直接翻成"通过"了事，而是按失败类型做了区分：

| 情形 | 现在的行为 | 判据 |
| --- | --- | --- |
| 模型画了一条**折不起来的折**（`fold_not_rigid`，例如手写一个满足 `PC=4√3` 的 `P`） | **不重建，仍然失败** | 新增门：`rescueWithFoldConstruction` 遇到 `fold_not_rigid` 直接返回 null |
| 模型的计划**缺一个点**（例如少了 `C`），但题面里有完整的四边形 | 由规范重建补回，**并在 assumptions 里披露** | `planCompiler.foldAngle.test.ts` 改成断言"重建 + 披露 + `C` 出现" |
| 题面里**根本没有四边形**、计划又缺 `C` | **失败**，且不把 `C` 编出来 | 新增真负例（`fold-angle-no-quad`） |

这条区分是**行为变更**：此前（本轮修复前）这两种情形都会失败；现在"缺一步"会被系统补上并披露，
"画错了"仍然失败。`planCompiler.foldNegatives.test.ts` 的原始负例因此继续通过。

## 4. 未覆盖

- 真实模型响应：没有。本文所有折片构造都是"系统自己补出来的"，不是"模型写对了"。
- 动态请求 / 全称命题 / 未支持写法：只测了"如实标未核验"，没测后续交互。
- 30 题里没有圆锥曲线的作图构造题（只有一条抽取题）；这类仍然依赖模型规划通道。
