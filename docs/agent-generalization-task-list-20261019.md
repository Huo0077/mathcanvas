# 几何 Agent 泛化问题任务表（2026-10-19）

**日期：** 2026-10-19

**来源：** 对 Gemini 泛化分析的仓库级核对 + 2026-10-17 的 12 道真实 provider 评测（[评测记录](agent-drawing-eval-20261017.md)）。这不是发布验收表，而是按“问题 → 验收”拆出的工作清单。

**状态词：** `open` 未修 / `partial` 部分已修 / `done` 已完成。

## 总览

| Part | 主题 | 优先级 | 当前判断 |
|---|---|---|---|
| 1 | 模型与计划质量 | P0 | 最大瓶颈：坐标心算、动作契约、多缺陷、格式/模型档位 |
| 2 | 构造语言与动作覆盖 | P1 | 有通用多面体/面片/折/截面，缺通用变换与求交算子 |
| 3 | 求解与约束 | P1 | 只有四族见证搜索与一维折角搜索，无通用约束求解 |
| 4 | 校验与修复闭环 | P1 | 有编译/核验/修复与只读场景；缺渲染级反馈与救援组合 |
| 5 | 题面输入与解析 | P0（真实考试） | LaTeX/OCR 未归一化；向量/二面角等条件会残留 |
| 6 | 产品、评测与发布 | P2 | 删除语义、桌面未重建、样本小、无冻结 gold |

## 任务表

| ID | Part | 问题 / 目标 | 优先级 | 状态 | 验收 |
|---|---|---|---|---|---|
| P1-1 | 1 | 坐标与度量心算错误（PB、∠PCA、AA₁ 等） | P0 | partial | 六棱四面体、正方形底四棱锥、右三棱柱、直四棱柱梯形底、垂直平面四棱锥、等腰直角+等边+二面角等解析构造已落地；其余形状仍靠模型坐标 |
| P1-2 | 1 | 动作契约：裸别名引用、线段顺序、0° 折角 | P0 | done | 裸字符串按 draft 别名收下；线段后移、0° 安全默认、数组折痕/数组 hostEdge、重复顶点提示已落地；对象缺 scope 仍拒绝 |
| P1-3 | 1 | 多缺陷计划 + 1 次信封 / 2 次编译预算 | P0 | done | 顺序 + 0° 一次清洗；AEF 平面片 + fold 物化 E/F；`planCompiler.combinedRescue.test.ts` 钉住“顺序 + 0° + 坐标错”组合 |
| P1-4 | 1 | 推理模型不返回 JSON（v4-pro 5/12） | P0 | done | 当前 flash 整批 12/12 解析、0 格式失败；v4-pro 仍慢但不再是阻塞项 |
| P1-5 | 1 | 模型路由：`deepseek-chat` 实际是 flash；v4-pro 可用但慢 | P0 | partial | v4-pro 前两题 1 passed / 1 unverified，约 2.5 min/题；完整批未跑完，默认档位未改 |
| P2-1 | 2 | 缺通用原子算子：旋转、反射、平移、求交、投影 | P1 | done | 反射、投影、平移、旋转、线面交点五个指定算子 + 自由点全部落地；动作测试与全量回归通过 |
| P2-2 | 2 | 任意多面体仍要模型给坐标 | P1 | partial | 通用求解器 fallback；求解结果必须过题设核验 |
| P2-3 | 2 | 固定动作菜单与字段组合负担（35 个 action） | P1 | done | 43 个动作共用 `FIELD_KINDS`；新增 `atomicActionFields.test.ts` 钉住 source/planePoints/label/vector/angle 的复用；registry/schema/parser 由 field-parity 测试对齐 |
| P2-4 | 2 | 2–3 面开放壳、三维圆弧被明确拒绝 | P2 | done | 明确拒绝 + 修复提示“逐面用 solid.create_face 建开放壳”；3D 圆弧仍走线段近似建议，不误报已画 |
| P3-1 | 3 | 见证搜索只覆盖棱锥/棱柱/棱台/平面图形，固定小整数网格 | P1 | partial | 新增六棱四面体、正方形底四棱锥、右三棱柱、二面角四个解析构造；通用求解仍未接 |
| P3-2 | 3 | 锐角/钝角/点在内部等不等式；非退化与可读性 | P1 | done | 锐角/直角/钝角/点在三角形内部均已解析并核验；内外部、直角反例均有测试 |
| P3-3 | 3 | 无 LM/BFGS 通用约束求解；`constraints3d` 只有残差/投影 | P1 | partial | 已有迭代顺序投影求解（`projectPoint3Constraints`，确定性轮数/容差/矛盾报告），但不是任意约束的数值 fallback；尚未接入编译救援 |
| P3-4 | 3 | 向量式、二面角、`\overrightarrow` 等条件解析残留 | P1 | done | 二面角“为”写法 + 向量点积 `2AB·AO=|AB|²` 都已解析并核验；trig-23、trig-89 均 3/3 passed |
| P4-1 | 4 | 只有结构化反馈，无渲染图像；无重叠/遮挡/标签碰撞 | P1 | open | 结构化 render evidence 进入修复；含包围盒重叠与标签碰撞 |
| P4-2 | 4 | 修复预算与救援不组合 | P1 | done | 同一计划“线段顺序错 + 0° 折角 + 坐标错”可一次串起结构清洗、补折/折角反求并通过核验；`planCompiler.combinedRescue.test.ts` 钉住 |
| P4-3 | 4 | “未核验”仍可出图，缺显式标记/fail-closed | P1 | done | 确认面板显示通过/失败/未核验数量与逐条原因；未 `passed` 时隐藏“确认并提交”；3 个 UI 测试 38 条通过 |
| P4-4 | 4 | 渲染级美学/退化检查缺失（相机退化、近重合点） | P2 | done | 近重合、标签碰撞风险、全部共线三条警告；相机参数不在编译期，明确不在此判 |
| P5-1 | 5 | LaTeX/OCR 归一化未进主路径 | P0 | partial | 已接入；11 道 HighMATH 原始 LaTeX 的 given 0→29、unverified 26→13，8/11 能读出条件 |
| P5-2 | 5 | OCR 错字/符号解析残留（如“棱雉”） | P1 | done | 棱雉/棱椎/圆雉/圆椎等长替换 + `\vec{}` 归一；`latexNormalisation.ocr.test.ts` 覆盖纯文本与 LaTeX |
| P5-3 | 5 | 欠定题默认特殊值（等边/等腰/整数） | P1 | done | 生产提示词加入“一般位置”策略：不默认等边/等腰/直角/整数，取值写进 assumptions；`underdeterminedPolicy.test.ts` 钉住 |
| P6-1 | 6 | 旧图删除被 `AF` 线段挡住；绑定点按语义降级 | P2 | done | Ctrl/Cmd+A 全选删除；模板实体/派生对象级联注销；宿主删除后绑定点降级为自由点并保留位置（`deletion-cascade` / `boundPointFollow` 回归） |
| P6-2 | 6 | 桌面端未重建，最新源码不在安装包 | P2 | done | 已重建 3.3.14 exe + MSI + NSIS；exe 启动 10 秒 smoke 通过 |
| P6-3 | 6 | 12 道 harness 单次计划 + 一次修复，样本小 | P2 | open | 30–50 道冻结题 + 完整协调器路径 |
| P6-4 | 6 | 无冻结 gold / 真实模型验收 | P2 | open | 冻结题集 + 人评/真实模型读数 |
| P6-5 | 6 | v4-pro 821 秒 vs flash 39 秒的成本/延迟 | P2 | open | 按题型路由或缓存；给出预算 |

## 本轮已完成（`97dde4b`）

- 单面 `solid.create_polyhedron`（开放平面多边形）。
- 3D 文档里的 `planar.*` 提升为可见三维图元。
- 折角剪裁：折叠后删掉原角，底面显示五边形而不是“四边形 + 尖片”。
- `segment_reference_missing` 线段自动后移（含剪角）。
- `unscoped_reference` 的 scoped 修复提示。
- `Ctrl+A` 全选（整图删除的 workaround）。
- 门禁：450 文件 / 4841 通过 + 1 todo，typecheck 0，lint 0 error / 15 warning。

## 2026-10-19 P1-3 进展

- 新增 `rescueWithStructuralRepairs`：在同一份计划上先移走引用未建点的线段，再把不在 `(0°,180°]` 的折角按安全默认 `90°` 回填，然后才编译；90° 仍会交给折角反求，最终仍由题设核验。
- 回填会写进 `assumptions`（`default-fold-angle.<apexAs>`，可覆盖），不是静默改值。
- 回归：`planCompiler.witnessFold.test.ts` 新增“顺序 + 0°”和“0° 无目标角”两例，共 6 条通过；全量 411 文件 / 4771 通过 + 1 todo。
- 追加 `materialiseFoldHinges`：删与折片同名的冗余 AEF 面，从折片顶点反推 E/F 在宿主边上的参数并物化为 bound point；单独复跑 user-quad-fold 时**八条题设全部 passed**。
- 追加修复提示：共线三角面直接说“删面、用 bound point + fold”；`hostEdge` 也接受数组 `["A","D"]`；面顶点重复时提示“`vertexNames` 与 `vertices` 按下标互异”。
- **P1-3 完成**：组合用例（线段顺序 + 0° 折角 + 坐标错）已通过；结构清洗、补折/反求、见证坐标可串行。
- 追加 `rescueWithFoldConstruction`（放在所有救援之后）：用平面见证坐标 + 题面比例 + 折角反求从头重建折片，不再依赖模型结构。user-quad-fold 三连跑 **3/3 passed**，整批复跑也 passed。
- 追加 `rescueWithSortedFaceRings`：多面体面环或棱柱底面自交时按面内角序重排（顶点/点名不动）。solid-9/solid-20 从“自交编译失败”变为可画，但整批仍受模型方差影响。
- **边界**：折片结构仍受模型输出影响；单题修复有效，但整批读数方差明显。其余坐标错误归 P1-1/P5-1。

## 2026-10-19 P5-1 进展

- 新增纯函数 `normalizeGeometryPrompt`（`latexNormalisation.ts`）：处理 `$`、`\triangle`、`\angle`、`\sqrt`、`\frac`、`\perp`、`\parallel`、`\circ`、`\overrightarrow`、上下标与数据集 OCR 错字（`棱雉→棱锥`）。
- 解析入口 `parseObligationWithLegacy` / `parseObligationIR` 统一先归一化；`planCompiler` 的 `verifyExplicitCubeRequest` / `validateRelations` 也读归一化题面，模型改写与 span 仍走原文。
- 回归：`latexNormalisation.test.ts` 4 条 + `planCompiler.witnessFold.test.ts` 的原始 LaTeX 端到端 1 条；全量 412 文件 / 4774 通过 + 1 todo。
- **parse rate 读数**（11 道 HighMATH 原始 LaTeX，`parseDiagramObligations` 直接跑）：原始 given **0** / unverified **26**；归一化后 given **29** / unverified **13**；8/11 至少读出一条，2 道完全干净（solid-13、solid-24）。
- **边界**：只做确定性替换，不猜题意；`trig-60` / `trig-89` 的向量条件仍读不出（归 P3-4/P5-2），`solid-1` 的 `PA=` 尾部与部分二面角仍残留。

## 2026-10-19 P1-2 进展

- `readScopedReference` 接受**裸字符串**并补成 `{scope:"draft",alias}`；场景引用仍然必须带 `documentId`/`entityId`，只给 `{entityId}` 的对象继续按 `unscoped_reference` 拒绝。
- 回归：`schemas.test.ts` 的 draft action 解析、`planCompiler.bareAlias.test.ts` 的端到端绑定；全量 414 文件 / 4780 通过 + 1 todo。
- 追加：`solid.fold` 的折痕也接受数组 `["E","F"]`（归一成 `{from,to}`）；用户翻折题从“传输层拒绝”推进到几何核验，剩余 CD=3 / ∠ADC=90° / PC=4√3 不符。
- **边界**：别名不存在时由编译器报 `alias_missing`；不再把“裸字符串”整轮拒掉，但仍不猜作用域。

## 2026-10-19 P1-1 进展

- 新增 `solver/tetrahedron.ts`：六条棱长 → 四面体坐标（A 在原点、B 在 x 轴、C 在 xy 平面、P 由三个距离方程解出）；不可行/退化返回 `null`，并在返回前回代六条距离。
- 新增 `rescueWithTetrahedronEdges`：识别 `三棱锥 P-ABC` / `四面体 ABCD`，从题设和 `PA=PB=2`、`△ABC 是边长为 2 的等边三角形` 提取六条棱，构造 `solid.create_polyhedron` 并重编；成功时写 `witness.tetrahedron` 假设。
- 为避免改动原文 span，等边/链式展开只在**核验内部**用 `expandExamShorthand`；`parseObligationWithLegacy` 仍按原题面保持可追溯。
- 回归：`solver/tetrahedron.test.ts` 3 条 + `planCompiler.tetrahedron.test.ts` 1 条；全量 414 文件 / 4779 通过 + 1 todo。
- 真实 provider 复核：solid-1（三棱锥 P-ABC）flash 从坐标失败变为 `ok=true` / `verification=passed`，`assumptions=['witness.tetrahedron']`。
- 新增 `solver/pyramid.ts` + `rescueWithSquarePyramid`：正方形底、PC=PD、∠PCA 的解析构造；solid-10 真实 provider 复跑 `verification=passed`。
- 新增 `solver/prism.ts` + `rescueWithRightPrism`：右三棱柱（AA₁、A₁ 到侧面的距离、两平行侧棱距离）的解析构造；solid-13 真实 provider 复跑 `verification=passed`。
- 新增 `solver/trapezoidPrism.ts` + `rescueWithTrapezoidPrism`：直四棱柱梯形底（AB/AD/CD + 体积）解析构造；solid-20 单题可画，整批仍受模型输出方差影响。
- 新增 `solver/perpendicularPyramid.ts` + `rescueWithPerpendicularPyramid`：PA⊥底面 + AD=CD + 平面 PAC⊥平面 PBD 的四棱锥；solid-9 三连跑 **3/3 可画**。
- 梯形底棱柱与垂直平面四棱锥救援不再要求模型先给出 `plan`：即使模型计划在面环/格式处失败，也能从题面直接构造。solid-20 三连跑 **3/3 可画**，整批 **12/12 可画、0 失败**。
- `expandExamShorthand` 支持带下标点名的链式相等（`AB=AA₁=2`）；核验未通过时只用展开题面复跑一次核验（不改原文/span）。solid-32 三连跑 **3/3 passed**。
- 句读切分（`CD=4.已经` → `CD=4，已经`）与前导 `若` 归一后：solid-20 三连跑 **3/3 passed**，整批 **7/12 全过、0 失败**。
- 二面角条件接受“为”写法，并修正解析构造的**二面角内角方向**（旋转角 φ 给内角 180−φ）：trig-23 三连跑 **3/3 passed**。
- “边长为 N 的等边三角形”直接读出三条边；`则 …=.` 这类答案题不再当成已知条件。solid-3 三连跑 **3/3 passed**；整批最佳达到 **8/12 全过、12/12 可画、0 失败**。
- 新增 `vectorDot` 条件与“外心”构造：`2AB·AO=|AB|²` 可解析、可核验；trig-89 三连跑 **3/3 passed**。P3-4 完成。
- 新增 `solver/dihedral.ts` + `rescueWithDihedralTriangle`：等腰直角 + 等边 + 二面角的解析构造；trig-23 从“几何失败”变为“可画、未核验”。
- 回归：`solver/tetrahedron.test.ts` 3 条 + `solver/pyramid.test.ts` 2 条 + `solver/prism.test.ts` 2 条 + `solver/dihedral.test.ts` 2 条 + 四条编译救援；全量 422 文件 / 4791 通过 + 1 todo。
- **边界**：只覆盖“六棱四面体”“正方形底 + 等距 + 一个底对角角”“右三棱柱”“等腰直角+等边+二面角”四类；其他多面体、半角/二面角约束仍靠模型或后续求解器。

## 2026-10-19 12 道复跑（flash，单次计划 + 一次编译修复）

| 指标 | 复跑前 | 第一次 | 最佳（右三棱柱后） | 最近（二面角后） | 最新（句读/链式修正后） |
|---|---:|---:|---:|---:|---:|
| 生成图（compile ok） | 5 / 12 | 8 / 12 | **11 / 12** | 9 / 12 | **12 / 12** |
| 题设全过 | 0 / 12 | 1 / 12 | **4 / 12** | 4 / 12 | **7 / 12** |
| 未核验 | 4 | 6 | 5（另有 2 道无核验） | 4 | 4 |
| 失败 | 7 / 12 | 4 / 12 | **1 / 12** | 3 / 12 | **0 / 12** |

- 目前稳定通过 9 道：`solid-1`、`solid-3`、`solid-9`、`solid-10`、`solid-13`、`solid-20`、`solid-32`、`trig-23`、`user-quad-fold`；整批最新一次 7/12（solid-3/9 这一轮模型输出方差）。
- 最近一次（二面角救援后）：`trig-23` 已从“几何失败”变为“可画、未核验”；但 `solid-9/20/32` 因模型输出结构不同失败，生成数从 11 掉到 9。
- 最新一次（句读切分 + 链式展开 + 规范折片/面环/棱柱/四棱锥救援）：**12/12 全可画、7/12 全过、0 失败**；`solid-9`、`solid-20`、`solid-32` 都已通过。
- 同一晚还有一次只用 `materialiseFoldHinges` 的整批：7/12 生成、1/12 全过、5/12 失败。
- 未核验：`solid-3/9/20/24/32`、`trig-23/60/89`；读数只代表 flash 单次运行，方差明显。

## 2026-10-19 稳定性复跑（4 道 × 3 次）

| 题 | run 1 | run 2 | run 3 |
|---|---|---|---|
| solid-1（六棱四面体） | passed | passed | passed |
| solid-10（正方形底四棱锥） | passed | passed | passed |
| solid-13（右三棱柱） | passed | passed | passed |
| user-quad-fold | failed | unverified | unverified |

- **三个解析构造 3/3 稳定**：坐标由纯数学层给出，不依赖模型手气。
- **user-quad-fold 0/3**：这三轮模型分别交了“共线 AEF 面”“线段排在建点前”等不同结构，`materialiseFoldHinges` 只对“AEF 平面片 + fold”这一种结构生效；结构不对时救援进不去。
- 加“共线面提示 + `hostEdge` 数组 + 重复顶点提示”后重跑 3 次：**2/3 passed**（另一轮模型坐标错，CD/AD/角度不符）。
- 再加 `rescueWithFoldConstruction`（平面见证 + 比例 + 折角反求，放在所有救援之后）后重跑 3 次：**3/3 passed**；整批也通过。
- 结论：折片题不再依赖模型结构；剩余方差来自其他题的模型输出。

## 2026-10-19 P1-5 部分 A/B

- `deepseek-v4-pro` 用同一 harness + 格式修复跑了前两题：`solid-1` passed、`solid-3` unverified；约 **2.5 分钟/题**。
- 按这个速度整批要 30 分钟以上，本轮在 2 题后停止；**默认档位没有改**。v4-pro 的几何检查没看到明显优于 flash 的证据，成本/延迟代价却很大。

## 2026-10-19 P6-2 完成

- 已按当前源码重建 `apps/desktop/src-tauri/target/release/mathcanvas-desktop.exe`。
- 安装包：`bundle/msi/MathCanvas_3.3.14_x64_en-US.msi`、`bundle/nsis/MathCanvas_3.3.14_x64-setup.exe`。
- 启动 smoke：exe 启动后持续运行 10 秒（进程 `mathcanvas-desktop`），通过。
- 最新源码（P2-1 原子动作、P2-4 开放壳提示、P4-4 渲染警告等）已再次重建；2026-10-19 22:17 的 exe 启动 10 秒 smoke 通过（pid 37532）。

## 2026-10-19 P1-4 完成

- 当前 flash 整批 12 道全部解析成功、0 道格式失败；schema 修复链路已覆盖类型/字段错误。
- v4-pro 仍慢（约 2.5 分钟/题），但不再作为格式阻塞项；P1-5 的档位 A/B 仍 open。

## 2026-10-19 P4-3 完成

- 确认面板逐条显示 `通过 / 不满足 / 未核验` 与原因，并显示三类计数。
- 只有 `diagramVerification.status === "passed"` 才出现“确认并提交”；未核验/失败时按钮隐藏（fail-closed）。
- 回归：`diagramConfirmation.test.tsx`、`proofLevel.test.tsx`、`ConfirmationPanel.test.tsx` 共 38 条通过。

## 2026-10-19 P5-2 完成

- `normalizeGeometryPrompt` 对**纯文本**也修常见 OCR 错字：棱雉/棱椎 → 棱锥、圆雉/圆椎 → 圆锥；替换等长，不移动 span。
- LaTeX 路径增加 `\vec{...}` 去包装。
- 回归：`latexNormalisation.ocr.test.ts` 2 条；全量 437 文件 / 4813 通过。

## 2026-10-19 P4-2 完成

- 同一份计划同时带“线段顺序错 + 折角 0° + 四边形坐标错”：结构清洗先移线段/回填 90°，后续补折/折角反求/见证坐标串起来，最终八条题设 passed。
- 回归：`planCompiler.combinedRescue.test.ts`。

## 2026-10-19 P3-2 进展

- 新增 `acuteTriangle` / `rightTriangle` / `obtuseTriangle` / `pointInsideTriangle` 判据：从最终坐标算角/同侧符号；内部点通过，外部点失败。
- 反例：锐角条件对直角三角形必须 `failed`；直角/钝角各自有正例；退化点返回 `null`。
- 回归：`planCompiler.acuteTriangle.test.ts` 5 条 + `planCompiler.pointInside.test.ts` 2 条。
- P3-2 完成；非退化采样仍归 P5-3。

## 2026-10-19 P2-1 进展

- 新增 `solid.create_point`：自由空间点，输入 `position {x,y,z}` + 可选 `label`，物化为 `point3`。
- 新增 `solid.create_reflection`：源点 + 平面三个点名（`planePoints`），内核算对称点；字段名避开 `section.create.plane`。
- 新增 `solid.create_projection`：同一组字段，内核算垂足；已加入 spatial-modeling actionIds 与摘要。
- 新增 `solid.create_translation`：源点 + `vector`，内核算平移点；已加入 spatial-modeling actionIds 与摘要。
- 新增 `solid.create_rotation`：源点 + 轴两点 + `angle`（度），内核用 Rodrigues 公式；已加入 spatial-modeling actionIds 与摘要。
- 新增 `solid.create_intersection`：线两点 + 平面三点，内核求线面交点；平行/共面拒绝；已加入 spatial-modeling。
- 动作总数 39 → 43；catalogue 哈希重签；runtime 期望列表同步。
- 回归：point/reflection/projection/translation/rotation/intersection 各 2 条；全量 448 文件 / 4838 通过。
- P2-1 完成：五个指定算子（反射/投影/平移/旋转/求交）+ 自由点全部落地。

## 2026-10-19 P4-4 进展

- 编译成功后检查带标签的 `point3`：
  - 两两距离 ≤1e-6 → `render_near_coincident_points` 警告
  - 距离 ≤图幅跨度 2% → `render_label_collision_risk` 警告
  - 所有标记点共线 → `render_collinear_points` 警告
- 只发警告、不阻止出图；相机参数不在编译期，明确不在这里判。
- 回归：`renderDegeneracy.test.ts` 4 条；P4-4 完成。

## 2026-10-19 P2-4 完成

- 2–3 面多面体仍明确拒绝（内核只有 1 面平面片或 ≥4 面闭合体两种合法形态）。
- 修复提示新增：开放壳请拆成多笔 `solid.create_face` 逐面建，不要硬凑第 4 个面。
- 3D 圆弧沿用既有建议：用一串 `solid.create_segment` / 平面 polyline 近似，不误报“已画”。
- 回归：`planCompiler.openShellAdvice.test.ts`。

## 2026-10-19 P5-3 完成

- 生产提示词加入“一般位置”策略：欠定题不默认等边、等腰、直角或整数，取值写进 `assumptions`。
- 回归：`underdeterminedPolicy.test.ts`，防止策略句被改掉。
- 这是**显式策略**而非通用采样器；几何核验仍由题设义务兜底。

## 建议执行顺序

1. **P0 三件套**：P1-4/P1-5（模型与通道）、P1-2/P1-3（计划清洗与救援组合）、P5-1（LaTeX/OCR 归一化）。
2. **P1 构造与求解**：P2-1（通用算子）、P3-1/P3-2/P3-3（求解与不等式）。
3. **P1 反馈**：P4-1/P4-3（渲染证据与未核验标记）。
4. **P2 收尾**：P6-1/P6-2（删除与重建）、P6-3/P6-4（题集与验收）。

**里程碑口径（建议，不是承诺）：**

- M1（P0）：12 道样本题设全过 ≥ 3，格式失败 ≤ 1。**已达成**：4 道全过、0 失败、12/12 可画。
- M2（P1）：新增“对称 / 投影 / 截面”各一例通过，且求解结果全部过核验。
- M3（P2）：结构化渲染证据能触发至少两类修复；桌面端重建并 smoke 通过。
