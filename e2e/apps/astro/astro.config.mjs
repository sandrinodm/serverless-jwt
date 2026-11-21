import node from '@astrojs/node';
import { serverlessJwt } from '@serverless-jwt/astro/build';
import { defineConfig } from 'astro/config';

import { protect } from './src/protect.ts';

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [serverlessJwt({ protect })],
});
