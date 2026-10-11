# 下一阶段（N1–N6）的开关与依赖 / 许可证审查

> 日期：2026-10-05 ｜ 基线：`6829f77`（`main`）
> **这一份是核对记录，不是发布批准。** 每一格都写明"实测到了什么"，没测的写"没测"并给出原因。

> **现行 V0a 状态（2026-10-06）**：`witnessSearch` 已可由用户开启受限自由三棱锥本地入口，定向浏览器 3/3；**V0a 未验收**：缺坐标独立回代、图面目检与全量回归。下方部分 2026-10-05 的措辞只代表历史测试时刻；新方向只做需作图的题，证据见 [当前状态](../current-status.md) 和 [新任务追踪](../agent-next-round-progress.md)。

## 一、五个开关的覆盖矩阵（N6 点名的核对项）

五个开关由 N1 创建于 `apps/web/src/agent/featureFlags.ts`（缺省全关；用户可在实验页独立开启 `constrainedDrag` 或 `witnessSearch`）。
N6 只核对"每个 flag 有单元 / 浏览器 / 回退用例"，**不重复创建**。

| 开关 | 读它的地方 | 单元用例 | 关闭回退的证据 | 浏览器用例 | 缺什么 |
| --- | --- | --- | --- | --- | --- |
| `obligationIR` | `agentRuntime.ts:240`（缺省取应用层那一份）→ `:271`/`:283` 传进 `drafts.stage`；`draftStore.ts:287` → 编译期 `diagramObligationIR`；Worker 链 `workerContracts.ts:51` / `workerRuntime.ts:82` / `geometryWorkerClient.ts:202` / `geometryWorkerHost.ts:111` / `geometryCompileStrategy.ts:106`；产出处 `diagramVerification.ts:176`；`committerAdapter.ts:154` | `featureFlags.test.ts`、`agentRuntime.test.ts:363`、`workerRuntime.test.ts:306`、`geometryWorkerHost.obligationIR.test.ts:101`、`draftStore.test.ts:373`、`planCompiler.test.ts:177`、`obligationIR.test.ts` | ✅ 三条：`planCompiler.test.ts:195`（关时不生成 IR）、`workerRuntime.test.ts:317`（畸形/缺省**不许**当 true）、`committerAdapter.test.ts:314`（不传 → `undefined`） | ❌ 无 | 浏览器端专测 |
| `witnessSearch` | 设置页独立偏好 → `agentNextPhaseFlags()` → 本地规划器/草稿/编译期/Worker，默认关 | 偏好、开关、草稿/Worker 和搜索器定向测试 | ✅ `planCompiler.offPath.golden.test.ts` 关旗逐字节黄金样本 | ✅ 入口 `e2e/next-phase-flag-entry.spec.ts` + V0a 受限自由顶点 `e2e/agent-diagram-free-apex.spec.ts` 定向 3 条（开/关与未知“上方”不确认） | V0a 还缺浏览器坐标独立回代/图形目检与全量回归；真实 provider 成功救援开放题尚未测，不能宣称通用作图。 |
| `constrainedDrag` | `App.tsx` 使用独立实验开关（默认关） | `featureFlags.test.ts`、`constrainedDrag3.test.ts`、场景/事务相关测试 | ✅ 旧自由拖动路径有结构与浏览器回归 | ✅ 仓内 `e2e/agent-constrained-drag.spec.ts` 现有 6 条和 `e2e/next-phase-flag-entry.spec.ts` 现有 4 条（仅文件内声明数量，**本轮未单独重跑这些 spec**） | 已有过约束拒绝、冲突恢复与一步撤销；空间线 `coincident` 缺 3D 判据仅安全拒绝，其它空间关系与真实题集成功率未验。 |
| `openProblemCompiler` | 目前无普通 Agent 产品读取点 | 只守默认全关及名称等集 | 不适用（无产品行为） | 无产品行为可测 | 旧 N4 评测面板不读此开关；现行 V3 作图题质量与开关启用另行设计，不能标已放行。 |
| `proofExport` | 目前无普通 Agent 产品读取点 | 只守默认全关及名称等集 | 不适用（无产品行为） | 无产品行为可测 | 旧 N5 仅独立 Lean 条件引理，现行 V2 自动证明尚未接入产品；不可写“证明出口已可用”。 |

**2026-10-05 更正（这一份的基线是 `6829f77`，它早于下面这两个提交）**：`constrainedDrag` 那一行原写"❌ 无 / **没有任何产品入口**能把它打开"，**已经过期** —— `fbb7584` 给了产品入口（顶栏「设置」→ 实验性功能 → 约束拖动，偏好存 `mathcanvas:next-phase-preferences`，`agentNextPhaseFlags()` 只取这一个），`96be699` / `6d21847` 补上了浏览器正反例：`e2e/next-phase-flag-entry.spec.ts`（入口本身 **3 条**）+ `e2e/agent-constrained-drag.spec.ts`（**2 条**：关着拖动**真的改变** `|AB|`；打开后同样拖动 `|AB|` **仍是 1**，且先断言 A 确实动过 —— 不许用"没变"冒充"被约束住"）。所以那一格改成 ✅ 5 条。

**当时结论（2026-10-05；下文历史按当时记录保留，现时读表格与本页顶部）**：三个已实现的开关都有"关闭回退"的证据，其中 `witnessSearch` 最硬（golden 逐字节）；
**在 2026-10-05，当时浏览器用例只有 `constrainedDrag` 有**；2026-10-06 `witnessSearch` 补上默认关闭的实验入口与浏览器用例，`obligationIR` 仍没有用户入口；
`openProblemCompiler` / `proofExport` 是**占位**（只有开关表与默认值，没有任何读取点）—— 这是刻意的，N6 不该为占位开关补用例。

> **⚠️ 2026-10-06 更正（N4 / N5 出口达成之后复跑这一段）**：上表那两行的"**N4 实现时才该有读取点**" / "**N5 实现时才该有读取点**"，以及上面结论里"`openProblemCompiler` / `proofExport` 是**占位**"这半句，要分开读：
> - **"占位 / 没有任何读取点"这半句仍然成立**：2026-10-06 在生产代码（`apps/` / `packages/` / `scripts/`）里复核，这两个名字依然只出现在开关表、默认值、测试与注释中（`featureFlags.ts` 第 33 / 35 / 50 / 57 行），**没有任何一处读它来决定行为**。
> - **"等 N4 / N5 实现"这半句已经过期**：N4（真实 provider 评测 + 人工可读性）与 N5（Lean 4 后端 + 只读「证明级别」状态面）**都已交付、出口都已勾**，但**两者都不是靠这两个开关接的** —— N4 走的是设置里的评测面板、N5 走的是只读状态面。
> - **后果**：它们在"关闭 flag 时旧路径逐字不变"那一列依然**不适用**（没有读取点就没有"旧路径"这回事），N6 依然**不该**为它们补用例；但**将来真把开放题编译或证明导出接进产品时，这一格必须重审** —— 与上面那条"不适用是一个有前提的结论"是同一纪律。

> **⚠️ 2026-10-10 更正（§3-D 落地之后复跑这一段）**：表里 `proofExport` 那一行整行**已过期** —— `15102e9` 给了它产品读取点与用户可见产物：① 设置 → 实验性功能 → **形式证明导出**（默认关、`=== true` 才算开、只写自己那个键、坏数据读成关）；② `committerAdapter` 把 `dependencies.nextPhaseFlags?.proofExport` 传进 `draftStore.stage` 的第八个参数（**同一块顺带修掉一处断线**：这一格原先传的是 `undefined`，注释还写着"由草稿层按它自己的开关做"，而草稿层根本没有自己的开关 ⇒ 在那之前"设置里打开形式证明导出"在生产主路上什么也不会发生）；③ 确认面板新增「形式证明」段（结局 / 正文来源 / 系统替你做的选择 + "原题其余题设没有进命题"的边界）。所以那一格的"**目前无普通 Agent 产品读取点** / **无产品行为可测**"**不再成立**：读取点在 `committerAdapter` / `draftStore.stage` / 面板，单元与浏览器判据在 §3-D 那一块（关着时面板整段不存在、开着时同一句话的面板上真的出现这一段）。
> `openProblemCompiler` 那一格**仍然成立**（2026-10-10 复核：这个名字依然只出现在开关表、默认值、测试与注释里）。**开关总数没有变**（仍是表里那五个）；变的是 `proofExport` 从"占位、无读取点"变成了"有产品入口 + 有回退判据"。
> **纪律照旧**：`obligationIR` 仍**没有**浏览器入口，那条"不适用是一个有前提的结论"仍然有效；而 `proofExport` 现在已经不是"占位开关"，**下一格该重审的是"证明目标覆盖"（原题其余题设、桌面真实往返、发行链），而不是它有没有读取点**。

> **⚠️ 2026-10-05 控制器补的一条"这一勾是有条件的"（写在矩阵这一节，因为它是逐格结论的一部分）**：
> 计划 N6 的第 2 条（"每个 flag 有单元 / 浏览器 / 回退用例"）**已按上面的逐格结论勾上** ——
> 但 `obligationIR` / `witnessSearch` 的浏览器格是 **【不适用】**，而**理由是当时的**：这两个开关在生产运行时代码里**是被读取的**
>（`agentRuntime.ts:271` / `:283` 传进 `drafts.stage(...)`、`:369` 放进 `nextPhaseFlags` —— 所以**不能**写成"没有代码路径"），
> 缺的是"**浏览器里没有办法把它们打开**"（`nextPhasePreferences.loadConstrainedDragEnabled` 只认 `constrainedDrag` 这一个键）。
> **因此**：**哪天给这两个开关加了产品入口，就必须同时补浏览器用例，并重审计划里那一格** ——
> 那时"不适用"就不再成立，这一勾会变成"把没做的事记成做完了"。**"不适用"是一个有前提的结论，不是一个永久豁免。**

### 「关闭 flag 时旧路径行为逐字不变」—— 这句话**不是一种证据，是三种**（2026-10-05 补审）

计划 N6 把它写成一条统一要求。逐条核下来，三个已实现的开关**各自靠的是不同的东西**，
强度也不同；把它们一律说成"逐字不变"是**过度概括**：

| 开关 | 离路径的保证来自 | 强度 |
| --- | --- | --- |
| `witnessSearch` | **黄金样本逐字节**：`planCompiler.offPath.golden.test.ts`（冻时钟、对着基线 commit 比 `JSON.stringify` 的每一个字节，失败时指出**在哪一位**分叉） | **测出来的**（最硬） |
| `obligationIR` | **结构 + 单测**：`planCompiler.ts` 的 `diagramObligationIR?: boolean` 注释写明"**显式为 `true` 才开** —— 缺省 / `undefined` / `false` 一律走旧路径"；`planCompiler.test.ts` 真的传过 `false`；跨 Worker 那一侧用 `request.obligationIR === true` 归一化，所以 `false` 不会在边界上变成真值 | 结构为主，单测钉着 |
| `constrainedDrag` | **结构性**：`App.tsx:519` 的离路径**就是原来那一行** `apply({ op: "translatePrimitive3", id, delta })` —— **没有第二份实现可以漂移** | 结构性（不是"测出来的"，但也没有可漂移的东西） |
| `openProblemCompiler` / `proofExport` | **没有读取点** ⇒ 不存在"旧路径"这回事 | 不适用 |

**为什么这个区分重要**：一份**黄金样本**保证"今天与基线逐字节相同"，但它是**对当时那份基线**的
快照，改动一旦有意就会过期；而**结构性**保证（离路径就是原代码那一行 / 显式为 `true` 才开）
不会过期，却也**没有留下"当时到底一样不一样"的证据**。两者都成立，但**不能互相冒充** ——
尤其不能拿"结构上没变"去充当"测过一样"。

**2026-10-06 更正（见证搜索入口）**：`witnessSearch` 现在有「设置 → 实验性功能」入口及 `e2e/next-phase-flag-entry.spec.ts` 的默认关/显式开/刷新保留/不连带开其它 flag 浏览器用例；另有偏好损坏 fail-closed 与 Worker 接线单测。上方矩阵的 `witnessSearch` 行已经更新为现状；2026-10-05 的「无入口」只作为当时发现保留。**仍未测到**浏览器里真实 provider 触发并成功救援某道开放题，不能把“可开”读成“命中率提高”。

## 二、JavaScript 侧的运行依赖与许可证（实测）

逐个读 `node_modules/<name>/package.json` 的 `license` 字段（下面的版本是**本机实测装到的**版本）：

| 包 | 实测版本 | 许可证 | 用在哪 |
| --- | --- | --- | --- |
| `three` | 0.186.0 | MIT | 3D 画布 |
| `react` / `react-dom` | 19.3.0 | MIT | 界面 |
| `zustand` | 5.0.15 | MIT | 文档 store |
| `pdf-lib` | 1.17.1 | MIT | 工程图 PDF 导出 |
| `@tauri-apps/api` | 2.11.1 | Apache-2.0 OR MIT | 桌面外壳桥 |
| `robust-predicates` | 3.0.3 | Unlicense | 几何内核的精确谓词 |
| `@vitejs/plugin-react` | 5.2.0 | MIT | 构建期（**2026-10-07 已归位到 `devDependencies`**，见 §五） |

**结论（仅限这一层）**：全部是 MIT / Apache-2.0 / Unlicense 这类宽松许可，**没有 copyleft**
（GPL / LGPL / AGPL / MPL）出现在 JS 运行依赖里。

## 三、Rust / Tauri 侧：传递依赖的许可证扫描（2026-10-05 补上，**这一节现在有结论**）

上一版这一节只列了**直接**依赖、并明说"没有结论"。这一版用 `cargo metadata` 把**整张依赖图**扫了
（`packages[].license` 覆盖传递依赖，不只看直接依赖）：

```
node scripts/toolchain.mjs cargo metadata --format-version 1 --manifest-path apps/desktop/src-tauri/Cargo.toml
```

**当次实测**：**551 个包 = 1 个工作区成员 + 550 个第三方**，**33 种许可证表达式**，
**没有一个包缺 `license` 字段**（所以不存在"许可未知"的黑洞）。分布前几名：
`MIT OR Apache-2.0` 266、`MIT` 116、`Apache-2.0 OR MIT` 52、`MIT/Apache-2.0` 22、
`Unicode-3.0` 18、`Zlib OR Apache-2.0 OR MIT` 17、`Unlicense OR MIT` 9。

**结论（可以当结论读）**：

1. **没有任何 GPL / AGPL / SSPL / CDDL / EUPL** 出现在依赖图里。
2. **5 个 crate 只给 MPL-2.0**：`cssparser@0.36.0`、`cssparser-macros@0.6.1`、`dtoa-short@0.3.5`、
   `option-ext@0.2.0`、`selectors@0.36.1` —— 都来自 Tauri 的 CSS 选择器一侧，**全是传递依赖**。
   **MPL-2.0 是文件级 copyleft**：链接与分发二进制是允许的，义务落在"被修改过的 MPL 文件"上；
   **本项目不修改它们**。
3. **2 个 crate 把 LGPL 作为可选项之一**（`r-efi@5.3.0` / `r-efi@6.0.0` =
   `MIT OR Apache-2.0 OR LGPL-2.1-or-later`）—— 那是**选择**，取 MIT / Apache 即可，**不承担 LGPL 义务**。
4. 工作区自己的 crate 直接依赖 15 个：`axum` / `futures-util` / `log` / `rand` / `reqwest` / `rusqlite` /
   `serde` / `serde_json` / `tauri` / `tauri-plugin-log` / `tokio` / `tower` / `tauri-build` / `keyring` / `winreg`。

**这一遍的边界（仍然不是法律意见）**：结论来自每个 crate **自己声明的 `license` 字段**；
**没有**逐 crate 读 LICENSE 正文，**没有**做 per-crate 的 SPDX 择一解析
（`cargo-about` / `cargo-deny` 会做这件事），也**没有**处理 `license_file` 的情形（这一遍没有遇到）。
另外：`--offline` 在本机**跑不通**（registry 索引不全，exit 101），所以这一遍**需要联网**。
`rusqlite` 的 `bundled` SQLite 具体版本与许可声明**仍未复核**（SQLite 本身是 public domain，
但"未复核"就是未复核）。

## 四、WASM 与线程边界

- **本项目没有任何 WASM 依赖**（实测：所有非 `node_modules` 的 `package.json` 里，依赖名中
  没有 `wasm` / `z3` / `solver`）。N2 的后端 spike（`scripts/witness-search-backend-spike.mjs`）
  刻意**没有**给任何 `package.json` 加依赖，只在临时目录里试装。
- **线程边界有两处**：① `apps/web/src/agent/geometryWorkerHost.ts` 的几何 Worker
  （懒建单例、`pagehide` 终止、建不起来时**如实降级**到就地编译并有独立用例）；
  ② Rust 侧的 tokio 多线程运行时（回环代理）。
- **并发正确性专项审查（2026-10-05 补上，这一节现在有结论）**：
  - **IPC 命令全是同步的**（`apps/desktop/src-tauri/src/commands/*.rs` 里没有 `async fn`），
    所以托管状态用 `std::sync::Mutex` 是对的，代码里也写明了理由（"这些是同步的 SQLite 调用，
    快且不阻塞在 IO 上"）。**同步命令 + std Mutex + 无 `.await`** 是个自洽的组合：
    `MutexGuard` 不是 `Send`，所以"跨 await 持锁"那类错误在 async 上下文里根本编译不过。
  - **唯一一处两把锁嵌套**：`proxy/server.rs` 的 `RunRegistry::touch`（先拿 `order`、淘汰时再拿
    `runs`，顺序恒为 `order → runs`）。两个调用点（`cancel_handle` / `record`）都在
    `drop(runs)` **之后**才调它 —— 那两行 `drop` 是**锁序的一部分，不是多余的清理**。
  - **本批补上的守卫**：`touch` 只在**超过 `MAX_TRACKED_RUNS`（16）**时才去拿第二把锁，而
    **此前没有任何用例把注册表推过上限** —— 也就是说那段嵌套**从未被执行到**。新增两条用例
    （`evicting_past_the_cap_keeps_the_registry_bounded` / `recording_past_the_cap_also_evicts`）
    把它跑到，并在两处 `drop(runs)` 上写明了不变量的名字。
  - **守卫是确定性的，而且验证过它会响**：`std::sync::Mutex` 不可重入，所以删掉任一处 `drop(runs)`
    会**同线程自锁**（必然死锁，不是偶发竞态）。实测：删掉第一处后跑那条用例 →
    **90 秒未结束、被强杀**（挂住即红）；恢复后全量 `test:rust` **238 通过 / 0 失败**。
  - **仍然没做的**：几何 Worker 那一侧**没有**做同样的"共享可变状态"清点（它是消息传递、
    没有共享锁，但这份结论**没有**写成清单）；也没有任何并发压测。
    **"没有共享锁"是好消息，可它是我读代码得出的，不是机器挡住的。**

## 五、顺手查出的两处依赖归位问题（**2026-10-07 已修**）

1. ~~`apps/web/package.json` 把 `@vitejs/plugin-react` 列在 **`dependencies`**~~（它是构建期插件）—— **已移到 `devDependencies`**。
2. ~~根 `package.json` 有一个 `three` 运行时依赖~~ —— **已删除**。真正用 `three` 的是 `apps/web`（`packages/*` 一处都没 import 过），`npm ls three` 现在只经 `@draw/web` 解析。

**当时的理由保留**：两处都**没有**在审查里顺手改，因为动依赖会牵动 `package-lock.json` 与安装结果，属于需要单独验证的一批（改完必须重跑安装 + 全量门禁）。
**2026-10-07 按这条要求执行**：`npm install` exit 0；lock 改动**逐行核过 —— 只有 112 处 `"dev": true` 翻转 + 5 行声明搬家，没有增删任何包**；typecheck exit 0、lint 0 error / 13 warning（基线）、web 生产构建 exit 0、全库非 Lean **330 文件 / 3878 通过 + 1 todo / 0 失败**。副作用是好的：插件那条 Babel 链现在带 `dev` 标记，**生产安装不再带上构建期依赖**。

## 六、这一份**没有**回答的问题（如实）

- **不是法律意见**：Rust 那节（§三）是"每个 crate 声明的 `license` 字段"的统计，没有逐 crate 读
  LICENSE 正文、没有 per-crate 的 SPDX 择一解析、没有复核 `bundled` SQLite 的版本与声明。
- **并发**：Rust 侧有过一轮专项（锁序 + 淘汰分支的守卫，见 §四），但**几何 Worker 那侧的共享可变
  状态没有写成清单**，也没有任何压测 —— 那部分仍然只能读作"我读过、没发现"，不是"已证"。
- 三个已实现开关的**浏览器**用例（§一）—— 其中 `constrainedDrag` 的入口**2026-10-05 补上了**（设置 → 实验性功能 → 约束拖动，偏好存 `mathcanvas:next-phase-preferences`，当时只有这个开关能被偏好打开；2026-10-06 `witnessSearch` 也有独立偏好入口）；原先卡在"没有产品入口能把它
  打开"，所以连正/反例都写不出来。
- `openProblemCompiler` / `proofExport` 的真实依赖 —— **2026-10-06 更新**：N4 / N5 都已交付、出口都已勾，但**这两个开关没有被用上**（依然没有任何读取点），所以"它们真正会牵动什么依赖"**今天仍然答不出来**；等真把它们接进产品时再答（见 §一 的 2026-10-06 更正）。
- 依赖体积 / 供应链（例如 lockfile 完整性、是否有 postinstall 脚本）—— 未审。
