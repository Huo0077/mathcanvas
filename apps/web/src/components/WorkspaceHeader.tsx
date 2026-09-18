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
          位置写成 **`--px` / `--py`（`translate3d` 的基准偏移，单位 px）而不是 `left` / `top`**：
          后两者逐帧触发**布局**，动画就只能跑在主线程上；换成 transform 之后整条动画
          都能在合成器线程完成（用户反馈"帧率很低"，这是主因之一）。
          百分比 → px 的换算用粒子层的固定尺寸（品牌约 96px + 左右各 56px / 高 56px），
          常量写死是为了让这一层不依赖测量；偏差只影响粒子落在留白里的具体位置，不影响观感。 */}
      <span className="brand-particles" aria-hidden="true">
        {brandParticles().map((particle, index) => {
          const size = Math.round(particle.size * 10) / 10
          const x = Math.round(((particle.left / 100) * 208 - size / 2) * 10) / 10
          const y = Math.round(((particle.top / 100) * 56 - size / 2) * 10) / 10
          return <i
            key={index}
            style={{
              width: `${size}px`,
              height: `${size}px`,
              opacity: particle.opacity,
              animationDelay: `${particle.delay}s`,
              animationDuration: `${particle.duration}s`,
              // 每颗粒子的浮动幅度不同：幅度通过这个变量传进关键帧。
              "--particle-rise": `${particle.rise}px`,
              "--px": `${x}px`,
              "--py": `${y}px`
            } as never}
          />
        })}
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
