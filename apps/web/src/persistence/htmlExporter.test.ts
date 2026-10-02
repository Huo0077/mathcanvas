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

/** 取出内嵌存档那一段 JSON（`<script type="application/json">` 的内容）。 */
function embeddedArchive(html: string): string {
  const open = html.indexOf('<script type="application/json"')
  return html.slice(html.indexOf(">", open) + 1, html.indexOf("</script>", open))
}

describe("HTML snapshot exporter", () => {
  it("embeds the SVG verbatim instead of redrawing it", () => {
    const html = snapshot(planarDocument())
    expect(html).toContain(SVG)
    expect(html.match(/<svg\b/g)).toHaveLength(1)
  })

  it("has no external references, and the SVG really is in there", () => {
    const html = snapshot(planarDocument())
    // 反向对照：先证明文件里真有内嵌 SVG 与内联样式，否则"没有外链"可能只是因为文件是空的。
    expect(html).toContain("<svg")
    expect(html).toContain("<style>")
    // 注意：内嵌 SVG 的 `xmlns="http://www.w3.org/2000/svg"` 是 XML 命名空间、不是网络请求，
    // 所以判据不是"不含 http://"，而是"没有任何会去取外部资源的东西"。
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
    // 判据取"编码→解码的不动点"：`encodeMgeo` 会补默认值，拿手搭的文档直接比会因
    // 那些默认值而假红；真正要证明的是"文件里那段 JSON 就是这次导出的那份存档"。
    expect(decodeMgeo(embeddedArchive(snapshot(document)))).toEqual(decodeMgeo(encodeMgeo(document)))
  })

  it("survives a label containing a closing script tag", () => {
    const document = planarDocument()
    const html = snapshot(document)
    const embedded = embeddedArchive(html)
    // 结构不被提前闭合：内嵌 JSON 里不许出现裸的 `<`。
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
