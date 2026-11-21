import type { AstroComponentFactory } from 'astro/runtime/server/index.js';
interface Props {
cssVariable: import('astro:assets').CssVariable;
preload?: import('astro:assets').FontPreloadFilter;
}
declare const Font: AstroComponentFactory & ((props: Props) => ReturnType<AstroComponentFactory>);
export default Font;
