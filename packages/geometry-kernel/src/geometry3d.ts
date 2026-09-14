export interface Vector3 {
  x: number
  y: number
  z: number
}

export interface Plane3 {
  normal: Vector3
  constant: number
}

export function addVector3(first: Vector3, second: Vector3): Vector3 {
  return { x: first.x + second.x, y: first.y + second.y, z: first.z + second.z }
}

export function subtractVector3(first: Vector3, second: Vector3): Vector3 {
  return { x: first.x - second.x, y: first.y - second.y, z: first.z - second.z }
}

export function scaleVector3(vector: Vector3, scalar: number): Vector3 {
  return { x: vector.x * scalar, y: vector.y * scalar, z: vector.z * scalar }
}

export function dotVector3(first: Vector3, second: Vector3): number {
  return first.x * second.x + first.y * second.y + first.z * second.z
}

export function crossVector3(first: Vector3, second: Vector3): Vector3 {
  return { x: first.y * second.z - first.z * second.y, y: first.z * second.x - first.x * second.z, z: first.x * second.y - first.y * second.x }
}

export function lengthVector3(vector: Vector3): number {
  return Math.hypot(vector.x, vector.y, vector.z)
}

export function normalizeVector3(vector: Vector3): Vector3 {
  const length = lengthVector3(vector)
  return length > 1e-12 ? scaleVector3(vector, 1 / length) : { x: 0, y: 0, z: 0 }
}

export function planeFromPoints(first: Vector3, second: Vector3, third: Vector3): Plane3 | null {
  const normal = normalizeVector3(crossVector3(subtractVector3(second, first), subtractVector3(third, first)))
  return lengthVector3(normal) > 0 ? { normal, constant: -dotVector3(normal, first) } : null
}

export function intersectRayPlane(origin: Vector3, direction: Vector3, plane: Plane3): Vector3 | null {
  const denominator = dotVector3(plane.normal, direction)
  if (Math.abs(denominator) < 1e-12) return null
  const distance = -(dotVector3(plane.normal, origin) + plane.constant) / denominator
  return distance >= 0 ? addVector3(origin, scaleVector3(direction, distance)) : null
}

export function dihedralAngle(firstNormal: Vector3, secondNormal: Vector3): number {
  const first = normalizeVector3(firstNormal)
  const second = normalizeVector3(secondNormal)
  const cosine = Math.min(1, Math.max(-1, Math.abs(dotVector3(first, second))))
  return Math.acos(cosine)
}
