import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // The app calls /api relatively, exactly as it does in production, so the
    // dev setup exercises the same same-origin path and needs no CORS.
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
        changeOrigin: true,
        // waSO's chat socket lives under /api too.
        ws: true,
      },
    },
  },
  define: {
    // react-draggable (used by react-rnd) reads process.env.NODE_ENV for its debug logger,
    // which isn't defined in the browser by default.
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },
})
