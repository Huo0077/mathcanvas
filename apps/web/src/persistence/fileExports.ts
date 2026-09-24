import { encodeMgeo, type GeometryDocument } from "@draw/dsl"

import { exportCsv, exportSvg } from "./exporters"
import type { ProjectedDrawing } from "../projectionVisuals"

export type ExportFormat = "svg" | "dxf" | "pdf"

/**
 * **文件下载 / 导出**（从 `App.tsx` 拆出）。
 *
 * 这里是"点一下菜单、把当前文档写成某种格式"这一族动作：`.mgeo` 保存、SVG / DXF / PDF / CSV / PNG 导出。
 * 它们此前是 `App.tsx` 里的七个闭包（约 70 行），夹在属性计算与文档恢复之间 ——
 * 而它们与"文档怎么被恢复、选中了什么"没有任何关系，只是**读文档、写文件**。
 *
 * ## 依赖是**取值函数**，不是值
 *
 * 工厂收的是 `getDocument` / `getExportableDrawings` 这样的 accessor，而不是当次渲染的文档。
 * 由调用方每次现取（`() => document`），所以：
 *
 * - 命令面板在 React 之外调用这些函数时不会读到**旧闭包里的旧文档**；
 * - 导出的是"按下去那一刻"的文档，而不是"上一次渲染时"的文档。
 *
 * 这条纪律在这个项目里有前科：`agentRunner` 的确认面板曾经提交**另一个会话**的草稿，
 * 根因就是模块级单槽存了快照而不是每次现取。
 *
 * ## 重依赖不许出现在同步调用链上
 *
 * `engineeringExporters` 静态依赖 `pdf-lib`（实测 429 kB / gzip 178 kB），而 PDF 导出只发生在
 * 用户点「导出」那一刻 —— 所以下面三处都是动态 `import()`。同步 import 会把它拉进入口 chunk
 *（那正是构建警告 "Some chunks are larger than 500 kB" 的成因）。**改这个文件时不要把
 * `engineeringExporters` 提到顶层**：那样入口会立刻胖回去 430 kB。
 */

export interface FileExportDependencies {
  getDocument(): GeometryDocument
  /** 工程制图要导出的图纸（隐藏的视图已经在 `selectExportableDrawings` 里滤掉）。 */
  getExportableDrawings(): ProjectedDrawing[]
  /** `null` = 没有错误（界面据此清掉上一轮的报错）。 */
  setFileError(message: string | null): void
}

export interface FileExports {
  save(): void
  exportSvgFile(format?: ExportFormat): Promise<void>
  exportCsvFile(): void
  exportPngFile(): void
}

/** PNG 导出的画布尺寸。写成常量而不是两处字面量：`width` / `height` 必须与下面的绘制一致。 */
const PNG_WIDTH = 1600
const PNG_HEIGHT = 760

export function createFileExports(dependencies: FileExportDependencies): FileExports {
  const { getDocument, getExportableDrawings, setFileError } = dependencies

  const reportFileError = (error: unknown, fallback: string) => setFileError(error instanceof Error ? error.message : fallback)

  /** 把一段字节交给浏览器下载。文件名取文档名（空白折成 `-`），扩展名由调用方给。 */
  const downloadBlob = (blob: Blob, extension: string) => {
    const url = URL.createObjectURL(blob)
    const anchor = globalThis.document.createElement("a")
    anchor.href = url
    anchor.download = `${getDocument().metadata.name.replace(/\s+/g, "-")}.${extension}`
    anchor.click()
    URL.revokeObjectURL(url)
  }

  const download = (content: string, type: string, extension: string) => downloadBlob(new Blob([content], { type }), extension)

  const save = () => {
    try { download(encodeMgeo(getDocument()), "application/json", "mgeo"); setFileError(null) } catch (error) { reportFileError(error, "无法保存 .mgeo 文件") }
  }

  /**
   * SVG / DXF / PDF 三个出口合成一个函数：它们在菜单里是三条命令，但**前置条件与失败文案
   * 是同一套**（都要看工作区、都要清/报错误）。分成三个函数会让"CAD 工作区才允许"这条判据抄三遍。
   */
  const exportSvgFile = async (format: ExportFormat = "svg") => {
    try {
      if (format === "pdf") {
        if (getDocument().workspace !== "cad") return
        const { exportEngineeringPdf } = await import("./engineeringExporters")
        const content = await exportEngineeringPdf(getExportableDrawings())
        downloadBlob(new Blob([content.buffer as ArrayBuffer], { type: "application/pdf" }), "pdf")
        setFileError(null)
        return
      }
      if (format === "dxf") {
        if (getDocument().workspace !== "cad") return
        const { exportEngineeringDxf } = await import("./engineeringExporters")
        download(exportEngineeringDxf(getExportableDrawings()), "application/dxf", "dxf")
        setFileError(null)
        return
      }
      const content = getDocument().workspace === "cad"
        ? (await import("./engineeringExporters")).exportEngineeringSvg(getExportableDrawings())
        : exportSvg(getDocument())
      download(content, "image/svg+xml", "svg")
      setFileError(null)
    } catch (error) { reportFileError(error, "无法导出 SVG 文件") }
  }

  const exportCsvFile = () => {
    try { download(exportCsv(getDocument()), "text/csv;charset=utf-8", "csv"); setFileError(null) } catch (error) { reportFileError(error, "无法导出 CSV 文件") }
  }

  /**
   * PNG 走"先把 SVG 渲染成图片再画进 canvas"这一步：没有这条路径就只能让用户自己截图。
   * `image.onload` 是异步的，所以错误分三处上报（不支持 canvas / 渲染失败 / 编码失败），
   * 而不是统一吞成一句"导出失败"。
   */
  const exportPngFile = () => {
    try {
      const svgUrl = URL.createObjectURL(new Blob([exportSvg(getDocument())], { type: "image/svg+xml" }))
      const image = new Image()
      image.onload = () => {
        const canvas = globalThis.document.createElement("canvas")
        canvas.width = PNG_WIDTH
        canvas.height = PNG_HEIGHT
        const context = canvas.getContext("2d")
        if (!context) { URL.revokeObjectURL(svgUrl); setFileError("当前浏览器不支持 PNG 导出"); return }
        context.drawImage(image, 0, 0, canvas.width, canvas.height)
        canvas.toBlob((blob) => { URL.revokeObjectURL(svgUrl); if (!blob) setFileError("无法生成 PNG 文件"); else { downloadBlob(blob, "png"); setFileError(null) } }, "image/png")
      }
      image.onerror = () => { URL.revokeObjectURL(svgUrl); setFileError("无法渲染 PNG 导出内容") }
      image.src = svgUrl
    } catch (error) { reportFileError(error, "无法导出 PNG 文件") }
  }

  return { save, exportSvgFile, exportCsvFile, exportPngFile }
}
