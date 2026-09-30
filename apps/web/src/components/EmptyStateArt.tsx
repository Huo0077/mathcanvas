/**
 * 空状态插画。
 *
 * 此前两处"这里还没有内容"的版面都在用**字符**凑图形：属性面板是一个 `⌁`
 * （U+2301 ELECTRIC ARROW），Agent 欢迎页干脆没有图形。字符当插画有三个问题：
 * 字形随系统字体变（Windows / macOS / 不同中文字体下完全不同）、
 * 无法控制线宽与对齐、而且在 52px 的圆里往往偏上或偏下。
 *
 * 这里换成内联 SVG：线宽、圆角、端点都在自己的坐标系里，`currentColor` 让颜色仍由 CSS 决定
 * （沿用 `--color-accent`），缩放不糊，也不会随字体走形。
 *
 * 两个画法都刻意保持"少而准"：空状态是**引导**，不是装饰，图形一复杂就抢走正文的注意力。
 */
export type EmptyStateArtName = "selection" | "agent"

export function EmptyStateArt({ name }: { name: EmptyStateArtName }) {
  const art = {
    /**
     * 平面几何的"还没选东西"：极淡的十字准线 + 一个圆 + 一条割线与其两个端点。
     * 十字线用 `strokeOpacity` 压到 0.22 —— 它的作用是暗示"这是画布"，不是画一个坐标系。
     */
    selection: <>
      <path d="M8 32h48M32 8v48" strokeOpacity="0.22" strokeWidth="1" />
      <circle cx="38" cy="26" r="13" strokeWidth="1.6" />
      <path d="M12 50 54 42" strokeWidth="1.6" />
      <circle cx="12" cy="50" r="2.8" fill="currentColor" stroke="none" />
      <circle cx="54" cy="42" r="2.8" fill="currentColor" stroke="none" />
      <circle cx="38" cy="26" r="1.9" fill="currentColor" stroke="none" strokeOpacity="0.55" />
    </>,
    /**
     * Agent 的"还没开始对话"：一个对话气泡 + 里面一条函数曲线。
     * 气泡的尾巴画成折线而不是三角，避免在大圆角下出现尖角。
     */
    agent: <>
      <path d="M14 14h36a6 6 0 0 1 6 6v18a6 6 0 0 1-6 6H30l-10 8v-8h-6a6 6 0 0 1-6-6V20a6 6 0 0 1 6-6Z" strokeWidth="1.6" />
      <path d="M20 34c4-7 8-7 12-1s8 6 12-2" strokeWidth="1.6" />
      <circle cx="20" cy="34" r="2.2" fill="currentColor" stroke="none" />
      <circle cx="44" cy="31" r="2.2" fill="currentColor" stroke="none" />
    </>
  }
  return <svg className="empty-state-art" viewBox="0 0 64 64" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{art[name]}</svg>
}
