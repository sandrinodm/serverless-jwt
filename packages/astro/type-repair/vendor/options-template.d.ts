import type { Stats } from 'node:fs';
import type { LRUCache } from 'lru-cache';
import type { MongoClientOptions } from '__SERVERLESS_JWT_MONGODB__';
import type { RedisOptions as RedisOptions$2, ClusterNode, ClusterOptions } from '__SERVERLESS_JWT_IOREDIS__';

interface AzureAppConfigurationOptions {
    /**
     * Optional prefix for keys. This can be used to isolate keys from different applications in the same Azure App Configuration instance. E.g. "app01" results in keys like "app01:foo" and "app01:bar".
     * @default null
     */
    prefix?: string;
    /**
     * Optional label for keys. If not provided, all keys will be created and listed without labels. This can be used to isolate keys from different environments in the same Azure App Configuration instance. E.g. "dev" results in keys like "foo" and "bar" with the label "dev".
     * @default '\0'
     */
    label?: string;
    /**
     * Optional endpoint to use when connecting to Azure App Configuration. If not provided, the appConfigName option must be provided. If both are provided, the endpoint option takes precedence.
     * @default null
     */
    endpoint?: string;
    /**
     * Optional name of the Azure App Configuration instance to connect to. If not provided, the endpoint option must be provided. If both are provided, the endpoint option takes precedence.
     * @default null
     */
    appConfigName?: string;
    /**
     * Optional connection string to use when connecting to Azure App Configuration. If not provided, the endpoint option must be provided. If both are provided, the endpoint option takes precedence.
     * @default null
     */
    connectionString?: string;
}

interface AzureCosmosOptions {
    /**
     * CosmosDB endpoint in the format of https://<account>.documents.azure.com:443/.
     */
    endpoint: string;
    /**
     * CosmosDB account key. If not provided, the driver will use the DefaultAzureCredential (recommended).
     */
    accountKey?: string;
    /**
     * The name of the database to use. Defaults to `unstorage`.
     * @default "unstorage"
     */
    databaseName?: string;
    /**
     * The name of the container to use. Defaults to `unstorage`.
     * @default "unstorage"
     */
    containerName?: string;
}

/**
 * Allows the request to be aborted upon firing of the "abort" event.
 * Compatible with the browser built-in AbortSignal and common polyfills.
 */
interface AbortSignalLike {
    /**
     * Indicates if the signal has already been aborted.
     */
    readonly aborted: boolean;
    /**
     * Add new "abort" event listener, only support "abort" event.
     */
    addEventListener(type: "abort", listener: (this: AbortSignalLike, ev: any) => any, options?: any): void;
    /**
     * Remove "abort" event listener, only support "abort" event.
     */
    removeEventListener(type: "abort", listener: (this: AbortSignalLike, ev: any) => any, options?: any): void;
}

/**
 * Supported HTTP methods to use when making requests.
 *
 * @public
 */
type HttpMethods = "GET" | "PUT" | "POST" | "DELETE" | "PATCH" | "HEAD" | "OPTIONS" | "TRACE";

/**
 * Re-export of `NodeJS.ReadableStream` for use in platform-neutral code.
 *
 * @public
 */
type NodeReadableStream = NodeJS.ReadableStream;
/**
 * Re-export of `Buffer` for use in platform-neutral code.
 *
 * @public
 */
type NodeBuffer = Buffer;
/**
 * Re-export of the Web `ReadableStream` for use in platform-neutral code.
 *
 * @public
 */
type WebReadableStream<R = any> = ReadableStream<R>;

/** An immutable context bag of tracing values for the current operation. */
interface TracingContext {
    /**
     * Sets a given object on a context.
     * @param key - The key of the given context value.
     * @param value - The value to set on the context.
     *
     * @returns - A new context with the given value set.
     */
    setValue(key: symbol, value: unknown): TracingContext;
    /**
     * Gets an object from the context if it exists.
     * @param key - The key of the given context value.
     *
     * @returns - The value of the given context value if it exists, otherwise `undefined`.
     */
    getValue(key: symbol): unknown;
    /**
     * Deletes an object from the context if it exists.
     * @param key - The key of the given context value to delete.
     */
    deleteValue(key: symbol): TracingContext;
}
/**
 * Tracing options to set on an operation.
 */
interface OperationTracingOptions {
    /** The context to use for created Tracing Spans. */
    tracingContext?: TracingContext;
}

/**
 * A HttpHeaders collection represented as a simple JSON object.
 */
type RawHttpHeaders = {
    [headerName: string]: string;
};
/**
 * Represents a set of HTTP headers on a request/response.
 * Header names are treated as case insensitive.
 */
interface HttpHeaders extends Iterable<[string, string]> {
    /**
     * Returns the value of a specific header or undefined if not set.
     * @param name - The name of the header to retrieve.
     */
    get(name: string): string | undefined;
    /**
     * Returns true if the specified header exists.
     * @param name - The name of the header to check.
     */
    has(name: string): boolean;
    /**
     * Sets a specific header with a given value.
     * @param name - The name of the header to set.
     * @param value - The value to use for the header.
     */
    set(name: string, value: string | number | boolean): void;
    /**
     * Removes a specific header from the collection.
     * @param name - The name of the header to delete.
     */
    delete(name: string): void;
    /**
     * Accesses a raw JS object that acts as a simple map
     * of header names to values.
     */
    toJSON(options?: {
        preserveCase?: boolean;
    }): RawHttpHeaders;
}
/**
 * A part of the request body in a multipart request.
 */
interface BodyPart {
    /**
     * The headers for this part of the multipart request.
     */
    headers: HttpHeaders;
    /**
     * The body of this part of the multipart request.
     */
    body: ((() => WebReadableStream<Uint8Array>) | (() => NodeReadableStream)) | WebReadableStream<Uint8Array> | NodeReadableStream | Uint8Array | Blob;
}
/**
 * A request body consisting of multiple parts.
 */
interface MultipartRequestBody {
    /**
     * The parts of the request body.
     */
    parts: BodyPart[];
    /**
     * The boundary separating each part of the request body.
     * If not specified, a random boundary will be generated.
     *
     * When specified, '--' will be prepended to the boundary in the request to ensure the boundary follows the specification.
     */
    boundary?: string;
}
/**
 * Types of bodies supported on the request.
 * NodeReadableStream and () =\> NodeReadableStream is Node only.
 * Blob, WebReadableStream<Uint8Array>, and () =\> WebReadableStream<Uint8Array> are browser only.
 */
type RequestBodyType = NodeReadableStream | (() => NodeReadableStream) | WebReadableStream<Uint8Array> | (() => WebReadableStream<Uint8Array>) | Blob | ArrayBuffer | ArrayBufferView | FormData | string | null;
/**
 * An interface compatible with NodeJS's `http.Agent`.
 * We want to avoid publicly re-exporting the actual interface,
 * since it might vary across runtime versions.
 */
interface Agent {
    /**
     * Destroy any sockets that are currently in use by the agent.
     */
    destroy(): void;
    /**
     * For agents with keepAlive enabled, this sets the maximum number of sockets that will be left open in the free state.
     */
    maxFreeSockets: number;
    /**
     * Determines how many concurrent sockets the agent can have open per origin.
     */
    maxSockets: number;
    /**
     * An object which contains queues of requests that have not yet been assigned to sockets.
     */
    requests: unknown;
    /**
     * An object which contains arrays of sockets currently in use by the agent.
     */
    sockets: unknown;
}
/**
 * Metadata about a request being made by the pipeline.
 */
interface PipelineRequest {
    /**
     * The URL to make the request to.
     */
    url: string;
    /**
     * The HTTP method to use when making the request.
     */
    method: HttpMethods;
    /**
     * The HTTP headers to use when making the request.
     */
    headers: HttpHeaders;
    /**
     * The number of milliseconds a request can take before automatically being terminated.
     * If the request is terminated, an `AbortError` is thrown.
     * Defaults to 0, which disables the timeout.
     */
    timeout: number;
    /**
     * Indicates whether the user agent should send cookies from the other domain in the case of cross-origin requests.
     * Defaults to false.
     */
    withCredentials: boolean;
    /**
     * A unique identifier for the request. Used for logging and tracing.
     */
    requestId: string;
    /**
     * The HTTP body content (if any)
     */
    body?: RequestBodyType;
    /**
     * Body for a multipart request.
     */
    multipartBody?: MultipartRequestBody;
    /**
     * To simulate a browser form post
     */
    formData?: FormDataMap;
    /**
     * A list of response status codes whose corresponding PipelineResponse body should be treated as a stream.
     * When streamResponseStatusCodes contains the value Number.POSITIVE_INFINITY any status would be treated as a stream.
     */
    streamResponseStatusCodes?: Set<number>;
    /**
     * Proxy configuration.
     */
    proxySettings?: ProxySettings;
    /**
     * If the connection should not be reused.
     */
    disableKeepAlive?: boolean;
    /**
     * Used to abort the request later.
     */
    abortSignal?: AbortSignalLike;
    /**
     * Tracing options to use for any created Spans.
     */
    tracingOptions?: OperationTracingOptions;
    /**
     * Callback which fires upon upload progress.
     */
    onUploadProgress?: (progress: TransferProgressEvent) => void;
    /** Callback which fires upon download progress. */
    onDownloadProgress?: (progress: TransferProgressEvent) => void;
    /** Set to true if the request is sent over HTTP instead of HTTPS */
    allowInsecureConnection?: boolean;
    /**
     * NODEJS ONLY
     *
     * A Node-only option to provide a custom `http.Agent`/`https.Agent`.
     * Does nothing when running in the browser.
     */
    agent?: Agent;
    /**
     * BROWSER ONLY
     *
     * A browser only option to enable browser Streams. If this option is set and a response is a stream
     * the response will have a property `browserStream` instead of `blobBody` which will be undefined.
     *
     * Default value is false
     */
    enableBrowserStreams?: boolean;
    /** Settings for configuring TLS authentication */
    tlsSettings?: TlsSettings;
    /**
     * Additional options to set on the request. This provides a way to override
     * existing ones or provide request properties that are not declared.
     *
     * For possible valid properties, see
     *   - NodeJS https.request options:  https://nodejs.org/api/http.html#httprequestoptions-callback
     *   - Browser RequestInit: https://developer.mozilla.org/en-US/docs/Web/API/RequestInit
     *
     * WARNING: Options specified here will override any properties of same names when request is sent by {@link HttpClient}.
     */
    requestOverrides?: Record<string, unknown>;
}
/**
 * Metadata about a response received by the pipeline.
 */
interface PipelineResponse {
    /**
     * The request that generated this response.
     */
    request: PipelineRequest;
    /**
     * The HTTP status code of the response.
     */
    status: number;
    /**
     * The HTTP response headers.
     */
    headers: HttpHeaders;
    /**
     * The response body as text (string format)
     */
    bodyAsText?: string | null;
    /**
     * BROWSER ONLY
     *
     * The response body as a browser Blob.
     * Always undefined in node.js.
     */
    blobBody?: Promise<Blob>;
    /**
     * BROWSER ONLY
     *
     * The response body as a browser ReadableStream.
     * Always undefined in node.js.
     */
    browserStreamBody?: WebReadableStream<Uint8Array>;
    /**
     * NODEJS ONLY
     *
     * The response body as a node.js Readable stream.
     * Always undefined in the browser.
     */
    readableStreamBody?: NodeReadableStream;
}
/**
 * A simple interface for making a pipeline request and receiving a response.
 */
type SendRequest = (request: PipelineRequest) => Promise<PipelineResponse>;
/**
 * The required interface for a client that makes HTTP requests
 * on behalf of a pipeline.
 */
interface HttpClient {
    /**
     * The method that makes the request and returns a response.
     */
    sendRequest: SendRequest;
}
/**
 * Fired in response to upload or download progress.
 */
type TransferProgressEvent = {
    /**
     * The number of bytes loaded so far.
     */
    loadedBytes: number;
};
/**
 * Options to configure a proxy for outgoing requests (Node.js only).
 */
interface ProxySettings {
    /**
     * The proxy's host address.
     * Must include the protocol (e.g., http:// or https://).
     */
    host: string;
    /**
     * The proxy host's port.
     */
    port: number;
    /**
     * The user name to authenticate with the proxy, if required.
     */
    username?: string;
    /**
     * The password to authenticate with the proxy, if required.
     */
    password?: string;
}
/**
 * Each form data entry can be a string, Blob, or a File. If you wish to pass a file with a name but do not have
 * access to the File class, you can use the createFile helper to create one.
 */
type FormDataValue = string | Blob | File;
/**
 * A simple object that provides form data, as if from a browser form.
 */
type FormDataMap = {
    [key: string]: FormDataValue | FormDataValue[];
};
/**
 * Options that control how to retry failed requests.
 */
interface PipelineRetryOptions {
    /**
     * The maximum number of retry attempts. Defaults to 3.
     */
    maxRetries?: number;
    /**
     * The amount of delay in milliseconds between retry attempts. Defaults to 1000
     * (1 second). The delay increases exponentially with each retry up to a maximum
     * specified by maxRetryDelayInMs.
     */
    retryDelayInMs?: number;
    /**
     * The maximum delay in milliseconds allowed before retrying an operation. Defaults
     * to 64000 (64 seconds).
     */
    maxRetryDelayInMs?: number;
}
/**
 * Represents a certificate for TLS authentication.
 */
interface TlsSettings {
    /**
     * Optionally override the trusted CA certificates. Default is to trust
     * the well-known CAs curated by Mozilla. Mozilla's CAs are completely
     * replaced when CAs are explicitly specified using this option.
     */
    ca?: string | NodeBuffer | Array<string | NodeBuffer> | undefined;
    /**
     *  Cert chains in PEM format. One cert chain should be provided per
     *  private key. Each cert chain should consist of the PEM formatted
     *  certificate for a provided private key, followed by the PEM
     *  formatted intermediate certificates (if any), in order, and not
     *  including the root CA (the root CA must be pre-known to the peer,
     *  see ca). When providing multiple cert chains, they do not have to
     *  be in the same order as their private keys in key. If the
     *  intermediate certificates are not provided, the peer will not be
     *  able to validate the certificate, and the handshake will fail.
     */
    cert?: string | NodeBuffer | Array<string | NodeBuffer> | undefined;
    /**
     * Private keys in PEM format. PEM allows the option of private keys
     * being encrypted. Encrypted keys will be decrypted with
     * options.passphrase. Multiple keys using different algorithms can be
     * provided either as an array of unencrypted key strings or buffers,
     * or an array of objects in the form `{pem: <string|buffer>[,passphrase: <string>]}`.
     * The object form can only occur in an array.object.passphrase is optional.
     * Encrypted keys will be decrypted with object.passphrase if provided, or options.passphrase if it is not.
     */
    key?: string | NodeBuffer | Array<NodeBuffer | KeyObject> | undefined;
    /**
     * Shared passphrase used for a single private key and/or a PFX.
     */
    passphrase?: string | undefined;
    /**
     * PFX or PKCS12 encoded private key and certificate chain. pfx is an
     * alternative to providing key and cert individually. PFX is usually
     * encrypted, if it is, passphrase will be used to decrypt it. Multiple
     * PFX can be provided either as an array of unencrypted PFX buffers,
     * or an array of objects in the form `{buf: <string|buffer>[,passphrase: <string>]}`.
     * The object form can only occur in an array.object.passphrase is optional.
     * Encrypted PFX will be decrypted with object.passphrase if provided, or options.passphrase if it is not.
     */
    pfx?: string | NodeBuffer | Array<string | NodeBuffer | PxfObject> | undefined;
}
/**
 * An interface compatible with NodeJS's `tls.KeyObject`.
 * We want to avoid publicly re-exporting the actual interface,
 * since it might vary across runtime versions.
 */
interface KeyObject {
    /**
     * Private keys in PEM format.
     */
    pem: string | NodeBuffer;
    /**
     * Optional passphrase.
     */
    passphrase?: string | undefined;
}
/**
 * An interface compatible with NodeJS's `tls.PxfObject`.
 * We want to avoid publicly re-exporting the actual interface,
 * since it might vary across runtime versions.
 */
interface PxfObject {
    /**
     * PFX or PKCS12 encoded private key and certificate chain.
     */
    buf: string | NodeBuffer;
    /**
     * Optional passphrase.
     */
    passphrase?: string | undefined;
}

/**
 * A pipeline policy manipulates a request as it travels through the pipeline.
 * It is conceptually a middleware that is allowed to modify the request before
 * it is made as well as the response when it is received.
 */
interface PipelinePolicy {
    /**
     * The policy name. Must be a unique string in the pipeline.
     */
    name: string;
    /**
     * The main method to implement that manipulates a request/response.
     * @param request - The request being performed.
     * @param next - The next policy in the pipeline. Must be called to continue the pipeline.
     */
    sendRequest(request: PipelineRequest, next: SendRequest): Promise<PipelineResponse>;
}

/**
 * Options for how redirect responses are handled.
 */
interface RedirectPolicyOptions {
    /**
     * The maximum number of times the redirect URL will be tried before
     * failing.  Defaults to 20.
     */
    maxRetries?: number;
    /**
     * Whether to follow redirects to a different origin (scheme + host + port).
     * When false (the default), cross-origin redirects are not followed and the
     * redirect response is returned directly to the caller.
     * Defaults to false.
     */
    allowCrossOriginRedirects?: boolean;
}

/**
 * Options for adding user agent details to outgoing requests.
 */
interface UserAgentPolicyOptions {
    /**
     * String prefix to add to the user agent for outgoing requests.
     * Defaults to an empty string.
     */
    userAgentPrefix?: string;
}

/**
 * Defines options that are used to configure the HTTP pipeline for
 * an SDK client.
 */
interface PipelineOptions {
    /**
     * Options that control how to retry failed requests.
     */
    retryOptions?: PipelineRetryOptions;
    /**
     * Options to configure a proxy for outgoing requests.
     */
    proxyOptions?: ProxySettings;
    /** Options for configuring Agent instance for outgoing requests */
    agent?: Agent;
    /** Options for configuring TLS authentication */
    tlsOptions?: TlsSettings;
    /**
     * Options for how redirect responses are handled.
     */
    redirectOptions?: RedirectPolicyOptions;
    /**
     * Options for adding user agent details to outgoing requests.
     */
    userAgentOptions?: UserAgentPolicyOptions;
    /**
     * Options for setting common telemetry and tracing info to outgoing requests.
     */
    telemetryOptions?: TelemetryOptions;
}
/**
 * Defines options that are used to configure common telemetry and tracing info
 */
interface TelemetryOptions {
    /**
     * The name of the header to pass the request ID to.
     */
    clientRequestIdHeaderName?: string;
}

/**
 * Used to configure additional policies added to the pipeline at construction.
 */
interface AdditionalPolicyConfig {
    /**
     * A policy to be added.
     */
    policy: PipelinePolicy;
    /**
     * Determines if this policy be applied before or after retry logic.
     * Only use `perRetry` if you need to modify the request again
     * each time the operation is retried due to retryable service
     * issues.
     */
    position: "perCall" | "perRetry";
}

/**
 * The common set of options that high level clients are expected to expose.
 */
interface CommonClientOptions extends PipelineOptions {
    /**
     * The HttpClient that will be used to send HTTP requests.
     */
    httpClient?: HttpClient;
    /**
     * Set to true if the request is sent over HTTP instead of HTTPS
     */
    allowInsecureConnection?: boolean;
    /**
     * Additional policies to include in the HTTP pipeline.
     */
    additionalPolicies?: AdditionalPolicyConfig[];
}
/**
 * Options for keep alive behavior of HTTP connections.
 */
interface KeepAliveOptions {
    /**
     * When true, connections will be kept alive for multiple requests.
     * Defaults to true.
     */
    enable?: boolean;
}
/**
 * Options for how redirect responses are handled.
 */
interface RedirectOptions {
    /**
     * When true, redirect responses are followed. Defaults to true.
     */
    handleRedirects?: boolean;
    /**
     * The maximum number of times the redirect URL will be tried before
     * failing. Defaults to 20.
     */
    maxRetries?: number;
}
/**
 * Extended common client options that include keep alive and redirect options.
 * This type combines the standard CommonClientOptions with additional options
 * for controlling HTTP connection keep-alive and redirect behavior.
 */
type ExtendedCommonClientOptions = CommonClientOptions & {
    /**
     * Options to configure keep alive behavior for HTTP connections.
     */
    keepAliveOptions?: KeepAliveOptions;
    /**
     * Options to configure how redirect responses are handled.
     */
    redirectOptions?: RedirectOptions;
};

/**
 * The optional parameters accepted by the KeyVault's KeyClient
 */
interface SecretClientOptions extends ExtendedCommonClientOptions {
    /**
     * The accepted versions of the KeyVault's service API.
     */
    serviceVersion?: "7.0" | "7.1" | "7.2" | "7.3" | "7.4" | "7.5" | "7.6" | "2025-07-01" | "2026-04-01";
    /**
     * Whether to disable verification that the authentication challenge resource matches the Key Vault domain.
     * Defaults to false.
     */
    disableChallengeResourceVerification?: boolean;
}

interface AzureKeyVaultOptions {
    /**
     * The name of the key vault to use.
     */
    vaultName: string;
    /**
     * Version of the Azure Key Vault service to use. Defaults to 7.3.
     * @default '7.3'
     */
    serviceVersion?: SecretClientOptions["serviceVersion"];
    /**
     * The number of entries to retrieve per request. Impacts getKeys() and clear() performance. Maximum value is 25.
     * @default 25
     */
    pageSize?: number;
}

interface AzureStorageBlobOptions {
    /**
     * The name of the Azure Storage account.
     */
    accountName?: string;
    /**
     * The name of the storage container. All entities will be stored in the same container. Will be created if it doesn't exist.
     * @default "unstorage"
     */
    containerName?: string;
    /**
     * The account key. If provided, the SAS key will be ignored. Only available in Node.js runtime.
     */
    accountKey?: string;
    /**
     * The SAS token. If provided, the account key will be ignored. Include at least read, list and write permissions to be able to list keys.
     */
    sasKey?: string;
    /**
     * The SAS URL. If provided, the account key, SAS key and container name will be ignored.
     */
    sasUrl?: string;
    /**
     * The connection string. If provided, the account key and SAS key will be ignored. Only available in Node.js runtime.
     */
    connectionString?: string;
    /**
     * Storage account endpoint suffix. Need to be changed for Microsoft Azure operated by 21Vianet, Azure Government or Azurite.
     * @default ".blob.core.windows.net"
     */
    endpointSuffix?: string;
}

interface AzureStorageTableOptions {
    /**
     * The name of the Azure Storage account.
     */
    accountName: string;
    /**
     * The name of the table. All entities will be stored in the same table.
     * @default 'unstorage'
     */
    tableName?: string;
    /**
     * The partition key. All entities will be stored in the same partition.
     * @default 'unstorage'
     */
    partitionKey?: string;
    /**
     * The account key. If provided, the SAS key will be ignored. Only available in Node.js runtime.
     */
    accountKey?: string;
    /**
     * The SAS key. If provided, the account key will be ignored.
     */
    sasKey?: string;
    /**
     * The connection string. If provided, the account key and SAS key will be ignored. Only available in Node.js runtime.
     */
    connectionString?: string;
    /**
     * The number of entries to retrive per request. Impacts getKeys() and clear() performance. Maximum value is 1000.
     * @default 1000
     */
    pageSize?: number;
}

interface CapacitorPreferencesOptions {
    base?: string;
}

declare class Event {
  constructor(type: string, init?: EventInit);
  /**
   * The **`type`** read-only property of the Event interface returns a string containing the event's type. It is set when the event is constructed and is the name commonly used to refer to the specific event, such as click, load, or error.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/type)
   */
  get type(): string;
  /**
   * The **`eventPhase`** read-only property of the Event interface indicates which phase of the event flow is currently being evaluated.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/eventPhase)
   */
  get eventPhase(): number;
  /**
   * The read-only **`composed`** property of the Event interface returns a boolean value which indicates whether or not the event will propagate across the shadow DOM boundary into the standard DOM.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/composed)
   */
  get composed(): boolean;
  /**
   * The **`bubbles`** read-only property of the Event interface indicates whether the event bubbles up through the DOM tree or not.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/bubbles)
   */
  get bubbles(): boolean;
  /**
   * The **`cancelable`** read-only property of the Event interface indicates whether the event can be canceled, and therefore prevented as if the event never happened.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/cancelable)
   */
  get cancelable(): boolean;
  /**
   * The **`defaultPrevented`** read-only property of the Event interface returns a boolean value indicating whether or not the call to Event.preventDefault() canceled the event.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/defaultPrevented)
   */
  get defaultPrevented(): boolean;
  /**
   * The Event property **`returnValue`** indicates whether the default action for this event has been prevented or not.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/returnValue)
   */
  get returnValue(): boolean;
  /**
   * The **`currentTarget`** read-only property of the Event interface identifies the element to which the event handler has been attached.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/currentTarget)
   */
  get currentTarget(): EventTarget | undefined;
  /**
   * The read-only **`target`** property of the Event interface is a reference to the object onto which the event was dispatched. It is different from Event.currentTarget when the event handler is called during the bubbling or capturing phase of the event.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/target)
   */
  get target(): EventTarget | undefined;
  /**
   * The deprecated **`Event.srcElement`** is an alias for the Event.target property. Use Event.target instead.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/srcElement)
   */
  get srcElement(): EventTarget | undefined;
  /**
   * The **`timeStamp`** read-only property of the Event interface returns the time (in milliseconds) at which the event was created.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/timeStamp)
   */
  get timeStamp(): number;
  /**
   * The **`isTrusted`** read-only property of the Event interface is a boolean value that is true when the event was generated by the user agent (including via user actions and programmatic methods such as HTMLElement.focus()), and false when the event was dispatched via EventTarget.dispatchEvent(). The only exception is the click event, which initializes the isTrusted property to false in user agents.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/isTrusted)
   */
  get isTrusted(): boolean;
  /**
   * The **`cancelBubble`** property of the Event interface is deprecated. Use Event.stopPropagation() instead. Setting its value to true before returning from an event handler prevents propagation of the event. In later implementations, setting this to false does nothing. See Browser compatibility for details.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/cancelBubble)
   */
  get cancelBubble(): boolean;
  /**
   * The **`cancelBubble`** property of the Event interface is deprecated. Use Event.stopPropagation() instead. Setting its value to true before returning from an event handler prevents propagation of the event. In later implementations, setting this to false does nothing. See Browser compatibility for details.
   * @deprecated
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/cancelBubble)
   */
  set cancelBubble(value: boolean);
  /**
   * The **`stopImmediatePropagation()`** method of the Event interface prevents other listeners of the same event from being called.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/stopImmediatePropagation)
   */
  stopImmediatePropagation(): void;
  /**
   * The **`preventDefault()`** method of the Event interface tells the user agent that the event is being explicitly handled, so its default action, such as page scrolling, link navigation, or pasting text, should not be taken.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/preventDefault)
   */
  preventDefault(): void;
  /**
   * The **`stopPropagation()`** method of the Event interface prevents further propagation of the current event in the capturing and bubbling phases. It does not, however, prevent any default behaviors from occurring; for instance, clicks on links are still processed. If you want to stop those behaviors, see the preventDefault() method. It also does not prevent propagation to other event-handlers of the current element. If you want to stop those, see stopImmediatePropagation().
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/stopPropagation)
   */
  stopPropagation(): void;
  /**
   * The **`composedPath()`** method of the Event interface returns the event's path which is an array of the objects on which listeners will be invoked. This does not include nodes in shadow trees if the shadow root was created with its ShadowRoot.mode closed.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Event/composedPath)
   */
  composedPath(): EventTarget[];
  static readonly NONE: number;
  static readonly CAPTURING_PHASE: number;
  static readonly AT_TARGET: number;
  static readonly BUBBLING_PHASE: number;
}
interface EventInit {
  bubbles?: boolean;
  cancelable?: boolean;
  composed?: boolean;
}
type EventListener<EventType extends Event = Event> = (
  event: EventType,
) => void;
interface EventListenerObject<EventType extends Event = Event> {
  handleEvent(event: EventType): void;
}
type EventListenerOrEventListenerObject<EventType extends Event = Event> =
  EventListener<EventType> | EventListenerObject<EventType>;
declare class EventTarget<
  EventMap extends Record<string, Event> = Record<string, Event>,
> {
  constructor();
  /**
   * The **`addEventListener()`** method of the EventTarget interface sets up a function that will be called whenever the specified event is delivered to the target.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventTarget/addEventListener)
   */
  addEventListener<Type extends keyof EventMap>(
    type: Type,
    handler: EventListenerOrEventListenerObject<EventMap[Type]>,
    options?: EventTargetAddEventListenerOptions | boolean,
  ): void;
  /**
   * The **`removeEventListener()`** method of the EventTarget interface removes an event listener previously registered with EventTarget.addEventListener() from the target. The event listener to be removed is identified using a combination of the event type, the event listener function itself, and various optional options that may affect the matching process; see Matching event listeners for removal.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventTarget/removeEventListener)
   */
  removeEventListener<Type extends keyof EventMap>(
    type: Type,
    handler: EventListenerOrEventListenerObject<EventMap[Type]>,
    options?: EventTargetEventListenerOptions | boolean,
  ): void;
  /**
   * The **`dispatchEvent()`** method of the EventTarget sends an Event to the object, (synchronously) invoking the affected event listeners in the appropriate order. The normal event processing rules (including the capturing and optional bubbling phase) also apply to events dispatched manually with dispatchEvent().
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/EventTarget/dispatchEvent)
   */
  dispatchEvent(event: EventMap[keyof EventMap]): boolean;
}
interface EventTargetEventListenerOptions {
  capture?: boolean;
}
interface EventTargetAddEventListenerOptions {
  capture?: boolean;
  passive?: boolean;
  once?: boolean;
  signal?: AbortSignal$1;
}
declare abstract class AbortSignal$1 extends EventTarget {
  /**
   * The **`AbortSignal.abort()`** static method returns an AbortSignal that is already set as aborted (and which does not trigger an abort event).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AbortSignal/abort_static)
   */
  static abort(reason?: any): AbortSignal$1;
  /**
   * The **`AbortSignal.timeout()`** static method returns an AbortSignal that will automatically abort after a specified time.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AbortSignal/timeout_static)
   */
  static timeout(delay: number): AbortSignal$1;
  /**
   * The **`AbortSignal.any()`** static method takes an iterable of abort signals and returns an AbortSignal. The returned abort signal is aborted when any of the input iterable abort signals are aborted. The abort reason will be set to the reason of the first signal that is aborted. If any of the given abort signals are already aborted then so will be the returned AbortSignal.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AbortSignal/any_static)
   */
  static any(signals: AbortSignal$1[]): AbortSignal$1;
  /**
   * The **`aborted`** read-only property returns a value that indicates whether the asynchronous operations the signal is communicating with are aborted (true) or not (false).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AbortSignal/aborted)
   */
  get aborted(): boolean;
  /**
   * The **`reason`** read-only property returns a JavaScript value that indicates the abort reason.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AbortSignal/reason)
   */
  get reason(): any;
  /* [MDN Reference](https://developer.mozilla.org/docs/Web/API/AbortSignal/abort_event) */
  get onabort(): any | null;
  /* [MDN Reference](https://developer.mozilla.org/docs/Web/API/AbortSignal/abort_event) */
  set onabort(value: any | null);
  /**
   * The **`throwIfAborted()`** method throws the signal's abort reason if the signal has been aborted; otherwise it does nothing.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/AbortSignal/throwIfAborted)
   */
  throwIfAborted(): void;
}
declare class Blob$1 {
  constructor(
    bits?: ((ArrayBuffer | ArrayBufferView) | string | Blob$1)[],
    options?: BlobOptions,
  );
  /**
   * The **`size`** read-only property of the Blob interface returns the size of the Blob or File in bytes.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/size)
   */
  get size(): number;
  /**
   * The **`type`** read-only property of the Blob interface returns the MIME type of the file.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/type)
   */
  get type(): string;
  /**
   * The **`slice()`** method of the Blob interface creates and returns a new Blob object which contains data from a subset of the blob on which it's called.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/slice)
   */
  slice(start?: number, end?: number, type?: string): Blob$1;
  /**
   * The **`arrayBuffer()`** method of the Blob interface returns a Promise that resolves with the contents of the blob as binary data contained in an ArrayBuffer.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/arrayBuffer)
   */
  arrayBuffer(): Promise<ArrayBuffer>;
  /**
   * The **`bytes()`** method of the Blob interface returns a Promise that resolves with a Uint8Array containing the contents of the blob as an array of bytes.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/bytes)
   */
  bytes(): Promise<Uint8Array>;
  /**
   * The **`text()`** method of the Blob interface returns a Promise that resolves with a string containing the contents of the blob, interpreted as UTF-8.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/text)
   */
  text(): Promise<string>;
  /**
   * The **`stream()`** method of the Blob interface returns a ReadableStream which upon reading returns the data contained within the Blob.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Blob/stream)
   */
  stream(): ReadableStream$1;
}
interface BlobOptions {
  type?: string;
}
type HeadersInit =
  Headers$1 | Iterable<Iterable<string>> | Record<string, string>;
declare class Headers$1 {
  constructor(init?: HeadersInit);
  /**
   * The **`get()`** method of the Headers interface returns a byte string of all the values of a header within a Headers object with a given name. If the requested header doesn't exist in the Headers object, it returns null.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Headers/get)
   */
  get(name: string): string | null;
  getAll(name: string): string[];
  /**
   * The **`getSetCookie()`** method of the Headers interface returns an array containing the values of all Set-Cookie headers associated with a response. This allows Headers objects to handle having multiple Set-Cookie headers, which wasn't possible prior to its implementation.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Headers/getSetCookie)
   */
  getSetCookie(): string[];
  /**
   * The **`has()`** method of the Headers interface returns a boolean stating whether a Headers object contains a certain header.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Headers/has)
   */
  has(name: string): boolean;
  /**
   * The **`set()`** method of the Headers interface sets a new value for an existing header inside a Headers object, or adds the header if it does not already exist.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Headers/set)
   */
  set(name: string, value: string): void;
  /**
   * The **`append()`** method of the Headers interface appends a new value onto an existing header inside a Headers object, or adds the header if it does not already exist.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Headers/append)
   */
  append(name: string, value: string): void;
  /**
   * The **`delete()`** method of the Headers interface deletes a header from the current Headers object.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/Headers/delete)
   */
  delete(name: string): void;
  forEach<This = unknown>(
    callback: (this: This, value: string, key: string, parent: Headers$1) => void,
    thisArg?: This,
  ): void;
  entries(): IterableIterator<[key: string, value: string]>;
  keys(): IterableIterator<string>;
  values(): IterableIterator<string>;
  [Symbol.iterator](): IterableIterator<[key: string, value: string]>;
}
interface KVNamespaceListKey<Metadata, Key extends string = string> {
  name: Key;
  expiration?: number;
  metadata?: Metadata;
}
type KVNamespaceListResult<Metadata, Key extends string = string> =
  | {
      list_complete: false;
      keys: KVNamespaceListKey<Metadata, Key>[];
      cursor: string;
      cacheStatus: string | null;
    }
  | {
      list_complete: true;
      keys: KVNamespaceListKey<Metadata, Key>[];
      cacheStatus: string | null;
    };
interface KVNamespace<Key extends string = string> {
  get(
    key: Key,
    options?: Partial<KVNamespaceGetOptions<undefined>>,
  ): Promise<string | null>;
  get(key: Key, type: "text"): Promise<string | null>;
  get<ExpectedValue = unknown>(
    key: Key,
    type: "json",
  ): Promise<ExpectedValue | null>;
  get(key: Key, type: "arrayBuffer"): Promise<ArrayBuffer | null>;
  get(key: Key, type: "stream"): Promise<ReadableStream$1 | null>;
  get(
    key: Key,
    options?: KVNamespaceGetOptions<"text">,
  ): Promise<string | null>;
  get<ExpectedValue = unknown>(
    key: Key,
    options?: KVNamespaceGetOptions<"json">,
  ): Promise<ExpectedValue | null>;
  get(
    key: Key,
    options?: KVNamespaceGetOptions<"arrayBuffer">,
  ): Promise<ArrayBuffer | null>;
  get(
    key: Key,
    options?: KVNamespaceGetOptions<"stream">,
  ): Promise<ReadableStream$1 | null>;
  get(key: Array<Key>, type: "text"): Promise<Map<string, string | null>>;
  get<ExpectedValue = unknown>(
    key: Array<Key>,
    type: "json",
  ): Promise<Map<string, ExpectedValue | null>>;
  get(
    key: Array<Key>,
    options?: Partial<KVNamespaceGetOptions<undefined>>,
  ): Promise<Map<string, string | null>>;
  get(
    key: Array<Key>,
    options?: KVNamespaceGetOptions<"text">,
  ): Promise<Map<string, string | null>>;
  get<ExpectedValue = unknown>(
    key: Array<Key>,
    options?: KVNamespaceGetOptions<"json">,
  ): Promise<Map<string, ExpectedValue | null>>;
  list<Metadata = unknown>(
    options?: KVNamespaceListOptions,
  ): Promise<KVNamespaceListResult<Metadata, Key>>;
  put(
    key: Key,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream$1,
    options?: KVNamespacePutOptions,
  ): Promise<void>;
  getWithMetadata<Metadata = unknown>(
    key: Key,
    options?: Partial<KVNamespaceGetOptions<undefined>>,
  ): Promise<KVNamespaceGetWithMetadataResult<string, Metadata>>;
  getWithMetadata<Metadata = unknown>(
    key: Key,
    type: "text",
  ): Promise<KVNamespaceGetWithMetadataResult<string, Metadata>>;
  getWithMetadata<ExpectedValue = unknown, Metadata = unknown>(
    key: Key,
    type: "json",
  ): Promise<KVNamespaceGetWithMetadataResult<ExpectedValue, Metadata>>;
  getWithMetadata<Metadata = unknown>(
    key: Key,
    type: "arrayBuffer",
  ): Promise<KVNamespaceGetWithMetadataResult<ArrayBuffer, Metadata>>;
  getWithMetadata<Metadata = unknown>(
    key: Key,
    type: "stream",
  ): Promise<KVNamespaceGetWithMetadataResult<ReadableStream$1, Metadata>>;
  getWithMetadata<Metadata = unknown>(
    key: Key,
    options: KVNamespaceGetOptions<"text">,
  ): Promise<KVNamespaceGetWithMetadataResult<string, Metadata>>;
  getWithMetadata<ExpectedValue = unknown, Metadata = unknown>(
    key: Key,
    options: KVNamespaceGetOptions<"json">,
  ): Promise<KVNamespaceGetWithMetadataResult<ExpectedValue, Metadata>>;
  getWithMetadata<Metadata = unknown>(
    key: Key,
    options: KVNamespaceGetOptions<"arrayBuffer">,
  ): Promise<KVNamespaceGetWithMetadataResult<ArrayBuffer, Metadata>>;
  getWithMetadata<Metadata = unknown>(
    key: Key,
    options: KVNamespaceGetOptions<"stream">,
  ): Promise<KVNamespaceGetWithMetadataResult<ReadableStream$1, Metadata>>;
  getWithMetadata<Metadata = unknown>(
    key: Array<Key>,
    type: "text",
  ): Promise<Map<string, KVNamespaceGetWithMetadataResult<string, Metadata>>>;
  getWithMetadata<ExpectedValue = unknown, Metadata = unknown>(
    key: Array<Key>,
    type: "json",
  ): Promise<
    Map<string, KVNamespaceGetWithMetadataResult<ExpectedValue, Metadata>>
  >;
  getWithMetadata<Metadata = unknown>(
    key: Array<Key>,
    options?: Partial<KVNamespaceGetOptions<undefined>>,
  ): Promise<Map<string, KVNamespaceGetWithMetadataResult<string, Metadata>>>;
  getWithMetadata<Metadata = unknown>(
    key: Array<Key>,
    options?: KVNamespaceGetOptions<"text">,
  ): Promise<Map<string, KVNamespaceGetWithMetadataResult<string, Metadata>>>;
  getWithMetadata<ExpectedValue = unknown, Metadata = unknown>(
    key: Array<Key>,
    options?: KVNamespaceGetOptions<"json">,
  ): Promise<
    Map<string, KVNamespaceGetWithMetadataResult<ExpectedValue, Metadata>>
  >;
  delete(key: Key): Promise<void>;
}
interface KVNamespaceListOptions {
  limit?: number;
  prefix?: string | null;
  cursor?: string | null;
}
interface KVNamespaceGetOptions<Type> {
  type: Type;
  cacheTtl?: number;
}
interface KVNamespacePutOptions {
  expiration?: number;
  expirationTtl?: number;
  metadata?: any | null;
}
interface KVNamespaceGetWithMetadataResult<Value, Metadata> {
  value: Value | null;
  metadata: Metadata | null;
  cacheStatus: string | null;
}
interface R2ListOptions {
  limit?: number;
  prefix?: string;
  cursor?: string;
  delimiter?: string;
  startAfter?: string;
  include?: ("httpMetadata" | "customMetadata")[];
}
interface R2Bucket {
  head(key: string): Promise<R2Object | null>;
  get(
    key: string,
    options: R2GetOptions & {
      onlyIf: R2Conditional | Headers$1;
    },
  ): Promise<R2ObjectBody | R2Object | null>;
  get(key: string, options?: R2GetOptions): Promise<R2ObjectBody | null>;
  put(
    key: string,
    value:
      ReadableStream$1 | ArrayBuffer | ArrayBufferView | string | null | Blob$1,
    options?: R2PutOptions & {
      onlyIf: R2Conditional | Headers$1;
    },
  ): Promise<R2Object | null>;
  put(
    key: string,
    value:
      ReadableStream$1 | ArrayBuffer | ArrayBufferView | string | null | Blob$1,
    options?: R2PutOptions,
  ): Promise<R2Object>;
  createMultipartUpload(
    key: string,
    options?: R2MultipartOptions,
  ): Promise<R2MultipartUpload>;
  resumeMultipartUpload(key: string, uploadId: string): R2MultipartUpload;
  delete(keys: string | string[]): Promise<void>;
  list(options?: R2ListOptions): Promise<R2Objects>;
}
interface R2MultipartUpload {
  readonly key: string;
  readonly uploadId: string;
  uploadPart(
    partNumber: number,
    value: ReadableStream$1 | (ArrayBuffer | ArrayBufferView) | string | Blob$1,
    options?: R2UploadPartOptions,
  ): Promise<R2UploadedPart>;
  abort(): Promise<void>;
  complete(uploadedParts: R2UploadedPart[]): Promise<R2Object>;
}
interface R2UploadedPart {
  partNumber: number;
  etag: string;
}
declare abstract class R2Object {
  readonly key: string;
  readonly version: string;
  readonly size: number;
  readonly etag: string;
  readonly httpEtag: string;
  readonly checksums: R2Checksums;
  readonly uploaded: Date;
  readonly httpMetadata?: R2HTTPMetadata;
  readonly customMetadata?: Record<string, string>;
  readonly range?: R2Range;
  readonly storageClass: string;
  readonly ssecKeyMd5?: string;
  writeHttpMetadata(headers: Headers$1): void;
}
interface R2ObjectBody extends R2Object {
  get body(): ReadableStream$1;
  get bodyUsed(): boolean;
  arrayBuffer(): Promise<ArrayBuffer>;
  bytes(): Promise<Uint8Array>;
  text(): Promise<string>;
  json<T>(): Promise<T>;
  blob(): Promise<Blob$1>;
}
type R2Range =
  | {
      offset: number;
      length?: number;
    }
  | {
      offset?: number;
      length: number;
    }
  | {
      suffix: number;
    };
interface R2Conditional {
  etagMatches?: string;
  etagDoesNotMatch?: string;
  uploadedBefore?: Date;
  uploadedAfter?: Date;
  secondsGranularity?: boolean;
}
interface R2GetOptions {
  onlyIf?: R2Conditional | Headers$1;
  range?: R2Range | Headers$1;
  ssecKey?: ArrayBuffer | string;
}
interface R2PutOptions {
  onlyIf?: R2Conditional | Headers$1;
  httpMetadata?: R2HTTPMetadata | Headers$1;
  customMetadata?: Record<string, string>;
  md5?: (ArrayBuffer | ArrayBufferView) | string;
  sha1?: (ArrayBuffer | ArrayBufferView) | string;
  sha256?: (ArrayBuffer | ArrayBufferView) | string;
  sha384?: (ArrayBuffer | ArrayBufferView) | string;
  sha512?: (ArrayBuffer | ArrayBufferView) | string;
  storageClass?: string;
  ssecKey?: ArrayBuffer | string;
}
interface R2MultipartOptions {
  httpMetadata?: R2HTTPMetadata | Headers$1;
  customMetadata?: Record<string, string>;
  storageClass?: string;
  ssecKey?: ArrayBuffer | string;
}
interface R2Checksums {
  readonly md5?: ArrayBuffer;
  readonly sha1?: ArrayBuffer;
  readonly sha256?: ArrayBuffer;
  readonly sha384?: ArrayBuffer;
  readonly sha512?: ArrayBuffer;
  toJSON(): R2StringChecksums;
}
interface R2StringChecksums {
  md5?: string;
  sha1?: string;
  sha256?: string;
  sha384?: string;
  sha512?: string;
}
interface R2HTTPMetadata {
  contentType?: string;
  contentLanguage?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  cacheControl?: string;
  cacheExpiry?: Date;
}
type R2Objects = {
  objects: R2Object[];
  delimitedPrefixes: string[];
} & (
  | {
      truncated: true;
      cursor: string;
    }
  | {
      truncated: false;
    }
);
interface R2UploadPartOptions {
  ssecKey?: ArrayBuffer | string;
}
interface QueuingStrategy<T = any> {
  highWaterMark?: number | bigint;
  size?: (chunk: T) => number | bigint;
}
interface UnderlyingSink<W = any> {
  type?: string;
  start?: (controller: WritableStreamDefaultController) => void | Promise<void>;
  write?: (
    chunk: W,
    controller: WritableStreamDefaultController,
  ) => void | Promise<void>;
  abort?: (reason: any) => void | Promise<void>;
  close?: () => void | Promise<void>;
}
interface UnderlyingByteSource {
  type: "bytes";
  autoAllocateChunkSize?: number;
  start?: (controller: ReadableByteStreamController) => void | Promise<void>;
  pull?: (controller: ReadableByteStreamController) => void | Promise<void>;
  cancel?: (reason: any) => void | Promise<void>;
}
interface UnderlyingSource<R = any> {
  type?: "" | undefined;
  start?: (
    controller: ReadableStreamDefaultController<R>,
  ) => void | Promise<void>;
  pull?: (
    controller: ReadableStreamDefaultController<R>,
  ) => void | Promise<void>;
  cancel?: (reason: any) => void | Promise<void>;
  expectedLength?: number | bigint;
}
interface StreamPipeOptions {
  preventAbort?: boolean;
  preventCancel?: boolean;
  /**
   * Pipes this readable stream to a given writable stream destination. The way in which the piping process behaves under various error conditions can be customized with a number of passed options. It returns a promise that fulfills when the piping process completes successfully, or rejects if any errors were encountered.
   *
   * Piping a stream will lock it for the duration of the pipe, preventing any other consumer from acquiring a reader.
   *
   * Errors and closures of the source and destination streams propagate as follows:
   *
   * An error in this source readable stream will abort destination, unless preventAbort is truthy. The returned promise will be rejected with the source's error, or with any error that occurs during aborting the destination.
   *
   * An error in destination will cancel this source readable stream, unless preventCancel is truthy. The returned promise will be rejected with the destination's error, or with any error that occurs during canceling the source.
   *
   * When this source readable stream closes, destination will be closed, unless preventClose is truthy. The returned promise will be fulfilled once this process completes, unless an error is encountered while closing the destination, in which case it will be rejected with that error.
   *
   * If destination starts out closed or closing, this source readable stream will be canceled, unless preventCancel is true. The returned promise will be rejected with an error indicating piping to a closed stream failed, or with any error that occurs during canceling the source.
   *
   * The signal option can be set to an AbortSignal to allow aborting an ongoing pipe operation via the corresponding AbortController. In this case, this source readable stream will be canceled, and destination aborted, unless the respective options preventCancel or preventAbort are set.
   */
  preventClose?: boolean;
  signal?: AbortSignal$1;
}
type ReadableStreamReadResult<R = any> =
  | {
      done: false;
      value: R;
    }
  | {
      done: true;
      value?: undefined;
    };
interface ReadableStream$1<R = any> {
  /**
   * The **`locked`** read-only property of the ReadableStream interface returns whether or not the readable stream is locked to a reader.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStream/locked)
   */
  get locked(): boolean;
  /**
   * The **`cancel()`** method of the ReadableStream interface returns a Promise that resolves when the stream is canceled.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStream/cancel)
   */
  cancel(reason?: any): Promise<void>;
  /**
   * The **`getReader()`** method of the ReadableStream interface creates a reader and locks the stream to it. While the stream is locked, no other reader can be acquired until this one is released.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStream/getReader)
   */
  getReader(): ReadableStreamDefaultReader<R>;
  /**
   * The **`getReader()`** method of the ReadableStream interface creates a reader and locks the stream to it. While the stream is locked, no other reader can be acquired until this one is released.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStream/getReader)
   */
  getReader(options: ReadableStreamGetReaderOptions): ReadableStreamBYOBReader;
  /**
   * The **`pipeThrough()`** method of the ReadableStream interface provides a chainable way of piping the current stream through a transform stream or any other writable/readable pair.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStream/pipeThrough)
   */
  pipeThrough<T>(
    transform: ReadableWritablePair<T, R>,
    options?: StreamPipeOptions,
  ): ReadableStream$1<T>;
  /**
   * The **`pipeTo()`** method of the ReadableStream interface pipes the current ReadableStream to a given WritableStream and returns a Promise that fulfills when the piping process completes successfully, or rejects if any errors were encountered.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStream/pipeTo)
   */
  pipeTo(
    destination: WritableStream<R>,
    options?: StreamPipeOptions,
  ): Promise<void>;
  /**
   * The **`tee()`** method of the ReadableStream interface tees the current readable stream, returning a two-element array containing the two resulting branches as new ReadableStream instances.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStream/tee)
   */
  tee(): [ReadableStream$1<R>, ReadableStream$1<R>];
  values(options?: ReadableStreamValuesOptions): AsyncIterableIterator<R>;
  [Symbol.asyncIterator](
    options?: ReadableStreamValuesOptions,
  ): AsyncIterableIterator<R>;
}
declare const ReadableStream$1: {
  prototype: ReadableStream$1;
  new (
    underlyingSource: UnderlyingByteSource,
    strategy?: QueuingStrategy<Uint8Array>,
  ): ReadableStream$1<Uint8Array>;
  new <R = any>(
    underlyingSource?: UnderlyingSource<R>,
    strategy?: QueuingStrategy<R>,
  ): ReadableStream$1<R>;
};
declare class ReadableStreamDefaultReader<R = any> {
  constructor(stream: ReadableStream$1);
  get closed(): Promise<void>;
  cancel(reason?: any): Promise<void>;
  /**
   * The **`read()`** method of the ReadableStreamDefaultReader interface returns a Promise providing access to the next chunk in the stream's internal queue.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamDefaultReader/read)
   */
  read(): Promise<ReadableStreamReadResult<R>>;
  /**
   * The **`releaseLock()`** method of the ReadableStreamDefaultReader interface releases the reader's lock on the stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamDefaultReader/releaseLock)
   */
  releaseLock(): void;
}
declare class ReadableStreamBYOBReader {
  constructor(stream: ReadableStream$1);
  get closed(): Promise<void>;
  cancel(reason?: any): Promise<void>;
  /**
   * The **`read()`** method of the ReadableStreamBYOBReader interface is used to read data into a view on a user-supplied buffer from an associated readable byte stream. A request for data will be satisfied from the stream's internal queues if there is any data present. If the stream queues are empty, the request may be supplied as a zero-copy transfer from the underlying byte source.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBReader/read)
   */
  read<T extends ArrayBufferView>(
    view: T,
  ): Promise<ReadableStreamReadResult<T>>;
  /**
   * The **`releaseLock()`** method of the ReadableStreamBYOBReader interface releases the reader's lock on the stream. After the lock is released, the reader is no longer active.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBReader/releaseLock)
   */
  releaseLock(): void;
  readAtLeast<T extends ArrayBufferView>(
    minElements: number,
    view: T,
  ): Promise<ReadableStreamReadResult<T>>;
}
interface ReadableStreamGetReaderOptions {
  /**
   * Creates a ReadableStreamBYOBReader and locks the stream to the new reader.
   *
   * This call behaves the same way as the no-argument variant, except that it only works on readable byte streams, i.e. streams which were constructed specifically with the ability to handle "bring your own buffer" reading. The returned BYOB reader provides the ability to directly read individual chunks from the stream via its read() method, into developer-supplied buffers, allowing more precise control over allocation.
   */
  mode: "byob";
}
declare abstract class ReadableStreamBYOBRequest {
  /**
   * The **`view`** getter property of the ReadableStreamBYOBRequest interface returns the current view.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBRequest/view)
   */
  get view(): Uint8Array | null;
  /**
   * The **`respond()`** method of the ReadableStreamBYOBRequest interface is used to signal to the associated readable byte stream that the specified number of bytes were written into the ReadableStreamBYOBRequest.view.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBRequest/respond)
   */
  respond(bytesWritten: number): void;
  /**
   * The **`respondWithNewView()`** method of the ReadableStreamBYOBRequest interface specifies a new view that the consumer of the associated readable byte stream should write to instead of ReadableStreamBYOBRequest.view.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamBYOBRequest/respondWithNewView)
   */
  respondWithNewView(view: ArrayBuffer | ArrayBufferView): void;
  get atLeast(): number | null;
}
declare abstract class ReadableStreamDefaultController<R = any> {
  /**
   * The **`desiredSize`** read-only property of the ReadableStreamDefaultController interface returns the desired size required to fill the stream's internal queue.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamDefaultController/desiredSize)
   */
  get desiredSize(): number | null;
  /**
   * The **`close()`** method of the ReadableStreamDefaultController interface closes the associated stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamDefaultController/close)
   */
  close(): void;
  /**
   * The **`enqueue()`** method of the ReadableStreamDefaultController interface enqueues a given chunk in the associated stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamDefaultController/enqueue)
   */
  enqueue(chunk?: R): void;
  /**
   * The **`error()`** method of the ReadableStreamDefaultController interface causes any future interactions with the associated stream to error.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableStreamDefaultController/error)
   */
  error(reason: any): void;
}
declare abstract class ReadableByteStreamController {
  /**
   * The **`byobRequest`** read-only property of the ReadableByteStreamController interface returns the current BYOB request, or null if there are no pending requests.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableByteStreamController/byobRequest)
   */
  get byobRequest(): ReadableStreamBYOBRequest | null;
  /**
   * The **`desiredSize`** read-only property of the ReadableByteStreamController interface returns the number of bytes required to fill the stream's internal queue to its "desired size".
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableByteStreamController/desiredSize)
   */
  get desiredSize(): number | null;
  /**
   * The **`close()`** method of the ReadableByteStreamController interface closes the associated stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableByteStreamController/close)
   */
  close(): void;
  /**
   * The **`enqueue()`** method of the ReadableByteStreamController interface enqueues a given chunk on the associated readable byte stream (the chunk is transferred into the stream's internal queues).
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableByteStreamController/enqueue)
   */
  enqueue(chunk: ArrayBuffer | ArrayBufferView): void;
  /**
   * The **`error()`** method of the ReadableByteStreamController interface causes any future interactions with the associated stream to error with the specified reason.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/ReadableByteStreamController/error)
   */
  error(reason: any): void;
}
declare abstract class WritableStreamDefaultController {
  /**
   * The read-only **`signal`** property of the WritableStreamDefaultController interface returns the AbortSignal associated with the controller.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStreamDefaultController/signal)
   */
  get signal(): AbortSignal$1;
  /**
   * The **`error()`** method of the WritableStreamDefaultController interface causes any future interactions with the associated stream to error.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStreamDefaultController/error)
   */
  error(reason?: any): void;
}
interface ReadableWritablePair<R = any, W = any> {
  readable: ReadableStream$1<R>;
  /**
   * Provides a convenient, chainable way of piping this readable stream through a transform stream (or any other { writable, readable } pair). It simply pipes the stream into the writable side of the supplied pair, and returns the readable side for further use.
   *
   * Piping a stream will lock it for the duration of the pipe, preventing any other consumer from acquiring a reader.
   */
  writable: WritableStream<W>;
}
declare class WritableStream<W = any> {
  constructor(
    underlyingSink?: UnderlyingSink,
    queuingStrategy?: QueuingStrategy,
  );
  /**
   * The **`locked`** read-only property of the WritableStream interface returns a boolean indicating whether the WritableStream is locked to a writer.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStream/locked)
   */
  get locked(): boolean;
  /**
   * The **`abort()`** method of the WritableStream interface aborts the stream, signaling that the producer can no longer successfully write to the stream and it is to be immediately moved to an error state, with any queued writes discarded.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStream/abort)
   */
  abort(reason?: any): Promise<void>;
  /**
   * The **`close()`** method of the WritableStream interface closes the associated stream. All chunks written before this method is called are sent before the returned promise is fulfilled.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStream/close)
   */
  close(): Promise<void>;
  /**
   * The **`getWriter()`** method of the WritableStream interface returns a new instance of WritableStreamDefaultWriter and locks the stream to that instance. While the stream is locked, no other writer can be acquired until this one is released.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStream/getWriter)
   */
  getWriter(): WritableStreamDefaultWriter<W>;
}
declare class WritableStreamDefaultWriter<W = any> {
  constructor(stream: WritableStream);
  /**
   * The **`closed`** read-only property of the WritableStreamDefaultWriter interface returns a Promise that fulfills if the stream becomes closed, or rejects if the stream errors or the writer's lock is released.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStreamDefaultWriter/closed)
   */
  get closed(): Promise<void>;
  /**
   * The **`ready`** read-only property of the WritableStreamDefaultWriter interface returns a Promise that resolves when the desired size of the stream's internal queue transitions from non-positive to positive, signaling that it is no longer applying backpressure.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStreamDefaultWriter/ready)
   */
  get ready(): Promise<void>;
  /**
   * The **`desiredSize`** read-only property of the WritableStreamDefaultWriter interface returns the desired size required to fill the stream's internal queue.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStreamDefaultWriter/desiredSize)
   */
  get desiredSize(): number | null;
  /**
   * The **`abort()`** method of the WritableStreamDefaultWriter interface aborts the stream, signaling that the producer can no longer successfully write to the stream and it is to be immediately moved to an error state, with any queued writes discarded.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStreamDefaultWriter/abort)
   */
  abort(reason?: any): Promise<void>;
  /**
   * The **`close()`** method of the WritableStreamDefaultWriter interface closes the associated writable stream.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStreamDefaultWriter/close)
   */
  close(): Promise<void>;
  /**
   * The **`write()`** method of the WritableStreamDefaultWriter interface writes a passed chunk of data to a WritableStream and its underlying sink, then returns a Promise that resolves to indicate the success or failure of the write operation.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStreamDefaultWriter/write)
   */
  write(chunk?: W): Promise<void>;
  /**
   * The **`releaseLock()`** method of the WritableStreamDefaultWriter interface releases the writer's lock on the corresponding stream. After the lock is released, the writer is no longer active. If the associated stream is errored when the lock is released, the writer will appear errored in the same way from now on; otherwise, the writer will appear closed.
   *
   * [MDN Reference](https://developer.mozilla.org/docs/Web/API/WritableStreamDefaultWriter/releaseLock)
   */
  releaseLock(): void;
}
interface ReadableStreamValuesOptions {
  preventCancel?: boolean;
}

interface KVOptions {
    binding?: string | KVNamespace;
    /** Adds prefix to all stored keys */
    base?: string;
    /**
     * The minimum time-to-live (ttl) for setItem in seconds.
     * The default is 60 seconds as per Cloudflare's [documentation](https://developers.cloudflare.com/kv/api/write-key-value-pairs/).
     */
    minTTL?: number;
}

interface KVAuthAPIToken {
    /**
     * API Token generated from the [User Profile 'API Tokens' page](https://dash.cloudflare.com/profile/api-tokens)
     * of the Cloudflare console.
     * @see https://api.cloudflare.com/#getting-started-requests
     */
    apiToken: string;
}
interface KVAuthServiceKey {
    /**
     * A special Cloudflare API key good for a restricted set of endpoints.
     * Always begins with "v1.0-", may vary in length.
     * May be used to authenticate in place of `apiToken` or `apiKey` and `email`.
     * @see https://api.cloudflare.com/#getting-started-requests
     */
    userServiceKey: string;
}
interface KVAuthEmailKey {
    /**
     * Email address associated with your account.
     * Should be used along with `apiKey` to authenticate in place of `apiToken`.
     */
    email: string;
    /**
     * API key generated on the "My Account" page of the Cloudflare console.
     * Should be used along with `email` to authenticate in place of `apiToken`.
     * @see https://api.cloudflare.com/#getting-started-requests
     */
    apiKey: string;
}
type KVHTTPOptions = {
    /**
     * Cloudflare account ID (required)
     */
    accountId: string;
    /**
     * The ID of the KV namespace to target (required)
     */
    namespaceId: string;
    /**
     * The URL of the Cloudflare API.
     * @default https://api.cloudflare.com
     */
    apiURL?: string;
    /**
     * Adds prefix to all stored keys
     */
    base?: string;
    /**
     * The minimum time-to-live (ttl) for setItem in seconds.
     * The default is 60 seconds as per Cloudflare's [documentation](https://developers.cloudflare.com/kv/api/write-key-value-pairs/).
     */
    minTTL?: number;
} & (KVAuthServiceKey | KVAuthAPIToken | KVAuthEmailKey);

interface CloudflareR2Options {
    binding?: string | R2Bucket;
    base?: string;
}

type ConnectorName = "better-sqlite3" | "bun-sqlite" | "bun" | "cloudflare-d1" | "cloudflare-hyperdrive-mysql" | "cloudflare-hyperdrive-postgresql" | "libsql-core" | "libsql-http" | "libsql-node" | "libsql" | "libsql-web" | "mysql2" | "neon" | "node-sqlite" | "sqlite" | "pglite" | "planetscale" | "postgresql" | "sqlite3";
/**
 * Represents primitive types that can be used in SQL operations.
 */
type Primitive = string | number | boolean | undefined | null;
type SQLDialect = "mysql" | "postgresql" | "sqlite" | "libsql";
interface DatabaseCapabilities {
  readonly json: boolean;
  readonly booleans: boolean;
  readonly arrays: boolean;
  readonly dates: boolean;
  readonly uuids: boolean;
  readonly transactions: boolean;
}
type Statement = {
  /**
   * Binds parameters to the statement.
   * @param {...Primitive[]} params - Parameters to bind to the SQL statement.
   * @returns {PreparedStatement} The instance of the statement with bound parameters.
   */
  bind(...params: Primitive[]): PreparedStatement;
  /**
   * Executes the statement and returns all resulting rows as an array.
   * @param {...Primitive[]} params - Parameters to bind to the SQL statement.
   * @returns {Promise<unknown[]>} A promise that resolves to an array of rows.
   */
  all(...params: Primitive[]): Promise<unknown[]>;
  /**
   * Executes the statement as an action (e.g. insert, update, delete).
   * @param {...Primitive[]} params - Parameters to bind to the SQL statement.
   * @returns {Promise<{ success: boolean }>} A promise that resolves to the success state of the action.
   */
  run(...params: Primitive[]): Promise<{
    success: boolean;
  }>;
  /**
   * Executes the statement and returns a single row.
   * @param {...Primitive[]} params - Parameters to bind to the SQL statement.
   * @returns {Promise<unknown>} A promise that resolves to the first row in the result set.
   */
  get(...params: Primitive[]): Promise<unknown>;
};
type PreparedStatement = {
  /**
   * Binds parameters to the statement.
   * @param {...Primitive[]} params - Parameters to bind to the SQL statement.
   * @returns {PreparedStatement} The instance of the statement with bound parameters.
   */
  bind(...params: Primitive[]): PreparedStatement;
  /**
   * Executes the statement and returns all resulting rows as an array.
   * @returns {Promise<unknown[]>} A promise that resolves to an array of rows.
   */
  all(): Promise<unknown[]>;
  /**
   * Executes the statement as an action (e.g. insert, update, delete).
   * @returns {Promise<{ success: boolean }>} A promise that resolves to the success state of the action.
   */
  run(): Promise<{
    success: boolean;
  }>;
  /**
   * Executes the statement and returns a single row.
   * @returns {Promise<unknown>} A promise that resolves to the first row in the result set.
   */
  get(): Promise<unknown>;
};
/**
 * Represents the result of a database execution.
 */
type ExecResult = unknown;
/**
 * Defines a database connector for executing SQL queries and preparing statements.
 */
type Connector<TInstance = unknown> = {
  /**
   * The name of the connector.
   */
  name: string;
  /**
   * The SQL dialect used by the connector.
   */
  dialect: SQLDialect;
  /**
   * Override specific database capabilities for this connector.
   */
  capabilityOverrides?: Partial<DatabaseCapabilities>;
  /**
   * The client instance used internally.
   */
  getInstance: () => TInstance | Promise<TInstance>;
  /**
   * Executes an SQL query directly and returns the result.
   * @param {string} sql - The SQL string to execute.
   * @returns {ExecResult | Promise<ExecResult>} The result of the execution.
   */
  exec: (sql: string) => ExecResult | Promise<ExecResult>;
  /**
   * Prepares an SQL statement for execution.
   * @param {string} sql - The SQL string to prepare.
   * @returns {statement} The prepared SQL statement.
   */
  prepare: (sql: string) => Statement;
  /**
   * Closes the database connection and cleans up resources.
   * @returns {void | Promise<void>} A promise that resolves when the connection is closed.
   */
  dispose?: () => void | Promise<void>;
};
/**
 * Represents default SQL results, including any error messages, row changes and rows returned.
 */
type DefaultSQLResult = {
  lastInsertRowid?: number;
  changes?: number;
  error?: string;
  rows?: {
    id?: string | number;
    [key: string]: unknown;
  }[];
  success?: boolean;
};
interface Database<TConnector extends Connector = Connector> extends AsyncDisposable {
  readonly connector: ConnectorName;
  readonly dialect: SQLDialect;
  /**
   * Database capabilities supported by this connector.
   */
  readonly capabilities: DatabaseCapabilities;
  /**
   * Indicates whether the database instance has been disposed/closed.
   * @returns {boolean} True if the database has been disposed, false otherwise.
   */
  readonly disposed: boolean;
  /**
   * The client instance used internally.
   * @returns {Promise<TInstance>} A promise that resolves with the client instance.
   */
  getInstance: () => Promise<Awaited<ReturnType<TConnector["getInstance"]>>>;
  /**
   * Executes a raw SQL string.
   * @param {string} sql - The SQL string to execute.
   * @returns {Promise<ExecResult>} A promise that resolves with the execution result.
   */
  exec: (sql: string) => Promise<ExecResult>;
  /**
   * Prepares an SQL statement from a raw SQL string.
   * @param {string} sql - The SQL string to prepare.
   * @returns {statement} The prepared SQL statement.
   */
  prepare: (sql: string) => Statement;
  /**
   * Executes SQL queries using tagged template literals.
   * @template T The expected type of query result.
   * @param {TemplateStringsArray} strings - The segments of the SQL string.
   * @param {...Primitive[]} values - The values to interpolate into the SQL string.
   * @returns {Promise<T>} A promise that resolves with the typed result of the query.
   */
  sql: <T = DefaultSQLResult>(strings: TemplateStringsArray, ...values: Primitive[]) => Promise<T>;
  /**
   * Closes the database connection and cleans up resources.
   * @returns {Promise<void>} A promise that resolves when the connection is closed.
   */
  dispose: () => Promise<void>;
  /**
   * AsyncDisposable implementation for using syntax support.
   * @returns {Promise<void>} A promise that resolves when the connection is disposed.
   */
  [Symbol.asyncDispose]: () => Promise<void>;
}

interface DB0DriverOptions {
    database: Database;
    tableName?: string;
}

interface Kv$1 {
    /**
     * Retrieve the value and versionstamp for the given key from the database
     * in the form of a {@linkcode KvEntryMaybe}. If no value exists for
     * the key, the returned entry will have a `null` value and versionstamp.
     *
     * ```ts
     * const db = await openKv();
     * const result = await db.get(["foo"]);
     * result.key; // ["foo"]
     * result.value; // "bar"
     * result.versionstamp; // "00000000000000010000"
     * ```
     *
     * The `consistency` option can be used to specify the consistency level
     * for the read operation. The default consistency level is "strong". Some
     * use cases can benefit from using a weaker consistency level. For more
     * information on consistency levels, see the documentation for
     * {@linkcode KvConsistencyLevel}.
     */
    get<T = unknown>(key: KvKey$1, options?: {
        consistency?: KvConsistencyLevel$1;
    }): Promise<KvEntryMaybe$1<T>>;
    /**
     * Retrieve multiple values and versionstamps from the database in the form
     * of an array of {@linkcode KvEntryMaybe} objects. The returned array
     * will have the same length as the `keys` array, and the entries will be in
     * the same order as the keys. If no value exists for a given key, the
     * returned entry will have a `null` value and versionstamp.
     *
     * ```ts
     * const db = await openKv();
     * const result = await db.getMany([["foo"], ["baz"]]);
     * result[0].key; // ["foo"]
     * result[0].value; // "bar"
     * result[0].versionstamp; // "00000000000000010000"
     * result[1].key; // ["baz"]
     * result[1].value; // null
     * result[1].versionstamp; // null
     * ```
     *
     * The `consistency` option can be used to specify the consistency level
     * for the read operation. The default consistency level is "strong". Some
     * use cases can benefit from using a weaker consistency level. For more
     * information on consistency levels, see the documentation for
     * {@linkcode KvConsistencyLevel}.
     */
    getMany<T extends readonly unknown[]>(keys: readonly [...{
        [K in keyof T]: KvKey$1;
    }], options?: {
        consistency?: KvConsistencyLevel$1;
    }): Promise<{
        [K in keyof T]: KvEntryMaybe$1<T[K]>;
    }>;
    /**
     * Set the value for the given key in the database. If a value already
     * exists for the key, it will be overwritten.
     *
     * ```ts
     * const db = await openKv();
     * await db.set(["foo"], "bar");
     * ```
     *
     * Optionally an `expireIn` option can be specified to set a time-to-live
     * (TTL) for the key. The TTL is specified in milliseconds, and the key will
     * be deleted from the database at earliest after the specified number of
     * milliseconds have elapsed. Once the specified duration has passed, the
     * key may still be visible for some additional time. If the `expireIn`
     * option is not specified, the key will not expire.
     */
    set(key: KvKey$1, value: unknown, options?: {
        expireIn?: number;
    }): Promise<KvCommitResult$1>;
    /**
     * Delete the value for the given key from the database. If no value exists
     * for the key, this operation is a no-op.
     *
     * ```ts
     * const db = await openKv();
     * await db.delete(["foo"]);
     * ```
     */
    delete(key: KvKey$1): Promise<void>;
    /**
     * Retrieve a list of keys in the database. The returned list is an
     * {@linkcode KvListIterator} which can be used to iterate over the
     * entries in the database.
     *
     * Each list operation must specify a selector which is used to specify the
     * range of keys to return. The selector can either be a prefix selector, or
     * a range selector:
     *
     * - A prefix selector selects all keys that start with the given prefix of
     *   key parts. For example, the selector `["users"]` will select all keys
     *   that start with the prefix `["users"]`, such as `["users", "alice"]`
     *   and `["users", "bob"]`. Note that you can not partially match a key
     *   part, so the selector `["users", "a"]` will not match the key
     *   `["users", "alice"]`. A prefix selector may specify a `start` key that
     *   is used to skip over keys that are lexicographically less than the
     *   start key.
     * - A range selector selects all keys that are lexicographically between
     *   the given start and end keys (including the start, and excluding the
     *   end). For example, the selector `["users", "a"], ["users", "n"]` will
     *   select all keys that start with the prefix `["users"]` and have a
     *   second key part that is lexicographically between `a` and `n`, such as
     *   `["users", "alice"]`, `["users", "bob"]`, and `["users", "mike"]`, but
     *   not `["users", "noa"]` or `["users", "zoe"]`.
     *
     * ```ts
     * const db = await openKv();
     * const entries = db.list({ prefix: ["users"] });
     * for await (const entry of entries) {
     *   entry.key; // ["users", "alice"]
     *   entry.value; // { name: "Alice" }
     *   entry.versionstamp; // "00000000000000010000"
     * }
     * ```
     *
     * The `options` argument can be used to specify additional options for the
     * list operation. See the documentation for {@linkcode KvListOptions}
     * for more information.
     */
    list<T = unknown>(selector: KvListSelector$1, options?: KvListOptions$1): KvListIterator$1<T>;
    /**
     * Add a value into the database queue to be delivered to the queue
     * listener via {@linkcode Kv.listenQueue}.
     *
     * ```ts
     * const db = await openKv();
     * await db.enqueue("bar");
     * ```
     *
     * The `delay` option can be used to specify the delay (in milliseconds)
     * of the value delivery. The default delay is 0, which means immediate
     * delivery.
     *
     * ```ts
     * const db = await openKv();
     * await db.enqueue("bar", { delay: 60000 });
     * ```
     *
     * The `keysIfUndelivered` option can be used to specify the keys to
     * be set if the value is not successfully delivered to the queue
     * listener after several attempts. The values are set to the value of
     * the queued message.
     *
     * ```ts
     * const db = await openKv();
     * await db.enqueue("bar", { keysIfUndelivered: [["foo", "bar"]] });
     * ```
     */
    enqueue(value: unknown, options?: {
        delay?: number;
        keysIfUndelivered?: KvKey$1[];
    }): Promise<KvCommitResult$1>;
    /**
     * Listen for queue values to be delivered from the database queue, which
     * were enqueued with {@linkcode .enqueue}. The provided handler
     * callback is invoked on every dequeued value. A failed callback
     * invocation is automatically retried multiple times until it succeeds
     * or until the maximum number of retries is reached.
     *
     * ```ts
     * const db = await openKv();
     * db.listenQueue(async (msg: unknown) => {
     *   await db.set(["foo"], msg);
     * });
     * ```
     */
    listenQueue(handler: (value: unknown) => Promise<void> | void): Promise<void>;
    /**
     * Create a new {@linkcode AtomicOperation} object which can be used to
     * perform an atomic transaction on the database. This does not perform any
     * operations on the database - the atomic transaction must be committed
     * explicitly using the {@linkcode AtomicOperation.commit} method once
     * all checks and mutations have been added to the operation.
     */
    atomic(): AtomicOperation$1;
    /**
     * Watch for changes to the given keys in the database. The returned stream
     * is a {@linkcode ReadableStream} that emits a new value whenever any of
     * the watched keys change their versionstamp. The emitted value is an array
     * of {@linkcode KvEntryMaybe} objects, with the same length and order
     * as the `keys` array. If no value exists for a given key, the returned
     * entry will have a `null` value and versionstamp.
     *
     * The returned stream does not return every single intermediate state of
     * the watched keys, but rather only keeps you up to date with the latest
     * state of the keys. This means that if a key is modified multiple times
     * quickly, you may not receive a notification for every single change, but
     * rather only the latest state of the key.
     *
     * ```ts
     * const db = await openKv();
     *
     * const stream = db.watch([["foo"], ["bar"]]);
     * for await (const entries of stream) {
     *   entries[0].key; // ["foo"]
     *   entries[0].value; // "bar"
     *   entries[0].versionstamp; // "00000000000000010000"
     *   entries[1].key; // ["bar"]
     *   entries[1].value; // null
     *   entries[1].versionstamp; // null
     * }
     * ```
     *
     * The `options` argument can be used to specify additional options for the
     * watch operation. The `raw` option can be used to specify whether a new
     * value should be emitted whenever a mutation occurs on any of the watched
     * keys (even if the value of the key does not change, such as deleting a
     * deleted key), or only when entries have observably changed in some way.
     * When `raw: true` is used, it is possible for the stream to occasionally
     * emit values even if no mutations have occurred on any of the watched
     * keys. The default value for this option is `false`.
     */
    watch<T extends readonly unknown[]>(keys: readonly [...{
        [K in keyof T]: KvKey$1;
    }], options?: {
        raw?: boolean;
    }): ReadableStream<{
        [K in keyof T]: KvEntryMaybe$1<T[K]>;
    }>;
    /**
     * Close the database connection. This will prevent any further operations
     * from being performed on the database, and interrupt any in-flight
     * operations immediately.
     */
    close(): void;
    [Symbol.dispose](): void;
}
/** **UNSTABLE**: New API, yet to be vetted.
 *
 * A key to be persisted in a {@linkcode Kv}. A key is a sequence
 * of {@linkcode KvKeyPart}s.
 *
 * Keys are ordered lexicographically by their parts. The first part is the
 * most significant, and the last part is the least significant. The order of
 * the parts is determined by both the type and the value of the part. The
 * relative significance of the types can be found in documentation for the
 * {@linkcode KvKeyPart} type.
 *
 * Keys have a maximum size of 2048 bytes serialized. If the size of the key
 * exceeds this limit, an error will be thrown on the operation that this key
 * was passed to.
 *
 * @category KV
 */
type KvKey$1 = readonly KvKeyPart$1[];
/** **UNSTABLE**: New API, yet to be vetted.
 *
 * A single part of a {@linkcode KvKey}. Parts are ordered
 * lexicographically, first by their type, and within a given type by their
 * value.
 *
 * The ordering of types is as follows:
 *
 * 1. `Uint8Array`
 * 2. `string`
 * 3. `number`
 * 4. `bigint`
 * 5. `boolean`
 *
 * Within a given type, the ordering is as follows:
 *
 * - `Uint8Array` is ordered by the byte ordering of the array
 * - `string` is ordered by the byte ordering of the UTF-8 encoding of the
 *   string
 * - `number` is ordered following this pattern: `-NaN`
 *   < `-Infinity` < `-100.0` < `-1.0` < -`0.5` < `-0.0` < `0.0` < `0.5`
 *   < `1.0` < `100.0` < `Infinity` < `NaN`
 * - `bigint` is ordered by mathematical ordering, with the largest negative
 *   number being the least first value, and the largest positive number
 *   being the last value
 * - `boolean` is ordered by `false` < `true`
 *
 * This means that the part `1.0` (a number) is ordered before the part `2.0`
 * (also a number), but is greater than the part `0n` (a bigint), because
 * `1.0` is a number and `0n` is a bigint, and type ordering has precedence
 * over the ordering of values within a type.
 *
 * @category KV
 */
type KvKeyPart$1 = Uint8Array | string | number | bigint | boolean;
/** **UNSTABLE**: New API, yet to be vetted.
 *
 * Consistency level of a KV operation.
 *
 * - `strong` - This operation must be strongly-consistent.
 * - `eventual` - Eventually-consistent behavior is allowed.
 *
 * @category KV
 */
type KvConsistencyLevel$1 = "strong" | "eventual";
/**
 * **UNSTABLE**: New API, yet to be vetted.
 *
 * An optional versioned pair of key and value in a {@linkcode Kv}.
 *
 * This is the same as a {@linkcode KvEntry}, but the `value` and `versionstamp`
 * fields may be `null` if no value exists for the given key in the KV store.
 *
 * @category KV
 */
type KvEntryMaybe$1<T> = KvEntry$1<T> | {
    key: KvKey$1;
    value: null;
    versionstamp: null;
};
/** **UNSTABLE**: New API, yet to be vetted.
 *
 * A versioned pair of key and value in a {@linkcode Kv}.
 *
 * The `versionstamp` is a string that represents the current version of the
 * key-value pair. It can be used to perform atomic operations on the KV store
 * by passing it to the `check` method of a {@linkcode AtomicOperation}.
 *
 * @category KV
 */
type KvEntry$1<T> = {
    key: KvKey$1;
    value: T;
    versionstamp: string;
};
/** @category KV */
interface KvCommitResult$1 {
    ok: true;
    /** The versionstamp of the value committed to KV. */
    versionstamp: string;
}
/** **UNSTABLE**: New API, yet to be vetted.
 *
 * A selector that selects the range of data returned by a list operation on a
 * {@linkcode Kv}.
 *
 * The selector can either be a prefix selector or a range selector. A prefix
 * selector selects all keys that start with the given prefix (optionally
 * starting at a given key). A range selector selects all keys that are
 * lexicographically between the given start and end keys.
 *
 * @category KV
 */
type KvListSelector$1 = {
    prefix: KvKey$1;
} | {
    prefix: KvKey$1;
    start: KvKey$1;
} | {
    prefix: KvKey$1;
    end: KvKey$1;
} | {
    start: KvKey$1;
    end: KvKey$1;
};
/** **UNSTABLE**: New API, yet to be vetted.
 *
 * Options for listing key-value pairs in a {@linkcode Kv}.
 *
 * @category KV
 */
interface KvListOptions$1 {
    /**
     * The maximum number of key-value pairs to return. If not specified, all
     * matching key-value pairs will be returned.
     */
    limit?: number;
    /**
     * The cursor to resume the iteration from. If not specified, the iteration
     * will start from the beginning.
     */
    cursor?: string;
    /**
     * Whether to reverse the order of the returned key-value pairs. If not
     * specified, the order will be ascending from the start of the range as per
     * the lexicographical ordering of the keys. If `true`, the order will be
     * descending from the end of the range.
     *
     * The default value is `false`.
     */
    reverse?: boolean;
    /**
     * The consistency level of the list operation. The default consistency
     * level is "strong". Some use cases can benefit from using a weaker
     * consistency level. For more information on consistency levels, see the
     * documentation for {@linkcode KvConsistencyLevel}.
     *
     * List operations are performed in batches (in sizes specified by the
     * `batchSize` option). The consistency level of the list operation is
     * applied to each batch individually. This means that while each batch is
     * guaranteed to be consistent within itself, the entire list operation may
     * not be consistent across batches because a mutation may be applied to a
     * key-value pair between batches, in a batch that has already been returned
     * by the list operation.
     */
    consistency?: KvConsistencyLevel$1;
    /**
     * The size of the batches in which the list operation is performed. Larger
     * or smaller batch sizes may positively or negatively affect the
     * performance of a list operation depending on the specific use case and
     * iteration behavior. Slow iterating queries may benefit from using a
     * smaller batch size for increased overall consistency, while fast
     * iterating queries may benefit from using a larger batch size for better
     * performance.
     *
     * The default batch size is equal to the `limit` option, or 100 if this is
     * unset. The maximum value for this option is 500. Larger values will be
     * clamped.
     */
    batchSize?: number;
}
/** **UNSTABLE**: New API, yet to be vetted.
 *
 * An iterator over a range of data entries in a {@linkcode Kv}.
 *
 * The cursor getter returns the cursor that can be used to resume the
 * iteration from the current position in the future.
 *
 * @category KV
 */
interface KvListIterator$1<T> extends AsyncIterableIterator<KvEntry$1<T>> {
    /**
     * Returns the cursor of the current position in the iteration. This cursor
     * can be used to resume the iteration from the current position in the
     * future by passing it to the `cursor` option of the `list` method.
     */
    get cursor(): string;
    next(): Promise<IteratorResult<KvEntry$1<T>, undefined>>;
    [Symbol.asyncIterator](): AsyncIterableIterator<KvEntry$1<T>>;
}
/** **UNSTABLE**: New API, yet to be vetted.
 *
 * An operation on a {@linkcode Kv} that can be performed
 * atomically. Atomic operations do not auto-commit, and must be committed
 * explicitly by calling the `commit` method.
 *
 * Atomic operations can be used to perform multiple mutations on the KV store
 * in a single atomic transaction. They can also be used to perform
 * conditional mutations by specifying one or more
 * {@linkcode AtomicCheck}s that ensure that a mutation is only performed
 * if the key-value pair in the KV has a specific versionstamp. If any of the
 * checks fail, the entire operation will fail and no mutations will be made.
 *
 * The ordering of mutations is guaranteed to be the same as the ordering of
 * the mutations specified in the operation. Checks are performed before any
 * mutations are performed. The ordering of checks is unobservable.
 *
 * Atomic operations can be used to implement optimistic locking, where a
 * mutation is only performed if the key-value pair in the KV store has not
 * been modified since the last read. This can be done by specifying a check
 * that ensures that the versionstamp of the key-value pair matches the
 * versionstamp that was read. If the check fails, the mutation will not be
 * performed and the operation will fail. One can then retry the read-modify-
 * write operation in a loop until it succeeds.
 *
 * The `commit` method of an atomic operation returns a value indicating
 * whether checks passed and mutations were performed. If the operation failed
 * because of a failed check, the return value will be a
 * {@linkcode KvCommitError} with an `ok: false` property. If the
 * operation failed for any other reason (storage error, invalid value, etc.),
 * an exception will be thrown. If the operation succeeded, the return value
 * will be a {@linkcode KvCommitResult} object with a `ok: true` property
 * and the versionstamp of the value committed to KV.

 *
 * @category KV
 */
interface AtomicOperation$1 {
    /**
     * Add to the operation a check that ensures that the versionstamp of the
     * key-value pair in the KV store matches the given versionstamp. If the
     * check fails, the entire operation will fail and no mutations will be
     * performed during the commit.
     */
    check(...checks: AtomicCheck$1[]): this;
    /**
     * Add to the operation a mutation that performs the specified mutation on the
     * specified key if all checks pass during the commit. The types and semantics
     * of all available mutations are described in the documentation for
     * {@linkcode KvMutation}.
     */
    mutate(...mutations: KvMutation$1[]): this;
    /**
     * Shortcut for creating a `sum` mutation, the value of `n` must be in the range
     * `[0, 2^64-1]`.
     */
    sum(key: KvKey$1, n: bigint): this;
    /**
     * Shortcut for creating a `min` mutation, the value of `n` must be in the range
     * `[0, 2^64-1]`.
     */
    min(key: KvKey$1, n: bigint): this;
    /**
     * Shortcut for creating a `max` mutation, the value of `n` must be in the range
     * `[0, 2^64-1]`.
     */
    max(key: KvKey$1, n: bigint): this;
    /**
     * Add to the operation a mutation that sets the value of the specified key
     * to the specified value if all checks pass during the commit.
     *
     * Optionally an `expireIn` option can be specified to set a time-to-live
     * (TTL) for the key. The TTL is specified in milliseconds, and the key will
     * be deleted from the database at earliest after the specified number of
     * milliseconds have elapsed. Once the specified duration has passed, the
     * key may still be visible for some additional time. If the `expireIn`
     * option is not specified, the key will not expire.
     */
    set(key: KvKey$1, value: unknown, options?: {
        expireIn?: number;
    }): this;
    /**
     * Add to the operation a mutation that deletes the specified key if all
     * checks pass during the commit.
     */
    delete(key: KvKey$1): this;
    /**
     * Add to the operation a mutation that enqueues a value into the queue
     * if all checks pass during the commit.
     */
    enqueue(value: unknown, options?: {
        delay?: number;
        keysIfUndelivered?: KvKey$1[];
    }): this;
    /**
     * Commit the operation to the KV store. Returns a value indicating whether
     * checks passed and mutations were performed. If the operation failed
     * because of a failed check, the return value will be a {@linkcode
     * KvCommitError} with an `ok: false` property. If the operation failed
     * for any other reason (storage error, invalid value, etc.), an exception
     * will be thrown. If the operation succeeded, the return value will be a
     * {@linkcode KvCommitResult} object with a `ok: true` property and the
     * versionstamp of the value committed to KV.
     *
     * If the commit returns `ok: false`, one may create a new atomic operation
     * with updated checks and mutations and attempt to commit it again. See the
     * note on optimistic locking in the documentation for
     * {@linkcode AtomicOperation}.
     */
    commit(): Promise<KvCommitResult$1 | KvCommitError$1>;
}
/** **UNSTABLE**: New API, yet to be vetted.
 *
 * A check to perform as part of a {@linkcode AtomicOperation}. The check
 * will fail if the versionstamp for the key-value pair in the KV store does
 * not match the given versionstamp. A check with a `null` versionstamp checks
 * that the key-value pair does not currently exist in the KV store.
 *
 * @category KV
 */
interface AtomicCheck$1 {
    key: KvKey$1;
    versionstamp: string | null;
}
/** **UNSTABLE**: New API, yet to be vetted.
 *
 * A mutation to a key in a {@linkcode Kv}. A mutation is a combination of a
 * key, a value, and a type. The type determines how the mutation is applied to
 * the key.
 *
 * - `set` - Sets the value of the key to the given value, overwriting any
 *   existing value. Optionally an `expireIn` option can be specified to set a
 *   time-to-live (TTL) for the key. The TTL is specified in milliseconds, and
 *   the key will be deleted from the database at earliest after the specified
 *   number of milliseconds have elapsed. Once the specified duration has
 *   passed, the key may still be visible for some additional time. If the
 *   `expireIn` option is not specified, the key will not expire.
 * - `delete` - Deletes the key from the database. The mutation is a no-op if
 *   the key does not exist.
 * - `sum` - Adds the given value to the existing value of the key. Both the
 *   value specified in the mutation, and any existing value must be of type
 *   `Deno.KvU64`. If the key does not exist, the value is set to the given
 *   value (summed with 0). If the result of the sum overflows an unsigned
 *   64-bit integer, the result is wrapped around.
 * - `max` - Sets the value of the key to the maximum of the existing value and
 *   the given value. Both the value specified in the mutation, and any existing
 *   value must be of type `Deno.KvU64`. If the key does not exist, the value is
 *   set to the given value.
 * - `min` - Sets the value of the key to the minimum of the existing value and
 *   the given value. Both the value specified in the mutation, and any existing
 *   value must be of type `Deno.KvU64`. If the key does not exist, the value is
 *   set to the given value.
 *
 * @category KV
 */
type KvMutation$1 = {
    key: KvKey$1;
} & ({
    type: "set";
    value: unknown;
    expireIn?: number;
} | {
    type: "delete";
} | {
    type: "sum";
    value: {
        readonly value: bigint;
    };
} | {
    type: "max";
    value: {
        readonly value: bigint;
    };
} | {
    type: "min";
    value: {
        readonly value: bigint;
    };
});
/** @category KV */
interface KvCommitError$1 {
    ok: false;
}

type KvImplementation = "in-memory" | "sqlite" | "remote";
declare function openKv(path?: string, opts?: Record<string, unknown> & {
    debug?: boolean;
    implementation?: KvImplementation;
}): Promise<Kv$1>;

interface DenoKvNodeOptions {
    base?: string;
    path?: string;
    openKvOptions?: Parameters<typeof openKv>[1];
}

type KvKey = readonly KvKeyPart[];
type KvKeyPart =
        | Uint8Array
        | string
        | number
        | bigint
        | boolean
        | symbol;
type KvConsistencyLevel = "strong" | "eventual";
type KvListSelector =
        | { prefix: KvKey }
        | { prefix: KvKey; start: KvKey }
        | { prefix: KvKey; end: KvKey }
        | { start: KvKey; end: KvKey };
type KvMutation =
        & { key: KvKey }
        & (
            | { type: "set"; value: unknown; expireIn?: number }
            | { type: "delete" }
            | { type: "sum"; value: KvU64 }
            | { type: "max"; value: KvU64 }
            | { type: "min"; value: KvU64 }
        );
declare class KvListIterator<T> implements AsyncIterableIterator<KvEntry<T>> {
        /**
         * Returns the cursor of the current position in the iteration. This cursor
         * can be used to resume the iteration from the current position in the
         * future by passing it to the `cursor` option of the `list` method.
         */
        get cursor(): string;

        next(): Promise<IteratorResult<KvEntry<T>, undefined>>;
        [Symbol.asyncIterator](): AsyncIterableIterator<KvEntry<T>>;
    }
interface KvEntry<T> {
        key: KvKey;
        value: T;
        versionstamp: string;
    }
type KvEntryMaybe<T> = KvEntry<T> | {
        key: KvKey;
        value: null;
        versionstamp: null;
    };
interface KvListOptions {
        /**
         * The maximum number of key-value pairs to return. If not specified, all
         * matching key-value pairs will be returned.
         */
        limit?: number;
        /**
         * The cursor to resume the iteration from. If not specified, the iteration
         * will start from the beginning.
         */
        cursor?: string;
        /**
         * Whether to reverse the order of the returned key-value pairs. If not
         * specified, the order will be ascending from the start of the range as per
         * the lexicographical ordering of the keys. If `true`, the order will be
         * descending from the end of the range.
         *
         * The default value is `false`.
         */
        reverse?: boolean;
        /**
         * The consistency level of the list operation. The default consistency
         * level is "strong". Some use cases can benefit from using a weaker
         * consistency level. For more information on consistency levels, see the
         * documentation for {@linkcode KvConsistencyLevel}.
         *
         * List operations are performed in batches (in sizes specified by the
         * `batchSize` option). The consistency level of the list operation is
         * applied to each batch individually. This means that while each batch is
         * guaranteed to be consistent within itself, the entire list operation may
         * not be consistent across batches because a mutation may be applied to a
         * key-value pair between batches, in a batch that has already been returned
         * by the list operation.
         */
        consistency?: KvConsistencyLevel;
        /**
         * The size of the batches in which the list operation is performed. Larger
         * or smaller batch sizes may positively or negatively affect the
         * performance of a list operation depending on the specific use case and
         * iteration behavior. Slow iterating queries may benefit from using a
         * smaller batch size for increased overall consistency, while fast
         * iterating queries may benefit from using a larger batch size for better
         * performance.
         *
         * The default batch size is equal to the `limit` option, or 100 if this is
         * unset. The maximum value for this option is 500. Larger values will be
         * clamped.
         */
        batchSize?: number;
    }
interface KvCommitResult {
        ok: true;
        /** The versionstamp of the value committed to KV. */
        versionstamp: string;
    }
interface KvCommitError {
        ok: false;
    }
interface AtomicCheck {
        key: KvKey;
        versionstamp: string | null;
    }
declare class AtomicOperation {
        /**
         * Add to the operation a check that ensures that the versionstamp of the
         * key-value pair in the KV store matches the given versionstamp. If the
         * check fails, the entire operation will fail and no mutations will be
         * performed during the commit.
         */
        check(...checks: AtomicCheck[]): this;
        /**
         * Add to the operation a mutation that performs the specified mutation on
         * the specified key if all checks pass during the commit. The types and
         * semantics of all available mutations are described in the documentation
         * for {@linkcode KvMutation}.
         */
        mutate(...mutations: KvMutation[]): this;
        /**
         * Shortcut for creating a `sum` mutation. This method wraps `n` in a
         * {@linkcode KvU64}, so the value of `n` must be in the range
         * `[0, 2^64-1]`.
         */
        sum(key: KvKey, n: bigint): this;
        /**
         * Shortcut for creating a `min` mutation. This method wraps `n` in a
         * {@linkcode KvU64}, so the value of `n` must be in the range
         * `[0, 2^64-1]`.
         */
        min(key: KvKey, n: bigint): this;
        /**
         * Shortcut for creating a `max` mutation. This method wraps `n` in a
         * {@linkcode KvU64}, so the value of `n` must be in the range
         * `[0, 2^64-1]`.
         */
        max(key: KvKey, n: bigint): this;
        /**
         * Add to the operation a mutation that sets the value of the specified key
         * to the specified value if all checks pass during the commit.
         *
         * Optionally an `expireIn` option can be specified to set a time-to-live
         * (TTL) for the key. The TTL is specified in milliseconds, and the key will
         * be deleted from the database at earliest after the specified number of
         * milliseconds have elapsed. Once the specified duration has passed, the
         * key may still be visible for some additional time. If the `expireIn`
         * option is not specified, the key will not expire.
         */
        set(key: KvKey, value: unknown, options?: { expireIn?: number }): this;
        /**
         * Add to the operation a mutation that deletes the specified key if all
         * checks pass during the commit.
         */
        delete(key: KvKey): this;
        /**
         * Add to the operation a mutation that enqueues a value into the queue
         * if all checks pass during the commit.
         */
        enqueue(
            value: unknown,
            options?: {
                delay?: number;
                keysIfUndelivered?: KvKey[];
                backoffSchedule?: number[];
            },
        ): this;
        /**
         * Commit the operation to the KV store. Returns a value indicating whether
         * checks passed and mutations were performed. If the operation failed
         * because of a failed check, the return value will be a {@linkcode
         * KvCommitError} with an `ok: false` property. If the operation failed
         * for any other reason (storage error, invalid value, etc.), an exception
         * will be thrown. If the operation succeeded, the return value will be a
         * {@linkcode KvCommitResult} object with a `ok: true` property and the
         * versionstamp of the value committed to KV.
         *
         * If the commit returns `ok: false`, one may create a new atomic operation
         * with updated checks and mutations and attempt to commit it again. See the
         * note on optimistic locking in the documentation for
         * {@linkcode AtomicOperation}.
         */
        commit(): Promise<KvCommitResult | KvCommitError>;
    }
declare class Kv implements Disposable {
        /**
         * Retrieve the value and versionstamp for the given key from the database
         * in the form of a {@linkcode KvEntryMaybe}. If no value exists for
         * the key, the returned entry will have a `null` value and versionstamp.
         *
         * ```ts
         * const db = await openKv();
         * const result = await db.get(["foo"]);
         * result.key; // ["foo"]
         * result.value; // "bar"
         * result.versionstamp; // "00000000000000010000"
         * ```
         *
         * The `consistency` option can be used to specify the consistency level
         * for the read operation. The default consistency level is "strong". Some
         * use cases can benefit from using a weaker consistency level. For more
         * information on consistency levels, see the documentation for
         * {@linkcode KvConsistencyLevel}.
         */
        get<T = unknown>(
            key: KvKey,
            options?: { consistency?: KvConsistencyLevel },
        ): Promise<KvEntryMaybe<T>>;

        /**
         * Retrieve multiple values and versionstamps from the database in the form
         * of an array of {@linkcode KvEntryMaybe} objects. The returned array
         * will have the same length as the `keys` array, and the entries will be in
         * the same order as the keys. If no value exists for a given key, the
         * returned entry will have a `null` value and versionstamp.
         *
         * ```ts
         * const db = await openKv();
         * const result = await db.getMany([["foo"], ["baz"]]);
         * result[0].key; // ["foo"]
         * result[0].value; // "bar"
         * result[0].versionstamp; // "00000000000000010000"
         * result[1].key; // ["baz"]
         * result[1].value; // null
         * result[1].versionstamp; // null
         * ```
         *
         * The `consistency` option can be used to specify the consistency level
         * for the read operation. The default consistency level is "strong". Some
         * use cases can benefit from using a weaker consistency level. For more
         * information on consistency levels, see the documentation for
         * {@linkcode KvConsistencyLevel}.
         */
        getMany<T extends readonly unknown[]>(
            keys: readonly [...{ [K in keyof T]: KvKey }],
            options?: { consistency?: KvConsistencyLevel },
        ): Promise<{ [K in keyof T]: KvEntryMaybe<T[K]> }>;
        /**
         * Set the value for the given key in the database. If a value already
         * exists for the key, it will be overwritten.
         *
         * ```ts
         * const db = await openKv();
         * await db.set(["foo"], "bar");
         * ```
         *
         * Optionally an `expireIn` option can be specified to set a time-to-live
         * (TTL) for the key. The TTL is specified in milliseconds, and the key will
         * be deleted from the database at earliest after the specified number of
         * milliseconds have elapsed. Once the specified duration has passed, the
         * key may still be visible for some additional time. If the `expireIn`
         * option is not specified, the key will not expire.
         */
        set(
            key: KvKey,
            value: unknown,
            options?: { expireIn?: number },
        ): Promise<KvCommitResult>;

        /**
         * Delete the value for the given key from the database. If no value exists
         * for the key, this operation is a no-op.
         *
         * ```ts
         * const db = await openKv();
         * await db.delete(["foo"]);
         * ```
         */
        delete(key: KvKey): Promise<void>;

        /**
         * Retrieve a list of keys in the database. The returned list is an
         * {@linkcode KvListIterator} which can be used to iterate over the
         * entries in the database.
         *
         * Each list operation must specify a selector which is used to specify the
         * range of keys to return. The selector can either be a prefix selector, or
         * a range selector:
         *
         * - A prefix selector selects all keys that start with the given prefix of
         *   key parts. For example, the selector `["users"]` will select all keys
         *   that start with the prefix `["users"]`, such as `["users", "alice"]`
         *   and `["users", "bob"]`. Note that you can not partially match a key
         *   part, so the selector `["users", "a"]` will not match the key
         *   `["users", "alice"]`. A prefix selector may specify a `start` key that
         *   is used to skip over keys that are lexicographically less than the
         *   start key.
         * - A range selector selects all keys that are lexicographically between
         *   the given start and end keys (including the start, and excluding the
         *   end). For example, the selector `["users", "a"], ["users", "n"]` will
         *   select all keys that start with the prefix `["users"]` and have a
         *   second key part that is lexicographically between `a` and `n`, such as
         *   `["users", "alice"]`, `["users", "bob"]`, and `["users", "mike"]`, but
         *   not `["users", "noa"]` or `["users", "zoe"]`.
         *
         * ```ts
         * const db = await openKv();
         * const entries = db.list({ prefix: ["users"] });
         * for await (const entry of entries) {
         *   entry.key; // ["users", "alice"]
         *   entry.value; // { name: "Alice" }
         *   entry.versionstamp; // "00000000000000010000"
         * }
         * ```
         *
         * The `options` argument can be used to specify additional options for the
         * list operation. See the documentation for {@linkcode KvListOptions}
         * for more information.
         */
        list<T = unknown>(
            selector: KvListSelector,
            options?: KvListOptions,
        ): KvListIterator<T>;

        /**
         * Add a value into the database queue to be delivered to the queue
         * listener via {@linkcode Kv.listenQueue}.
         *
         * ```ts
         * const db = await openKv();
         * await db.enqueue("bar");
         * ```
         *
         * The `delay` option can be used to specify the delay (in milliseconds)
         * of the value delivery. The default delay is 0, which means immediate
         * delivery.
         *
         * ```ts
         * const db = await openKv();
         * await db.enqueue("bar", { delay: 60000 });
         * ```
         *
         * The `keysIfUndelivered` option can be used to specify the keys to
         * be set if the value is not successfully delivered to the queue
         * listener after several attempts. The values are set to the value of
         * the queued message.
         *
         * The `backoffSchedule` option can be used to specify the retry policy for
         * failed message delivery. Each element in the array represents the number of
         * milliseconds to wait before retrying the delivery. For example,
         * `[1000, 5000, 10000]` means that a failed delivery will be retried
         * at most 3 times, with 1 second, 5 seconds, and 10 seconds delay
         * between each retry.
         *
         * ```ts
         * const db = await openKv();
         * await db.enqueue("bar", {
         *   keysIfUndelivered: [["foo", "bar"]],
         *   backoffSchedule: [1000, 5000, 10000],
         * });
         * ```
         */
        enqueue(
            value: unknown,
            options?: {
                delay?: number;
                keysIfUndelivered?: KvKey[];
                backoffSchedule?: number[];
            },
        ): Promise<KvCommitResult>;

        /**
         * Listen for queue values to be delivered from the database queue, which
         * were enqueued with {@linkcode Kv.enqueue}. The provided handler
         * callback is invoked on every dequeued value. A failed callback
         * invocation is automatically retried multiple times until it succeeds
         * or until the maximum number of retries is reached.
         *
         * ```ts
         * const db = await openKv();
         * db.listenQueue(async (msg: unknown) => {
         *   await db.set(["foo"], msg);
         * });
         * ```
         */
        // deno-lint-ignore no-explicit-any
        listenQueue(handler: (value: any) => Promise<void> | void): Promise<void>;

        /**
         * Create a new {@linkcode AtomicOperation} object which can be used to
         * perform an atomic transaction on the database. This does not perform any
         * operations on the database - the atomic transaction must be committed
         * explicitly using the {@linkcode AtomicOperation.commit} method once
         * all checks and mutations have been added to the operation.
         */
        atomic(): AtomicOperation;

        /**
         * Watch for changes to the given keys in the database. The returned stream
         * is a {@linkcode ReadableStream} that emits a new value whenever any of
         * the watched keys change their versionstamp. The emitted value is an array
         * of {@linkcode KvEntryMaybe} objects, with the same length and order
         * as the `keys` array. If no value exists for a given key, the returned
         * entry will have a `null` value and versionstamp.
         *
         * The returned stream does not return every single intermediate state of
         * the watched keys, but rather only keeps you up to date with the latest
         * state of the keys. This means that if a key is modified multiple times
         * quickly, you may not receive a notification for every single change, but
         * rather only the latest state of the key.
         *
         * ```ts
         * const db = await openKv();
         *
         * const stream = db.watch([["foo"], ["bar"]]);
         * for await (const entries of stream) {
         *   entries[0].key; // ["foo"]
         *   entries[0].value; // "bar"
         *   entries[0].versionstamp; // "00000000000000010000"
         *   entries[1].key; // ["bar"]
         *   entries[1].value; // null
         *   entries[1].versionstamp; // null
         * }
         * ```
         *
         * The `options` argument can be used to specify additional options for the
         * watch operation. The `raw` option can be used to specify whether a new
         * value should be emitted whenever a mutation occurs on any of the watched
         * keys (even if the value of the key does not change, such as deleting a
         * deleted key), or only when entries have observably changed in some way.
         * When `raw: true` is used, it is possible for the stream to occasionally
         * emit values even if no mutations have occurred on any of the watched
         * keys. The default value for this option is `false`.
         */
        watch<T extends readonly unknown[]>(
            keys: readonly [...{ [K in keyof T]: KvKey }],
            options?: { raw?: boolean },
        ): ReadableStream<{ [K in keyof T]: KvEntryMaybe<T[K]> }>;

        /**
         * Close the database connection. This will prevent any further operations
         * from being performed on the database, and interrupt any in-flight
         * operations immediately.
         */
        close(): void;

        /**
         * Get a symbol that represents the versionstamp of the current atomic
         * operation. This symbol can be used as the last part of a key in
         * `.set()`, both directly on the `Kv` object and on an `AtomicOperation`
         * object created from this `Kv` instance.
         */
        commitVersionstamp(): symbol;

        [Symbol.dispose](): void;
    }
declare class KvU64 {
        /** Create a new `KvU64` instance from the given bigint value. If the value
         * is signed or greater than 64-bits, an error will be thrown. */
        constructor(value: bigint);
        /** The value of this unsigned 64-bit integer, represented as a bigint. */
        readonly value: bigint;
    }

interface DenoKvOptions {
    base?: string;
    path?: string;
    openKv?: () => Promise<Kv | Kv$1>;
    /**
     * Default TTL for all items in seconds.
     */
    ttl?: number;
}

interface FSStorageOptions$1 {
    base?: string;
    ignore?: (path: string) => boolean;
    readOnly?: boolean;
    noClear?: boolean;
}

/*! chokidar - MIT License (c) 2012 Paul Miller (paulmillr.com) */

type AWF = {
    stabilityThreshold: number;
    pollInterval: number;
};
type BasicOpts = {
    persistent: boolean;
    ignoreInitial: boolean;
    followSymlinks: boolean;
    cwd?: string;
    usePolling: boolean;
    interval: number;
    binaryInterval: number;
    alwaysStat?: boolean;
    depth?: number;
    ignorePermissionErrors: boolean;
    atomic: boolean | number;
};
type ChokidarOptions = Partial<BasicOpts & {
    ignored: Matcher | Matcher[];
    awaitWriteFinish: boolean | Partial<AWF>;
}>;
type MatchFunction = (val: string, stats?: Stats) => boolean;
interface MatcherObject {
    path: string;
    recursive?: boolean;
}
type Matcher = string | RegExp | MatchFunction | MatcherObject;

interface FSStorageOptions {
    base?: string;
    ignore?: string[];
    readOnly?: boolean;
    noClear?: boolean;
    watchOptions?: ChokidarOptions;
}

interface GithubOptions {
    /**
     * The name of the repository. (e.g. `username/my-repo`)
     * Required
     */
    repo: string;
    /**
     * The branch to fetch. (e.g. `dev`)
     * @default "main"
     */
    branch?: string;
    /**
     * @default ""
     */
    dir?: string;
    /**
     * @default 600
     */
    ttl?: number;
    /**
     * Github API token (recommended)
     */
    token?: string;
    /**
     * @default "https://api.github.com"
     */
    apiURL?: string;
    /**
     * @default "https://raw.githubusercontent.com"
     */
    cdnURL?: string;
}

interface HTTPOptions {
    base: string;
    headers?: Record<string, string>;
}

interface IDBKeyvalOptions {
    base?: string;
    dbName?: string;
    storeName?: string;
}

interface LocalStorageOptions {
    base?: string;
    window?: typeof window;
    windowKey?: "localStorage" | "sessionStorage";
    storage?: typeof window.localStorage | typeof window.sessionStorage;
    /** @deprecated use `storage` option */
    sessionStorage?: typeof window.sessionStorage;
    /** @deprecated use `storage` option */
    localStorage?: typeof window.localStorage;
}

type LRUCacheOptions = LRUCache.OptionsBase<string, any, any> & Partial<LRUCache.OptionsMaxLimit<string, any, any>> & Partial<LRUCache.OptionsSizeLimit<string, any, any>> & Partial<LRUCache.OptionsTTLLimit<string, any, any>>;
interface LRUDriverOptions extends LRUCacheOptions {
}

interface MongoDbOptions {
    /**
     * The MongoDB connection string.
     */
    connectionString: string;
    /**
     * Optional configuration settings for the MongoClient instance.
     */
    clientOptions?: MongoClientOptions;
    /**
     * The name of the database to use.
     * @default "unstorage"
     */
    databaseName?: string;
    /**
     * The name of the collection to use.
     * @default "unstorage"
     */
    collectionName?: string;
}

type Fetcher = typeof globalThis.fetch;
type ConsistencyMode = 'eventual' | 'strong';
interface ClientOptions {
    apiURL?: string;
    consistency?: ConsistencyMode;
    edgeURL?: string;
    fetch?: Fetcher;
    siteID: string;
    token: string;
    uncachedEdgeURL?: string;
}
declare const regions: {
    'us-east-1': boolean;
    'us-east-2': boolean;
    'eu-central-1': boolean;
    'ap-southeast-1': boolean;
    'ap-southeast-2': boolean;
};
type Region = keyof typeof regions;
interface GetDeployStoreOptions extends Partial<ClientOptions> {
    deployID?: string;
    name?: string;
    region?: Region;
}
interface GetStoreOptions extends Partial<ClientOptions> {
    deployID?: string;
    name?: string;
    /**
     * The region where the store's data is held. Unlike deploy-scoped stores,
     * site-wide stores do not take this from the environment, so omitting it
     * means the API picks its default region rather than the site's configured
     * Functions region. A store's data does not move if this value changes.
     */
    region?: Region;
}

type NetlifyStoreOptions = NetlifyDeployStoreLegacyOptions | NetlifyDeployStoreOptions | NetlifyNamedStoreOptions;
interface ExtraOptions {
    /** If set to `true`, the store is scoped to the deploy. This means that it is only available from that deploy, and will be deleted or rolled-back alongside it. */
    deployScoped?: boolean;
}
interface NetlifyDeployStoreOptions extends GetDeployStoreOptions, ExtraOptions {
    name?: never;
    deployScoped: true;
}
interface NetlifyDeployStoreLegacyOptions extends NetlifyDeployStoreOptions {
    region?: never;
}
interface NetlifyNamedStoreOptions extends GetStoreOptions, ExtraOptions {
    name: string;
    deployScoped?: false;
}

type StorageValue = null | string | number | boolean | object;
type WatchEvent = "update" | "remove";
type WatchCallback = (event: WatchEvent, key: string) => any;
type MaybePromise<T> = T | Promise<T>;
type Unwatch = () => MaybePromise<void>;
interface StorageMeta {
    atime?: Date;
    mtime?: Date;
    ttl?: number;
    [key: string]: StorageValue | Date | undefined;
}
type TransactionOptions = Record<string, any>;
type GetKeysOptions = TransactionOptions & {
    maxDepth?: number;
};
interface DriverFlags {
    maxDepth?: boolean;
    ttl?: boolean;
}
interface Driver<OptionsT = any, InstanceT = any> {
    name?: string;
    flags?: DriverFlags;
    options?: OptionsT;
    getInstance?: () => InstanceT;
    hasItem: (key: string, opts: TransactionOptions) => MaybePromise<boolean>;
    getItem: (key: string, opts?: TransactionOptions) => MaybePromise<StorageValue>;
    /** @experimental */
    getItems?: (items: {
        key: string;
        options?: TransactionOptions;
    }[], commonOptions?: TransactionOptions) => MaybePromise<{
        key: string;
        value: StorageValue;
    }[]>;
    /** @experimental */
    getItemRaw?: (key: string, opts: TransactionOptions) => MaybePromise<unknown>;
    setItem?: (key: string, value: string, opts: TransactionOptions) => MaybePromise<void>;
    /** @experimental */
    setItems?: (items: {
        key: string;
        value: string;
        options?: TransactionOptions;
    }[], commonOptions?: TransactionOptions) => MaybePromise<void>;
    /** @experimental */
    setItemRaw?: (key: string, value: any, opts: TransactionOptions) => MaybePromise<void>;
    removeItem?: (key: string, opts: TransactionOptions) => MaybePromise<void>;
    getMeta?: (key: string, opts: TransactionOptions) => MaybePromise<StorageMeta | null>;
    getKeys: (base: string, opts: GetKeysOptions) => MaybePromise<string[]>;
    clear?: (base: string, opts: TransactionOptions) => MaybePromise<void>;
    dispose?: () => MaybePromise<void>;
    watch?: (callback: WatchCallback) => MaybePromise<Unwatch>;
}

interface OverlayStorageOptions {
    layers: Driver[];
}

interface PlanetscaleDriverOptions {
    url?: string;
    table?: string;
    boostCache?: boolean;
}

interface RedisOptions$1 extends RedisOptions$2 {
    /**
     * Optional prefix to use for all keys. Can be used for namespacing.
     */
    base?: string;
    /**
     * Url to use for connecting to redis. Takes precedence over `host` option. Has the format `redis://<REDIS_USER>:<REDIS_PASSWORD>@<REDIS_HOST>:<REDIS_PORT>`
     */
    url?: string;
    /**
     * List of redis nodes to use for cluster mode. Takes precedence over `url` and `host` options.
     */
    cluster?: ClusterNode[];
    /**
     * Options to use for cluster mode.
     */
    clusterOptions?: ClusterOptions;
    /**
     * Default TTL for all items in seconds.
     */
    ttl?: number;
    /**
     * How many keys to scan at once.
     *
     * [redis documentation](https://redis.io/docs/latest/commands/scan/#the-count-option)
     */
    scanCount?: number;
    /**
     * Whether to initialize the redis instance immediately.
     * Otherwise, it will be initialized on the first read/write call.
     * @default false
     */
    preConnect?: boolean;
}

interface S3DriverOptions {
    /**
     * Access Key ID
     */
    accessKeyId: string;
    /**
     * Secret Access Key
     */
    secretAccessKey: string;
    /**
     * The endpoint URL of the S3 service.
     *
     * - For AWS S3: "https://s3.[region].amazonaws.com/"
     * - For cloudflare R2: "https://[uid].r2.cloudflarestorage.com/"
     */
    endpoint: string;
    /**
     * The region of the S3 bucket.
     *
     * - For AWS S3, this is the region of the bucket.
     * - For cloudflare, this is can be set to `auto`.
     */
    region: string;
    /**
     * The name of the bucket.
     */
    bucket: string;
    /**
     * Enabled by default to speedup `clear()` operation. Set to `false` if provider is not implementing [DeleteObject](https://docs.aws.amazon.com/AmazonS3/latest/API/API_DeleteObjects.html).
     */
    bulkDelete?: boolean;
}

interface SessionStorageOptions extends LocalStorageOptions {
}

interface RequestInitEsque {
  /**
   * Sets the request's body.
   */
  body?: FormData | ReadableStream | string | null;
  /**
   * Sets the request's associated headers.
   */
  headers?: [string, string][] | Record<string, string>;
  /**
   * The request's HTTP-style method.
   */
  method?: string;
}
interface ResponseEsque {
  status: number;
  statusText: string;
  ok: boolean;
  /**
   * @remarks
   * The built-in Response::json() method returns Promise<any>, but
   * that's not as type-safe as unknown. We use unknown because we're
   * more type-safe. You do want more type safety, right? 😉
   */
  json: <T = unknown>() => Promise<T>;
  text: () => Promise<string>;
  blob: () => Promise<Blob>;
  body: ReadableStream | null;
  headers: Headers;
  clone: () => ResponseEsque;
}
type MaybeUrl = string | URL;
type FetchEsque = (input: RequestInfo | MaybeUrl, init?: RequestInit | RequestInitEsque) => Promise<ResponseEsque>;

interface UTApiOptions$1 {
  /**
   * Provide a custom fetch function.
   * @default globalThis.fetch
   */
  fetch?: FetchEsque;
  /**
   * Provide a custom UploadThing token
   * @default process.env.UPLOADTHING_TOKEN
   */
  token?: string;
  /**
   * @default "info"
   */
  logLevel?:"All" | "Fatal" | "Error" | "Warning" | "Info" | "Debug" | "Trace" | "None";
  /**
   * What format log entries should be in
   * @default "pretty" in development, else "json"
   * @see https://effect.website/docs/guides/observability/logging#built-in-loggers
   */
  logFormat?:"json" | "logFmt" | "structured" | "pretty";
  /**
   * Set the default key type for file operations. Allows you to set your preferred filter
   * for file keys or custom identifiers without needing to specify it on every call.
   * @default "fileKey"
   */
  defaultKeyType?: "fileKey" | "customId";
  /**
   * URL override for the API server
   */
  apiUrl?: string;
  /**
   * URL override for the ingest server
   */
  ingestUrl?: string;
  /**
   * Hostname override for the CDN hosting the files
   * @default "ufs.sh"
   */
  ufsHost?: string;
  /**
   * Where to put the appId in the URL.
   * @default "subdomain"
   */
  ufsAppIdLocation?: "subdomain" | "path";
}

type UTApiOptions = Omit<UTApiOptions$1, "defaultKeyType">;
interface UploadThingOptions extends UTApiOptions {
    /** base key to add to keys */
    base?: string;
}

type RedisOptions = {
    /**
     * Automatically try to deserialize the returned data from upstash using `JSON.deserialize`
     *
     * @default true
     */
    automaticDeserialization?: boolean;
    latencyLogging?: boolean;
    enableTelemetry?: boolean;
    enableAutoPipelining?: boolean;
    readYourWrites?: boolean;
};

type CacheSetting = "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload";
type RetryConfig = false | {
    /**
     * The number of retries to attempt before giving up.
     *
     * @default 5
     */
    retries?: number;
    /**
     * A backoff function receives the current retry count and returns a number in milliseconds to wait before retrying.
     *
     * @default
     * ```ts
     * Math.exp(retryCount) * 50
     * ```
     */
    backoff?: (retryCount: number) => number;
};
type Options$1 = {
    backend?: string;
};
type RequesterConfig = {
    /**
     * Configure the retry behaviour in case of network errors
     */
    retry?: RetryConfig;
    /**
     * Response encoding requested from the server.
     *
     * By default the server returns string values as plain JSON strings. Set this to "base64" to have
     * the server base64-encode string values, which the client decodes as utf8. This increases the
     * response size by about 33%.
     *
     * @default false
     */
    responseEncoding?: false | "base64";
    /**
     * Configure the cache behaviour
     * @default "no-store"
     */
    cache?: CacheSetting;
};
type HttpClientConfig = {
    headers?: Record<string, string>;
    baseUrl: string;
    options?: Options$1;
    retry?: RetryConfig;
    agent?: any;
    signal?: AbortSignal | (() => AbortSignal);
    keepAlive?: boolean;
    /**
     * When this flag is enabled, any subsequent commands issued by this client are guaranteed to observe the effects of all earlier writes submitted by the same client.
     */
    readYourWrites?: boolean;
} & RequesterConfig;

/**
 * Connection credentials for upstash redis.
 * Get them from https://console.upstash.com/redis/<uuid>
 */
type RedisConfigNodejs = {
    /**
     * UPSTASH_REDIS_REST_URL
     */
    url: string | undefined;
    /**
     * UPSTASH_REDIS_REST_TOKEN
     */
    token: string | undefined;
    /**
     * An agent allows you to reuse connections to reduce latency for multiple sequential requests.
     *
     * This is a node specific implementation and is not supported in various runtimes like Vercel
     * edge functions.
     *
     * @example
     * ```ts
     * import https from "https"
     *
     * const options: RedisConfigNodejs = {
     *  agent: new https.Agent({ keepAlive: true })
     * }
     * ```
     */
    /**
     * The signal will allow aborting requests on the fly.
     * For more check: https://developer.mozilla.org/en-US/docs/Web/API/AbortSignal
     */
    signal?: HttpClientConfig["signal"];
    latencyLogging?: boolean;
    agent?: unknown;
    keepAlive?: boolean;
    /**
     * When this flag is enabled, any subsequent commands issued by this client are guaranteed to observe the effects of all earlier writes submitted by the same client.
     */
    readYourWrites?: boolean;
} & RedisOptions & RequesterConfig;

interface UpstashOptions extends Partial<RedisConfigNodejs> {
    /**
     * Optional prefix to use for all keys. Can be used for namespacing.
     */
    base?: string;
    /**
     * Default TTL for all items in seconds.
     */
    ttl?: number;
    /**
     * How many keys to scan at once.
     *
     * [redis documentation](https://redis.io/docs/latest/commands/scan/#the-count-option)
     */
    scanCount?: number;
}

interface VercelBlobOptions {
    /**
     * Whether the blob should be publicly accessible. (required, must be "public")
     */
    access: "public";
    /**
     * Prefix to prepend to all keys. Can be used for namespacing.
     */
    base?: string;
    /**
     * Rest API Token to use for connecting to your Vercel Blob store.
     * If not provided, it will be read from the environment variable `BLOB_READ_WRITE_TOKEN`.
     */
    token?: string;
    /**
     * Prefix to use for token environment variable name.
     * Default is `BLOB` (env name = `BLOB_READ_WRITE_TOKEN`).
     */
    envPrefix?: string;
}

interface VercelKVOptions extends Partial<RedisConfigNodejs> {
    /**
     * Optional prefix to use for all keys. Can be used for namespacing.
     */
    base?: string;
    /**
     * Optional flag to customize environment variable prefix (Default is `KV`). Set to `false` to disable env inference for `url` and `token` options
     */
    env?: false | string;
    /**
     * Default TTL for all items in seconds.
     */
    ttl?: number;
    /**
     * How many keys to scan at once.
     *
     * [redis documentation](https://redis.io/docs/latest/commands/scan/#the-count-option)
     */
    scanCount?: number;
}

interface VercelCacheOptions {
    /**
     * Optional prefix to use for all keys. Can be used for namespacing.
     */
    base?: string;
    /**
     * Default TTL for all items in seconds.
     */
    ttl?: number;
    /**
     * Default tags to apply to all cache entries.
     */
    tags?: string[];
}

type BuiltinDriverName = "azure-app-configuration" | "azureAppConfiguration" | "azure-cosmos" | "azureCosmos" | "azure-key-vault" | "azureKeyVault" | "azure-storage-blob" | "azureStorageBlob" | "azure-storage-table" | "azureStorageTable" | "capacitor-preferences" | "capacitorPreferences" | "cloudflare-kv-binding" | "cloudflareKVBinding" | "cloudflare-kv-http" | "cloudflareKVHttp" | "cloudflare-r2-binding" | "cloudflareR2Binding" | "db0" | "deno-kv-node" | "denoKVNode" | "deno-kv" | "denoKV" | "fs-lite" | "fsLite" | "fs" | "github" | "http" | "indexedb" | "localstorage" | "lru-cache" | "lruCache" | "memory" | "mongodb" | "netlify-blobs" | "netlifyBlobs" | "null" | "overlay" | "planetscale" | "redis" | "s3" | "session-storage" | "sessionStorage" | "uploadthing" | "upstash" | "vercel-blob" | "vercelBlob" | "vercel-kv" | "vercelKV" | "vercel-runtime-cache" | "vercelRuntimeCache";
type BuiltinDriverOptions = {
    "azure-app-configuration": AzureAppConfigurationOptions;
    "azureAppConfiguration": AzureAppConfigurationOptions;
    "azure-cosmos": AzureCosmosOptions;
    "azureCosmos": AzureCosmosOptions;
    "azure-key-vault": AzureKeyVaultOptions;
    "azureKeyVault": AzureKeyVaultOptions;
    "azure-storage-blob": AzureStorageBlobOptions;
    "azureStorageBlob": AzureStorageBlobOptions;
    "azure-storage-table": AzureStorageTableOptions;
    "azureStorageTable": AzureStorageTableOptions;
    "capacitor-preferences": CapacitorPreferencesOptions;
    "capacitorPreferences": CapacitorPreferencesOptions;
    "cloudflare-kv-binding": KVOptions;
    "cloudflareKVBinding": KVOptions;
    "cloudflare-kv-http": KVHTTPOptions;
    "cloudflareKVHttp": KVHTTPOptions;
    "cloudflare-r2-binding": CloudflareR2Options;
    "cloudflareR2Binding": CloudflareR2Options;
    "db0": DB0DriverOptions;
    "deno-kv-node": DenoKvNodeOptions;
    "denoKVNode": DenoKvNodeOptions;
    "deno-kv": DenoKvOptions;
    "denoKV": DenoKvOptions;
    "fs-lite": FSStorageOptions$1;
    "fsLite": FSStorageOptions$1;
    "fs": FSStorageOptions;
    "github": GithubOptions;
    "http": HTTPOptions;
    "indexedb": IDBKeyvalOptions;
    "localstorage": LocalStorageOptions;
    "lru-cache": LRUDriverOptions;
    "lruCache": LRUDriverOptions;
    "mongodb": MongoDbOptions;
    "netlify-blobs": NetlifyStoreOptions;
    "netlifyBlobs": NetlifyStoreOptions;
    "overlay": OverlayStorageOptions;
    "planetscale": PlanetscaleDriverOptions;
    "redis": RedisOptions$1;
    "s3": S3DriverOptions;
    "session-storage": SessionStorageOptions;
    "sessionStorage": SessionStorageOptions;
    "uploadthing": UploadThingOptions;
    "upstash": UpstashOptions;
    "vercel-blob": VercelBlobOptions;
    "vercelBlob": VercelBlobOptions;
    "vercel-kv": VercelKVOptions;
    "vercelKV": VercelKVOptions;
    "vercel-runtime-cache": VercelCacheOptions;
    "vercelRuntimeCache": VercelCacheOptions;
};

export type { BuiltinDriverName, BuiltinDriverOptions };
