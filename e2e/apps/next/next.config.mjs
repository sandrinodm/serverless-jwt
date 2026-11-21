/**
 * Bounds local build workers while retaining the actual Next production compiler.
 */
const config = { experimental: { cpus: 1 }, logging: { incomingRequests: false } };

export default config;
