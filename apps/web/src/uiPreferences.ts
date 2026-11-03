export function loadReducedMotion(): boolean {
  try {
    return localStorage.getItem("mathcanvas.ui.reducedMotion") === "true"
  } catch {
    return false
  }
}

export function applyReducedMotion(enabled: boolean) {
  document.documentElement.dataset.reducedMotion = String(enabled)
}

export function saveReducedMotion(enabled: boolean) {
  applyReducedMotion(enabled)
  try {
    localStorage.setItem("mathcanvas.ui.reducedMotion", String(enabled))
  } catch {
    // The visual preference still applies for this session when storage is unavailable.
  }
}
