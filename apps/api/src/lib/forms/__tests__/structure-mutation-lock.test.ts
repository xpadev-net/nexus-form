import { describe, expect, it } from "vitest";
import { withFormStructureMutationLock } from "../structure-mutation-lock";

function createDeferred() {
  let resolve: () => void = () => {};
  const promise = new Promise<void>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function waitForMicrotasks() {
  await Promise.resolve();
  await Promise.resolve();
}

describe("withFormStructureMutationLock", () => {
  it("serializes concurrent structure mutations for the same form", async () => {
    const firstCanFinish = createDeferred();
    const events: string[] = [];

    const first = withFormStructureMutationLock("form-1", async () => {
      events.push("first:start");
      await firstCanFinish.promise;
      events.push("first:end");
      return "first";
    });

    await waitForMicrotasks();

    const second = withFormStructureMutationLock("form-1", async () => {
      events.push("second:start");
      return "second";
    });

    await waitForMicrotasks();
    expect(events).toEqual(["first:start"]);

    firstCanFinish.resolve();

    await expect(first).resolves.toBe("first");
    await expect(second).resolves.toBe("second");
    expect(events).toEqual(["first:start", "first:end", "second:start"]);
  });

  it("does not block mutations for different forms", async () => {
    const firstCanFinish = createDeferred();
    const events: string[] = [];

    const first = withFormStructureMutationLock("form-1", async () => {
      events.push("first:start");
      await firstCanFinish.promise;
      events.push("first:end");
    });

    await waitForMicrotasks();

    const second = withFormStructureMutationLock("form-2", async () => {
      events.push("second:start");
    });

    await second;
    expect(events).toEqual(["first:start", "second:start"]);

    firstCanFinish.resolve();
    await first;
    expect(events).toEqual(["first:start", "second:start", "first:end"]);
  });
});
