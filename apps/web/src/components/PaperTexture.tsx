/**
 * 全局的**纸纹噪点滤镜**（磨砂质感的来源）。
 *
 * 为什么用 SVG 滤镜而不是一张噪点图片：`feTurbulence` 是程序生成的，既不占体积、也不必随主题换色。
 * 它只定义一次（`#paper-grain`），由 CSS 通过 `filter: url(#paper-grain)` 引用 —— 纸面与面板共用同一份纹理，
 * 于是整个界面是"同一种材质"，而不是每处各贴一张图。
 *
 * 尺寸取 0：它只是纹理的定义，不该在布局里占位置。
 */
export function PaperTexture() {
  return <svg className="paper-texture" aria-hidden="true" focusable="false" width="0" height="0">
    <filter id="paper-grain" x="0" y="0" width="100%" height="100%">
      {/* 细密的灰度噪点：baseFrequency 越高颗粒越细；numOctaves 保持 1，多倍频会冒出可见的斑块。 */}
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" stitchTiles="stitch" result="grain" />
      {/* 把噪点压到统一的浅灰：直接用彩色噪点会在纸面上泛出彩色颗粒，看着很脏。 */}
      <feColorMatrix in="grain" type="saturate" values="0" result="grey" />
      <feComponentTransfer in="grey">
        <feFuncA type="linear" slope="0.055" />
      </feComponentTransfer>
    </filter>
  </svg>
}
