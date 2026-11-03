import type { ReactNode } from "react"
import { BRAND_TEXT } from "../brandParticles"

export function WorkspaceHeader({ title, children }: { title?: string; children?: ReactNode }) {
  return <header className="clean-header">
    <span className="workspace-brand">{BRAND_TEXT}</span>
    {title && <span className="clean-document-title">{title}</span>}
    {children && <div className="clean-header-actions">{children}</div>}
  </header>
}
