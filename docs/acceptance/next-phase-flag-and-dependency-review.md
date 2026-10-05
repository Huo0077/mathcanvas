# 下一阶段（N1–N6）的开关与依赖 / 许可证审查

> 日期：2026-10-05 ｜ 基线：`6829f77`（`main`）
> **这一份是核对记录，不是发布批准。** 每一格都写明"实测到了什么"，没测的写"没测"并给出原因。

## 一、五个开关的覆盖矩阵（N6 点名的核对项）

五个开关由 N1 创建于 `apps/web/src/agent/featureFlags.ts`（`agentNextPhaseFlags()` 恒返回全关）。
N6 只核对"每个 flag 有单元 / 浏览器 / 回退用例"，**不重复创建**。

| 开关 | 读它的地方 | 单元用例 | 关闭回退的证据 | 浏览器用例 | 缺什么 |
| --- | --- | --- | --- | --- | --- |
| `obligationIR` | `agentRuntime.ts:240`（缺省取应用层那一份）→ `:271`/`:283` 传进 `drafts.stage`；`draftStore.ts:287` → 编译期 `diagramObligationIR`；Worker 链 `workerContracts.ts:51` / `workerRuntime.ts:82` / `geometryWorkerClient.ts:202` / `geometryWorkerHost.ts:111` / `geometryCompileStrategy.ts:106`；产出处 `diagramVerification.ts:176`；`committerAdapter.ts:154` | `featureFlags.test.ts`、`agentRuntime.test.ts:363`、`workerRuntime.test.ts:306`、`geometryWorkerHost.obligationIR.test.ts:101`、`draftStore.test.ts:373`、`planCompiler.test.ts:177`、`obligationIR.test.ts` | ✅ 三条：`planCompiler.test.ts:195`（关时不生成 IR）、`workerRuntime.test.ts:317`（畸形/缺省**不许**当 true）、`committerAdapter.test.ts:314`（不传 → `undefined`） | ❌ 无 | 浏览器端专测 |
| `witnessSearch` | 同一条通道（`agentRuntime.ts:240` → `draftStore.ts:288` → 编译期 / Worker） | `geometryWorkerHost.witnessSearch.test.ts:121`、`workerRuntime.test.ts:334`、`committerAdapter.test.ts:296` | ✅ **最硬的一条**：`planCompiler.offPath.golden.test.ts` —— 对着基线采的 golden，断言关闭时**逐字节相同** | ❌ 无 | 浏览器端专测 |
| `constrainedDrag` | `App.tsx:518`（**N3 第三步新增的第一个读取点**） | `featureFlags.test.ts`（默认关）、`constrainedDrag3.test.ts`（关 → 只 `passthrough`，一个坐标都不写） | ✅ `e2e/geometry3d-drag.spec.ts` + `geometry3d-creation.spec.ts` 共 **19 条**在关闭状态下全绿（含"一次自由拖动只撤销一步"） | ❌ 无 | **打开状态的浏览器正/反例** —— 而且目前**没有任何产品入口**能把它打开 |
| `openProblemCompiler` | **无** | 只有 `featureFlags.test.ts` 的"默认全关"与"键集合相等" | 不适用（无行为） | ❌ 无 | N4 实现时才该有读取点 |
| `proofExport` | **无** | 同上 | 不适用（无行为） | ❌ 无 | N5 实现时才该有读取点 |

**结论**：三个已实现的开关都有"关闭回退"的证据，其中 `witnessSearch` 最硬（golden 逐字节）；
**五个开关都没有浏览器用例**，而 `openProblemCompiler` / `proofExport` 是**占位**（只有开关表
与默认值，没有任何读取点）—— 这是刻意的，N6 不该为占位开关补用例。

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
| `@vitejs/plugin-react` | 5.2.0 | MIT | 构建期（**但被列在 `dependencies`，见 §五**） |

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
  ② Rust 侧的 tokio 多线程运行时（回环代理）。两处都有实现记录，但**没有做过"并发正确性"
  的专项审查**（例如竞态压测）—— 这也是没测，不是通过。

## 五、顺手查出的两处依赖归位问题（未修）

1. `apps/web/package.json` 把 `@vitejs/plugin-react` 列在 **`dependencies`**（它是构建期插件，
   应在 `devDependencies`）。后果不是"功能坏了"，而是发行包会多带上一个构建期依赖。
2. 根 `package.json` 有一个 `three` 运行时依赖，而真正用 `three` 的是 `apps/web`。
   根上这一份是多余声明。

两处都**没有改**：动依赖会牵动 `package-lock.json` 与安装结果，属于需要单独验证的一批
（改完必须重跑安装 + 全量门禁），不该塞在审查里顺手做。

## 六、这一份**没有**回答的问题（如实）

- **不是法律意见**：Rust 那节（§三）是"每个 crate 声明的 `license` 字段"的统计，没有逐 crate 读
  LICENSE 正文、没有 per-crate 的 SPDX 择一解析、没有复核 `bundled` SQLite 的版本与声明。
- 任何"并发正确性"结论（§四）。
- 三个已实现开关的**浏览器**用例（§一）—— 其中 `constrainedDrag` 还卡在"没有产品入口能把它
  打开"，所以连正/反例都写不出来。
- `openProblemCompiler` / `proofExport` 的真实依赖（N4 / N5 实现时才有）。
- 依赖体积 / 供应链（例如 lockfile 完整性、是否有 postinstall 脚本）—— 未审。
