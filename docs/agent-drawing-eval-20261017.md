# 2026-10-17 真实 provider 画图评测（12 道）

本文记录一次**小样本、非官方题集**的画图评测，用于回答“当前 agent 大概能画出多少”。它不是发布验收，也不能替代冻结题集与人工目视。

## 一、范围与题源

- **12 道题**：8 道立体几何 + 3 道三角/平面 + 1 道用户现场翻折题。
- 立体与三角题来自公开数据集 [HighMATH](https://github.com/tjunlp-lab/HighMATH) 的 `Solid_Geometry.jsonl` 与 `Trigonometric_Functions_and_Triangle_Solving.jsonl`；题面为 LaTeX，评测前做了本地归一化（去 `$`、`\triangle`、`\sqrt`，`棱雉→棱锥` 等）。
- 用户的翻折题：`AB=8, CD=3, AD=5√3, ∠ADC=90°, ∠BAD=30°`，`AE=2/5 AD`、`AF=1/2 AB`，沿 `EF` 折至 `PC=4√3`。
- **不是**考试院官方 PDF；题源与原文出处没有逐题 provenance，只能算“公开高中题集”样本。

## 二、模型与后端

配置里的 provider 是 `deepseek-chat`，但实际返回的 `model` 字段是 **`deepseek-flash`**；请求 `deepseek-reasoner` 也返回 `deepseek-flash`。同一个 key 的 `/v1/models` 可用列表只有：

- `deepseek-flash`
- `deepseek-v4-pro`

因此本轮做了 `deepseek-flash`（配置默认）与 `deepseek-v4-pro`（更强档）的 A/B。两者都用同一份生产策略文本，temperature 0。

## 三、测试口径（保真度边界）

- 走 `buildPolicyText` + `compilePlan` + 同一套救援链；每题从空文档开始，`diagramWitnessSearch: true`。
- 模型一次返回一个 JSON 计划；编译失败时按 `describeCompileRepairPrompt` 修 **1 次**（与产品的一次编译修复一致）。
- **没有**接协调器的原生工具循环、`scene.inspect` 与 UI 确认；所以读数更接近“模型能否给出可编译、可核验的计划”，不是完整 App 的成功率。
- `deepseek-v4-pro` 的 5 道失败全部是**格式失败**（不返回 JSON），不是几何失败；这些在真实产品里应由通道/格式修复处理，本轮没有把它算成“不会画”。

## 四、结果

归一化题面的 12 道：

| 模型 | 生成图（compile ok） | 题设全过 | 未完成核验 | 失败 | 耗时 |
|---|---:|---:|---:|---:|---:|
| `deepseek-flash`（配置默认） | 5 / 12 | **0** | 4 | 7 | 39 s |
| `deepseek-v4-pro` | **7 / 12** | **0** | 6 | 5 | 821 s |

补充：

- 原始 LaTeX（未归一化）时 flash 有 8 / 12 编译成功，但条件大多显示“未核验”——解析器读不出 LaTeX 条件。归一化后检查真的跑了，坐标错误才暴露出来。**真实考试 PDF 必须先过 LaTeX/OCR 归一化**。
- `deepseek-v4-pro` 修掉了 flash 的两条典型坐标错误：三棱锥 `P-ABC` 的 `PB=2, PC=√6`，以及四棱锥 `P-ABCD` 的 `∠PCA=45°`。
- 用户翻折题在其中一轮曾做到**八条题设全部 passed**，但那一轮编译因 `EF` 线段排在 `E/F` 之前而失败；新增“线段顺序自动后移”救援后，顺序问题已修，折角为 `0°` 的第二种缺陷仍会挡住（模型修复稿同时给了两个错）。

## 五、失败分类

| 类别 | 典型题 | 说明 |
|---|---|---|
| 坐标/度量算错 | solid-1、10、13 | 模型给的坐标不满足边长/垂直/角度 |
| 动作契约 | solid-9、32 | `host` 写成裸别名，传输层报 `unscoped_reference` |
| 模型不返回 JSON | v4-pro 的 5 道 | 推理模型带散文/思考；需要原生工具或格式修复 |
| 多缺陷计划 | 用户翻折题 | 顺序 + 0° 折角同时出现；一次修复预算不够逐个消 |
| 欠定/欠画 | trig-60 | 题面欠定，模型只给一个点 |
| 解析残留 | 各题的“未核验” | 向量、二面角、部分 LaTeX 条件未被可靠解析 |

> 2026-10-19 后续：`solid-1` 已由六棱四面体解析构造救援，真实 provider 复核 `verification=passed`；`solid-9` / `solid-32` 的裸别名已自动补 scope。

## 六、本轮由评测驱动的落地

- `planCompiler`：`segment_reference_missing` 时把出错线段自动后移到末尾再编（含剪角），回归在 `planCompiler.witnessFold.test.ts`。
- `planCompiler`：`unscoped_reference` 的修复提示明确给出 `{scope:"draft",alias:...}` / `{scope:"scene",ref:...}` 形状，回归在 `planCompiler.test.ts`。
- 评测同时确认：单面 `solid.create_polyhedron`、3D 文档里的 `planar.*` 提升、开放图形的提示与折角剪裁都在工作。

## 七、仍未解决

- **模型档位是主因之一**：flash 做多步解析几何与严格契约偏弱；v4-pro 更强但慢约 21 倍、且需要原生工具/格式修复通道。
- **多缺陷计划**：系统只有一次编译修复，各救援只消一类缺陷；需要计划清洗器/救援组合。
- **真实考试题入口**：LaTeX/OCR 归一化尚未进产品主路径。
- **旧图删除**：绑定点按既有语义降级为自由点（不是删除），`AF` 这类线段仍会挡住单张面删除；可用 `Ctrl+A` 全选后删除（本轮已接线）。
- **桌面端未重建**：本轮代码尚未进入已安装的桌面包。

## 八、门禁

- 全量单测：**422 文件 / 4791 通过 + 1 todo**。
- `npm run typecheck`：exit 0。
- `npm run lint`：**0 error / 15 warning**。

## 九、结论

按“图能不能生成”算，这 12 道约 **5–7 / 12**；按“题设全部核验通过”算，两个模型都是 **0 / 12**。图形原语与核验器已经够用，瓶颈在**模型给出的计划质量**（坐标、动作契约、一次多缺陷）与**题面进入解析器之前的归一化**。

## 十、2026-10-19 复跑（flash）

同一批 12 道、同一 harness，在 P1-1（六棱四面体构造）、P1-2（裸别名补 scope）、P1-3（结构清洗）、P5-1（LaTeX 归一化）之后复跑：

| 指标 | 复跑前 | 第一次 | 最佳（右三棱柱后） | 最近（二面角后） |
|---|---:|---:|---:|---:|
| 生成图 | 5 / 12 | 8 / 12 | **11 / 12** | 9 / 12 |
| 题设全过 | 0 / 12 | 1 / 12 | **4 / 12** | 4 / 12 |
| 未核验 | 4 | 6 | 5（另有 2 道无核验） | 4 |
| 失败 | 7 / 12 | 4 / 12 | **1 / 12** | 3 / 12 |

- 两次整批都通过 `solid-1`（六棱四面体）、`solid-10`（正方形底四棱锥）、`solid-13`（右三棱柱）、`user-quad-fold`（规范折片重建）。
- 最近一次（二面角救援后）：`trig-23` 从几何失败变为可画/未核验；但 `solid-9/20/32` 因模型输出不同失败，生成数从 11 掉到 9。
- 最新一次（规范折片 + 面环排序 + 梯形底棱柱救援）：**10/12 生成、4/12 全过、2/12 失败**（`solid-9/20` 这轮仍失败）；`user-quad-fold` 稳定通过。
- 未核验：`solid-3/9/20/24/32`、`trig-23/60/89`；读数来自 flash 单次运行，方差明显。全量门禁：429 文件 / 4800 通过 + 1 todo。

## 十一、稳定性复跑（4 道 × 3 次，flash）

| 题 | run 1 | run 2 | run 3 |
|---|---|---|---|
| solid-1 | passed | passed | passed |
| solid-10 | passed | passed | passed |
| solid-13 | passed | passed | passed |
| user-quad-fold | failed | unverified | unverified |

- 三个解析构造 **3/3 稳定**；`user-quad-fold` 原 **0/3**，加“共线面 + `hostEdge` 数组 + 重复顶点提示”后 2/3，再加 `rescueWithFoldConstruction`（平面见证 + 比例 + 折角反求）后 **3/3 passed**。
- 结论：坐标求解与折片重建已经稳定；剩余方差来自其他题的模型输出。
