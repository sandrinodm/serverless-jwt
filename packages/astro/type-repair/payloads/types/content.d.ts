declare module 'astro:content' {
	/** Exact generated declarations merge here after astro sync; pre-sync fallbacks retain the original SDK signatures. */
	export interface ServerlessJwtGeneratedContent {}
	import zod from 'astro/zod';
	export type {
		ImageFunction,
		DataEntry,
		DataStore,
		MetaStore,
		BaseSchema,
		SchemaContext,
	} from 'astro/content/config';
	export { defineLiveCollection, defineCollection } from 'astro/content/config';

	// TODO: remove in Astro 8
	/**
	 * @deprecated
	 * `import { z } from 'astro:content'` is deprecated and will be removed
	 * in Astro 8. Use `import { z } from 'astro/zod'` instead.
	 */
	export const z: typeof zod.z;

	/** Run `astro dev` or `astro sync` to generate high fidelity types */
	export const getEntryBySlug: (...args: any[]) => any;
	/** Run `astro dev` or `astro sync` to generate high fidelity types */
	export const getDataEntryById: (...args: any[]) => any;
	/** Run `astro dev` or `astro sync` to generate high fidelity types */
	export const getCollection: ServerlessJwtGeneratedContent extends { getCollection: infer Generated } ? Generated : (...args: any[]) => any;
	/** Run `astro dev` or `astro sync` to generate high fidelity types */
	export const getEntry: ServerlessJwtGeneratedContent extends { getEntry: infer Generated } ? Generated : (...args: any[]) => any;
	/** Run `astro dev` or `astro sync` to generate high fidelity types */
	export const getEntries: ServerlessJwtGeneratedContent extends { getEntries: infer Generated } ? Generated : (...args: any[]) => any;
	/** Run `astro dev` or `astro sync` to generate high fidelity types */
	export const reference: ServerlessJwtGeneratedContent extends { reference: infer Generated } ? Generated : (...args: any[]) => any;
	/** Run `astro dev` or `astro sync` to generate high fidelity types */
	export type CollectionKey = ServerlessJwtGeneratedContent extends { entryMap: infer Map } ? keyof Map : any;
	/** Run `astro dev` or `astro sync` to generate high fidelity types */
	export type CollectionEntry<C extends CollectionKey> = ServerlessJwtGeneratedContent extends { entryMap: infer Map } ? C extends keyof Map ? Map[C][keyof Map[C]] : never : any;
	/** Run `astro dev` or `astro sync` to generate high fidelity types */
	export type ContentCollectionKey = any;
	/** Run `astro dev` or `astro sync` to generate high fidelity types */
	export type DataCollectionKey = any;
	/** Run `astro dev` or `astro sync` to generate high fidelity types */
	export type ContentConfig = ServerlessJwtGeneratedContent extends { contentConfig: infer Config } ? Config : any;
	/** Run `astro dev` or `astro sync` to generate high fidelity types */
	export const render: ServerlessJwtGeneratedContent extends { render: infer Generated } ? Generated : (entry: any) => any;
	/** Run `astro dev` or `astro sync` to generate high fidelity types */
	export const getLiveCollection: ServerlessJwtGeneratedContent extends { getLiveCollection: infer Generated } ? Generated : (...args: any[]) => any;
	/** Run `astro dev` or `astro sync` to generate high fidelity types */
	export const getLiveEntry: ServerlessJwtGeneratedContent extends { getLiveEntry: infer Generated } ? Generated : (...args: any[]) => any;
}
