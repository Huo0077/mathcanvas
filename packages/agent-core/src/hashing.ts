import { isPlainObject, MAX_DEPTH } from "./schemaReaders"

/**
 * **确定性 ID 与规范化哈希**（从 `schemas.ts` 拆出，评审方案 2）。
 *
 * 两件事放在一个文件里是因为它们回答同一个问题："同一份内容，算出来的东西一样吗"。
 * ID 那一半是计数器 + 随机段（同一毫秒内不重复、跨进程不碰撞）；哈希那一半是**规范化**：
 * 键排序、丢视图 / 时间类字段、拒绝非有限数、`undefined` 视同"没有这个字段"。
 *
 * 最后一条是 2026-09-21 修的真实故障，说明随代码一起搬过来（见 `canonicalize`）：
 * `undefined` 当垃圾抛出去，会让"内核物化出来的子对象带 `style: undefined`"这种完全正常的
 * 数据把整轮 Agent 运行杀死在 `unsupported value of type undefined`。
 */
// ---------------------------------------------------------------- 确定性 ID

let idCounter = 0

export function mintId(prefix: string): string {
  idCounter += 1
  // 计数器保证同一毫秒内也不重复；随机段避免跨进程碰撞。
  const random = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0")
  return `${prefix}${Date.now().toString(36)}${idCounter.toString(36).padStart(3, "0")}${random}`
}

export function newRunId(): string { return mintId("run_") }
export function newDraftId(): string { return mintId("draft_") }

// ---------------------------------------------------------------- 规范化哈希

const HASH_IGNORED_KEYS = new Set([
  "viewport", "zoom", "panX", "panY", "selection", "selectedIds", "hoveredId",
  "updatedAt", "createdAt", "timestamp", "logs", "transcript", "cursor"
])

/**
 * 规范化 JSON：键排序、丢视图/时间类字段、拒绝非有限数（NaN 会悄悄变成 null，语义必须显式）。
 *
 * **`undefined` 视同"没有这个字段"**（2026-09-21 修的真实故障）。判据是"哈希值等于同一份数据
 * JSON 往返之后的哈希值" —— 因为文档的**每一处**落盘与比对路径都是 JSON 语义：
 * `JSON.stringify` 直接丢键、`contentFingerprint`（CAS 基准）也是 JSON 比语义。
 * 只有这里曾经把 `undefined` 当垃圾抛出去，于是"内核物化出来的子对象带 `style: undefined`"
 * 这种完全正常的数据会让整轮 Agent 运行死在 `unsupported value of type undefined`
 * （现场：启动恢复 → `migrateLegacySolids` → 让 Agent 规划 → `run_failed`）。
 *
 * 真正无法用 JSON 表达的值（函数 / symbol / bigint）**照旧拒绝**，但错误信息必须指出**在哪**。
 */
export function canonicalize(value: unknown, path: string, depth: number): string {
  if (depth > MAX_DEPTH) throw new Error(`canonicalContentHash: value is too deep at ${path}`)
  // 对象里的 `undefined` 键在上面被丢掉了，所以走到这里只可能是数组元素 —— 与 JSON 一样记作 null。
  if (value === undefined) return "null"
  if (value === null) return "null"
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error(`canonicalContentHash: non-finite number at ${path}`)
    return JSON.stringify(value)
  }
  if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item, index) => canonicalize(item, `${path}[${index}]`, depth + 1)).join(",")}]`
  if (isPlainObject(value)) {
    const entries = Object.keys(value)
      .filter((key) => !HASH_IGNORED_KEYS.has(key) && value[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key], `${path}.${key}`, depth + 1)}`)
    return `{${entries.join(",")}}`
  }
  throw new Error(`canonicalContentHash: unsupported value of type ${typeof value} at ${path}`)
}

/**
 * 内容哈希（SHA-256，64 位十六进制）。
 *
 * 覆盖**影响语义**的内容（几何、语义链接、已确认事实、关联标注），
 * **不包含**时间、运行日志、视图临时状态 —— 否则"只是滚了一下画布"就会让预览失效。
 * 值域上与 JSON 对齐：`undefined` 等于"没有这个字段"（见 `canonicalize`）。
 * 纯 TypeScript 实现，因此浏览器与 Node 结果一致、也不需要任何依赖。
 */
export function canonicalContentHash(value: unknown): string {
  return sha256Hex(canonicalize(value, "$", 0))
}

/** FIPS 180-4 的 SHA-256（同步、无依赖）。内部用；字符串先过 UTF-8。 */
export function sha256Hex(message: string): string {
  return sha256HexBytes(new TextEncoder().encode(message))
}

/**
 * **按原始字节**算 SHA-256。
 *
 * 为什么要有一个"按字节"的入口，而不是只留收字符串的那一个：**附件的内容哈希必须是字节的哈希**。
 * `put_attachment` 会拿调用方声明的哈希去校验它落盘的字节（`BlobStore::write` 里那道门），
 * 而字符串入口会先过 `TextEncoder` —— 一张 PNG 的开头 `0x89 0x50` 会被编码成四个字节，
 * 于是**同一份附件在前端与 Rust 侧算出两个哈希**，表现为"每一次附加都失败，理由却是哈希不符"。
 *
 * 两个入口共用同一份实现（这里），所以"哈希算法"仍然只有一处。
 */
export function sha256HexBytes(bytes: Uint8Array): string {
  const bitLength = bytes.length * 8

  const withPadding = new Uint8Array((((bytes.length + 9) >> 6) + 1) << 6)
  withPadding.set(bytes)
  withPadding[bytes.length] = 0x80
  const view = new DataView(withPadding.buffer)
  view.setUint32(withPadding.length - 4, bitLength >>> 0, false)
  view.setUint32(withPadding.length - 8, Math.floor(bitLength / 0x100000000), false)

  const h = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19])
  const k = new Uint32Array([
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ])

  const w = new Uint32Array(64)
  const rotr = (value: number, bits: number) => ((value >>> bits) | (value << (32 - bits))) >>> 0

  for (let offset = 0; offset < withPadding.length; offset += 64) {
    for (let index = 0; index < 16; index += 1) w[index] = view.getUint32(offset + index * 4, false)
    for (let index = 16; index < 64; index += 1) {
      const s0 = (rotr(w[index - 15], 7) ^ rotr(w[index - 15], 18) ^ (w[index - 15] >>> 3)) >>> 0
      const s1 = (rotr(w[index - 2], 17) ^ rotr(w[index - 2], 19) ^ (w[index - 2] >>> 10)) >>> 0
      w[index] = (w[index - 16] + s0 + w[index - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let index = 0; index < 64; index += 1) {
      const s1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0
      const ch = ((e & f) ^ (~e & g)) >>> 0
      const temp1 = (hh + s1 + ch + k[index] + w[index]) >>> 0
      const s0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0
      const temp2 = (s0 + maj) >>> 0
      hh = g; g = f; f = e
      e = (d + temp1) >>> 0
      d = c; c = b; b = a
      a = (temp1 + temp2) >>> 0
    }
    h[0] = (h[0] + a) >>> 0; h[1] = (h[1] + b) >>> 0; h[2] = (h[2] + c) >>> 0; h[3] = (h[3] + d) >>> 0
    h[4] = (h[4] + e) >>> 0; h[5] = (h[5] + f) >>> 0; h[6] = (h[6] + g) >>> 0; h[7] = (h[7] + hh) >>> 0
  }

  return [...h].map((word) => word.toString(16).padStart(8, "0")).join("")
}
