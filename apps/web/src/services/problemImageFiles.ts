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
    return { name: file.name || "剪贴板图片", png: encodeProblemImage(bitmap) }
  } finally {
    bitmap.close()
  }
}

export function decodeProblemImage(image: ProblemImage): Promise<ImageBitmap> {
  const bytes = Uint8Array.from(atob(image.png), character => character.charCodeAt(0))
  return createImageBitmap(new Blob([bytes], { type: "image/png" }))
}

export async function cropProblemImage(image: ProblemImage, box: readonly [number, number, number, number]): Promise<ProblemImage> {
  const bitmap = await decodeProblemImage(image)
  try {
    const [left, top, right, bottom] = box
    const padX = Math.max(0.01, (right - left) * 0.12)
    const padY = Math.max(0.01, (bottom - top) * 0.12)
    const x = Math.floor(Math.max(0, left - padX) * bitmap.width)
    const y = Math.floor(Math.max(0, top - padY) * bitmap.height)
    const width = Math.ceil(Math.min(1, right + padX) * bitmap.width) - x
    const height = Math.ceil(Math.min(1, bottom + padY) * bitmap.height) - y
    return { name: image.name, png: encodeProblemImage(bitmap, [x, y, width, height]) }
  } finally {
    bitmap.close()
  }
}

function encodeProblemImage(bitmap: ImageBitmap, region: readonly [number, number, number, number] = [0, 0, bitmap.width, bitmap.height]): string {
  const [x, y, width, height] = region
  const canvas = document.createElement("canvas")
  const context = canvas.getContext("2d", { alpha: false })
  if (!context) throw new Error("当前环境无法处理图片。")
  let scale = Math.min(1, 2400 / Math.max(width, height))
  for (let attempt = 0; attempt < 4; attempt += 1) {
    canvas.width = Math.max(1, Math.round(width * scale))
    canvas.height = Math.max(1, Math.round(height * scale))
    context.fillStyle = "#fff"
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.drawImage(bitmap, x, y, width, height, 0, 0, canvas.width, canvas.height)
    const encoded = canvas.toDataURL("image/png")
    const prefix = "data:image/png;base64,"
    if (encoded.startsWith(prefix) && encoded.length - prefix.length <= MAX_PNG_BASE64) {
      return encoded.slice(prefix.length)
    }
    scale *= 0.75
  }
  throw new Error("处理后的图片仍然过大。请先裁出题干和配图。")
}
