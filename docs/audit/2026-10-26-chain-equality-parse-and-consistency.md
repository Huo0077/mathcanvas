# 连等题设解析、编译与草稿核验一致性修复（2026-10-26）

> 基线：`db9d9ac`。本记录只写**本轮实际做了什么、哪些验证真的跑了**；没有调用付费模型，
> 也没有把离线复现说成真实模型成功率。

## 1. 用户可见的问题

用户原题（原样保留为回归输入）：

> 四棱锥 P-ABCD 中，平面 PAD ⊥ 平面 ABCD，AB∥CD，AB⊥AD，M 为 AD 中点，PA=PD=√5，AD=AB=2CD=2。
> （1）求证：平面 PMB ⊥ 平面 PAC；（2）求二面角 A-PC-D 的余弦值。

日志停在验收阶段，提示 `AD=：原题出现了尚未被可靠解析的几何条件，未核验。`
点名本身完全明确：`AD=AB=2CD=2` 就是 AD=2、AB=2、CD=1。

## 2. 根因（离线复现，修复前）

| 输入 | 修复前 |
| --- | --- |
| `AD=AB=2CD=2` | `segmentRatio(AB,CD)=2`、`fixedLength(AB)=2`，残留 `AD=` |
| `AD=AB=2CD=4` | 同样只读到 `AB=2CD=4`，残留 `AD=` |
| `AB=AC=0` | **只剩** `equalLength(AB,AC)`（非正长度被悄悄弱化） |
| `AB=AC=-2` | `equalLength(AB,AC)` + 残留 `=-2` |
| `expandExamShorthand("AD=AB=2CD=4")` | `AD=2，AB=2CD=4`（把乘数当整条等式的值） |
| `expandExamShorthand("PA=PD=2√5")` | `PA=2，PD=2√5` |

机制：普通连等只认纯线段，倍数句型从中间开始吃，边界守卫再丢掉不完整的那一段；
LaTeX 入口的字符串展开只认"纯线段 + 值"，遇到系数就从错误的起点开始改。

## 3. 修复内容

### 3.1 新增完整长度连等解析（P0）

`packages/agent-core/src/lengthEquality.ts`：

```text
CHAIN := TERM ('=' TERM)+ ['=' VALUE]
TERM  := COEF? SEGMENT          COEF 为正整数/小数；SEGMENT 为两个点名
VALUE := 正数 | √n | k√n | k\sqrt{n}
```

- 有绝对锚点 `V` 时：每段 `Lᵢ = V / cᵢ`；无锚点时只产出 `equalLength` / `segmentRatio`，
  **不猜绝对长度**（`AB=AC=2BC` ⇒ AB=AC、AC/BC=2）。
- 整条消费：断尾（`AD=AB=2CD=`）、非正数（`AB=AC=0`、`AB=AC=-2`）、无法识别的项
  **整条报错**，并把**完整原文**放进未核验；不会再局部读出"看起来成立"的一半。
- 不抢既有语法的活：单段长度（`AB=2`）、冒号比例（`AE:AD=2:5`）、
  "分数 × 线段"（`AE=2/5 AD`）仍由原读取器负责；`则SA=.` 这类只有一段的断尾不当作链。

`packages/agent-core/src/diagramObligations.ts`：在句型循环**之前**整条消费链，写入 `used`，
因此旧规则不会再各读一半；每条 obligation 的 `sourceText/start/end` 指向原文区间。

### 3.2 移除危险的字符串展开（P0）

`packages/agent-core/src/latexNormalisation.ts`：删掉 `expandExamShorthand` 里
"把连等展开成多条等式"的正则；它保留 OCR 错字、数字后接中文、行首"若"、等边三角形展开等
**不改变数值语义**的能力，并有边界测试（连等逐字不变）。

### 3.3 拒绝不等价的模型改写（P0）

`packages/agent-core/src/promptNormalization.ts`：新增长度语义规范形比较。

- 有定长时只比较各段定长（等长/比例由定长蕴含）；
- 无定长时比较等长/比例；
- 出现本层不认识的条件类型、或任一侧有未核验残留 ⇒ 返回 `null`，**不声称等价**、不放行。

实测（新用例）：`AD=2`（删条件）、`AD=3，AB=2，CD=1`（改值）被拒；
`AD=2，AB=2，CD=1`（等价展开）被接受。

### 3.4 编译与草稿核验一致（P0 证据）

`apps/web/src/agent/chainConsistency.test.ts` 用题面给定的正确坐标与计划，从**产品入口**验证：

| 计划 | `compilePlan` | `DraftStore.stage` |
| --- | --- | --- |
| 正确（AD=2、AB=2、CD=1、M 中点） | passed，全部 check passed | `ok=true`，`preview.diagramVerification=passed` |
| CD 改成 2 | 不 passed | 不 passed |
| M 参数 0.4 | 不 passed | 不 passed |

## 4. 用户原题解析结果（离线）

```text
givens: 平面PAD⊥平面ABCD | AB∥CD | AB⊥AD | M为AD中点 | PA=PD=√5 | AD=2 | AD=AB | AB=2 | AB/CD=2 | CD=1
unverified: []
goals: ["平面 PMB ⊥ 平面 PAC； （2）求二面角 A-PC-D 的余弦值。"]   ← 目标在 goals，不在 givens
span: 全部满足 prompt.slice(start,end) === sourceText
```

## 5. 回归矩阵（`lengthEquality.test.ts`，12 条）

`AD=AB=2CD=2` ⇒ AD=2/AB=2/CD=1；`AD=AB=2CD=4` ⇒ AD=4（不是 2）；
`AD=AB=2CD=2EF=4`；`2AB=3CD=6` ⇒ AB=3/CD=2；`AD=2AB=2` ⇒ AD=2/AB=1；
`AB=AC=2BC` ⇒ 只给等长+比例；`PA=PD=√5`、`PA=PD=2√5`、`PA=PD=2\sqrt{5}`；
`AB=AA₁=2`；`AB=AC=0`/`-2` 拒绝；断尾拒绝；单段长度/冒号比例不误抢。

## 6. 本轮执行的检查

| 检查 | 结果 |
| --- | --- |
| `lengthEquality.test.ts` | 12 passed |
| `diagramObligations.test.ts`（含 goal / restatement） | 97 passed |
| `promptNormalization.test.ts` | 14 passed |
| `latexNormalisation` 两个测试 | 9 passed（3 条旧断言按新契约改为"连等不被改写"） |
| `chainConsistency.test.ts`（编译 + 草稿） | 3 passed |
| `tsc -p packages/agent-core` | 0 error |
| 全量 `vitest` | **489 文件 / 5167 通过 + 1 todo / 0 失败** |

## 7. 尚未完成（不冒充已完成）

- **P1 诊断分类与文案**：失败仍可能落到通用"请补充明确点名"；本轮未把原因码贯穿到 UI。
- **Worker 生产适配器与浏览器闭环**（任务书 §6 第 4、5 项）：本轮只覆盖到 `compilePlan` 与
  `DraftStore.stage`（同进程），未跑 `createWorkerCompileStrategy` + `inlineWorker`，
  也未跑浏览器 e2e。
- **`docs/current-status.md` / `CHANGELOG.md` 更新**：见本轮同批提交。

## 8. 尚不支持的表达式

- 系数为分数（`2/3 AB`）、括号分组、带运算的表达式（`AB+CD=5`）——明确报未核验，不静默丢。
- 角度连等（`∠A=∠B=60°`）不在本轮范围。
- 目标求解（二面角余弦）仍按既有能力如实报告；核验通过不等于完成一般性证明。
