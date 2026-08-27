import '@spectrum-web-components/theme/sp-theme.js';
import '@spectrum-web-components/theme/src/themes.js';
import '@spectrum-web-components/card/sp-card.js';
import '@spectrum-web-components/button/sp-button.js';
import './styles.css';
import { createDemoApp } from './app';

const root = document.querySelector<HTMLElement>('#app');
if (!root) {
  throw new Error('Missing #app mount point');
}

createDemoApp(root);
