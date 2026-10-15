import type { ReactNode } from 'react';
import { useState } from 'react';

type Supply = { name: string; quantity: string; detail?: string; link?: string };

// BOM names, counts and estimates are taken from the supplied assembly instructions.
const sources = {
  esp: 'https://www.amazon.de/dp/B0CMD8ZQ5H',
  adc: 'https://www.amazon.de/dp/B0D91XW41N',
  mux: 'https://www.amazon.de/dp/B00JR5R6OM',
  screw: 'https://www.amazon.de/dp/B0DLWXWG8S',
  magnet: 'https://www.amazon.de/dp/B0GDXYKWMH',
  r10: 'https://www.amazon.de/dp/B0CL6NGWQY',
  r51: 'https://www.amazon.de/dp/B0G8CNMM3L',
};

const base: Supply[] = [
  {quantity: '01 ×', name: 'ESP32-C6 development board', detail: 'Approx. €12.00', link: sources.esp},
  {quantity: '01 ×', name: 'PLA filament spool', detail: '1 kg · approx. €15.00'},
];
const small: Supply[] = [
  {quantity: '01 ×', name: 'ADS1115 ADC module', link: sources.adc},
  {quantity: '01 ×', name: 'CD74HC4067 multiplexer', detail: '16-channel', link: sources.mux},
  {quantity: '80 ×', name: 'Brass slotted screws', detail: '3 × 16 mm', link: sources.screw},
  {quantity: '160 ×', name: 'Neodymium magnets', detail: '4 × 2 mm', link: sources.magnet},
  {quantity: '40 ×', name: 'Block ID resistors', detail: '10 kΩ or 5.1 kΩ', link: sources.r10},
];
const large: Supply[] = [
  {quantity: '04 ×', name: 'ADS1115 ADC modules', link: sources.adc},
  {quantity: '16 ×', name: 'CD74HC4067 multiplexers', detail: '16-channel', link: sources.mux},
  {quantity: '400 ×', name: 'Brass slotted screws', detail: '3 × 16 mm', link: sources.screw},
  {quantity: '800 ×', name: 'Neodymium magnets', detail: '4 × 2 mm', link: sources.magnet},
  {quantity: '200 ×', name: 'Block ID resistors', detail: '10 kΩ or 5.1 kΩ', link: sources.r51},
];

function SupplyTable({items}: {items:Supply[]}) {
  return <div className="hwg-supply-table">
    {items.map(item => <div className="hwg-supply-row" key={item.name}>
      <span className="hwg-supply-count">{item.quantity}</span>
      <span className="hwg-supply-description"><strong>{item.name}</strong>{item.detail && <small>{item.detail}</small>}</span>
      {item.link ? <a href={item.link} target="_blank" rel="noopener noreferrer" aria-label={`Open Amazon listing for ${item.name}`} title="Check size, value and availability before ordering">SOURCE ↗</a> : <span className="hwg-supply-nolink">—</span>}
    </div>)}
  </div>;
}

function GuideNumber({number, kicker, title, accent}: {number:string; kicker:string; title:string; accent:string}) {
  return <header className="hwg-section-heading">
    <span className="hwg-index">{number}</span>
    <div><span className="panel-label">{kicker}</span><h3>{title} <i>{accent}</i></h3></div>
  </header>;
}

function HowToStep({n, title, children}: {n:string; title:string; children: ReactNode}) {
  return <div className="hwg-howto-step"><span className="hwg-step-number">{n}</span><div><h4>{title}</h4><div className="hwg-step-body">{children}</div></div></div>;
}

export function HardwareAssemblyGuide() {
  const [build, setBuild] = useState<'small' | 'large'>('small');
  const [assemblyStage, setAssemblyStage] = useState(3);
  const option = build === 'small' ? small : large;
  return <section className="hardware-guide" id="hardware-guide" aria-labelledby="hardwareGuideTitle">
    <div className="hwg-hero glass-card">
      <div className="hwg-hero-main">
        <span className="panel-label">01 / HARDWARE BUILDER</span>
        <h2 id="hardwareGuideTitle">FROM BOARD <i>TO SCREEN.</i></h2>
        <p>Follow the physical workflow: gather parts, print and assemble blocks, wire the baseplate, flash the ESP32-C6, and connect Hardware Builder.</p>
        <div className="hwg-hero-meta"><span>HARDWARE FIELD GUIDE</span><span>ESP32-C6 / ADS1115 / CD74HC4067</span></div>
      </div>
      <div className="hwg-hero-side"><span className="hwg-hero-side-label">THE SYSTEM / 04 PARTS</span>
        <div className="hwg-flow-node"><b>01</b> PRINTED BLOCKS <span>↓</span></div>
        <div className="hwg-flow-node"><b>02</b> SENSOR GRID <span>↓</span></div>
        <div className="hwg-flow-node"><b>03</b> ESP32-C6 <span>↓</span></div>
        <div className="hwg-flow-node"><b>04</b> LIVE 3D MODEL <span>↗</span></div>
      </div>
    </div>
    <nav className="hwg-jump-nav" aria-label="Hardware guide chapters">
      {[['BOM','hwg-bom'],['PRINT','hwg-print'],['ASSEMBLE','hwg-assembly'],['WIRING','hwg-wiring'],['FIRMWARE','hwg-firmware'],['CONNECT','hwg-connect']].map(([label,id],i)=><a key={id} href={`#${id}`}><span>{String(i+1).padStart(2,'0')}</span>{label}<b aria-hidden="true">↘</b></a>)}
    </nav>
    <div className="hwg-compatibility" role="note"><span className="hwg-alert-dot"/><p><strong>CURRENT HARDWARE STATUS</strong> — Hardware Builder defaults to a 2-column × 4-row physical grid; its digital workspace automatically matches those dimensions. The 4×4 and 16×16 materials plans below are examples for future physical setups, not a description of this default. The included firmware currently scans multiplexer channel 0 only, so a complete 2×4 or larger live sensor scan is not yet supported.</p></div>

    <section className="hwg-chapter glass-card" id="hwg-bom">
      <GuideNumber number="01" kicker="PARTS / ESTIMATED COST" title="BILL OF" accent="MATERIALS." />
      <p className="hwg-chapter-lead">Start with the shared components. Select the size of your planned baseplate for the remaining parts.</p>
      <div className="hwg-bom-layout">
        <div className="hwg-bom-common"><div className="hwg-subheading"><span>00 / SHARED PARTS</span><b>REQUIRED FOR BOTH</b></div><SupplyTable items={base}/><div className="hwg-bom-note">Costs are approximate estimates from the supplied build instructions, not live product prices.</div></div>
        <div className="hwg-bom-options">
          <div className="hwg-bom-switch" role="group" aria-label="Select bill of materials configuration">
            <button type="button" aria-pressed={build==='small'} className={build==='small'?'is-active':''} onClick={()=>setBuild('small')}>A / 4 × 4</button>
            <button type="button" aria-pressed={build==='large'} className={build==='large'?'is-active':''} onClick={()=>setBuild('large')}>B / 16 × 16</button>
          </div>
          <div className="guide-motion-swap" key={build}>
            <div className="hwg-option-title"><div><span>PLANNED CONFIGURATION</span><strong>{build==='small'?'4 × 4 GRID':'16 × 16 GRID'}</strong><small>{build==='small'?'40 BLOCKS':'200 BLOCKS / FUTURE SCALE'}</small></div><div><span>ESTIMATED TOTAL</span><strong>{build==='small'?'~€69':'~€147'}</strong></div></div>
            <SupplyTable items={option}/>
            <div className="hwg-resistance-sources"><span>RESISTOR OPTIONS</span><a href={sources.r10} target="_blank" rel="noopener noreferrer">10 kΩ ↗</a><a href={sources.r51} target="_blank" rel="noopener noreferrer">5.1 kΩ ↗</a></div>
          </div>
        </div>
      </div>
    </section>

    <section className="hwg-chapter glass-card" id="hwg-print">
      <GuideNumber number="02" kicker="3D PRINTING / PREPARATION" title="PRINT THE" accent="BLOCKS." />
      <div className="hwg-two-column">
        <div className="hwg-howto">
          <HowToStep n="01" title="Get your STL"><p>Open <a href="#brick-maker-guide">Brick Maker (chapter 02) ↓</a> to draw a brick footprint, inspect the 3D preview, and download an STL. You can return to these printing steps afterward.</p></HowToStep>
          <HowToStep n="02" title="Slice the print"><p>Load the STL into your slicer and arrange the blocks on the build plate. The supplied estimate is <strong>up to 63 blocks per standard bed</strong>, at approximately <strong>11 hours</strong> per print job.</p></HowToStep>
          <HowToStep n="03" title="Insert a print pause"><p>Set a pause at <strong>layer 63</strong> in the stated slicing setup, so the internal component cavities can be filled before they are sealed.</p></HowToStep>
        </div>
        <aside className="hwg-spec-panel"><span className="hwg-spec-label">SOURCE BLOCK / PRINT MODEL</span><div className="hwg-spec-number">40 × 20 <small>MM</small></div><p>Single screw block footprint</p><div className="hwg-spec-number">18.5 <small>MM</small></div><p>Source block height</p><div className="hwg-note"><strong>CHECK YOUR SLICER.</strong> The 63-block capacity, 11-hour estimate, and layer-63 pause depend on the actual printer, settings and layer height. Confirm the layer preview intersects the cavities before printing.</div></aside>
      </div>
    </section>

    <section className="hwg-chapter glass-card" id="hwg-assembly">
      <GuideNumber number="03" kicker="EMBEDDED ELECTRONICS / ASSEMBLY" title="SEAL THE" accent="COMPONENTS." />
      <p className="hwg-chapter-lead">Use the <strong>interior layout</strong> below as the placement reference: four magnets in the outer corner pockets, two parallel brass screws in the center, and one resistor bridging the screws near their heads.</p>
      <div className="hwg-assembly-grid">
        <div className="hwg-assembly-visuals">
          <figure className="hwg-component-diagram">
            <div className="hwg-image-kicker"><span>01 / LAYOUT</span><span>INSIDE VIEW</span></div>
            <svg className={`hwg-block-svg hwg-block-svg--stage-${assemblyStage}`} viewBox="0 0 480 312" role="img" aria-labelledby="hwg-layout-title hwg-layout-desc">
              <title id="hwg-layout-title">Block interior component placement</title>
              <desc id="hwg-layout-desc">Four magnets sit in the corner pockets. Two long parallel screws sit inside the block near its center. One horizontal resistor joins the upper parts of both screws.</desc>
              <rect x="13" y="18" width="454" height="214" rx="18" fill="#171717" stroke="#555" strokeWidth="3" />
              <path d="M28 35 H152 Q169 35 169 60 V196 H28 Z" fill="#303030" stroke="#565656" strokeWidth="2" />
              <path d="M452 35 H329 Q311 35 311 60 V196 H452 Z" fill="#303030" stroke="#565656" strokeWidth="2" />
              <rect x="219" y="84" width="43" height="121" rx="11" fill="#080808" stroke="#454545" strokeWidth="5" />
              <g fill="#111" stroke="#6c6c6c" strokeWidth="3">
                <rect x="90" y="25" width="50" height="47" rx="11" />
                <rect x="340" y="25" width="50" height="47" rx="11" />
                <rect x="90" y="163" width="50" height="47" rx="11" />
                <rect x="340" y="163" width="50" height="47" rx="11" />
              </g>
              <g className="hwg-part hwg-part--magnets" fill="#d4d4ce" stroke="#f5f5f0" strokeWidth="2">
                <rect x="102" y="37" width="26" height="24" rx="5" />
                <rect x="352" y="37" width="26" height="24" rx="5" />
                <rect x="102" y="175" width="26" height="24" rx="5" />
                <rect x="352" y="175" width="26" height="24" rx="5" />
              </g>
              <g className="hwg-part hwg-part--screws" fill="#bd8f32" stroke="#f2d56c" strokeWidth="2">
                <rect x="173" y="56" width="25" height="198" rx="4" />
                <rect x="283" y="56" width="25" height="198" rx="4" />
                <rect x="165" y="37" width="41" height="31" rx="9" />
                <rect x="275" y="37" width="41" height="31" rx="9" />
              </g>
              <g className="hwg-part hwg-part--threads" stroke="#8b641d" strokeWidth="2">
                {Array.from({length:16}, (_,i) => <g key={i}><path d={`M174 ${80 + i*10} H197`} /><path d={`M284 ${80 + i*10} H307`} /></g>)}
              </g>
              <g className="hwg-part hwg-part--resistor">
              <path d="M190 79 L213 79 M267 79 L291 79" stroke="#d3d3d3" strokeWidth="4" strokeLinecap="round" />
              <rect x="209" y="67" width="62" height="25" rx="12" fill="#1191bd" stroke="#73d8fa" strokeWidth="2" />
              <g strokeWidth="5"><path d="M223 69 V90" stroke="#462a22" /><path d="M235 69 V90" stroke="#1d1d1d" /><path d="M248 69 V90" stroke="#462a22" /><path d="M261 69 V90" stroke="#111" /></g>
              </g>
              <text x="240" y="292" textAnchor="middle" fontSize="10" fill="#777" fontWeight="800" letterSpacing="1">INTERIOR / OPEN SIDE</text>
            </svg>
            <figcaption className="hwg-diagram-caption">PLACEMENT SCHEMATIC / NOT TO SCALE</figcaption>
          </figure>
          <div className="hwg-component-key" aria-label="Components shown"><span><i className="hwg-key-magnet" />04 / MAGNETS</span><span><i className="hwg-key-screw" />02 / SCREWS</span><span><i className="hwg-key-resistor" />01 / RESISTOR</span></div>
          <div className="hwg-assembly-interactive" aria-label="Explore assembly stages">
            <div className="hwg-assembly-interactive__heading"><span>EXPLORE / ASSEMBLY</span><strong>{assemblyStage === 3 ? 'FULL LAYOUT' : ['MAGNETS','SCREWS','RESISTOR'][assemblyStage]}</strong></div>
            <div className="hwg-assembly-interactive__steps" role="group" aria-label="Highlight assembly components">
              {['01 / MAGNETS','02 / SCREWS','03 / RESISTOR','04 / ALL'].map((label,i) => <button type="button" key={label} aria-pressed={assemblyStage === i} className={assemblyStage === i ? 'is-active' : ''} onClick={() => setAssemblyStage(i)}>{label}</button>)}
            </div>
            <p className="guide-assembly-caption" key={assemblyStage} aria-live="polite">{['Four magnets sit in the outer corner pockets.','Two parallel screws sit inside the block.','The resistor joins both screws near their heads.','Check all component positions before sealing.'][assemblyStage]}</p>
          </div>
        </div>
        <div className="hwg-howto hwg-assembly-steps">
          <HowToStep n="01" title="Fit all four magnets"><p>Place <strong>4 × neodymium magnets (4 × 2 mm)</strong> into the four outer recessed pockets: one in each corner of the interior, as shown in the layout. Keep their orientation consistent with your stacking design.</p></HowToStep>
          <HowToStep n="02" title="Insert both brass screws"><p>Position <strong>2 × slotted brass screws (3 × 16 mm)</strong> in the two long, parallel channels <strong>inside the block</strong>. Both screw heads sit toward the upper edge in this view; the threaded shafts run downward, with approximately <strong>1 mm protruding beneath the block</strong> as specified in the assembly instructions.</p></HowToStep>
          <HowToStep n="03" title="Connect the resistor between the screws"><p>Place <strong>1 × identification resistor (10 kΩ or 5.1 kΩ)</strong> horizontally <strong>between the two screws, just below their heads</strong>. Connect one resistor lead electrically to each brass screw, as shown in the layout.</p></HowToStep>
          <HowToStep n="04" title="Verify, then finish"><p>Before sealing, check that all four magnets are seated, both screws remain aligned, and the resistor makes reliable electrical contact with each screw. If embedding during printing, confirm that nothing enters the nozzle path before resuming.</p></HowToStep>
          <div className="hwg-assembly-reminder"><span>POSITION CHECK / 04 + 02 + 01</span><p><strong>Check the seating of each magnet, the alignment of both screws, and electrical continuity across the resistor connection.</strong> Confirm clearance before sealing; the diagram is not to scale.</p></div>
        </div>
      </div>
      <p className="hwg-safety-note">Keep loose magnets away from children and sensitive equipment. Verify polarity, electrical contact, and the actual slicer clearance before sealing the block. Physical fit has not been tested in this build.</p>
    </section>

    <section className="hwg-chapter glass-card" id="hwg-wiring">
      <GuideNumber number="04" kicker="BASEPLATE / CONNECTION MAP" title="WIRE THE" accent="GRID." />
      <div className="hwg-wiring-layout">
        <div className="hwg-wiring-card"><div className="hwg-subheading"><span>01 / CD74HC4067</span><b>CONTROL LINES → ESP32-C6</b></div><div className="hwg-pin-list">{[['S0','GPIO 10'],['S1','GPIO 11'],['S2','GPIO 2'],['S3','GPIO 3']].map(([a,b])=><div key={a}><span>{a}</span><i aria-hidden="true"/><strong>{b}</strong></div>)}</div><p>Connect every physical sensor pad to an appropriate channel input, <strong>C0–C15</strong>, for the 16-channel multiplexer.</p></div>
        <div className="hwg-wiring-card"><div className="hwg-subheading"><span>02 / ADS1115</span><b>I²C & SENSOR SIGNAL</b></div><div className="hwg-pin-list">{[['SDA','GPIO 6'],['SCL','GPIO 7'],['MUX SIG','ADS A0']].map(([a,b])=><div key={a}><span>{a}</span><i aria-hidden="true"/><strong>{b}</strong></div>)}</div><p>Connect the ADC and multiplexer ground/reference lines appropriately, using a common electrical reference with the ESP32.</p></div>
      </div>
      <div className="hwg-connection-strip"><span>BASEPLATE PADS</span><b>→</b><span>16-CHANNEL MULTIPLEXER</span><b>→</b><span>ADS1115 A0</span><b>→</b><span>ESP32-C6</span><b>→</b><span>WEB SERIAL</span></div>
      <p className="hwg-note hwg-wiring-note">The listed pins follow your wiring instructions. For a complete 16×16 sensor array, channel expansion, addressing and scan logic must be designed and tested; the provided firmware currently reads channel 0 only.</p>
    </section>

    <section className="hwg-chapter glass-card" id="hwg-firmware">
      <GuideNumber number="05" kicker="ESP32-C6 / PLATFORMIO" title="FLASH THE" accent="FIRMWARE." />
      <div className="hwg-two-column">
        <div className="hwg-howto">
          <HowToStep n="01" title="Open the firmware"><p>Open the project's <code>firmware/</code> folder in <strong>VS Code</strong> with the <strong>PlatformIO</strong> extension installed.</p></HowToStep>
          <HowToStep n="02" title="Check dependencies"><p>PlatformIO installs <code>Adafruit ADS1X15</code>. The source sets I²C to <strong>400 kHz</strong> and ADS1115 sampling to <strong>860 SPS</strong>.</p></HowToStep>
          <HowToStep n="03" title="Connect and upload"><p>Connect the ESP32-C6 via USB-C, then click <strong>Upload ↗</strong> in the PlatformIO status bar.</p></HowToStep>
          <HowToStep n="04" title="Inspect, then close"><p>Confirm JSON sensor events in the Serial Monitor, then <strong>close the Serial Monitor</strong> before connecting from the web app.</p></HowToStep>
        </div>
        <aside className="hwg-troubleshoot"><span className="hwg-subheading"><span>IF FLASHING FAILS</span><b>TROUBLESHOOT / 03</b></span>
          <div><strong>CONNECTING… / STUCK</strong><p>Hold the ESP32-C6's BOOT button until upload begins.</p></div>
          <div><strong>ACCESS DENIED</strong><p>Disconnect from the web app and close PlatformIO Serial Monitor. Another app may own the COM port.</p></div>
          <div><strong>PORT NOT FOUND</strong><p>Install the USB-to-UART driver for your board's serial interface, often CH343 or CP210X.</p></div>
          <div className="hwg-firmware-limit"><strong>FIRMWARE LIMIT</strong><p>Currently scans multiplexer channel 0 only. Other inputs will not be read until the scan loop is expanded.</p></div>
        </aside>
      </div>
    </section>

    <section className="hwg-chapter hwg-connect-section glass-card" id="hwg-connect">
      <GuideNumber number="06" kicker="WEB APP / PHYSICAL MODE" title="CONNECT &" accent="BUILD." />
      <div className="hwg-connect-steps">
        <HowToStep n="01" title="Connect your board"><p>Open <a href="./index.html">Hardware Builder ↗</a> using Chrome or Edge over HTTPS or localhost. Click <strong>CONNECT</strong> in the ESP32 control group and select the serial port.</p></HowToStep>
        <HowToStep n="02" title="Set your dimensions"><p>In <strong>Hardware Settings</strong>, enter the physical grid <strong>Columns</strong> and <strong>Rows</strong> (default <strong>2 × 4</strong>). The digital workspace automatically matches the physical grid; there is no separate digital-grid size to configure.</p></HowToStep>
        <HowToStep n="03" title="Place the blocks"><p>Place blocks on the sensor baseplate. When supported channels send valid readings, the app can map resistance-based block profiles—typically <strong>10 kΩ Standard</strong> and <strong>5.1 kΩ Support</strong>—to the 3D view. With the supplied channel-0 firmware, do not expect all 2×4 cells to be detected.</p></HowToStep>
        <HowToStep n="04" title="Inspect, calibrate, capture"><p>Use <strong>Inspector → Sensor Diagnostics</strong> for readings and CSV logs, <strong>Workbench → Sensor Calibration</strong> for resistance profiles, and <strong>Project Files → Capture Model</strong> for PNG snapshots. Calibration uses actual placement events.</p></HowToStep>
      </div>
      <div className="hwg-app-overview" aria-label="Hardware Builder interface areas">
        <div><span>01 / WORKBENCH</span><p>Recolor the model, calibrate sensor profiles, and save, capture, or export your build. Hardware Builder has no Load Project button.</p></div>
        <div><span>02 / LIVE DATA</span><p>Track Grid, Max Height, and block count, then expand Sensor Diagnostics to inspect events and export logs.</p></div>
        <div><span>03 / FEEDBACK & CONTROLS</span><p>Check detection and connection messages, then use view, autosave, recent models, and layer controls. There is no Continuous Build tool in Hardware Builder.</p></div>
      </div>
      <div className="hwg-cta"><div><span>READY FOR THE PHYSICAL LINK?</span><strong>REAL BLOCKS. LIVE DIGITAL TWIN.</strong></div><a href="./index.html">OPEN HARDWARE BUILDER <span aria-hidden="true">↗</span></a></div>
    </section>
  </section>;
}
