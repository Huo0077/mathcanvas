# MathCanvas 项目进度

> 这份文件是项目的单一进度记录。每完成一个可验证的切片，就更新“已完成”和“下一步”，并附上验证证据。

**最后更新：** 2026-09-12  
**当前阶段：** P1 数学内核  
**总体状态：** 开发中

## 已完成

### P0 技术验证

- [x] 建立 npm workspaces monorepo：`apps/web`、`packages/dsl`、`packages/geometry-kernel`、`packages/scene-graph`
- [x] 初始化 React + TypeScript + Vite 工作台
- [x] 建立 Geometry DSL v0.1、`schemaVersion`、revision 和稳定对象 ID
- [x] 实现 `.mgeo` JSON 保存/恢复 codec 与可见文件打开入口
- [x] 实现点、线、圆的数据类型；完成两条直线和交点 SVG 渲染
- [x] 实现参数滑块 → Domain Operation → DAG 派生重算 → 交点更新
- [x] 实现 Algebra View、显示/隐藏、撤销/重做
- [x] 实现 Domain Patch 校验：重复 ID、缺失引用、非法参数和不存在对象拦截
- [x] “添加点”通过 Domain Operation 提交，并同步到 Algebra View 与画布
- [x] 建立 React Testing Library UI smoke tests
- [x] 配置 Playwright Chromium 与可回收的本地 preview 测试服务器
- [x] 通过浏览器 smoke test 验证工作台加载、滑块更新和添加点
- [x] 实现表达式 AST：数字、变量、括号、加减乘除和确定性求值
- [x] 将表达式接入 `ParameterSpec`，支持参数引用和链式重算
- [x] 循环引用、未知变量和非法表达式失败回滚

### 验证证据

- `npm test`：7 个测试文件、13 个测试通过
- `npm run typecheck`：4 个 workspace 通过
- `npm run build`：Web bundle 与 3 个核心 package 构建通过
- `npm run test:e2e`：1 个 Chromium 浏览器用例通过

## 环境状态

- [x] npm、TypeScript、Vite、Vitest 已配置
- [x] Playwright 浏览器测试环境已安装并验证
- [x] 浏览器插件连接曾因当前环境的 `process` 属性冲突失败；已改用项目内 Playwright Chromium 验收

## 当前进行中

- [x] P1：表达式 AST 最小能力（数字、变量、加减乘除、括号）
- [x] 将表达式求值接入参数环境，为后续函数图像和导数做基础

## 下一步

1. 扩展点/线/圆的依赖 DAG 增量重算和非法约束回滚。
2. 增加 Playwright 对 `.mgeo` 打开/恢复的文件流测试。
3. 接入圆、圆弧和交点等更多几何内核运算。

## 进度更新规则

- 每次完成一个独立可验证切片后更新本文件。
- 未运行验证命令的内容不得标记为完成。
- 浏览器级验证、单元测试、类型检查和构建分别记录，不互相替代。

## GitHub 协作

- [x] 创建公开仓库 `Huo0077/mathcnavas`
- [x] 配置远程地址并合并仓库初始提交
- [x] 推送 `main` 分支（commit `38da732`）
- [x] 通过 `git ls-remote --heads origin main` 验证远程分支

下一步：邀请协作者并按功能切分分支，通过 Pull Request 合并变更。
