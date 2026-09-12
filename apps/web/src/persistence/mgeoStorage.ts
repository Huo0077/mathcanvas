import { decodeMgeo, encodeMgeo } from "@draw/dsl"
import type { GeometryDocument } from "@draw/dsl"

export function saveMgeo(document: GeometryDocument): string {
  return encodeMgeo(document)
}

export function loadMgeo(serialized: string): GeometryDocument {
  return decodeMgeo(serialized)
}
