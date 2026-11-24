import {
  stepPdeSimulation,
  type PdeSimulationState,
  type StepPdeOptions
} from "@draw/geometry-kernel"

export interface PdeWorkerStepRequest {
  kind: "pde.step"
  requestId: number
  state: PdeSimulationState
  options: StepPdeOptions
}

export interface PdeWorkerStepResponse {
  kind: "pde.step.ok"
  requestId: number
  state: PdeSimulationState
}

const workerScope = self as unknown as {
  onmessage: ((event: MessageEvent<PdeWorkerStepRequest>) => void) | null
  postMessage: (message: PdeWorkerStepResponse, transfer?: Transferable[]) => void
}

workerScope.onmessage = (event: MessageEvent<PdeWorkerStepRequest>) => {
  const msg = event.data
  if (!msg || msg.kind !== "pde.step") return
  try {
    const nextState = stepPdeSimulation(msg.state, msg.options)
    workerScope.postMessage(
      {
        kind: "pde.step.ok",
        requestId: msg.requestId,
        state: nextState
      },
      [nextState.u.buffer, nextState.v.buffer]
    )
  } catch {
    // Keep simulation resilient if malformed parameters arrive
  }
}
