import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import framework from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  plugins: [
    tanstackStart(),
    nitro({
      preset: 'node-server',
      features: { fastResponse: process.env.P4_NITRO_FAST_RESPONSE === '1' },
    }),
    framework(),
  ],
});
