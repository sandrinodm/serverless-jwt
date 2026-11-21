declare module 'astro:content' {
	export interface RenderResult {
		Content: import('astro/runtime/server/index.js').AstroComponentFactory;
		headings: import('astro').MarkdownHeading[];
		remarkPluginFrontmatter: Record<string, any>;
	}
	export interface Render {
		'.md': Promise<RenderResult>;
	}

	export interface RenderedContent {
		html: string;
		metadata?: {
			imagePaths: Array<string>;
			[key: string]: unknown;
		};
	}

	export type Flatten<T> = T extends { [K: string]: infer U } ? U : never;

	type ServerlessJwtCollectionKey = keyof DataEntryMap;
	type ServerlessJwtCollectionEntry<C extends ServerlessJwtCollectionKey> = Flatten<DataEntryMap[C]>;

	export type AllValuesOf<T> = T extends any ? T[keyof T] : never;

	export type ReferenceDataEntry<
		C extends ServerlessJwtCollectionKey,
		E extends keyof DataEntryMap[C] = string,
	> = {
		collection: C;
		id: E;
	};

	export type ReferenceLiveEntry<C extends keyof LiveContentConfig['collections']> = {
		collection: C;
		id: string;
	};

	function ServerlessJwtGetCollection<C extends keyof DataEntryMap, E extends ServerlessJwtCollectionEntry<C>>(
		collection: C,
		filter?: (entry: ServerlessJwtCollectionEntry<C>) => entry is E,
	): Promise<E[]>;
	function ServerlessJwtGetCollection<C extends keyof DataEntryMap>(
		collection: C,
		filter?: (entry: ServerlessJwtCollectionEntry<C>) => unknown,
	): Promise<ServerlessJwtCollectionEntry<C>[]>;

	function ServerlessJwtGetLiveCollection<C extends keyof LiveContentConfig['collections']>(
		collection: C,
		filter?: LiveLoaderCollectionFilterType<C>,
	): Promise<
		import('astro').LiveDataCollectionResult<LiveLoaderDataType<C>, LiveLoaderErrorType<C>>
	>;

	function ServerlessJwtGetEntry<
		C extends keyof DataEntryMap,
		E extends keyof DataEntryMap[C] | (string & {}),
	>(
		entry: ReferenceDataEntry<C, E>,
	): E extends keyof DataEntryMap[C]
		? Promise<DataEntryMap[C][E]>
		: Promise<ServerlessJwtCollectionEntry<C> | undefined>;
	function ServerlessJwtGetEntry<
		C extends keyof DataEntryMap,
		E extends keyof DataEntryMap[C] | (string & {}),
	>(
		collection: C,
		id: E,
	): E extends keyof DataEntryMap[C]
		? string extends keyof DataEntryMap[C]
			? Promise<DataEntryMap[C][E]> | undefined
			: Promise<DataEntryMap[C][E]>
		: Promise<ServerlessJwtCollectionEntry<C> | undefined>;
	function ServerlessJwtGetLiveEntry<C extends keyof LiveContentConfig['collections']>(
		collection: C,
		filter: string | LiveLoaderEntryFilterType<C>,
	): Promise<import('astro').LiveDataEntryResult<LiveLoaderDataType<C>, LiveLoaderErrorType<C>>>;

	/** Resolve an array of entry references from the same collection */
	function ServerlessJwtGetEntries<C extends keyof DataEntryMap>(
		entries: ReferenceDataEntry<C, keyof DataEntryMap[C]>[],
	): Promise<ServerlessJwtCollectionEntry<C>[]>;

	function ServerlessJwtRender<C extends keyof DataEntryMap>(
		entry: DataEntryMap[C][string],
	): Promise<RenderResult>;

	function ServerlessJwtRender<C extends keyof LiveContentConfig['collections']>(
		entry: import('astro').LiveDataEntry<LiveLoaderDataType<C>>,
	): Promise<RenderResult>;

	function ServerlessJwtReference<
		C extends
			| keyof DataEntryMap
			// Allow generic `string` to avoid excessive type errors in the config
			// if `dev` is not running to update as you edit.
			// Invalid collection names will be caught at build time.
			| (string & {}),
	>(
		collection: C,
	): import('astro/zod').ZodPipe<
		import('astro/zod').ZodString,
		import('astro/zod').ZodTransform<
			C extends keyof DataEntryMap
				? {
						collection: C;
						id: string;
					}
				: never,
			string
		>
	>;

	export type ReturnTypeOrOriginal<T> = T extends (...args: any[]) => infer R ? R : T;
	export type InferEntrySchema<C extends keyof DataEntryMap> = import('astro/zod').infer<
		ReturnTypeOrOriginal<Required<ServerlessJwtContentConfig['collections'][C]>['schema']>
	>;
	export type ExtractLoaderConfig<T> = T extends { loader: infer L } ? L : never;
	export type InferLoaderSchema<
		C extends keyof DataEntryMap,
		L = ExtractLoaderConfig<ServerlessJwtContentConfig['collections'][C]>,
	> = L extends { schema: import('astro/zod').ZodSchema }
		? import('astro/zod').infer<L['schema']>
		: any;

	export type DataEntryMap = {
		// @@DATA_ENTRY_MAP@@
	};

	export type ExtractLoaderTypes<T> = T extends import('astro/loaders').LiveLoader<
		infer TData extends Record<string, any>,
		infer TEntryFilter extends Record<string, any> | never,
		infer TCollectionFilter extends Record<string, any> | never,
		infer TError extends Error
	>
		? { data: TData; entryFilter: TEntryFilter; collectionFilter: TCollectionFilter; error: TError }
		: { data: never; entryFilter: never; collectionFilter: never; error: never };
	export type ExtractEntryFilterType<T> = ExtractLoaderTypes<T>['entryFilter'];
	export type ExtractCollectionFilterType<T> = ExtractLoaderTypes<T>['collectionFilter'];
	export type ExtractErrorType<T> = ExtractLoaderTypes<T>['error'];
	export type ExtractDataType<T> = ExtractLoaderTypes<T>['data'];

	export type LiveLoaderDataType<C extends keyof LiveContentConfig['collections']> = 
		LiveContentConfig['collections'][C]['schema'] extends undefined
			? ExtractDataType<LiveContentConfig['collections'][C]['loader']>
			: import('astro/zod').infer<
					Exclude<LiveContentConfig['collections'][C]['schema'], undefined>
				>;
	export type LiveLoaderEntryFilterType<C extends keyof LiveContentConfig['collections']> =
		ExtractEntryFilterType<LiveContentConfig['collections'][C]['loader']>;
	export type LiveLoaderCollectionFilterType<C extends keyof LiveContentConfig['collections']> =
		ExtractCollectionFilterType<LiveContentConfig['collections'][C]['loader']>;
	export type LiveLoaderErrorType<C extends keyof LiveContentConfig['collections']> = ExtractErrorType<
		LiveContentConfig['collections'][C]['loader']
	>;

	type ServerlessJwtContentConfig = '@@CONTENT_CONFIG_TYPE@@';
	export type LiveContentConfig = '@@LIVE_CONTENT_CONFIG_TYPE@@';

	export interface ServerlessJwtGeneratedContent {
		entryMap: DataEntryMap;
		contentConfig: ServerlessJwtContentConfig;
		getCollection: typeof ServerlessJwtGetCollection;
		getLiveCollection: typeof ServerlessJwtGetLiveCollection;
		getEntry: typeof ServerlessJwtGetEntry;
		getLiveEntry: typeof ServerlessJwtGetLiveEntry;
		getEntries: typeof ServerlessJwtGetEntries;
		render: typeof ServerlessJwtRender;
		reference: typeof ServerlessJwtReference;
	}

	export {};
}
