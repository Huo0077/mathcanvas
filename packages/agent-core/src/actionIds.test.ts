import { describe, expect, it } from "vitest"

import { assertActionIdCatalogueIsComplete, DRAFT_ACTION_IDS } from "./actionIds"
import { parseDraftAction } from "./schemas"

/**
 * 杩欎唤鐢ㄤ緥鏄?*瀹炴祴缂洪櫡**鐨勫洖褰掑畧鍗€?
 *
 * 瀹炴祴杩囩▼锛氬姩浣滃眰锛坄packages/scene-graph/src/actions/types.ts`锛夎寰?**20** 涓?actionId锛?
 * 鑰屼紶杈撳眰鐨?`ACTIONS` 鍙櫥璁颁簡 **4** 涓€傚悗鏋滄槸妯″瀷缁欏嚭鐨勫悎娉曞姩浣滆 `parseDraftAction`
 * 鍒や负 `unknown_action` 鈥斺€?鎶ラ敊鍍忔槸"妯″瀷缂栦簡涓笉瀛樺湪鐨勫姩浣?锛屽疄闄呮槸鐧昏琛ㄨ繃鏈燂紝
 * 浜庢槸鍗佸嚑涓凡瀹炵幇鐨勫姩浣?*鏍规湰鏃犳硶浠庢ā鍨嬭緭鍑哄埌杈剧紪璇戝櫒**銆?
 *
 * 缂栬瘧鏈熷凡鍦?`actionIds.ts` 鐢ㄤ袱澶?`satisfies` 鍋氫簡鍙屽悜瀹堝崼锛涜繖閲屽啀杩愯鏈熸牳瀵逛竴娆★細
 * schema 鏄畨鍏ㄨ竟鐣岋紝鑰岀紪璇戞湡瀹堝崼鍦ㄦ湁浜鸿烦杩?`tsc` 鏃朵笉浼氱敓鏁堛€?
 */
describe("draft action catalogue", () => {
  it("lists every action the compiler implements", () => {
    // 鏁板瓧鍐欐鍦ㄨ繖閲屾槸鏈夋剰鐨勶細鍔ㄤ綔灞傛柊澧炲姩浣滄椂杩欐潯浼氬け璐ワ紝鎻愰啋鎶婃柊鍔ㄤ綔鎺ヨ繘浼犺緭灞傦紝
    // 鑰屼笉鏄瀹冮潤榛樹笉鍙揪銆?*21** 鏄姞涓?`solid.create_prism`锛圫olid/Prism 鍒囩墖锛変箣鍚庣殑瀹炴祴鍊硷紱
    // **24** 鏄姞涓?`planar.create_conic` / `dynamic.create_bound_point` / `parameter.create`
    // 锛圓gent DSL 鍒囩墖锛変箣鍚庣殑瀹炴祴鍊硷紱**25** 鏄姞涓?`solid.create_tetrahedron`锛堟鍥涢潰浣撳垏鐗囷級涔嬪悗鐨勫疄娴嬪€硷紱
    // **26** 鏄姞涓?`solid.create_regular_pyramid`锛堢 1 灞傦細姝?N 妫遍敟锛変箣鍚庣殑瀹炴祴鍊硷紱
    // **28** 鏄姞涓?`solid.create_sphere`锛堢悆浣撳垏鐗?Task 8锛氳В鏋愮悆锛屼笉鐗╁寲瀛愬璞★級涔嬪悗鐨勫疄娴嬪€硷紱
    // **29** 鏄姞涓?`function.create_graph`锛堣鍒?V0d锛欰gent 绗竴娆¤兘**鍒涘缓**鍑芥暟鍥惧儚 鈥斺€?
    // 姝ゅ墠 `function.analyze` / `function.create_tangent` 閮借姹傚厛鏈変竴鏉℃洸绾匡級涔嬪悗鐨勫疄娴嬪€笺€?
    // **31** 鏄姞涓?`derived.create_circumsphere` / `derived.create_insphere`锛圫5锛氭淳鐢熺悆 鈥斺€?
    // 鐞冨績涓庡崐寰?*鐢卞涓荤畻鍑烘潵**锛岃В涓嶅嚭鏉ュ氨鎷掔粷锛屼笉缂栦竴涓悆锛変箣鍚庣殑瀹炴祴鍊笺€?
    // **32** 鏄姞涓?`solid.create_round_frustum`锛圫4.3锛氬渾鍙?鈥斺€?**鍙傛暟鍖栧姩浣?+ 鍐呮牳澶氳竟褰㈣繎浼?* 鈬?
    // 鐗╁寲鎴?`polyhedron3`锛屼笉鏄柊鍥惧厓锛屼篃涓嶇敤璋冪敤鏂硅嚜宸卞啓 96 涓《鐐癸級涔嬪悗鐨勫疄娴嬪€笺€?
    // **33** 鏄姞涓?`solid.create_face`锛?026-10-10 鐢ㄦ埛鐜板満锛氱珛浣撳伐浣滃尯閲岀殑**骞抽潰澶氳竟褰?/ 闈㈢墖** 鈥斺€?
    // "骞抽潰鍥涜竟褰?+ 缈绘姌鐗?杩欑被**寮€鏀炬洸闈?*鍘熷厛娌℃湁鍏ュ彛锛屾ā鍨嬪彧鑳芥嬁澶氶潰浣撳幓濂椼€佸繀鐒惰鎷掞級涔嬪悗鐨勫疄娴嬪€笺€?
    // **34** 鏄姞涓?`solid.fold`锛?026-10-11 鐢ㄦ埛鐜板満锛氥€屽皢涓夎褰EF娌縀F缈绘姌鑷充笁瑙掑舰PEF銆嶈繛鍙?7 娆￠兘涓嶉€氾紱
    // 鎶樺悗鐨勫潗鏍囩敱鍐呮牳鐨勫垰浣撴棆杞畻鍑烘潵锛屾ā鍨嬩笉鍐嶆墜绠?鈥斺€?瀹冩墜绠楃殑閭ｅ嚑娆＄粰鍑虹殑閮芥槸閫€鍖栧嚑浣曪級涔嬪悗鐨勫疄娴嬪€笺€?
    // **35** 鏄姞涓?`solid.create_segment`锛?026-10-15 鐢ㄦ埛鐜板満锛氱珛浣撻噷"涓ょ偣杩炴垚涓€鏉＄嚎娈?**娌℃湁鍔ㄤ綔** 鈥斺€?
    // 妯″瀷瑕佺敾 `EF`銆乣BD` 鍙兘鎷?`planar.create_segment` 鍑戯紝鑰岄偅鏉¤惤鍦?`z=0` 涓婏紝`planCompiler`
    // 鐢氳嚦涓撻棬鍔濆畠鍒繖涔堝共 鈬?妯″瀷鏃犲鍙幓锛変箣鍚庣殑瀹炴祴鍊笺€?
    expect(DRAFT_ACTION_IDS).toHaveLength(39)
    expect(new Set(DRAFT_ACTION_IDS).size).toBe(39)
  })

  it("recognises every catalogue action instead of calling it unknown", () => {
    for (const actionId of DRAFT_ACTION_IDS) {
      const result = parseDraftAction({ actionId, actionKey: "k", factIds: [], inputs: {} })
      // 杞借嵎鍙互涓虹┖锛堣涔夋牎楠屽湪缂栬瘧鍣ㄩ噷锛夛紱浣?*鍚嶅瓧蹇呴』琚鍑?*銆?
      const codes = result.ok ? [] : result.errors.map((error) => error.code)
      expect(codes, `${actionId} was rejected as ${codes.join(",")}`).not.toContain("unknown_action")
    }
  })

  it("still refuses a name that no action implements", () => {
    const result = parseDraftAction({ actionId: "planar.create_dragon", actionKey: "k", factIds: [], inputs: {} })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors.some((error) => error.code === "unknown_action")).toBe(true)
  })

  it("refuses the two action names that were registered but never implemented", () => {
    // 杩欎袱鏉℃槸**閿欑殑鐧昏椤?*锛氬姩浣滃眰閲屾病鏈?`object.delete` / `object.update`锛?
    // 鐪熷悕鏄?`object.delete_many` / `object.update_inputs`銆傚畠浠繀椤昏鎷掞紝鍚﹀垯妯″瀷浼氫竴鐩寸敤閿欏悕瀛椼€?
    for (const ghost of ["object.delete", "object.update"]) {
      const result = parseDraftAction({ actionId: ghost, actionKey: "k", factIds: [], inputs: {} })
      expect(result.ok, `${ghost} should not be accepted`).toBe(false)
    }
  })

  it("keeps the compile-time guard reachable", () => {
    // `assertActionIdCatalogueIsComplete` 瀛樺湪鐨勭悊鐢辨槸璁?鍙嶆柟鍚戝畧鍗?閭ｄ釜甯搁噺琚敤鍒帮紱
    // 瀹冩湰韬笉璇ユ湁浠讳綍琛屼负銆?
    expect(assertActionIdCatalogueIsComplete()).toBe(true)
  })
})
