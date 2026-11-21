import { serverlessJwtAdapter } from '@serverless-jwt/sveltekit/build';
import cloudflare from '@sveltejs/adapter-cloudflare';
import node from '@sveltejs/adapter-node';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite-plus';

import { protect } from './src/protect.ts';

export default defineConfig({
  plugins: [
    sveltekit({
      adapter: serverlessJwtAdapter(process.env.SJWT_CLOUDFLARE === '1' ? cloudflare() : node(), {
        protect,
      }),
      prerender: { handleHttpError: 'ignore', handleUnseenRoutes: 'ignore' },
    }),
  ],
});
