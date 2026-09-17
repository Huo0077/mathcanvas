import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import { App } from "./App"
import "./styles/global.css"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    {/* 纸纹滤镜由 `App` 自己渲染（它的 CSS 就在 App 的可视子树里，见 `components/PaperTexture.tsx`）。 */}
    <App />
  </StrictMode>
)
