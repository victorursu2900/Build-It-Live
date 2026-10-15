import { useEffect } from 'react';
import { BrickMakerHeader } from '../components/BrickMakerHeader';
import { BrickWorkspace } from '../components/BrickWorkspace';

/** React mounts the page before the existing Three.js engine initializes. */
export function BrickMakerApp() {
  useEffect(() => {
    void import('../engine/brickMakerEngine');
  }, []);
  return (
    <div className="brick-page">
      <BrickMakerHeader />
      <BrickWorkspace />
    </div>
  );
}
