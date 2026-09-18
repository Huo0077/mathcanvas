import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"
import "./styles/global.css"
// Agent 工作区（模块 B）自成一套版式：单独一份样式表，改动它不会碰到画布的那套规则。
import "./styles/agent.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* 纸纹滤镜由 `App` 自己渲染（它的 CSS 就在 App 的可视子树里，见 `components/PaperTexture.tsx`）。 */}
    <App />
  </StrictMode>
)
