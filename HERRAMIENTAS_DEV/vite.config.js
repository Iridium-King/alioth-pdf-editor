import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
  root: '.',
  base: './',

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, 'BASE.html'),
      output: {
        // Mantener nombres legibles en dist/
        entryFileNames: 'js/[name].js',
        chunkFileNames: 'js/[name]-[hash].js',
        assetFileNames: (info) => {
          if (/\.(woff2?|ttf|otf|eot)$/.test(info.name)) return 'fonts/[name][extname]';
          if (/\.css$/.test(info.name)) return 'css/[name][extname]';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
    // No minificar en dev para debug fácil
    minify: false,
    sourcemap: true,
  },

  server: {
    port: 8080,
    open: '/BASE.html',
  },

  // Vite no debe intentar procesar los workers de Pyodide
  optimizeDeps: {
    exclude: ['pyodide'],
  },

  assetsInclude: ['**/*.ttf', '**/*.woff2', '**/*.woff', '**/*.otf'],
});
