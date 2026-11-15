# MathCanvas 项目审查报告

## 0. 文档信息

| 项目 | 内容 |
| --- | --- |
| 项目 | MathCanvas / multimodal-math-engine |
| 内容类型 | Reference（项目审查与修复参考） |
| 文档目标 | 帮助维护者定位发布阻断问题并安排修复顺序 |
| 读者 | 项目维护者、修复人员与发布审核人员 |
| 关联计划 | [画图可靠性整改实施计划](../../superpowers/plans/2026-11-15-drawing-reliability-repair-plan.md) |
| 审查基线 | `59ea36133c47971f4252e71f7a0f5ba003dd1028` |
| 近期变更审查范围 | `09100abf..59ea3613`，含 v4.3.0 与题图审查/图形校验提交 |
| 报告日期 | 2026-11-15 |
| 审查方式 | 源码审查、跨文件数据流分析、依赖与密钥扫描、真实源码探针、标准构建与测试 |
| 源码改动 | 未修改产品源码、配置或用户文档；本报告为唯一新增交付文件 |
| 总体结论 | **不建议发布，也不应将当前基线视为“已验证完成”** |

> 当前 `main` 落后 `origin/main` 47 个提交。上游存在 Agent 与 E2E 相关后续改动，本报告只评价上述本地基线，不代表最新上游的状态。

常用术语：CI 是持续集成，E2E 是端到端测试，IPC 是进程间通信，CAS 是比较并交换，SSRF 是服务器端请求伪造，DoS 是拒绝服务。

## 1. 执行摘要

当前基线存在一个可直接复现的图形核验错误放行：后续小问中的显式条件会被静默丢弃，违反该条件的候选仍能获得 `passed`。桌面端另有凭据转发、未授权文件写入和项目包内存放大三条高危路径。完整 Playwright 套件两轮均未通过，且同时存在测试契约漂移、稳定产品/契约冲突和并行时序不稳定。

| 严重程度 | 数量 | 含义 |
| --- | ---: | --- |
| CRITICAL | 1 | 可直接导致错误数学结果被认证并进入确认流程 |
| HIGH | 4 | 凭据、文件系统、进程资源或 CI 供应链存在严重风险 |
| MEDIUM | 11 | 正确性、数据保护、可用性或安全边界存在明确缺陷 |
| LOW | 5 | 较低直接风险的缺陷、测试缺口和加固项 |
| INFO | 3 | 基线、环境与验证覆盖限制 |

补充结论：

- `npm audit` 共报告 14 项依赖公告：3 项高危、11 项中危，均位于开发工具链；`npm audit --omit=dev` 为 0。
- 未发现真实硬编码密钥；命中项均为测试假值、占位符、Base64 字符表或内容哈希。
- 保存的 36 题真实评测基线中，25/36 生成草稿，旧宿主通过仅 4/36，32 题失败；完整题设证书在该版本中不存在。该数据来自既有实测证据，不是本轮重新调用模型的结果。
- 单元测试、类型检查、文档检查、完整构建和 Rust 测试通过，不能抵消上述功能与安全证据。

## 2. 审查范围与方法

### 2.1 已覆盖

1. 盘点 npm workspaces、React/TypeScript、Three.js、Tauri/Rust、SQLite 和 CI 配置。
2. 审查 v4.3.0 与随后题图/校验变更的实际 diff，并追踪相邻调用方。
3. 审查全部桌面生产 Rust 文件，重点追踪 IPC、provider 网络请求、凭据库、项目包、附件、SQLite、回环代理和证明子进程。
4. 检查 Agent 草稿、用户确认、一次性同意、预览哈希和 CAS 提交边界。
5. 检查文件导入导出、HTML 快照、CSV、localStorage 草稿和 provider 配置保存异常路径。
6. 扫描危险 DOM API、动态执行、进程调用、弱随机、TLS 关闭项、硬编码密钥和敏感日志。
7. 运行 `npm audit`、密钥模式扫描、GitHub Actions 信任边界与 Action 固定检查。
8. 使用 esbuild 内存转译加载真实源码，复现小问错误放行、CSV 公式文本、provider 回滚和草稿覆盖。
9. 运行标准类型检查、Lint、Vitest、文档测试、完整构建、Rust 测试及两轮完整 Playwright；对代表性失败再作单 worker 定向复核。

### 2.2 未覆盖或限制

- 本报告不是对 1,584 个受跟踪文件逐行审计，也不构成渗透测试。
- 本机未安装 `cargo-audit`，因此 RustSec 当前公告状态未验证。
- 未发起新的付费 provider 请求，未重新测量真实模型通过率。
- 未执行安装包/干净机器/教师学生走查。
- 未实际运行 256 GiB 内存爆炸、DNS rebinding 或恶意 TLS 服务，以避免破坏本机环境。
- 本机依赖目录混有 pnpm/npm 安装痕迹，Node 为 26.3.0，而 CI 使用 Node 22；本机结果不能替代干净 CI。

## 3. CRITICAL：后续小问的题设被静默丢弃并错误放行

**位置：**

- `packages/agent-core/src/diagramObligations.ts:2154`
- `packages/agent-core/src/diagramObligations.ts:2171`
- `packages/agent-core/src/diagramObligations.ts:2175`

**置信度：高。**

### 3.1 根因

只有后续小问以“若、如果、假设、另设”开头时，`parseDiagramObligations` 才建立小问作用域。否则，第一个“证明/求证”边界后的全部文本进入目标字符串，后续小问中的前置条件既不作为题设，也不标记为未核验。

关键形状：

```ts
if (problem?.parts.slice(1).some(part =>
  /^\s*(?:若|如果|假设|另设)/.test(part.text))) {
  // 建立小问作用域
}
return parseDiagramScope(prompt, options)
```

### 3.2 复现证据

输入：

```text
四棱锥 P-ABCD 中，PA=2。
（1）证明 AD∥平面 PBC；
（2）AD⊥DC，求 AD。
```

解析结果：

```json
{
  "givens": ["PA=2"],
  "goals": ["AD∥平面 PBC；（2）AD⊥DC，求 AD。"],
  "unverified": [],
  "parts": 0
}
```

随后构造一份有效四棱锥，使 `AD·DC=1`，即明显不满足 `AD⊥DC`。真实 `compilePlan` 返回：

```json
{
  "ok": true,
  "status": "passed",
  "checks": [{"sourceText":"PA=2","status":"passed"}],
  "dotAD_DC": 1,
  "diagnostics": []
}
```

`（2）设 AD⊥DC，求 AD。` 也存在同样问题。

### 3.3 影响

违反明确题设的候选可获得 `passed` 并进入用户确认。这破坏了“未核验必须 fail-closed”的核心门禁，不是单纯的支持范围不足。

### 3.4 修复建议

短期先对所有未明确选择小问的多问题目 fail-closed；随后再实现完整的小问作用域选择。可在现有假设句分支之后加入保守护栏：

```diff
- return parseDiagramScope(prompt, options)
+ if (problem && problem.parts.length > 1) {
+   const scoped = parseDiagramScope(prompt, options)
+   return {
+     ...scoped,
+     unverified: [...scoped.unverified, {
+       sourceText: "各小问的条件",
+       reason: "尚未确定按哪一问作图，不能忽略其余小问的条件。"
+     }]
+   }
+ }
+ return parseDiagramScope(prompt, options)
```

必须补充：

- 裸条件 `（2）AD⊥DC，求 AD`；
- `设/且` 变体；
- 一份满足公共条件但违反第二问条件的候选；
- 断言该候选不能获得 `passed`，也不能进入确认。

## 4. HIGH：桌面与 CI 安全边界

### 4.1 H1：provider 凭据可被转发到攻击者指定的 endpoint

**位置：**

- `apps/desktop/src-tauri/src/commands/providers.rs:214`
- `apps/desktop/src-tauri/src/providers/adapter.rs:438`
- `apps/desktop/src-tauri/src/providers/adapter.rs:493`
- `apps/desktop/src-tauri/src/providers/request.rs:432`

**置信度：高。**

`secretRef` 未绑定所属 profile，也未绑定 endpoint。恶意 IPC 调用可以新建 profile，引用其他 profile 的凭据，再把 `baseUrl` 指向攻击者 HTTPS 服务。`provider_run` 会从系统凭据库取出受害者密钥并放进认证头。

另一种路径是更新已有 profile 的 `baseUrl`，保留其 `secretRef` 和密钥。

**前提与影响：**需要 renderer/IPC 已被控制；本轮未发现远程未认证入口。该路径使原生层成为 confused deputy，可直接窃取 provider 凭据。

建议补丁：

```diff
- store.upsert(prepared, expected_revision).map_err(store_error)
+ let previous = store.get(&prepared.id);
+ let secret_ref = prepared.secret_ref.as_deref().unwrap_or(&prepared.id);
+ if secret_ref != prepared.id {
+   return Err("a profile may reference only its own credential".into());
+ }
+ if previous.as_ref().is_some_and(|old| old.base_url != prepared.base_url) {
+   let secrets = app.try_state::<SecretStoreState>()
+     .ok_or("the secret store is not initialised")?;
+   if secrets.0.has(secret_ref).map_err(|error| error.to_string())? {
+     return Err("changing endpoint requires removing and re-entering the credential".into());
+   }
+ }
+ store.upsert(prepared, expected_revision).map_err(store_error)
```

正式实现应比较规范化后的 scheme/host/effective port，并提供原生 rekey 流程；不能仅信任 renderer 传入的 `reauthorized=true`。

### 4.2 H2：`export_package` 提供未授权的原生文件写入原语

**位置：**

- `apps/desktop/src-tauri/src/commands/repository.rs:207`
- `apps/desktop/src-tauri/src/commands/repository.rs:224`
- `apps/desktop/src-tauri/src/repository/package.rs:419`
- `apps/web/src/components/ProjectPackagePanel.tsx:240`

**置信度：高。**

目标路径直接来自 IPC，原生层会创建目录、写临时文件并改名，没有原生保存对话框授权或允许的导出根目录。前端也明确使用自由文本路径。

恶意 renderer 可在应用数据目录之外创建文件。Windows 下最终替换已有目标通常会失败，但创建新文件和截断可预测的 `.mcanvas.tmp` 临时文件仍然可能；在 rename 可替换目标的平台上，还可能覆盖用户文件。

建议先限制到应用拥有的导出目录：

```diff
- repository::package::write_to_file(&destination, &bytes)?;
+ let destination = export_destination(&app, &destination)?;
+ repository::package::write_to_file(&destination, &bytes)?;
```

```rust
fn export_destination(app: &tauri::AppHandle, value: &str) -> Result<std::path::PathBuf, String> {
    let requested = std::path::Path::new(value);
    let valid = requested.components().count() == 1
        && requested.extension().and_then(|ext| ext.to_str())
            .is_some_and(|ext| ext.eq_ignore_ascii_case("mcanvas"));
    if !valid {
        return Err("expected a single .mcanvas filename".into());
    }
    Ok(app.path().app_data_dir()
        .map_err(|error| error.to_string())?
        .join("exports")
        .join(requested))
}
```

若必须保留任意路径，应由原生保存对话框选择目的地并颁发一次性、绑定该路径的授权；仅在 TypeScript 校验同一字符串不足以构成安全边界。

### 4.3 H3：ZIP 重复数据引用可造成约 256 GiB 的内存/CPU 放大

**位置：**

- `apps/desktop/src-tauri/src/repository/archive.rs:207`
- `apps/desktop/src-tauri/src/repository/archive.rs:225`
- `apps/desktop/src-tauri/src/repository/archive.rs:262`
- `apps/desktop/src-tauri/src/repository/package.rs:438`

**置信度：高。**

当前限制为单条 64 MiB、最多 4096 条，但没有聚合未压缩大小预算，也不拒绝多个中央目录项引用同一本地数据块：

```rust
let data = bytes.get(data_start..data_start + size)?;
let actual = crc32(data);
out.insert(name, data.to_vec());
```

攻击者可构造一个约 64 MiB 的有效载荷，再让 4096 个不同安全名称指向同一 local header。输入仍低于 256 MiB 文件上限，但解析器会反复计算 CRC 并克隆数据，理论放大为 **256 GiB**。

**验证边界：**源码路径明确；未实际执行破坏性内存爆炸 PoC。

建议在任何 CRC 或克隆之前累计声明大小：

```diff
+ pub const MAX_UNPACKED_BYTES: usize = MAX_ENTRY_BYTES * 4;
  let mut out = BTreeMap::new();
+ let mut unpacked_bytes = 0usize;
  for _ in 0..count {
      // 现有单条大小检查之后
+     unpacked_bytes = unpacked_bytes.checked_add(size)
+       .ok_or_else(|| ArchiveError::TooLarge {
+         detail: "aggregate package size overflow".into()
+       })?;
+     if unpacked_bytes > MAX_UNPACKED_BYTES {
+       return Err(ArchiveError::TooLarge {
+         detail: "aggregate package contents exceed the limit".into()
+       });
+     }
      // 然后再计算 CRC、分配 data.to_vec()
  }
```

`repository/package.rs:438` 的文件读取上限应改用同一聚合常量。另应增加“不同中央目录名共享一个 local offset”的回归样本，并断言在聚合分配前拒绝。

### 4.4 H4：两个第三方 GitHub Action 使用可变引用

**位置：**`.github/workflows/ci.yml:142`、`:143`

**置信度：高。**

`stable` 是分支，`v2` 是可变标签。上游被攻破或标签被重指时，Action 代码会在 CI token 上下文中执行。

```diff
- uses: dtolnay/rust-toolchain@stable
- uses: Swatinem/rust-cache@v2
+ uses: dtolnay/rust-toolchain@39008827e6b4319a349e9a42dfc90579dd25f1ca # stable
+ uses: Swatinem/rust-cache@d1527c8f67ef9af357290475d4af4b0fab8f12e0 # v2
```

以上 SHA 为审查时通过上游 refs 核实的值，应用前仍应复核并运行 CI。

## 5. MEDIUM：正确性、数据保护与可用性

### 5.1 M1：辅助曲线使函数/直线交点核验误报未核验

**位置：**`packages/agent-core/src/diagramVerification.ts:2444`、`:2471-2480`

**置信度：高。**

共享上下文使用 `curve: curves.length === 1 ? curves[0] : null`，存在辅助曲线时直接变成 `null`。新的主曲线选择只应用于 `functionGraph`，而 `functionLineIntersections` 等仍读取共享值。

结果是：主函数图像本身通过，正确的两个交点却被标为 `unverified`，形成错误阻断。应对所有函数相关义务使用按题设绑定的主曲线，而不是以全局曲线数量代表绑定歧义。

### 5.2 M2：题图关系与精确坐标绕过 mandatory review

**位置：**

- `apps/web/src/services/problemImageReview.ts:3-5`
- `apps/web/src/services/problemImageReview.ts:44-47`
- `apps/web/src/services/problemImagePrompt.ts:22-23`
- `apps/web/src/components/agent/ProblemImageComposer.tsx:342`

**置信度：高。**

`isDiagramLine` 未覆盖下列关系文本：

```text
AB 与 CD 相交于 E
AB∥CD
AB 和 CD 是两条棱
```

这些观察无需 `confirmedLines` 即可进入提示。尤其“相交”与读图提示中“透视图交叉不一定是空间相交”的警告相冲突。

坐标正则只接受十进制数，`F(2√5,0)` 和 LaTeX 分式坐标不会产生条件级疑点。

建议让读图结果携带结构化 observation kind；未知或连接类观察默认需要人工确认。点名/标量才可按明确类别自动通过。坐标形状与数值语法应分离，读不懂的精确坐标也应进入复核，而不是消失。

### 5.3 M3：CSV 导出允许电子表格公式注入

**位置：**`apps/web/src/persistence/exporters.ts:101-103`、`:150-164`

**置信度：高。**

`csvCell` 只处理引号、逗号和换行：

```ts
const text = String(value)
return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
```

真实源码探针得到：

```text
point-1,point,=1+1,true,false,"{""x"":1,""y"":2}"
point-1,point,"=HYPERLINK(""https://example.invalid"",""open"")",true,false,...
```

双引号只是 CSV 字段包装，不会阻止 Excel 将字段解释为公式。恶意 `.mgeo` 的标签或 ID 可在受害者导出并用电子表格打开时形成公式注入。

建议对 `= + - @`、制表符和换行开头的字段添加文本前缀（通常为单引号），同时考虑前导空白，并补充公式前缀与正常负数的契约测试。

### 5.4 M4：provider 配置写入失败会破坏原凭据

**位置：**

- `apps/web/src/services/providerProfileClient.ts:248-257`
- `apps/web/src/components/settings/ProviderSettings.tsx:227-245`
- `apps/desktop/src-tauri/src/secrets/windows.rs:56-60`

**置信度：高。**

保存顺序是“先覆盖密钥，再写 profile”。如果 profile 写入失败，代码删除新密钥作为回滚，却无法恢复被覆盖的旧密钥。Windows 后端明确采用覆盖写。

真实探针确认调用顺序：

```json
{
  "calls": ["save_secret", "upsert_provider_profile", "remove_secret"],
  "ok": false
}
```

已有配置因此指向一个不存在的凭据。新建和编辑必须走不同补偿策略；对已有 profile 不应把“删除新密钥”视为完整回滚。应设计原生事务/rekey，或在失败时明确要求重新输入凭据并保留可恢复状态。

### 5.5 M5：草稿备份失败仍声称已备份，后续保存会覆盖原文

**位置：**

- `apps/web/src/persistence/draftStorage.ts:105-113`
- `apps/web/src/useDraftPersistence.ts:248-257`

**置信度：高。**

当 unreadable 旁路键写入失败时，原键暂时保留，但错误仍统一显示“已备份保留”。真实探针结果：

```json
{
  "recoveryMessage": "无法恢复上次的草稿（已备份保留）：Invalid geometry document: revision must be a non-negative integer",
  "retainedBeforeEdit": true,
  "retainedAfterEdit": false
}
```

即原草稿在下一次 `saveDraft` 后被覆盖。备份失败时必须明确告知“未能备份”，并阻止自动保存覆盖唯一副本；可提供内存下载/导出恢复入口。

### 5.6 M6：cloud SSRF 校验可被 IPv6 与 DNS 解析绕过

**位置：**

- `apps/desktop/src-tauri/src/proxy/security.rs:209`
- `apps/desktop/src-tauri/src/proxy/security.rs:229-238`
- `apps/desktop/src-tauri/src/providers/adapter.rs:414`

**置信度：高。**

手写解析器使用：

```rust
let host = host_port.split(':').next()?.to_ascii_lowercase();
```

`https://[::1]:4443` 得到 `[` 而不是 `::1`，因而通过 `is_private_host`。Reqwest 则会按合法 IPv6 URL 解析。

主机名也只按字符串检查，没有验证解析后的 IP，更没有防止二次 DNS 答案变化的连接固定。

建议改用 `reqwest::Url`，拒绝 loopback/private/link-local/unspecified/IPv4-mapped private/IPv6 ULA 等地址；解析所有候选地址并拒绝非公共地址，再用 `resolve_to_addrs` 固定已验证地址。TLS 验证仍然有效，因此利用还需要满足证书主机名条件。

### 5.7 M7：非成功 HTTP 响应在截断前被完整读入

**位置：**`apps/desktop/src-tauri/src/providers/adapter.rs:586-593`

**置信度：高。**

```rust
body = response.text() => body.unwrap_or_default(),
let detail: String = body.chars().take(200).collect();
```

200 字符截断发生在完整缓冲之后。1 MiB 流式限制只覆盖成功响应。恶意或故障 provider 可用超大/持续的错误响应造成内存压力。

应复用取消感知、分块读取路径，在扩展缓冲之前实施字节上限；既然只展示 200 字，几 KiB 上限即可。补充 Content-Length 和 chunked 超限测试。

### 5.8 M8：三组稳定 E2E 失败揭示产品/测试契约未决

**置信度：高。**

1. `apps/web/src/persistence/inspectorWidth.ts:1` 默认宽度为 310，而 `e2e/ribbon-ui.spec.ts:40-41` 仍要求 248–252，实测为 310。
2. `apps/web/src/threeSceneGrid.ts:132-134` 明确写着已回退到 `LineBasicMaterial`、着色器径向淡出已撤回；`e2e/three-grid-fade.spec.ts:18` 仍验证旧淡出/着色器契约，拖动后 `groundReach` 仍为 51.44。
3. `e2e/agent-derived-sphere.spec.ts:100` 要求确认面板披露“外接球由内核”，该文本仅存在于 `apps/web/src/agent/representativeFixtures.ts:357`，生产确认面板实际只有底面和顶点假设。

前两条需要产品侧决定是恢复旧行为还是更新契约；第三条属于生产披露缺失，不能只修改测试文字使其变绿。

### 5.9 M9：E2E 与生产 UI 漂移，形成“单测全绿、浏览器路径断裂”

**位置示例：**

- `e2e/next-phase-flag-entry.spec.ts:76`
- `e2e/solid-prism.spec.ts:301`
- `apps/web/src/components/AppChrome.tsx:74-100`
- `apps/web/src/components/WorkspaceTabs.tsx`
- `apps/web/src/components/WorkspaceTabs.test.tsx`

**置信度：高。**

生产界面已使用 `AppChrome` 和“模型服务”，上述旧用例仍等待“设置”；保存用例仍等待 `navigation[name="工作模式"]`，而生产保存按钮位于新的 header 中。`WorkspaceTabs` 不再用于 `App.tsx`，但其组件测试仍保留并通过。

两轮均有 21 次“等待设置”和 11 次“等待工作模式导航”的直接签名；另有“添加立方体”“透明面”“由选中点创建空间平面”等旧控件/流程定位器。

应先建立当前 UI 的可访问契约并统一 Page Object/命令入口，再区分产品回归与测试过时，不能仅通过放宽超时掩盖。

### 5.10 M10：CI 未声明最小 token 权限

**位置：**`.github/workflows/ci.yml`

**置信度：中。**

工作流没有任何 `permissions:`，因此继承仓库或组织默认值。若默认值较宽，供应链步骤被攻破后的影响会扩大。

建议在顶层设置：

```yaml
permissions:
  contents: read
```

需要额外权限的 job 再单独提升。当前未使用 `pull_request_target`、`workflow_run` 或 `issue_comment`，也未发现直接把 PR 标题/正文插入 shell 的表达式。

### 5.11 M11：开发工具链锁定版本含已知公告

**位置：**`package-lock.json`

**置信度：高（公告存在）；实际利用条件依工具使用场景而定。**

- 全量 `npm audit`：3 high、11 moderate，共 14 项。
- `npm audit --omit=dev`：0。
- 重点包括 Vite 7.3.6、Vitest/@vitest/mocker 4.1.11、source-map-js 1.2.1、zod 4.6.5、minimatch 10.2.6，以及相关 ESLint/typescript-eslint 传递链。
- CI 的 `npm ci` 会安装锁文件中的受影响版本，即使本机已存在较新版本。

建议在独立变更中更新直接包与锁文件，再执行 `npm audit`、干净 `npm ci` 和完整 CI；不要使用 `--force` 或忽略审计来掩盖。

## 6. LOW：加固项与测试缺口

| 编号 | 发现 | 位置 | 建议 | 置信度 |
| --- | --- | --- | --- | --- |
| L1 | 发布的工具 schema 与运行时约束不一致：空 `actionKey`、空白 normalisation 可被 provider 接受后被运行时拒绝。 | `apps/web/src/agent/modelPlanner.ts:227-247`、`packages/agent-core/src/schemas.ts:172-177` | 共用叶子约束，增加 Ajv 与 runtime 差分测试。 | 高 |
| L2 | 可靠性评测可在任意轮次找到目标答案，旧答案可能替最终错误答案通过。 | `apps/web/src/agent/fixtures/reliabilityEval.eval.test.ts:307` | 只检查最终接受的计划或显式 staged plan，增加两轮反例。 | 高 |
| L3 | 附件在 32 MiB 上限检查前已完成 base64 输入和输出缓冲分配。 | `apps/desktop/src-tauri/src/commands/repository.rs:158`、`:337-354` | 先检查编码长度，再检查解码长度；前端在 `FileReader` 前也限长。 | 高 |
| L4 | 第一方 Action 未固定 SHA，checkout 默认保留 token；属于低权限 job 的加固缺口。 | `.github/workflows/ci.yml:37` 等 | 固定全部 Action；不需要推送时设 `persist-credentials: false`。 | 高 |
| L5 | 首屏主包 2.43 MB（gzip 732 KB），worker 692 KB；Agent 与 Three.js 静态进入主包。 | `apps/web/src/App.tsx:40`、`:52`，构建输出 | 按模块懒加载，消除无效动态导入并复核分包；先测首屏再定阈值。 | 中 |

另：Lint 有 16 个未使用代码警告，虽无 error，仍应清理以避免真实问题被噪声淹没。

## 7. INFO：基线、环境与验证边界

1. **基线落后：**本地 `main` 落后 `origin/main` 47 个提交，上游包含 Agent/E2E 相关后续提交。开始修复前应先确定目标基线，避免重复工作。
2. **环境不一致：**本机混有 pnpm/npm 安装痕迹；`npm ls --depth=0` 有大量 extraneous；`npm ci --dry-run --ignore-scripts` 显示会更换 12 个直接包。Node 26.3.0 与 CI Node 22 也不同。
3. **覆盖限制：**RustSec 未验证；未运行真实付费 provider、安装/冷机验收、破坏性恶意包、DNS rebinding 或恶意 TLS 服务。未额外复跑离线 eval/perf 脚本，不能把历史分数当成本轮读数。

## 8. 依赖与密钥扫描详情

### 8.1 依赖

| 范围 | 结果 |
| --- | --- |
| 全量依赖 | 14 项公告：3 high、11 moderate |
| 生产依赖（`--omit=dev`） | 0 项 |
| 锁文件一致性 | `npm ci --dry-run --ignore-scripts` 可解析，但会更换本机 12 个直接包 |
| Rust 依赖 | `cargo-audit` 不可用，未作当前 RustSec 结论 |

重点公告链：

- Vite：多个 launch-editor、custom middleware 与 fs.allow 公告；
- Vitest / @vitest/mocker：手工 mock 注册与 Windows 路径穿越公告；
- source-map-js：索引 source-map section offset 导致事件循环 DoS；
- zod：超大受限集合校验导致内存耗尽；
- minimatch：globparts 放大导致 DoS；
- ESLint / typescript-eslint：经上述传递依赖受影响。

### 8.2 密钥与暴露面

- 未发现受跟踪的 `.env`、私钥、证书库或真实 provider key。
- 命中的 `sk-...` 均为测试夹具。
- `AKIAIOSFODNN7EXAMPLE` 是公开的 AWS 示例值，且出现在密钥扫描器自身测试中。
- 长字符串命中为 Base64 字符表、技能内容哈希或测试内容，不是凭据。
- `.gitignore` 已覆盖 `.env`、`.env.*`、构建产物和常见测试输出。

## 9. 验证结果

| 命令/检查 | 本轮结果 | 说明 |
| --- | --- | --- |
| `npm run typecheck` | 通过 | 全部 workspaces、e2e、scripts |
| `npm run lint` | 0 error / 16 warning | 均为未使用代码 |
| `npm test` | 519 文件，5535 passed，1 todo | 使用本机 Vitest 4.1.12；锁文件为 4.1.11 |
| `npm run test:docs` | 22 passed | 文档一致性门禁 |
| `npm run build` | 通过 | 桌面 no-bundle 与全部 workspaces；主包/Worker 有体积警告 |
| `npm run test:rust` 首次 | 失败 | 与 E2E 并行时链接器 `LNK1102: 内存不足`，不是产品测试断言失败 |
| `npm run test:rust` 串行重跑 | 280 passed，4 ignored | 0 failed |
| `npm run test:e2e` 第一轮 | 235 passed，46 failed | 并行 Rust 构建同时进行 |
| `npm run test:e2e` 第二轮 | 232 passed，49 failed | 原 46 项复现，新增 3 项 |
| 六组失败定向、单 worker | 10 passed，3 failed | 圆锥曲线和约束拖动恢复；外接球披露、属性栏宽度、网格淡出稳定失败 |
| `npm audit` | 14 项 | 全部开发工具链 |
| `npm audit --omit=dev` | 0 项 | 无生产依赖公告结论 |
| `git diff --check` | 通过 | 无空白错误 |

### 9.1 对 E2E 失败的正确解读

- 不能把 46/49 项全部称为产品回归：大量失败直接等待不存在的旧定位器。
- 也不能把它们全部称为环境问题：外接球披露、属性栏契约和网格淡出可稳定复现。
- 单 worker 后部分用例恢复，说明 `fullyParallel: true` 下存在时序/资源敏感性。
- 在修复定位器与稳定契约前，完整 E2E 不能作为发布门禁通过证据。

## 10. 既有 36 题真实基线

以下来自 `docs/audit/2026-11-15-drawing-baseline/README.md` 的保存证据，不是本轮重新评测：

| 指标 | 基线 |
| --- | ---: |
| 完成评测 | 36/36；平面 18、立体 18 |
| 有草稿 | 25/36（69.4%） |
| 旧宿主 passed / awaiting confirmation | 均 4/36（11.1%） |
| 独立局部 oracle exact | 8/36；只覆盖部分条件 |
| 失败 | compiling 11、validating 21 |
| 完整题设证书 | 不存在，不能简写为 0% |
| 正式 native 请求 / 主场景写入 | 101 / 0 |

这说明工程测试数量与真实任务成功率是不同指标。整改应先建立逐题黄金合同、来源链和独立完整验收，再提高模型/构造能力；不应先增加重试或放宽门禁。

## 11. 建议修复顺序与退出条件

### P0：确定基线并阻断错误放行

1. 决定继续当前 59ea3613 还是迁移到上游新基线，记录差异。
2. 修复小问条件丢失，加入违反第二问条件的负例。
3. 暂停将当前版本标记为发布候选。

**退出条件：**所有未选择小问的多问题目均 fail-closed；错误候选无法获得 `passed` 或进入确认。

### P1：修复桌面高危边界

1. 凭据引用绑定 profile 与 endpoint；endpoint 变更走原生 rekey。
2. 导出写入移动到原生授权路径或应用导出根目录。
3. 项目包增加聚合大小预算和重叠条目测试。
4. 同步修复 IPv6/DNS SSRF 与非 2xx 响应限长。

**退出条件：**新增安全负例通过；合法 provider 与项目包往返不回归；不运行破坏性本机 PoC 作为通过条件。

### P2：恢复可信测试与数据保护

1. 统一当前 UI 可访问契约和 E2E Page Object。
2. 裁决属性栏与网格契约；补生产外接球披露。
3. 修复 CSV 公式注入、provider 凭据回滚和草稿备份失败覆盖。
4. 处理辅助曲线绑定、题图人工确认和精确坐标复核。

**退出条件：**完整 E2E 在干净环境通过；每项数据保护探针从失败转为保留原文/旧凭据或明确不可恢复警告。

### P3：CI、依赖和性能收尾

1. 设置 `permissions: contents: read`，固定 Action SHA，关闭不必要的 checkout 凭据持久化。
2. 更新开发工具链和锁文件，运行 `npm audit`、干净 `npm ci` 与完整 CI。
3. 清理 Lint 警告，修复 schema/runtime 和评测最终轮次口径。
4. 按模块拆分首屏，测量真实加载与交互性能。

**退出条件：**干净 CI 全绿，生产依赖与开发依赖审计结果明确，性能以实测数据验收。

## 12. 补丁与变更声明

本报告中的代码均为**修复建议**，未应用、未编译为补丁，也不能代替相应回归测试。请先逐条审查，再决定实现方式。

本轮没有修改产品源码、配置或既有用户文档；仅新增本报告。构建和测试使用既有的 `build-check/`、`test-results/`、`eval-results/`、Rust `target/` 等忽略目录，未把这些产物作为源码交付。

> Review each patch before applying. No source changes were applied.
