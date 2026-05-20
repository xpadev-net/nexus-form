/**
 * Minimal Redis-compatible client contract used by the shared publisher.
 */
export interface RedisPublisherClient {
  /** Subscribe to client errors emitted with an Error instance. */
  on(event: "error", listener: (error: Error) => void): unknown;
  /** Publish a serialized message to a channel. */
  publish(channel: string, message: string): Promise<unknown>;
  /** Close the underlying client connection. */
  quit(): Promise<unknown>;
}

/**
 * Dependencies and lifecycle hooks for createRedisPublisher.
 */
export interface RedisPublisherOptions<TEvent> {
  /** Lazily creates a client, or returns null when publishing is disabled. */
  createClient: () => RedisPublisherClient | null;
  /** Resolves the Redis channel for an event. */
  resolveChannel: (event: TEvent) => string;
  /** Serializes an event before publishing. Defaults to JSON.stringify. */
  serialize?: (event: TEvent) => string;
  /** Runs once after a Redis client is created. */
  onInit?: () => void;
  /** Handles asynchronous Redis client error events. */
  onConnectionError: (error: Error) => void;
  /** Handles create, channel resolution, serialization, and publish failures. */
  onPublishError: (error: unknown, event: TEvent) => void;
  /** Handles quit failures before close optionally rethrows the original error. */
  onCloseError?: (error: unknown) => void;
  /** When true, close logs quit failures without rejecting. Defaults to false. */
  swallowCloseError?: boolean;
}

/**
 * Publisher facade with non-throwing publish and explicit close lifecycle.
 */
export interface RedisPublisher<TEvent> {
  /** Publish an event if a client is available; publish errors are reported only. */
  publish: (event: TEvent) => Promise<void>;
  /** Close the cached client; rejects on quit failure unless configured otherwise. */
  close: () => Promise<void>;
}

/**
 * Create a lazy Redis publisher.
 *
 * @param options - Client factory, channel resolver, serializer, and lifecycle hooks.
 * @returns A publisher that reuses one client until close resets it.
 *
 * publish resolves after a successful publish, a skipped publish when createClient returns
 * null, or after reporting a publish error. close resets the cached client in all cases
 * and rejects with the original quit error unless swallowCloseError is true.
 */
export function createRedisPublisher<TEvent>({
  createClient,
  resolveChannel,
  serialize = JSON.stringify,
  onInit,
  onConnectionError,
  onPublishError,
  onCloseError,
  swallowCloseError = false,
}: RedisPublisherOptions<TEvent>): RedisPublisher<TEvent> {
  let publisher: RedisPublisherClient | null = null;

  function getPublisher(): RedisPublisherClient | null {
    if (publisher) return publisher;

    publisher = createClient();
    if (!publisher) return null;

    publisher.on("error", onConnectionError);
    onInit?.();
    return publisher;
  }

  return {
    async publish(event: TEvent): Promise<void> {
      try {
        const redis = getPublisher();
        if (!redis) return;
        await redis.publish(resolveChannel(event), serialize(event));
      } catch (error) {
        try {
          onPublishError(error, event);
        } catch {
          // Preserve publish as best-effort even if the reporting hook fails.
        }
      }
    },
    async close(): Promise<void> {
      if (!publisher) return;
      try {
        await publisher.quit();
      } catch (error) {
        try {
          onCloseError?.(error);
        } catch {
          // The original quit failure controls close rejection behavior.
        }
        if (!swallowCloseError) {
          throw error;
        }
      } finally {
        publisher = null;
      }
    },
  };
}
