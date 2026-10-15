import { useState } from 'react';
import { steps } from '../domain/tutorialContent';

import { DigitalWalkthroughVisual } from './DigitalWalkthroughVisual';

const labels = ['THE GRID', 'YOUR TOOLS', 'BUILD', 'LIVE DATA', 'LOOK INSIDE', 'SAVE', 'EXPORT'];
const pad = (value: number) => String(value).padStart(2, '0');

/** Tutorial navigation is managed by React rather than legacy DOM listeners. */
export function InteractiveWalkthrough() {
  const [active, setActive] = useState(0);
  const step = steps[active];
  const total = steps.length;
  const html = `<div class="step-copy">
    <span class="panel-label">${step.eyebrow}</span>
    <h4>${step.title}</h4>
    <p class="step-intro">${step.text}</p>
    <div class="step-points">${step.points.map((p, i) => `<div><span>0${i + 1}</span><p>${p}</p></div>`).join('')}</div>
    <aside class="step-tip"><span>REMEMBER</span><p>${step.tip}</p></aside>
  </div>`;

  return (
    <section id="walkthrough" className="walkthrough">
      <div className="walkthrough-head">
        <div>
          <span className="panel-label">03.02–03.08 / DIGITAL BUILDER WALKTHROUGH</span>
          <h3>FROM <i>FIRST BLOCK</i> TO <i>3D FILE</i></h3>
        </div>
        <div className="walkthrough-progress" aria-label="Tutorial progress">
          <span id="tutorialProgressLabel">STEP {pad(active + 1)} / {pad(total)}</span>
          <div className="walkthrough-progress__track">
            <i id="tutorialProgressBar" style={{ width: `${((active + 1) / total) * 100}%` }} />
          </div>
        </div>
      </div>
      <div className="tutorial-stage glass-card">
        <nav className="step-rail" aria-label="Tutorial steps">
          {labels.map((label, i) => (
            <button
              key={label}
              className={`step-tab${i === active ? ' is-active' : ''}`}
              type="button"
              data-step={i}
              aria-current={i === active ? 'step' : undefined}
              onClick={() => setActive(i)}
            >
              <span>{pad(i + 1)}</span>
              <strong>{label}</strong>
            </button>
          ))}
        </nav>
        <article key={active} className="step-content digital-walk-content" id="stepContent"><div className="digital-walk-copy" aria-live="polite" dangerouslySetInnerHTML={{ __html: html }} /><DigitalWalkthroughVisual active={active} /></article>
        <div className="step-controls">
          <button className="tutorial-secondary" id="prevStep" type="button" disabled={active === 0} onClick={() => setActive(a => Math.max(0, a - 1))}>← PREVIOUS</button>
          <span id="stepCounter">{pad(active + 1)} / {pad(total)}</span>
          <button className="tutorial-primary" id="nextStep" type="button" onClick={() => {
            if (active === total - 1) window.location.href = './digital.html';
            else setActive(a => a + 1);
          }}>{active === total - 1 ? 'OPEN BUILDER ↗' : 'NEXT STEP →'}</button>
        </div>
      </div>
    </section>
  );
}
