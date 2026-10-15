import './page-transitions.css';
import { installPageTransitions } from './pageTransitions';
import { createRoot } from 'react-dom/client';
import { BrickMakerApp } from './pages/BrickMakerApp';
import './style.css';
import './brickmaker.css';
import './studio.css';

installPageTransitions();

const root = document.getElementById('root');
if (!root) throw new Error('React root is missing');
createRoot(root).render(<BrickMakerApp />);

import './controls-v35.css';

import './radius-consistency.css';

import './workflow-refinements.css';
import './night-mode.css';
import './theme-parity-v143.css';
