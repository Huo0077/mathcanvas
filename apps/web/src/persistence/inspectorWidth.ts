export const DEFAULT_INSPECTOR_WIDTH = 310
export const MIN_INSPECTOR_WIDTH = 260
const WIDTH_KEY = "mathcanvas.inspector-width"

export function loadInspectorWidth(): number {
  try {
    const saved = Number(localStorage.getItem(WIDTH_KEY))
    return saved >= MIN_INSPECTOR_WIDTH && saved <= 500 ? saved : DEFAULT_INSPECTOR_WIDTH
  } catch {
    return DEFAULT_INSPECTOR_WIDTH
  }
}

export function saveInspectorWidth(width: number) {
  try {
    localStorage.setItem(WIDTH_KEY, String(width))
  } catch {
    // The panel can still be resized for this session.
  }
}
