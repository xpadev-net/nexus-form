import {
  ACTIVE_SNAPSHOT_STRUCTURE_SECURITY_MIGRATION_TIMESTAMP,
  CURRENT_CONFIG_JSON_MIGRATION_TIMESTAMP,
  FORM_STRUCTURE_UNIQUE_CONSTRAINTS_MIGRATION_TIMESTAMP,
  LEGACY_CONFIG_JSON_MIGRATION_TIMESTAMP,
  PUBLIC_PASSWORD_GRANT_GENERATION_MIGRATION_TIMESTAMP,
  runMigrations,
} from "@nexus-form/database/migrate";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const moduleMocks = vi.hoisted(() => ({
  createPool: vi.fn(),
  drizzle: vi.fn(),
  migrate: vi.fn(),
}));

vi.mock("mysql2/promise", () => ({
  default: {
    createPool: moduleMocks.createPool,
  },
}));

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: moduleMocks.drizzle,
}));

vi.mock("drizzle-orm/mysql2/migrator", () => ({
  migrate: moduleMocks.migrate,
}));

type FakeMigrationPool = {
  query: ReturnType<typeof vi.fn>;
  end: ReturnType<typeof vi.fn>;
};

const requiredMigrationTimestamps = [
  CURRENT_CONFIG_JSON_MIGRATION_TIMESTAMP,
  ACTIVE_SNAPSHOT_STRUCTURE_SECURITY_MIGRATION_TIMESTAMP,
  FORM_STRUCTURE_UNIQUE_CONSTRAINTS_MIGRATION_TIMESTAMP,
  PUBLIC_PASSWORD_GRANT_GENERATION_MIGRATION_TIMESTAMP,
];

function connectionError(code: string): Error & { code: string } {
  return Object.assign(new Error(`connection failure: ${code}`), { code });
}

function createRejectedPreflightPool(error: unknown): FakeMigrationPool {
  return {
    query: vi.fn().mockRejectedValue(error),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

function createSuccessfulMigrationPool(): FakeMigrationPool {
  let tableReadCount = 0;

  return {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) {
        tableReadCount += 1;
        return [[{ count: tableReadCount === 1 ? 0 : 1 }], []];
      }

      if (sql.includes("FROM __drizzle_migrations")) {
        const requestedTimestamps = new Set(
          values.map((value) => Number(value)),
        );
        return [
          requiredMigrationTimestamps
            .filter((createdAt) => requestedTimestamps.has(createdAt))
            .map((createdAt) => ({ createdAt })),
          [],
        ];
      }

      throw new Error(`Unexpected query: ${sql}`);
    }),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

function createPostMigrationRejectedPool(error: unknown): FakeMigrationPool {
  let tableReadCount = 0;

  return {
    query: vi.fn(async (sql: string) => {
      if (!sql.includes("INFORMATION_SCHEMA.TABLES")) {
        throw new Error(`Unexpected query: ${sql}`);
      }

      tableReadCount += 1;
      if (tableReadCount === 1) {
        return [[{ count: 0 }], []];
      }

      throw error;
    }),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

function createNormalizationMigrationPool(
  events: string[],
  updateError?: unknown,
): FakeMigrationPool {
  return {
    query: vi.fn(async (sql: string, values: unknown[] = []) => {
      if (sql.includes("INFORMATION_SCHEMA.TABLES")) {
        return [[{ count: 1 }], []];
      }

      if (sql.includes("INFORMATION_SCHEMA.COLUMNS")) {
        return [[{ columnName: "configJson" }], []];
      }

      if (sql.startsWith("UPDATE `__drizzle_migrations`")) {
        events.push("normalize-update");
        if (updateError !== undefined) {
          throw updateError;
        }
        return [{ affectedRows: 1 }, []];
      }

      if (sql.includes("FROM __drizzle_migrations")) {
        const requestedTimestamps = new Set(
          values.map((value) => Number(value)),
        );
        return [
          requiredMigrationTimestamps
            .filter((createdAt) => requestedTimestamps.has(createdAt))
            .map((createdAt) => ({ createdAt })),
          [],
        ];
      }

      if (sql.includes("FROM `__drizzle_migrations`")) {
        return [
          [
            {
              createdAt: LEGACY_CONFIG_JSON_MIGRATION_TIMESTAMP,
            },
          ],
          [],
        ];
      }

      throw new Error(`Unexpected query: ${sql}`);
    }),
    end: vi.fn().mockResolvedValue(undefined),
  };
}

describe("database migration connection readiness", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.DATABASE_URL = "mysql://migration:test@database/nexus_form";
    moduleMocks.createPool.mockReset();
    moduleMocks.drizzle.mockReset();
    moduleMocks.migrate.mockReset();
    moduleMocks.drizzle.mockImplementation((pool) => ({ pool }));
    moduleMocks.migrate.mockResolvedValue(undefined);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    delete process.env.DATABASE_URL;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("recovers from a transient preflight disconnect with a fresh client", async () => {
    const transientFailure = createRejectedPreflightPool(
      connectionError("ECONNRESET"),
    );
    const readyPool = createSuccessfulMigrationPool();
    moduleMocks.createPool
      .mockReturnValueOnce(transientFailure)
      .mockReturnValueOnce(readyPool);

    const assertion = expect(
      runMigrations({ migrationsFolder: "/migration/drizzle" }),
    ).resolves.toBeUndefined();
    await vi.runAllTimersAsync();
    await assertion;

    expect(moduleMocks.createPool).toHaveBeenCalledTimes(2);
    expect(transientFailure.end).toHaveBeenCalledTimes(1);
    expect(readyPool.end).toHaveBeenCalledTimes(1);
    expect(moduleMocks.migrate).toHaveBeenCalledTimes(1);
  });

  it("preserves timestamp normalization before entering the migrator", async () => {
    const events: string[] = [];
    const readyPool = createNormalizationMigrationPool(events);
    moduleMocks.createPool.mockReturnValueOnce(readyPool);
    moduleMocks.migrate.mockImplementationOnce(async () => {
      events.push("migrate");
    });

    await expect(runMigrations()).resolves.toBeUndefined();

    expect(events).toEqual(["normalize-update", "migrate"]);
    expect(readyPool.end).toHaveBeenCalledTimes(1);
  });

  it("never retries a transient timestamp normalization update failure", async () => {
    const updateError = connectionError("PROTOCOL_CONNECTION_LOST");
    const readyPool = createNormalizationMigrationPool([], updateError);
    moduleMocks.createPool.mockReturnValueOnce(readyPool);

    await expect(runMigrations()).rejects.toBe(updateError);

    expect(moduleMocks.createPool).toHaveBeenCalledTimes(1);
    expect(moduleMocks.migrate).not.toHaveBeenCalled();
    expect(readyPool.end).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    "PROTOCOL_CONNECTION_LOST",
    "ECONNRESET",
    "ETIMEDOUT",
  ])("exhausts bounded retries for transient %s failures", async (code) => {
    const error = connectionError(code);
    const failedPools = Array.from({ length: 3 }, () =>
      createRejectedPreflightPool(error),
    );
    for (const pool of failedPools) {
      moduleMocks.createPool.mockReturnValueOnce(pool);
    }

    const assertion = expect(runMigrations()).rejects.toBe(error);
    await vi.runAllTimersAsync();
    await assertion;

    expect(moduleMocks.createPool).toHaveBeenCalledTimes(3);
    for (const pool of failedPools) {
      expect(pool.end).toHaveBeenCalledTimes(1);
    }
    expect(moduleMocks.migrate).not.toHaveBeenCalled();
  });

  it.each([
    ["authentication", connectionError("ER_ACCESS_DENIED_ERROR")],
    ["permission", connectionError("ER_DBACCESS_DENIED_ERROR")],
    ["SQL", connectionError("ER_PARSE_ERROR")],
    ["unknown", new Error("unknown preflight failure")],
  ])("fails fast for %s preflight errors", async (_label, error) => {
    const failedPool = createRejectedPreflightPool(error);
    moduleMocks.createPool.mockReturnValueOnce(failedPool);

    await expect(runMigrations()).rejects.toBe(error);

    expect(moduleMocks.createPool).toHaveBeenCalledTimes(1);
    expect(failedPool.end).toHaveBeenCalledTimes(1);
    expect(moduleMocks.migrate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("fails closed without retry when a failed preflight client cannot be closed", async () => {
    const queryError = connectionError("ECONNRESET");
    const cleanupError = new Error("pool cleanup failed");
    const failedPool = createRejectedPreflightPool(queryError);
    failedPool.end.mockRejectedValueOnce(cleanupError);
    moduleMocks.createPool.mockReturnValueOnce(failedPool);

    const failure = runMigrations().catch((error: unknown) => error);
    await expect(failure).resolves.toEqual(
      expect.objectContaining({
        name: "AggregateError",
        cause: queryError,
        errors: [queryError, cleanupError],
      }),
    );

    expect(moduleMocks.createPool).toHaveBeenCalledTimes(1);
    expect(failedPool.end).toHaveBeenCalledTimes(1);
    expect(moduleMocks.migrate).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never retries after entering the Drizzle migrator", async () => {
    const readyPool = createSuccessfulMigrationPool();
    const migratorError = connectionError("ECONNRESET");
    moduleMocks.createPool.mockReturnValueOnce(readyPool);
    moduleMocks.migrate.mockRejectedValueOnce(migratorError);

    await expect(runMigrations()).rejects.toBe(migratorError);

    expect(moduleMocks.createPool).toHaveBeenCalledTimes(1);
    expect(moduleMocks.migrate).toHaveBeenCalledTimes(1);
    expect(readyPool.end).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("never retries transient post-migration verification failures", async () => {
    const verificationError = connectionError("PROTOCOL_CONNECTION_LOST");
    const readyPool = createPostMigrationRejectedPool(verificationError);
    moduleMocks.createPool.mockReturnValueOnce(readyPool);

    await expect(runMigrations()).rejects.toBe(verificationError);

    expect(moduleMocks.createPool).toHaveBeenCalledTimes(1);
    expect(moduleMocks.migrate).toHaveBeenCalledTimes(1);
    expect(readyPool.end).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
});
