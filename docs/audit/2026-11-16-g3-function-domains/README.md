# G3 / T01 函数表达式与公共切线参数域

- **日期**：2026-11-16
- **范围**：GK-P04 的 f/g 全局表达式与第 (2) 问参数域，GK-P09 的 f 全局表达式；T01/P0 未退出，未修改独立审核状态。
- **起点**：`3dd5aba7 test(eval): bind tangent endpoints and named touchpoints`。

## 1. 缺口与 RED

原有函数采样不能区分题面函数与只在若干采样点相同的近似函数；GK-P04 的 `expectedResult` 虽写 `a∈[-1,+∞)`，却没有相应的可执行参数域义务。

先在 `drawingContracts.test.ts` 增加 GK-P04 的全局函数、范围正反例及 GK-P09 微小偏移反例，再补冻结合同义务。实现前稳定复现 **2 failed / 37 passed**：GK-P04 仅返回既有 `ob-f-0` 失败，GK-P09 的 `ob-f-expression` 不在结果中。这证明新断言能捕获当时缺失的合同和求值分支，而不是实现后的自证。

保留的负例：

- `f=x^3-x+0.000000001` 不得满足 `f=x^3-x`；GK-P09 同理拒绝在四次函数上加微小常量。
- GK-P04 第 (2) 问 `g=x^2-2` 同时违反 `ob-g-domain` 与 `ob-common-tangent-range`。
- `f=x*x*x-x` 是允许的全局等价表达式，不要求字符串逐字相同。

## 2. 独立数学推导

设 `f(t)=t³-t`、`g(u)=u²+a`。

- f 在 t 处的切线斜率为 `3t²-1`，截距为 `-2t³`。
- g 在 u 处的切线斜率为 `2u`，截距为 `a-u²`。
- 公共切线要求 `u=(3t²-1)/2`，所以 `a(t)=(3t²-1)²/4-2t³`。
- `a'(t)=9t³-6t²-3t=3t(3t+1)(t-1)`。
- a(t) 在 `(-∞,-1/3)` 递减、`(-1/3,0)` 递增、`(0,1)` 递减、`(1,+∞)` 递增；两端均趋于正无穷。
- 全局最小值 `a(1)=-1`；另两个极值为 `a(-1/3)=5/27`、`a(0)=1/4`。

故范围为 **[-1,+∞)**。本区块的谓词先锁定题面指定的三次函数与 `x²+a` 形状，再按此推导检查参数下界；不把单个代表图或函数采样当作范围证明。合同 `minimumConstant` 必须保持推导所得 `-1`，不能靠改写合同阈值放行错误范围。参数结果的完整生产表达与统一聚合仍由后续区块验收。

## 3. 实现与 GREEN

- 复用并导出内核已有的 `polynomialOf`，从 `compileExpression` 的 AST 取得多项式系数；不支持的多项式以外表达式或解析失败均拒绝。
- `function-expression-2d` 逐项精确比较系数，不引入新的近似容差。
- `quadratic-with-constant-2d` 锁定 `x²+a` 结构并要求 `a>=minimumConstant`。
- `common-tangent-range-2d` 同时锁定 `x³-x`、`x²+a` 和经推导的范围下界。
- GK-P04 新增 `ob-f-expression`、`ob-g-domain`、`ob-common-tangent-range`；GK-P09 新增 `ob-f-expression`，均保留精确 `sourceSpan` 和 `pending_second_reviewer`。

验证结果：

- 定向合同测试：**39/39 passed**。
- 全量 Vitest：**540 files / 5735 passed + 1 todo / 0 failed**。
- 类型检查：通过（workspaces、e2e、scripts）。
- Lint：**0 errors / 33 pre-existing warnings**。
- Web build：**640 modules transformed**，成功。
- 合同与文档守卫：**9 files / 61 tests passed**。
- 未运行离线 reliability runner，不新增或虚构36题通过读数；普通工程测试不是 provider 数学结果。DeepSeek 既有最小真实证据仍为 1 planned / 2 clarification / 0 error，成本 not measured。

## 4. 未关闭项

- GKP07 最大面积、JT-P03 最小 |DE|、JT-P07 向量最小值、JT-S01 二面角最小值及指定球半径、JT-S04(2) 最小余弦、JT-S08 cosθ 范围。
- GK-S05/JT-S02 的完整棱向量关系、JT-P01/P04/P06 按 scope 的结构化不可行诊断。
- 其他折叠状态、显示策略/结果消费、生产完整证书与统一 runner、第二独立 reviewer 的后续全量复审。
- T15/T16 的同候选真实渲染、人工可读性签收和实际 Windows 桌面生命周期。

本区块不将 suite/case 自签为 `approved`，不宣称平面或立体18/18，不进入 P8、合并 main 或正式发布。
