import { defineConfig } from 'vite';

export default defineConfig({
  base: './', 
  
  resolve: {
    alias: {
      path: 'path-browserify',
    },
  },
  
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: 'public/index.html',
      },
    },
  },
});
