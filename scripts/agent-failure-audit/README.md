# 历史失败的当前源码离线诊断

仓库根目录运行：

~~~powershell
npx vitest run --config scripts/agent-failure-audit/vitest.config.mts
~~~

不调用模型、不读凭证、不启动浏览器、不写用户文档。默认测试不包含.probe.mjs，需显式使用本配置。

**这是行为记录，不是产品成功率测试**，部分断言期望观察到当前缺陷。包含假planner错误/空答注入、分式分组、题族路由、两个独立数学反例和历史24道折叠夹具复核。

可选读取本地被忽略的eval-results/real-exams-20261105/baseline/*-requests.json，仅重放schema，不执行计划。日志缺失输出missing，不得声称历史回放完成。只输出字段名、错误路径与短结果，不复制原始调用日志。

结果写到docs/audit/artifacts/2026-11-08-agent-failures/current-probe.json；重跑会更新，应先备份要保留的快照。修复后增加产品回归、更新现状断言，新证据写新日期目录。

调查：docs/audit/2026-11-08-agent-failure-root-cause-analysis.md。
计划：docs/superpowers/plans/2026-11-08-agent-reliability-remediation.md。
