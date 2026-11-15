# R10 CI 最小权限与 Action 固定证据（2026-11-15）

GitHub Actions Hardening — `.github/workflows/ci.yml`（修改前 `addf4c79`）

| 严重度 | 归并发现数 |
| --- | ---: |
| CRITICAL | 0 |
| HIGH | 1 |
| MEDIUM | 1 |
| LOW | 2 |
| INFO | 0 |

## 发现与修复

### HIGH — 第三方 Action 使用可变引用

修改前第142–143行使用 `dtolnay/rust-toolchain@stable` 和 `Swatinem/rust-cache@v2`。上游重新指向后，CI可能执行与本仓库变更无关的代码。置信度：高。

```yaml
- uses: dtolnay/rust-toolchain@stable
+ uses: dtolnay/rust-toolchain@39008827e6b4319a349e9a42dfc90579dd25f1ca # stable
- uses: Swatinem/rust-cache@v2
+ uses: Swatinem/rust-cache@d1527c8f67ef9af357290475d4af4b0fab8f12e0 # v2
```

### MEDIUM — token 权限继承仓库默认值

修改前没有顶层 `permissions:`。现已限制为下列唯一顶层权限；四个job均不追加权限，没有push、release、PR评论或OIDC步骤需要write。

```yaml
permissions:
  contents: read
```

### LOW — 第一方 Action 浮动、checkout 默认保留凭据

修改前第37/38、86/87、102/103、122、131/132行的第一方Action使用 `@v4`；四个checkout未设置 `persist-credentials`。现全部固定SHA，四个checkout均设置：

```yaml
with:
  persist-credentials: false
```

## 官方身份核对

2026-11-15通过五个官方GitHub仓库的公开commits API逐一请求，五个响应均为HTTP 200且返回的 `.sha` 与固定值完全相同。没有把 `gh` 不存在当作无法核对，也没有使用未知fork。

| 官方仓库 | 原引用 | 固定提交 | 补充核对 |
| --- | --- | --- | --- |
| `actions/checkout` | `v4` | `11d5960a326750d5838078e36cf38b85af677262` | `refs/tags/v4` 相同 |
| `actions/setup-node` | `v4` | `49933ea5288caeca8642d1e84afbd3f7d6820020` | `refs/tags/v4` 相同 |
| `actions/upload-artifact` | `v4` | `ea165f8d65b6e75b540449e92b4886f43607fa02` | `refs/tags/v4` 相同 |
| `dtolnay/rust-toolchain` | `stable` | `39008827e6b4319a349e9a42dfc90579dd25f1ca` | 官方commits API确认对象身份；不声称当前stable仍指向此处 |
| `Swatinem/rust-cache` | `v2` | `d1527c8f67ef9af357290475d4af4b0fab8f12e0` | 注解tag对象 `e9d7b9f1e587218970671bac74e5511ed9506e6a` 解引用到此提交，亦为 `v2.9.3^{}` |

固定提交保证引用不可变，不等于审计过上游全部代码或承诺永远无漏洞。

## 触发器、输入与信任边界

- 仅有 `push`（`main`）和 `pull_request`；没有 `pull_request_target`、`workflow_run`、`issue_comment`。
- 没有 `secrets.*` 引用，没有打印secret或 `set -x`，也没有自托管runner。
- 唯一 `${{ }}` 表达式是 concurrency 中的 `github.ref`；所有 `run:` 均未插入PR标题、正文、分支名、评论或提交消息。
- `pull_request` 下执行的代码不获得fork secret；显式只读token和禁用checkout持久化进一步缩小影响面。上传artifact只在本job保存失败证据，不存在下游 `workflow_run` 执行这些产物的路径。
- `rust-cache` 已固定到官方提交；当前没有高权限工作流消费低权限cache，本轮不扩大cache使用范围。

## RED → GREEN

- 新增 `scripts/ci/workflowPolicy.test.ts`，直接读取真实CI，校验精确Action仓库/SHA/数量、顶层权限、checkout凭据、危险触发器和不可信事件输入；不新增YAML依赖。
- 初次测试含两处夹具判定错误：把完整CI的数量要求误用于合法单checkout夹具，以及trigger正则漏掉两个空格缩进。先修正测试自身，不修改生产配置来迎合误报。
- 有效RED：`npm exec -- vitest run scripts/ci/workflowPolicy.test.ts --testTimeout=30000` → 1失败/11通过；真实配置报告16项问题，分别是1项权限、11项可变Action、4项checkout凭据。退出码1。
- GREEN：同一命令 → 1文件、12项通过、0失败。覆盖合法最小权限fixture及缺权限、额外write、job提权、浮动tag、未知fork、默认/显式保留凭据、危险trigger和PR标题插值负例。
- `npm run typecheck` → 退出0。
- `npm test -- --testTimeout=30000` → 522文件、5560项通过、1 todo、0失败。
- `npm run lint` → 0错误、32条既有unused警告；其中16条来自隔离worktree，新增守卫没有警告，本轮未处理出范围的R12警告。
- `npm run test:docs -- --testTimeout=30000` → 8文件、22项通过、0失败。
- `git diff --check` → 退出0。

## 验证边界与审阅

workflow只在 `main` push 和 PR 上运行。本轮在 `feature/drawing-reliability-execution` 上提交并推送，没有创建PR，因此**不会触发远端CI，不能宣称远端CI已运行或全绿**。本文件证明静态合同，不代替最小权限下的真实GitHub runner回归，也不等于完整E2E、Rust、付费provider、安装或发布验收。

本轮按用户授权进行同会话自审；未派生独立审阅者，不把自审写成独立产品签收。出现问题时保持只读权限，替换为经核实的固定提交或暂停CI，不恢复 `stable`/`v2`/`v4` 浮动引用。
