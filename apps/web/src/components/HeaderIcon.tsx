/**
 * 顶栏用的小线性图标。
 *
 * 单独成文件是因为它现在**两处都要用**：顶栏品牌（`WorkspaceHeader`）与标签栏右端的命令组
 * （`WorkspaceTabs`）。留在其中一个组件里再互相 import 会让依赖方向变得奇怪。
 */
export type HeaderIconName = "grid" | "curve" | "integral" | "cube" | "search" | "settings" | "user"

export function HeaderIcon({ name }: { name: HeaderIconName }) {
  const paths = {
    grid: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    curve: <><path d="M4 17c3-8 6-10 9-5s5 4 7-5" /><path d="M4 20h16" /></>,
    integral: <path d="M16 4c-4 0-3 4-3 8s1 8-3 8M10 4h8M7 20h8" />,
    cube: <><path d="m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z" /><path d="M4.5 7.8 12 12l7.5-4.2M12 12v9" /></>,
    search: <><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4 4" /></>,
    settings: <><path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z" /><path d="m19.4 15 .1.1a2 2 0 0 1-2.8 2.8l-.1-.1a2 2 0 0 0-3.4 1.4v.2a2 2 0 0 1-4 0v-.2a2 2 0 0 0-3.4-1.4l-.1.1A2 2 0 0 1 3 15.1l.1-.1A2 2 0 0 0 1.7 11.6h-.2a2 2 0 0 1 0-4h.2A2 2 0 0 0 3.1 4.2L3 4.1A2 2 0 0 1 5.8 1.3l.1.1a2 2 0 0 0 3.4-1.4v-.2a2 2 0 0 1 4 0V0a2 2 0 0 0 3.4 1.4l.1-.1A2 2 0 0 1 19.6 4l-.1.1a2 2 0 0 0 1.4 3.4h.2a2 2 0 0 1 0 4h-.2a2 2 0 0 0-1.5 3.5Z" transform="translate(0 3) scale(.72)" /></>,
    user: <><circle cx="12" cy="8" r="3.3" /><path d="M5.5 20c.7-3.5 2.8-5.2 6.5-5.2s5.8 1.7 6.5 5.2" /></>
  }
  return <svg className="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name]}</svg>
}
