# 参与贡献 MathCanvas

欢迎每一位数学教师、学生与开发者参与共建 **MathCanvas**！无论是提交一道难以画出的数学题、优化 2D/3D 交互体验、还是改进几何求解内核与 Rust 多端宿主壳，我们都非常期待你的贡献。

## 快速搭建开发环境

- **Node.js**：推荐 `v22+`（npm workspaces 单仓多包）
- **Rust**（仅开发桌面端 / Android 原生壳时需要）：`1.77.2+`

```bash
# 1. 安装全部工作区依赖
npm install

# 2. 启动 Web 工作台（热更新，默认 http://localhost:5173）
npm run dev

# 3. 启动 Tauri 桌面端开发调试（可选）
npm run dev --workspace @draw/desktop
```

## 仓库目录速览

| 目录 | 职责 |
| --- | --- |
| `apps/web` | React + TypeScript 前端工作台（2D SVG、Three.js 3D、高等数学 10 模块工作台、对象树/属性栏、Agent 抽屉、移动端 Material 3 布局） |
| `apps/desktop` | Tauri 2 + Rust 原生宿主壳（Windows / Android 安全凭据库、SQLite 持久化、原生文件导出与分享、全平台图标资产） |
| `packages/dsl` | 版本化几何文档模型与 `.mgeo` 编解码校验 |
| `packages/geometry-kernel` | 2D/3D 数值与解析几何求解器、圆锥曲线、大学高数字节码与微积分/ODE/PDE/线代/概率计算引擎 |
| `packages/scene-graph` | 响应式依赖图、事务系统与单步撤销/重做栈 |
| `packages/agent-core` | Agent 动作契约、约束义务验证、离线高数规划与数学核验证书门禁 |
| `docs` | 架构文档、实时状态（`current-status.md`）、版本发布说明与历史审计归档（导航见 [`docs/README.md`](docs/README.md)） |
| `portal` | 纯静态软件官网门户 |

## 提交 PR 前的必备检查

```bash
npm run typecheck   # 全仓 TypeScript 类型检查
npm run lint        # ESLint 静态检查（要求 0 error）
npm run test:docs   # 文档链接、版本真值与文件编码卫生检查
npm test            # 单元测试
npm run test:e2e    # Playwright 浏览器端到端回归（视改动范围运行相关 spec）
npm run test:rust   # 如修改 Rust 宿主代码
```

## 提交规范

- 推荐使用 Conventional Commits 前缀：`feat:`、`fix:`、`docs:`、`refactor:`、`test:`、`chore:`。
- 请避免提交任何真实 API Key、个人密钥库（`.keystore`）或临时构建日志。
- 若发现具体数学题无法正确画出，也欢迎直接通过 GitHub Issues 的「📐 数学题无法画出」模板提交原题！
