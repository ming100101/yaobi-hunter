import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Proxy OKX public market-data through the dev server so the browser makes
// same-origin requests (no CORS) and the upstream call originates from the
// user's machine. Binance/Bybit are geo-blocked from many regions; OKX is
// widely reachable. Both /api and /futures-style paths live under www.okx.com.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/okx': {
        target: 'https://www.okx.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/okx/, ''),
      },
      // Binance public data bucket (S3 XML listing endpoint) — used only to
      // enumerate the UM-futures symbol list (the live fapi API is geo-blocked;
      // the bucket is not). data.binance.vision itself serves an HTML app.
      '/bnv': {
        target: 'https://s3-ap-northeast-1.amazonaws.com',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/bnv/, '/data.binance.vision'),
      },
    },
  },
});
