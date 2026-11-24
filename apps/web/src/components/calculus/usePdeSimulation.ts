import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import {
  createPdeState,
  injectPdeGaussianPulse,
  solvePoissonSteady2D,
  stepPdeSimulation,
  type PdeBoundaryCondition,
  type PdeKind,
  type PdeSimulationState,
  type PoissonSolution,
  type ViewportBounds2D
} from "@draw/geometry-kernel"

import type { PdeWorkerStepResponse } from "./pde.worker"

export interface UsePdeSimulationParams {
  active: boolean
  kind: PdeKind
  initialExpr: string
  boundaryExpr: string
  boundary: PdeBoundaryCondition
  param: number
  bounds: ViewportBounds2D
}

export function usePdeSimulation({
  active,
  kind,
  initialExpr,
  boundaryExpr,
  boundary,
  param,
  bounds
}: UsePdeSimulationParams) {
  const [playing, setPlaying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [simState, setSimState] = useState<PdeSimulationState | null>(null)

  const workerRef = useRef<Worker | null>(null)
  const requestIdRef = useRef(0)
  const busyRef = useRef(false)
  const stateRef = useRef<PdeSimulationState | null>(null)
  const paramRef = useRef(param)
  paramRef.current = param

  // Steady-state Poisson / Laplace is solved directly when kind === "poisson2d"
  const poissonResult = useMemo<{ ok: true; solution: PoissonSolution } | { ok: false; error: string } | null>(() => {
    if (kind !== "poisson2d") return null
    try {
      const solution = solvePoissonSteady2D(initialExpr, boundaryExpr, bounds, 46, 260)
      return { ok: true, solution }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "泊松方程求解失败" }
    }
  }, [kind, initialExpr, boundaryExpr, bounds])

  const resetSimulation = useCallback(() => {
    setPlaying(false)
    busyRef.current = false
    requestIdRef.current += 1
    if (kind === "poisson2d") {
      setError(null)
      return
    }
    try {
      const fresh = createPdeState({
        kind,
        initialExpr,
        bounds,
        gridSize: 48,
        boundary
      })
      stateRef.current = fresh
      setSimState(fresh)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : "初值表达式解析失败")
    }
  }, [kind, initialExpr, bounds, boundary])

  useEffect(() => {
    resetSimulation()
  }, [resetSimulation])

  // Spawn Web Worker in browser environments
  useEffect(() => {
    if (typeof Worker === "undefined") return
    let worker: Worker
    try {
      worker = new Worker(new URL("./pde.worker.ts", import.meta.url), { type: "module" })
    } catch {
      return
    }
    worker.onmessage = (event: MessageEvent<PdeWorkerStepResponse>) => {
      const msg = event.data
      if (!msg || msg.kind !== "pde.step.ok") return
      if (msg.requestId !== requestIdRef.current) return
      busyRef.current = false
      stateRef.current = msg.state
      setSimState(msg.state)
    }
    workerRef.current = worker
    return () => {
      worker.terminate()
      workerRef.current = null
    }
  }, [])

  const stepOnce = useCallback(
    (dt = 0.03) => {
      if (kind === "poisson2d") return
      const curr = stateRef.current
      if (!curr) return

      const worker = workerRef.current
      if (worker) {
        if (busyRef.current) return
        busyRef.current = true
        const reqId = ++requestIdRef.current
        // Clone typed arrays so curr remains intact for current frame paint
        worker.postMessage({
          kind: "pde.step",
          requestId: reqId,
          state: {
            ...curr,
            u: new Float64Array(curr.u),
            v: new Float64Array(curr.v)
          },
          options: { dt, param: paramRef.current, damping: 0.03 }
        })
      } else {
        const next = stepPdeSimulation(curr, { dt, param: paramRef.current, damping: 0.03 })
        stateRef.current = next
        setSimState(next)
      }
    },
    [kind]
  )

  useEffect(() => {
    if (!active || !playing || kind === "poisson2d") return
    let rafId = 0
    const tick = () => {
      stepOnce(0.025)
      rafId = window.requestAnimationFrame(tick)
    }
    rafId = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(rafId)
  }, [active, playing, kind, stepOnce])

  const injectPulse = useCallback(
    (wx: number, wy: number, amplitude = 1.6) => {
      if (kind === "poisson2d") return
      const curr = stateRef.current
      if (!curr) return
      requestIdRef.current += 1
      busyRef.current = false
      const pulsed = injectPdeGaussianPulse(curr, wx, wy, amplitude)
      stateRef.current = pulsed
      setSimState(pulsed)
    },
    [kind]
  )

  const effectiveState = kind === "poisson2d"
    ? (poissonResult?.ok ? poissonResult.solution.state : null)
    : simState

  const effectiveError = kind === "poisson2d"
    ? (poissonResult && !poissonResult.ok ? poissonResult.error : null)
    : error

  return {
    state: effectiveState,
    poissonSolution: poissonResult?.ok ? poissonResult.solution : null,
    error: effectiveError,
    playing,
    setPlaying,
    stepOnce,
    resetSimulation,
    injectPulse
  }
}
