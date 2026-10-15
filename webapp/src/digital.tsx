import './page-transitions.css';
import { installPageTransitions } from './pageTransitions';
import { createRoot } from 'react-dom/client';
import { BuilderApp } from './pages/BuilderApp';
import './style.css';
import './studio.css';
import './hardware-studio.css';

installPageTransitions();

const root = document.getElementById('root');
if (!root) throw new Error('React root is missing');
document.documentElement.dataset.builderMode = 'digital';
createRoot(root).render(<BuilderApp mode="digital" />);

import './controls-v35.css';

import './glass-select-v43.css';

import './hardware-only.css';
import './hardware-builder.css';

import './library-ux-v85.css';
import './preflight-v86.css';

import './menus-v89.css';

import './radius-consistency.css';

import './workflow-refinements.css';
import './night-mode.css';
import './theme-parity-v143.css';
