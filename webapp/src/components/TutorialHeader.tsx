import { ThemeToggle } from './ThemeToggle';
export function TutorialHeader() {
  return <header className="tutorial-topbar studio-topbar studio-topbar--page">
    <a className="studio-home" href="./index.html"><span className="studio-symbol">B<span>·</span></span><span className="studio-wordmark"><strong>HOW <i>IT</i> WORKS</strong><small>DIGITAL MAKING / FIELD GUIDE</small></span></a>
    <nav className="studio-primary-nav" aria-label="Build It Live pages"><a href="./index.html">HARDWARE BUILDER</a><a href="./digital.html">DIGITAL BUILDER</a><a href="./brickmaker.html">BRICK MAKER</a><a href="./tutorial.html" className="is-current" aria-current="page">GUIDE</a></nav>
    <div className="studio-header-caption">GUIDE / FOUR CHAPTERS <span aria-hidden="true">↗</span></div>
    <ThemeToggle />
  </header>;
}
