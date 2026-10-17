import '@silvercord/ui/global.css';
import './app/app.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { initI18n } from './i18n/i18n.ts';
import { useSession } from './session/session-store.ts';

const root = document.getElementById('root');
if (!root) throw new Error('missing #root element');

await initI18n();
void useSession.getState().restore();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
