# R00 同源环境与验证证据（2026-11-15）

## 结论

R00 已完成：在独立 worktree 中使用 Node 22.23.5 和 npm 11.16.0 执行真实锁文件安装，随后完成类型检查、文档检查和完整单元测试。活动工作区的 Node 26 与混合 pnpm/npm 安装没有被冒充为验收环境。

## 身份与可复算方式

- 产品代码基线：`59ea36133c47971f4252e71f7a0f5ba003dd1028`
- main 重启提交：`be033b71ba32f1b7008d030b49359e21de076423`
- 隔离环境提交：`be3f00bf6a7cf213b44de601419c58429b09b646`
- 隔离目录：`.worktrees/r00-node22`，detached HEAD
- 安装方式：`npx --yes --package=node@22 --package=npm@11.16.0 -- npm ci`
- 锁文件 SHA-256：见 [environment.json](environment.json)

## 实测结果

| 检查 | 结果 |
| --- | --- |
| `npm ci` | 退出 0；新增 273 个包；未使用 `--ignore-scripts` |
| `npm run typecheck` | 退出 0 |
| `npm run test:docs -- --testTimeout=30000` | 8 个文件、22 项通过、0 失败 |
| `npm test -- --testTimeout=30000` | 519 个文件、5535 项通过、1 todo、0 失败 |

完整单元测试耗时 417.91 秒。验证后隔离 worktree 没有受跟踪源码或锁文件差异，详见 [environment.json](environment.json)。

## 失败与边界

首次启动尝试因 host 全局 npm 路径不含 `node_modules/npm/bin/npm-cli.js` 而在安装前失败；改用显式 Node/npm npx 包后完成验证。首次失败没有被删除或改写为成功。

R00 不包含完整 Rust、Playwright、付费 provider、安装/冷机或发布验收。安装时重新报告 14 项开发依赖公告（11 moderate / 3 high），留给 R11 独立处理，不因本次测试通过而视为已解决。
