import { it } from "vitest"

/** Historical image-question fixture retained as a fail-closed entry point. No provider calls. */
it("image-question live evaluation has been retired", () => {
  throw new Error("图片识题已停用；此评测入口不再调用模型。请使用文字题评测集。")
})