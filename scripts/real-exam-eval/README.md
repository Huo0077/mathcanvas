# 真题评测工具（2026-11-05）

这是独立评测工具，不修改产品 Agent。默认拒绝实际模型调用；显式开启才会使用当前桌面凭据并产生费用。

## 已完成的样本

50 道公开高考客观题（2010–2022），30 道配图、20 道文字。来源固定版本、原始图像和参考答案保存在 `test-fixtures/real-exams-20261105`。不包含尚未核实来源的联考/模拟题，也不使用项目中自行编写的“真题风格”夹具。

## 复现

1. 在仓库根目录准备依赖，并打开配置好模型的 MathCanvas 桌面版。单独测试实例可设置 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9227`；只允许本机使用，结束后关闭该实例。不要读取或导出凭据。
2. 如需重新下载材料：`python scripts/real-exam-eval/collect.py`。已有 `sources.json` 时复用其中的固定提交和 SHA256，不跟随 main。
3. `node scripts/real-exam-eval/render.cjs` 生成题干+原图试题图片。LaTeX 以原始文本呈现，不是原卷扫描件。三个选项先于主图的条目已经显式校正，不能按图片数量推断排列。
4. 先运行不收费的评分器测试：`node --test scripts/real-exam-eval/score.test.cjs`。
5. PowerShell 中显式设置后运行：

```powershell
$env:MATHCANVAS_REAL_EXAM_LIVE='1'
$env:MATHCANVAS_REAL_EXAM_OUT='eval-results/real-exams-20261105/new-run'
npx vitest run --config scripts/real-exam-eval/vitest.config.mts
```

可选环境变量：
- `MATHCANVAS_REAL_EXAM_IDS`：逗号分隔的固定题号；默认全部50题。
- `MATHCANVAS_REAL_EXAM_CDP`：默认 `http://127.0.0.1:9227`。
- `MATHCANVAS_REAL_EXAM_MAX_REQUESTS`：默认450次原生调用上限；每请求90秒、每题180秒。

完成的输出目录拒绝覆盖。复跑前选择新目录。测试框架显示 passed 只表示评测安全断言通过，不代表 Agent 答对了题。

## 输出与统计

每题保存完整事件、识图结构、最终输出、失败原因、草稿以及模型请求/响应。图片不在请求日志重复保存 base64，可从题库恢复。日志不包含凭据，但可能包含公开题目全文，不应未经检查公开。

- `summary.json`：交付、严格选项匹配、识图解析等原始统计。
- `progress.json`：中间进度。
- `{id}.json` / `{id}-requests.json`：逐题证据。
- 正式基线118次调用；材料修正中间轮8次、最终轮12次；另有预检8次及能力探测4次，共150次原生模型调用。价格未核实，不估算金额。

原始首轮3道材料有错标；其图片保存在首轮目录的 `input-sheets` 下。只修正材料并单独复测这3题：中间轮中文图注编码错误为??（0/3正确），修正编码后最终轮3/3正确，两个材料版本及结果均保留，不选择更优结果；正式首轮不可覆盖。分析报告同时列出首轮、排除错标材料的47题、材料修正后的合并观察结果。

统计脚本：`python scripts/real-exam-eval/summarize.py`，只读取已完成结果、不再请求模型。实际报告见仓库 `docs/audit/2026-11-05-real-exam-agent-evaluation-report.md`。

## 范围限制

真实使用产品的图像读取器、ModelPlanner 和 AgentRuntime，经桌面原生 provider 调用当前模型。不是模拟服务，也不是直接让独立聊天模型答题。但不覆盖 AgentRunner 特殊前置路由、UI点击、画布渲染和拖动交互；答案选项匹配不等价于证明或图形正确。
