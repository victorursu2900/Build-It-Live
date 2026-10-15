import { useEffect, useId, useState } from 'react';
import type { ReactNode } from 'react';

type Reading = {
  sequence: number; channel: number; action: string; z: number;
  conductance: number; resistance: number; accepted: boolean; timestamp: number;
};
type SensorBlock = { x: number; y: number; z: number; type: string };
type MonitorState = {
  connected: boolean; width: number; depth: number; blocks: SensorBlock[];
  readings: Reading[]; history: Reading[]; lastReading: Reading | null;
  profiles: { standard: number; support: number };
};
type HardwareApi = {
  getHardwareMonitorState?: () => MonitorState | null;
  setCalibratedProfile?: (type: 'standard' | 'support', resistance: number) => boolean;
  captureHardwareModelImage?: () => string;
};
type Snapshot = { id: number; image: string; blocks: number; label: string };
const initial: MonitorState = {
  connected: false, width: 2, depth: 4, blocks: [], readings: [], history: [], lastReading: null,
  profiles: { standard: 10, support: 5.1 },
};
function api(): HardwareApi { return (window as Window & { digitalTwin?: HardwareApi }).digitalTwin ?? {}; }
function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length % 2 ? sorted[(sorted.length - 1) / 2]
    : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
}

/** Animated, accessible disclosure. The panel stays mounted so live sensor data and
 *  calibration state survive closing; inert prevents focus into collapsed controls. */
function HardwareDisclosure({ title, meta, className, children, defaultOpen = false }: {
  title: string; meta: string; className: string; children: ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  return <section className={`${className} hardware-disclosure${open ? ' is-open' : ''}`}>
    <button className="hardware-tool-summary" type="button" aria-expanded={open}
      aria-controls={panelId} onClick={() => setOpen(current => !current)}>
      <span className="hardware-tool-summary__label">{title}</span>
      <span className="hardware-tool-summary__tail">
        <span className="hardware-tool-summary__meta">{meta}</span>
        <span className="hardware-tool-chevron" aria-hidden="true">
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6"
            strokeLinecap="round" strokeLinejoin="round" focusable="false">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </span>
      </span>
    </button>
    <div className="hardware-tool-reveal" id={panelId} aria-hidden={!open} inert={!open}>
      <div className="hardware-tool-reveal-inner">{children}</div>
    </div>
  </section>;
}

/** Compact, opt-in tools for the sensor-driven Builder. Nothing here edits the model. */
export function HardwareWorkbenchTools({ placement }: { placement: 'diagnostics' | 'calibration' | 'capture' }) {
  const [monitor, setMonitor] = useState<MonitorState>(initial);
  const [calibrationType, setCalibrationType] = useState<'standard' | 'support'>('standard');
  const [samples, setSamples] = useState<number[]>([]);
  const [lastSampledSequence, setLastSampledSequence] = useState(-1);
  const [calibrationMessage, setCalibrationMessage] = useState('Place a known block to receive a sensor event.');
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [captureError, setCaptureError] = useState('');

  useEffect(() => {
    const sync = (event?: Event) => {
      const next = (event as CustomEvent<MonitorState> | undefined)?.detail || api().getHardwareMonitorState?.();
      if (next) setMonitor(next);
    };
    window.addEventListener('buildit:hardware-state', sync);
    sync();
    // The 3D engine is dynamically imported after React mounts.
    const ready = () => sync();
    window.addEventListener('buildit:engine-ready', ready);
    return () => {
      window.removeEventListener('buildit:hardware-state', sync);
      window.removeEventListener('buildit:engine-ready', ready);
    };
  }, []);

  const latest = monitor.lastReading;
  const latestAdd = latest?.action === 'add' ? latest : null;
  const candidate = median(samples);
  const eventsByChannel = new Map(monitor.readings.map(reading => [reading.channel, reading]));
  const cellHeight = (x: number, y: number) => monitor.blocks.filter(block => block.x === x && block.y === y).length;

  const addCalibrationSample = () => {
    if (!monitor.connected || !latestAdd || latestAdd.sequence === lastSampledSequence) return;
    setSamples(prev => [...prev.slice(-7), latestAdd.resistance]);
    setLastSampledSequence(latestAdd.sequence);
    setCalibrationMessage(`Reading from CH ${latestAdd.channel} recorded. Remove and replace the block for another reading.`);
  };
  const applyCalibration = () => {
    if (candidate === null) return;
    const success = api().setCalibratedProfile?.(calibrationType, candidate);
    setCalibrationMessage(success
      ? `${calibrationType.toUpperCase()} set to ${candidate.toFixed(2)} kΩ for this session.`
      : 'Could not apply: profile values must differ by at least 12% and stay within 0.1–10,000 kΩ.');
  };
  const capture = () => {
    try {
      const image = api().captureHardwareModelImage?.();
      if (!image || !image.startsWith('data:image/png;base64,')) throw new Error('3D scene is not ready.');
      const stamp = new Date();
      const label = stamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setSnapshots(previous => [{ id: stamp.getTime(), image, blocks: monitor.blocks.length, label }, ...previous].slice(0, 3));
      setCaptureError('');
    } catch (error) {
      setCaptureError(error instanceof Error ? error.message : 'Could not capture image.');
    }
  };
  const download = (snapshot: Snapshot) => {
    const anchor = document.createElement('a');
    anchor.href = snapshot.image;
    anchor.download = `build-it-live-capture-${snapshot.id}.png`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  };
  const downloadSensorLog = () => {
    const rows = [['time', 'channel', 'action', 'height', 'conductance_uS', 'resistance_kOhm', 'accepted'],
      ...monitor.history.map(reading => [new Date(reading.timestamp).toISOString(), String(reading.channel), reading.action,
        String(reading.z), String(reading.conductance), String(reading.resistance.toFixed(3)), String(reading.accepted)])];
    const csv = rows.map(row => row.map(value => `"${value.replaceAll('"', '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `build-it-live-sensor-log-${Date.now()}.csv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  if (placement === 'diagnostics') return <HardwareDisclosure className="hardware-workbench-tools hardware-diagnostics"
    title="02 / SENSOR DIAGNOSTICS" meta={monitor.connected ? 'LIVE' : ''}>
    <div className="hardware-tool-panel">
      <div className="hardware-tool-panel__top"><strong>SENSOR MAP</strong><span>{monitor.width}×{monitor.depth} / {monitor.width * monitor.depth} CH</span></div>
      <div className="hardware-sensor-map" role="group" aria-label="Physical sensor channels" style={{ gridTemplateColumns: `repeat(${monitor.width},minmax(0,1fr))` }}>
        {Array.from({ length: monitor.width * monitor.depth }, (_, channel) => {
          const x = channel % monitor.width;
          const y = Math.floor(channel / monitor.width);
          const height = cellHeight(x, y);
          const event = eventsByChannel.get(channel);
          const state = height ? 'occupied' : event?.accepted === false ? 'rejected' : event ? 'observed' : 'unobserved';
          return <div key={channel} className={`hardware-sensor-cell is-${state}`}
            title={`Channel ${channel}, row ${y + 1}, column ${x + 1}. ${height} mapped blocks.${event ? ` Last ${event.action}.` : ' No events received.'}`}>
            <span>CH {String(channel).padStart(2, '0')}</span><strong>{height ? `${height} BLK` : event ? event.accepted ? 'SEEN' : 'CHECK' : '—'}</strong>
          </div>;
        })}
      </div>
      <div className="hardware-sensor-reading" aria-live="polite">
        {latest ? <><b>LAST EVENT</b><span>CH {String(latest.channel).padStart(2, '0')} / {latest.action.toUpperCase()} / {latest.resistance.toFixed(2)} kΩ</span></>
          : <><b>LAST EVENT</b><span>NO SENSOR EVENTS YET</span></>}
      </div>
      <p className="hardware-tools-note">A dash means no event received, not a failed cell. Included firmware scans CH 00 only.</p>
      <button className="hardware-log-export" type="button" disabled={!monitor.history.length} onClick={downloadSensorLog}>EXPORT EVENT LOG / CSV ↗</button>
    </div>
  </HardwareDisclosure>;

  if (placement === 'calibration') return <HardwareDisclosure className="hardware-workbench-tools hardware-calibration"
    title="SENSOR CALIBRATION" meta="PROFILES">
    <div className="hardware-tool-panel">
      <div className="hardware-tool-panel__top"><strong>RESISTANCE PROFILE</strong><span>kΩ / LIVE EVENTS</span></div>
      <div className="hardware-profile-targets" role="group" aria-label="Block type to calibrate">
        {(['standard', 'support'] as const).map(type => <button type="button" key={type} className={calibrationType === type ? 'is-active' : ''}
          aria-pressed={calibrationType === type} onClick={() => { setCalibrationType(type); setSamples([]); setLastSampledSequence(-1); setCalibrationMessage('Use readings from a known ' + type + ' block.'); }}>
          {type.toUpperCase()} <span>{monitor.profiles[type].toFixed(2)} kΩ</span>
        </button>)}
      </div>
      <div className="hardware-calibration-values"><div><small>LATEST ADD</small><strong>{latestAdd ? `${latestAdd.resistance.toFixed(2)} kΩ` : '—'}</strong></div><div><small>MEDIAN / {samples.length} READINGS</small><strong>{candidate !== null ? `${candidate.toFixed(2)} kΩ` : '—'}</strong></div></div>
      <div className="hardware-calibration-actions">
        <button type="button" disabled={!monitor.connected || !latestAdd || latestAdd.sequence === lastSampledSequence || samples.length >= 8} onClick={addCalibrationSample}>+ RECORD</button>
        <button type="button" disabled={!samples.length} onClick={() => { setSamples([]); setCalibrationMessage('Samples cleared.'); }}>RESET</button>
      </div>
      <button className="hardware-tool-primary" type="button" disabled={!samples.length} onClick={applyCalibration}>APPLY TO {calibrationType.toUpperCase()}</button>
      <p className="hardware-tools-note" role="status">{calibrationMessage} Only incoming ADD events are samples; no continuous readings are available.</p>
    </div>
  </HardwareDisclosure>;

  return <div className="hardware-capture-tools">
    <button type="button" className="hardware-capture-button" onClick={capture}>CAPTURE MODEL <span>PNG ↗</span></button>
    {captureError && <p className="hardware-tools-error" role="alert">{captureError}</p>}
    {snapshots.length > 0 && <HardwareDisclosure className="hardware-capture-history"
      title="RECENT CAPTURES" meta={`${snapshots.length} / 3`} defaultOpen>
      <div className="hardware-tool-panel">
      <div className="hardware-snapshots">
        {snapshots.map((shot, index) => <div className="hardware-snapshot" key={shot.id + '-' + index}>
          <img src={shot.image} alt={`Captured 3D model at ${shot.label}`} />
          <div><strong>{shot.label}</strong><small>{shot.blocks} BLOCKS</small></div>
          <button type="button" onClick={() => download(shot)} aria-label={`Download snapshot from ${shot.label}`}>PNG ↗</button>
        </div>)}
        <button className="hardware-snapshot-clear" type="button" onClick={() => setSnapshots([])}>CLEAR SNAPSHOTS</button>
      </div>
      </div>
    </HardwareDisclosure>}
  </div>;
}
