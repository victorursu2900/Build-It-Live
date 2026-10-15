import { useEffect, useState } from 'react';

export type StudioTheme = 'light' | 'dark';
export const THEME_STORAGE_KEY = 'build-it-live:color-theme';

/** A single preference shared by Hardware Builder, Digital Builder, Brick Maker and Guide. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<StudioTheme>(() => document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
  useEffect(() => {
    const update = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    const syncStorage = (event: StorageEvent) => {
      if (event.key !== THEME_STORAGE_KEY) return;
      document.documentElement.dataset.theme = event.newValue === 'dark' ? 'dark' : 'light';
      window.dispatchEvent(new CustomEvent('bil:theme-change', { detail: { theme: document.documentElement.dataset.theme } }));
      update();
    };
    window.addEventListener('storage', syncStorage);
    window.addEventListener('bil:theme-change', update);
    return () => { window.removeEventListener('storage', syncStorage); window.removeEventListener('bil:theme-change', update); };
  }, []);
  const dark = theme === 'dark';
  const toggle = () => {
    const next: StudioTheme = dark ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { window.localStorage.setItem(THEME_STORAGE_KEY, next); } catch { /* Browsers may disable local storage. */ }
    setTheme(next);
    window.dispatchEvent(new CustomEvent('bil:theme-change', { detail: { theme: next } }));
  };
  return <button type="button" className="studio-theme-toggle" aria-label={`Switch to ${dark ? 'light' : 'dark'} mode`} aria-pressed={dark} title={dark ? 'Switch to light mode' : 'Switch to dark mode'} onClick={toggle}>
    {dark ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg> : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M20.5 15.3A8.5 8.5 0 0 1 8.7 3.5 8.5 8.5 0 1 0 20.5 15.3Z"/></svg>}
    <span>{dark ? 'LIGHT MODE' : 'DARK MODE'}</span>
  </button>;
}
