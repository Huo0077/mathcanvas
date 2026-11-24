import type { ViewportBounds2D } from "./contour"
import type { Matrix2x2 } from "./linalg2d"
import type { DoubleIntegralOrder } from "./multivariable"
import type { PdeBoundaryCondition, PdeKind } from "./pde"
import type { DistributionKind } from "./probability"
import type { FourierWaveformKind } from "./series"

export interface Extrema1DPreset {
  id: string
  title: string
  courseTag: string
  expression: string
  domain: [number, number]
  description: string
}

export interface LagrangePreset {
  id: string
  title: string
  courseTag: string
  objective: string
  constraint: string
  bounds: ViewportBounds2D
  initialPoint: { x: number; y: number }
  description: string
}

export interface Ode1DPreset {
  id: string
  title: string
  courseTag: string
  rhs: string
  bounds: ViewportBounds2D
  initialPoints: Array<{ x: number; y: number }>
  description: string
}

export interface PhasePlanePreset {
  id: string
  title: string
  courseTag: string
  pExpr: string
  qExpr: string
  bounds: ViewportBounds2D
  initialPoints: Array<{ x: number; y: number }>
  description: string
}

export interface Surface3DPreset {
  id: string
  title: string
  courseTag: string
  expression: string
  bounds: ViewportBounds2D
  description: string
}

export interface PdePreset {
  id: string
  title: string
  courseTag: string
  kind: PdeKind
  initialExpr: string
  boundaryExpr?: string
  boundary: PdeBoundaryCondition
  param: number
  bounds: ViewportBounds2D
  description: string
}

export interface TaylorPreset {
  id: string
  title: string
  courseTag: string
  expression: string
  center: number
  order: number
  domain: [number, number]
  description: string
}

export interface FourierPreset {
  id: string
  title: string
  courseTag: string
  waveform: FourierWaveformKind
  harmonics: number
  halfPeriod: number
  customExpr?: string
  description: string
}

export interface DoubleIntegralPreset {
  id: string
  title: string
  courseTag: string
  integrandExpr: string
  order: DoubleIntegralOrder
  outerMinExpr: string
  outerMaxExpr: string
  innerMinExpr: string
  innerMaxExpr: string
  swappedTwin?: {
    order: DoubleIntegralOrder
    outerMinExpr: string
    outerMaxExpr: string
    innerMinExpr: string
    innerMaxExpr: string
  }
  description: string
}

export interface LinalgPreset {
  id: string
  title: string
  courseTag: string
  matrix: Matrix2x2
  description: string
}

export interface ProbabilityPreset {
  id: string
  title: string
  courseTag: string
  kind: DistributionKind
  param1: number
  param2?: number
  intervalA: number
  intervalB: number
  description: string
}

export const EXTREMA_1D_PRESETS: readonly Extrema1DPreset[] = [
  {
    id: "cubic-closed-interval",
    title: "三次多项式闭区间最值",
    courseTag: "高数上 · 极值与最值",
    expression: "x^3 - 3*x + 1",
    domain: [-2.2, 2.5],
    description: "包含局部极大值 (-1, 3)、局部极小值 (1, -1)、拐点 (0, 1) 与右端点全局最大值。"
  },
  {
    id: "cusp-abs",
    title: "含不可导尖点最值",
    courseTag: "考研高频 · 尖点极值",
    expression: "abs(x^2 - 1) - 0.5*x",
    domain: [-2, 2],
    description: "在 x = ±1 处出现不可导尖点（左右导数异号）极小值，对比光滑极大值。"
  },
  {
    id: "gaussian-wave",
    title: "x·exp(-x²/2) 拐点与渐近线",
    courseTag: "考研数一/数二经典",
    expression: "x * exp(-x^2 / 2)",
    domain: [-4, 4],
    description: "全局最值位于 x = ±1，含 3 个拐点 x = 0, ±√3 及水平渐近线 y = 0。"
  },
  {
    id: "rational-oblique",
    title: "有理函数与斜渐近线",
    courseTag: "高数上 · 渐近线作图",
    expression: "(x^2 + 1) / (x - 1)",
    domain: [-4, 6],
    description: "清晰呈现垂直渐近线 x = 1、斜渐近线 y = x + 1，以及无界区间内的局部极值。"
  },
  {
    id: "damped-oscillation",
    title: "阻尼衰减振荡",
    courseTag: "工科物理 / 信号",
    expression: "exp(-0.25*x) * sin(2*x)",
    domain: [0, 8],
    description: "多个局部波峰波谷依次衰减，直观对比首个主峰全局最大值与后续次峰。"
  }
]

export const LAGRANGE_PRESETS: readonly LagrangePreset[] = [
  {
    id: "linear-circle",
    title: "线性目标 × 圆约束",
    courseTag: "拉格朗日入门",
    objective: "x + 2*y",
    constraint: "x^2 + y^2 = 4",
    bounds: { xMin: -3.6, xMax: 3.6, yMin: -3.6, yMax: 3.6 },
    initialPoint: { x: 2, y: 0 },
    description: "拖动等值滑块 c 或沿圆拖动点 P，直观感受等高线直线与圆相切时 ∇f ∥ ∇g。"
  },
  {
    id: "ellipse-rectangle",
    title: "椭圆内接最大矩形",
    courseTag: "同济高数 · 经典例题",
    objective: "x * y",
    constraint: "x^2 / 9 + y^2 / 4 = 1",
    bounds: { xMin: -4.2, xMax: 4.2, yMin: -3.2, yMax: 3.2 },
    initialPoint: { x: 3, y: 0 },
    description: "双曲线等高线 xy = c 与椭圆四象限相切，给出条件最大值 3 与条件最小值 -3。"
  },
  {
    id: "hyperbola-distance",
    title: "双曲线到原点最近点",
    courseTag: "考研数一 · 条件极值",
    objective: "x^2 + y^2",
    constraint: "x * y = 1",
    bounds: { xMin: -3.5, xMax: 3.5, yMin: -3.5, yMax: 3.5 },
    initialPoint: { x: 2, y: 0.5 },
    description: "同心圆等高线 x²+y² = c 从原点扩张，首次与双曲线 xy = 1 相切于 (±1, ±1)。"
  },
  {
    id: "offset-circle-ellipse",
    title: "椭圆到定点最远/最近距离",
    courseTag: "多元优化几何直觉",
    objective: "(x - 2)^2 + (y - 1.5)^2",
    constraint: "x^2 / 4 + y^2 = 1",
    bounds: { xMin: -3.2, xMax: 3.8, yMin: -2.6, yMax: 3.0 },
    initialPoint: { x: 0, y: 1 },
    description: "以 (2, 1.5) 为圆心的等高线分别外切与内切椭圆，揭示最近点与最远点的法线共线。"
  },
  {
    id: "saddle-circle",
    title: "马鞍面目标 × 圆约束",
    courseTag: "高数下 · 四驻点",
    objective: "x^2 - y^2",
    constraint: "x^2 + y^2 = 4",
    bounds: { xMin: -3.5, xMax: 3.5, yMin: -3.5, yMax: 3.5 },
    initialPoint: { x: Math.SQRT2, y: Math.SQRT2 },
    description: "四个相切驻点交替呈现条件极大值 (±2, 0) 与条件极小值 (0, ±2)，对应 λ = ±1。"
  }
]

export const ODE_1D_PRESETS: readonly Ode1DPreset[] = [
  {
    id: "logistic-growth",
    title: "Logistic 阻滞增长模型",
    courseTag: "高数下 · 微分方程",
    rhs: "y * (1 - y / 3)",
    bounds: { xMin: -2, xMax: 6, yMin: -1, yMax: 4.5 },
    initialPoints: [
      { x: 0, y: 0.3 },
      { x: 0, y: 1.5 },
      { x: 0, y: 4.0 }
    ],
    description: "平衡解 y = 0（不稳定）与 y = 3（环境容纳量，稳定吸引），不同初值呈现 S 形增长或衰减。"
  },
  {
    id: "forced-decay",
    title: "周期强迫线性方程",
    courseTag: "一阶线性 ODE · 稳态响应",
    rhs: "sin(x) - 0.5*y",
    bounds: { xMin: -2, xMax: 10, yMin: -3, yMax: 3 },
    initialPoints: [
      { x: 0, y: -2 },
      { x: 0, y: 0 },
      { x: 0, y: 2.2 }
    ],
    description: "无论初值高低，特解均迅速收敛到同一条周期稳态特解曲线。"
  },
  {
    id: "circle-family",
    title: "正交圆族 y' = -x / y",
    courseTag: "可分离变量经典",
    rhs: "-x / y",
    bounds: { xMin: -4, xMax: 4, yMin: -4, yMax: 4 },
    initialPoints: [
      { x: 0, y: 1.2 },
      { x: 0, y: 2.4 },
      { x: 0, y: -2.0 }
    ],
    description: "斜率场构成同心圆簇 x² + y² = C，在 y = 0 处切线竖直。"
  },
  {
    id: "riccati-parabola",
    title: "非自治方程 y' = x² - y",
    courseTag: "考研一阶线性",
    rhs: "x^2 - y",
    bounds: { xMin: -3.5, xMax: 3.5, yMin: -2, yMax: 6 },
    initialPoints: [
      { x: -2, y: 4 },
      { x: 0, y: 0.5 },
      { x: 0, y: 3.5 }
    ],
    description: "特解逐渐贴近抛物线渐近解 y = x² - 2x + 2，直观展示通解中齐次衰减项。"
  }
]

export const PHASE_PLANE_PRESETS: readonly PhasePlanePreset[] = [
  {
    id: "damped-pendulum",
    title: "阻尼单摆相平面",
    courseTag: "大学物理 / 非线性振动",
    pExpr: "y",
    qExpr: "-sin(x) - 0.35*y",
    bounds: { xMin: -5.2, xMax: 5.2, yMin: -3.5, yMax: 3.5 },
    initialPoints: [
      { x: -3.5, y: 2.2 },
      { x: 2.5, y: 0.8 },
      { x: -1.6, y: 1.5 }
    ],
    description: "在 (0, 0) 为稳定焦点（向最低点衰减停下），在 (±π, 0) 为鞍点（倒立不稳定平衡）。"
  },
  {
    id: "van-der-pol",
    title: "Van der Pol 自激极限环",
    courseTag: "自动控制 / 非线性系统",
    pExpr: "y",
    qExpr: "(1 - x^2)*y - x",
    bounds: { xMin: -3.5, xMax: 3.5, yMin: -3.8, yMax: 3.8 },
    initialPoints: [
      { x: 0.25, y: 0.25 },
      { x: 2.8, y: 1.2 },
      { x: -2.6, y: -1.5 }
    ],
    description: "原点为不稳定焦点；内部轨线向外盘旋、外部轨线向内收缩，全部汇入唯一稳定极限环。"
  },
  {
    id: "lotka-volterra",
    title: "Lotka–Volterra 捕食者模型",
    courseTag: "数学建模 · 生态动力学",
    pExpr: "1.2*x - 0.6*x*y",
    qExpr: "0.4*x*y - 0.8*y",
    bounds: { xMin: -0.4, xMax: 5.2, yMin: -0.4, yMax: 4.5 },
    initialPoints: [
      { x: 1.2, y: 1.2 },
      { x: 3.0, y: 1.0 },
      { x: 3.8, y: 2.6 }
    ],
    description: "原点 (0,0) 为鞍点，共生平衡点 (2, 2) 为中心点，物种数量绕平衡点呈周期闭轨震荡。"
  },
  {
    id: "duffing-double-well",
    title: "Duffing 双势阱相图",
    courseTag: "非线性力学 · 双稳态",
    pExpr: "y",
    qExpr: "x - x^3 - 0.25*y",
    bounds: { xMin: -2.4, xMax: 2.4, yMin: -2.2, yMax: 2.2 },
    initialPoints: [
      { x: -1.8, y: 0.9 },
      { x: 1.8, y: -0.9 },
      { x: 0.2, y: 1.2 }
    ],
    description: "原点 (0,0) 为分界鞍点，左右 (±1, 0) 为两个稳定焦点势阱，直观展示吸引域划分。"
  }
]

export const SURFACE_3D_PRESETS: readonly Surface3DPreset[] = [
  {
    id: "saddle-hyperbolic",
    title: "双曲抛物面（马鞍面）",
    courseTag: "高数下 · 经典鞍点",
    expression: "x^2 - y^2",
    bounds: { xMin: -2.5, xMax: 2.5, yMin: -2.5, yMax: 2.5 },
    description: "原点 (0, 0, 0) 满足 ∇f = 0，但 AC - B² = -4 < 0，沿 x 轴极小、沿 y 轴极大，是典型鞍点。"
  },
  {
    id: "kaoyan-cubic-extrema",
    title: "极小值与鞍点共存曲面",
    courseTag: "考研数一/数二高频",
    expression: "x^3 - 3*x + y^2",
    bounds: { xMin: -2.3, xMax: 2.3, yMin: -2.3, yMax: 2.3 },
    description: "在 (1, 0) 取得局部极小值 -2（AC-B² = 12 > 0），在 (-1, 0) 为鞍点（AC-B² = -12 < 0）。"
  },
  {
    id: "peaks-sin-cos",
    title: "多峰多谷三角曲面",
    courseTag: "多元极值判别综合",
    expression: "sin(x) * cos(y)",
    bounds: { xMin: -3.6, xMax: 3.6, yMin: -3.6, yMax: 3.6 },
    description: "同时呈现多个局部极大值峰、局部极小值谷与规则网格状分布的鞍点。"
  },
  {
    id: "mexican-hat",
    title: "衰减径向波（墨西哥帽）",
    courseTag: "物理/优化 · 非凸曲面",
    expression: "2 * cos(sqrt(x^2 + y^2)) * exp(-0.18*(x^2 + y^2))",
    bounds: { xMin: -4.2, xMax: 4.2, yMin: -4.2, yMax: 4.2 },
    description: "中心 (0, 0) 为全局主峰极大值，外围呈环形波谷极小，用于直观理解梯度下降局部极值。"
  }
]

export const PDE_PRESETS: readonly PdePreset[] = [
  {
    id: "heat-dual-spot",
    title: "双高斯热斑扩散与热平衡",
    courseTag: "数理方程 · 2D 热传导",
    kind: "heat2d",
    initialExpr: "2.2*exp(-2.5*((x+0.9)^2 + y^2)) - 1.8*exp(-2.5*((x-0.9)^2 + y^2))",
    boundary: "neumann",
    param: 0.35,
    bounds: { xMin: -2.2, xMax: 2.2, yMin: -2.2, yMax: 2.2 },
    description: "绝热边界（Neumann）下一正一负热源相互扩散抵消，点击画布可实时注入新热源。"
  },
  {
    id: "wave-ripple-interference",
    title: "双波源水波干涉与边界反射",
    courseTag: "大学物理 · 2D 波动方程",
    kind: "wave2d",
    initialExpr: "1.8*exp(-5*((x+0.8)^2 + y^2)) + 1.8*exp(-5*((x-0.8)^2 + y^2))",
    boundary: "dirichlet",
    param: 1.2,
    bounds: { xMin: -2.4, xMax: 2.4, yMin: -2.4, yMax: 2.4 },
    description: "固定膜边界下两列圆形波向外传播、相干叠加并在边界反相反射，支持切换 3D 动态曲面。"
  },
  {
    id: "poisson-dipole",
    title: "电偶极子稳态电势与电场线",
    courseTag: "电磁学 / 场论 · 泊松方程",
    kind: "poisson2d",
    initialExpr: "12*exp(-6*((x+0.8)^2 + y^2)) - 12*exp(-6*((x-0.8)^2 + y^2))",
    boundaryExpr: "0",
    boundary: "dirichlet",
    param: 1,
    bounds: { xMin: -2.2, xMax: 2.2, yMin: -2.2, yMax: 2.2 },
    description: "SOR 超松弛求解 -∇²u = ρ(x,y)，同步绘制等势线族与负梯度电场向量 -∇u。"
  },
  {
    id: "laplace-saddle-boundary",
    title: "拉普拉斯调和场（非零边界）",
    courseTag: "复变/数理方程 · ∇²u = 0",
    kind: "poisson2d",
    initialExpr: "0",
    boundaryExpr: "x^2 - y^2",
    boundary: "dirichlet",
    param: 1,
    bounds: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
    description: "内部无源（ρ = 0）、边界给定马鞍电势，验证调和函数极值必取在边界上（极值原理）。"
  }
]

export const TAYLOR_PRESETS: readonly TaylorPreset[] = [
  {
    id: "taylor-sin",
    title: "sin(x) 麦克劳林逐阶贴合",
    courseTag: "高数上 · 泰勒公式",
    expression: "sin(x)",
    center: 0,
    order: 5,
    domain: [-6.5, 6.5],
    description: "拖动阶数滑块 n = 1 → 15，直观观察奇数阶多项式逐波峰向两侧延伸贴合。"
  },
  {
    id: "taylor-cauchy-radius",
    title: "1 / (1 + x²) 收敛半径现象",
    courseTag: "考研高频 · 收敛域边界",
    expression: "1 / (1 + x^2)",
    center: 0,
    order: 8,
    domain: [-2.2, 2.2],
    description: "虽然实轴处处无穷可微，但因复平面奇点 ±i，泰勒级数仅在 (-1, 1) 内收敛，|x|>1 剧烈发散！"
  },
  {
    id: "taylor-ln",
    title: "ln(1 + x) 在 (-1, 1] 的收敛",
    courseTag: "高数下 · 幂级数展开",
    expression: "ln(1 + x)",
    center: 0,
    order: 6,
    domain: [-0.95, 2.2],
    description: "直观展示收敛半径 R = 1：在 (-1, 1] 内逐阶贴合，而在 x > 1 处高阶多项式迅速偏离。"
  },
  {
    id: "taylor-exp-cos",
    title: "复合函数 exp(-x²/2)·cos(2x)",
    courseTag: "自动微分高阶展开",
    expression: "exp(-x^2 / 2) * cos(2*x)",
    center: 0,
    order: 8,
    domain: [-3.2, 3.2],
    description: "通过截断幂级数自动微分精确给出任意复合函数的 n 阶泰勒多项式。"
  }
]

export const FOURIER_PRESETS: readonly FourierPreset[] = [
  {
    id: "fourier-square-gibbs",
    title: "周期方波与吉布斯（Gibbs）现象",
    courseTag: "高数下 / 信号与系统",
    waveform: "square",
    harmonics: 9,
    halfPeriod: Math.PI,
    description: "无论谐波阶数 N 增大到多少，间断点两侧始终残留约 8.95% 的尖峰过冲（吉布斯现象）。"
  },
  {
    id: "fourier-sawtooth",
    title: "周期锯齿波谐波合成",
    courseTag: "傅里叶级数经典",
    waveform: "sawtooth",
    harmonics: 8,
    halfPeriod: Math.PI,
    description: "仅含正弦项 bn = (-1)^(n+1)·2/(nπ)，幅频谱按 1/n 缓慢衰减。"
  },
  {
    id: "fourier-triangle",
    title: "连续三角波快速收敛（1/n²）",
    courseTag: "光滑度与谱衰减对比",
    waveform: "triangle",
    harmonics: 5,
    halfPeriod: Math.PI,
    description: "连续无跳变波形的傅里叶系数按 1/n² 高速衰减，仅需 3~5 阶谐波即几乎与原波形重合。"
  },
  {
    id: "fourier-rectified",
    title: "全波整流正弦信号频谱",
    courseTag: "电路 / 信号频谱分析",
    waveform: "full_rectified",
    harmonics: 6,
    halfPeriod: Math.PI,
    description: "展示直流分量 a0/2 = 2/π 与偶次余弦谐波分量，支持本轮旋转圆（Epicycles）可视化。"
  }
]

export const DOUBLE_INTEGRAL_PRESETS: readonly DoubleIntegralPreset[] = [
  {
    id: "parabola-line-swap",
    title: "抛物线 y=x² 与直线 y=x 围成区域",
    courseTag: "高数下 · 交换积分次序",
    integrandExpr: "x + 2*y",
    order: "xy",
    outerMinExpr: "0",
    outerMaxExpr: "1",
    innerMinExpr: "x^2",
    innerMaxExpr: "x",
    swappedTwin: {
      order: "yx",
      outerMinExpr: "0",
      outerMaxExpr: "1",
      innerMinExpr: "y",
      innerMaxExpr: "sqrt(y)"
    },
    description: "支持一键切换「先 y 后 x（竖直扫描条）」与「先 x 后 y（水平扫描条）」，验证交换次序值不变。"
  },
  {
    id: "exp-y2-must-swap",
    title: "考研必考：exp(y²) 必须交换次序",
    courseTag: "考研数一/二/三经典大题",
    integrandExpr: "exp(y^2)",
    order: "yx",
    outerMinExpr: "0",
    outerMaxExpr: "1",
    innerMinExpr: "0",
    innerMaxExpr: "y",
    swappedTwin: {
      order: "xy",
      outerMinExpr: "0",
      outerMaxExpr: "1",
      innerMinExpr: "x",
      innerMaxExpr: "1"
    },
    description: "先积 y 时 ∫exp(y²)dy 无初等原函数；一键换为「先 x 后 y」后内层积出 y·exp(y²)！"
  },
  {
    id: "polar-gaussian-sector",
    title: "第一象限扇形域高斯极坐标积分",
    courseTag: "高数下 · 极坐标 r dr dθ",
    integrandExpr: "exp(-(x^2 + y^2))",
    order: "polar",
    outerMinExpr: "0",
    outerMaxExpr: "pi / 2",
    innerMinExpr: "0",
    innerMaxExpr: "2",
    description: "切换极坐标扇形网格后化为 ∫r·exp(-r²)dr，精确值 π(1-e⁻⁴)/4。"
  },
  {
    id: "polar-cardioid",
    title: "心形线 r = 1 + cos(θ) 曲顶体积",
    courseTag: "极坐标曲线积分域",
    integrandExpr: "1 + 0.5*x",
    order: "polar",
    outerMinExpr: "0",
    outerMaxExpr: "pi",
    innerMinExpr: "0",
    innerMaxExpr: "1 + cos(theta)",
    description: "沿射线 θ 扫描动态展示上半心形线极坐标黎曼扇形分块与积分和收敛。"
  }
]

export const LINALG_PRESETS: readonly LinalgPreset[] = [
  {
    id: "sym-ortho",
    title: "实对称正定矩阵与正交特征轴",
    courseTag: "线性代数 · 二次型主轴",
    matrix: [[2, 0.8], [0.8, 1.2]],
    description: "实对称矩阵必有两条相互正交的特征向量直线，且与 SVD 变换椭圆长短主轴完全重合。"
  },
  {
    id: "shear-area-preserve",
    title: "水平错切变换（det = 1 保面积）",
    courseTag: "行列式几何意义",
    matrix: [[1, 1.2], [0, 1]],
    description: "单位正方形倾斜为底高不变的平行四边形（面积缩放比 det = 1），仅 x 轴一条特征方向。"
  },
  {
    id: "rotation-spiral",
    title: "旋转缩放（复共轭特征值）",
    courseTag: "复特征值几何解释",
    matrix: [[0.8, -0.9], [0.9, 0.8]],
    description: "特征值为共轭复数 0.8 ± 0.9i，平面内不存在方向不变的实特征向量，整体旋转放大。"
  },
  {
    id: "rank1-collapse",
    title: "秩 1 奇异矩阵（二维降维塌缩）",
    courseTag: "考研线代 · 秩与零空间",
    matrix: [[1.2, 0.6], [0.8, 0.4]],
    description: "det(A) = 0, σ₂ = 0：整个二维平面沿着零空间方向被压扁到一条一维列空间直线上！"
  },
  {
    id: "reflection-flip",
    title: "关于 y = x 镜像反射（det = -1）",
    courseTag: "正交变换与定向反转",
    matrix: [[0, 1], [1, 0]],
    description: "特征值 λ₁ = 1（对称轴不变）、λ₂ = -1（垂直轴反向），行列式为负代表空间定向翻转。"
  }
]

export const PROBABILITY_PRESETS: readonly ProbabilityPreset[] = [
  {
    id: "std-normal-95",
    title: "标准正态 95% 双侧置信区间",
    courseTag: "概率统计 · 正态分布",
    kind: "normal",
    param1: 0,
    param2: 1,
    intervalA: -1.96,
    intervalB: 1.96,
    description: "经典的 ±1.96σ 区间覆盖约 95.00% 概率质量，直观对应假设检验 α = 0.05 显著性水平。"
  },
  {
    id: "student-t-small",
    title: "小样本 t(3) 厚尾分布对比",
    courseTag: "数理统计 · 三大抽样分布",
    kind: "student_t",
    param1: 3,
    intervalA: -2,
    intervalB: 2,
    description: "自由度 ν 较小时尾部显著厚于标准正态，随着 ν 增大逐渐逼近 N(0,1)。"
  },
  {
    id: "chi2-test",
    title: "卡方分布 χ²(6) 右尾检验区",
    courseTag: "方差检验 / 拟合优度",
    kind: "chi_square",
    param1: 6,
    intervalA: 0,
    intervalB: 12.59,
    description: "正偏态非负连续分布，期望 E[X] = k = 6，方差 Var(X) = 2k = 12。"
  },
  {
    id: "binomial-approx",
    title: "二项分布 B(20, 0.4) 离散质量",
    courseTag: "离散随机变量 · 棣莫弗定理",
    kind: "binomial",
    param1: 20,
    param2: 0.4,
    intervalA: 6,
    intervalB: 10,
    description: "独立重复伯努利试验成功次数分布，n 增大时包络线逼近正态曲线。"
  }
]
