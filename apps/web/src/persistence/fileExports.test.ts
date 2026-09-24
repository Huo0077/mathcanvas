import { createEmptyDocument, type GeometryDocument } from "@draw/dsl"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { createFileExports } from "./fileExports"
import type { ProjectedDrawing } from "../projectionVisuals"

/**
 * **文件下载与导出**的用例。
 *
 * 这一族入口此前是 `App.tsx` 里的闭包，**一条测试都没有** —— 所以它们被拆出来的时候
 * 只能靠"没人改动过它们的逻辑"来相信行为没变。现在它们是一个有明确依赖边界的模块，
 * 可以直接喂一份文档进去、看它交给浏览器的是什么。
 *
 * 三条真正值得钉住的性质：
 *
 * 1. **下载文件名**：文档名里的空白要折成 `-`，扩展名由调用方给 —— 这是用户唯一看得见的产物。
 *    `App.tsx` 那一层用的是"按下按钮那一刻"的文档，所以文件名也必须是那一刻的
 *    （夹具里改一次文档名再导出一次，就是为了钉住这条）。
 * 2. **工作区前置条件**：DXF / PDF 只对 `cad` 工作区有意义，其它工作区**什么都不该发生**
 *    （不下载、也不去动态 import 那 429 kB 的导出器）。
 * 3. **失败要说出来**：`setFileError` 必须收到可读的一句话，而不是静默无事发生。
 */
describe("file exports", () => {
  let downloads: string[]
  let blobs: Blob[]
  let errors: (string | null)[]
  let originalCreateElement: typeof globalThis.document.createElement
  let originalCreateObjectURL: typeof URL.createObjectURL
  let originalRevokeObjectURL: typeof URL.revokeObjectURL

  const document3d = (name = "我的 图纸"): GeometryDocument => {
    const document = createEmptyDocument("geometry3d")
    document.metadata.name = name
    return document
  }

  const harness = (getDocument: () => GeometryDocument) => createFileExports({
    getDocument,
    getExportableDrawings: () => [] as ProjectedDrawing[],
    setFileError: (message) => { errors.push(message) }
  })

  beforeEach(() => {
    downloads = []
    blobs = []
    errors = []
    originalCreateElement = globalThis.document.createElement.bind(globalThis.document)
    originalCreateObjectURL = URL.createObjectURL
    originalRevokeObjectURL = URL.revokeObjectURL

    // 真实的 `<a>` 元素，只是把 click 换掉：这样被测代码拿到的东西与生产一致，
    // 而"下载了什么"被记在一张表里。
    vi.spyOn(globalThis.document, "createElement").mockImplementation(((tag: string) => {
      const element = originalCreateElement(tag)
      if (tag === "a") {
        Object.defineProperty(element, "click", { value: () => { downloads.push((element as HTMLAnchorElement).download) }, configurable: true })
      }
      return element
    }) as typeof globalThis.document.createElement)
    URL.createObjectURL = ((blob: Blob) => { blobs.push(blob); return "blob:test" }) as typeof URL.createObjectURL
    URL.revokeObjectURL = (() => undefined) as typeof URL.revokeObjectURL
  })

  afterEach(() => {
    vi.restoreAllMocks()
    URL.createObjectURL = originalCreateObjectURL
    URL.revokeObjectURL = originalRevokeObjectURL
  })

  it("saves .mgeo with the document name and reports no error", () => {
    const exports = harness(() => document3d("我的 图纸"))
    exports.save()

    expect(downloads).toEqual(["我的-图纸.mgeo"])
    expect(blobs).toHaveLength(1)
    expect(errors).toEqual([null])
  })

  /**
   * 文件名取**调用那一刻**的文档，而不是建工厂那一刻的那份。
   *
   * 这正是把依赖从"值"改成"取值函数"的理由（见 `fileExports.ts` 的头注释）：
   * `App.tsx` 的命令面板会在 React 之外调用这些入口。
   */
  it("reads the document at call time, not at creation time", () => {
    let current = document3d("初版")
    const exports = harness(() => current)
    exports.save()
    current = document3d("改过名")
    exports.save()

    expect(downloads).toEqual(["初版.mgeo", "改过名.mgeo"])
  })

  it("exports CSV of the planar document", () => {
    const exports = harness(() => document3d("平面"))
    exports.exportCsvFile()
    expect(downloads).toEqual(["平面.csv"])
    expect(errors).toEqual([null])
  })

  it("exports SVG of a non-CAD workspace without touching the engineering exporters", async () => {
    const exports = harness(() => document3d("平面"))
    await exports.exportSvgFile("svg")
    expect(downloads).toEqual(["平面.svg"])
    expect(errors).toEqual([null])
  })

  /**
   * DXF / PDF 只对 `cad` 工作区有意义。
   *
   * 判据是"什么都不发生"：**不下载、不报错、也不把 `pdf-lib` 拉进来**。
   * 最后那一条尤其要紧 —— 静态 import 那个导出器会让入口包胖 429 kB。
   */
  it("does nothing for DXF and PDF outside the CAD workspace", async () => {
    const exports = harness(() => document3d("平面"))
    await exports.exportSvgFile("dxf")
    await exports.exportSvgFile("pdf")

    expect(downloads).toEqual([])
    expect(blobs).toEqual([])
    expect(errors).toEqual([])
  })

  /**
   * 报错要落在 `setFileError` 上，而且是**可读的一句话**。
   *
   * 夹具故意给一份带环引用（自己指向自己）的文档：`encodeMgeo` 序列化时会抛，
   * 于是走的正是"保存失败"那条路径。这里只要求它说出点什么，不要求那句话的措辞 ——
   * 文案会变，而"失败必须被说出来"这条性质不该跟着变。
   */
  it("surfaces a save failure instead of failing silently", () => {
    const broken = document3d("坏文档")
    ;(broken.metadata as { self?: unknown }).self = broken.metadata
    const exports = harness(() => broken)

    expect(() => exports.save()).not.toThrow()
    expect(errors).toHaveLength(1)
    expect(typeof errors[0]).toBe("string")
    expect((errors[0] as string).length).toBeGreaterThan(0)
  })
})
