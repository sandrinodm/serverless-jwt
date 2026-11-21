import type { AstroComponentFactory } from 'astro/runtime/server/index.js';
import type { LocalImageProps, RemoteImageProps } from 'astro:assets';
import type { ImageOutputFormat } from 'astro';
import type { HTMLAttributes } from 'astro/types';
export type Props = (LocalImageProps | RemoteImageProps) & {
formats?: ImageOutputFormat[];
fallbackFormat?: ImageOutputFormat;
pictureAttributes?: HTMLAttributes<'picture'>;
};
declare const Picture: AstroComponentFactory & ((props: Props) => ReturnType<AstroComponentFactory>);
export default Picture;
