import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"
import { maybeRunExamFromShell } from "./agent/fixtures/examRunCli"
import "./styles/global.css"
// Agent 工作区（模块 B）自成一套版式：单独一份样式表，改动它不会碰到画布的那套规则。
import "./styles/agent.css"
// 模型服务（模块 C）：配置表单的版式，同样与画布那套规则互不干扰。
import "./styles/settings.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* 纸纹滤镜由 `App` 自己渲染（它的 CSS 就在 App 的可视子树里，见 `components/PaperTexture.tsx`）。 */}
    <App />
  </StrictMode>
)

/**
 * **受闸的评测跑**（Task 20）：只有带 `--exam-run <报告路径>` 启动的桌面壳才会走到这里。
 *
 * 放在渲染之后、"发出去不管"：它**不改界面**（评测跑不需要人看窗口），
 * 浏览器里 `exam_run_target` 那条 IPC 直接失败、这个调用立刻返回 ——
 * 所以普通开发与测试一点都感觉不到它存在。跑完由它把报告交给 Rust 并退出。
 */
void maybeRunExamFromShell()
