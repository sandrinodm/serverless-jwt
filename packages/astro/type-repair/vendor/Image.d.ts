import type { AstroComponentFactory } from 'astro/runtime/server/index.js';
import type { LocalImageProps, RemoteImageProps } from 'astro:assets';
type Props = LocalImageProps | RemoteImageProps;
declare const Image: AstroComponentFactory & ((props: Props) => ReturnType<AstroComponentFactory>);
export default Image;
