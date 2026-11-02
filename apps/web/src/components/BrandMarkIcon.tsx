/**
 * MathCanvas 专属几何品牌徽标（Block 10）。
 *
 * 视觉特征融合 MathCanvas 的三大核心基因（与桌面端 `icon.svg` / `icon.ico` 完全同源）：
 * 1. **三维等轴测多面体与虚线剖切面**（3D Spatial Polyhedron & Section）：代表立体几何显式拓扑、截面与展开内核；
 * 2. **内接解析圆与倾角圆锥曲线轨道**（2D Analytic Conic Locus）：代表平面解析几何、圆锥曲线与在轨动点约束（含琥珀金特征动点）；
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
        stroke="#93c5fd"
        strokeOpacity="0.42"
        strokeWidth="1"
        strokeDasharray="2 1.8"
      />
      {/* 3D 等轴测六面体三面受光层 */}
      <polygon
        points="16,6.2 24.6,11.2 16,16.2 7.4,11.2"
        fill="#bfdbfe"
        fillOpacity="0.34"
      />
      <polygon
        points="7.4,11.2 16,16.2 16,26.2 7.4,21.2"
        fill="#60a5fa"
        fillOpacity="0.22"
      />
      <polygon
        points="16,16.2 24.6,11.2 24.6,21.2 16,26.2"
        fill="#1e3a5f"
        fillOpacity="0.36"
      />
      {/* 内部隐线与对角剖切虚线 */}
      <path
        d="M7.4 21.2 L16 16.2 L24.6 21.2 M7.4 11.2 L24.6 11.2 L16 26.2 Z"
        stroke="#bae6fd"
        strokeOpacity="0.52"
        strokeWidth="1"
        strokeDasharray="1.6 1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 3D 多面体主棱线外框 */}
      <polygon
        points="16,6.2 24.6,11.2 24.6,21.2 16,26.2 7.4,21.2 7.4,11.2"
        stroke="#f8fafc"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M7.4 11.2 L16 16.2 L24.6 11.2 M16 16.2 L16 26.2"
        stroke="#e0f2fe"
        strokeOpacity="0.95"
        strokeWidth="1.35"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* 环绕立体的解析椭圆轨道（2D/3D 交汇） */}
      <ellipse
        className="brand-mark-orbit"
        cx="16"
        cy="16.2"
        rx="13.4"
        ry="5.1"
        transform="rotate(-24 16 16.2)"
        stroke="#7dd3fc"
        strokeOpacity="0.92"
        strokeWidth="1.3"
      />
      {/* 几何控制顶点（带深色描边环） */}
      <circle cx="7.4" cy="11.2" r="1.55" fill="#f8fafc" stroke="#172033" strokeWidth="0.65" />
      <circle cx="24.6" cy="11.2" r="1.55" fill="#f8fafc" stroke="#172033" strokeWidth="0.65" />
      <circle cx="16" cy="26.2" r="1.55" fill="#f8fafc" stroke="#172033" strokeWidth="0.65" />
      <circle cx="16" cy="16.2" r="1.75" fill="#bae6fd" stroke="#172033" strokeWidth="0.7" />
      {/* 轨道上的琥珀金特征动点（象征动态几何轨迹约束） */}
      <circle cx="27.3" cy="11.2" r="1.85" fill="#f59e0b" stroke="#172033" strokeWidth="0.65" />
      {/* 顶部顶点 AI 智慧四芒星（象征智能几何推理） */}
      <path
        className="brand-mark-spark"
        d="M16 1.8 L17.15 5.05 L20.4 6.2 L17.15 7.35 L16 10.6 L14.85 7.35 L11.6 6.2 L14.85 5.05 Z"
        fill="#ffffff"
      />
    </svg>
  )
}
