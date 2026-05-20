export interface RedisPublisherClient {
  on(event: "error", listener: (error: Error) => void): unknown;
  publish(channel: string, message: string): Promise<unknown>;
  quit(): Promise<unknown>;
}

export interface RedisPublisherOptions<TEvent> {
  createClient: () => RedisPublisherClient | null;
  resolveChannel: (event: TEvent) => string;
  serialize?: (event: TEvent) => string;
  onInit?: () => void;
  onConnectionError: (error: Error) => void;
  onPublishError: (error: unknown, event: TEvent) => void;
  onCloseError?: (error: unknown) => void;
  swallowCloseError?: boolean;
}

export interface RedisPublisher<TEvent> {
  publish: (event: TEvent) => Promise<void>;
  close: () => Promise<void>;
}

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
        onPublishError(error, event);
      }
    },
    async close(): Promise<void> {
      if (!publisher) return;
      try {
        await publisher.quit();
      } catch (error) {
        onCloseError?.(error);
        if (!swallowCloseError) {
          throw error;
        }
      } finally {
        publisher = null;
      }
    },
  };
}
