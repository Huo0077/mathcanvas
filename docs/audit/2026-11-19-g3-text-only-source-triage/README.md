# G3-F9 纯文字36题：来源第一轮筛查（2026-11-19）

## 来源与方法

旧冻结题库 [source](../../../test-fixtures/reliability/drawing-contracts-36.json)、新版[23+13规划清单](../../../test-fixtures/reliability/text-only-36-plan.json)均只读；本轮新增[来源筛查数据](../../../test-fixtures/reliability/text-only-36-source-triage.json)（无题面正文、无原卷文件）。8道高考线索最初来自 [GAOKAO-Bench 原始数据仓](https://github.com/OpenLMLab/GAOKAO-Bench/tree/6dbb24f8d8439041e5431c4c184a582182a6ce9c/Data) 固定修订的数学题 JSON，文件 SHA 与单题文本 SHA 均锁定，**但转录仅是线索，不等于原卷无图**。其中 GK-S11/GK-S12/GK-S13/GK-S14/GK-S16/GK-S17 后续已取得相应试题 PDF 并核验题号、题意和配图归属；GK-S10/GK-S15 是第三方**题页 JPEG 预览**，不是 PDF 原卷或独立审查。六道 PDF 初核题也未做独立第二审核与合同签收。5道联考线索来自第三方承载的试卷 PDF 真正字节，已核对文件头为 PDF、记录 SHA-256 并目视对应页；发布者并非命题方，题目来源仍需独立二次复核。临时原卷放系统临时目录，未进入仓库。

原23条的 prompt/来源/哈希与旧合同逐项机械对齐且文本中没有“如图/见图”等显式图示词；其中 GK-P02/GK-P03/GK-P05/GK-P08/GK-P09 已核对相符原卷页，另外16条仍仅有旧文字来源；GK-P07 原卷找到但冻结来源标注错配，GK-P04 只有页预览；**不能推导原始卷面无图或画面唯一**，全部标为 `needs_original_paper_review`。13槽位全部保持 pending；本筛查文件 `runnable=false`，不能喂给 DS 或计算新版成功率。

### 高考候选（8条：6 PDF 页初核、2 JPEG 题页预览；均未独立审核）

| 槽位 | 来源索引 | GAOKAO-Bench 源键 | 状态 |
| --- | --- | --- | --- |
| GK-S10 | 2014 （新课标ⅱ） #7 | Data/Objective_Questions/2010-2022_Math_II_MCQs.json#example[46] | 第三方 JPEG p2 预览初核题号与附图归属；原 PDF / 第二审核未有 |
| GK-S11 | 2016 （新课标ⅱ） #4 | Data/Objective_Questions/2010-2022_Math_II_MCQs.json#example[72] | 原卷 p1 初核无图；仍待独立审核/合同 |
| GK-S12 | 2018 （新课标ⅰ） #5 | Data/Objective_Questions/2010-2022_Math_II_MCQs.json#example[109] | 原卷 p2 初核无图；仍待独立审核/合同 |
| GK-S13 | 2022 （全国乙卷） #9 | Data/Objective_Questions/2010-2022_Math_I_MCQs.json#example[206] | 学生原卷 p2 初核无图；仍待独立审核/合同 |
| GK-S14 | 2018 （新课标ⅱ） #16 | Data/Subjective_Questions/2010-2022_Math_I_Fill-in-the-Blank.json#example[49] | 原卷 p3 初核无图；转录“圆雉”疑似 OCR 误字，待校正原文/合同 |
| GK-S15 | 2013 （新课标ⅰ） #15 | Data/Subjective_Questions/2010-2022_Math_II_Fill-in-the-Blank.json#example[12] | 第三方 JPEG p3 预览初核题号与附图归属；原 PDF / 第二审核未有 |
| GK-S16 | 2016 （新课标ⅲ） #10 | Data/Objective_Questions/2010-2022_Math_I_MCQs.json#example[80] | 试题 PDF p3 初核无图；转录“棱雉”需校正 |
| GK-S17 | 2020 （新课标Ⅱ） #10 | Data/Objective_Questions/2010-2022_Math_I_MCQs.json#example[180] | 原卷 p2 初核无图；待独立复核 |

**新增原卷页证据（2026-11-19）**：GK-S11 的[2016 年全国新课标卷 II 试卷 PDF](https://file.xdf.cn/uploads/160608/543_160608121058bHjwEnUk5DcQ21OX.pdf) 字节 SHA-256 `877b895c319357aae7fb1dcb5362b68f69053ac4c35598c98e0ed38a6729b5c7`，p1 第4题（体积为8的正方体与外接球）无附图；同页第7题**有图**，因此按题号归属判读。GK-S13 的[2022 全国乙卷理科学生卷 PDF](https://m.shsbnu.net/pluginfile.php/54461/mod_folder/content/0/2022%E5%B9%B4%E9%AB%98%E8%80%83%E7%9C%9F%E9%A2%98%E5%85%A8%E5%9B%BD%E4%B9%99%E5%8D%B7%E7%90%86%E7%A7%91%E6%95%B0%E5%AD%A6%E8%AF%95%E5%8D%B7-%E5%AD%A6%E7%94%9F%E7%94%A8%E5%8D%B7.pdf) 字节 SHA-256 `fb7509622fe55a681f6145067c0a91c6377aeb127f78cd3f60818c72551448dc`，p2 第9题（球心为锥顶点、四棱锥体积最大）无附图；同页前部有第6题流程图，不归属于第9题。两文件均检查了 `%PDF` 文件头且逐页渲染目视；第三方承载及数据集转录不替代命题方/人工复核，也不构成合同准入。此增量新用例按 RED→GREEN：GK-S11、GK-S13 各自先失败后补录；本地定向2文件/6用例通过；完成后全仓 `npm.cmd run typecheck` 通过，`npm.cmd run test:docs -- --maxWorkers=1` 8文件/22用例通过，旧合同+运行器+新清单定向4文件/71用例通过，`npm.cmd run lint` 0错误/34条既有警告，`git diff --check` 通过。

**2018 年原卷增量**：GK-S12 的 [全国 I 卷文科数学 PDF](https://www.gcyls.cn/file/upload/202403/08/185520771.pdf) SHA-256 `dcac3bb7e606f73710624313d119cce753e2d4eda25261dfd74e004b3f9ea36a`，p2 #5 圆柱轴截面题未附图，p2 #9 图属其他题；GK-S14 的[全国 II 卷理科数学 PDF](https://jhcee.cn/upload/file/20180806/1533545060595329.pdf) SHA-256 `18119a7a31e9db6ed0c7afd23137b5d49e99c29adc281d43d1c3209f49078586`，p3 #16 圆锥母线题无附图。数据集对后者有“圆雉”等转录错误，**不能把转录文本当最终原题输入**；先独立按原卷修正再计算新版 prompt hash，不回写旧版题集。这两题用例先 RED 后 GREEN；最终 `npm.cmd run typecheck` 通过，`npm.cmd run test:docs -- --maxWorkers=1` 8文件/22用例通过，定向4文件/71用例通过，`npm.cmd run lint` 0错误/34条既有警告，`git diff --check` 通过。

**2016/2020 原卷与旧23首题复核增量**：GK-S16 的[2016 全国 III 理科试题 PDF](https://dfiles.jiajiaoban.com/ohr/2019/08/20/164640_5d5bb370c2137.pdf) SHA-256 `72a58f7b2a7c4db04efa63737ab5948b6d3662682a39b08bf5a308f4016e525a`，PDF p3 #10 为直三棱柱与球，p3 #9 的统计直方图属另一题；数据集“棱雉”不能进入新 prompt。GK-S17 的[2020 全国 II 理科试卷 PDF](https://cdn.zizzs.com/zixunzhan/202310/2f7a402a-a096-4e6e-b162-11cbac3dec78.pdf) SHA-256 `53a3e8489a098c52727aa8427c53b8c63fd779ae9eb5257acdd94716253cea09`，p2 #10 等边三角形/球未附图，p2 #7 三视图属另一题。旧23中的 GK-P09 对照[2020 全国 I 理科原卷 PDF](https://cdn.zizzs.com/zixunzhan/202310/c15dec3e-666b-4c24-a7fb-7d66a2f1d1f1.pdf) SHA-256 `56877d60bea527f9025ffa697672f228414c9e2c39b534518109646c637c2ed4`，p2 #6 多项式切线题无附图，而 p2 #7 的曲线图属于下一题。三道均为**页级初核，不是第二审核通过或正式合同**。

**拒收错配来源**：曾下载两份标题类似的 PDF，但 2016 全国 III“试卷答案/详解”下载件 PDF p4 #10 是随机模拟题（SHA-256 `a726ea29a53116a1d1ddbcaba0defe847fe95431c0ed046b470b0e38026c2373`），2020 全国 I 另一下载件 p1 #6 是向量题（SHA-256 `2e57a1ae1f87fd18cbc4da2f5bb7f5ad08b64ef3d87d4d1abe273730feab04bd`）。它们都**不能**作为目标题 #10/#6 的原卷证据，已用 `paper_question_mismatch` 显式登记拒收。标题/年份匹配不是题目匹配。新增两道原卷和错配源分别测试先 RED 再 GREEN；最终 `npm.cmd run typecheck` 通过、`npm.cmd run test:docs -- --maxWorkers=1` 8文件/22用例通过、旧合同+旧运行器+新清单4文件/73用例通过、`npm.cmd run lint` 0错误/34条既有警告，`git diff --check` 通过。

**2026-11-19 公开页预览（不冒充 PDF）**：GK-S10 [2014 全国Ⅱ卷文科预览 p2](https://cdn.att.tthaoke.com/testpaper/preview/8/8b0d7586467107bcc47c3e8d0a1cb0e2/p002.jpg) JPEG SHA-256 `c55a6570ec1da8dcf1cf547b5560b73bba9ced867a9c68679a58fbc9f745cf86`，#7 正三棱柱体积题无随题附图；前一题 #6 的三视图及后题 #8 流程图不可错认。GK-S15 [2013 全国Ⅰ卷文科预览 p3](https://cdn.att.tthaoke.com/testpaper/preview/2/20fda96f61ae09480ea11dff410a071d/p003.jpg) JPEG SHA-256 `b4f7535e0d3d2e421c0c701c397b64b54314ddc2a50a61712d8e2229ccacf7af`，#15 球/截面题无随题附图；前一题的三视图不可错认。这是第三方网页展示的**图像预览字节**，既不是原始试卷 PDF 字节哈希，也不证明命题方原版页未被编辑。状态单列 `page_preview_checked_needs_pdf_and_independent_review`，不升级为 `pdf_page_checked_needs_independent_review`，仍需原 PDF 和独立合同。用例先 RED（预览状态与 SHA 缺失）再 GREEN；最终 `npm.cmd run typecheck` 通过，`npm.cmd run test:docs -- --maxWorkers=1` 8文件/22用例通过，来源准入+旧合同+旧运行器定向4文件/74用例通过，`npm.cmd run lint` 0错误/34条既有警告，`git diff --check` 通过。

**旧23题中的第二道原卷复核**：GK-P02（2022 全国乙卷理科第20题）与已经记录的 GK-S13 同卷，原卷 PDF 字节 SHA-256 `fb7509622fe55a681f6145067c0a91c6377aeb127f78cd3f60818c72551448dc`，p5 椭圆过 A(0,-2)、B(3/2,-1)，无附题图；仍未做独立第二审核/合同重新签收，旧版实测不因此加分。新增测试先 RED 后 GREEN；旧23页级核对现为2/23。最终 `npm.cmd run typecheck` 通过，`npm.cmd run test:docs -- --maxWorkers=1` 8文件/22用例通过，定向4文件/74用例通过，`npm.cmd run lint` 0错误/34条既有警告，`git diff --check` 通过。

**旧23题的第三道原卷复核**：GK-P05 使用[2021 全国甲卷理科试卷 PDF](https://imgs.app.gaokaozhitongche.com/resource/pdf/paper/202203/20220330210833_JN29ez.pdf) 字节 SHA-256 `3318ba55310181e2320c92b46b2997a2d57d1547d21dea278d3f068975ba494d`，p4 #20 为抛物线顶点在 O、焦点在 x 轴、直线 x=1 的题，**题目自身无附图**；同页 #19 有三棱柱图，不归属 #20。先 RED 后 GREEN，页级初核旧题现3/23；未做独立合同复核，不纳入新版成功率。最终 `npm.cmd run typecheck` 通过，文档测试8文件/22用例通过，定向回归4文件/74用例通过，lint为0错误/34条既有警告，`git diff --check` 通过。

**旧23题的2022全国甲卷理科两题增量**：[学生试卷 PDF](https://m.shsbnu.net/pluginfile.php/54461/mod_folder/content/0/2022%E5%B9%B4%E9%AB%98%E8%80%83%E7%9C%9F%E9%A2%98%E5%85%A8%E5%9B%BD%E7%94%B2%E5%8D%B7%E7%90%86%E7%A7%91%E6%95%B0%E5%AD%A6%E8%AF%95%E5%8D%B7-%E5%AD%A6%E7%94%9F%E7%94%A8%E5%8D%B7.pdf) 字节 SHA-256 `f8362915a798b85da50ece7be83783264ed3c4920328cb5b5911910475862625`；GK-P08 p5 #14 双曲线与圆相切题、GK-P03 p6 #20 抛物线焦点/直线题均自身无附图，p6 #18 的四棱锥图属于**其他题**。先 RED 后 GREEN，旧23原卷页级初核 **5/23**；未做第二审核/新合同，也不改变旧实测通过率。最终 `npm.cmd run typecheck` 通过、文档测试8文件/22用例通过、定向回归4文件/74用例通过、lint 0错误/34条既有警告，`git diff --check` 通过。

**GK-P07 原题出处错配（2026-11-19）**：旧冻结集的 `source` 写作“2021年新高考I卷 第21题”，而其抛物线 `x²=2py`、圆 `x²+(y+4)²=1` 及切线面积题对应[2021 全国乙卷理科数学 PDF](https://17094505.s21i.faiusr.com/61/ABUIABA9GAAgvrzahwYozMrcogY.pdf)，文件 SHA-256 `b634210a76e3fe59c084816466bfa2d134382b5c28d30e46dfa36a78b21e97c0`，p4 第21题无附图，同页前一题的立体图属于另一题。另行核验的新高考I卷第21题实际是不同题，故不是“同卷不同写法”。**不更改旧冻结 prompt/hash 或旧91次回执**；新集必须单独修正来源元数据并复核合同，否则 GK-P07 不得以旧 `approved` 标签通过新题集准入。清单状态 `pdf_page_checked_source_mismatch_requires_new_manifest`；新测试先 RED 后 GREEN。`npm.cmd run typecheck` 通过、`npm.cmd run test:docs -- --maxWorkers=1` 8文件/22用例通过、新旧来源+合同定向3文件/56用例通过、`npm.cmd run lint` 0错误/34条既有警告、`git diff --check` 通过。旧23为5道普通页级初核+1道发现来源错配，余17道仍待原卷。

**GK-P04 原卷预览初核（未达到 PDF 证据）**：[2022 全国甲卷文科数学预览 p4](https://cdn.att.tthaoke.com/testpaper/preview/5/5825718b11b37a5d43894e2e0651b42e/p004.jpg) JPEG SHA-256 `78abd05f2f737d146570ef29d64915c84285b8b41b722b7c0d9225603e64f04a`，p4 #20 的 `f(x)=x³-x, g(x)=x²+a` 与旧候选吻合、无随题附图；p4 #19 包装盒有图不属于 #20。**仅第三方页面预览，非可下载原卷 PDF 或独立合同**，故状态 `page_preview_checked_needs_pdf_and_independent_review`，不可写成第六道原卷 PDF 通过。测试先 RED 后 GREEN；`npm.cmd run typecheck` 通过、`npm.cmd run test:docs -- --maxWorkers=1` 8文件/22用例通过、定向3文件/57用例通过、`npm.cmd run lint` 0错误/34条既有警告、`git diff --check` 通过。旧23现在5题普通PDF页级初核、1题旧来源错配、1题仅预览，另16题待核对。

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

- GK-S10/GK-S15 只有第三方 JPEG 页预览、仍需对应可核验原 PDF；已初核 PDF 的6道需独立复核，逐题核对转录 OCR（例如“棱雉/圆雉”疑似识别差异）、卷别/答案和图片归属；发现出题有图即按同象限换题。
- 5道联考需第二审阅人核验原卷出处/无图/题意完整、重复、分支与必要图元；旧23仅 GK-P09 原卷页初核，其余22题同样逐卷复核。
- 13道均尚无独立合同/证书/人工可读画面；不能改变旧36合同1通过/26失败/9未测、全部原生确认交付未测的结论。没有新 DS 请求，预算未授权。
