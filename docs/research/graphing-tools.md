# GitHub 同类绘图项目调研

**调研日期：** 2026-09-13  
**用途：** 为 MathCanvas 的函数、动态点、轨迹、交点和属性栏设计提供可追溯的参考。  
**边界：** 只借鉴公开的产品行为和架构思想，不复制第三方源代码、资源或专有实现。

## 参考项目

| 项目 | GitHub | 许可证 | 本次关注点 |
| --- | --- | --- | --- |
| JSXGraph | [jsxgraph/jsxgraph](https://github.com/jsxgraph/jsxgraph) | README 标注 MIT/LGPL 双许可 | slider、glider、locus、统一动画对象 |
| GeoGebra | [geogebra/geogebra](https://github.com/geogebra/geogebra) | GPL-3.0 系列，复用前需单独评估 | 动点路径参数、动画方向、交点集合、轨迹测试 |
| function-plot | [mauriciopoppe/function-plot](https://github.com/mauriciopoppe/function-plot) | MIT | 表达式编译、采样、断点分段、参数曲线和注记 |
| Euclid.js | [mathigon/euclid.js](https://github.com/mathigon/euclid.js) | MIT | 不可变点、投影、旋转、范围过滤和点数组交点 |
| Boost.js | [mathigon/boost.js](https://github.com/mathigon/boost.js) | MIT | 基于 `requestAnimationFrame` 的可取消动画循环 |

许可证信息以各仓库当前 `LICENSE`、`README` 和发布版本为准。MathCanvas 不直接嵌入上述项目代码；如果未来引入依赖，必须在引入前重新核对版本、许可证和许可证兼容性。

## 关键观察

### JSXGraph：路径是动点和轨迹的共同基础

- slider 可以视为一条 baseline 加一个 glider，具有最小值、当前值、最大值和步进吸附。
- glider 以路径参数定位，路径变化后由依赖关系统一重算，而不是把当前屏幕坐标当作唯一真相。
- locus 绑定派生点，通过符号计算或采样生成轨迹。
- board 维护独立的 animation objects，动画状态不等同于一次次文档编辑。

MathCanvas 采用 `PointBinding`、`pathParameter`、`snapWidth` 和独立 `AnimationSession` 的组合，并将动点变化后的重算接入现有 DAG。

### GeoGebra：交互结果应是集合，动画应有明确生命周期

- `GeoPoint` 的路径变化和动画步进说明，动点需要保存“在哪条路径上”和“路径参数是多少”。
- 交点测试覆盖曲线交点、轨迹和特殊点，说明交点不应只保留一个无法解释来源的静态坐标。
- 播放、暂停、单次、往返和速度属于动画控制层；暂停或确认时才提交几何参数更适合撤销/重做。

MathCanvas 将交点表示为可追踪的派生集合，将播放、暂停、停止、循环和 `prefers-reduced-motion` 作为工作区控制能力。

### function-plot：函数图像是“编译—求值—渲染”流水线

- 先编译表达式，再在视口或定义域内求值，避免每次 SVG 重绘都重新解析字符串。
- 对无定义值、无穷值和不连续处分段，不把跨越渐近线的两点直接连成一条错误线段。
- `nSamples`、参数曲线、极坐标、隐式曲线、导数、割线和注记可以作为后续能力层次。

MathCanvas 第一阶段实现笛卡尔函数和常见函数预设，保留编译缓存与采样分段接口；参数、极坐标和隐式曲线作为后续扩展，不在本阶段混入几何编辑模型。

### Mathigon Euclid.js：几何内核与 UI 分离

- 点的旋转、投影、插值、距离等操作适合保持纯函数和不可变返回值。
- 线段、射线和圆弧的交点需要按自身范围过滤；无限直线的交点不能直接冒充线段交点。
- 交点 API 返回点数组，调用方再决定显示全部、选择第一个还是生成交点集合。

这与现有 `packages/geometry-kernel` 和 `packages/scene-graph` 分层一致；属性栏只编辑 DSL/Scene Graph 状态，不在组件内重复几何算法。

### Boost.js：动画不应污染撤销历史

`requestAnimationFrame` 回调提供 progress 和 delta time，并支持取消。MathCanvas 使用同样的生命周期思路：帧内只更新临时动画状态，停止或确认后一次性提交最终参数。

## P7 导出依赖决策

- `pdf-lib@1.17.1` 作为 PDF 向量输出依赖，许可证为 MIT；仅调用其文档、页面、标准 Helvetica 字体和矢量线/文字 API，不复制第三方源码。
- SVG、DXF、PDF 均消费 Web 层的 `ProjectedDrawing[]`，不访问 Three.js、不重新计算三维投影；无效点、棱和标注只输出诊断或状态文本，不生成伪造几何。
- DXF 输出为 ASCII `SECTION/ENTITIES`，使用稳定源 ID 生成图层名；PDF 按视图生成矢量页面，避免截图或栅格化。

## 三维几何参考（2026-09-14）

本轮针对 P6 通用化查看了以下公开 GitHub 项目的产品边界和实现分层：

| 项目 | GitHub | 许可证 | 本次关注点 |
| --- | --- | --- | --- |
| GeoGebra | [geogebra/geogebra](https://github.com/geogebra/geogebra) | GPL-3.0 系列 | 点、线、面对象关系、父子依赖、标签和动态重算 |
| Three.js | [mrdoob/three.js](https://github.com/mrdoob/three.js) | MIT | 场景图、材质、Raycaster、相机控制和渲染层边界 |
| JSXGraph | [jsxgraph/jsxgraph](https://github.com/jsxgraph/jsxgraph) | MIT/LGPL 双许可 | 父对象引用、约束组合和交互式几何构造 |
| CindyJS | [CindyJS/CindyJS](https://github.com/CindyJS/CindyJS) | MIT | 约束驱动几何、动态对象和教学演示反馈 |

### 采用的启发

- GeoGebra 的对象标签和父子关系支持 Algebra View 展开子部件，但 MathCanvas 只借鉴行为，不复制 GPL 代码。
- JSXGraph 和 CindyJS 说明点、线、面应通过来源引用和约束组合，而不是把最终屏幕坐标当作唯一真源。
- Three.js 适合管理渲染场景、隐藏线、透明材质、拾取和相机；数学对象、拓扑校验、截面和测量应留在 DSL、Scene Graph 和 geometry-kernel。
- 高中立体几何的主要交互难点是点线面归属、共面/非共面、遮挡、空间方向、截面边界和二面角补角。界面必须显示来源点、辅助线/面、法向量、精度和失败原因。

### 对 MathCanvas 的决策

1. 采用方案 C：基础对象以 `point3`、`line3`、`plane3`、`edge3` 和 `face3` 为核心，`polyhedron3` 由拓扑引用组合。
2. `cube`、`pyramid`、`cylinder` 和 `cone` 保留为 builder 快捷模板，并且必须生成可拆解、可编辑的点、棱和面。
3. Scene Graph 维护稳定 ID 和反向依赖，点移动触发线、面、实体、截面、展开和测量的局部重算。
4. 不直接引入上述项目的领域对象模型或源码；新增依赖前重新核对版本、许可证和兼容性。

详细三维设计见 [`docs/superpowers/specs/2026-09-14-point-driven-3d-geometry-design.md`](../superpowers/specs/2026-09-14-point-driven-3d-geometry-design.md)，实施切片见 [`docs/superpowers/plans/2026-09-14-point-driven-3d-geometry.md`](../superpowers/plans/2026-09-14-point-driven-3d-geometry.md)。

## 函数与二维能力决策

1. **统一路径绑定。** 自由点、路径点、特征点和轨迹点都通过明确的来源引用表达。
2. **表达式先编译。** 函数预设只提供合法 DSL 表达式，用户输入使用同一编译器和同一错误反馈。
3. **交点是派生对象。** 交点保存来源对象、解索引和可见性，来源移动后自动更新。
4. **连接保存引用。** A/B 点之间的线段、直线或射线保存点 ID，而不是只保存创建时的坐标。
5. **抛物线需要额外约束。** 两个点不能唯一确定抛物线；UI 必须继续要求顶点、轴向、焦参数或第三点。
6. **属性栏按图元特异化。** 通用样式收起到公共区，焦点、顶点、渐近线、斜率、定义域和采样等关键属性放入对应图元面板。
7. **动画与文档解耦。** 动画播放状态是临时 UI 会话，不逐帧写入 `.mgeo` 或 undo history。

## 不在本次直接复用的内容

- 不复制 GeoGebra、JSXGraph 或 function-plot 的实现代码。
- 不把第三方对象模型直接暴露为 MathCanvas DSL 类型。
- 不因调研结果引入 GPL 代码或未经审核的运行时依赖。
- 不在本轮同时承诺完整 CAS、隐式曲线求解、三维几何或任意用户脚本执行。
