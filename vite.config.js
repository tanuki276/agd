// vite.config.js
import { defineConfig } from 'vite';

export default defineConfig({
  base: './', 
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'public/index.html',
      },
    },
  },
});
