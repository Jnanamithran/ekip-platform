import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Port 5173 and host: true match the repo's existing Dockerfile
// (EXPOSE 5173, CMD runs with --host) — keep these in sync if that
// Dockerfile ever changes.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 5173,
  },
})
