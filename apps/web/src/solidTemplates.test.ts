import { createEmptyDocument } from "@draw/dsl"
import { describe, expect, it } from "vitest"

import { migrateLegacySolids } from "./solidTemplates"

describe("solid template migration", () => {
  it("materializes a legacy solid into stable topology on load", () => {
    const document = createEmptyDocument("geometry3d")
    document.primitives = [{ id: "cube-1", type: "cube", origin: { x: -1, y: -1, z: -1 }, size: { x: 2, y: 2, z: 2 }, label: "旧立方体" }]

    const migrated = migrateLegacySolids(document)
    const polyhedron = migrated.primitives.find((primitive) => primitive.type === "polyhedron3")

    expect(migrated.primitives).toHaveLength(28)
    expect(polyhedron).toMatchObject({ construction: { kind: "template", templateId: "cube", sourceIds: expect.arrayContaining(["cube-1"]) } })
    expect(migrateLegacySolids(migrated).primitives).toHaveLength(migrated.primitives.length)
  })
})
