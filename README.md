# MathCanvas

MathCanvas 是一个面向数学与工程场景的 2D 交互绘图工作台原型，采用 React、TypeScript 和 Vite 构建。项目将 Geometry DSL、数值几何内核、Scene Graph 与 SVG 工作台分层，便于多人协作和逐步扩展。

## 快速开始

```bash
npm install
npm run dev
```

启动后打开 Vite 输出的本地地址即可使用工作台。

## 验证命令

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
```

当前基线：14 个测试文件、106 个测试通过；4 个 workspace 类型检查通过；生产构建和 4 个 Chromium E2E 用例通过。

## 当前能力

### P0：技术验证

- npm workspaces monorepo：`apps/web`、`packages/dsl`、`packages/geometry-kernel`、`packages/scene-graph`
- Geometry DSL v0.1、稳定对象 ID、revision 和 `.mgeo` JSON 编解码
- React/Vite 工作台、Algebra View、SVG 画布、撤销/重做
- 点、直线、线段、圆、圆弧的创建、选择、编辑、删除和锁定
- 框选、Shift 多选、对象分组、对齐和批量显隐/锁定
- Playwright Chromium 浏览器验收
- 独立工作区文档切换与往返保留
- `.mgeo`、SVG 和 CSV 导出
- 约束列表、满足状态、删除入口和冲突恢复提示

### P1：数学内核

- 表达式 AST、参数环境和依赖 DAG 链式重算
- 平行、垂直、重合约束投影、冲突检测和失败回滚
- 尺度化容差、鲁棒谓词、退化输入检测和显式交点结果
- 直线、直线-圆、圆-圆交点分类：`none`、`point`、`tangent`、`points`、`coincident`、`degenerate`
- 射线/折线与直线、圆的交点过滤和端点去重
- 抛物线、椭圆、双曲线采样
- 函数采样、数值导数和梯形积分 API
- 1000 图元增量重算及多组件约束性能基准

### P2：交互状态

- 点、直线、线段、圆、圆弧的基础交互闭环已完成
- 射线/折线已接入基础工具栏、创建流程和 SVG 渲染
- 射线/折线、圆锥曲线和函数图像已接入工具栏、SVG 渲染、属性编辑和采样交点

## 包结构

- `packages/dsl`：版本化 Geometry Document、图元类型、校验和 `.mgeo` codec
- `packages/geometry-kernel`：数值策略、交点、约束、射线/折线、圆锥和微积分计算
- `packages/scene-graph`：Domain Operation、Patch 校验、依赖传播和事务回滚
- `apps/web`：工作台 UI、SVG 画布、交互状态和文件导入导出

## 协作约定

- 每个可验证切片都要同步更新 `docs/project-progress.md`。
- 提交前运行测试、类型检查、构建和相关 E2E 验证。
- 数学内核、Scene Graph 和 UI 变更应保持边界清晰，避免直接修改 Agent、Provider 或题图解析代码。
- 推荐通过功能分支和 Pull Request 协作；当前公开仓库为 [Huo0077/mathcanvas](https://github.com/Huo0077/mathcanvas)。

## 下一步

1. 为工作区和导出补充更多格式与错误反馈。
2. 增加项目级本地草稿自动保存。
3. 增加约束批量编辑与更细的求解诊断。
