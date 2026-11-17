# G3 36题浏览器渲染证据与回归收口

记录日期：2026-11-17（执行主机日期；用户时区 America/Los_Angeles 为2026-11-16）。代码基线：当前功能分支在 00d8a1fd 之后的未提交渲染修正；生成报告的 revision 字段为 local-working-tree，提交后以 Git 实际提交号与此区块比对。

## 本区块能证明什么

- 冻结36题：同一候选的数学证书、真实浏览器预览 DOM/Three.js 对象、文档哈希、渲染证据、对象与标签、无错误级视觉诊断；单worker、零重试，**36/36自动化渲染测试通过**。分族：平面16、立体15、折叠3、函数2，总数36。
- 代码修正：2D图元/点名布局和视口自动适应；3D按实际WebGL场景对象投影，修复球体无点手柄时对象索引缺失，使其不再被错判 empty_canvas 并错误拒绝确认。对象/标签源于实际渲染而非模型自述。渲染层修正未改动数学坐标。
- 全量浏览器回归首轮 **321/327**，复现6项：3条旧“3D不可测/partial”测试与新真实投影合同冲突，2条球体确认被 empty_canvas 拒绝，一条棱柱拖动测试命中点手柄。新增先失败再通过的球体对象索引单测；更新旧E2E为正向检查真实对象盒及哈希；棱柱测试改瞄实体面内而非点手柄。最终在相同代码上串行 **327/327**（含36题）、零重试，失败历史保留在ignored测试日志与trace。
- 定向：三维内容同步14/14、三维证据E2E 7/7、球体 E2E 13/13；全量Vitest **544文件 / 5799 passed + 1 todo / 0 failed**；类型检查、文档22项、Lint 0 error（仍有34个历史未用警告，包含隔离worktree重复扫描）。测试日志位于 ignored eval-results/g3-render-36/。

## 不能据此声称什么

**自动化通过不等于教师/用户可读性签收，也不等于G3-UX全部关闭**。[manifest.json](manifest.json) 中 `humanReviewed.status=pending`，AI审阅只能记录建议。25/36题仍有视觉警告，共27次 clipped_object、26次 tiny_object（同一题可多次）；长直线/曲线越过视窗与小特征需要人工判断是否影响题意。自动测试允许warning，只拒绝 error、缺必要标签、空对象/错候选等；不得把36/36写成“没有任何视觉问题”。

目前没有独立可操控的Windows桌面窗口UIA签收记录；前轮 desktop no-bundle / Rust测试不能替代真实本机用户操作。保存的DeepSeek真实模型测试按用户可选授权保留，本区块没有调用模型，36题走已有离线/本地可重放路径。P8、盲测、安装/冷启动和正式产品发布仍属独立门槛。

## 审阅包

- [网页逐题索引](index.html)（浏览器打开）；[逐题机器清单](manifest.json)含hash、对象、标签、警告和截图路径。
- [平面联系表](contacts/plane.png)、[立体联系表](contacts/solid.png)、[折叠联系表](contacts/fold.png)、[函数联系表](contacts/function.png)。联系表仅便于快速检索，教师/用户应在各题原尺寸截图上签收或标记需重画。
- 每题 cases/<ID>.png + cases/<ID>.json；截图SHA-256存清单，所有36份已逐项比对。前一版人工/AI审阅信息未被当成新运行的签收：新manifest只记录这轮截图的AI审阅，且明确 pending human。

### 需要人工复核的25题（只记录，不放宽判据）

| 题号 | 视觉诊断 |
| --- | --- |
| GK-P01 | clipped_object |
| GK-P02 | tiny_object |
| GK-P03 | clipped_object、clipped_object、clipped_object |
| GK-P04 | clipped_object、clipped_object |
| GK-P05 | clipped_object、clipped_object、tiny_object、clipped_object |
| GK-P06 | clipped_object、clipped_object、clipped_object |
| GK-P07 | clipped_object、clipped_object、clipped_object |
| GK-P09 | clipped_object、clipped_object |
| GK-S01 | tiny_object |
| GK-S04 | tiny_object |
| GK-S05 | tiny_object、tiny_object |
| GK-S07 | tiny_object、tiny_object |
| GK-S08 | tiny_object |
| GK-S09 | tiny_object、tiny_object |
| JT-P01 | tiny_object |
| JT-P02 | tiny_object、clipped_object、clipped_object |
| JT-P03 | clipped_object、tiny_object、tiny_object、clipped_object |
| JT-P04 | clipped_object、clipped_object、clipped_object |
| JT-P05 | clipped_object、clipped_object、clipped_object |
| JT-P07 | tiny_object、tiny_object |
| JT-S03 | tiny_object |
| JT-S04 | tiny_object |
| JT-S07 | tiny_object |
| JT-S08 | tiny_object、tiny_object |
| JT-S09 | tiny_object、tiny_object、tiny_object、tiny_object |

## 人工签收表（待用户或教师填写）

完整36题逐行签收和Windows桌面窗口验收表在[人工审阅清单](review-checklist.md)，本页下方仅为示例，不代替逐题签收。

| 题号 | 必需对象/点名可读 | 曲线/虚实线/相机/遮挡 | 是否允许当前warning | 审核人/日期/意见 |
| --- | --- | --- | --- | --- |
| GK-P01 | 待验 | 待验 | 待验 | — |
| GK-S03 | 待验 | 待验 | 待验 | — |
| JT-P03 | 待验 | 待验 | 待验 | — |
| 其余33题（逐题见manifest） | 待验 | 待验 | 待验 | — |

这张表是审阅提示而非签名；正式签收应逐题记录，并避免把AI抽检当作humanReviewed。若发现警告影响作图表达，先修对应渲染/布局并重新跑36题及全套浏览器回归，不能改成无警告后再宣称本批通过。
