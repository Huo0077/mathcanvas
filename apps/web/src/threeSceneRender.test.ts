import { describe, expect, it } from "vitest"
import * as THREE from "three"

import { applyCameraState, createCameraState } from "./threeCamera"
import { createThreeSceneRender } from "./threeSceneRender"
import { canvasEvidenceOf, type CanvasEvidence } from "./canvasEvidence"
import { createEmptyDocument } from "@draw/dsl"

describe("3D overlay projection", () => {
  it("places a vertex label using the current camera even when no grid refreshes its matrices", () => {
    const camera = new THREE.PerspectiveCamera(42, 800 / 600, 0.1, 1000)
    const state = createCameraState()
    applyCameraState(camera, state)
    camera.updateMatrixWorld(true)
    const cameraStateRef = { current: state }
    const labelOverlay = document.createElement("div")
    const measurementOverlay = document.createElement("div")
    const renderer = {
      domElement: { getBoundingClientRect: () => ({ width: 800, height: 600 }) },
      // Three.js normally synchronises the camera while rendering; this happens too late for overlays.
      render: (_scene: THREE.Scene, currentCamera: THREE.Camera) => currentCamera.updateMatrixWorld()
    } as unknown as THREE.WebGLRenderer
    const point = { id: "vertex-a", type: "point3" as const, label: "A", position: { x: 2, y: 1, z: 0 }, binding: { kind: "free" as const } }
    const { render } = createThreeSceneRender({
      renderer, scene: new THREE.Scene(), camera, cameraStateRef,
      sceneShell: document.createElement("div"), autoFitRef: { current: false }, selectedIdsRef: { current: [] as string[] },
      measurementOverlayRef: { current: measurementOverlay }, pointLabelOverlayRef: { current: labelOverlay },
      measurementVisuals: [{ id: "volume", kind: "label", sourceIds: [], label: "48.000u³", position: point.position, segments: [] }], visiblePointLabels: [point], objectIndex: new Map(), pointHandles: [], viewport: { height: 600 },
      curveToleranceBucketRef: { current: 0 }, setCurveToleranceBucket: () => undefined,
      applyGridPlacement: () => undefined
    })
    render()

    const rotated = { ...state, azimuth: state.azimuth + 30 }
    cameraStateRef.current = rotated
    applyCameraState(camera, rotated)
    render()

    const actual = Number.parseFloat((labelOverlay.querySelector('[data-point-id="vertex-a"]') as HTMLElement).style.left)
    const projected = new THREE.Vector3(point.position.x, point.position.y, point.position.z).project(camera)
    const expected = (projected.x * 0.5 + 0.5) * 800 + 10
    expect(Math.abs(actual - expected)).toBeLessThan(0.5)
    const volumeLeft = Number.parseFloat((measurementOverlay.querySelector('[data-measurement-id="volume"]') as HTMLElement).style.left)
    expect(Math.abs(volumeLeft - (expected - 10))).toBeLessThan(0.5)
  })
})


it("publishes evidence after the final camera frame without a React render", () => {
  const camera = new THREE.PerspectiveCamera(42, 800 / 600, 0.1, 1000)
  camera.position.set(0, 0, 10)
  camera.lookAt(0, 0, 0)
  const point = { id: "a", type: "point3" as const, position: { x: 0, y: 0, z: 0 }, label: "A" }
  const geometry = createEmptyDocument("geometry3d")
  geometry.primitives.push(point)
  const shell = document.createElement("div")
  const labels = document.createElement("div")
  shell.append(labels)
  const snapshots: CanvasEvidence[] = []
  let painted = 0
  shell.addEventListener("mathcanvas:three-frame", () => {
    expect(painted).toBe(snapshots.length + 1)
    snapshots.push(canvasEvidenceOf({ document: geometry, root: labels, viewport: { width: 800, height: 600 }, objectsMeasurable: false }))
  })
  const renderer = {
    domElement: { getBoundingClientRect: () => ({ width: 800, height: 600 }) },
    render: () => { painted += 1 }
  } as unknown as THREE.WebGLRenderer
  const { render } = createThreeSceneRender({
    renderer, scene: new THREE.Scene(), camera, cameraStateRef: { current: createCameraState() },
    sceneShell: shell, autoFitRef: { current: false }, selectedIdsRef: { current: [] },
    measurementOverlayRef: { current: null }, pointLabelOverlayRef: { current: labels },
    measurementVisuals: [], visiblePointLabels: [point], objectIndex: new Map(), pointHandles: [], viewport: { height: 600 },
    curveToleranceBucketRef: { current: 0 }, setCurveToleranceBucket: () => undefined, applyGridPlacement: () => undefined
  })
  render()
  expect(snapshots).toHaveLength(1)
  expect(snapshots[0].hiddenLabels).toEqual([])
  expect(snapshots[0].boxes).toHaveLength(1)
  camera.lookAt(0, 0, 20)
  render()
  expect(labels.querySelector<HTMLElement>("[data-point-id]")?.hidden).toBe(true)
  expect(snapshots).toHaveLength(2)
  expect(snapshots[1].hiddenLabels).toEqual(["A"])
  expect(snapshots[1].boxes).toEqual([])
  // A view-only change must not pretend that geometry changed.
  expect(snapshots[1].documentHash).toBe(snapshots[0].documentHash)
  camera.lookAt(0, 0, 0)
  render()
  expect(snapshots[2].hiddenLabels).toEqual([])
  expect(snapshots[2].boxes).toHaveLength(1)
})
