import './page-transitions.css';
import { installPageTransitions } from './pageTransitions';
import { createRoot } from 'react-dom/client';
import { TutorialApp } from './pages/TutorialApp';
import './style.css';
import './tutorial.css';
import './studio.css';
import './hardware-guide.css';

installPageTransitions();

const root = document.getElementById('root');
if (!root) throw new Error('React root is missing');
createRoot(root).render(<TutorialApp />);

import './controls-v35.css';
import './guide-interactive.css';

import './radius-consistency.css';

import './workflow-refinements.css';
import './night-mode.css';
import './theme-parity-v143.css';
