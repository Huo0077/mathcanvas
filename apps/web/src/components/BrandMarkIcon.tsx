/**
 * MathCanvas 专属几何品牌徽标（Block 10）。
 *
 * 视觉特征融合 MathCanvas 的三大核心基因：
 * 1. **三维等轴测多面体与虚线剖切面**（3D Spatial Polyhedron & Section）：代表立体几何显式拓扑、截面与展开内核；
 * 2. **内接解析圆与倾角圆锥曲线轨道**（2D Analytic Conic Locus）：代表平面解析几何、圆锥曲线与在轨动点约束；
 * 3. **交互控制顶点与顶点 AI 星芒**（Interactive Vertex & AI Spark）：代表直觉化顶点拖拽形变与 AI Copilot 智能推理共创。
 */
export function BrandMarkIcon() {
  return (
    <svg
      className="brand-mark-svg"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      data-brand-icon="mathcanvas-prism"
    >
      {/* 2D 解析几何基准内接虚线圆 */}
      <circle
        className="brand-mark-circle"
        cx="16"
        cy="16.5"
        r="11.2"
        stroke="currentColor"
        strokeOpacity="0.28"
        strokeWidth="1"
        strokeDasharray="2 1.8"
      />
      {/* 3D 等轴测六面体顶面与左侧面微光片 */}
      <polygon
        points="16,6.2 24.6,11.2 16,16.2 7.4,11.2"
        fill="currentColor"
        fillOpacity="0.22"
      />
      <polygon
        points="7.4,11.2 16,16.2 16,26.2 7.4,21.2"
        fill="currentColor"
        fillOpacity="0.12"
      />
      {/* 内部隐线与对角剖切虚线 */}
      <path
        d="M7.4 21.2 L16 16.2 L24.6 21.2"
        stroke="currentColor"
        strokeOpacity="0.42"
        strokeWidth="1.05"
        strokeDasharray="1.6 1.6"
        strokeLinecap="round"
      />
      {/* 3D 多面体主棱线外框 */}
      <polygon
        points="16,6.2 24.6,11.2 24.6,21.2 16,26.2 7.4,21.2 7.4,11.2"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinejoin="round"
      />
      <path
        d="M7.4 11.2 L16 16.2 L24.6 11.2 M16 16.2 L16 26.2"
        stroke="currentColor"
        strokeOpacity="0.9"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 环绕立体的解析椭圆轨道（2D/3D 交汇） */}
      <ellipse
        className="brand-mark-orbit"
        cx="16"
        cy="16.2"
        rx="13.2"
        ry="5.1"
        transform="rotate(-24 16 16.2)"
        stroke="currentColor"
        strokeOpacity="0.88"
        strokeWidth="1.25"
      />
      {/* 几何控制顶点 */}
      <circle cx="7.4" cy="11.2" r="1.45" fill="currentColor" />
      <circle cx="24.6" cy="11.2" r="1.45" fill="currentColor" />
      <circle cx="16" cy="26.2" r="1.45" fill="currentColor" />
      <circle cx="16" cy="16.2" r="1.65" fill="currentColor" />
      {/* 顶部顶点 AI 智慧四芒星（象征智能几何推理） */}
      <path
        className="brand-mark-spark"
        d="M16 2.2 L17.05 5.15 L20 6.2 L17.05 7.25 L16 10.2 L14.95 7.25 L12 6.2 L14.95 5.15 Z"
        fill="currentColor"
      />
    </svg>
  )
}
