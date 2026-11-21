import { tanstackStart } from '@tanstack/solid-start/plugin/vite';
import { nitro } from 'nitro/vite';
import framework from 'vite-plugin-solid';
import { defineConfig } from 'vite-plus';

export default defineConfig({
  plugins: [
    tanstackStart(),
    nitro({
      preset: 'node-server',
      features: { fastResponse: process.env.P4_NITRO_FAST_RESPONSE === '1' },
    }),
    framework({ ssr: true }),
  ],
});
