# R07 证据摘要：函数相关义务一致绑定与题图结构化人工复核

## 审计发现映射

| 严重度 | 问题摘要 | 修复边界与结论 |
| --- | --- | --- |
| Middle (M1) | `diagramVerification.ts` 仅对 `functionGraph` 调 `selectStatedCurve`，其余函数消费者依赖 `curves.length === 1` 导致存在辅助曲线时 `functionLineIntersections` / `tangentAt` 静默失真或错绑，且 `diagramObligations.ts` 对单函数解析仅认 `f(x)` | 在 `diagramObligations.ts` 支持 `[fgh](x)` 与 `g(x) 在 x=... 处的切线` 解析；在 `diagramVerification.ts` 将 `statedCurveNames` 与 `selectStatedCurve` 统一扩展至 `functionGraph`、`functionLineIntersections` 与 `tangentAt`（按 `sourceId` 匹配已绑定曲线，拒绝跨曲线错切与重复标签），并用 `(source.id, otherSource.id)` 约束 `commonTangent` 配对一致性 |
| Middle (M2) | `problemImageReview.ts` 与 `problemImagePrompt.ts` 原先仅靠黑名单 `isDiagramLine` 拦截连线，且 `addCoordinateReview` 仅识别纯十进制小数坐标，致使 `AB∥CD`、`AB与CD相交于E`、`AB和CD是两条棱`、根式/LaTeX分式坐标、未知 `kind` 与伪造 `label` 直接作为确定性题设送入规划器 | 重构为结构类别白名单与双端复核门禁：仅严格白名单内的 `label`/`scalar` 自动通过；`relation`、`connection`、`coordinate`（含 `\sqrt`、`\frac` 及不确定语法）与 `unknown` 默认须逐条人工确认；忽略模型伪造的 `confirmed`/`status`/`kind`，绑定 `computeReadingRevision` 与内容摘要及来源位置，重复观察 ID 禁止发送，改字清空旧确认，并在 `splitImagePrompt` / `agentRunner` 装配层二次拦截未确认观察 |

## 冻结实现与合同边界

1. **R07-A 函数相关义务统一绑定（`packages/agent-core/src/diagramObligations.ts`、`diagramVerification.ts`）**：
   - `statedCurveNames(sourceText)` 提取语句中出现的所有 `[fgh](x)` 函数名，支持表达式中段引用（如 `直线 y=0.5 与 f(x)=sin x 的图像有三个交点`）。
   - `functionLineIntersections` 与 `tangentAt` 在多曲线或命名场景统一先经 `selectStatedCurve` 解析目标曲线，当未显式命名时仅当题集存在唯一 `functionGraph` 函数名方允许继承；多条同名或未区分标签的候选直接报 `function_binding_ambiguous`，禁止按 `curves[0]` 猜选。
   - `tangentAt` 按 `tangent.source.id === selected.curve.id` 匹配切线图元，错绑至辅助曲线时显式返回 `unverified`（`function_binding_mismatch`）；`commonTangent` 检查同 pair `source.id`/`otherSource.id` 一致性。
2. **R07-B 题图结构化分类与复核门禁（`apps/web/src/services/problemImageReader.ts`、`problemImageReview.ts`、`problemImagePrompt.ts`、`components/agent/ProblemImageComposer.tsx`、`agent/agentRunner.ts`）**：
   - 解析阶段（`parseImageReadingItems`）剥离任何模型自报的确认标记，非白名单 `kind` 归入 `unknown`。
   - `classifyObservation(item)` 先行依据内容结构判别 `relation`、`coordinate`、`connection`、`unknown`，阻止模型以 `kind: "label"` 伪装绕过。
   - `addCoordinateReview` 将坐标形态探测与纯小数语法分离，使 `F(2\sqrt{5}, 0)`、`P(\frac{1}{2}, -\frac{\sqrt{3}}{2})` 与残缺坐标 `M(?, 1)` 均进入人工核对疑点。
   - 确认证据在前端与 `splitImagePrompt` / `agentRunner` 双重校验：绑定 `readingRevision`、条目内容摘要 `observationDigest` 及 `image`/`box` 来源，存在重复 `id` 或改字后旧确认一律作废；未确认条目绝不进入 `imageEvidence.diagram` 确定性事实或发送至模型规划器。

## RED -> GREEN 实证与测试计数

- **RED 现象**：
  - 修复前 `diagramVerification.test.ts` 与新增用例出现 2 项失败：辅助曲线存在时 `functionLineIntersections` 返回 `unverified` 而非 `passed`/`failed`；`g(x)` 未被 `functionGraph` 解析且 `tangentAt` 可被错绑至他曲线。
  - 修复前 `problemImageReview.test.ts` 与 `problemImagePrompt.reviewGate.test.ts` 出现 4 项失败：`F(2\sqrt{5},0)`、`P(\frac{1}{2}, -\frac{\sqrt{3}}{2})`、`M(?,1)` 坐标复核为 0 条；`AB∥CD`、`AB与CD相交于E` 等均未被分类拦截且伪造 Payload 直接混入 `imageEvidence.diagram`。
- **GREEN 验证**：
  - `npx vitest run packages/agent-core/src/diagramVerification.test.ts apps/web/src/services/problemImageReview.test.ts apps/web/src/services/problemImagePrompt.reviewGate.test.ts apps/web/src/services/problemImageReader.test.ts apps/web/src/agent/agentRunner.test.ts apps/web/src/components/agent/ProblemImageComposer.test.tsx`：**6 文件 / 152 项全部通过**
  - `npm.cmd test -- --testTimeout=30000`：**524 个测试文件全部通过，5577 项通过 + 1 todo（5578）**
  - `npm.cmd run typecheck`：通过
  - `npm.cmd run lint`：通过（0 errors，既有 unused 警告未增）
  - `npm.cmd run build --workspace @draw/web`：通过
  - 既有 `npx playwright test e2e/problem-image-reader.spec.ts --workers=1 --retries=0` 观测记录：第 1 条确认 R07 前端“题干修订 + 疑点核对 + 仅随带自动通过数值项”界面流交接成功，随后 2 条用例均停在 R01-A 既有多小问选问阻断（`PRISM` 含第 `(2)` 问前置条件且未选问；该旧用例对齐归属下一工作包 **R08** 处理）。

## 边界说明与安全回滚

- **边界**：题图识别的几何观察复核仅对明确标注或白名单标签/数值自动放行，复杂表达式或图像歧义仍以人工勾选为准；本轮不含付费视觉模型在线实测及 `PRISM` 等旧 E2E 用例合同重写（留交 R08）。
- **回滚**：可按 `git revert` 回退 R07 提交，但回滚前须确保不恢复正则/黑名单漏放行路径。
