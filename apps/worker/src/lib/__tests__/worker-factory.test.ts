import type { Processor } from "bullmq";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { redisConnection } from "../redis";
import {
  createWorker,
  getWorkerConcurrency,
  getWorkerConcurrencyEnvName,
} from "../worker-factory";

const { workerConstructor } = vi.hoisted(() => ({
  workerConstructor: vi.fn(),
}));

vi.mock("bullmq", () => ({
  Worker: class MockWorker {
    public readonly name: string;

    constructor(...args: unknown[]) {
      this.name = String(args[0]);
      workerConstructor(...args);
    }
  },
}));

vi.mock("../redis", () => ({
  redisConnection: { host: "redis" },
}));

const processor: Processor<unknown, unknown, string> = async () => undefined;

describe("worker-factory", () => {
  beforeEach(() => {
    workerConstructor.mockClear();
    delete process.env.WORKER_CONCURRENCY;
    delete process.env.WORKER_CONCURRENCY_DISCORD_VALIDATION;
    delete process.env.WORKER_CONCURRENCY_GOOGLE_SHEETS_SYNC;
  });

  it("uses the default worker concurrency when env is unset", () => {
    expect(getWorkerConcurrency("discord-validation")).toBe(5);

    createWorker("discord-validation", processor);

    expect(workerConstructor).toHaveBeenCalledWith(
      "discord-validation",
      processor,
      expect.objectContaining({
        connection: redisConnection,
        concurrency: 5,
      }),
    );
  });

  it("uses WORKER_CONCURRENCY for all queues", () => {
    process.env.WORKER_CONCURRENCY = "2";

    expect(getWorkerConcurrency("discord-validation")).toBe(2);
    expect(getWorkerConcurrency("google-sheets-sync")).toBe(2);
  });

  it("uses queue-specific concurrency overrides", () => {
    process.env.WORKER_CONCURRENCY = "4";
    process.env.WORKER_CONCURRENCY_DISCORD_VALIDATION = "1";

    expect(getWorkerConcurrency("discord-validation")).toBe(1);
    expect(getWorkerConcurrency("google-sheets-sync")).toBe(4);
  });

  it("normalizes queue names into concurrency env names", () => {
    expect(getWorkerConcurrencyEnvName("google-sheets-sync")).toBe(
      "WORKER_CONCURRENCY_GOOGLE_SHEETS_SYNC",
    );
  });

  it("keeps explicit worker options as the highest precedence", () => {
    process.env.WORKER_CONCURRENCY = "2";

    createWorker("discord-validation", processor, { concurrency: 3 });

    expect(workerConstructor).toHaveBeenCalledWith(
      "discord-validation",
      processor,
      expect.objectContaining({
        concurrency: 3,
      }),
    );
  });
});
