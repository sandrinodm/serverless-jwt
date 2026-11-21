import type sharp = require('sharp');
import type { SharpConstructor as ESMSharpConstructor } from 'sharp' with {
  'resolution-mode': 'import',
};

/**
 * Links Sharp0.35.5's missing CJS alias to the exact ESM interface from the same package.
 */
declare module 'sharp' {
  type SharpConstructor = ESMSharpConstructor;
}
