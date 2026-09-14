import { validateDocument } from "./schema"
import type { GeometryDocument, Workspace } from "./types"

function createId(prefix: string): string {
  const uuid = globalThis.crypto?.randomUUID?.()
  return `${prefix}-${uuid ?? Math.random().toString(36).slice(2, 10)}`
}

export function createEmptyDocument(workspace: Workspace): GeometryDocument {
  const now = new Date().toISOString()
  return {
    schemaVersion: "0.1",
    revision: 0,
    workspace,
    coordinateSystems: workspace === "geometry3d" ? ["cartesian-3d"] : ["cartesian-2d"],
    parameters: {},
    primitives: [],
    groups: [],
    constraints: [],
    dynamics: [],
    annotations: [],
    metadata: { id: createId("doc"), name: "Untitled geometry", createdAt: now, updatedAt: now }
  }
}

export function encodeMgeo(document: GeometryDocument): string {
  const result = validateDocument(document)
  if (!result.valid) throw new Error(`Invalid geometry document: ${result.errors.join(", ")}`)
  return JSON.stringify({ format: "mgeo", formatVersion: "0.1", document }, null, 2)
}

export function decodeMgeo(serialized: string): GeometryDocument {
  let parsed: unknown
  try {
    parsed = JSON.parse(serialized)
  } catch {
    throw new Error("Invalid .mgeo JSON")
  }
  const rawCandidate = parsed && typeof parsed === "object" && "document" in parsed ? (parsed as { document: unknown }).document : parsed
  const candidate = rawCandidate && typeof rawCandidate === "object"
    ? { ...rawCandidate, groups: "groups" in rawCandidate ? (rawCandidate as { groups: unknown }).groups : [] }
    : rawCandidate
  const result = validateDocument(candidate)
  if (!result.valid) throw new Error(`Invalid geometry document: ${result.errors.join(", ")}`)
  return candidate as GeometryDocument
}
