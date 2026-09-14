import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import type { CubePrimitive, GeometryDocument } from "@draw/dsl"

import { opacityFor, strokeFor } from "./primitiveStyle"

const scenePalette = {
  background: "#fbfcff",
  grid: "#d9deea"
} as const

export function createCubeMesh(primitive: CubePrimitive, selected: boolean): THREE.Mesh {
  const geometry = new THREE.BoxGeometry(primitive.size.x, primitive.size.y, primitive.size.z)
  const opacity = opacityFor(primitive)
  const material = new THREE.MeshStandardMaterial({
    color: primitive.style?.fill ?? strokeFor(primitive),
    emissive: selected ? primitive.style?.stroke ?? strokeFor(primitive) : "#000000",
    emissiveIntensity: selected ? 0.28 : 0,
    roughness: 0.72,
    metalness: 0.04,
    transparent: opacity < 1,
    opacity: Math.min(1, opacity * 0.72),
    side: THREE.DoubleSide
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(
    primitive.origin.x + primitive.size.x / 2,
    primitive.origin.y + primitive.size.y / 2,
    primitive.origin.z + primitive.size.z / 2
  )
  mesh.userData.primitiveId = primitive.id
  mesh.userData.primitiveType = primitive.type
  return mesh
}

function cubeOutline(mesh: THREE.Mesh, primitive: CubePrimitive, selected: boolean): THREE.LineSegments {
  const geometry = new THREE.EdgesGeometry(mesh.geometry)
  const material = new THREE.LineBasicMaterial({
    color: selected ? "#4c3ac7" : primitive.style?.stroke ?? strokeFor(primitive),
    transparent: opacityFor(primitive) < 1,
    opacity: opacityFor(primitive)
  })
  const outline = new THREE.LineSegments(geometry, material)
  outline.position.copy(mesh.position)
  outline.userData.primitiveId = primitive.id
  return outline
}

function visibleCubes(document: GeometryDocument): CubePrimitive[] {
  return document.primitives.filter((primitive): primitive is CubePrimitive => primitive.type === "cube" && primitive.visible !== false)
}

function disposeScene(scene: THREE.Scene): void {
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh) && !(object instanceof THREE.LineSegments)) return
    object.geometry.dispose()
    const materials = Array.isArray(object.material) ? object.material : [object.material]
    materials.forEach((material) => material.dispose())
  })
}

export interface ThreeSceneViewProps {
  document: GeometryDocument
  selectedIds: string[]
  onSelect: (id: string | null, additive?: boolean) => void
}

export function ThreeSceneView({ document, selectedIds, onSelect }: ThreeSceneViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [webglAvailable, setWebglAvailable] = useState(true)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(scenePalette.background)
    const width = Math.max(container.clientWidth, 320)
    const height = Math.max(container.clientHeight, 480)
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.1, 1000)
    camera.position.set(8, 7, 9)
    camera.lookAt(0, 0, 0)

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    } catch {
      setWebglAvailable(false)
      return
    }
    setWebglAvailable(true)
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2))
    renderer.setSize(width, height, false)
    renderer.domElement.setAttribute("role", "img")
    renderer.domElement.setAttribute("aria-label", "3D 几何画布")
    renderer.domElement.dataset.sceneCanvas = "true"
    container.replaceChildren(renderer.domElement)

    scene.add(new THREE.AmbientLight("#ffffff", 1.7))
    const keyLight = new THREE.DirectionalLight("#ffffff", 2.4)
    keyLight.position.set(6, 10, 8)
    scene.add(keyLight)
    scene.add(new THREE.GridHelper(14, 14, scenePalette.grid, scenePalette.grid))
    scene.add(new THREE.AxesHelper(5))

    visibleCubes(document).forEach((primitive) => {
      const selected = selectedIds.includes(primitive.id)
      const mesh = createCubeMesh(primitive, selected)
      scene.add(mesh)
      scene.add(cubeOutline(mesh, primitive, selected))
    })

    const render = () => renderer.render(scene, camera)
    render()
    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => {
      const nextWidth = Math.max(container.clientWidth, 320)
      const nextHeight = Math.max(container.clientHeight, 480)
      camera.aspect = nextWidth / nextHeight
      camera.updateProjectionMatrix()
      renderer.setSize(nextWidth, nextHeight, false)
      render()
    })
    resizeObserver?.observe(container)

    const handleClick = (event: MouseEvent) => {
      if (event.target === renderer.domElement) onSelect(null)
    }
    renderer.domElement.addEventListener("click", handleClick)
    return () => {
      renderer.domElement.removeEventListener("click", handleClick)
      resizeObserver?.disconnect()
      disposeScene(scene)
      renderer.dispose()
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement)
    }
  }, [document, onSelect, selectedIds])

  return <div className="three-canvas-shell" ref={containerRef} data-3d-scene="true" aria-label="3D 几何场景">{!webglAvailable && <div className="three-scene-status" role="status">当前浏览器不支持 WebGL，无法显示 3D 场景。</div>}{webglAvailable && document.primitives.filter((primitive) => primitive.type === "cube").length === 0 && <div className="three-scene-status" role="status">添加立方体开始探索三维空间。</div>}</div>
}
