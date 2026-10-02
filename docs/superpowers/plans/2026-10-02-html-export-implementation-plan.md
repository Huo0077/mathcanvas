# HTML 导出（自包含快照 + 可再导入存档）实施计划

> **状态：5 个区块全部交付，并随 [`v3.2.0`](../../release/v3.2.0.md) 打包发布**（提交链：`59eb3be` → `22b1f9c` → `5291c5c`；tag `v3.2.0` → Release 已发布、三件资产重下载哈希全部 MATCH）。每个区块的门禁读数与变异检查都写在对应 Task 的状态行里。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让用户从导出菜单拿到一个单文件 `.html`：双击即开、零外部引用、内嵌既有 SVG 产出器的产物与"这次漏了什么"，并且内嵌 `.mgeo` 使它同时是可再导入的存档；立体几何必须**明确拒绝**而不是吐一张空图。

**Architecture:** 新增一个**纯函数**产出器 `htmlExporter.ts`（收文档 + 已算好的 SVG + 损失条目 + 版本戳，吐字符串），由既有导出路径 `fileExports.ts` 组装：按工作区选 `exportSvg` 或 `exportEngineeringSvg`，工作区为 `geometry3d` 时经 `setFileError` 明确拒绝。命令层与功能区各加一条 `export-html`，**Agent 的导出通道刻意保持四个格式不变**。

**Tech Stack:** TypeScript（strict）、React 19、Vitest（单测，`apps/**` 与 `packages/**` 在 include 里）、Playwright（e2e，`e2e/` 不在 vitest include 里）、`@draw/dsl` 的 `encodeMgeo` / `decodeMgeo`。

**Spec:** `docs/superpowers/specs/2026-10-02-html-export-design.md`（本计划从它论证；实施时两份都要读）

## Global Constraints

- **不加新依赖**；`persistence/engineeringExporters` 仍是**动态** `import()` —— 它是 429 kB（gzip 178 kB），提到顶层会让入口 chunk 立刻胖回去（成因见 `fileExports.ts` 顶部注释）。
- **转义是硬约束**：一切文档派生文本进 HTML 前转义 `&` / `<` / `>` / `"`；内嵌 JSON 把 `<` 写成 `\u003c`（用户标签里可以出现 `</script>`，那是注入）。
- **不静默半死**：工作区不支持就**报错**，不产出空文件；有损失就把损失写进**文件正文**。
- **勾选纪律**：只有真正跑过、看到绿的门禁才在本计划里打勾。
- **注释与文案**：只用 ASCII 空格（`no-irregular-whitespace`）；中文文案直接写中文。
- **文件名**：沿用 `downloadBlob` 的规则（空白折成 `-`），扩展名 `html`。
- **版本戳**：桌面外壳给真版本（`tauri.conf.json` 的 `version`），浏览器里**如实写 `unknown`**，不编号、不省略。

## File Structure

| 文件 | 责任 |
| --- | --- |
| `apps/web/src/persistence/htmlExporter.ts`（新建） | **纯函数**：转义、损失条目收集、HTML 拼装。不碰 DOM、不下载、不读全局 |
| `apps/web/src/persistence/htmlExporter.test.ts`（新建） | 上者的全部判据（§6 证据表里"平面/自包含/存档/诚实性/注入"五行） |
| `apps/web/src/persistence/fileExports.ts`（改） | 组装：选 SVG 产出器、工作区拒绝、读版本戳、交给浏览器下载 |
| `apps/web/src/persistence/fileExports.test.ts`（改） | 3D 拒绝 + 平面产出 + CAD 走工程产出器 |
| `apps/web/src/services/exportService.ts`（改） | 只加一个 `isUnexportableType` 导出 —— 让"画不出来"的那张类型表**只有一份** |
| `apps/web/src/ribbonCommands.ts`（改） | 两个工作区分支各加 `export-html` |
| `apps/web/src/commandDispatch.ts`（改） | 依赖注入类型 + 功能区表 + CAD 表各加一条分派 |
| `apps/web/src/App.tsx`（改） | `exportHtmlFile` 包装并注入 dispatch |
| `apps/web/src/components/GeometryToolbar.tsx`（改） | prop 类型 + 按钮 |
| `apps/web/src/ribbonCommands.test.ts` / `commandDispatch.test.ts`（改） | 顺序/分派断言按新命令更新 |
| `packages/agent-core/src/tools/interactionTools.test.ts`（改） | **钉住 Agent 的格式联合仍是四个**（有意的不做） |
| `e2e/html-export.spec.ts`（新建） | 浏览器里真的导出、真的打开、3D 真的被拒 |

---

### Task 1: HTML 快照产出器（纯函数）

> **状态：已完成（2026-10-02，提交 `6d28578`）。** 下面七个 Step 按写的那样执行过；读数：`htmlExporter.test.ts` **9/9**（RED = `Failed to resolve import "./htmlExporter"`，模块不存在）、`npm run typecheck` exit 0、定向 eslint exit 0。**变异检查**：同时去掉 `escapeHtmlText` 与 `escapeJsonForScript` → **3 条红**（注入那条把内嵌存档提前截断，正是它要防的症状），变异已恢复。
> 各 Step 前面的 `- [ ]` 会在本计划收口（Task 5）时统一回填勾选，避免分两次改同一份文件的同一段。

**Files:**
- Create: `apps/web/src/persistence/htmlExporter.ts`
- Create: `apps/web/src/persistence/htmlExporter.test.ts`
- Modify: `apps/web/src/services/exportService.ts`（在 `UNEXPORTABLE_TYPES` 之后加一个导出函数）

**Interfaces:**
- Consumes: `encodeMgeo` / `decodeMgeo`（`@draw/dsl`）；`GeometryDocument["workspace"]`
- Produces:
  - `HTML_SNAPSHOT_FORMAT_VERSION: 1`
  - `interface HtmlOmission { sourceId: string; kind: string; reason: string }`
  - `collectHtmlOmissions(document: GeometryDocument): HtmlOmission[]`
  - `escapeHtmlText(value: string): string`
  - `escapeJsonForScript(json: string): string`
  - `interface HtmlSnapshotInput { document; svg; omissions; approximationNotes; appVersion; exportedAt }`
  - `exportHtmlSnapshot(input: HtmlSnapshotInput): string`
  - `isUnexportableType(type: string): boolean`（`exportService` 导出）

- [x] **Step 1: 先加"画不出来"的唯一判据（`exportService`）**

在 `apps/web/src/services/exportService.ts` 的 `UNEXPORTABLE_TYPES` 常量之后加：

```ts
/**
 * 这一类图元**投影不出来、导出器也不画**。
 *
 * 导出成函数而不是把那个 `Set` 暴露出去：调用方只该问"这一类算不算漏"，
 * 不该能改这张表。`htmlExporter` 的"这次漏了什么"复用**同一份**规则 ——
 * 两处各写一张表必然分叉，而分叉的症状是"界面说有损失、文件里说没有"。
 */
export function isUnexportableType(type: string): boolean {
  return UNEXPORTABLE_TYPES.has(type)
}
```

- [x] **Step 2: 写失败的测试**

创建 `apps/web/src/persistence/htmlExporter.test.ts`：

```ts
import { createEmptyDocument, decodeMgeo, encodeMgeo, type GeometryDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { HTML_SNAPSHOT_FORMAT_VERSION, collectHtmlOmissions, exportHtmlSnapshot } from "./htmlExporter"

/** 一份有内容、有标注、名字里带需要转义字符的平面文档。 */
function planarDocument(name = "我的 图 <script>alert(\"x\")</script>"): GeometryDocument {
  const document = createEmptyDocument("conics")
  document.metadata.name = name
  document.primitives.push({ id: "point-1", type: "point", x: 1, y: 2, label: "A & B", binding: { kind: "free" } } as GeometryDocument["primitives"][number])
  // AnnotationSpec 的字段是 `target`（不是 targetId）—— 实测 packages/dsl/src/types.ts:928-937。
  document.annotations.push({ id: "annotation-1", text: "角 A = 60° & </script>", target: "point-1", visible: true } as GeometryDocument["annotations"][number])
  return document
}

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><line x1="0" y1="0" x2="1" y2="1" /></svg>'

function snapshot(document: GeometryDocument, overrides: Partial<Parameters<typeof exportHtmlSnapshot>[0]> = {}) {
  return exportHtmlSnapshot({
    document,
    svg: SVG,
    omissions: [],
    approximationNotes: [],
    appVersion: "3.1.0",
    exportedAt: new Date("2026-10-02T12:00:00Z"),
    ...overrides
  })
}

describe("HTML snapshot exporter", () => {
  it("embeds the SVG verbatim instead of redrawing it", () => {
    const html = snapshot(planarDocument())
    expect(html).toContain(SVG)
    expect(html.match(/<svg\b/g)).toHaveLength(1)
  })

  it("has no external references, and the SVG really is in there", () => {
    const html = snapshot(planarDocument())
    // 反向对照：先证明文件里真有内嵌 SVG 与内联样式，否则"没有外链"是因为文件是空的。
    expect(html).toContain("<svg")
    expect(html).toContain("<style>")
    expect(html).not.toMatch(/<link\b/i)
    expect(html).not.toMatch(/<script[^>]*\bsrc=/i)
    expect(html).not.toMatch(/(?:src|href)\s*=\s*["']https?:/i)
    expect(html).not.toMatch(/@import/i)
  })

  it("keeps the embedded SVG free of id attributes", () => {
    const html = snapshot(planarDocument())
    const svg = html.slice(html.indexOf("<svg"), html.indexOf("</svg>"))
    expect(svg).not.toMatch(/\bid="/)
  })

  it("round-trips the embedded mgeo back to an equal document", () => {
    const document = planarDocument()
    const html = snapshot(document)
    const embedded = html.slice(html.indexOf(">", html.indexOf('<script type="application/json"')) + 1, html.indexOf("</script>"))
    // 判据取"编码→解码的不动点"：`encodeMgeo` 会补默认值，拿手搭的文档直接比会因
    // 那些默认值而假红；真正要证明的是"文件里那段 JSON 就是这次导出的那份存档"。
    expect(decodeMgeo(embedded)).toEqual(decodeMgeo(encodeMgeo(document)))
  })

  it("survives a label containing a closing script tag", () => {
    const document = planarDocument()
    const html = snapshot(document)
    // 结构不被提前闭合：内嵌 JSON 里不许出现裸的 `<`。
    const embedded = html.slice(html.indexOf(">", html.indexOf('<script type="application/json"')) + 1, html.indexOf("</script>"))
    expect(embedded).not.toContain("<")
    expect(html).toContain("\\u003c")
    // 解回来的标签一字不差。
    const restored = decodeMgeo(embedded)
    expect(restored.annotations[0]?.text).toBe("角 A = 60° & </script>")
    expect(restored.metadata.name).toBe(document.metadata.name)
  })

  it("escapes document-derived text in the body", () => {
    const html = snapshot(planarDocument())
    expect(html).toContain("&lt;script&gt;")
    expect(html).not.toContain("<script>alert")
  })

  it("lists the omissions in the file and says so explicitly when there are none", () => {
    const withLoss = snapshot(planarDocument(), { omissions: [{ sourceId: "locus-1", kind: "locus", reason: "这一类不在 SVG 导出器的作图范围内" }] })
    expect(withLoss).toContain("locus-1")
    expect(withLoss).toContain("这一类不在 SVG 导出器的作图范围内")
    expect(snapshot(planarDocument())).toContain("无")
  })

  it("collects hidden objects and undrawable types as omissions", () => {
    const document = planarDocument()
    document.primitives.push({ id: "point-hidden", type: "point", x: 0, y: 0, visible: false, binding: { kind: "free" } } as GeometryDocument["primitives"][number])
    document.primitives.push({ id: "locus-1", type: "locus", sourcePointId: "point-1", parameterId: "parameter-1" } as GeometryDocument["primitives"][number])
    expect(collectHtmlOmissions(document).map((entry) => entry.sourceId)).toEqual(["point-hidden", "locus-1"])
  })

  it("writes the format version and the app version, including the unknown case", () => {
    expect(snapshot(planarDocument())).toContain(`格式版本 ${HTML_SNAPSHOT_FORMAT_VERSION}`)
    expect(snapshot(planarDocument())).toContain("应用版本 3.1.0")
    // 浏览器里拿不到桌面桥，必须如实写 unknown，而不是编号或省略。
    expect(snapshot(planarDocument(), { appVersion: "unknown" })).toContain("应用版本 unknown")
  })
})
```

- [x] **Step 3: 运行测试，确认失败**

Run: `npx vitest run apps/web/src/persistence/htmlExporter.test.ts`
Expected: FAIL —— `Failed to resolve import "./htmlExporter"`（模块还不存在）。

- [x] **Step 4: 写实现**

创建 `apps/web/src/persistence/htmlExporter.ts`：

```ts
import { encodeMgeo, type GeometryDocument } from "@draw/dsl"

import { isUnexportableType } from "../services/exportService"

/**
 * **HTML 导出**（自包含快照 + 可再导入存档）。
 *
 * 一个**纯函数**产出器：收一份文档、一段已经算好的 SVG、损失条目与版本戳，吐一个字符串。
 * 它不碰 DOM、不下载、不读全局 —— 所以"漏了什么怎么说""注入怎么防"这些能直接单测，
 * 而"按哪个工作区选哪个 SVG 产出器"留给 `fileExports`（那是路由，不是渲染）。
 *
 * 为什么内嵌既有 SVG 产出器的产物而不是重画：重画一份就多一份会与画布分叉的几何代码，
 * 而验收判据里"与 `exportSvg` 逐字一致"这条也就没法成立了。
 */

/** 产物格式版本：**一旦发布就不该随意改**，改了要按版本号区分，否则老文件认不出（spec §8）。 */
export const HTML_SNAPSHOT_FORMAT_VERSION = 1

export interface HtmlOmission {
  sourceId: string
  kind: string
  reason: string
}

/**
 * "这次导出漏了什么"。
 *
 * 两类：**被隐藏的对象**（导出器不画隐藏图元）与**导出器画不出来的类型**
 * （复用 `exportService` 那张表，见 `isUnexportableType` 的注释）。
 * 有损失必须写进文件正文 —— 收件人拿到的是图，他有权知道少了什么（spec §5.3）。
 */
export function collectHtmlOmissions(document: GeometryDocument): HtmlOmission[] {
  const omissions: HtmlOmission[] = []
  for (const primitive of document.primitives) {
    if (primitive.visible === false) {
      omissions.push({ sourceId: primitive.id, kind: primitive.type, reason: "对象被隐藏，导出器不画它" })
      continue
    }
    if (isUnexportableType(primitive.type)) {
      omissions.push({ sourceId: primitive.id, kind: primitive.type, reason: "这一类不在 SVG 导出器的作图范围内" })
    }
  }
  return omissions
}

/** 文档派生文本进 HTML 前必须走这里。 */
export function escapeHtmlText(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;")
}

/**
 * 内嵌 JSON 的转义。
 *
 * 只做一件事：把 `<` 写成 `\u003c`。原因很具体 —— 用户标签里完全可以出现 `</script>`，
 * 那会**提前闭合脚本块**，后面的文档内容就变成可执行的 HTML。这是注入，不是理论风险。
 * （`<script type="application/json">` 的内容不按 JS 解析，所以不需要再处理 `\u2028` 之类。）
 */
export function escapeJsonForScript(json: string): string {
  return json.replaceAll("<", "\\u003c")
}

const WORKSPACE_LABELS: Record<GeometryDocument["workspace"], string> = {
  calculus: "平面几何",
  conics: "平面几何",
  cad: "工程制图",
  geometry3d: "立体几何"
}

export interface HtmlSnapshotInput {
  document: GeometryDocument
  /** 已经算好的 SVG（平面几何走 `exportSvg`、工程制图走 `exportEngineeringSvg`）。 */
  svg: string
  omissions: HtmlOmission[]
  approximationNotes: string[]
  /** 桌面外壳给真版本；浏览器里是 `"unknown"`。 */
  appVersion: string
  exportedAt: Date
}

export function exportHtmlSnapshot(input: HtmlSnapshotInput): string {
  const { document, svg, omissions, approximationNotes, appVersion, exportedAt } = input
  const name = escapeHtmlText(document.metadata.name)
  const exportedAtText = exportedAt.toISOString()
  const omittedItems = omissions
    .map((entry) => `<li><code>${escapeHtmlText(entry.sourceId)}</code>（${escapeHtmlText(entry.kind)}）：${escapeHtmlText(entry.reason)}</li>`)
    .join("")
  const noteItems = approximationNotes.map((note) => `<li>${escapeHtmlText(note)}</li>`).join("")
  const losses = omissions.length === 0 && approximationNotes.length === 0
    ? "<p>无</p>"
    : `<ul>${omittedItems}${noteItems}</ul>`
  const archived = escapeJsonForScript(encodeMgeo(document))

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${name}</title>
<style>
:root { color-scheme: light; }
body { margin: 0; padding: 24px; font-family: "Segoe UI", "Microsoft YaHei", system-ui, sans-serif; color: #0f172a; background: #f8fafc; }
main { max-width: 960px; margin: 0 auto; display: flex; flex-direction: column; gap: 20px; }
h1 { font-size: 20px; margin: 0 0 6px; }
h2 { font-size: 15px; margin: 0 0 8px; }
p { margin: 0; line-height: 1.6; }
.meta { color: #475569; font-size: 13px; }
section { background: #ffffff; border: 1px solid #e2e8f0; border-radius: 10px; padding: 16px; }
figure { margin: 0; }
figure svg { width: 100%; height: auto; display: block; }
ul { margin: 0; padding-left: 20px; line-height: 1.7; }
code { font-family: Consolas, "Courier New", monospace; font-size: 12px; }
footer { color: #64748b; font-size: 12px; }
</style>
</head>
<body>
<main>
<header>
<h1>${name}</h1>
<p class="meta">导出时间：${escapeHtmlText(exportedAtText)}｜工作区：${escapeHtmlText(WORKSPACE_LABELS[document.workspace])}｜图元：${document.primitives.length}</p>
</header>
<section>
<h2>图</h2>
<figure>${svg}</figure>
</section>
<section>
<h2>这次导出漏了什么</h2>
${losses}
</section>
<section>
<h2>怎么再打开</h2>
<p>这份文件同时是一份存档：把它拖回 MathCanvas（或放进「打开 .mgeo 文件」）就能原样打开，标签、样式与参数都在。</p>
<script type="application/json" id="mathcanvas-mgeo">${archived}</script>
</section>
<footer>格式版本 ${HTML_SNAPSHOT_FORMAT_VERSION}｜应用版本 ${escapeHtmlText(appVersion)}</footer>
</main>
</body>
</html>
`
}
```

- [x] **Step 5: 运行测试，确认通过**

Run: `npx vitest run apps/web/src/persistence/htmlExporter.test.ts`
Expected: PASS（9 项）。

- [x] **Step 6: 类型检查与 lint**

Run: `npm run typecheck` → exit 0；`npx eslint apps/web/src/persistence/htmlExporter.ts apps/web/src/persistence/htmlExporter.test.ts apps/web/src/services/exportService.ts` → exit 0。

- [x] **Step 7: 提交**

```bash
git add apps/web/src/persistence/htmlExporter.ts apps/web/src/persistence/htmlExporter.test.ts apps/web/src/services/exportService.ts
git commit -m "feat(web): HTML 快照产出器（纯函数）+ 复用同一张不可导出类型表"
```

---

### Task 2: 导出路径组装（含立体几何明确拒绝）

> **状态：已完成（2026-10-02，提交 `fc4df43`）。** 读数：`fileExports.test.ts` **9/9**（6 旧 + 3 新；RED = `exports.exportHtmlFile is not a function`）、`npm run typecheck` exit 0、定向 eslint exit 0。**变异检查**：去掉 `geometry3d` 拒绝分支 → 红在 `expected [ '我的-图纸.html' ] to deeply equal []`（正是"静默半死"的症状），变异已恢复。
> **一处与计划不同（jsdom 限制）**：Step 1 的测试代码里 `await blobs[0]!.text()` 在本仓库的 jsdom 下**不可用**（`Blob` 没有 `text()`，`App.test.tsx:1962` 记过同一件事）；实际用了一个 `readBlob()`（`FileReader`）辅助函数。CAD 那条夹具还要给全 `projectionLines` / `annotations`（`svgDrawing` 会对它们 `.map`），否则会崩在 `undefined.map`。

**Files:**
- Modify: `apps/web/src/persistence/fileExports.ts`
- Modify: `apps/web/src/persistence/fileExports.test.ts`

**Interfaces:**
- Consumes: `exportHtmlSnapshot` / `collectHtmlOmissions`（Task 1）、`readDesktopRuntime`（`../services/desktopRuntime`）、`exportSvg`、动态 `import("./engineeringExporters")`
- Produces: `FileExports.exportHtmlFile(): Promise<void>`

- [x] **Step 1: 写失败的测试**

在 `apps/web/src/persistence/fileExports.test.ts` 的 `describe` 里追加：

```ts
  it("refuses HTML export in the 3D workspace and downloads nothing", async () => {
    const exports = harness(() => document3d("我的 图纸"))
    await exports.exportHtmlFile()

    // 判据是"什么都没发生 + 说清为什么"，不是"文件是空的"。
    expect(downloads).toEqual([])
    expect(blobs).toEqual([])
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain("立体几何")
  })

  it("writes a self-contained HTML snapshot for a planar document", async () => {
    const document = createEmptyDocument("conics")
    document.metadata.name = "我的 平面图"
    const exports = harness(() => document)

    await exports.exportHtmlFile()

    expect(downloads).toEqual(["我的-平面图.html"])
    expect(errors).toEqual([null])
    const html = await blobs[0]!.text()
    expect(html).toContain("<svg")
    expect(html).toContain("格式版本 1")
    // 浏览器里没有桌面桥：版本戳必须如实写 unknown。
    expect(html).toContain("应用版本 unknown")
  })

  it("uses the engineering SVG and reports drawing diagnostics for the CAD workspace", async () => {
    const document = createEmptyDocument("cad")
    document.metadata.name = "工程图"
    const drawings = [{ view: "front", primitives: [], diagnostics: ["轮廓按采样折线写出"] }] as unknown as ProjectedDrawing[]
    const exports = createFileExports({
      getDocument: () => document,
      getExportableDrawings: () => drawings,
      setFileError: (message) => { errors.push(message) }
    })

    await exports.exportHtmlFile()

    expect(downloads).toEqual(["工程图.html"])
    const html = await blobs[0]!.text()
    // 四视图标签来自工程 SVG 产出器；这里只喂了一张图，所以断言的是"走的是工程那条路"。
    expect(html).toContain("front")
    expect(html).toContain("轮廓按采样折线写出")
  })
```

- [x] **Step 2: 运行测试，确认失败**

Run: `npx vitest run apps/web/src/persistence/fileExports.test.ts`
Expected: FAIL —— `exports.exportHtmlFile is not a function`。

- [x] **Step 3: 写实现**

在 `apps/web/src/persistence/fileExports.ts` 里：

顶部 import 补两行：

```ts
import { collectHtmlOmissions, exportHtmlSnapshot } from "./htmlExporter"
import { readDesktopRuntime } from "../services/desktopRuntime"
```

`FileExports` 接口补一个方法：

```ts
export interface FileExports {
  save(): void
  exportSvgFile(format?: VectorExportFormat): Promise<void>
  exportCsvFile(): void
  exportPngFile(): void
  exportHtmlFile(): Promise<void>
}
```

并在 `export type ExportFormat = "svg" | "dxf" | "pdf"` 处改成：

```ts
/** 矢量导出器认的三种格式。**不含 `html`** —— HTML 走自己的函数（见 `exportHtmlFile`），
 *  否则 `exportSvgFile("html")` 会在类型上合法、实际却导出一份 SVG。 */
export type VectorExportFormat = "svg" | "dxf" | "pdf"
/** 导出菜单上出现过的全部格式（供命令层与文档引用）。 */
export type ExportFormat = VectorExportFormat | "html"
```

`exportSvgFile` 的签名同步改成 `(format: VectorExportFormat = "svg")`，并在 `exportPngFile` 之后加：

```ts
  /**
   * **HTML 快照**（自包含 + 可再导入存档）。
   *
   * 路由在这里而不在产出器里：按工作区选 `exportSvg` 还是 `exportEngineeringSvg`、
   * 以及"立体几何明确拒绝"，都是**前置条件**，与 DXF / PDF 那条"只在 CAD 工作区有意义"同一族。
   *
   * 立体几何必须拒绝而不是照平面导出器走：`exportSvg` **刻意不投影 3D 图元**
   * （`exporters.test.ts` 有断言），照走会得到"导出成功、HTML 里只有一个坐标网格"——
   * 正是本仓库最讨厌的静默半死。
   */
  const exportHtmlFile = async () => {
    try {
      const document = getDocument()
      if (document.workspace === "geometry3d") {
        setFileError("立体几何画面的 HTML 导出不在本批范围：3D 画布是 WebGL，没有矢量产出器，导出的会是一张空图。请在平面几何或工程制图里导出。")
        return
      }
      const isCad = document.workspace === "cad"
      const drawings = isCad ? getExportableDrawings() : []
      const svg = isCad
        ? (await import("./engineeringExporters")).exportEngineeringSvg(drawings)
        : exportSvg(document)
      // 桌面外壳给真版本；浏览器里 `info` 是 null，如实写 unknown（不编号、也不省略）。
      const runtime = await readDesktopRuntime()
      const appVersion = runtime.ok && runtime.info ? runtime.info.appVersion : "unknown"
      const html = exportHtmlSnapshot({
        document,
        svg,
        omissions: collectHtmlOmissions(document),
        approximationNotes: drawings.flatMap((drawing) => drawing.diagnostics.map((note) => `${drawing.view}: ${note}`)),
        appVersion,
        exportedAt: new Date()
      })
      download(html, "text/html;charset=utf-8", "html")
      setFileError(null)
    } catch (error) { reportFileError(error, "无法导出 HTML 文件") }
  }
```

返回值那行改成：

```ts
  return { save, exportSvgFile, exportCsvFile, exportPngFile, exportHtmlFile }
```

- [x] **Step 4: 运行测试，确认通过**

Run: `npx vitest run apps/web/src/persistence/fileExports.test.ts`
Expected: PASS（原有全部 + 新增 3 项）。若既有用例因 `ExportFormat` 改名而报类型错，同步改它们的引用即可（`apps/web/src/persistence/fileExports.test.ts` 与 `apps/web/src/commandDispatch.ts` 是仅有的两处）。

- [x] **Step 5: 类型检查与 lint**

Run: `npm run typecheck` → exit 0；`npx eslint apps/web/src/persistence/fileExports.ts apps/web/src/persistence/fileExports.test.ts` → exit 0。

- [x] **Step 6: 提交**

```bash
git add apps/web/src/persistence/fileExports.ts apps/web/src/persistence/fileExports.test.ts
git commit -m "feat(web): HTML 导出接入文件导出路径，立体几何明确拒绝"
```

---

### Task 3: e2e —— 先看着它红（菜单里还点不到）

> **状态：已完成（2026-10-02）。** RED **观察到了**：接线前三条红法一致 —— `waiting for getByRole('button', { name: '导出 HTML' })` 30 秒超时。**与计划的差异（Step 3 是"可选"）**：这条红着的 spec **没有单独提交**，而是与 Task 4 的接线合并成一笔（`59eb3be`）—— 避免历史里留一个"提交即红"的状态。CAD 那条的断言按实测写成了 `data-drawing-view`（见本计划"自我复核"里记的那处更正）。

**Files:**
- Create: `e2e/html-export.spec.ts`

**Interfaces:**
- Consumes: 功能区命令标签 `导出 HTML`（Task 4 才加）；夹具 `e2e/fixtures/planar-demo.mgeo`、`e2e/fixtures/cad-dimension.mgeo`；`role="alert"` 错误条（`App.tsx` 的 `.footer-note`）

- [x] **Step 1: 写失败的 e2e**

创建 `e2e/html-export.spec.ts`：

```ts
import { readFile } from "node:fs/promises"

import { expect, test } from "@playwright/test"

/**
 * **HTML 导出**（自包含快照 + 可再导入存档）。
 *
 * 三条判据都由浏览器给：① 平面几何导出后文件里真有内嵌 SVG、且零外链；
 * ② 把它当普通网页打开，图看得见；③ 立体几何**明确拒绝**且不产生下载。
 * 单测已经钉住转义与存档往返（`apps/web/src/persistence/htmlExporter.test.ts`），
 * 这里只管"用户点得到、点完拿到的能用"。
 */
test("exports a self-contained HTML snapshot of a planar figure", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/planar-demo.mgeo")

  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 HTML", exact: true }).click()
  const file = await download
  expect(file.suggestedFilename()).toMatch(/\.html$/)

  const path = await file.path()
  const html = await readFile(path, "utf8")
  expect(html).toContain("<svg")
  expect(html).toContain('type="application/json"')
  // 零外部引用：没有外链样式、没有带 src 的 script、没有指向网络的 src/href、没有 @import。
  expect(html).not.toMatch(/<link\b/i)
  expect(html).not.toMatch(/<script[^>]*\bsrc=/i)
  expect(html).not.toMatch(/(?:src|href)\s*=\s*["']https?:/i)
  expect(html).not.toMatch(/@import/i)
  // 把文件当普通网页打开：图真的画出来了。
  await page.setContent(html)
  await expect(page.locator("svg")).toBeVisible()
  await expect(page.getByRole("heading", { level: 2, name: "这次导出漏了什么" })).toBeVisible()
})

test("exports the four CAD views as a self-contained HTML snapshot", async ({ page }) => {
  await page.goto("/")
  await page.locator('input[type="file"]').setInputFiles("e2e/fixtures/cad-dimension.mgeo")
  await page.getByRole("button", { name: "跳转到工程制图" }).click()

  const download = page.waitForEvent("download")
  await page.getByRole("button", { name: "导出 HTML", exact: true }).click()
  const file = await download
  expect(file.suggestedFilename()).toBe("CAD-linear-dimension-A-B.html")
  const html = await readFile(await file.path(), "utf8")

  // 四个视图来自 `exportEngineeringSvg`。**不要断言"主视图"这类中文标签** ——
  // 实测 `svgDrawing`（engineeringExporters.ts:108）只写 `data-drawing-view="front"` 这类属性，
  // 视图的中文名（`drawingViewLabels`）不出现在导出文件里。
  for (const view of ["front", "top", "left", "axonometric"]) expect(html).toContain(`data-drawing-view="${view}"`)
  expect(html.match(/<svg\b/g)).toHaveLength(1)
})

/**
 * **立体几何必须明确拒绝**（spec §4 的硬性要求）。
 *
 * 反例很具体：照现有分支走，3D 文档会落进平面导出器的 `else`，得到一份
 * "导出成功、HTML 里只有一个坐标网格"的文件。所以判据是"报错 + 不产生下载"，
 * 不是"文件是空的"。
 */
test("refuses HTML export in the 3D workspace instead of writing an empty file", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "跳转到立体几何" }).click()

  let downloaded = false
  page.on("download", () => { downloaded = true })
  await page.getByRole("button", { name: "导出 HTML", exact: true }).click()

  await expect(page.getByRole("alert")).toContainText("立体几何")
  expect(downloaded).toBe(false)
})
```

- [x] **Step 2: 运行，确认失败**

Run: `npx playwright test e2e/html-export.spec.ts --reporter=line`
Expected: FAIL —— 三条都红在 `getByRole("button", { name: "导出 HTML" })` 找不到元素（命令还没接）。**把这次红的输出记下来**：它是这组用例的 RED 证据。

- [ ] **Step 3: 提交这个红着的 spec（可选但推荐）** —— **未单独做（有意）**：这条红 spec 与 Task 4 的接线合并成一笔提交（`59eb3be`），避免历史里留一个"提交即红"的状态。RED 本身观察到了并记在 Task 3 的状态行里。

```bash
git add e2e/html-export.spec.ts
git commit -m "test(e2e): HTML 导出的三条浏览器判据（先红：菜单里还点不到）"
```

---

### Task 4: 命令与界面接线（让 e2e 变绿）

> **状态：已完成（2026-10-02，提交 `59eb3be`）。** 读数：`e2e/html-export.spec.ts` **3/3**（先红后绿）、既有导出 e2e 回归 **11/11**、`ribbonCommands` + `commandDispatch` **19/19**、全仓 `npm run lint` **0 error / 13 warning**、`npm run typecheck` exit 0、**全库单测 279 文件 / 3195 通过 + 1 todo / 0 失败**（247 s）。
> **两点与计划不同（如实记）**：① 立体几何里这条命令**不禁用** —— spec §4 要求"点得到、点了明确拒绝"，与既有的"导出 SVG / PNG 在 3D 禁用"是两套口径，注释里写明了理由；② 顺带查实 **`GeometryToolbar` 没有被任何地方挂载**（全仓只有自身引用），所以那次 prop/按钮改动**不构成功能证据**，真实入口是功能区 —— 保留它是为了将来挂载时不用再补。

**Files:**
- Modify: `apps/web/src/ribbonCommands.ts`、`apps/web/src/commandDispatch.ts`、`apps/web/src/App.tsx`、`apps/web/src/components/GeometryToolbar.tsx`
- Modify: `apps/web/src/ribbonCommands.test.ts`、`apps/web/src/commandDispatch.test.ts`

**Interfaces:**
- Consumes: `FileExports.exportHtmlFile`（Task 2）
- Produces: 命令 id `export-html`（功能区两个工作区分支各一条）

- [x] **Step 1: 先改会因此变红的顺序断言**

`apps/web/src/ribbonCommands.test.ts` 第 33 行的精确顺序断言改成：

```ts
    expect(exports).toEqual(["export-svg", "export-dxf", "export-pdf", "export-html", "export-csv", "export-mgeo"])
```

并在同一个文件里给平面分支加一条（若尚无同类断言，就加在 CAD 那条之后）：

```ts
  it("offers HTML export in the planar workspace too", () => {
    const groups = createRibbonGroups({ ...emptyContext, workspace: "conics" })
    const exports = groups.find((group) => group.id === "export")?.commands.map((command) => command.id)
    expect(exports).toEqual(["export-svg", "export-html", "export-csv", "export-png", "export-mgeo"])
  })
```

`apps/web/src/commandDispatch.test.ts` 的 "exports through the matching format" 里加一行调用与断言：

```ts
    runCadCommand("export-html")

    expect(spies.exportHtmlFile).toHaveBeenCalledTimes(1)
```

（`harness` 的替身表里要补 `exportHtmlFile: vi.fn()`。）

- [x] **Step 2: 运行，确认失败**

Run: `npx vitest run apps/web/src/ribbonCommands.test.ts apps/web/src/commandDispatch.test.ts`
Expected: FAIL —— 顺序断言实收缺 `export-html`；`exportHtmlFile` 不是函数。

- [x] **Step 3: 接线**

`apps/web/src/ribbonCommands.ts`：CAD 分支在 `export-pdf` 之后、`export-csv` 之前插一条；平面/空间分支在 `export-svg` 之后插一条：

```ts
      command("export-html", "导出 HTML", "svg", { prompt: "导出自包含的 HTML 快照（内嵌矢量图与可再导入的存档）" }),
```

CAD 分支注意：`export-html` 对 CAD 是**可用**的（导四视图），对立体几何是**可点但会报错**（spec 要求走 `setFileError` 通道，不是把命令禁用）—— 所以**不加** `disabled`。

`apps/web/src/commandDispatch.ts`：

```ts
  exportSvgFile: (format?: "svg" | "dxf" | "pdf") => void
  exportHtmlFile: () => void
```
（`CommandDispatchDeps` 里加第二行；工厂参数解构里加 `exportHtmlFile`。）

```ts
        case "export-html": void exportHtmlFile(); break      // CAD 表
        case "export-html": void exportHtmlFile(); break      // 功能区表
```

`apps/web/src/App.tsx`：

```ts
  const exportHtmlFile = () => fileExports.exportHtmlFile()
```
并把 `exportHtmlFile` 加进 `createCommandDispatch({ ... })` 的实参（与 `exportSvgFile, exportCsvFile, exportPngFile, save` 并列）。

`apps/web/src/components/GeometryToolbar.tsx`：prop 类型与按钮各加一处：

```ts
  onExportHtml: () => void
```

```tsx
        <ToolButton label="导出 HTML" icon="svg" onClick={props.onExportHtml} />
```

- [x] **Step 4: 跑单测与 e2e，确认变绿**

Run: `npx vitest run apps/web/src/ribbonCommands.test.ts apps/web/src/commandDispatch.test.ts` → PASS
Run: `npx playwright test e2e/html-export.spec.ts --reporter=line` → PASS（3 项）
Run: `npx vitest run apps/web/src/App.test.tsx` → PASS（若 App 的替身表要求新 prop 存在，同步补上）

- [x] **Step 5: 全量门禁**

Run: `npm run typecheck` → exit 0
Run: `npm run lint` → exit 0（0 error，warning 数不高于既有基线 13）
Run: `npm test -- --maxWorkers=3` → 全绿，记下"文件数 / 用例数"
Run: `npx playwright test e2e/workbench.spec.ts e2e/engineering-drawing.spec.ts e2e/html-export.spec.ts --reporter=line` → 全绿（确认既有导出入口没被改动碰坏）

- [x] **Step 6: 提交**

```bash
git add apps/web/src/ribbonCommands.ts apps/web/src/commandDispatch.ts apps/web/src/App.tsx apps/web/src/components/GeometryToolbar.tsx apps/web/src/ribbonCommands.test.ts apps/web/src/commandDispatch.test.ts e2e/html-export.spec.ts
git commit -m "feat(web): 导出菜单接入 HTML（功能区两个分支 + 工具栏），e2e 转绿"
```

---

### Task 5: Agent 通道保持四个格式（有意的不做）+ 文档收口 + 上传

> **状态：已完成（2026-10-02）。** 钉住用例在 `packages/agent-core/src/tools/interactionTools.test.ts`（该文件 **12/12**）。**变异检查做了两次**，分别打在两处联合上：给 `proposeExport` 加 `| "html"` → `tsc` 报 `interactionTools.test.ts(149,11): Type 'true' is not assignable to type 'false'`；给 `preflight` 的 `format` 加 `| "html"` → 同样报在 `(155,11)`。**两处都拦得住**（第一次只钉 `proposeExport` 时，改 `preflight` 是**拦不住**的 —— 于是把判据扩成两条，这条教训记在这里）。变异已恢复，`interactionTools.ts` 与 HEAD 无差异。

**Files:**
- Modify: `packages/agent-core/src/tools/interactionTools.test.ts`
- Modify: `CHANGELOG.md`、`docs/current-status.md`、`docs/feature-catalog.md`、`docs/project-progress.md`
- Modify: `docs/superpowers/specs/2026-10-02-html-export-design.md`（状态行与偏差记录）

**Interfaces:**
- Consumes: 无（本任务只加判据与文档）
- Produces: 一条**被类型门禁强制执行**的钉住用例

- [x] **Step 1: 写"有意不做"的钉住用例**

在 `packages/agent-core/src/tools/interactionTools.test.ts` 追加：

```ts
  /**
   * **Agent 的导出通道保持四个格式，HTML 不在其中**（spec §9 的"有意不做"）。
   *
   * 理由：那条通道的形态是"提议导出并**把结果回给模型**"，要加 HTML 就得连带设计
   * "模型拿这份 HTML 干什么" —— 属于另一个话题。这里用**类型级**判据钉住它：
   * 谁哪天给联合加了 `"html"`，这条赋值会立刻类型不通过（`npm run typecheck` / CI 会红），
   * 而不是被后来者当成"两个联合不一致的 bug"顺手改齐。
   */
  it("keeps the agent export channel at exactly four formats", () => {
    type AgentExportFormat = Parameters<InteractionTools["proposeExport"]>[0]
    const exactlyFour: AgentExportFormat extends "svg" | "dxf" | "pdf" | "png"
      ? ("svg" | "dxf" | "pdf" | "png" extends AgentExportFormat ? true : false)
      : false = true
    expect(exactlyFour).toBe(true)
  })
```

（`InteractionTools` 类型从 `./interactionTools` 导入；该文件已有导入行，补上类型名即可。）

- [x] **Step 2: 运行，确认绿且真的会拦**

Run: `npx vitest run packages/agent-core/src/tools/interactionTools.test.ts` → PASS
**变异检查**：临时把 `interactionTools.ts` 的两处联合加上 `| "html"`，`npm run typecheck` **必须报错**（那两行赋值不再满足条件类型）；确认后**改回去**，并核对 `git diff` 里 `interactionTools.ts` 无差异。

- [x] **Step 3: 文档收口**

- `docs/superpowers/specs/2026-10-02-html-export-design.md`：状态行由"待用户审阅"改为"**已批准，实施中/已实施**"，并把两处**实测偏差**写进 §10 末尾：① 本批**没有**调用 `buildExportPlan`（它至今没接进任何用户路径，`agentRunner.ts:509` 是桩），损失清单改为复用 `exportService.isUnexportableType` + 隐藏对象 + 工程视图诊断；因此 §9 的第 7 处（`exportService` 的 `ExportFormat` 联合）**不需要**动，"只加一个导出函数"即可；② "零外部引用"的判据不能写成"不含 `http://`" —— 内嵌 SVG 的 `xmlns="http://www.w3.org/2000/svg"` 是 **XML 命名空间、不是网络请求**，判据落实为"没有 `<link>` / 没有带 `src` 的 `<script>` / 没有指向网络的 `src|href` / 没有 `@import`"。
- `CHANGELOG.md`：新增一节，写清"用户决定 + spec 批准 + 本批交付了什么 + 当次门禁读数 + 两处偏差"。
- `docs/current-status.md`：§一表格加一行 HTML 导出的单测/e2e 读数；§四 E 类第 3 项的"HTML 一半"更新为已交付（**`.ggb` 仍未启动**，保持不勾）。
- `docs/feature-catalog.md`：导出能力那条加上 HTML（自包含快照 + 可再导入存档，且**立体几何明确拒绝**）。
- `docs/project-progress.md`（归档）：新增一节，记 RED→GREEN 证据、变异检查、偏差与两处"实测才发现的坑"。

- [x] **Step 4: 全量门禁与提交推送**

Run: `npm run typecheck`、`npm run lint`、`npm test -- --maxWorkers=3`、`npx playwright test e2e/html-export.spec.ts --reporter=line` —— 全绿并记下读数。

```bash
git add -A
git commit -m "docs: HTML 导出收口（含两处实测偏差）并钉住 Agent 通道四个格式"
git push origin main
```

推送后用 `git ls-remote origin refs/heads/main` **核对远端等于本地**（本仓库网络间歇性被挡，失败就重试；**不以 push 的退出码当结论**），并看 CI 四项是否全绿。

---

## 计划的自我复核

- **spec 覆盖**：§1 验收 6 条 → Task 1（1/2/4/5/6 条）与 Task 3（第 3 条"文件正文里的损失清单"的浏览器侧）；§3 边界 → Task 4 不加立体几何支持、Task 5 不做 `.ggb`；§4 四块结构 → Task 1；§5 安全 → Task 1 的转义与 `\u003c` 用例；§6 证据表 → Task 1（5 行）/ Task 3（2 行）/ Task 4（菜单入口）/ Task 5（门禁与上传）；§7 发布边界 → Task 5 文档里写明"不等于发布新安装包"；§8 未决与风险 → 格式版本常量 + Task 5 记录；§9 落地清单 → Task 4 的第 1/2/3/4/5/6 处 + Task 5 的"第 8 处有意不动"，第 7 处按偏差① 不动；§10 三件事实 → Task 1（`name` / 自带转义）+ Task 2（版本桥与 `unknown`）。
- **复核时改掉的三处"凭印象"**（都已按实测改写）：① `AnnotationSpec` 的字段是 `target` 不是 `targetId`（`packages/dsl/src/types.ts:928`）；② 工程 SVG **不含**"主视图"这类中文标签，只有 `data-drawing-view="front"`（`engineeringExporters.ts:108`），原断言会假红；③ 存档往返的判据改成"编码→解码的不动点"，因为 `encodeMgeo` 会补默认值，拿手搭的文档直接 `toEqual` 会因默认值假红。
- **占位符扫描**：无 TBD / "类似上文"；每个代码步骤都是可粘贴的完整片段。
- **类型一致性**：`HtmlOmission`（Task 1 定义 → Task 2 使用）、`HtmlSnapshotInput` 的六个字段（Task 1 定义 → Task 2 逐字段传）、`VectorExportFormat` 与 `ExportFormat`（Task 2 定义 → Task 4 的 dispatch 用字面量联合）、`exportHtmlFile`（Task 2 产出 → Task 4 消费）三处命名前后一致。
