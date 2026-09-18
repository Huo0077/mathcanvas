import type { Workspace } from "@draw/dsl"

import { BRAND_TEXT, brandParticles } from "../brandParticles"

/**
 * 顶部导航栏。
 *
 * 2026-09-18 按用户口径重排：
 * - 「把顶部的 MathCanvas 一栏中图片的内容放到下面一栏（平面几何、立体几何）的右端」
 *   —— 文件命令、搜索、设置原来都在这里，现在全部下沉到 `WorkspaceTabs` 的右端，
 *   顶栏只剩品牌一件事；
 * - 「把右侧的光标删除」—— 高亮的「用户中心」按钮已移除；
 * - 「把动态粒子效果加入到 MathCanvas 一栏，光标中的文字就是 MathCanvas」
 *   —— 品牌字样带打字动画与方块光标（顶栏因此只有一个视觉焦点）。
 */
interface WorkspaceHeaderProps {
  activeWorkspace?: Workspace
  onWorkspaceChange?: (workspace: Workspace) => void
}

export function WorkspaceHeader(_props: WorkspaceHeaderProps) {
  return <header className="topbar">
    <div className="brand">
      {/* 粒子只在品牌两侧的留白里漂，`aria-hidden` 因为它是纯装饰。
          行内只写"每颗粒子自己的"那几项（位置 / 大小 / 基础不透明度 / 节奏），
          位移与缩放交给 CSS 关键帧 —— 见 `global.css` 的 `brand-particle-float`。 */}
      <span className="brand-particles" aria-hidden="true">
        {brandParticles().map((particle, index) => <i
          key={index}
          style={{
            left: `${particle.left}%`,
            top: `${particle.top}%`,
            width: `${particle.size}px`,
            height: `${particle.size}px`,
            opacity: particle.opacity,
            animationDelay: `${particle.delay}s`,
            animationDuration: `${particle.duration}s`,
            // 每颗粒子的浮动幅度不同：位移交给关键帧，幅度通过这个变量传进去。
            "--particle-rise": `${particle.rise}px`
          } as never}
        />)}
      </span>
      <span className="brand-mark" aria-hidden="true">∑</span>
      {/* 打字 + 方块光标：宽度按字符数推进，光标跟在可见字符之后。 */}
      <span className="brand-type" aria-label={BRAND_TEXT}>
        <span className="brand-text" aria-hidden="true">{BRAND_TEXT}</span>
        <span className="brand-cursor" aria-hidden="true" />
      </span>
    </div>
  </header>
}
