import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './theme/tokens.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('index.html 少了 #root');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);