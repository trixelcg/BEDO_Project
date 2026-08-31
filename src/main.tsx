import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Injected by vite.config.ts. Reported once at boot so that during a rollout it is
// possible to tell which build actually served the page being looked at.
declare const __BUILD_GEN__: string;
declare global {
  interface Window {
    /** Build generation stamp, for telling two concurrently-served builds apart. */
    __BEDO_BUILD__?: string;
  }
}
window.__BEDO_BUILD__ = __BUILD_GEN__;
console.info(`BEDO build: ${__BUILD_GEN__}`);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
