import type { AstroComponentFactory } from 'astro/runtime/server/index.js';
type Fallback = 'none' | 'animate' | 'swap';
export interface Props { fallback?: Fallback; }
declare const ClientRouter: AstroComponentFactory & ((props: Props) => ReturnType<AstroComponentFactory>);
export default ClientRouter;
