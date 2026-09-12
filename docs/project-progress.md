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
- [x] 点、线、圆及圆弧图元支持；新增直线-圆和圆-圆交点计算
- [x] 依赖关系传播与局部派生对象重算
- [x] 约束目标校验、引用保护和非法 Patch 回滚
- [x] 平行、垂直、重合约束的确定性几何投影
- [x] 圆、圆弧的画布多点击创建和属性编辑
- [x] 直线的画布双点击创建和端点属性编辑
- [x] 选择工具、对象删除和 Delete/Backspace 键盘交互
- [x] 删除引用对象时的依赖保护和 Patch 错误反馈
- [x] 对象锁定、框选和 Shift 多选操作
- [x] Playwright `.mgeo` 文件选择与恢复流程

### 验证证据

- `npm test`：8 个测试文件、32 个测试通过
- `npm run typecheck`：4 个 workspace 通过
- `npm run build`：Web bundle 与 3 个核心 package 构建通过
- `npm run test:e2e`：2 个 Chromium 浏览器用例通过

## 环境状态

- [x] npm、TypeScript、Vite、Vitest 已配置
- [x] Playwright 浏览器测试环境已安装并验证
- [x] 浏览器插件连接曾因当前环境的 `process` 属性冲突失败；已改用项目内 Playwright Chromium 验收

## 当前进行中

- [x] P1：表达式 AST 最小能力（数字、变量、加减乘除、括号）
- [x] 将表达式求值接入参数环境，为后续函数图像和导数做基础
- [x] P1：圆、圆弧和基础交点内核
- [x] P1：依赖 DAG 局部传播及约束 Patch 校验
- [x] P1：平行、垂直、重合约束投影求解
- [x] P2：圆、圆弧的基础交互创建和属性编辑
- [x] P2：直线的基础交互创建和端点属性编辑
- [x] P2：选择、删除和键盘交互
- [x] P2：对象锁定、框选和多选

## 下一步

1. 扩展更多几何构造，并继续完善 1000 个图元下的增量性能。
2. 增加多约束冲突检测与求解失败回滚。
3. 增加对象分组、对齐和批量属性编辑。

## 进度更新规则

- 每次完成一个独立可验证切片后更新本文件。
- 未运行验证命令的内容不得标记为完成。
- 浏览器级验证、单元测试、类型检查和构建分别记录，不互相替代。

## GitHub 协作

- [x] 创建公开仓库 `niujin66/mathcanvas`
- [x] 配置远程地址并同步远程 `main` 分支
- [x] 本地 `main` 已设置跟踪 `origin/main`
- [x] 通过远程分支检查确认 `origin/main` 可访问

下一步：邀请协作者并按功能切分分支，通过 Pull Request 合并变更。
