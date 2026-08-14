import { cssVariables } from '@mcs/ui';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { App } from './App.js';
import './index.css';

// Single source of truth (packages/ui#7): the CSS custom properties consumed
// by index.css are generated from the same token data @mcs/ui exports as TS,
// never hand-duplicated.
const tokenStyle = document.createElement('style');
tokenStyle.textContent = cssVariables();
document.head.prepend(tokenStyle);

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found.');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
