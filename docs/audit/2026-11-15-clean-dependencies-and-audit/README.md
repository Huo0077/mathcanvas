# R11 证据摘要：干净依赖、公告处置与 Rust 审计缺口

## 1. 环境与漂移盘点

- **宿主机与锁文件差异核实**：
  - 宿主机活动目录运行在 Node `v26.3.0` / npm `11.16.0`，且存在历史 `.pnpm` 结构，导致 `npm.cmd ls vitest` 报告 `ELSPROBLEMS / invalid: vitest@4.1.12`（实际安装 `4.1.12`，原 `package-lock.json` 仍锁 `4.1.11`）。
  - 严格不在活动目录清空依赖；全部可复算安装与回归均在 `.worktrees/r00-node22` 内使用显式 Node `v22.23.5` + npm `11.16.0` 执行 `npm ci`。
- **修复前审计基线（`59ea3613..d2917398` 沿用锁文件）**：
  - `npm.cmd audit --omit=dev --json`：`0` 漏洞（critical 0 / high 0 / moderate 0 / low 0）。
  - `npm.cmd audit --json`：**14 个包受影响（3 high / 11 moderate）**：
    - `vite@7.3.6`（High：`GHSA-698v-4r3x-3vcv`、`GHSA-r825-w8mm-5pxw`、`GHSA-587h-7wmj-h5pm`、`GHSA-9jrq-w75r-8gcw`、`GHSA-rq7h-c2jc-7f22`，修复于 `>=7.3.7`）
    - `source-map-js@1.2.1`（High：`GHSA-68fv-2mgg-jv7q`，修复于 `>=1.2.2`）
    - `zod@4.6.5`（High：`GHSA-mrhx-c7xc-m3w5`，修复于 `>=4.6.6`）
    - `vitest@4.1.11` / `@vitest/mocker@4.1.11`（Moderate：`GHSA-qxg6-89mg-rqv8`、`GHSA-xp26-3454-mjgp`，修复于 `>=4.1.12`）
    - `minimatch@10.2.6` 及传递链 `eslint@10.10.0`、`@eslint/config-array@0.23.5`、`typescript-eslint@8.70.0`、`@typescript-eslint/*@8.70.0`（Moderate：`GHSA-g3hv-75wg-m249`，修复于 `>=11.0.1`）

## 2. 最小兼容修复与未决例外登记

不使用 `npm audit fix --force`（该命令会强行将 `typescript-eslint` 降级至不支持 ESLint 10 的 `8.36.0`），按直接依赖与传递链逐项升级最小兼容版本并提升 `package.json` 下限：

- `vitest`：`^4.1.11` → `^4.1.12`（锁定 `4.1.12`，同步修复 `@vitest/mocker@4.1.12` 并消除 `4.1.11` vs `4.1.12` 漂移）
- `vite`：`^7.1.3` → `^7.3.8`（锁定 `7.3.8`，清零全部 5 项 `vite` 高危公告）
- `source-map-js`：`1.2.1` → `1.2.2`（`postcss` 传递升级，清零高危公告）
- `zod`：`4.6.5` → `4.6.7`（`eslint-plugin-react-hooks` 传递升级，清零高危公告）
- `eslint`：`^10.10.0` → `^10.15.0`（锁定 `10.15.0`，根 `minimatch` 升至 `11.0.8`，清零 `eslint` 与 `@eslint/config-array` 公告）
- `typescript-eslint`：`^8.70.0` → `^8.72.2`（锁定 `8.72.2`）

### 修复后 `npm audit` 结果（Node 22.23.5 / npm 11.16.0 实测）

| 审计命令 | 结果 | 明细 |
| --- | --- | --- |
| `npm audit --omit=dev --json` | **0 漏洞**（exit 0） | 生产/运行时依赖无已知公告 |
| `npm audit --json` | **0 critical / 0 high / 7 moderate**（exit 1） | 全部分布于同一条上游未发版开发期传递链：`@typescript-eslint/typescript-estree@8.72.2` 仍声明 `minimatch: ^10.2.2`（锁定 `minimatch@10.2.6`，`GHSA-g3hv-75wg-m249`） |

#### 遗留中危例外台账（不以“dev 工具”免责高危；此处高危已 0）

- **公告**：`GHSA-g3hv-75wg-m249`（`minimatch` `>=7.0.0 <11.0.1`，Moderate，globparts 放大 ReDoS）
- **适用性**：仅限离线开发/CI 执行 `eslint .` 解析固定仓库源码目录时由 `@typescript-eslint/typescript-estree@8.72.2` 调用；不打入前端 Web 构建产物，不接受任何运行期不可信输入。
- **临时缓解**：不使用 `npm audit fix --force` 回退主版本；已新增 `scripts/ci/dependencyLockPolicy.test.ts` 锁定已修版本下限与例外到期监控。
- **责任人与到期时间**：责任人 `repo-maintainers`；到期时间 `2026-12-31`（待 `@typescript-eslint/typescript-estree` 上游升级至 `minimatch@^11.0.1` 后移除例外）。

### Rust / Cargo 审计与许可证盘点

- **RustSec (`cargo audit`)**：宿主机 `cargo 1.98.1` 执行 `cargo audit --version` 返回 `error: no such command: audit`（未预装 `cargo-audit`）。**严格按未知（`unknown`）记录缺口**，不宣称 Rust 无安全公告：
  - **临时缓解 / 前置要求**：未在本包借机大范围改动 `Cargo.lock`，`npm run licences:scan` 已完成 `550` 个 crate 的许可证扫描（33 种表达，无未知阻断变化）。
  - **责任人与到期时间**：责任人 `desktop-release-owner`；在进入 R12 / 桌面发布门禁前（不晚于 `2026-12-31`）需通过受控工具链安装固定版本 `cargo-audit` 完成 `apps/desktop/src-tauri/Cargo.lock` 实扫并消缺。

## 3. 兼容修复与新增守卫

- **Node 22 jsdom `Storage` 兼容修复**：在 `.worktrees/r00-node22` 全量 Vitest 中实测发现 `apps/web/src/persistence/draftStorage.test.ts` 与 `apps/web/src/useDraftPersistence.test.tsx` 的 4 项 `R06` 用例直接对 `localStorage` 实例做 `vi.spyOn`，在 Node 22 jsdom 下未拦截 `Storage.prototype`；改用 `storageSpyTarget`（兼容 Node 22 `Storage.prototype` 与 Node 26 原生 WebStorage），经双环境实测全部通过（30/30）。
- **依赖锁 Parity 与门禁回归测试**：新增 `scripts/ci/dependencyLockPolicy.test.ts`，以负例测试验证锁文件版本漂移、CI 混用 `pnpm/yarn` 与未登记原因/高危未修复即放行都会被拒绝。

## 4. 隔离 Node `v22.23.5` / npm `11.16.0` 全量验证实证

| 验证项 | 环境与命令 | 结果 |
| --- | --- | --- |
| 干净安装 | `.worktrees/r00-node22`：`npm ci` | 退出 `0`；`added 275 packages, audited 282 packages` |
| 依赖树一致性 | `.worktrees/r00-node22`：`npm ls --depth=0` | 退出 `0`；零 `ELSPROBLEMS` / 零版本漂移 |
| 类型检查 / Lint | `.worktrees/r00-node22`：`npm run typecheck`、`npm run lint` | 均退出 `0`（Lint `0 errors / 16 warnings`） |
| Web 构建 | `.worktrees/r00-node22`：`npm run build --workspace @draw/web` | `vite v7.3.8` 构建通过（`634 modules`，`29.57s`） |
| 离线评测 | `eval:reliability -- --offline`、`eval:explicit-solid -- --offline` | 均通过（`3 passed`、`2 passed`） |
| Crate 许可证扫描 | `npm run licences:scan` | 退出 `0`（`packages=550, distinctExpressions=33`） |
| 守卫与跨版本复测 | `scripts/ci/dependencyLockPolicy.test.ts`、`workflowPolicy.test.ts`、`draftStorage.test.ts`、`useDraftPersistence.test.tsx` | Node 22 与 Node 26 均通过 |
| 完整 Vitest | `.worktrees/r00-node22`：`npm test -- --testTimeout=30000` | 最终全量实测：**525 文件 / 5592 passed \| 1 todo (5593)**，0 failed（433.53s） |
| 完整串行 Rust | `.worktrees/r00-node22`：`npm run test:rust` | **317 passed, 0 failed, 4 ignored** |
| 完整串行 E2E | `.worktrees/r00-node22`：`npx playwright install chromium`（`chromium-1243`）后 `npx playwright test --workers=1 --retries=0 --reporter=line` | **286 passed (14.0m), 0 failed, 0 retries** |

## 5. 回滚说明

- 依赖与测试守卫变更独立可回滚（`package.json`、`package-lock.json`、`scripts/ci/dependencyLockPolicy.test.ts`、2 份 `R06` 测试）；若回滚 `package.json` / `package-lock.json`，前述 3 项 High 及 7 项 Moderate 开发依赖公告将重新打开，必须继续保持发布阻断。
