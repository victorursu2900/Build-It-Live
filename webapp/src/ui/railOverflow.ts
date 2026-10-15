/** Scroll exactly when a sidebar has more content than space.
 * A genuinely fitting rail is clipped to prevent Mac trackpad rubber-banding;
 * expanded menus and short windows immediately regain native scrolling.
 * Watch CONTENT sizes too, not just the fixed-height scroll viewport.
 */
const SCROLL_EPSILON_PX = 1;

export function installRailOverflow(root: HTMLElement | null): () => void {
  if (!root) return () => {};
  const cleanups: Array<() => void> = [];
  for (const rail of root.querySelectorAll<HTMLElement>(
    '.studio-sidebar--tools > .studio-rail-scroll, .studio-sidebar--inspector > .studio-rail-scroll',
  )) {
    let frame = 0;
    let disposed = false;
    let scrollable = false;

    const measure = (): void => {
      if (disposed) return;
      const workbench = root.classList.contains('hardware-builder') && rail.parentElement?.classList.contains('studio-sidebar--tools');
      // Measure without our own spacer: closing a disclosure must remove the
      // gutter rather than letting the gutter itself keep the rail scrollable.
      const gutter = 0; // Symmetric rail padding now supplies the bottom breathing room.
      const needed = rail.scrollHeight - gutter > rail.clientHeight + SCROLL_EPSILON_PX;
      rail.classList.toggle('has-workbench-scroll-gutter', Boolean(workbench && needed));
      if (needed === scrollable && rail.classList.contains('is-rail-fit') === !needed) return;
      scrollable = needed;
      rail.classList.toggle('is-rail-fit', !needed);
      // Reset a residual position only when the rail fits its contents.
      if (!needed && rail.scrollTop !== 0) rail.scrollTop = 0;
    };
    const schedule = (): void => {
      if (frame || disposed) return;
      frame = requestAnimationFrame(() => { frame = 0; measure(); });
    };

    // Changing a dropdown can change its height without changing the rail's
    // height. Observe both the fixed rail and descendants with variable height.
    const resize = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(schedule) : null;
    resize?.observe(rail);
    const targets = rail.querySelectorAll<HTMLElement>(
      ':scope > *, .hardware-tool-reveal, .realtime-smoothing, .feature-section, .hardware-kit__appearance, .hardware-kit__files, .hardware-tool-panel',
    );
    targets.forEach(element => resize?.observe(element));

    const mutation = new MutationObserver(() => {
      // Newly inserted sections (e.g. custom colors) also need measurement.
      rail.querySelectorAll<HTMLElement>(':scope > *, .hardware-tool-reveal, .realtime-smoothing, .feature-section')
        .forEach(element => resize?.observe(element));
      schedule();
    });
    mutation.observe(rail, { subtree: true, childList: true, attributes: true,
      attributeFilter: ['class', 'style', 'hidden', 'aria-expanded'] });
    window.addEventListener('resize', schedule, { passive: true });
    document.fonts?.ready.then(schedule).catch(() => {});
    // Synchronous initial state: no one-frame scroll/rubber-band flash.
    measure();
    cleanups.push(() => {
      disposed = true;
      cancelAnimationFrame(frame);
      resize?.disconnect();
      mutation.disconnect();
      window.removeEventListener('resize', schedule);
      rail.classList.remove('is-rail-fit', 'has-workbench-scroll-gutter');
    });
  }
  return () => cleanups.forEach(cleanup => cleanup());
}
