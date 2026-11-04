export const MAX_PROBLEM_IMAGES = 2
const MAX_FILE_BYTES = 16 * 1024 * 1024
const MAX_PNG_BASE64 = Math.ceil(2 * 1024 * 1024 / 3) * 4

export interface ProblemImage {
  name: string
  png: string
}

export async function prepareProblemImage(file: File): Promise<ProblemImage> {
  if (file.size === 0 || file.size > MAX_FILE_BYTES) throw new Error("请选择 16 MB 以内的图片。")
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer())
  const png = header[0] === 137 && header[1] === 80 && header[2] === 78 && header[3] === 71
  const jpeg = header[0] === 255 && header[1] === 216 && header[2] === 255
  const webp = String.fromCharCode(...header.slice(0, 4)) === "RIFF" && String.fromCharCode(...header.slice(8)) === "WEBP"
  if (!png && !jpeg && !webp) throw new Error("请选择 PNG、JPEG 或 WebP 图片。")

  const bitmap = await createImageBitmap(file).catch(() => { throw new Error("无法读取这张图片。请换一张截图。") })
  try {
    if (bitmap.width * bitmap.height > 48_000_000) throw new Error("图片分辨率过大。请先截取单道题。")
    const canvas = document.createElement("canvas")
    const context = canvas.getContext("2d", { alpha: false })
    if (!context) throw new Error("当前环境无法处理图片。")
    let scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height))
    for (let attempt = 0; attempt < 4; attempt += 1) {
      canvas.width = Math.max(1, Math.round(bitmap.width * scale))
      canvas.height = Math.max(1, Math.round(bitmap.height * scale))
      context.fillStyle = "#fff"
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
      const encoded = canvas.toDataURL("image/png")
      const prefix = "data:image/png;base64,"
      if (encoded.startsWith(prefix) && encoded.length - prefix.length <= MAX_PNG_BASE64) {
        return { name: file.name || "剪贴板图片", png: encoded.slice(prefix.length) }
      }
      scale *= 0.75
    }
    throw new Error("处理后的图片仍然过大。请先裁出题干和配图。")
  } finally {
    bitmap.close()
  }
}
