# 2026-11-01 棱柱形状语义与完整数值词法修复

> 日期：2026-11-01
>
> 基线：`6ee90a173ee02874108e9cf6222a56b7e7a0741d`
>
> 性质：**自编离线验收与外部复核反例修复**；未经独立人工复核，不是真实模型盲测，不代表真实 provider 成功率。

## 1. 外部复核问题

外部复核在 `6ee90a17` 上重现原 40 条全部通过，但另加 11 条检查中有 **8 条错误结果同时通过 `compilePlan` 与 `DraftStore.stage`**，且 `diagramVerification.status` 为 `passed`；另 3 条控制样例正常。

8 条问题分两类：

### A. 形状语义没有被读取或核验

| 输入 | 旧结果 | 期望 |
| --- | --- | --- |
| `画一个直棱柱，底面边长 4，高 8` | 正方形底面 + 斜向量 `(1,0.5,8)` | 侧棱垂直底面，垂直高 8 |
| `画一个正四棱柱，底面边长 4，高 8` | 同上，实际是斜棱柱 | 正方形底面、侧棱垂直 |
| `画一个三棱柱，底面边长 4，高 8` | 四边形底面 | 3 条边；不支持则澄清 |
| `画一个正六棱柱，底面边长 4，高 8` | 四边形底面斜棱柱 | 正六边形、垂直侧棱；不支持则澄清 |

根因：

- `localPlanner.ts` 的 `PRISM` 固定 `defaultPrismBasePolygon(span)` 和 `vector=(1,0.5,height)`；
- `explicitSolidConditions.ts` 只读底边与高，没有直 / 斜 / 正、底面边数；
- 题设义务只有 `solidDimension` / `solidCenter`，没有形状语义；
- 独立判据只查底边与垂直高，看不到“直变斜”“三变四”“正六变四”。

### B. 数值词法截取合法前缀

| 输入 | 旧结果 | 期望 |
| --- | --- | --- |
| `半径 1 / 2` | 截成 1 | 明确拒绝分数 |
| `半径 5×2` | 截成 5 | 明确拒绝乘法（除非实现为 10） |
| `半径 2 π` | 截成 2 | 2π，或明确澄清 |
| `球心 (1 2,3,4)` | 拼成 12 | 澄清非法坐标 |

根因：

- `scanNumericToken` 遇到空白或未支持运算符就停止；
- `parseDecimal` 删除全部空白，导致 `1 2` 拼成 `12`；
- 没有区分“字段结束”与“表达式尚未结束”。

## 2. 修复内容

### 2.1 共享形状条件

`explicitSolidConditions.ts` 的 `ExplicitPrismConditions` 新增：

```ts
shape: {
  sides?: number
  regular?: boolean
  straight?: boolean
}
```

读取规则：

- `直` / `正`：`straight: true`；
- `斜`：`straight: false`；
- `正N棱柱`：`sides: N`、`regular: true`；
- `三/四/五/六棱柱`：记录 `sides`；
- 裸 `棱柱`：不设限。

### 2.2 规划器

- `直棱柱` / `正四棱柱`：底面正方形，向量 `(0,0,h)`；
- `斜棱柱` / `斜四棱柱`：底面正方形，向量 `(1,0.5,h)`；
- `三棱柱` / `正六棱柱`：当前明确澄清，不生成四边形冒充；
- `正棱柱` 未写底面边数：按正四棱柱处理并写进 assumptions；
- `直棱柱` / 裸 `棱柱` 的底面边数、直斜缺省：写进 assumptions。

### 2.3 题设义务与最终几何核验

新增 `solidPrismShape` 义务，核验从最终 `polyhedron3` 量：

- 底面边数；
- 正多边形：各边相等 **且** 所有顶点到形心等距（排除菱形冒充）；
- 直 / 斜：侧棱是否平行底面法向（用实际底面的 Newell 法向，不假定 z 轴）；
- 底面边长、垂直高仍由 `solidDimension` 独立核验。

`planCompiler` 的 `solidDimensionGate` 同时接受 `solidPrismShape`；`DraftStore.stage` 通过同一 `verifyDiagramObligations` 重算，两侧结论一致。

### 2.4 完整数值词法

- `scanNumericToken` 吃到字段分隔符为止，空格、换行、全角空格和未支持运算符都进入 token；
- `parseNumericToken` 明确拒绝分数、科学计数法、乘法 / 幂、内部加减；
- `π` / `√` 允许系数与符号之间空白；
- `parseDecimal` 只 trim，不再删除数字内部空白；坐标分量内部空白直接拒绝。

## 3. 冻结验收

保留原 40 条输入作为回归集，并补充形状预期；新增 14 条外部复核：

- 8 条外部反例；
- 3 条控制样例；
- 3 条空白变体（全角空格分数、全角空格 π、全角空格坐标内部空白）。

合并为 **54 条**，由 `manifest.json` 同时加载。独立判据新增：

- 底面边数；
- 正多边形必要条件（等边 + 共圆）；
- 侧棱与底面法向关系（直 / 斜）；
- 错误图被接受数量统计覆盖**所有类别**，不只 `wrong_plan`。

## 4. 修复前后结果

| 指标 | 修复前 | 修复后 |
| --- | ---: | ---: |
| 原 40 条 | 40 / 40（旧判据） | **40 / 40（新判据）** |
| 外部 14 条（8 反例 + 3 控制 + 3 空白） | 8 条错误图被接受 | **14 / 14** |
| 错误图被当作成功 | 8 | **0** |
| 未执行 | 0 | **0** |

最终报告：

```text
eval-results/explicit-solid-acceptance/offline-2026-11-01T14-19-38.060Z-24812/
```

细分：

| 类别 | 结果 |
| --- | ---: |
| 合法 | 22 / 22 |
| 缺信息 | 10 / 10 |
| 无效 / 不支持 | 14 / 14 |
| 错误计划拦截 | 8 / 8 |
| 错误图被接受 | 0 |

## 5. 浏览器验收

`npx playwright test e2e/agent-local-dimensions.spec.ts --workers=1`：**6 passed**。

新增覆盖：

- 直棱柱提交后侧棱 `x/y` 位移为 0、`z=8`，侧棱长 = 垂直高 = 8；
- `半径 1 / 2` 触发澄清，无确认按钮、无草稿、画布无对象、撤销不可用。

## 6. 回归与门禁

| 命令 | 结果 |
| --- | --- |
| `npm run eval:explicit-solid -- --offline` | 54/54；错误图被接受 0；incomplete 0 |
| `npx playwright test e2e/agent-local-dimensions.spec.ts --workers=1` | 6 passed |
| `npm run typecheck` | exit 0 |
| 改动文件 ESLint | 0 错误 |
| `npm test` | 499 文件 / 5319 通过 + 1 todo / 0 失败 |
| `npm run build` | 通过（Web + 桌面端） |
| `npm run eval:reliability -- --offline` | 29/29，incomplete 0 |
| `npx vitest run scripts/docs-consistency` | 8 文件 / 20 项通过 |

## 7. 尚未覆盖的边界

- 三棱柱、五棱柱、正六棱柱的自然语言构造**当前明确澄清**，没有实现对应底面；
- 自然语言棱柱入口仍只构造正方形底面；任意多边形底面、斜置底面不在本轮范围；
- 乘法表达式 `5×2` 是明确拒绝，不是支持；
- 自编题未经独立人工复核；离线结果不是真实模型成功率；
- 未调用付费模型、未发布安装包、未重跑真实 provider 30 题。

## 8. 提交

本轮实现与报告提交 SHA 见提交记录；文档状态以 `git log` 与远端 `origin/main` 为准。
