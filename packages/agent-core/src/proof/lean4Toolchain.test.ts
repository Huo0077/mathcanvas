import { describe, expect, it } from "vitest"

import { compareToolchainDirs, resolveLean4Toolchain, toolchainVersionParts, type Lean4ResolveOptions } from "./lean4Toolchain"

/**
 * **"去哪儿找 Lean"这一层的判据**（N5b）。
 *
 * 全部在 CI 上跑：文件系统是**注入的**（`fileExists` / `listDir`），所以不需要这台机器上
 * 真的装了 Lean，也不需要 7 GB 的 mathlib。
 *
 * 这一层值得单独测的理由是它**几乎全部是失败路径**：
 * 真正要防的不是"正常机器上找不到"，而是"在一台**只装了 elan** 的机器上错拿垫片"
 * （慢一个量级）、"在 `ELAN_HOME` 那种布局上拼错路径"、"没有工具链时**猜**一个看起来对的路径"。
 * 这三条都属于"看起来正常但实际不对"，所以逐条钉住。
 *
 * ## 2026-10-06：**Windows 形状的用例必须显式注入 `exeSuffix`**（CI 上因此红过 6 条）
 *
 * 本文件的假文件系统写的是 `lean.exe` / `lake.exe`，而**后缀是从宿主平台推的**
 *（`process.platform === "win32" ? ".exe" : ""`）。所以只写 Windows 形状的路径、不注入 `exeSuffix`，
 * 这些用例就会**偷偷依赖"跑测试的机器是 Windows"** —— 开发机上全绿，CI（Linux）上 6 条一起红
 *（`expected undefined to be 'elan-shim' / 'PATH' / 'env:DRAW_LEAN4_TOOLCHAIN_BIN' …`，
 * 因为 Linux 上拼出来的候选是 `.../lean`，而假文件系统里只有 `.../lean.exe`）。
 * **每一条 Windows 形状的用例都要显式注入 `exeSuffix: ".exe"`**（PATH 那条还要 `pathSeparator: ";"`）；
 * 平台推断本身另有专门用例（见"平台推断可注入"那一条）。
 */

/** 一台"假机器"：给一组存在的文件与目录。 */
function fakeFs(files: readonly string[], dirs: Record<string, readonly string[]>): Pick<Lean4ResolveOptions, "fileExists" | "listDir"> {
  const set = new Set(files.map((entry) => entry.replace(/\\/g, "/").toLowerCase()))
  return {
    fileExists: (candidate) => set.has(candidate.replace(/\\/g, "/").toLowerCase()),
    listDir: (dir) => [...(dirs[dir.replace(/\\/g, "/").toLowerCase()] ?? dirs[dir] ?? [])]
  }
}

describe("工具链版本比较（挑「同名工具链里最新的那个」）", () => {
  it("版本段解析", () => {
    expect(toolchainVersionParts("leanprover--lean4---v4.34.1")).toEqual([4, 34, 1])
    expect(toolchainVersionParts("leanprover--lean4---v4.35.0-rc3")).toEqual([4, 35, 0])
    expect(toolchainVersionParts("no-version-here")).toEqual([])
  })

  it("**按数字段比，不按字符串比** —— `v4.35.0-rc3` 必须排在 `v4.34.1` 前面", () => {
    // 字符串比较会给出相反的答案（"v4.3…" > "v4.3…"？恰好在这两个上一致，但 4.9 vs 4.10 就不会）。
    expect(compareToolchainDirs("leanprover--lean4---v4.35.0-rc3", "leanprover--lean4---v4.34.1")).toBeGreaterThan(0)
    expect(compareToolchainDirs("leanprover--lean4---v4.10.0", "leanprover--lean4---v4.9.0")).toBeGreaterThan(0)
    expect(compareToolchainDirs("a", "a")).toBe(0)
  })
})

describe("解析顺序（每一档都要能红）", () => {
  const HOME = "C:/Users/tester"

  it("1. **显式配置优先**（部署方的入口）", () => {
    const found = resolveLean4Toolchain({
      env: { DRAW_LEAN4_TOOLCHAIN_BIN: "D:/opt/lean/bin", USERPROFILE: HOME },
      exeSuffix: ".exe",
      ...fakeFs(["D:/opt/lean/bin/lean.exe", "D:/opt/lean/bin/lake.exe"], {})
    })

    expect(found?.resolvedBy).toBe("env:DRAW_LEAN4_TOOLCHAIN_BIN")
    expect(found?.leanPath).toBe("D:/opt/lean/bin/lean.exe")
    expect(found?.lakePath).toBe("D:/opt/lean/bin/lake.exe")
  })

  it("2. **优先工具链自己的 `bin/`**（不是 elan 垫片）—— 而且同名工具链取版本最高的", () => {
    const found = resolveLean4Toolchain({
      env: { USERPROFILE: HOME },
      exeSuffix: ".exe",
      ...fakeFs(
        [
          `${HOME}/.elan/toolchains/leanprover--lean4---v4.34.1/bin/lean.exe`,
          `${HOME}/.elan/toolchains/leanprover--lean4---v4.35.0-rc3/bin/lean.exe`,
          `${HOME}/.elan/toolchains/leanprover--lean4---v4.35.0-rc3/bin/lake.exe`,
          `${HOME}/.elan/bin/lean.exe`
        ],
        { [`${HOME}/.elan/toolchains`]: ["leanprover--lean4---v4.34.1", "leanprover--lean4---v4.35.0-rc3"] }
      )
    })

    // 关键：**不是** `elan-shim`、也**不是** `v4.34.1`（垫片那条路慢一个量级，见文件头）。
    expect(found?.resolvedBy).toBe("elan-toolchain:leanprover--lean4---v4.35.0-rc3")
    expect(found?.binDir).toBe(`${HOME}/.elan/toolchains/leanprover--lean4---v4.35.0-rc3/bin`)
  })

  it("2b. `ELAN_HOME` **本身就是** elan 根目录（不能在它下面再拼一个 `.elan`）", () => {
    const found = resolveLean4Toolchain({
      env: { ELAN_HOME: "E:/elan" },
      exeSuffix: ".exe",
      ...fakeFs(["e:/elan/toolchains/leanprover--lean4---v4.36.0/bin/lean.exe"], { "e:/elan/toolchains": ["leanprover--lean4---v4.36.0"] })
    })

    expect(found?.resolvedBy).toBe("elan-toolchain:leanprover--lean4---v4.36.0")
    // 这条断言是**反向**的：如果实现把 `ELAN_HOME` 当作家目录处理（再拼 `.elan`），
    // 它会去找 `E:/elan/.elan/toolchains/...` 而那份文件不存在 —— 于是这里会变成 undefined。
    expect(found?.binDir).not.toContain(".elan/.elan")
  })

  it("3. 工具链目录里没有 ⇒ 退到 PATH", () => {
    const found = resolveLean4Toolchain({
      env: { USERPROFILE: HOME, PATH: "C:/tools;C:/lean/bin" },
      exeSuffix: ".exe",
      pathSeparator: ";",
      ...fakeFs(["C:/lean/bin/lean.exe"], {})
    })

    expect(found?.resolvedBy).toBe("PATH")
    expect(found?.leanPath).toBe("C:/lean/bin/lean.exe")
    // 同一目录下没有 `lake` ⇒ `lakePath` 是 `null`（**不是**猜一个路径出来）。
    expect(found?.lakePath).toBeNull()
  })

  it("4. PATH 里也没有 ⇒ 垫片兜底（慢，但正确）", () => {
    const found = resolveLean4Toolchain({
      env: { USERPROFILE: HOME, PATH: "" },
      exeSuffix: ".exe",
      ...fakeFs([`${HOME}/.elan/bin/lean.exe`], {})
    })

    expect(found?.resolvedBy).toBe("elan-shim")
  })

  it("5. **一处都没有 ⇒ `null`**，绝不猜一个看起来对的路径", () => {
    expect(resolveLean4Toolchain({ env: { USERPROFILE: HOME, PATH: "" }, ...fakeFs([], {}) })).toBeNull()
  })

  it("**没有文件系统探针就没有答案**（浏览器里就是这个情形）", () => {
    // 这条是"浏览器可用性"的落点：不给探针时它返回 `null`，而不是去碰 `node:fs`。
    expect(resolveLean4Toolchain({ env: { PATH: "C:/lean/bin" }, listDir: () => [] })).toBeNull()
  })

  it("平台推断可注入：Linux 上找的是没有 `.exe` 的那个名字", () => {
    const found = resolveLean4Toolchain({
      env: { HOME: "/home/tester", PATH: "/usr/local/bin" },
      exeSuffix: "",
      pathSeparator: ":",
      ...fakeFs(["/usr/local/bin/lean"], {})
    })

    expect(found?.leanPath).toBe("/usr/local/bin/lean")
  })

  it("**`ELAN_HOME` 指向一个不存在的目录时会继续往下找**（不是直接失败）", () => {
    const found = resolveLean4Toolchain({
      env: { ELAN_HOME: "Z:/nope", USERPROFILE: HOME, PATH: "" },
      exeSuffix: ".exe",
      ...fakeFs([`${HOME}/.elan/bin/lean.exe`], {})
    })

    expect(found?.resolvedBy).toBe("elan-shim")
  })
})
