export interface ThreeViewOptionsState {
  transparentFaces: boolean
  showHiddenEdges: boolean
  showRotationHandles: boolean
  showNormals: boolean
  unfolded: boolean
  showAngle: boolean
  autoFit: boolean
}

export type ThreeViewOptionKey = keyof ThreeViewOptionsState
