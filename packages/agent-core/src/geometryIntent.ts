/** Explicit, unambiguous cube constraints read from the user's words, never inferred from model assertions. */
export function cubeCenterFrom(prompt: string): { x: number; y: number; z: number } | null {
  const prefix = /\u4e2d\u5fc3\s*(?:\u5728|\u4f4d\u4e8e|\u4e3a)?\s*/
  const at = prompt.search(prefix)
  if (at < 0) return null
  const source = prompt.slice(at).replace(prefix, "")
  if (/^\u539f\u70b9/.test(source)) return { x: 0, y: 0, z: 0 }
  const coordinates = source.match(/^[(\uff08]\s*(-?\d+(?:\.\d+)?)\s*[,\uff0c]\s*(-?\d+(?:\.\d+)?)\s*[,\uff0c]\s*(-?\d+(?:\.\d+)?)\s*[)\uff09]/)
  if (!coordinates) return null
  const [x, y, z] = coordinates.slice(1).map(Number)
  return [x, y, z].every(Number.isFinite) ? { x, y, z } : null
}

export function cubeEdgeLengthFrom(prompt: string): number | null {
  const named = prompt.match(/(?:\u68f1\u957f|\u8fb9\u957f|edge\s*length|size)\s*(?:\u4e3a|\u662f|=|:|\uff1a)?\s*(-?\d+(?:\.\d+)?)/i)
  if (!named) return null
  const value = Number(named[1])
  return Number.isFinite(value) ? value : null
}

export function explicitlyRequestsCube(prompt: string): boolean {
  return /\u7acb\u65b9\u4f53|\u6b63\u65b9\u4f53|\bcube\b/i.test(prompt)
}
