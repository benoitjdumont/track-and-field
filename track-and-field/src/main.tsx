import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import 'maplibre-gl/dist/maplibre-gl.css';
import App from './App.tsx';
import './index.css';

// Register production Service Worker only when served directly without HTTP redirects
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    fetch('/sw.js', { redirect: 'manual' })
      .then((res) => {
        if (res.status === 200 && !res.redirected) {
          return navigator.serviceWorker.register('/sw.js');
        }
        return undefined;
      })
      .catch(() => {
        // Ignore registration errors in proxy/iframe previews
      });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
