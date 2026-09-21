/**
 * 设置界面用到的图标。**内联 SVG、`currentColor`、没有 emoji**。
 *
 * 为什么手写这几个而不是引一个图标库：整份界面一共用到四个字形（加号、叉、
 * 对勾、右箭头），而一个图标库会带进几百个用不到的字形与一份需要跟着升级的依赖。
 * 内联 SVG 还能直接吃 `currentColor`，于是它随文字颜色走 —— 不必为每种状态
 * 再配一遍图标颜色。
 */

interface IconProps {
  /** 视觉尺寸（像素）。缺省 16。 */
  size?: number
}

function frame(size: number, children: React.ReactNode, label?: string) {
  return <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden={label ? undefined : true}
    role={label ? "img" : undefined}
    aria-label={label}
    focusable="false"
  >
    {children}
  </svg>
}

export function PlusIcon({ size = 16 }: IconProps) {
  return frame(size, <><path d="M8 3.5v9" /><path d="M3.5 8h9" /></>)
}

export function XIcon({ size = 16 }: IconProps) {
  return frame(size, <><path d="M4 4l8 8" /><path d="M12 4l-8 8" /></>)
}

export function CheckIcon({ size = 16 }: IconProps) {
  return frame(size, <path d="M3.5 8.5l3 3 6-7" />)
}

export function PencilIcon({ size = 16 }: IconProps) {
  return frame(size, <><path d="M11 2.8l2.2 2.2-7.4 7.4-2.8.6.6-2.8z" /><path d="M9.6 4.2l2.2 2.2" /></>)
}

export function TrashIcon({ size = 16 }: IconProps) {
  return frame(size, <><path d="M2.8 4.5h10.4" /><path d="M6.2 4.5V3.2h3.6v1.3" /><path d="M4.2 4.5l.7 8.3h6.2l.7-8.3" /><path d="M6.7 7v3.6" /><path d="M9.3 7v3.6" /></>)
}

export function BoltIcon({ size = 16 }: IconProps) {
  return frame(size, <path d="M8.8 1.8L3.5 9h3.4l-.7 5.2L11.5 7H8.1z" />)
}
