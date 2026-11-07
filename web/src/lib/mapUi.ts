/** Small maps: attribution is shown first, then folded into its (i) button so it never sits on the board. */
export function collapseAttributionOnSmallMap(el: HTMLElement | null, delayMs = 2500) {
  if (!el || (el.clientWidth >= 640 && el.clientHeight >= 420)) return
  window.setTimeout(() => el.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show'), delayMs)
}
