import { createEmptyDocument } from "@draw/dsl"
import { beforeEach, describe, expect, it } from "vitest"

import { loadActiveWorkspace, loadDraft, saveDraft } from "./draftStorage"

describe("draft storage", () => {
  beforeEach(() => localStorage.clear())

  it("round-trips a workspace draft and active workspace", () => {
    const document = createEmptyDocument("conics")
    document.metadata.name = "草稿"

    saveDraft(document)

    expect(loadDraft("conics")?.metadata.name).toBe("草稿")
    expect(loadActiveWorkspace()).toBe("conics")
  })

  it("removes malformed drafts instead of breaking startup", () => {
    localStorage.setItem("mathcanvas:draft:calculus", "not-json")

    expect(loadDraft("calculus")).toBeNull()
    expect(localStorage.getItem("mathcanvas:draft:calculus")).toBeNull()
  })
})
