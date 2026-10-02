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
<p class="meta">导出时间：${escapeHtmlText(exportedAt.toISOString())}｜工作区：${escapeHtmlText(WORKSPACE_LABELS[document.workspace])}｜图元：${document.primitives.length}</p>
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
