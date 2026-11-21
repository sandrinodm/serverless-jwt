import type { Root } from '__SERVERLESS_JWT_HAST__';
import type { Plugin } from 'unified';
import type { ShikiConfig } from '@astrojs/internal-helpers/markdown';
export declare const rehypeShiki: Plugin<[ShikiConfig, string[]?], Root>;
