export type AnimationMode = "loop" | "once" | "pingPong"

export interface AnimationState {
  value: number
  direction: 1 | -1
  mode: AnimationMode
  playing: boolean
  speed: number
}

export function advanceAnimation(state: AnimationState, elapsedSeconds: number, bounds: readonly [number, number]): AnimationState {
  const [minimum, maximum] = bounds
  const range = maximum - minimum
  if (!state.playing || !Number.isFinite(elapsedSeconds) || elapsedSeconds <= 0 || !Number.isFinite(range) || range <= 0) return state
  const distance = Math.max(0, state.speed) * elapsedSeconds * state.direction
  const candidate = state.value + distance
  if (state.mode === "once") {
    if (state.direction > 0 && candidate >= maximum) return { ...state, value: maximum, playing: false }
    if (state.direction < 0 && candidate <= minimum) return { ...state, value: minimum, playing: false }
    return { ...state, value: Math.min(maximum, Math.max(minimum, candidate)) }
  }
  if (state.mode === "loop") {
    const wrapped = ((candidate - minimum) % range + range) % range
    return { ...state, value: minimum + wrapped }
  }
  let value = candidate
  let direction = state.direction
  while (value > maximum || value < minimum) {
    if (value > maximum) {
      value = maximum - (value - maximum)
      direction = -1
    } else if (value < minimum) {
      value = minimum + (minimum - value)
      direction = 1
    }
  }
  return { ...state, value, direction }
}
