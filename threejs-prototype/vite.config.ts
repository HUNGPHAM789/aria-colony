import { defineConfig } from 'vite';

export default defineConfig({
  // The game is deployed to the project site: https://hungpham789.github.io/aria-colony/
  base: '/aria-colony/',
  server: { host: '0.0.0.0' },
  build: { target: 'es2022' },
});
