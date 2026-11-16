import { initDomBlame } from 'dom-blame';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';

// Initialize dom-blame before React mounts so initial fetch() calls are traced
initDomBlame({
  showDock: true,
  enableKeyboard: true,
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
