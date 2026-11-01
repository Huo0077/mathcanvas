# 2026-11-01 明确球体 / 棱柱 40 题离线验收

> 日期：2026-11-01
>
> 性质：**自编离线验收集，未经独立人工复核**。不是真实模型盲测，不代表真实 provider 成功率。
> 本轮不调用付费模型，不发布安装包。

## 1. 验收范围与固定方式

题单在运行前固定在 [`test-fixtures/explicit-solid-acceptance/cases.json`](../../test-fixtures/explicit-solid-acceptance/cases.json)，共 40 条：

| 类别 | 数量 | 允许终态 |
| --- | ---: | --- |
| 合法请求 | 16 | 出图（`plan`） |
| 缺少信息 | 8 | 6 条允许默认值、2 条必须澄清 |
| 矛盾 / 不支持 | 8 | 澄清（`clarification`） |
| 人为错误计划 | 8 | 拒绝（`rejected`） |

每条在 JSON 里预先写明了：用户要求、允许终态、必须满足的几何条件、是否允许默认值及应披露的文本、来源与复核状态。失败项不删除，始终保留在分母中。

独立判据只读最终候选文档的图元，自行计算：

- 球：球心与半径；
- 棱柱：底环各边长度、拉伸向量在**底面单位法向**上的投影（两底面垂直高），并同时报告侧棱长度；
- 实体数量：合法请求要求恰好一个实体，错误计划若被接受则记录实际实体数量。

产品自己的 `diagramVerification` 只作为附加检查，不作为唯一判据。

## 2. 首轮失败记录（保留）

首轮报告：`eval-results/explicit-solid-acceptance/offline-2026-11-01T13-37-49.487Z-22020/`

首轮结果：**37/40**。

| 类别 | 通过 / 总数 | 首轮读数 |
| --- | ---: | --- |
| 合法请求 | 15 / 16 | 1 条漏读明确条件 |
| 缺少信息 | 7 / 8 | 1 条把“只写字段名”当成未提供 |
| 矛盾 / 不支持 | 8 / 8 | — |
| 错误计划 | 7 / 8 | 1 条错误图被双侧接受 |
| 错误图被当作成功 | 1 | 优先修复项 |

失败项与根因：

| 题目 | 现象 | 分类 |
| --- | --- | --- |
| `legal-prism-generic-with-dimensions` | `画一个棱柱，底面边长 4，高 8` 仍用默认高 3，且没有题设核验 | 漏条件 / 核验遗漏 |
| `missing-prism-height-label` | `画一个斜棱柱，高` 用默认高 3 出图，而不是澄清 | 漏条件 / 默认值越权 |
| `wrong-extra-solid` | 正确的球 + 多余立方体同时通过 `compilePlan` 与 `DraftStore.stage` | 对象归属不清 / 错误图被接受 |

## 3. 修复差异

1. **泛称棱柱 + 显式尺寸也视为直接请求**
   `directlyRequestsPrism` 现在接受 `画一个棱柱，底面边长 4，高 8`；没有尺寸的裸 `画一个棱柱` 保持旧行为，避免把复杂点名题面强制成 `solid.create_prism`。

2. **写了字段名但没有值不再当成“未提供”**
   `resolveOccurrences` 遇到 `高`、`底面边长`、`半径` 后没有数值时返回 `invalid`，由规划器澄清；默认值只能落在真正 `absent` 的字段上。

3. **对象归属不清按最终实体数拦截**
   `verifyExplicitSolidRequest` 在最终图元里统计新增实体（球 / 棱柱 / 立方体 / 圆锥 / 圆柱 / 棱锥 / 多面体）；直接请求只允许一个实体，正确的球加多余立方体会被编译器和草稿层同时拒绝。

对应回归测试：

- `packages/agent-core/src/explicitSolidConditions.test.ts`：泛称棱柱 + 尺寸、只有字段名没有值；
- `packages/agent-core/src/explicitSolidCompile.test.ts`：正确球 + 多余立方体；
- `apps/web/src/agent/explicitSolidStage.test.ts`：草稿层同样拦截多余实体。

## 4. 最终逐题结果

最终报告：`eval-results/explicit-solid-acceptance/offline-2026-11-01T13-38-44.178Z-20120/`

最终汇总：

| 指标 | 结果 |
| --- | ---: |
| 合法请求正确出图率 | **16 / 16 = 100%** |
| 应澄清请求正确澄清率 | **8 / 8 = 100%** |
| 错误计划拦截率 | **8 / 8 = 100%** |
| 错误图被当作成功 | **0** |
| 未执行 | **0** |

| ID | 类别 | 用户输入 | 允许终态 | 实际终态 | 独立几何 | 结果 |
| --- | --- | --- | --- | --- | --- | --- |
| legal-sphere-center-radius | 合法 | 画一个球体，球心 (1,2,3)，半径 5 | plan | plan | passed | 通过 |
| legal-sphere-swapped | 合法 | 画一个球体，半径 4，球心 (2, -1, 3.5) | plan | plan | passed | 通过 |
| legal-sphere-chinese-punctuation | 合法 | 画一个球体，球心（−1，2.5，−3），半径 4。 | plan | plan | passed | 通过 |
| legal-sphere-origin | 合法 | 画一个球体，球心在原点，半径 6 | plan | plan | passed | 通过 |
| legal-sphere-radical | 合法 | 画一个球体，球心 (0,0,0)，半径 2√3 | plan | plan | passed | 通过 |
| legal-sphere-pi | 合法 | 画一个球体，球心 (0,0,1)，半径 2π | plan | plan | passed | 通过 |
| legal-prism-base-height | 合法 | 画一个斜棱柱，底面边长 4，高 8 | plan | plan | passed | 通过 |
| legal-prism-reversed | 合法 | 画一个斜棱柱，高 8，底面边长 4 | plan | plan | passed | 通过 |
| legal-prism-decimal | 合法 | 画一个直棱柱，底面边长 3.5，高度 6.5 | plan | plan | passed | 通过 |
| legal-prism-four | 合法 | 画一个斜四棱柱，底面边长 4，高 8 | plan | plan | passed | 通过 |
| legal-prism-tight | 合法 | 画一个斜棱柱，底面边长4，高8 | plan | plan | passed | 通过 |
| legal-prism-generic-with-dimensions | 合法 | 画一个棱柱，底面边长 4，高 8 | plan | plan | passed | 通过 |
| legal-sphere-ascii-tight | 合法 | 画一个球体,球心(1,2,3),半径5 | plan | plan | passed | 通过 |
| legal-sphere-negative-no-space | 合法 | 画一个球体，球心(-2,0.5,3.25)，半径4 | plan | plan | passed | 通过 |
| legal-prism-regular | 合法 | 画一个正棱柱，底面边长 4，高 8 | plan | plan | passed | 通过 |
| legal-prism-spaced | 合法 | 画一个斜棱柱，底面边长 4 ， 高 8 | plan | plan | passed | 通过 |
| missing-sphere-default-all | 缺信息 | 画一个球体 | plan | plan | passed | 通过 |
| missing-sphere-center-only | 缺信息 | 画一个球体，球心 (1,2,3) | plan | plan | passed | 通过 |
| missing-sphere-radius-only | 缺信息 | 画一个球体，半径 5 | plan | plan | passed | 通过 |
| missing-prism-default-all | 缺信息 | 画一个斜棱柱 | plan | plan | passed | 通过 |
| missing-prism-base-only | 缺信息 | 画一个斜棱柱，底面边长 4 | plan | plan | passed | 通过 |
| missing-prism-height-only | 缺信息 | 画一个斜棱柱，高 8 | plan | plan | passed | 通过 |
| missing-sphere-center-label | 缺信息 | 画一个球体，球心 | clarification | clarification | not_applicable | 通过 |
| missing-prism-height-label | 缺信息 | 画一个斜棱柱，高 | clarification | clarification | not_applicable | 通过 |
| invalid-center-conflict | 矛盾 | 画一个球体，球心 (1,2,3)，球心 (1,2,4)，半径 5 | clarification | clarification | not_applicable | 通过 |
| invalid-radius-conflict | 矛盾 | 画一个球体，半径 5，半径 6 | clarification | clarification | not_applicable | 通过 |
| invalid-prism-base-conflict | 矛盾 | 画一个斜棱柱，底面边长 4，底面边长 5，高 8 | clarification | clarification | not_applicable | 通过 |
| invalid-prism-height-conflict | 矛盾 | 画一个斜棱柱，底面边长 4，高 8，高 9 | clarification | clarification | not_applicable | 通过 |
| invalid-radius-zero | 不支持 | 画一个球体，半径 0 | clarification | clarification | not_applicable | 通过 |
| invalid-radius-fraction | 不支持 | 画一个球体，半径 1/2 | clarification | clarification | not_applicable | 通过 |
| invalid-height-scientific | 不支持 | 画一个斜棱柱，高 1e999 | clarification | clarification | not_applicable | 通过 |
| invalid-center-two-coords | 不支持 | 画一个球体，球心 (1,2)，半径 5 | clarification | clarification | not_applicable | 通过 |
| wrong-sphere-center | 错误计划 | 球心 (1,2,3)、半径 5，计划球心在原点 | rejected | rejected | not_applicable | 通过 |
| wrong-sphere-radius | 错误计划 | 半径 5，计划半径 2 | rejected | rejected | not_applicable | 通过 |
| wrong-prism-base | 错误计划 | 底边 4，计划底边 3 | rejected | rejected | not_applicable | 通过 |
| wrong-prism-height-side-edge | 错误计划 | 垂直高 8，计划侧棱 8、垂直高 4 | rejected | rejected | not_applicable | 通过 |
| wrong-missing-entity | 错误计划 | 要求球体，计划只建立方体 | rejected | rejected | not_applicable | 通过 |
| wrong-type | 错误计划 | 要求棱柱，计划建球体 | rejected | rejected | not_applicable | 通过 |
| wrong-multiple-spheres | 错误计划 | 要求一个球体，计划建两个 | rejected | rejected | not_applicable | 通过 |
| wrong-extra-solid | 错误计划 | 要求一个球体，计划建正确球 + 多余立方体 | rejected | rejected | not_applicable | 通过 |

拦截类没有最终候选，因此独立几何记为 `not_applicable`；它们的判据是编译器和草稿层都拒绝，且最终报告 `wrongFigureAccepted = 0`。

## 5. 浏览器代表案例

运行：`npx playwright test e2e/agent-local-dimensions.spec.ts --workers=1`

结果：**4 passed**。

| 案例 | 路径 | 判据 |
| --- | --- | --- |
| 球体显式球心 / 半径 | 输入 → 预览 → 确认 → 提交 | 从保存文档读球心 `(1,2,3)`、半径 `5` |
| 斜棱柱显式底边 / 高 | 输入 → 预览 → 确认 → 提交 | 底边 `4`、垂直高 `8`，侧棱长 `> 8` |
| 只给高的棱柱 | 输入 → 预览 → 确认 → 提交 | 默认底边 `4`、垂直高 `8` |
| `半径 1/2` 负例 | 输入 → 无确认面板 | 不生成草稿、不提交、画布无对象、撤销不可用 |

浏览器负例验证的是“无效输入无法提交错误草稿”；人为错误计划由 40 题单的编译器 / 草稿层用例覆盖。

## 6. 实际测试命令与结果

| 命令 | 结果 |
| --- | --- |
| `npm run eval:explicit-solid -- --offline`（首轮） | 1 test failed；37/40；错误图被接受 1 |
| `npm run eval:explicit-solid -- --offline`（修复后） | 2 tests passed；40/40；错误图被接受 0；incomplete 0 |
| `npx playwright test e2e/agent-local-dimensions.spec.ts --workers=1` | 4 passed |
| `npm run typecheck` | exit 0 |
| 改动文件 ESLint | 0 错误 |
| `npm test` | 498 文件 / 5301 通过 + 1 todo / 0 失败 |
| `npm run build` | 通过（Web + 桌面端） |
| `npm run eval:reliability -- --offline` | 29/29 passed、incomplete 0、costUsd null |

## 7. 尚未覆盖的边界

- 自编题未经独立人工复核；不能称为已独立认证的盲测。
- 本轮只跑确定性本地规划器，不调用付费模型；结果不代表真实模型成功率。
- 40 题中球体 / 棱柱都是简单实体；棱柱的自然语言入口仍只构造正方形底面，未覆盖任意多边形底面、斜置底面、非平行底面等更一般情形。
- 数值语法只覆盖十进制、负坐标、`√3`、`2√3`、`π`、`2π`；科学计数法与分数明确拒绝，不是支持。
- 浏览器只走 4 条代表案例，其余 36 条由离线 runner 覆盖；没有重跑全量 e2e。
- 未做真实 provider 30 题复跑、安装包发布或跨机器复验。
