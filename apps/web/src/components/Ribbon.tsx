import { useEffect, useRef, useState, type ReactNode } from "react"

import type { RibbonCommand, RibbonGroup, RibbonIcon, RibbonTabId } from "../uiState"

export type { RibbonCommand, RibbonGroup, RibbonIcon, RibbonTabId }

interface RibbonProps {
  groups: RibbonGroup[]
  activeTab: RibbonTabId | null
  expanded: boolean
  pinned: boolean
  onTabChange: (tab: RibbonTabId | null) => void
  onCommand: (commandId: string) => void
  onExpandedChange: (expanded: boolean) => void
  onPinnedChange: (pinned: boolean) => void
  showControls?: boolean
}

function isTextEditingTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || (target instanceof HTMLElement && target.isContentEditable)
}

function RibbonGlyph({ name }: { name: RibbonIcon }): ReactNode {
  const paths: Record<RibbonIcon, ReactNode> = {
    select: <path d="m5 4 10 8-5 1 3 6-2 1-3-6-3 4Z" />,
    point: <circle cx="12" cy="12" r="4" />,
    line: <path d="m5 19 14-14M5 5h3M16 19h3" />,
    segment: <path d="m6 18 12-12M5 18h3M16 6h3" />,
    ray: <path d="m5 19 14-14M15 5h4v4" />,
    polyline: <path d="m4 17 5-8 5 5 6-8M4 17h.01M9 9h.01M14 14h.01M20 6h.01" />,
    circle: <circle cx="12" cy="12" r="7" />,
    arc: <path d="M5 16a8 8 0 0 1 12-9M5 16h4M5 16l2-4" />,
    parabola: <path d="M6 5c8 2 8 12 0 14M18 5c-8 2-8 12 0 14" />,
    ellipse: <ellipse cx="12" cy="12" rx="8" ry="5" />,
    hyperbola: <path d="M5 5c4 4 4 10 0 14M19 5c-4 4-4 10 0 14" />,
    function: <path d="M4 17c3-8 6-10 9-5s5 4 7-5M4 20h16" />,
    text: <path d="M5 5h14M12 5v14M8 19h8" />,
    image: <><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m5 17 4-4 3 3 2-2 5 4" /></>,
    delete: <><path d="M5 7h14M10 4h4l1 3H9Z" /><path d="M7 7v13h10V7M10 10v7M14 10v7" /></>,
    lock: <><rect x="6" y="10" width="12" height="10" rx="2" /><path d="M9 10V7a3 3 0 0 1 6 0v3" /></>,
    rotate: <><path d="M20 12a8 8 0 1 1-3-6.2" /><path d="M21 4v5h-5" /><circle cx="12" cy="12" r="1.5" /></>,
    svg: <><path d="M7 4h8l3 3v13H7Z" /><path d="M15 4v4h4M10 14l2 2 4-5" /></>,
    csv: <><path d="M5 4h14v16H5Z" /><path d="M5 9h14M10 9v11M15 9v11" /></>,
    png: <><rect x="4" y="5" width="16" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m5 17 4-4 3 3 2-2 5 4" /></>
  }
  return <svg className="ribbon-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}

export function Ribbon({ groups, activeTab, expanded, pinned, onTabChange, onCommand, onExpandedChange, onPinnedChange, showControls = true }: RibbonProps) {
  const visible = expanded || activeTab !== null
  const ribbonRef = useRef<HTMLElement>(null)
  /**
   * **每个分组各自可折叠**（"可展开卡片组"）。
   *
   * 默认**全部展开** —— 这条不能动：`e2e/ribbon-ui.spec.ts`、`measurement-labels.spec.ts` 等
   * 都是"固定功能区 → 直接点某个命令"，默认折叠会让它们全部找不到按钮。
   *
   * 折叠**收的是宽度，不是高度**：功能区始终是单行（见 `global.css` 里 `.ribbon-body` 的说明），
   * 所以收起来的效果是"右边的分组不用再横向滚动就能看到"，而不是"画布变高"。
   *
   * 状态放在组件里、按分组 id 记，切换工作区时保留 —— 这是"我想少看点东西"的偏好，
   * 不该因为换了个工作区就被重置。
   */
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<RibbonGroup["id"]>>(() => new Set())
  const toggleGroup = (id: RibbonGroup["id"]) => {
    setCollapsedGroups((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  /**
   * **横向溢出检测**：只要内容比可视宽度宽，就在右边缘显示一层渐隐，告诉用户"右边还有东西"。
   *
   * 为什么需要它：立体几何有 26 个命令、内容实需 2064px，而 1280px 窗口下功能区只有 1208px
   * （实测 12 个命令完全在屏幕外，`多模态输入`/`作业操作`/`文件输出` 三组全被截断）。
   * 一行放不下是**数学事实**，不是能靠调间距解决的；能解决的是"用户不知道右边还有"。
   *
   * 折叠状态变化会改变内容宽度，所以 `collapsedGroups` 也在依赖里 —— 否则收起一组之后
   * 渐隐不会消失。`ResizeObserver` 负责窗口缩放与字体加载后的重新测量。
   */
  const bodyRef = useRef<HTMLDivElement>(null)
  const [overflowing, setOverflowing] = useState(false)
  /**
   * 分组结构的指纹。**必须有它**：切换工作区会换掉整组命令（平面几何 21 个 → 立体几何 26 个），
   * 但 `.ribbon-body` 自身的外框尺寸没变，所以 `ResizeObserver` 不会触发、effect 也不会重跑 ——
   * 实测 1680px 下切到立体几何/工程制图时 `data-overflow` 仍停在 `false`，
   * 而内容其实是溢出的（2064 / 2488px vs 1608px 可视）。
   * 用字符串指纹而不是 `groups` 数组本身：后者每次渲染都是新引用，会让 observer 每帧重建。
   */
  const groupsKey = groups.map((group) => `${group.id}:${group.commands.length}`).join("|")
  useEffect(() => {
    const element = bodyRef.current
    if (!element) return
    const measure = () => setOverflowing(element.scrollWidth > element.clientWidth + 1)
    measure()
    // jsdom（单测环境）没有 ResizeObserver，所以这里不能直接 new。
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure)
    observer?.observe(element)
    window.addEventListener("resize", measure)
    return () => { observer?.disconnect(); window.removeEventListener("resize", measure) }
  }, [visible, collapsedGroups, groupsKey])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "F1" || !(event.ctrlKey || event.metaKey) || event.altKey || isTextEditingTarget(event.target)) return
      event.preventDefault()
      onExpandedChange(!expanded)
      if (expanded) onTabChange(null)
    }
    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [expanded, onExpandedChange, onTabChange])

  useEffect(() => {
    if (expanded || !activeTab || pinned) return
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[data-ribbon-control]")) return
      if (!ribbonRef.current?.contains(event.target as Node)) onTabChange(null)
    }
    document.addEventListener("pointerdown", handlePointerDown)
    return () => document.removeEventListener("pointerdown", handlePointerDown)
  }, [activeTab, expanded, onTabChange, pinned])

  return <section ref={ribbonRef} className={`ribbon ${visible ? "is-visible" : "is-collapsed"} ${expanded ? "is-expanded" : "is-floating"}`} data-ribbon-expanded={expanded ? "true" : "false"} data-ribbon-pinned={pinned ? "true" : "false"} data-overflow={overflowing ? "true" : "false"} aria-label="功能区">
    {showControls && <div className="ribbon-controls" role="toolbar" aria-label="功能区控制">
      <button type="button" className="ribbon-control" aria-label={expanded ? "收起功能区" : "展开功能区"} onClick={() => { onExpandedChange(!expanded); if (expanded) onTabChange(null) }}><span aria-hidden="true">{expanded ? "⌃" : "⌄"}</span></button>
      <button type="button" className={`ribbon-control ${pinned ? "is-active" : ""}`} aria-label={pinned ? "取消固定功能区" : "固定功能区"} aria-pressed={pinned} onClick={() => onPinnedChange(!pinned)}><span aria-hidden="true">{pinned ? "●" : "○"}</span></button>
    </div>}
    {visible && <div className="ribbon-body" ref={bodyRef}>
      {groups.map((group) => {
        const collapsed = collapsedGroups.has(group.id)
        return <div className="ribbon-group" key={group.id} data-ribbon-group={group.id} data-collapsed={collapsed ? "true" : "false"}>
          {/* 分组标题移到**卡片头部**并变成折叠开关。
              原来它是一条撑满分组宽度的说明文字压在命令下面（实测最宽的组 1621px），
              既不像标题、也没有任何交互；移到头部之后它同时承担"这组叫什么"和"收起这组"，
              而且**净高度反而更小**：省掉了底部那一行 27px，只多了 18px 的头。 */}
          <button type="button" className="ribbon-group-toggle" aria-expanded={!collapsed} onClick={() => toggleGroup(group.id)}>
            <span className="ribbon-group-label">{group.label}</span>
            <svg className="ribbon-group-chevron" viewBox="0 0 12 12" aria-hidden="true"><path d={collapsed ? "m4.5 2.5 3.5 3.5-3.5 3.5" : "m2.5 4.5 3.5 3.5 3.5-3.5"} /></svg>
          </button>
          {!collapsed && <div className="ribbon-group-commands">{group.commands.map((command) => <button key={command.id} type="button" className="ribbon-command" aria-label={command.label} title={command.disabled ? command.disabledReason : command.prompt} disabled={command.disabled} onClick={() => { onCommand(command.id); if (!expanded && !pinned) onTabChange(null) }}><RibbonGlyph name={command.icon} /><span>{command.label}</span></button>)}</div>}
        </div>
      })}
    </div>}
  </section>
}
