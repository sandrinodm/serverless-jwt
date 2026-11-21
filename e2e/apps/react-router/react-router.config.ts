import type { Config } from '@react-router/dev/config';

/**
 * Middleware is stable in the verified React Router version and needs no future flag.
 */
const config: Config = {
  /**
   * Protected resource routes execute on the actual production server.
   */
  ssr: true,
};

export default config;
