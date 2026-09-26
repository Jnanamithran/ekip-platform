import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Port 3000 and host: true match the repo's existing Dockerfile
// (EXPOSE 3000, CMD runs with --host) — keep these in sync if that
// Dockerfile ever changes.
export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: 3000,
  },
})
