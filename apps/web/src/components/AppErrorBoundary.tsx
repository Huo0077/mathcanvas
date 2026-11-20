import { Component, type ErrorInfo, type ReactNode } from "react"

export interface AppErrorBoundaryProps {
  children: ReactNode
  scope?: "app" | "canvas3d"
}

interface AppErrorBoundaryState {
  hasError: boolean
  message: string
}

/**
 * 界面级异常兜底边界：防止单次渲染/WebGL/事件异常导致整棵 React 树卸载成白屏或“假闪退”。
 */
export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { hasError: false, message: "" }

  static getDerivedStateFromError(error: unknown): AppErrorBoundaryState {
    const message = error instanceof Error ? error.message : String(error ?? "未知渲染异常")
    return { hasError: true, message }
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`[MathCanvas:${this.props.scope ?? "app"}] boundary caught error:`, error, info.componentStack)
  }

  private handleResetView = () => {
    this.setState({ hasError: false, message: "" })
  }

  private handleClearDraftsAndReload = () => {
    try {
      for (const key of ["mathcanvas:draft:geometry3d", "mathcanvas:draft:conics", "mathcanvas:draft:cad"]) {
        localStorage.removeItem(key)
      }
    } catch {
      // 存储不可写时继续走页面重载恢复
    }
    this.setState({ hasError: false, message: "" })
    if (typeof window !== "undefined") window.location.reload()
  }

  render(): ReactNode {
    if (!this.state.hasError) return this.props.children

    const is3d = this.props.scope === "canvas3d"
    return (
      <div
        role="alert"
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "12px",
          padding: "24px",
          minHeight: is3d ? "240px" : "100vh",
          color: "#1f2937",
          background: "#f8fafc",
          textAlign: "center"
        }}
      >
        <strong>{is3d ? "三维视图渲染出现异常，已自动隔离" : "界面渲染遇到异常，已自动拦截闪退"}</strong>
        <span style={{ fontSize: "13px", color: "#475569", maxWidth: "520px", wordBreak: "break-word" }}>
          {this.state.message || "渲染上下文中断或数据异常"}
        </span>
        <div style={{ display: "flex", gap: "8px" }}>
          <button type="button" onClick={this.handleResetView}>
            恢复视图
          </button>
          <button type="button" onClick={this.handleClearDraftsAndReload}>
            重置本地草稿并重载
          </button>
        </div>
      </div>
    )
  }
}
