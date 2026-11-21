import { solidStart } from '@solidjs/start/config';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  plugins: [solidStart({ middleware: './src/middleware.ts' }), nitro({ preset: 'node-server' })],
});
