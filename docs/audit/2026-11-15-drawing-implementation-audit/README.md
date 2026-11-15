# 2026-11-15 实施方案深化审计

代码基线：59ea36133c47971f4252e71f7a0f5ba003dd1028。范围：只读源码、8个直接调用原解析器的探针、官方参考核对、文档深化。**没有修改产品逻辑、没有模型请求、没有构建/36题全量复测，没有功能修复通过声明。**

主交付：[详细实施手册](../../superpowers/plans/2026-11-15-drawing-reliability-execution-handbook.md)。阶段计划和设计继续保留，实时功能状态只看[当前状态](../../current-status.md)。

## 证据目录

- [read-only-probes.json](read-only-probes.json)：原解析器的8个输入及legacy/IR/lengthChains结果。
- [source-map.json](source-map.json)：25个现有源码位置、符号和完整文件hash；定位基于59ea3613。
- [case-task-map.json](case-task-map.json)：36题到18个实施工作包的调查映射，不是根因全部确认或已实施。
- [reference-checks.json](reference-checks.json)：7份官方资料的URL、HTTP状态、标题、核对时刻；未安装新依赖。
- [oracle-check-scope.txt](oracle-check-scope.txt)：旧局部oracle的一处名称/实际断言不一致片段，用于审核覆盖范围。

## 探针如何运行

本机保存脚本：eval-results/drawing-plan-audit-20261115/probe.mjs；在仓库根以node执行。脚本用已有esbuild将obligationIR.ts和lengthEquality.ts做内存转译，直接调用纯解析函数，保存JSON；未启动UI、未调用provider、未写主场景。运行退出0。

8个输入：裸比例DE=2EA；链式角等式；带两问的scope案例；原题GK-S06/GK-P01/GK-P08/JT-P02/JT-P06。不是“8题作图通过测试”，而是诊断探针；发现当前缺口是正常输出，不代表功能修复完成。

| 观察 | 当前结果 | 方案中的修正 |
| --- | --- | --- |
| 裸比例 | splitPoint:true | T03拆比例与位置；独立非共线反例 |
| 角链/GK-S06 | 残留∠ADB= | T03类型化关系链 |
| 分问 | legacy.parts有2问，IR无parts | T02无损scope迁移；生产目前仍保有legacy，不断言全部信息已丢 |
| GK-P01 | 符号标准式未识别，后备原点提示 | T04参数AST和标准式语义 |
| GK-P08 | 圆已识别；未消费文本里的圆式变为空格 | T05原文诊断；T04/T07补双曲线/相切 |
| JT-P02 | 动点x=-1未解析 | T08宿主与轨迹依赖 |
| JT-P06 | 符号式/小问未核验 | T02/T04/T06/T07组合修复 |

## 关键勘误：GK-P08不是公式丢失

旧初步设计曾把诊断中的空白视为“公式遗漏/规范化链缺口”。深入代码后可确认：diagramObligations.ts:2309把已被matcher消费的字符替成空格，用于残留扫描；同一结果已经包含圆心(0,2)、半径1的圆义务。实际缺口是符号双曲线/相切关系，以及把内部残留串当用户原句展示。

因此保留原题/旧JSON不变，只更正文档推断。下一步不能“补回不存在的丢失公式”，应该给诊断保留原文并区分已识别/未识别区间。

## 局部oracle还需要审查“名称是否真的被检查”

现场audit-geometry.mjs:565–575中，JT-P08一项名称含EC=2CF，但实际谓词仅onEll(E) && onEll(F)，未计算EC/CF。原片段保存于oracle-check-scope.txt；这是对局部覆盖局限的进一步证据，不代表已经改写旧oracle成绩，也不代表产品宿主错误放行。

T01/T13必须检查每个断言的真实谓词、源条件和反例。仅改显示名可纠正误导，却不能补足数学验收；需要另加EC/CF的独立断言和破坏该比例的负例。旧报告继续原样保留。

## 数学方向核对（设计参考，不是产品已实现）

- DE=2EA不推出共线：A=(0,0)、E=(1,0)、D=(1,2)。
- GK-P01：a=2、e=√2/2 → c=√2、b=√2，需要再补题目其余对象和条件。
- GK-P08：圆心(0,2)、r=1；双曲线渐近线x±my=0，到圆心距离2m/√(1+m²)=1，m>0得m=1/√3。
- 统计公式仅在独立同分布近似前提下使用；开发回归不能当独立抽样代表总体。

本轮文档测试和链接/定位自检的最终读数见[verification.json](verification.json)；详细功能红绿测试、真实provider/桌面验收仍待实施。
