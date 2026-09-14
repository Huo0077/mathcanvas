# MathCanvas 项目进度

> 这份文件是项目的单一进度记录。每完成一个可验证的切片，就更新“已完成”和“下一步”，并附上验证证据。

**最后更新：** 2026-09-14
**当前阶段：** P1 数学内核、P2 交互和 P3 函数分析已完成，进入 P6
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
- [x] 线段 DSL、画布双击创建、独立渲染和端点属性编辑
- [x] 1000 个图元下的增量重算性能回归测试
- [x] 多约束迭代求解、冲突检测与失败事务回滚
- [x] 持久化对象分组、六向对齐和批量显隐/锁定编辑
- [x] 数值鲁棒性：尺度化容差、鲁棒交点分类与退化回滚
- [x] 近平行几何纳入 1000 图元增量重算性能回归
- [x] 约束图按受影响分量局部求解，避免无关线重复投影
- [x] 射线与折线 DSL、校验及基础几何度量
- [x] 射线/折线补丁边界校验与退化输入防护
- [x] 射线/折线与直线、圆的详细交点内核
- [x] 圆锥曲线采样与微积分数值 MVP 内核
- [x] 多组件约束局部求解性能基准

### 验证证据

- `npm test`：15 个测试文件、108 个测试通过
- `npm run typecheck`：4 个 workspace 通过
- `npm run build`：Web bundle 与 3 个核心 package 构建通过
- `npm run test:e2e`：5 个 Chromium 浏览器用例通过

## 环境状态

- [x] npm、TypeScript、Vite、Vitest 已配置
- [x] Playwright 浏览器测试环境已安装并验证
- [x] 浏览器插件连接曾因当前环境的 `process` 属性冲突失败；已改用项目内 Playwright Chromium 验收

## 当前进行中

### 阶段状态

- P0：已完成
- P1：主体已完成，包含数值鲁棒性、约束局部求解、射线/折线交点和圆锥/微积分数值内核
- P2：基础几何编辑已完成；射线/折线、圆锥曲线、函数采样和采样交点联合交互已接入

- [x] P1：表达式 AST 最小能力（数字、变量、加减乘除、括号）
- [x] 将表达式求值接入参数环境，为后续函数图像和导数做基础
- [x] P1：圆、圆弧和基础交点内核
- [x] P1：依赖 DAG 局部传播及约束 Patch 校验
- [x] P1：平行、垂直、重合约束投影求解
- [x] P2：圆、圆弧的基础交互创建和属性编辑
- [x] P2：直线的基础交互创建和端点属性编辑
- [x] P2：选择、删除和键盘交互
- [x] P2：对象锁定、框选和多选
- [x] P2：线段构造和直线/线段差异化渲染
- [x] P1：1000 个图元增量重算性能回归
- [x] P1：多约束冲突检测与求解失败回滚
- [x] P2：对象分组、对齐和批量属性编辑
- [x] P1：尺度化数值策略与显式交点结果分类
- [x] P1：近平行几何性能回归覆盖
- [x] P1：约束图分量局部求解与增量重算接入
- [x] P2：射线方向判断、折线长度与点到折线距离
- [x] P2：射线/折线专用 UI 回归测试与属性编辑完善
- [x] P2：圆锥曲线和函数采样工作区渲染与属性编辑
- [x] P2：圆锥曲线交点与函数/曲线联合交互
- [x] P1：射线/折线非法输入在 Scene Graph 边界拒绝
- [x] P1：射线/折线与直线、圆交点过滤与端点去重
- [x] P1：抛物线、椭圆、双曲线采样
- [x] P1：函数采样、数值导数与梯形积分
- [x] P1：多组件约束性能基准
- [x] P1：大规模多组件约束增量求解优化，覆盖 1000/5000/10000 条线
- [x] P2：工作区独立文档切换与状态往返保留
- [x] P2：SVG 与 CSV 导出
- [x] P2：约束可视化列表、满足状态与冲突恢复提示
- [x] P2：PNG 导出、导出错误反馈与本地草稿自动保存
- [x] P2：约束批量清理与数值误差诊断
- [x] P2：属性检查器整体 UI 优化，统一卡片层级、图元类型徽标、双列字段、响应式布局和可见焦点态
- [x] P2：中间画布横向填充工作区，函数编辑框的 Backspace/Delete 不再误删函数图元
- [x] P2：函数公式键盘支持光标插入、嵌套函数和带底数对数；画布支持坐标悬停与点击创建持久交点
- [x] P2：函数无定义区间与采样渐近线断线保护；画布支持动态视口中心、鼠标中键或 `Space + 左键` 平移
- [x] P3-1：表达式编译缓存与有细化上限的自适应函数采样接入绘图、属性值域、导出和采样交点
- [x] P3-2：一阶/二阶中心差分导数内核，覆盖非有限邻域
- [x] P3-3：基于自适应样本的零点、极值和拐点数值检测
- [x] P3-4：可持久化一阶/二阶导函数图元，保存来源引用并联动重算
- [x] P3-5：可持久化切线、法线和割线图元，保存来源引用并联动重算
- [x] P3-6：积分区域、零点/极值/拐点分析集合和结构化数值诊断
- [x] P3-7：微积分分析工具、属性状态、Algebra View 条目和画布标记集成
- [x] P3-8：P3 文档、完整测试、类型检查、构建和 E2E 验证
- [x] P6-1：3D 向量、平面、射线—平面求交和二面角基础几何内核
- [x] P6-2：3D DSL 类型、几何校验、`.mgeo` round-trip 和旧 2D 文档兼容
- [x] P6-3：参数化立方体 Three.js 场景、geometry3d 工作区入口和 WebGL 降级状态
- [x] P6-4：棱锥、圆柱和圆锥参数化 Three.js 模型与创建入口
- [x] P6-5：3D 相机旋转、平移、缩放、重置和空间拾取
- [x] P6-6：隐藏边、透明面、法向量和选中态显示
- [x] P6-7：剖切平面、截面计算和截面派生对象
- [x] P6-8：立方体展开/折叠布局与动画
- [x] P6-9：二面角测量显示

## 下一步

P6-9 已完成，下一步完善 geometry3d 工作区、Algebra View 和属性栏集成。

> 射线/折线、圆锥曲线和函数采样已接入工具栏、SVG 渲染、属性编辑和 UI 回归测试；选中两条可采样曲线即可创建持久化交点。

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

## 最新验证证据

- `npm.cmd test`：25 个测试文件、213 个测试通过
- P6-3 聚焦测试：`apps/web/src/threeScene.test.ts` 通过
- P6-3 全量测试：25 个测试文件、203 个测试通过
- `npm.cmd run typecheck`：4 个 workspace 通过
- P6-3 Web 构建：`vite build` 使用隔离 `outDir` 通过
- P6-3 浏览器验证：Playwright 被宿主环境的 Vite `.vite-temp` `EPERM` 阻断，未标记为通过
- P6-4 聚焦测试：`apps/web/src/threeScene.test.ts` 的 4 个用例通过
- P6-4 Web 构建：`vite build` 使用隔离 `outDir` 通过
- P6-4 浏览器验证：同一宿主环境阻断，未标记为通过
- P6-5 聚焦测试：`apps/web/src/threeScene.test.ts` 的 6 个用例通过
- P6-5 Web 构建：待完整验证后记录
- P6-5 浏览器验证：同一宿主环境阻断，未标记为通过
- P6-6 聚焦测试：`apps/web/src/threeScene.test.ts` 的 7 个用例通过
- P6-6 Web 构建：`vite build` 使用隔离 `outDir` 通过
- P6-6 浏览器验证：同一宿主环境阻断，未标记为通过
- P6-7 聚焦内核/DSL/Scene Graph 测试：48 个用例通过
- P6-7 Web 构建：待完整验证后记录
- P6-7 浏览器验证：同一宿主环境阻断，未标记为通过
- P6-8 聚焦测试：`apps/web/src/threeScene.test.ts` 的 8 个用例通过
- P6-8 Web 构建：待完整验证后记录
- P6-8 浏览器验证：同一宿主环境阻断，未标记为通过
- P6-9 聚焦内核测试：`packages/geometry-kernel/src/geometry3d.test.ts` 通过
- P6-9 Web 构建：`vite build` 使用隔离 `outDir` 通过
- P6-9 浏览器验证：同一宿主环境阻断，未标记为通过
- P6-8 Web 构建：`vite build` 使用隔离 `outDir` 通过
- P6-7 Web 构建：`vite build` 使用隔离 `outDir` 通过
- 默认 `npm.cmd run build`：当前沙箱因 Vite 写入 `.vite-temp`/`dist` 返回 `EPERM`；使用 `vite build apps/web --configLoader runner --outDir D:\\draw\\build-check\\mathcanvas-current` 完成等价 Web 构建验证
- `npm.cmd exec playwright test`：5 个 Chromium 浏览器用例通过
- `npm.cmd run lint`：未执行成功，仓库当前未安装 `eslint` 命令
- GitHub：P2 修复与 P3-1 之前的提交均已推送到 `origin/main`
