import type { AstroMarkdownOptions, MarkdownHeading, MarkdownRenderer } from '@astrojs/internal-helpers/markdown';
declare module 'vfile' {
    interface DataMap {
        astro: {
            headings?: MarkdownHeading[];
            localImagePaths?: string[];
            remoteImagePaths?: string[];
            frontmatter?: Record<string, any>;
        };
    }
}
export type { Node } from '__SERVERLESS_JWT_UNIST__';
export type { AstroMarkdownOptions, MarkdownHeading, MarkdownProcessor, MarkdownRenderer, MarkdownRenderOptions, MarkdownRenderResult, RehypePlugin, RehypePlugins, RemarkPlugin, RemarkPlugins, RemarkRehype, ShikiConfig, Smartypants, SyntaxHighlightConfig, SyntaxHighlightConfigType, } from '@astrojs/internal-helpers/markdown';
export { extractFrontmatter, isFrontmatterValid, type ParseFrontmatterOptions, type ParseFrontmatterResult, parseFrontmatter, } from '@astrojs/internal-helpers/frontmatter';
export { rehypeHeadingIds } from './rehype-collect-headings.js';
export { rehypePrism } from './rehype-prism.js';
export { rehypeShiki } from './rehype-shiki.js';
export { remarkCollectImages } from './remark-collect-images.js';
export { isUnifiedProcessor, type UnifiedProcessorOptions, type UnifiedResolvedOptions, unified, } from './processor.js';
export { markdownConfigDefaults, syntaxHighlightDefaults, } from '@astrojs/internal-helpers/markdown';
/**
 * Create a markdown preprocessor to render multiple markdown files
 */
export declare function createMarkdownProcessor(opts?: AstroMarkdownOptions): Promise<MarkdownRenderer>;
