# MathCanvas

多模态数理与工程交互绘图引擎的 2D 交互工作台原型。

## 启动

```bash
npm install
npm run dev
```

打开 Vite 输出的本地地址即可使用工作台。

## 验证

```bash
npm test
npm run typecheck
npm run build
```

当前闭环支持：

- React + TypeScript + Vite 工作台与响应式布局
- Geometry DSL v0.1 和 `.mgeo` JSON 编解码
- 点、线、圆、圆弧数据类型与稳定对象 ID
- 直线、直线-圆、圆-圆交点派生对象
- 参数滑块 → Domain Operation → DAG 重算 → SVG 更新
- 依赖对象局部传播与约束 Patch 校验
- 平行、垂直、重合约束投影
- 圆、圆弧的画布创建与属性编辑
- 直线的画布创建与端点属性编辑
- 选择、删除和键盘交互
- Algebra View 的显示/隐藏
- 撤销/重做事务栈
- `.mgeo` 文件下载与加载接口

## 包结构

- `packages/dsl`：版本化 Geometry Document、验证与 `.mgeo` codec
- `packages/geometry-kernel`：确定性的直线、圆和交点计算
- `packages/scene-graph`：领域操作与派生对象重算
- `apps/web`：工作台 UI、SVG 画布和状态管理

## 当前状态

当前版本已完成基础 2D 几何编辑闭环，并通过单元测试、类型检查、生产构建和 Chromium 浏览器验收。

## 计划路线

1. 对象锁定、框选和多选操作。
2. 更多几何构造，以及 1000 个图元下的增量性能优化。
3. 多约束冲突检测与求解失败回滚。
