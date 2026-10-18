import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// API do ERP (erpxx)
const api = process.env.VITE_API_PROXY_TARGET || 'http://localhost:3010';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3333,
    host: '0.0.0.0',
    proxy: { '/api': api, '/uploads': api },
  },
});
