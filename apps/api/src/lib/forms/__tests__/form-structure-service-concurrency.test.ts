import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  transaction: vi.fn(),
}));

const schemaMocks = vi.hoisted(() => ({
  form: {
    id: { name: "Form.id" },
  },
  formStructure: {
    id: { name: "FormStructure.id" },
    formId: { name: "FormStructure.formId" },
    structureJson: { name: "FormStructure.structureJson" },
    version: { name: "FormStructure.version" },
    createdBy: { name: "FormStructure.createdBy" },
    createdAt: { name: "FormStructure.createdAt" },
    isActive: { name: "FormStructure.isActive" },
    activeFormId: { name: "FormStructure.activeFormId" },
    changeLog: { name: "FormStructure.changeLog" },
    parentVersion: { name: "FormStructure.parentVersion" },
  },
}));

const drizzleMocks = vi.hoisted(() => ({
  and: (...conditions: unknown[]) => ({ kind: "and", conditions }),
  asc: (column: unknown) => ({ kind: "asc", column }),
  count: () => ({ kind: "count" }),
  desc: (column: unknown) => ({ kind: "desc", column }),
  eq: (left: unknown, right: unknown) => ({ kind: "eq", left, right }),
}));

vi.mock("@nexus-form/database", () => ({
  db: {
    transaction: mocks.transaction,
  },
}));

vi.mock("@nexus-form/database/schema", () => schemaMocks);
vi.mock("drizzle-orm", () => drizzleMocks);

import {
  restoreFormStructure,
  saveFormStructure,
} from "../form-structure-service";

type StructureRow = {
  id: string;
  formId: string;
  structureJson: string;
  version: number;
  createdBy: string | null;
  createdAt: Date;
  isActive: boolean;
  activeFormId: string | null;
  changeLog: string | null;
  parentVersion: number | null;
};

type QueryBuilder = {
  from: (table: unknown) => QueryBuilder;
  where: (condition: unknown) => QueryBuilder;
  orderBy: (...columns: unknown[]) => QueryBuilder;
  for: (mode: "update") => QueryBuilder;
  limit: (count: number) => Promise<unknown[]>;
};

type MutationWhereBuilder = {
  where: (condition: unknown) => Promise<void>;
};

type UpdateBuilder = {
  set: (values: Partial<StructureRow>) => MutationWhereBuilder;
};

type InsertBuilder = {
  values: (values: {
    id: string;
    formId: string;
    structureJson: string;
    version: number;
    createdBy: string | null;
    changeLog: string | null;
    parentVersion: number | null;
  }) => Promise<void>;
};

type MemoryTx = {
  select: (fields?: unknown) => QueryBuilder;
  update: (table: unknown) => UpdateBuilder;
  insert: (table: unknown) => InsertBuilder;
  hasFormLock: boolean;
  lastInsertedVersion: number | null;
};

function createDeferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function conditionHasEq(
  condition: unknown,
  left: unknown,
  right: unknown,
): boolean {
  if (!isRecord(condition)) {
    return false;
  }

  if (condition.kind === "eq") {
    return condition.left === left && condition.right === right;
  }

  if (condition.kind === "and" && Array.isArray(condition.conditions)) {
    return condition.conditions.some((child) =>
      conditionHasEq(child, left, right),
    );
  }

  return false;
}

function rowMatchesStructureCondition(
  row: StructureRow,
  condition: unknown,
): boolean {
  if (!isRecord(condition)) {
    return true;
  }

  if (condition.kind === "and" && Array.isArray(condition.conditions)) {
    return condition.conditions.every((child) =>
      rowMatchesStructureCondition(row, child),
    );
  }

  if (condition.kind !== "eq") {
    return true;
  }

  if (condition.left === schemaMocks.formStructure.formId) {
    return row.formId === condition.right;
  }
  if (condition.left === schemaMocks.formStructure.version) {
    return row.version === condition.right;
  }
  if (condition.left === schemaMocks.formStructure.isActive) {
    return row.isActive === condition.right;
  }
  if (condition.left === schemaMocks.formStructure.id) {
    return row.id === condition.right;
  }

  return true;
}

describe("saveFormStructure concurrency", () => {
  it("serializes version allocation and active switching with the Form row lock", async () => {
    const secondReachedLockedForm = createDeferred();
    const rows: StructureRow[] = [
      {
        id: "structure-1",
        formId: "form-1",
        structureJson: JSON.stringify({
          version: 1,
          settings: { allow_edit_responses: false },
        }),
        version: 1,
        createdBy: "user-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        isActive: true,
        activeFormId: "form-1",
        changeLog: "Initial",
        parentVersion: null,
      },
    ];

    let formLockHeld = false;
    const formLockQueue: Array<() => void> = [];
    let formLockCount = 0;

    async function acquireFormLock(): Promise<void> {
      if (formLockHeld) {
        secondReachedLockedForm.resolve();
        await new Promise<void>((resolve) => {
          formLockQueue.push(resolve);
        });
      }
      formLockHeld = true;
      formLockCount += 1;
    }

    function releaseFormLock(): void {
      const next = formLockQueue.shift();
      if (next) {
        next();
        return;
      }
      formLockHeld = false;
    }

    function createSelectBuilder(tx: MemoryTx): QueryBuilder {
      let selectedTable: unknown;
      let lockMode: "update" | null = null;
      let whereCondition: unknown;

      const builder: QueryBuilder = {
        from(table) {
          selectedTable = table;
          return builder;
        },
        where(condition) {
          whereCondition = condition;
          return builder;
        },
        orderBy() {
          return builder;
        },
        for(mode) {
          lockMode = mode;
          return builder;
        },
        async limit() {
          if (
            selectedTable === schemaMocks.form &&
            lockMode === "update" &&
            conditionHasEq(whereCondition, schemaMocks.form.id, "form-1")
          ) {
            await acquireFormLock();
            tx.hasFormLock = true;
            return [{ id: "form-1" }];
          }

          if (selectedTable === schemaMocks.formStructure) {
            const filtered = rows.filter((row) =>
              rowMatchesStructureCondition(row, whereCondition),
            );
            const sorted = [...filtered].sort((left, right) => {
              if (left.version !== right.version) {
                return right.version - left.version;
              }
              return right.createdAt.getTime() - left.createdAt.getTime();
            });

            if (lockMode === null && tx.lastInsertedVersion !== null) {
              return rows.filter(
                (row) => row.version === tx.lastInsertedVersion,
              );
            }

            return sorted.slice(0, 1);
          }

          return [];
        },
      };

      return builder;
    }

    function createTx(): MemoryTx {
      const tx: MemoryTx = {
        hasFormLock: false,
        lastInsertedVersion: null,
        select() {
          return createSelectBuilder(tx);
        },
        update(table) {
          return {
            set(values) {
              return {
                async where(condition) {
                  if (
                    table === schemaMocks.formStructure &&
                    values.isActive === false
                  ) {
                    for (const row of rows) {
                      if (
                        rowMatchesStructureCondition(row, condition) &&
                        row.isActive
                      ) {
                        row.isActive = false;
                        row.activeFormId = null;
                      }
                    }
                  }
                },
              };
            },
          };
        },
        insert(table) {
          return {
            async values(values) {
              if (table !== schemaMocks.formStructure) {
                return;
              }
              rows.push({
                ...values,
                activeFormId: values.formId,
                createdAt: new Date(`2026-01-01T00:00:0${values.version}.000Z`),
                isActive: true,
              });
              tx.lastInsertedVersion = values.version;

              if (values.version === 2) {
                await secondReachedLockedForm.promise;
              }
            },
          };
        },
      };

      return tx;
    }

    mocks.transaction.mockImplementation(async (callback: unknown) => {
      if (typeof callback !== "function") {
        throw new TypeError("transaction callback is required");
      }
      const tx = createTx();
      try {
        return await (callback as (transaction: MemoryTx) => Promise<unknown>)(
          tx,
        );
      } finally {
        if (tx.hasFormLock) {
          releaseFormLock();
        }
      }
    });

    const structure = {
      version: 1,
      settings: { allow_edit_responses: false },
    };
    const [first, second] = await Promise.all([
      saveFormStructure("form-1", structure, "user-1", "first"),
      saveFormStructure("form-1", structure, "user-2", "second"),
    ]);

    expect(formLockCount).toBe(2);
    expect(first.version).toBe(2);
    expect(second.version).toBe(3);
    expect(rows.map((row) => row.version)).toEqual([1, 2, 3]);
    expect(rows.find((row) => row.version === 2)?.parentVersion).toBe(1);
    expect(rows.find((row) => row.version === 3)?.parentVersion).toBe(2);
    expect(
      rows.filter((row) => row.isActive).map((row) => row.version),
    ).toEqual([3]);
    expect(rows.find((row) => row.version === 3)?.activeFormId).toBe("form-1");
  });

  it("serializes restore version allocation and active switching with the Form row lock", async () => {
    const secondReachedLockedForm = createDeferred();
    const rows: StructureRow[] = [
      {
        id: "structure-1",
        formId: "form-1",
        structureJson: JSON.stringify({
          version: 1,
          settings: { allow_edit_responses: false },
        }),
        version: 1,
        createdBy: "user-1",
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        isActive: true,
        activeFormId: "form-1",
        changeLog: "Initial",
        parentVersion: null,
      },
    ];

    let formLockHeld = false;
    const formLockQueue: Array<() => void> = [];
    let formLockCount = 0;

    async function acquireFormLock(): Promise<void> {
      if (formLockHeld) {
        secondReachedLockedForm.resolve();
        await new Promise<void>((resolve) => {
          formLockQueue.push(resolve);
        });
      }
      formLockHeld = true;
      formLockCount += 1;
    }

    function releaseFormLock(): void {
      const next = formLockQueue.shift();
      if (next) {
        next();
        return;
      }
      formLockHeld = false;
    }

    function createSelectBuilder(tx: MemoryTx): QueryBuilder {
      let selectedTable: unknown;
      let lockMode: "update" | null = null;
      let ordered = false;
      let whereCondition: unknown;

      const builder: QueryBuilder = {
        from(table) {
          selectedTable = table;
          return builder;
        },
        where(condition) {
          whereCondition = condition;
          return builder;
        },
        orderBy() {
          ordered = true;
          return builder;
        },
        for(mode) {
          lockMode = mode;
          return builder;
        },
        async limit() {
          if (
            selectedTable === schemaMocks.form &&
            lockMode === "update" &&
            conditionHasEq(whereCondition, schemaMocks.form.id, "form-1")
          ) {
            await acquireFormLock();
            tx.hasFormLock = true;
            return [{ id: "form-1" }];
          }

          if (selectedTable === schemaMocks.formStructure) {
            const filtered = rows.filter((row) =>
              rowMatchesStructureCondition(row, whereCondition),
            );
            const sorted = [...filtered].sort((left, right) => {
              if (left.version !== right.version) {
                return right.version - left.version;
              }
              return right.createdAt.getTime() - left.createdAt.getTime();
            });

            if (ordered) {
              return sorted.slice(0, 1);
            }

            if (tx.lastInsertedVersion !== null) {
              return rows.filter(
                (row) => row.version === tx.lastInsertedVersion,
              );
            }

            return rows.filter((row) => row.version === 1);
          }

          return [];
        },
      };

      return builder;
    }

    function createTx(): MemoryTx {
      const tx: MemoryTx = {
        hasFormLock: false,
        lastInsertedVersion: null,
        select() {
          return createSelectBuilder(tx);
        },
        update(table) {
          return {
            set(values) {
              return {
                async where(condition) {
                  if (
                    table === schemaMocks.formStructure &&
                    values.isActive === false
                  ) {
                    for (const row of rows) {
                      if (
                        rowMatchesStructureCondition(row, condition) &&
                        row.isActive
                      ) {
                        row.isActive = false;
                        row.activeFormId = null;
                      }
                    }
                  }
                },
              };
            },
          };
        },
        insert(table) {
          return {
            async values(values) {
              if (table !== schemaMocks.formStructure) {
                return;
              }
              rows.push({
                ...values,
                activeFormId: values.formId,
                createdAt: new Date(`2026-01-01T00:00:0${values.version}.000Z`),
                isActive: true,
              });
              tx.lastInsertedVersion = values.version;

              if (values.version === 2) {
                await secondReachedLockedForm.promise;
              }
            },
          };
        },
      };

      return tx;
    }

    mocks.transaction.mockImplementation(async (callback: unknown) => {
      if (typeof callback !== "function") {
        throw new TypeError("transaction callback is required");
      }
      const tx = createTx();
      try {
        return await (callback as (transaction: MemoryTx) => Promise<unknown>)(
          tx,
        );
      } finally {
        if (tx.hasFormLock) {
          releaseFormLock();
        }
      }
    });

    const [first, second] = await Promise.all([
      restoreFormStructure("form-1", 1, "user-1", "first restore"),
      restoreFormStructure("form-1", 1, "user-2", "second restore"),
    ]);

    expect(formLockCount).toBe(2);
    expect(first.version).toBe(2);
    expect(second.version).toBe(3);
    expect(rows.map((row) => row.version)).toEqual([1, 2, 3]);
    expect(rows.find((row) => row.version === 2)?.parentVersion).toBe(1);
    expect(rows.find((row) => row.version === 3)?.parentVersion).toBe(1);
    expect(
      rows.filter((row) => row.isActive).map((row) => row.version),
    ).toEqual([3]);
    expect(rows.find((row) => row.version === 3)?.activeFormId).toBe("form-1");
  });
});
