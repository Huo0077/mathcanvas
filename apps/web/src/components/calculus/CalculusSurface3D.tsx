import { useEffect, useRef, useState } from "react"
import * as THREE from "three"

import type {
  Point3D,
  Surface3DAnalysis,
  SurfaceStationaryPoint,
  TangentPlaneInfo
} from "@draw/geometry-kernel"

export interface CalculusSurface3DProps {
  surface: Surface3DAnalysis | null
  wireframe?: boolean
  surfaceOpacity?: number
  sliceZ?: number | null
  sliceTangent?: boolean
  stationaryPoints?: SurfaceStationaryPoint[]
  focusedStationaryIndex?: number | null
  tangentPlane?: TangentPlaneInfo | null
  liftedCurves?: Point3D[][]
  highlightPoint?: Point3D | null
  lagrangePoints?: Array<{ x: number; y: number; z: number; isMax: boolean; isMin: boolean }>
}

function heightColorRGB(t: number): [number, number, number] {
  const c = Math.max(0, Math.min(1, t))
  // Editorial scientific colormap: deep indigo -> cerulean -> teal -> warm amber -> coral
  const stops: Array<[number, number, number]> = [
    [0.24, 0.30, 0.65],
    [0.16, 0.52, 0.82],
    [0.15, 0.68, 0.62],
    [0.92, 0.68, 0.24],
    [0.86, 0.27, 0.24]
  ]
  const scaled = c * (stops.length - 1)
  const idx = Math.min(stops.length - 2, Math.floor(scaled))
  const u = scaled - idx
  const a = stops[idx]!
  const b = stops[idx + 1]!
  return [
    a[0] + (b[0] - a[0]) * u,
    a[1] + (b[1] - a[1]) * u,
    a[2] + (b[2] - a[2]) * u
  ]
}

interface OrbitState {
  theta: number
  phi: number
  radius: number
}

const DEFAULT_ORBIT: OrbitState = {
  theta: Math.PI * 0.26,
  phi: Math.PI * 0.33,
  radius: 7.4
}

export function CalculusSurface3D({
  surface,
  wireframe = true,
  surfaceOpacity = 0.88,
  sliceZ = null,
  sliceTangent = false,
  stationaryPoints,
  focusedStationaryIndex = null,
  tangentPlane = null,
  liftedCurves,
  highlightPoint = null,
  lagrangePoints
}: CalculusSurface3DProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [webglUnavailable, setWebglUnavailable] = useState(false)
  const orbitRef = useRef<OrbitState>({ ...DEFAULT_ORBIT })
  const dragRef = useRef<{ x: number; y: number; theta: number; phi: number } | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const contentGroupRef = useRef<THREE.Group | null>(null)

  const syncCamera = () => {
    const cam = cameraRef.current
    const renderer = rendererRef.current
    const scene = sceneRef.current
    if (!cam || !renderer || !scene) return
    const { theta, phi, radius } = orbitRef.current
    // Three.js uses Y-up; we map math (x, y, z) -> Three (x, z, -y) so math Z points UP!
    cam.position.set(
      radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta)
    )
    cam.lookAt(0, 0, 0)
    renderer.render(scene, cam)
  }

  // Initialize Three.js renderer + lights + scene once
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let renderer: THREE.WebGLRenderer
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false })
    } catch {
      setWebglUnavailable(true)
      return
    }

    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1))
    renderer.setClearColor(0xf8fafc, 1)
    const rect = container.getBoundingClientRect()
    const w = Math.max(120, Math.round(rect.width || 520))
    const h = Math.max(120, Math.round(rect.height || 380))
    renderer.setSize(w, h)
    renderer.domElement.className = "calculus-canvas"
    renderer.domElement.setAttribute("aria-label", "三维曲面交互视口")
    container.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 100)

    const ambient = new THREE.AmbientLight(0xffffff, 0.72)
    const dir1 = new THREE.DirectionalLight(0xffffff, 0.75)
    dir1.position.set(6, 10, 7)
    const dir2 = new THREE.DirectionalLight(0xdbeafe, 0.4)
    dir2.position.set(-6, -4, -5)
    scene.add(ambient, dir1, dir2)

    const group = new THREE.Group()
    scene.add(group)

    rendererRef.current = renderer
    sceneRef.current = scene
    cameraRef.current = camera
    contentGroupRef.current = group

    const handleResize = () => {
      const r = container.getBoundingClientRect()
      if (r.width < 20 || r.height < 20) return
      camera.aspect = r.width / r.height
      camera.updateProjectionMatrix()
      renderer.setSize(Math.round(r.width), Math.round(r.height))
      syncCamera()
    }

    let ro: ResizeObserver | null = null
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(handleResize)
      ro.observe(container)
    }
    syncCamera()

    return () => {
      ro?.disconnect()
      renderer.dispose()
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement)
      }
      rendererRef.current = null
      sceneRef.current = null
      cameraRef.current = null
      contentGroupRef.current = null
    }
  }, [])

  // Rebuild 3D math geometry whenever surface/overlay props change
  useEffect(() => {
    const group = contentGroupRef.current
    if (!group || !surface) return

    // Dispose old meshes cleanly
    while (group.children.length > 0) {
      const child = group.children[0]!
      group.remove(child)
      if (child instanceof THREE.Mesh || child instanceof THREE.Line || child instanceof THREE.LineSegments) {
        child.geometry.dispose()
        if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose())
        else child.material.dispose()
      }
    }

    const { bounds, gridSize, zGrid, zMin, zMax } = surface
    const cx = 0.5 * (bounds.xMin + bounds.xMax)
    const cy = 0.5 * (bounds.yMin + bounds.yMax)
    const cz = 0.5 * (zMin + zMax)
    const spanX = Math.max(1e-4, bounds.xMax - bounds.xMin)
    const spanY = Math.max(1e-4, bounds.yMax - bounds.yMin)
    const spanZ = Math.max(1e-4, zMax - zMin)

    // Normalize into a clean [-2, 2] x [-2, 2] x [-1.35, 1.35] box for comfortable orbiting
    const scaleXY = 4.0 / Math.max(spanX, spanY)
    const scaleZ = 2.6 / spanZ
    const toThree = (x: number, y: number, z: number): THREE.Vector3 => {
      const clampedZ = Math.max(zMin - spanZ * 0.25, Math.min(zMax + spanZ * 0.25, z))
      return new THREE.Vector3(
        (x - cx) * scaleXY,
        (clampedZ - cz) * scaleZ,
        -(y - cy) * scaleXY
      )
    }

    // 1. Ground reference grid + axes
    const gridHelper = new THREE.GridHelper(4.4, 12, 0xcbd5e1, 0xe2e8f0)
    gridHelper.position.y = -1.45
    group.add(gridHelper)

    const addAxisLine = (a: THREE.Vector3, b: THREE.Vector3, color: number) => {
      const geom = new THREE.BufferGeometry().setFromPoints([a, b])
      const mat = new THREE.LineBasicMaterial({ color })
      group.add(new THREE.Line(geom, mat))
    }
    addAxisLine(new THREE.Vector3(-2.3, -1.45, 0), new THREE.Vector3(2.3, -1.45, 0), 0xef4444) // X
    addAxisLine(new THREE.Vector3(0, -1.45, 2.3), new THREE.Vector3(0, -1.45, -2.3), 0x10b981) // Y
    addAxisLine(new THREE.Vector3(0, -1.45, 0), new THREE.Vector3(0, 1.75, 0), 0x3b82f6)       // Z

    // 2. Explicit surface mesh z = f(x, y)
    const cols = gridSize + 1
    const positions: number[] = []
    const colors: number[] = []
    const indices: number[] = []
    const dx = spanX / gridSize
    const dy = spanY / gridSize

    for (let j = 0; j <= gridSize; j += 1) {
      const y = bounds.yMin + j * dy
      for (let i = 0; i <= gridSize; i += 1) {
        const x = bounds.xMin + i * dx
        const z = zGrid[j * cols + i]!
        const validZ = Number.isFinite(z) ? z : cz
        const p = toThree(x, y, validZ)
        positions.push(p.x, p.y, p.z)
        const t = (validZ - zMin) / spanZ
        const [r, g, b] = heightColorRGB(t)
        colors.push(r, g, b)
      }
    }

    for (let j = 0; j < gridSize; j += 1) {
      for (let i = 0; i < gridSize; i += 1) {
        const i0 = j * cols + i
        const i1 = i0 + 1
        const i2 = (j + 1) * cols + i
        const i3 = i2 + 1
        if (
          !Number.isFinite(zGrid[i0]!) ||
          !Number.isFinite(zGrid[i1]!) ||
          !Number.isFinite(zGrid[i2]!) ||
          !Number.isFinite(zGrid[i3]!)
        ) {
          continue
        }
        indices.push(i0, i1, i3, i0, i3, i2)
      }
    }

    const surfGeom = new THREE.BufferGeometry()
    surfGeom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
    surfGeom.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3))
    surfGeom.setIndex(indices)
    surfGeom.computeVertexNormals()

    const surfMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.42,
      metalness: 0.04,
      side: THREE.DoubleSide,
      transparent: surfaceOpacity < 0.99,
      opacity: surfaceOpacity
    })
    group.add(new THREE.Mesh(surfGeom, surfMat))

    // Optional clean coarse grid lines on surface
    if (wireframe) {
      const wirePts: THREE.Vector3[] = []
      const stride = Math.max(1, Math.round(gridSize / 16))
      for (let j = 0; j <= gridSize; j += stride) {
        const y = bounds.yMin + j * dy
        for (let i = 0; i < gridSize; i += 1) {
          const z0 = zGrid[j * cols + i]!
          const z1 = zGrid[j * cols + i + 1]!
          if (!Number.isFinite(z0) || !Number.isFinite(z1)) continue
          wirePts.push(toThree(bounds.xMin + i * dx, y, z0), toThree(bounds.xMin + (i + 1) * dx, y, z1))
        }
      }
      for (let i = 0; i <= gridSize; i += stride) {
        const x = bounds.xMin + i * dx
        for (let j = 0; j < gridSize; j += 1) {
          const z0 = zGrid[j * cols + i]!
          const z1 = zGrid[(j + 1) * cols + i]!
          if (!Number.isFinite(z0) || !Number.isFinite(z1)) continue
          wirePts.push(toThree(x, bounds.yMin + j * dy, z0), toThree(x, bounds.yMin + (j + 1) * dy, z1))
        }
      }
      if (wirePts.length > 0) {
        const wGeom = new THREE.BufferGeometry().setFromPoints(wirePts)
        const wMat = new THREE.LineBasicMaterial({ color: 0x1e293b, transparent: true, opacity: 0.16 })
        group.add(new THREE.LineSegments(wGeom, wMat))
      }
    }

    // 3. Optional horizontal cutting plane z = sliceZ
    if (sliceZ !== null && Number.isFinite(sliceZ)) {
      const planeGeom = new THREE.PlaneGeometry(spanX * scaleXY, spanY * scaleXY)
      planeGeom.rotateX(-Math.PI / 2)
      const planeMat = new THREE.MeshBasicMaterial({
        color: sliceTangent ? 0x10b981 : 0xf59e0b,
        transparent: true,
        opacity: sliceTangent ? 0.28 : 0.2,
        side: THREE.DoubleSide,
        depthWrite: false
      })
      const planeMesh = new THREE.Mesh(planeGeom, planeMat)
      planeMesh.position.y = (Math.max(zMin - spanZ * 0.25, Math.min(zMax + spanZ * 0.25, sliceZ)) - cz) * scaleZ
      group.add(planeMesh)
    }

    // 4. Lifted 3D Lagrange constraint curves (x, y, f(x, y))
    if (liftedCurves && liftedCurves.length > 0) {
      for (const curve of liftedCurves) {
        if (curve.length < 2) continue
        const pts = curve.map((pt) => toThree(pt.x, pt.y, pt.z))
        const curveObj = new THREE.CatmullRomCurve3(pts)
        const tubeGeom = new THREE.TubeGeometry(curveObj, Math.min(180, pts.length * 2), 0.042, 8, false)
        const tubeMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.35 })
        group.add(new THREE.Mesh(tubeGeom, tubeMat))
      }
    }

    // 5. Stationary points on standalone 3D surface
    const pointsToMark = stationaryPoints ?? surface.stationaryPoints
    if (!liftedCurves) {
      pointsToMark.forEach((sp, idx) => {
        const isFocused = focusedStationaryIndex === idx
        const radius = isFocused ? 0.13 : 0.095
        const geom = sp.kind === "saddle"
          ? new THREE.OctahedronGeometry(radius * 1.15)
          : new THREE.SphereGeometry(radius, 18, 18)
        const color = sp.kind === "local_max"
          ? 0xdc2626
          : sp.kind === "local_min"
            ? 0x059669
            : sp.kind === "saddle"
              ? 0x7c3aed
              : 0x64748b
        const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.25 })
        const mesh = new THREE.Mesh(geom, mat)
        mesh.position.copy(toThree(sp.x, sp.y, sp.z))
        group.add(mesh)
      })
    }

    // 6. Optional local tangent plane patch
    if (tangentPlane) {
      const patchR = Math.min(spanX, spanY) * 0.22
      const corners = [
        [tangentPlane.x - patchR, tangentPlane.y - patchR],
        [tangentPlane.x + patchR, tangentPlane.y - patchR],
        [tangentPlane.x + patchR, tangentPlane.y + patchR],
        [tangentPlane.x - patchR, tangentPlane.y + patchR]
      ].map(([px, py]) => {
        const pz = tangentPlane.z + tangentPlane.fx * (px! - tangentPlane.x) + tangentPlane.fy * (py! - tangentPlane.y)
        return toThree(px!, py!, pz)
      })
      const tpGeom = new THREE.BufferGeometry().setFromPoints([
        corners[0]!, corners[1]!, corners[2]!,
        corners[0]!, corners[2]!, corners[3]!
      ])
      tpGeom.computeVertexNormals()
      const tpMat = new THREE.MeshBasicMaterial({
        color: 0x2563eb,
        transparent: true,
        opacity: 0.34,
        side: THREE.DoubleSide,
        depthWrite: false
      })
      group.add(new THREE.Mesh(tpGeom, tpMat))
    }

    // 7. Lagrange stationary points & active moving point P(x, y, f(P))
    if (lagrangePoints) {
      for (const lp of lagrangePoints) {
        const geom = new THREE.SphereGeometry(0.085, 16, 16)
        const color = lp.isMax ? 0xdc2626 : lp.isMin ? 0x059669 : 0xea580c
        const mesh = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color }))
        mesh.position.copy(toThree(lp.x, lp.y, lp.z))
        group.add(mesh)
      }
    }
    if (highlightPoint && Number.isFinite(highlightPoint.z)) {
      const geom = new THREE.SphereGeometry(0.125, 20, 20)
      const mat = new THREE.MeshStandardMaterial({
        color: sliceTangent ? 0x10b981 : 0xf59e0b,
        emissive: sliceTangent ? 0x065f46 : 0x92400e,
        emissiveIntensity: 0.35
      })
      const mesh = new THREE.Mesh(geom, mat)
      mesh.position.copy(toThree(highlightPoint.x, highlightPoint.y, highlightPoint.z))
      group.add(mesh)
    }

    syncCamera()
  }, [
    surface,
    wireframe,
    surfaceOpacity,
    sliceZ,
    sliceTangent,
    stationaryPoints,
    focusedStationaryIndex,
    tangentPlane,
    liftedCurves,
    highlightPoint,
    lagrangePoints
  ])

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      theta: orbitRef.current.theta,
      phi: orbitRef.current.phi
    }
  }

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    if (!drag) return
    const dx = e.clientX - drag.x
    const dy = e.clientY - drag.y
    orbitRef.current.theta = drag.theta + dx * 0.009
    orbitRef.current.phi = Math.max(0.12, Math.min(Math.PI - 0.12, drag.phi - dy * 0.008))
    syncCamera()
  }

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
    dragRef.current = null
  }

  const handleWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.preventDefault()
    orbitRef.current.radius = Math.max(3.2, Math.min(16, orbitRef.current.radius * (e.deltaY > 0 ? 1.1 : 0.91)))
    syncCamera()
  }

  const setPresetOrbit = (theta: number, phi: number, radius = 7.4) => {
    orbitRef.current = { theta, phi, radius }
    syncCamera()
  }

  return (
    <div
      className="calculus-canvas-wrap calculus-surface3d-wrap"
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onWheel={handleWheel}
    >
      {webglUnavailable && (
        <div className="calculus-webgl-fallback" role="status">
          当前环境未启用 WebGL 渲染，右侧数值与驻点判别结论仍可正常查看。
        </div>
      )}
      <div className="calculus-canvas-legend" aria-hidden="true">
        <span><i className="dot max" />极大值</span>
        <span><i className="dot min" />极小值</span>
        {!liftedCurves && <span><i className="dot saddle" />鞍点</span>}
        {liftedCurves && <span><i className="dot constraint" />空间约束曲线</span>}
        {sliceZ !== null && <span><i className="dot active-level" />水平截平面 z = c</span>}
      </div>
      <div className="calculus-zoom-controls" role="group" aria-label="三维视角控制">
        <button type="button" onClick={() => setPresetOrbit(Math.PI * 0.26, Math.PI * 0.33)}>默认</button>
        <button type="button" onClick={() => setPresetOrbit(0, 0.14)}>俯视</button>
        <button type="button" onClick={() => setPresetOrbit(Math.PI * 0.5, Math.PI * 0.48)}>侧视</button>
      </div>
    </div>
  )
}
