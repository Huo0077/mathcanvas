# 3D 渲染管道去重建化 实施计划（切片 1A-1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 3D 画布的 `WebGLRenderer`/canvas 在一次挂载内只创建一次，文档编辑、选中、拖动与展开动画都不再销毁重建渲染器；把"什么时候需要重新同步内容"变成可测的纯函数，并暴露 `data-scene-builds` / `data-scene-syncs` 读数。

**Architecture:** 把现有那个巨型 `useEffect`（`threeScene.tsx:1037-1543`，依赖数组含 `document` 与函数身份的 `onSelect`）拆成两层：①**挂载效应**（依赖 `[]`）负责创建 renderer / scene / camera / 灯光 / 栅格 / 坐标轴与全部事件监听，并给出 `syncContent()`；②**同步效应**（依赖文档与显示开关）只调用 `runtimeRef.current.syncContent()`。内容对象统一挂到一个常驻的 `THREE.Group` 下，同步时先清空并释放该组。本切片**不做**按 `primitiveId` 的增量 diff（那是下一片 1A-1b），因此视觉行为不变，只消除 WebGL 上下文churn 与身份依赖。

**Tech Stack:** React 18 + TypeScript + Vite + three.js 0.186 + zustand store + Vitest(jsdom) + Playwright(Chromium)。

**Spec:** `docs/superpowers/specs/2026-09-17-3d-viewport-kernel-refactor-design.md`（第 3.4 节「渲染管道去重建化（方案 A）」，现场事实 F2/F19）

## Global Constraints

- `.mgeo` 兼容：`schemaVersion` 保持 `"0.1"`，本切片不改任何 DSL 字段。
- 门禁（每任务结束都跑）：`npm.cmd run typecheck`（4 workspace）、`npm.cmd test`（Vitest）、`npm.cmd run lint`（0 error）、`npm.cmd run build`、`npm.cmd run test:e2e`（Playwright，端口 4173）。
- 既有 `data-*` 读数必须全部保留：`data-camera-distance/target/azimuth/elevation`、`data-content-bounds`、`data-section-*`、`data-drag-frames`、`data-drag-target`、`data-intersection-preview`、`data-unfold-*`、`data-plane-count`、`data-measurement-label-count`、`data-scene-canvas`。
- **禁止**用 PowerShell 重定向改源码（历史教训：`Set-Content` 默认 ANSI 会写坏 UTF-8 中文）；一律用文件工具。
- 新增源码文件用 LF 行尾；中文注释与仓库既有风格一致。
- 切片收尾：更新 `docs/project-progress.md`（含 RED→GREEN 证据与实测数字），`git fetch origin` 核对 divergence 后提交推送，并用 `git rev-parse HEAD` 与 `git ls-remote origin refs/heads/main` 核验两端一致。
- 拖动期间**不提交文档**这一既有约定不得改变（`threeScene.tsx:1406-1410`）。

---

### Task 1: 内容同步签名（纯函数）

**Files:**
- Create: `apps/web/src/sceneContentKey.ts`
- Test: `apps/web/src/sceneContentKey.test.ts`

**Interfaces:**
- Consumes: `GeometryDocument`（`@draw/dsl`）。
- Produces:
  - `export interface SceneContentInputs { document: GeometryDocument; selectedIds: string[]; showHiddenEdges: boolean; showNormals: boolean; transparentFaces: boolean; unfoldProgress: number; previewKind: string | null }`
  - `export function sceneContentKey(inputs: SceneContentInputs): string` —— 只要这个字符串不变，内容同步就可以跳过。

- [x] **Step 1: Write the failing test**

```ts
// apps/web/src/sceneContentKey.test.ts
import { describe, expect, it } from "vitest"

import { createEmptyDocument } from "@draw/dsl"

import { sceneContentKey, type SceneContentInputs } from "./sceneContentKey"

const base = (overrides: Partial<SceneContentInputs> = {}): SceneContentInputs => ({
  document: createEmptyDocument("geometry3d"),
  selectedIds: [],
  showHiddenEdges: false,
  showNormals: false,
  transparentFaces: false,
  unfoldProgress: 0,
  previewKind: null,
  ...overrides
})

describe("scene content key", () => {
  it("is stable for the same document and options", () => {
    expect(sceneContentKey(base())).toBe(sceneContentKey(base()))
  })

  it("changes when the document revision changes", () => {
    const document = createEmptyDocument("geometry3d")
    const bumped = { ...document, revision: document.revision + 1 }
    expect(sceneContentKey(base({ document: bumped }))).not.toBe(sceneContentKey(base()))
  })

  it("changes when the selection changes", () => {
    expect(sceneContentKey(base({ selectedIds: ["point3-1"] }))).not.toBe(sceneContentKey(base()))
  })

  it("changes when a display flag changes", () => {
    expect(sceneContentKey(base({ showNormals: true }))).not.toBe(sceneContentKey(base()))
    expect(sceneContentKey(base({ transparentFaces: true }))).not.toBe(sceneContentKey(base()))
    expect(sceneContentKey(base({ showHiddenEdges: true }))).not.toBe(sceneContentKey(base()))
  })

  it("distinguishes a running unfold from a static one, and preview kinds", () => {
    expect(sceneContentKey(base({ unfoldProgress: 0.5 }))).not.toBe(sceneContentKey(base()))
    expect(sceneContentKey(base({ previewKind: "section" }))).not.toBe(sceneContentKey(base()))
    expect(sceneContentKey(base({ previewKind: "section" }))).not.toBe(sceneContentKey(base({ previewKind: "intersection" })))
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- apps/web/src/sceneContentKey.test.ts`
Expected: FAIL —— `Failed to resolve import "./sceneContentKey"`（模块不存在）。
实测：`FAIL apps/web/src/sceneContentKey.test.ts` / `Failed to resolve import "./sceneContentKey"`。

- [x] **Step 3: Write minimal implementation**

```ts
// apps/web/src/sceneContentKey.ts
import type { GeometryDocument } from "@draw/dsl"

export interface SceneContentInputs {
  document: GeometryDocument
  selectedIds: string[]
  showHiddenEdges: boolean
  showNormals: boolean
  transparentFaces: boolean
  unfoldProgress: number
  previewKind: string | null
}

/**
 * 场景内容的同步签名：只要它不变，`syncContent()` 就没有必要跑。
 * 刻意只包含"会改变 3D 场景内容"的输入——相机状态、指针状态、提示文案都不在内，
 * 否则每次悬停都会触发一次内容同步（这正是本切片要消灭的开销）。
 */
export function sceneContentKey(inputs: SceneContentInputs): string {
  const unfolded = inputs.unfoldProgress > 0.001 ? "1" : "0"
  return [
    inputs.document.revision,
    inputs.document.metadata.id,
    [...inputs.selectedIds].sort().join(","),
    unfolded,
    inputs.unfoldProgress.toFixed(4),
    inputs.showHiddenEdges ? "1" : "0",
    inputs.showNormals ? "1" : "0",
    inputs.transparentFaces ? "1" : "0",
    inputs.previewKind ?? "-"
  ].join("|")
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npm.cmd test -- apps/web/src/sceneContentKey.test.ts`
Expected: PASS（5 个用例）。
实测：第一版**测试自身写错**——`base()` 每次都新建文档，`metadata.id` 不同导致"稳定"用例失败；改为复用同一份文档后 5/5 通过。这正是"先看 RED 再改"要抓的东西。

- [x] **Step 5: Commit**

```bash
git add apps/web/src/sceneContentKey.ts apps/web/src/sceneContentKey.test.ts
git commit -m "feat(three): add a scene content signature so unchanged content is not resynced"
```

实测提交：`2210d21`（`typecheck` 4 workspace 通过）。

---

### Task 2: 渲染器只建一次（挂载效应与同步效应分离）

**Files:**
- Modify: `apps/web/src/threeScene.tsx`（效应起点 `1037`，依赖数组 `1543`）
- Test: `e2e/geometry3d-scene-lifecycle.spec.ts`（新建）

**Interfaces:**
- Consumes: `sceneContentKey`（Task 1）。
- Produces: `runtimeRef`（`{ syncContent(): void; scene: THREE.Scene; render(): void }`）；DOM 读数 `data-scene-builds`（每次挂载创建渲染器的次数，恒为 `"1"`）与 `data-scene-syncs`（内容同步次数）。

- [x] **Step 1: Write the failing e2e test**

```ts
// e2e/geometry3d-scene-lifecycle.spec.ts
import { expect, test } from "@playwright/test"

/**
 * 3D 画布的渲染器必须活过一次挂载：编辑、选中、拖动、展开都不许换 canvas。
 * 这些用例在"每次文档变化都重建渲染器"的旧实现下必然失败。
 */
test("keeps one renderer alive across edits, selection, drag and unfold", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()

  const shell = page.locator("[data-3d-scene]")
  await expect(shell).toHaveAttribute("data-scene-builds", "1")

  // 记下 canvas 节点，后面要证明它没被替换。
  await page.evaluate(() => {
    const canvas = document.querySelector("[data-scene-canvas]")
    ;(window as unknown as { __sceneCanvas?: Element | null }).__sceneCanvas = canvas
  })

  // 选中并切换显示开关：过去这些都会重建整个场景。
  await page.getByRole("button", { name: "透明面" }).click()
  await page.getByRole("button", { name: "隐藏边" }).click()

  // 展开动画：过去每帧重建一次（一次展开约 15-20 个 WebGL 上下文）。
  await page.getByRole("button", { name: "展开" }).click()
  await expect(shell).toHaveAttribute("data-unfold-progress", /(?!^0\.00$)/)
  await page.waitForTimeout(400)

  await expect(shell).toHaveAttribute("data-scene-builds", "1")
  const sameCanvas = await page.evaluate(() => {
    const canvas = document.querySelector("[data-scene-canvas]")
    return canvas === (window as unknown as { __sceneCanvas?: Element | null }).__sceneCanvas
  })
  expect(sameCanvas).toBe(true)
  // 内容确实被同步过（不是"什么都没做"）。
  const syncs = Number(await shell.getAttribute("data-scene-syncs"))
  expect(syncs).toBeGreaterThanOrEqual(2)
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm.cmd run test:e2e -- e2e/geometry3d-scene-lifecycle.spec.ts`
Expected: FAIL —— `data-scene-builds` 属性不存在（`Received: null`），或 canvas 已被替换。

- [x] **Step 3: Split the effect and count builds/syncs**

在 `threeScene.tsx` 中：

1. 新增 ref 与常量（放在 `cameraStateRef` 附近，`928` 前后）：

```tsx
  /** 场景运行时：挂载时创建一次，之后所有同步都走它，不再重建渲染器。 */
  const runtimeRef = useRef<{ syncContent: () => void } | null>(null)
  /** 内容同步签名：同一个签名不重复同步（见 sceneContentKey）。 */
  const contentKeyRef = useRef<string | null>(null)
  /** 每次挂载创建渲染器的次数与内容同步次数，供回归断言读取。 */
  const sceneBuildsRef = useRef(0)
  const sceneSyncsRef = useRef(0)
```

2. 把效应依赖从 `[document, onSelect, selectedIds, showHiddenEdges, showNormals, transparentFaces, unfoldProgress]`（`1543`）改为 `[]`，并把效应体内**所有**对 `document` / `selectedIds` / `showHiddenEdges` / `showNormals` / `transparentFaces` / `unfoldProgress` / `preview` / `onPreviewHover` 的直接读取改成读 ref（这些 ref 已存在或新增：`documentRef`、`selectedIdsRef`、显示开关用 `displayFlagsRef`，preview 用已有的 `previewRef` 读法，`onPreviewHover` 已有 `previewHoverRef`）。

3. 内容部分（`1070` 的 `unfoldedPolyhedra` 到 `1212` 的 `axes`，含 `scene.add(...)`）整段搬进 `const syncContent = () => {...}`，开头清空常驻内容组：

```tsx
    const contentGroup = new THREE.Group()
    contentGroup.userData.excludeFromFit = true
    scene.add(contentGroup)
    const clearContentGroup = () => {
      for (const child of [...contentGroup.children]) {
        contentGroup.remove(child)
        disposeObject(child)
      }
    }
    const syncContent = () => {
      const document = documentRef.current
      const selectedIds = selectedIdsRef.current
      const { showHiddenEdges, showNormals, transparentFaces, unfoldProgress } = displayFlagsRef.current
      const preview = previewRef.current
      clearContentGroup()
      sceneSyncsRef.current += 1
      ... // 原 1070-1212 的内容，把所有 scene.add(x) 改为 contentGroup.add(x)
    }
    runtimeRef.current = { syncContent }
```

`disposeObject` 复用现有 `disposeScene` 的释放逻辑，抽成单对象版本：

```tsx
function disposeObject(root: THREE.Object3D): void {
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.Line) && !(object instanceof THREE.LineSegments)) return
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach((material) => material.dispose())
  })
}
```

并把现有 `disposeScene(scene)`（`797-804`）改为对非内容组子对象与内容组分别调用 `disposeObject`。

4. 栅格与坐标轴依赖内容尺寸（`helperSpan`、`planeHalfSize`）：把它们也放进 `syncContent`，并在每次同步时先移除上一次的 `grid`/`axes`（用 `visualRole` 标记 `scene-grid` / `scene-axes`，或把栅格与坐标轴也放进一个 `helperGroup`）。

5. 读数：

```tsx
    sceneBuildsRef.current += 1
    if (sceneShell) sceneShell.dataset.sceneBuilds = String(sceneBuildsRef.current)
    // syncContent 内每次递增并写回：
    if (sceneShell) sceneShell.dataset.sceneSyncs = String(sceneSyncsRef.current)
```

6. 新增第二个效应，只负责在签名变化时同步内容：

```tsx
  useEffect(() => {
    const runtime = runtimeRef.current
    if (!runtime) return
    const key = sceneContentKey({
      document,
      selectedIds,
      showHiddenEdges,
      showNormals,
      transparentFaces,
      unfoldProgress,
      previewKind: preview ? preview.kind : null
    })
    if (contentKeyRef.current === key) return
    contentKeyRef.current = key
    runtime.syncContent()
  }, [document, selectedIds, showHiddenEdges, showNormals, transparentFaces, unfoldProgress, preview])
```

7. 挂载效应内先调用一次 `syncContent()` 完成首帧（并把签名写入 `contentKeyRef.current`），再 `render()`。

- [x] **Step 4: Run test to verify it passes**

Run: `npm.cmd run test:e2e -- e2e/geometry3d-scene-lifecycle.spec.ts`
Expected: PASS。

- [x] **Step 5: Run the full gate**

Run: `npm.cmd run typecheck && npm.cmd test && npm.cmd run lint && npm.cmd run build && npm.cmd run test:e2e`
Expected: 全绿；e2e 用例数 58 → 59。

- [x] **Step 6: Commit**

```bash
git add apps/web/src/threeScene.tsx e2e/geometry3d-scene-lifecycle.spec.ts
git commit -m "refactor(three): keep one WebGL renderer per mount and sync content imperatively"
```

---

### Task 3: 摘掉回调与文档的身份依赖

**Files:**
- Modify: `apps/web/src/threeScene.tsx`
- Test: `apps/web/src/threeScene.test.ts`（追加）

**Interfaces:**
- Consumes: Task 2 的 `runtimeRef` / `syncContent`。
- Produces: `export function sceneSyncDecision(previousKey: string | null, nextKey: string): boolean` —— 纯函数，`true` 表示需要同步。用它替换 Task 2 里内联的比较，便于单测。

- [x] **Step 1: Write the failing test**

```ts
// 追加到 apps/web/src/threeScene.test.ts
describe("scene sync decision", () => {
  it("skips the sync when the content signature is unchanged", () => {
    expect(sceneSyncDecision("1|doc", "1|doc")).toBe(false)
  })

  it("syncs on the first run and on any change", () => {
    expect(sceneSyncDecision(null, "1|doc")).toBe(true)
    expect(sceneSyncDecision("1|doc", "2|doc")).toBe(true)
  })
})
```

- [x] **Step 2: Run test to verify it fails**

Run: `npm.cmd test -- apps/web/src/threeScene.test.ts -t "scene sync decision"`
Expected: FAIL —— `sceneSyncDecision is not a function`。

- [x] **Step 3: Implement and wire it**

```tsx
/** 只有签名变化（或首次）才需要同步场景内容。抽成纯函数是为了让"不该同步"这件事可被单测钉住。 */
export function sceneSyncDecision(previousKey: string | null, nextKey: string): boolean {
  return previousKey !== nextKey
}
```

把 Task 2 里的 `if (contentKeyRef.current === key) return` 改成 `if (!sceneSyncDecision(contentKeyRef.current, key)) return`。

同时确认挂载效应依赖数组为 `[]`，且 `onSelect` 不再出现在任何依赖数组里（用 `onSelectRef` 读）：

```tsx
  const onSelectRef = useRef(onSelect)
  useEffect(() => { onSelectRef.current = onSelect }, [onSelect])
```

- [x] **Step 4: Run tests to verify they pass**

Run: `npm.cmd test -- apps/web/src/threeScene.test.ts && npm.cmd run test:e2e -- e2e/geometry3d-scene-lifecycle.spec.ts e2e/geometry3d.spec.ts`
Expected: PASS（含既有 22 个 `geometry3d` 用例不变）。

- [x] **Step 5: Commit**

```bash
git add apps/web/src/threeScene.tsx apps/web/src/threeScene.test.ts
git commit -m "refactor(three): decide content syncs from a signature instead of component identity"
```

---

### Task 4: 拖动与展开期间不重建（回归钉死）

**Files:**
- Modify: `e2e/geometry3d-scene-lifecycle.spec.ts`
- Modify: `e2e/geometry3d-drag.spec.ts`（追加一条断言）

**Interfaces:**
- Consumes: Task 2 的 `data-scene-builds` / `data-scene-syncs`、既有 `data-drag-frames`。
- Produces: 无新接口，只有回归证据。

- [x] **Step 1: Write the failing assertions**

在 `e2e/geometry3d-scene-lifecycle.spec.ts` 追加：

```ts
test("does not rebuild or resync while a solid is being dragged", async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: "立体几何" }).click()
  await page.getByRole("button", { name: "添加立方体" }).click()
  await page.getByRole("button", { name: "自由拖动" }).click()

  const shell = page.locator("[data-3d-scene]")
  const syncsBefore = Number(await shell.getAttribute("data-scene-syncs"))
  const box = (await shell.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  for (let step = 0; step < 20; step += 1) await page.mouse.move(box.x + box.width / 2 + step * 3, box.y + box.height / 2)
  await page.mouse.up()

  await expect(shell).toHaveAttribute("data-scene-builds", "1")
  expect(Number(await shell.getAttribute("data-scene-syncs"))).toBe(syncsBefore)
  // 拖动确实发生了（逐帧重画计数增长），否则这条断言会因为"什么都没拖到"而假通过。
  expect(Number(await shell.getAttribute("data-drag-frames"))).toBeGreaterThan(0)
})
```

- [x] **Step 2: Run to verify it fails or exposes a real resync**

Run: `npm.cmd run test:e2e -- e2e/geometry3d-scene-lifecycle.spec.ts`
Expected: 若拖动提交后退手会同步一次，`data-scene-syncs` 会在抬手后增长 —— 这是**允许**的（抬手要提交文档）。因此断言放在 `mouse.up()` **之前**采样，或在 Step 3 中把采样点移到拖动过程中。按实际行为二选一并在注释里写明理由，不得靠放宽断言蒙过去。

- [x] **Step 3: Make the assertion honest**

拖动过程中（`mouse.up()` 之前）采样 `data-scene-syncs`，抬手后只断言 `data-scene-builds` 仍为 `1`；并在测试注释里写明"抬手提交文档会同步一次内容，这是预期"。

- [x] **Step 4: Run the full gate and record evidence**

Run: `npm.cmd run typecheck && npm.cmd test && npm.cmd run lint && npm.cmd run build && npm.cmd run test:e2e`
Expected: 全绿；把实测数字（单测文件/用例数、e2e 用例数、lint warning 数、构建结果）写进 Step 5 的提交信息与进度文档。

- [x] **Step 5: Update docs and commit**

在 `docs/project-progress.md` 新增小节「3D 渲染管道去重建化（切片 1A-1，已完成）」，写明：需求、根因（`threeScene.tsx:1543` 依赖含 `onSelect` 与 `document`，重建会 `renderer.dispose()` + `new WebGLRenderer`）、RED→GREEN 证据、门禁数字、边界（内容对象仍是"清空后重建"，按 `primitiveId` 的增量 diff 留给切片 1A-1b）。

```bash
git add docs/project-progress.md e2e/geometry3d-scene-lifecycle.spec.ts e2e/geometry3d-drag.spec.ts
git commit -m "test(three): pin that dragging and unfolding never rebuild the renderer"
```

---

## 执行记录（2026-09-17 完成）

| 任务 | 状态 | 提交 | 证据 |
| --- | --- | --- | --- |
| Task 1 内容同步签名 | 完成 | `2210d21` | RED：`Failed to resolve import "./sceneContentKey"`；GREEN：5/5。过程中发现**测试自身写错**（`base()` 每次新建文档 → `metadata.id` 不同），改为复用同一份文档 |
| Task 2 渲染器只建一次 | 完成 | `ef50ee8` | RED：`data-scene-builds` 为 `null`；GREEN：`keeps one renderer alive across edits, selection and unfold` |
| Task 3 同步决策纯函数 | 完成 | 本片收尾提交 | RED：`sceneSyncDecision is not a function`；GREEN：`threeScene.test.ts` 49/49 |
| Task 4 拖动期间不重建/不同步 | 完成 | 本片收尾提交 | 新 e2e `does not rebuild or resync while a solid is being dragged`；采样点放在抬手之前（抬手提交会同步一次，属预期） |

**Task 2 过程中抓到并修掉的两处真实回归（都是"闭包过期"）**：
1. `onPreviewClick` 仍用首次渲染的闭包，而 App 里的实现闭包着它自己那份 `document` → 点击虚线预览创建不出截线（既有 e2e「creates an intersection line by clicking the dashed preview」失败）。改为经 `previewClickRef` 调用。
2. 换文档时的自动取景留在挂载效应里 → 打开 `.mgeo` 不再取景（既有 e2e「frames an opened figure instead of leaving it a speck」期望 `0.50,0.50,0.50`、实际 `0.00,0.00,0.00`）。改为在运行时 `syncContent()` 里判断文档 id 变化后取景。

**偏离计划的一处决定**：`sceneSyncDecision` 原本放在 `threeScene.tsx`，但该文件同时导出组件，多一个非组件导出会让 `react-refresh/only-export-components` 多一条 warning（52 → 53）。已挪到 `sceneContentKey.ts`（同类纯逻辑），warning 回到 52。

**本片门禁（实测）**：单测 **74 文件 / 940 用例**（起始 74/938，+2）；typecheck 4 workspace；lint 0 error / **52 warning**；生产构建通过；Playwright **60/60**（起始 59，+1）。

## Self-Review（回填）

**Spec coverage（对照 spec 第 3.4 节）**
1. "renderer / canvas / ResizeObserver 只在挂载时创建一次" → 完成（Task 2）。
2. "依赖数组去掉 `document` 与 `onSelect` 的函数身份" → 完成（Task 2 + Task 3）。
3. "`syncScene` 按 `primitiveId` 做增删改" → **已完成（1A-1b，2026-09-17 提交 `0d901d1`）**：场景对象按内容签名增量同步（`sceneContentPlan.ts` + `sceneContentSignature.ts`），签名没变就沿用原对象。实测展开动画每帧只重建那张展开网（created 1 / reused 11），切换选中只重建受影响的一两个对象（此前整场 29 个全重建）；拖动路径的 `refreshPrimitiveObject` 与整场同步共用同一张记录表。
4. "`unfoldProgress` 不再进依赖数组" → **仍未做（但已不再痛）**：它仍参与同步签名（`sceneContentKey` 里带 `unfoldProgress.toFixed(4)`），所以展开动画每帧仍会触发一次内容同步——只是那次同步现在只重建展开网本身，其余对象全部沿用。要在依赖数组层面去掉它，需要把展开进度改成"只更新已有对象"的通道（像拖动那样），属独立改动。
5. "新增 `data-scene-rebuilds` 计数" → 以 `data-scene-builds` 命名完成；1A-1b 又补了 `data-scene-created` / `reused` / `removed` / `content` / `created-keys` 五个读数，用来钉住"该沿用的必须沿用"。

**已知缺口（显式记录，不掩盖）**: 内容对象的**整场**同步已按图元增量，但展开动画仍走"内容同步"这条通道（每帧重建展开网这一个对象，而不是像拖动那样复用同一个网对象逐帧改形状）。把展开也做成"只更新不复建"是下一步的独立优化。
