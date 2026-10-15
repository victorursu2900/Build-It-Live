/** Animate mounted panels, with shared panel transitions between HTML pages
 * when the browser supports cross-document view transitions. */
const PAGE_NAMES = new Set(['index.html', 'hardware.html', 'digital.html', 'brickmaker.html', 'tutorial.html']);
let installed = false;

export function installPageTransitions(): void {
  if (installed) return;
  installed = true;
  const root = document.documentElement;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
  const nativeNavigation = 'onpagereveal' in window && CSS.supports('view-transition-name', 'bil-workbench');
  let cleanupTimer: number | undefined;
  let pending = false;
  let observer: MutationObserver | undefined;
  if (!reduced.matches) {
    root.classList.add('bil-page-enter');
    const mounted = () => {
      if (!document.querySelector('#root .studio-workspace, #root .brick-main, #root .tutorial-page')) return;
      observer?.disconnect();
      // Start cleanup after React actually mounts, rather than before the
      // module/engine loads. This prevents the entrance from being skipped.
      requestAnimationFrame(() => requestAnimationFrame(() => {
        if (root.classList.contains('bil-page-enter')) cleanupTimer = window.setTimeout(() => root.classList.remove('bil-page-enter'), 650);
      }));
    };
    observer = new MutationObserver(mounted);
    observer.observe(document, { childList: true, subtree: true });
    mounted();
  }
  window.addEventListener('pagereveal', (event: Event) => {
    if (!(event as Event & { viewTransition?: unknown }).viewTransition) return;
    root.classList.add('bil-native-navigation');
    root.classList.remove('bil-page-enter');
    observer?.disconnect();
    window.clearTimeout(cleanupTimer);
  });
  window.addEventListener('pageshow', () => {
    pending = false;
    root.classList.remove('bil-page-exit');
  });
  document.addEventListener('click', (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest<HTMLAnchorElement>('.studio-primary-nav a, a.studio-home');
    if (!anchor || anchor.hasAttribute('download') || (anchor.target && anchor.target !== '_self')) return;
    const next = new URL(anchor.href, window.location.href);
    if (next.origin !== window.location.origin || !PAGE_NAMES.has(next.pathname.split('/').pop() || '')) return;
    if (next.href === window.location.href || (next.pathname === window.location.pathname && next.hash)) return;
    if (reduced.matches || nativeNavigation) return;
    event.preventDefault();
    if (pending) return;
    pending = true;
    root.classList.remove('bil-page-enter');
    root.classList.add('bil-page-exit');
    window.setTimeout(() => window.location.assign(next.href), 180);
  });
}
