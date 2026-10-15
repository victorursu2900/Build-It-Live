import { ThemeToggle } from './ThemeToggle';
export function BrickMakerHeader() {
  return <header className="brick-topbar studio-topbar studio-topbar--page">
    <a className="studio-home" href="./index.html"><span className="studio-symbol">B<span>·</span></span><span className="studio-wordmark"><strong>BRICK <i>MAKER</i></strong><small>DIGITAL MAKING / PRINT STUDIO</small></span></a>
    <nav className="studio-primary-nav" aria-label="Builder pages"><a href="./index.html">HARDWARE BUILDER</a><a href="./digital.html">DIGITAL BUILDER</a><a href="./brickmaker.html" className="is-current" aria-current="page">BRICK MAKER</a><a href="./tutorial.html">GUIDE</a></nav>
    <div className="studio-header-caption"><span className="studio-pulse" /> CUSTOM BRICK / EDITOR</div>
    <ThemeToggle />
  </header>;
}
