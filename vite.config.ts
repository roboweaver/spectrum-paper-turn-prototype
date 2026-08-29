import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so one build works at a domain root, under the GitHub Pages
  // /spectrum-paper-turn-prototype/ subpath, and from the local filesystem.
  base: './',
  server: {
    host: '127.0.0.1',
    port: 4173,
  },
});
