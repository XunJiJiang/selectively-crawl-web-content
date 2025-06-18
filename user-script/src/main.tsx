import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';

// 动态创建悬浮窗挂载点，避免阻挡原网页内容
const FLOATING_ID = 'selective-crawl-floating-root';
let mount = document.getElementById(FLOATING_ID);
if (!mount) {
  mount = document.createElement('div');
  mount.id = FLOATING_ID;
  document.body.appendChild(mount);
}

createRoot(mount).render(
  <StrictMode>
    <App />
  </StrictMode>
);
