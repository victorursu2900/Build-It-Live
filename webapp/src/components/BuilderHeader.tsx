import { ThemeToggle } from './ThemeToggle';
import { BaudRatePicker } from './BaudRatePicker';
import type { BuilderMode } from '../domain/builderMode';

/** Independent navigation for digital drawing and physical sensor building. */
export function BuilderHeader({ mode }: { mode: BuilderMode }) {
  const hardware = mode === 'hardware';
  return (
    <header className="topbar studio-topbar">
      <a className="studio-home" href="./index.html" aria-label="Build It Live home">
        <span className="studio-symbol" aria-hidden="true">B<span>·</span></span>
        <span className="studio-wordmark"><strong>BUILD <i>IT</i> LIVE</strong><small>{hardware ? 'PHYSICAL MAKING / STUDIO' : 'DIGITAL MAKING / STUDIO'}</small></span>
      </a>
      <nav className="studio-primary-nav" aria-label="Main navigation">
        <a href="./index.html" className={hardware ? 'is-current' : undefined} aria-current={hardware ? 'page' : undefined}>HARDWARE BUILDER</a>
        <a href="./digital.html" className={!hardware ? 'is-current' : undefined} aria-current={!hardware ? 'page' : undefined}>DIGITAL BUILDER</a>
        <a href="./brickmaker.html">BRICK MAKER</a>
        <a href="./tutorial.html">GUIDE</a>
      </nav>
      <div className="topbar-meta studio-top-actions">
        <div className="top-history" aria-label="Undo and redo">
          <button id="undoBuild" className="top-history__button" type="button" disabled aria-label="Undo" title="Undo (Ctrl/Cmd + Z)">↶</button>
          <button id="redoBuild" className="top-history__button" type="button" disabled aria-label="Redo" title="Redo (Ctrl/Cmd + Shift + Z)">↷</button>
        </div>
        {/* The old Three.js engine still queries these element IDs. In Digital Builder
            they remain unavailable to users and are never a visible connection UI. */}
        <div className="top-serial" aria-label="ESP32 Web Serial connection" hidden={!hardware} style={!hardware ? {display:'none'} : undefined}>
          <div className="top-serial__identity"><span className="top-serial__label">ESP32</span><span id="serialStatus" className="serial-state"><i /> OFFLINE</span></div>
          <BaudRatePicker />
          <button id="connectSerial" className="top-serial__button feature-button feature-button--connect" type="button">CONNECT</button>
          <button id="hardwareMenuButton" className="top-serial__button feature-button top-serial__menu top-serial__menu--accent" type="button" hidden>HARDWARE MENU</button>
          <button id="disconnectSerial" className="top-serial__button feature-button" type="button" disabled>DISCONNECT</button>
        </div>
        <span id="systemStatus" className="visually-hidden" aria-live="polite">SYSTEM READY</span>
        <ThemeToggle />
      </div>
    </header>
  );
}
