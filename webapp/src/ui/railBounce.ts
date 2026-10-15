/** A single, gentle end-stop recoil for either Builder sidebar.
 * Native wheel / touch / keyboard scrolling is never blocked. The gesture is
 * allowed one bounce at an edge: trackpad inertia or held mouse-wheel input
 * must not repeatedly restart it. A fresh gesture or movement away from the
 * edge arms the effect again.
 */
const NEW_GESTURE_GAP_MS = 800;
const MAX_RECOIL_PX = 8;
const OVERFLOW_TOLERANCE_PX = 4;

/** Avoid animating an outer rail while the user is scrolling a nested list. */
function isInsideScrollableChild(target: EventTarget | null, rail: HTMLElement): boolean {
  let node = target instanceof Element ? target : null;
  while (node && node !== rail) {
    if (node instanceof HTMLElement && node.scrollHeight > node.clientHeight + 2) {
      const overflow = getComputedStyle(node).overflowY;
      if (overflow === 'auto' || overflow === 'scroll') return true;
    }
    node = node.parentElement;
  }
  return false;
}

export function installRailBounce(root: HTMLElement | null): () => void {
  if (!root) return () => {};
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const cleanups: Array<() => void> = [];

  for (const rail of root.querySelectorAll<HTMLElement>(
    '.studio-sidebar--tools > .studio-rail-scroll, .studio-sidebar--inspector > .studio-rail-scroll',
  )) {
    let bouncedEdge: 'top' | 'bottom' | null = null;
    let lastWheelAt = -Infinity;
    // Let the browser decide whether a rail can scroll from its actual layout.
    // In V66 a ResizeObserver added overflow:hidden when measured sizes were
    // nearly equal. Flex children could shrink during an animation, leaving
    // expanded controls clipped and their rails permanently locked. Native
    // overflow:auto is already conditional and correctly handles these cases.

    // Moving into the interior by scrolling, keyboard or scrollbar releases the
    // edge latch. Don't reset on the tiny positional jitter near the boundary.
    const rearmAwayFromEdge = (): void => {
      const maxScroll = rail.scrollHeight - rail.clientHeight;
      if (maxScroll > 2 && rail.scrollTop > 3 && rail.scrollTop < maxScroll - 3) {
        bouncedEdge = null;
      }
    };

    const onWheel = (event: WheelEvent): void => {
      if (reduceMotion.matches || event.ctrlKey || !event.deltaY) return;
      if (isInsideScrollableChild(event.target, rail)) return;
      const maxScroll = rail.scrollHeight - rail.clientHeight;
      if (maxScroll <= OVERFLOW_TOLERANCE_PX) return; // No actual overflow? No bounce.

      const now = performance.now();
      // A pause marks another deliberate scroll, not a stream of trackpad
      // momentum events. Until that pause, one boundary gives one recoil.
      if (now - lastWheelAt > NEW_GESTURE_GAP_MS) bouncedEdge = null;
      lastWheelAt = now;
      rearmAwayFromEdge();

      const atTop = rail.scrollTop <= 1 && event.deltaY < 0;
      const atBottom = rail.scrollTop >= maxScroll - 1 && event.deltaY > 0;
      if (!atTop && !atBottom) return;
      const edge = atTop ? 'top' : 'bottom';
      if (bouncedEdge === edge) return;
      bouncedEdge = edge;

      // One soft outward movement and a longer decelerating return. Do not
      // spring past zero and do not restart while trackpad inertia continues.
      const movement = event.deltaMode === WheelEvent.DOM_DELTA_PIXEL
        ? Math.abs(event.deltaY) : Math.abs(event.deltaY) * 16;
      const px = Math.min(MAX_RECOIL_PX, Math.max(3, movement * 0.15));
      const offset = edge === 'top' ? px : -px;
      for (const child of Array.from(rail.children)) {
        if (!(child instanceof HTMLElement) || typeof child.animate !== 'function') continue;
        child.animate([
          { transform: 'translate3d(0, 0, 0)', offset: 0, easing: 'cubic-bezier(.2, .8, .25, 1)' },
          { transform: `translate3d(0, ${offset}px, 0)`, offset: 0.24, easing: 'cubic-bezier(.2, .75, .22, 1)' },
          { transform: 'translate3d(0, 0, 0)', offset: 1 },
        ], { duration: 460, fill: 'none' });
      }
    };

    rail.addEventListener('wheel', onWheel, { passive: true });
    rail.addEventListener('scroll', rearmAwayFromEdge, { passive: true });
    cleanups.push(() => {
      rail.removeEventListener('wheel', onWheel);
      rail.removeEventListener('scroll', rearmAwayFromEdge);
    });
  }
  return () => cleanups.forEach(cleanup => cleanup());
}
