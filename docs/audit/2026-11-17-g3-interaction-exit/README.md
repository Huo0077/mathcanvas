# G3 Task 6：T16 对话作图全生命周期、Windows 桌面 no-bundle 构建与全量端到端回归证据

- **日期**：2026-11-17
- **代码基准**：`a4469381`（Task 4 `G3-Math 36/36` 收口）+ Task 6（`T16` 生命周期 E2E、面板已丢弃/已提交态按钮收口、路由兼容修复与 Windows 桌面 `no-bundle` 构建）

## 一、核心工程改动

1. **`T16` 完整UI生命周期测试（`e2e/drawing-reliability-lifecycle.spec.ts`）**
   - 覆盖**确认前零写入**（暂存后 `mathcanvas:draft:geometry3d` 为 0 图元、展示 `data-certificate-status="passed"`）、**快速双击原子一次提交**（仅推进一版）、**一步撤销 / 重做**、**刷新与 `.mgeo` 保存-清空-重导入拓扑/哈希一致性**、**丢弃草稿零写入**、**跨对话隔离**、**矛盾条件拒交**（无确认按钮），以及 **`GK-S05` 棱上动点 `B₂` 真实拖动与一步撤销还原**。
2. **实测曝光并修复的产品问题**
   - [`apps/web/src/components/agent/AgentMessageList.tsx`](../../../apps/web/src/components/agent/AgentMessageList.tsx)：当 `message.commit` 已落盘（`"committed"` 或 `"no_change"` / 丢弃草稿）时，不再向 `ConfirmationPanel` 传入 `onConfirm` / `onDiscard`，消除“点过丢弃草稿后按钮仍留在面板上”的隐患；并在 `AgentPieces.test.tsx` 补充回归测试（9/9 passed）。
   - [`packages/agent-core/src/solver/planarDrawing.ts`](../../../packages/agent-core/src/solver/planarDrawing.ts)：避免拦截包含符号参数不变量（如 `任意一点` + `切线` + `恒为`）的题目，保证 `CONIC_INVARIANT_PROMPT` 保留参数 `theta`/`OA`/`OB`/`invariant`；对方程唯一确定参数的圆锥曲线明确附带“唯一确定”说明（且不含“示例值”）。
   - [`packages/agent-core/src/solver/functionDrawingPlan.ts`](../../../packages/agent-core/src/solver/functionDrawingPlan.ts)：在无 LaTeX 替换与无选项的常规中文输入下于 `diagramPrompt` 保留原函数文本（如 `f(x)=x³−3x`），既维持 `GK-P09` 通过又保留历史 UI 对齐。

## 二、验证清单（最后一次代码编辑后全部退出 0）

- `npm run typecheck`：exit 0（全 workspace + `e2e/tsconfig.json` + `scripts/tsconfig.json`）。
- `npm run lint`：exit 0（0 errors）。
- `npm --workspace @draw/desktop run build`（含 `@draw/web` 生产构建 → `tauri build --no-bundle`）：exit 0；产物 [`apps/desktop/src-tauri/target/release/mathcanvas-desktop.exe`](../../../apps/desktop/src-tauri/target/release/mathcanvas-desktop.exe) SHA-256：`826c6fc34b7bde2d23ff4620aa8e5ece6ca41630bbc361258585d901d91b9b0c`。
- `npm run eval:reliability -- --offline`（`eval-results/reliability/offline-2026-11-17T01-11-30.766Z-49204`）：**31/31 passed**（`meanObjectCoverage: 1`、`meanObligationCoverage: 1`、`incomplete: 0`）。
- `npm run eval:reliability -- --offline --cases test-fixtures/reliability/drawing-contracts-36.json`（`eval-results/reliability/offline-2026-11-17T01-11-46.339Z-47148`）：**36/36 passed**（`passed: 36, partial: 0, failed: 0, incomplete: 0`，`liveWrites: 0`，全部 `drawingCertificateStatus: "passed"`）。
- `npm test -- --testTimeout=30000`：**543 passed (543) | 5794 passed | 1 todo (5795)**（exit 0）。
- `npm run test:rust`：exit 0（Rust 全部核心/IPC/凭据/存储/shell_smoke 套件 **0 failed**，4 项手工/系统凭据库测试按设计保持 `ignored`）。
- `npx playwright test --workers=1 --retries=0`：**290/290 passed**（14.2m，0 failed，含 `drawing-reliability-lifecycle.spec.ts`、`drawing-reliability-render.spec.ts` 与全部已有 E2E 回归），`t16-solid-lifecycle.png` 与 `t16-bound-drag-lifecycle.png` 人工代理目视抽检（`agent_visual_review`）清晰无遮挡。

## 三、诚实边界（未完成项与保留事项）

- **DeepSeek 真实模型画图实测**：应用户要求本次暂留由用户后续亲自执行（且当前命令行沙盒无 `DEEPSEEK_API_KEY`、亦不绕过系统凭据管理器读取密钥）。
- **交互式桌面窗口 UIA 走查**：`no-bundle` 二进制已在同源码版本下编译通过且 Rust `shell_smoke`/`test:rust` 全部通过，但当前代理命令沙盒处于隔离窗口站（`ENUM_TOTAL=0`、`TOTAL_TOP_WINDOWS=0`），`mathcanvas-desktop.exe --exam-run` 无桌面消息泵超时，未完成真实桌面窗口下的 UIA 点击与实拍；该项不以浏览器 E2E 冒充。
