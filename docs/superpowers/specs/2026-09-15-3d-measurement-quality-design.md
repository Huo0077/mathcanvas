# 3D Measurement Visualization and Quality Baseline Design

> **状态（2026-09-17 复核）**：**已实现**——ESLint 基线与确定性门禁、撤销历史上限、纯函数化的测量可视化、3D 标注与上下文引导都已进入产品（对应计划 [`2026-09-15-3d-measurement-quality.md`](../plans/2026-09-15-3d-measurement-quality.md)）。当前门禁见 [`docs/project-progress.md`](../../project-progress.md)。

## Goal

完成当前 P6 v3 的三维教学测量可视化，同时修复上一轮审阅发现的质量门禁、Vite 启动和撤销历史风险。

## Context

项目已经具备 `Measurement3` 数据模型、长度/距离/角度/面积/体积/二面角计算、二面角辅助几何和属性栏入口。当前主要缺口是：测量结果不直接标注在 3D 画布上，二面角入口依赖用户先理解多选流程，默认构建和 Playwright 启动会被 Vite 配置临时文件写入权限阻断，仓库的 lint 脚本没有可执行的 ESLint 依赖，撤销历史没有容量上限。

同类项目调研参考：

- JSXGraph：强调可交互图板、触控事件和明确的图形标注。
- Geomtoy：强调几何对象关联、变换和视图层事件。
- math3d-react：强调浏览器内 3D 数学图形工作流。

## Scope

### 1. 3D measurement UX

- 复用现有 `Measurement3`、`measurementOptionsFor` 和 `resolveDihedralMarker3`，不新增 `schemaVersion`。
- 在三维选择两个相邻面时，明确显示二面角内角和外角两个操作入口；其他合法来源继续显示现有测量选项。
- 在 3D 画布中为有效测量显示稳定的数值标签和最小必要辅助几何：
  - 点/线来源：显示测量线段、端点或垂足提示。
  - 角度来源：显示顶点、两条臂和角弧。
  - 二面角来源：保留公共棱、角弧和外法向量，并显示实际测量值，而不是示例角度。
  - 面积/体积来源：显示结果标签和来源说明，不伪造不可计算的投影图形。
- 标签使用屏幕像素近似稳定的尺寸，随相机缩放更新；测量无效或来源不完整时不绘制虚假的几何标记。
- 选中测量或其任一来源时高亮对应标注；删除测量后画布标记立即消失。

### 2. Quality baseline

- 增加可执行的 ESLint 配置，覆盖 TypeScript、React Hooks 和 Vite React Refresh 规则；保持现有源码风格，避免在本轮引入大规模格式化。
- 将 Web build/preview 和 Playwright web server 调整为不依赖 Vite 默认配置临时打包路径的启动方式，并保留隔离输出目录能力。
- 为撤销历史增加固定上限，保留最新 100 个文档快照；重做队列仍遵循现有语义。
- 为历史上限、测量入口和画布标注补充回归测试。

## Non-goals

- 不实现 P7 三视图、轴测投影或 DXF 导出。
- 不新增任意对象变换系统、等长/等角求解或三维约束投影求解。
- 不拆分 `threeScene.tsx` 或 `operations.ts` 的全部职责；只提取本轮新增且可独立测试的辅助逻辑。
- 不改变 `.mgeo` 的 schema 版本和既有 2D 文档兼容性。

## Architecture

测量计算继续位于 `packages/geometry-kernel`，Scene Graph 继续负责派生测量更新和来源保护，Web 层只负责测量入口、选择态和可视化。新增画布标注应优先实现为纯函数，将 `GeometryDocument`、测量和空间点解析为 Three.js 对象描述，再由 `ThreeSceneView` 统一挂载和释放资源。

撤销历史限制放在 Web store 的快照写入边界，而不是修改 Scene Graph 操作语义。历史和重做都保存完整文档快照，以保证现有跨工作区和预览事务行为不变。

## Acceptance criteria

- 选择两个相邻面后，属性栏能直接提供二面角内角和外角入口。
- 创建有效二面角后，3D 画布显示公共棱、角弧、方向辅助和实际数值。
- 有效长度/距离/角度测量至少显示一组画布数值标注；无效测量不显示伪造标注。
- 删除测量、移动来源点或切换工作区后，画布标注与文档状态同步。
- `npm.cmd run lint` 可执行并无错误。
- `npm.cmd run typecheck`、`npm.cmd test -- --run`、隔离目录生产构建和 Playwright 全部通过；若宿主权限仍阻止默认 Vite 路径，项目脚本必须使用可复现的替代路径。
- 撤销历史最多保留 100 条，新增测试证明第 101 次变更会淘汰最旧快照而不破坏撤销/重做。

## Risks and mitigations

- Three.js 标注对象可能增加资源泄漏风险：所有新增几何、材质和辅助对象纳入现有 `disposeScene` 生命周期。
- 屏幕尺寸标签依赖相机距离和 viewport 高度：沿用现有点手柄缩放逻辑，并通过纯函数测试边界。
- ESLint 规则可能暴露历史问题：先采用可运行的最小规则集，逐步修复真实错误，不在本轮进行无关格式化。
- Vite CLI 参数在 npm workspace 中容易被 npm 吞掉：使用 workspace 脚本或 `npm exec --` 的明确参数边界，并通过实际 Playwright 启动验证。
