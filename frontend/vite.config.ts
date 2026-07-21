import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    // react-draggable (used by react-rnd) reads process.env.NODE_ENV for its debug logger,
    // which isn't defined in the browser by default.
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'development'),
  },
})
