# G3-F9 纯文字36题：来源第一轮筛查（2026-11-19）

## 来源与方法

旧冻结题库 [source](../../../test-fixtures/reliability/drawing-contracts-36.json)、新版[23+13规划清单](../../../test-fixtures/reliability/text-only-36-plan.json)均只读；本轮新增[来源筛查数据](../../../test-fixtures/reliability/text-only-36-source-triage.json)（无题面正文、无原卷文件）。8道高考线索最初来自 [GAOKAO-Bench 原始数据仓](https://github.com/OpenLMLab/GAOKAO-Bench/tree/6dbb24f8d8439041e5431c4c184a582182a6ce9c/Data) 固定修订的数学题 JSON，文件 SHA 与单题文本 SHA 均锁定，**但转录仅是线索，不等于原卷无图**。其中 GK-S11/GK-S12/GK-S13/GK-S14 后续已取得相应原卷 PDF 并核验题号、题意和配图归属；其余4道仍仅有转录线索。四道已初核题也未做独立第二审核与合同签收。5道联考线索来自第三方承载的试卷 PDF 真正字节，已核对文件头为 PDF、记录 SHA-256 并目视对应页；发布者并非命题方，题目来源仍需独立二次复核。临时原卷放系统临时目录，未进入仓库。

原23条的 prompt/来源/哈希与旧合同逐项机械对齐且文本中没有“如图/见图”等显式图示词；**不能推导原始卷面无图或画面唯一**，全部标为 `needs_original_paper_review`。13槽位全部保持 pending；本筛查文件 `runnable=false`，不能喂给 DS 或计算新版成功率。

### 高考候选（8条：4原卷页初核、4仅转录）

| 槽位 | 来源索引 | GAOKAO-Bench 源键 | 状态 |
| --- | --- | --- | --- |
| GK-S10 | 2014 （新课标ⅱ） #7 | Data/Objective_Questions/2010-2022_Math_II_MCQs.json#example[46] | transcript only; original page + OCR pending |
| GK-S11 | 2016 （新课标ⅱ） #4 | Data/Objective_Questions/2010-2022_Math_II_MCQs.json#example[72] | 原卷 p1 初核无图；仍待独立审核/合同 |
| GK-S12 | 2018 （新课标ⅰ） #5 | Data/Objective_Questions/2010-2022_Math_II_MCQs.json#example[109] | 原卷 p2 初核无图；仍待独立审核/合同 |
| GK-S13 | 2022 （全国乙卷） #9 | Data/Objective_Questions/2010-2022_Math_I_MCQs.json#example[206] | 学生原卷 p2 初核无图；仍待独立审核/合同 |
| GK-S14 | 2018 （新课标ⅱ） #16 | Data/Subjective_Questions/2010-2022_Math_I_Fill-in-the-Blank.json#example[49] | 原卷 p3 初核无图；转录“圆雉”疑似 OCR 误字，待校正原文/合同 |
| GK-S15 | 2013 （新课标ⅰ） #15 | Data/Subjective_Questions/2010-2022_Math_II_Fill-in-the-Blank.json#example[12] | transcript only; original page + OCR pending |
| GK-S16 | 2016 （新课标ⅲ） #10 | Data/Objective_Questions/2010-2022_Math_I_MCQs.json#example[80] | transcript only; original page + OCR pending |
| GK-S17 | 2020 （新课标Ⅱ） #10 | Data/Objective_Questions/2010-2022_Math_I_MCQs.json#example[180] | transcript only; original page + OCR pending |

**新增原卷页证据（2026-11-19）**：GK-S11 的[2016 年全国新课标卷 II 试卷 PDF](https://file.xdf.cn/uploads/160608/543_160608121058bHjwEnUk5DcQ21OX.pdf) 字节 SHA-256 `877b895c319357aae7fb1dcb5362b68f69053ac4c35598c98e0ed38a6729b5c7`，p1 第4题（体积为8的正方体与外接球）无附图；同页第7题**有图**，因此按题号归属判读。GK-S13 的[2022 全国乙卷理科学生卷 PDF](https://m.shsbnu.net/pluginfile.php/54461/mod_folder/content/0/2022%E5%B9%B4%E9%AB%98%E8%80%83%E7%9C%9F%E9%A2%98%E5%85%A8%E5%9B%BD%E4%B9%99%E5%8D%B7%E7%90%86%E7%A7%91%E6%95%B0%E5%AD%A6%E8%AF%95%E5%8D%B7-%E5%AD%A6%E7%94%9F%E7%94%A8%E5%8D%B7.pdf) 字节 SHA-256 `fb7509622fe55a681f6145067c0a91c6377aeb127f78cd3f60818c72551448dc`，p2 第9题（球心为锥顶点、四棱锥体积最大）无附图；同页前部有第6题流程图，不归属于第9题。两文件均检查了 `%PDF` 文件头且逐页渲染目视；第三方承载及数据集转录不替代命题方/人工复核，也不构成合同准入。此增量新用例按 RED→GREEN：GK-S11、GK-S13 各自先失败后补录；本地定向2文件/6用例通过；完成后全仓 `npm.cmd run typecheck` 通过，`npm.cmd run test:docs -- --maxWorkers=1` 8文件/22用例通过，旧合同+运行器+新清单定向4文件/71用例通过，`npm.cmd run lint` 0错误/34条既有警告，`git diff --check` 通过。

**2018 年原卷增量**：GK-S12 的 [全国 I 卷文科数学 PDF](https://www.gcyls.cn/file/upload/202403/08/185520771.pdf) SHA-256 `dcac3bb7e606f73710624313d119cce753e2d4eda25261dfd74e004b3f9ea36a`，p2 #5 圆柱轴截面题未附图，p2 #9 图属其他题；GK-S14 的[全国 II 卷理科数学 PDF](https://jhcee.cn/upload/file/20180806/1533545060595329.pdf) SHA-256 `18119a7a31e9db6ed0c7afd23137b5d49e99c29adc281d43d1c3209f49078586`，p3 #16 圆锥母线题无附图。数据集对后者有“圆雉”等转录错误，**不能把转录文本当最终原题输入**；先独立按原卷修正再计算新版 prompt hash，不回写旧版题集。这两题用例先 RED 后 GREEN；最终 `npm.cmd run typecheck` 通过，`npm.cmd run test:docs -- --maxWorkers=1` 8文件/22用例通过，定向4文件/71用例通过，`npm.cmd run lint` 0错误/34条既有警告，`git diff --check` 通过。

### 联考候选（5条，页面已初核，无独立签收）

| 槽位 | 题号 | 来源原卷键 | 状态 |
| --- | ---: | --- | --- |
| JT-S10 | #11 | 2023-Hubei-September-Grade3#Q11 | PDF p2 visually checked; second review pending |
| JT-S11 | #16 | 2023-Hubei-September-Grade3#Q16 | PDF p2 visually checked; second review pending |
| JT-S12 | #15 | 2024-T8-December#Q15 | PDF p3 visually checked; second review pending |
| JT-S13 | #7 | 2025-Jiangxi-Shangjin-Autumn-Grade3#Q7 | PDF p1 visually checked; second review pending |
| JT-S14 | #14 | 2025-Hengshui-August-Grade3#Q14 | PDF p2 visually checked; second review pending |

**直接否决反例**：同一份 2025 江西上进联考 PDF 的 #Q11 题干不含“如图”，但原卷该题旁有立体几何示意图；已作为 `embedded_figure_without_textual_cue` 记录在排除清单。只按题干关键词/旧 `inputMode=text_only` 放行会误收，应在原卷页逐题目视并核对相邻图示归属。另有下载地址返回 HTML 或 404，已拒绝将其字节 SHA 当成 PDF 哈希。

**非付费验证**：新来源清单用例先因文件缺失失败，填入数据后通过；上述有图反例另写 RED（缺排除记录）→ GREEN；本轮 `npm.cmd run typecheck` 通过；`npm.cmd run test:docs -- --maxWorkers=1` 初次因上一提交中 `textOnly36Plan.test.ts` UTF-8 BOM 失败，已按字节去 BOM 后重新验证 8 文件/22 用例通过；新清单+旧合同+旧 runner 定向 4 文件/70 用例通过。`npm.cmd run lint` 0 errors / 34 existing warnings；`git diff --check` 通过。

## 未达关口

- 剩余4道高考候选需对应原卷页目视；已初核的4道需独立复核，逐题核对转录 OCR（例如“棱雉/圆雉”疑似识别差异）、卷别/答案和图片归属；发现出题有图即按同象限换题。
- 5道联考需第二审阅人核验原卷出处/无图/题意完整、重复、分支与必要图元；旧23同样逐卷复核。
- 13道均尚无独立合同/证书/人工可读画面；不能改变旧36合同1通过/26失败/9未测、全部原生确认交付未测的结论。没有新 DS 请求，预算未授权。
