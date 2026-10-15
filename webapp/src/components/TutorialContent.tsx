import type { JSX } from 'react';
import { MiniBuilderDiagram } from './MiniBuilderDiagram';
import { HardwareAssemblyGuide } from './HardwareAssemblyGuide';
import { InteractiveWalkthrough } from './InteractiveWalkthrough';
import { StudioToolsGuide } from './StudioToolsGuide';
import { PhysicalDigitalDemo, BrickFootprintDemo } from './GuideExperiments';

/** Guide reading order: Introduction -> Hardware Builder -> Brick Maker -> Digital Builder. */
export function TutorialContent(): JSX.Element {
  return (
    <main className="tutorial-main" id="guide-introduction">
      <section className="tutorial-hero" aria-labelledby="tutorialHeroTitle">
        <div className="tutorial-hero__copy glass-card">
          <span className="panel-label">00 / INTRODUCTION</span>
          <h1 id="tutorialHeroTitle">BUILD WITH BLOCKS.<br /><i>WATCH IT APPEAR.</i></h1>
          <p className="tutorial-lead">Three tools, one idea: create a shape, explore it in 3D, and prepare it for the physical world.</p>
          <p><strong>Hardware Builder</strong> mirrors sensor readings from a real board. <strong>Brick Maker</strong> prepares printable bricks. <strong>Digital Builder</strong> lets you assemble a model directly on screen—no electronics needed.</p>
          <div className="hero-actions">
            <a className="tutorial-primary" href="#hardware-guide">START / HARDWARE ↓</a>
            <a className="tutorial-secondary" href="#brick-maker-guide">BRICK MAKER ↓</a>
            <a className="tutorial-secondary" href="#digital-builder-guide">DIGITAL BUILDER ↓</a>
          </div>
        </div>
        <div className="concept-map glass-card" aria-label="Hardware Builder example: the real block board sends data to the web app and a 3D file">
          <div className="concept-node concept-node--physical">
            <span>
              {"01"}
            </span>
            <strong>
              {"REAL BOARD"}
            </strong>
            <small>
              {"You place the blocks."}
            </small>
            <div className="voxel-stack" aria-hidden="true">
              <i></i>
              <i></i>
              <i></i>
              <i></i>
              <i></i>
              <i></i>
            </div>
          </div>
          <div className="concept-link concept-link--a">
            <b>
              {"BOARD DATA"}
            </b>
            <i>
              {"→"}
            </i>
          </div>
          <div className="concept-node concept-node--bridge">
            <span>
              {"02"}
            </span>
            <strong>
              {"TINY COMPUTER"}
            </strong>
            <small>
              {"It notices where the blocks are."}
            </small>
            <div className="chip-icon" aria-hidden="true">
              {"↯"}
            </div>
          </div>
          <div className="concept-link concept-link--b">
            <b>
              {"SENDS IT"}
            </b>
            <i>
              {"→"}
            </i>
          </div>
          <div className="concept-node concept-node--digital">
            <span>
              {"03"}
            </span>
            <strong>
              {"WEB APP"}
            </strong>
            <small>
              {"You see the same build in 3D."}
            </small>
            <div className="screen-icon" aria-hidden="true">
              <i></i>
            </div>
          </div>
          <div className="concept-link concept-link--c">
            <b>
              {"EXPORT"}
            </b>
            <i>
              {"→"}
            </i>
          </div>
          <div className="concept-node concept-node--output">
            <span>
              {"04"}
            </span>
            <strong>
              {"3D FILE"}
            </strong>
            <small>
              {"Save it or get it ready to print."}
            </small>
            <div className="print-icon" aria-hidden="true">
              {"⌁"}
            </div>
          </div>
        </div>
      </section>

      <nav className="guide-chapter-nav" aria-label="Guide reading paths">
        <a href="#hardware-guide"><span>01 / FIRST</span><strong>HARDWARE BUILDER</strong><small>Build the physical system and connect it to the app</small><b aria-hidden="true">↘</b></a>
        <a href="#brick-maker-guide"><span>02 / NEXT</span><strong>BRICK MAKER</strong><small>Draw, inspect, and export printable bricks</small><b aria-hidden="true">↘</b></a>
        <a href="#digital-builder-guide"><span>03 / THEN</span><strong>DIGITAL BUILDER</strong><small>Create and edit a model directly on the screen</small><b aria-hidden="true">↘</b></a>
      </nav>

      <HardwareAssemblyGuide />

      <PhysicalDigitalDemo />

      <section className="two-tools guide-workflows guide-brick-section" id="brick-maker-guide" aria-labelledby="brickMakerGuideTitle">
        <header className="guide-workflows__intro">
          <span className="panel-label">02 / BRICK MAKER</span>
          <h2 id="brickMakerGuideTitle">FROM GRID <i>TO PRINT.</i></h2>
          <p>Use Brick Maker when you need printable parts for your physical setup. It designs the brick itself, not a complete stacked model.</p>
        </header>
        <div className="guide-workflows__grid">
          <article className="tool-story glass-card tool-story--accent guide-workflow" aria-labelledby="guideBrickTitle">
            <div className="guide-workflow__eyebrow"><span className="panel-label">WORKFLOW / 03 STEPS</span><span className="guide-workflow__tag">3D PRINTING</span></div>
            <h3 id="guideBrickTitle">DESIGN A <i>BRICK.</i></h3>
            <p className="guide-workflow__lead">Design a printable brick footprint from 40 × 20 mm screw-block modules, inspect its channels and underside, then export an STL.</p>
            <div className="guide-workflow__steps">
              <div><b>01</b><span><strong>Draw its footprint</strong><small>Each drawn cell is one complete screw block. Erase cells to refine the layout.</small></span></div>
              <div><b>02</b><span><strong>Check the 3D preview</strong><small>Orbit the part to inspect its screw-channel geometry, underside, and size.</small></span></div>
              <div><b>03</b><span><strong>Download the 3D file</strong><small>Download one merged STL. Adjacent blocks share a continuous shell, while separate islands remain separate.</small></span></div>
            </div>
            <div className="guide-workflow__bottom"><span>YOU MAKE / PRINTABLE SCREW BLOCKS</span><a href="./brickmaker.html">OPEN BRICK MAKER <span aria-hidden="true">↗</span></a></div>
          </article>
          <aside className="glass-card guide-brick-note" aria-labelledby="brickChecklistTitle">
            <span className="panel-label">PRINT CHECKLIST / BEFORE ASSEMBLY</span>
            <h3 id="brickChecklistTitle">CHECK THE <i>PART.</i></h3>
            <div className="guide-brick-note__items">
              <div><b>01</b><p><strong>Size & footprint</strong><span>Check the occupied cells and part dimensions before downloading.</span></p></div>
              <div><b>02</b><p><strong>Interior cavities</strong><span>Inspect the screw channels and underside in the 3D preview.</span></p></div>
              <div><b>03</b><p><strong>Slicer preview</strong><span>Check the exported STL in your slicer. The print-pause layer must match your actual settings.</span></p></div>
            </div>
            <a className="guide-brick-note__link" href="#hwg-print">READ HARDWARE PRINTING STEPS <span aria-hidden="true">↗</span></a>
          </aside>
        </div>
        <BrickFootprintDemo />
        <p className="guide-workflows__note"><strong>WHERE IT FITS:</strong> Brick Maker supplies the parts used in Hardware Builder. After printing, follow the assembly and wiring instructions in chapter 01.</p>
      </section>

      <section className="guide-digital-section" id="digital-builder-guide" aria-labelledby="digitalGuideTitle">
        <header className="guide-digital-hero glass-card">
          <span className="panel-label">03 / DIGITAL BUILDER</span>
          <h2 id="digitalGuideTitle">BUILD ON <i>THE SCREEN.</i></h2>
          <p>Work directly with the virtual grid, tools, and camera. Unlike Hardware Builder, placements here come from your mouse—not ESP32 sensor readings.</p>
          <a className="tutorial-secondary" href="./digital.html">OPEN DIGITAL BUILDER ↗</a>
        </header>
        <section className="system-overview">
        <div className="overview-title">
          <span className="panel-label">
            {"03.01 / DIGITAL BUILDER INTERFACE"}
          </span>
          <h3>
            {"MEET THE "}
            <i>
              {"4 MAIN AREAS"}
            </i>
          </h3>
          <p>
            {"These four areas describe Digital Builder. Hardware Builder has a different Workbench and receives block placements from the physical board."}
          </p>
        </div>
        <div className="interface-map glass-card guide-interface-v135">
          <div className="mock-app mock-app--v135" role="img" aria-label="Digital Builder overview: Build Kit on the left of the 3D workspace; Live Data, Live Feedback, and Control Deck stacked on the right.">
            <div className="mock-app__brand">
              <b>BUILD IT LIVE <em>/ DIGITAL BUILDER</em></b>
              <small>YOUR INTERFACE / AT A GLANCE</small>
            </div>
            <div className="mock-app__folio" aria-hidden="true">THE FOUR AREAS <strong>01—04</strong></div>

            <div className="mock-panel mock-panel--build">
              <div className="mock-panel__top"><span>01</span><i>CREATE</i></div>
              <b>BUILD KIT</b>
              <small>ADD, COLOR &amp; ERASE BLOCKS</small>
              <div className="mock-panel__bottom"><span>YOUR TOOLS</span><b aria-hidden="true">↗</b></div>
            </div>
            <div className="mock-panel mock-panel--data">
              <div className="mock-panel__top"><span>02</span><i>TRACK</i></div>
              <b>LIVE DATA</b>
              <small>COUNT, SIZE &amp; MODEL HEIGHT</small>
              <div className="mock-panel__bottom"><span>YOUR NUMBERS</span><b aria-hidden="true">↗</b></div>
            </div>
            <div className="mock-panel mock-panel--feedback">
              <div className="mock-panel__top"><span>03</span><i>CHECK</i></div>
              <b>LIVE FEEDBACK</b>
              <small>STATUS, ACTIONS &amp; WARNINGS</small>
              <div className="mock-panel__bottom"><span>YOUR MESSAGES</span><b aria-hidden="true">↗</b></div>
            </div>
            <div className="mock-panel mock-panel--control">
              <div className="mock-panel__top"><span>04</span><i>ADJUST</i></div>
              <b>CONTROL DECK</b>
              <small>MODES, LAYERS &amp; CAMERA</small>
              <div className="mock-panel__bottom"><span>YOUR SETTINGS</span><b aria-hidden="true">↗</b></div>
            </div>

            <div className="mock-app__stage" aria-hidden="true">
              <MiniBuilderDiagram />
              <div className="mock-app__stage-label"><strong>3D WORKSPACE</strong><small>8 × 16 / 40 × 20 × 18.5 MM</small></div>
            </div>
            <div className="mock-app__edge-note" aria-hidden="true">BUILD <span>→</span> INSPECT <span>→</span> REFINE</div>
          </div>
          <div className="interface-notes" aria-label="What the four areas do">
            <div className="interface-notes__heading"><span>INTERFACE KEY / 01—04</span><strong>FOUR AREAS.<br />FOUR PURPOSES.</strong><small>Find the number in the diagram, then see exactly what it does.</small></div>
            <div className="interface-notes__item"><span>01</span><p><strong>BUILD KIT <small>/ MAKE</small></strong>Pick a block, change its color, erase pieces, or open and save a project.</p></div>
            <div className="interface-notes__item"><span>02</span><p><strong>LIVE DATA <small>/ MEASURE</small></strong>See the grid size, model height, and total blocks as you build.</p></div>
            <div className="interface-notes__item"><span>03</span><p><strong>LIVE FEEDBACK <small>/ UNDERSTAND</small></strong>Read messages about actions, success, warnings, and errors.</p></div>
            <div className="interface-notes__item"><span>04</span><p><strong>CONTROL DECK <small>/ ADJUST</small></strong>Switch build modes and control layers, view, and saving behavior.</p></div>
          </div>
        </div>
      </section>
        <InteractiveWalkthrough />
        <StudioToolsGuide />
        <section className="quick-reference glass-card">
        <div className="quick-reference__title">
          <span className="panel-label">
            {"03.10 / DIGITAL BUILDER REFERENCE"}
          </span>
          <h3>
            {"USEFUL "}
            <i>
              {"SHORTCUTS"}
            </i>
          </h3>
          <p>
            {"These shortcuts apply to Digital Builder, where you add and edit virtual blocks using the mouse and keyboard."}
          </p>
        </div>
        <div className="shortcut-grid">
          <div>
            <kbd>
              {"1"}
            </kbd>
            <span>
              <b>
                {"STANDARD"}
              </b>
              <small>
                {"Add a normal block"}
              </small>
            </span>
          </div>
          <div>
            <kbd>
              {"2"}
            </kbd>
            <span>
              <b>
                {"SUPPORT"}
              </b>
              <small>
                {"Add a helper block"}
              </small>
            </span>
          </div>
          <div>
            <kbd>
              {"E"}
            </kbd>
            <span>
              <b>
                {"ERASER"}
              </b>
              <small>
                {"Remove a block"}
              </small>
            </span>
          </div>
          <div>
            <kbd>
              {"M"}
            </kbd>
            <span>
              <b>
                {"FREE MOVE"}
              </b>
              <small>
                {"Look around only"}
              </small>
            </span>
          </div>
          <div>
            <kbd>
              {"ALT + DRAG"}
            </kbd>
            <span>
              <b>
                {"ORBIT"}
              </b>
              <small>
                {"Look around while fast-building"}
              </small>
            </span>
          </div>
          <div>
            <kbd>
              {"CTRL/CMD + Z"}
            </kbd>
            <span>
              <b>
                {"UNDO"}
              </b>
              <small>
                {"Go back one change"}
              </small>
            </span>
          </div>
        </div>
      </section>
      </section>
    </main>
  );
}
