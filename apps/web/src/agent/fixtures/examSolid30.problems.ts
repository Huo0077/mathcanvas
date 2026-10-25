/**
 * **30 道立体几何题（2026-10-25）**——真实模型评测用题单。
 *
 * 选取原则：
 * - 覆盖高中立体几何的主要问法：长度、角（线线/线面/二面角）、体积、外接/内切球、截面、翻折；
 * - 每题都写成**能独立成立**的一段话（不依赖前后题）；
 * - 难度从"直接套公式"到"需要构造辅助点"，不用偏题怪题。
 *
 * **这不是模型的训练/提示词素材**：它只用于 `examSolid30.eval.test.ts` 的一次性评测，
 * 读数口径见该文件头部。
 */
export interface SolidProblem {
  id: string
  /** 教材/考卷上常见的表述，保持中文原样。 */
  prompt: string
  /** 期望能核验到的关键结论（人工标注，仅用于报告归类，不参与判分自动比较）。 */
  focus: "length" | "angle" | "dihedral" | "volume" | "sphere" | "section" | "fold" | "relation"
  expectedDiagnostic?: string
}

export const SOLID_PROBLEMS: readonly SolidProblem[] = [
  { id: "s01", prompt: "在棱长为 2 的正方体 ABCD-A1B1C1D1 中，求异面直线 AB 与 B1C1 所成的角。", focus: "angle" },
  { id: "s02", prompt: "长方体 ABCD-A1B1C1D1 的长、宽、高分别为 3、4、5，求它的体对角线长。", focus: "length" },
  { id: "s03", prompt: "正四棱锥 P-ABCD 的底面边长为 2，侧棱长为 2，求它的高。", focus: "length" },
  { id: "s04", prompt: "正三棱锥 P-ABC 的所有棱长都为 2，求它的体积。", focus: "volume" },
  { id: "s05", prompt: "直三棱柱 ABC-A1B1C1 的底面是边长为 2 的正三角形，侧棱长为 3，求它的体积。", focus: "volume" },
  { id: "s06", prompt: "圆柱的底面半径为 1，高为 2，求它的侧面积。", focus: "length" },
  { id: "s07", prompt: "圆锥的底面半径为 3，高为 4，求它的母线长。", focus: "length" },
  { id: "s08", prompt: "球的半径为 3，求它的表面积。", focus: "sphere" },
  { id: "s09", prompt: "正四面体的棱长为 2，求它的外接球半径。", focus: "sphere" },
  { id: "s10", prompt: "正方体的棱长为 2，求它的内切球半径。", focus: "sphere" },
  { id: "s11", prompt: "长方体的长、宽、高分别为 3、4、5，求它的外接球半径。", focus: "sphere" },
  { id: "s12", prompt: "在棱长为 2 的正方体 ABCD-A1B1C1D1 中，求二面角 A1-BD-A 的大小。", focus: "dihedral" },
  { id: "s13", prompt: "正四棱锥 P-ABCD 的底面边长为 2，侧棱长为 2，求侧棱与底面所成的角。", focus: "angle" },
  { id: "s14", prompt: "三棱锥 P-ABC 中，PA 垂直于平面 ABC，AB=AC=2，∠BAC=60°，求 PB 的长。", focus: "length" },
  { id: "s15", prompt: "四棱锥 P-ABCD 的底面是边长为 2 的正方形，PA 垂直于底面，PA=2，求二面角 P-BC-A 的大小。", focus: "dihedral" },
  { id: "s16", prompt: "直三棱柱 ABC-A1B1C1 中，AB=AC=2，∠BAC=90°，AA1=2，求异面直线 A1B 与 AC 所成的角。", focus: "angle" },
  { id: "s17", prompt: "在棱长为 1 的正方体 ABCD-A1B1C1D1 中，求三棱锥 A1-AB1D1 的体积。", focus: "volume" },
  { id: "s18", prompt: "正六棱柱的底面边长为 2，高为 2，求它的体积。", focus: "volume" },
  { id: "s19", prompt: "圆台的上、下底面半径分别为 1 和 2，高为 2，求它的体积。", focus: "volume" },
  { id: "s20", prompt: "正方体的棱长为 2，求它的外接球半径。", focus: "sphere" },
  { id: "s21", prompt: "三棱锥 S-ABC 的三条侧棱 SA、SB、SC 两两垂直，长度分别为 1、2、3，求它的体积。", focus: "volume" },
  { id: "s22", prompt: "在棱长为 2 的正方体 ABCD-A1B1C1D1 中，求点 A 到平面 A1BD 的距离。", focus: "length" },
  { id: "s23", prompt: "正三角形 ABC 的边长为 2，PA 垂直于平面 ABC，PA=2，求二面角 P-BC-A 的大小。", focus: "dihedral" },
  { id: "s24", prompt: "四棱锥 P-ABCD 的底面是矩形，AB=2，AD=3，PA 垂直于底面，PA=4，求 PC 的长。", focus: "length" },
  { id: "s25", prompt: "斜三棱柱的底面是边长为 2 的正三角形，侧棱长为 2 且与底面所成的角为 60°，求它的高。", focus: "length" },
  { id: "s26", prompt: "圆锥的轴截面是正三角形，母线长为 2，求它的体积。", focus: "volume" },
  { id: "s27", prompt: "正方体的棱长为 2，球与正方体的各条棱都相切，求这个球的半径。", focus: "sphere" },
  { id: "s28", prompt: "在棱长为 2 的正方体 ABCD-A1B1C1D1 中，求平面 AB1D1 与平面 ABCD 所成的锐二面角的大小。", focus: "dihedral" },
  { id: "s29", prompt: "四面体 ABCD 中，AB=CD=2，其余四条棱长都为 √3，求它的体积。", focus: "volume" },
  { id: "s30", prompt: "四棱锥 P-ABCD 的底面是菱形，边长为 2，∠BAD=60°，PA 垂直于底面，PA=2，求二面角 P-BD-A 的大小。", focus: "dihedral" }
]

const FOLD_BASE = "平面四边形ABCD中，AB=8，AD=5√3，∠BAD=30°，∠ADC=90°，CD=3。点E在AD上，且AE:AD=2:5；点F在AB上，且AF:AB=1:2。"
const TWO_FOLDS = "先将三角形AEF沿EF翻折至三角形PEF，再将三角形PEF沿PF折叠至三角形QPF。"

/** Separate extension: the historical solid30 denominator remains 30. */
export const FOLD_PROBLEMS: readonly SolidProblem[] = [
  { id: "f01", focus: "fold", prompt: FOLD_BASE + "将三角形AEF沿EF翻折至三角形PEF，使PC=4√3。" },
  { id: "f02", focus: "fold", prompt: FOLD_BASE.replaceAll(":", "：") + "将三角形AEF沿EF翻折至三角形PEF，使PC=4√3。" },
  { id: "f03", focus: "fold", prompt: FOLD_BASE + TWO_FOLDS.replace("沿EF翻折至", "沿EF翻折90°至").replace("沿PF折叠至", "沿PF折叠60°至") },
  { id: "f04", focus: "fold", prompt: FOLD_BASE + TWO_FOLDS + "使QB=5.982610851975，QC=7.185772613248。" },
  { id: "f05", focus: "fold", prompt: FOLD_BASE + TWO_FOLDS + "再将三角形QPF沿QP翻折至三角形RQP，使PB=7.211102550928，QB=5.982610851975，RB=4.702333900814。" },
  { id: "f06", focus: "fold", prompt: FOLD_BASE + TWO_FOLDS, expectedDiagnostic: "fold_system_underdetermined" }
]
