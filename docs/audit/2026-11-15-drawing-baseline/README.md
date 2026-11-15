# 59ea3613 画图基线：36 题证据与逐题分诊

整理日期：2026-11-15；产品 revision：59ea36133c47971f4252e71f7a0f5ba003dd1028；v4.3.0。

这是对上一轮保存结果的**离线整理**，本轮没有新模型调用、没有重新评测功能。实时进度见[当前状态](../../current-status.md)；整改依据见[设计](../../superpowers/specs/2026-11-15-drawing-reliability-design.md)与[实施计划](../../superpowers/plans/2026-11-15-drawing-reliability-repair-plan.md)。

## 1. 结果与口径

| 项目 | 全部36题 | 平面18题 | 立体18题 |
| --- | --- | --- | --- |
| 有草稿 | 25/36，69.4% | 17/18 | 8/18 |
| 旧宿主 passed | 4/36，11.1% | 1/18 | 3/18 |
| 旧版 awaiting_confirmation | 4/36，11.1% | 1/18 | 3/18 |
| 完整题设证书 | 不存在（null / not_available_in_revision） | 不可用 | 不可用 |

- 完成36/36，35题native、1题local（GK-S01）；模型标识 deepseek-v4-flash。
- 32题失败：compiling 11、validating 21，无基础设施错误。
- 正式请求101；实际输入token 1,830,647，输出94,966；sceneWrites=0。中断时额外一次请求不属于这101次正式样本，不合并为单题重试成绩。
- 独立局部oracle exact 8/36：GK-S01、GK-S05、GK-S06、JT-S06、JT-S08、JT-P02、JT-P04、JT-P05。**只说明覆盖到的条件通过，不是完整题设正确率**。
- 四个待确认：GK-S01、GK-S05、JT-S06、JT-P09。前三个局部exact，JT-P09仅drawn，无独立正确性断言。
- 34/36 通用acceptance列表为空，但仍走专用diagram题设核验。不能描述成“34题完全没有验收”。
- 报告中的 verified/verifiedPreview 是旧逻辑的字段，不是新设计中“完整正确”或“端到端通过”的同义词。

## 2. 证据文件与完整性

以下是从 ignored eval-results 目录固化的可提交最小证据。只读原件，不手工修分数；发现报告错误应新增勘误，不覆盖旧报告。

| 文件 | 字节 | SHA-256 |
| --- | --- | --- |
| [manifest.json](manifest.json) | 21832 | 908c2f7a8bfdab0b108861fa562e92400910fb4d1f9829c34be2e950dc58bb6f |
| [baseline-report.json](baseline-report.json) | 25298 | faa4bdc0161ef70ae4d1a72a5498e38d2c9ee9259a79946b55394548d85dcaec |
| [partial-oracle-audit.json](partial-oracle-audit.json) | 18279 | c0a0e65461be7603f6aeb8f4b3a2abd4efe31040e74201d7a92479625d2ddfc5 |
| [case-triage.json](case-triage.json) | 41071 | 812da9899838e4ece327879c0ee4846eee350b68bea74fb9ec3534ba2c34a642 |

- manifest.json：36道题原题文/来源与hash；题文是本次评测输入，不代表已有人审核完整黄金合同。
- baseline-report.json：原 final-report.json 的字节副本，含旧宿主、工程基准及完整证书不可用说明。
- partial-oracle-audit.json：现场 results/oracle-audit.json 的字节副本，包含独立局部断言结果及限制；不是同目录其他历史/中间audit文件。
- case-triage.json：从各题原始结果提取的症状、诊断码与拟调查阶段；rootCauseStatus 均表示“观察症状，尚未全部证实根因”。诊断次数含重试，不能当作不同失败题的计数。

原始现场目录（本机存在但被Git忽略）：eval-results/real-exam-drawing-59ea3613-20261115/；工程日志：eval-results/rebuild-59ea3613-20261115/。文件名关联可在case-triage.json的rawResult查找。本次未复制请求trace、密钥、完整私有上下文。上表hash用于字节一致性检查，不是对数学正确性背书。

## 3. 36题分诊表

“阶段”只是后续调查入口，不意味着已经确认根因，也不意味着该阶段修完就整题通过。局部结论保留原始oracle词汇；exact≠完整正确、drawn≠数学正确。

| 题号 | 草稿 | 阶段/终态 | 旧宿主 | 局部oracle | 拟调查阶段 |
| --- | --- | --- | --- | --- | --- |
| GK-S01 | 有草稿 | 待确认 | passed | exact | P2/P6 |
| GK-S02 | 有草稿 | validating | unverified | missing_vertices | P2/P4 |
| GK-S03 | 无草稿 | compiling | — | no_drawing | P4 |
| GK-S04 | 无草稿 | compiling | — | no_drawing | P4 |
| GK-S05 | 有草稿 | 待确认 | passed | exact | P4/P6 |
| GK-S06 | 有草稿 | validating | unverified | exact | P2 |
| GK-S07 | 无草稿 | compiling | — | no_drawing | P4 |
| GK-S08 | 无草稿 | compiling | — | no_drawing | P4 |
| GK-S09 | 有草稿 | validating | unverified | drawn | P2/P4/P6 |
| JT-S01 | 无草稿 | compiling | — | no_drawing | P4 |
| JT-S02 | 无草稿 | compiling | — | no_drawing | P2/P4 |
| JT-S03 | 无草稿 | compiling | — | no_drawing | P2/P4 |
| JT-S04 | 无草稿 | compiling | — | no_drawing | P4 |
| JT-S05 | 无草稿 | compiling | — | no_drawing | P2/P4 |
| JT-S06 | 有草稿 | 待确认 | passed | exact | P4/P6 |
| JT-S07 | 无草稿 | compiling | — | no_drawing | P2/P4 |
| JT-S08 | 有草稿 | validating | unverified | exact | P2/P6 |
| JT-S09 | 有草稿 | validating | unverified | drawn | P4/P6 |
| GK-P01 | 有草稿 | validating | unverified | partial | P2/P3 |
| GK-P02 | 有草稿 | validating | unverified | partial | P2/P3 |
| GK-P03 | 有草稿 | validating | unverified | partial | P2/P3 |
| GK-P04 | 有草稿 | validating | unverified | partial | P2/P3 |
| GK-P05 | 无草稿 | compiling | — | no_drawing | P3 |
| GK-P06 | 有草稿 | validating | unverified | partial | P2/P3 |
| GK-P07 | 有草稿 | validating | unverified | partial | P2/P3 |
| GK-P08 | 有草稿 | validating | unverified | partial | P2/P3 |
| GK-P09 | 有草稿 | validating | unverified | drawn | P2/P3 |
| JT-P01 | 有草稿 | validating | unverified | partial | P1/P2/P3 |
| JT-P02 | 有草稿 | validating | unverified | exact | P2/P3 |
| JT-P03 | 有草稿 | validating | unverified | partial | P1/P3 |
| JT-P04 | 有草稿 | validating | unverified | exact | P2/P3 |
| JT-P05 | 有草稿 | validating | unverified | exact | P2/P3 |
| JT-P06 | 有草稿 | validating | unverified | incorrect | P2/P3 |
| JT-P07 | 有草稿 | validating | unverified | incorrect | P2/P3 |
| JT-P08 | 有草稿 | validating | unverified | partial | P2/P3 |
| JT-P09 | 有草稿 | 待确认 | passed | drawn | P3/P6 |

## 4. 高优先级复现入口

1. GK-S03：面不共面/自交/共享边方向/连通/体积等compile诊断，3次compile失败、5次native请求、零图元。先定位拓扑与构造，不拿增加重试当修复。
2. GK-S06：链式角等式被截成不完整关系；局部exact不足以证明全部条件正确。
3. GK-P01：题面明确椭圆标准式，却被说未指定原点；同时也缺第二问对象。解析与构造两个问题不可合并成“只改解析就成功”。
4. GK-P08：原题公式完整。深化审计确认圆心(0,2)、半径1已被解析，“圆[空白]”由残留扫描遮蔽已消费公式造成；不是原式丢失。应修符号双曲线/相切关系及诊断展示。见[实现审计勘误](../2026-11-15-drawing-implementation-audit/README.md)。
5. GK-P09 / JT-P02：LaTeX幂式、选择项和动点直线的语法/作用域缺口。
6. JT-P03 / JT-P07：多曲线绑定失败；JT-P06缺焦点并混用小问；JT-S08小问范围问题。
7. JT-P01：next_actions出现模型推导语句，是来源混杂的调查线索，尚不是已确认根因或已证明安全漏洞。

## 5. 工程基准与评测限制

上一轮工程验证：桌面no-bundle构建退出0，二进制apps/desktop/src-tauri/target/release/mathcanvas-desktop.exe，SHA-256：18cbe9c17e04515694976e7d4b79da8a5e05d7f6c7151cb520a9d471f1c95b04。完整安装包/冷机验收不可由此推得。

Vitest最终5,535通过、0失败、1todo（519文件，单项超时30秒）；首轮5,533通过/2文档超时，单独重跑5/5后全量复测。Rust280通过、0失败、4ignored。完整浏览器E2E未运行。以上来自保存报告/日志，**不是本轮重跑**。

评测输入仅题文、无原卷配图；隔离核心+桌面native请求，不是UI确认/实际渲染或证明评分；每题一次正式运行，不能推断统计泛化。主场景写入0是隔离安全证据，不是交互成功证据。模型成本reservedUpperUsd为预留上界，不是结算账单。

旧工作区与本基线的路由/证书门禁不同，不据两份比例宣称能力提升或下降。真实完整正确率目前不可得；后续必须先补完整合同、覆盖与独立验收。

## 6. 本轮文档核验

[文档与保存证据检查记录](documentation-verification.json)只记录本轮文档测试和一致性自检，不是产品功能复测。
