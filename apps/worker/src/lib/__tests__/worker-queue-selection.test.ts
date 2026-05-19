import { describe, expect, it } from "vitest";
import {
  GOOGLE_SHEETS_SYNC_QUEUE,
  selectWorkerQueues,
  validateWorkerQueuesEnv,
} from "../worker-queue-selection";

const providers = ["discord", "github", "twitter"];

describe("selectWorkerQueues", () => {
  it("selects all validation queues and sheets sync when WORKER_QUEUES is unset", () => {
    expect(selectWorkerQueues(providers, undefined)).toEqual({
      validationQueues: [
        "discord-validation",
        "github-validation",
        "twitter-validation",
      ],
      includeSheetsSync: true,
      unknownQueues: [],
    });
  });

  it("selects only requested queues", () => {
    expect(
      selectWorkerQueues(
        providers,
        `github-validation, ${GOOGLE_SHEETS_SYNC_QUEUE}`,
      ),
    ).toEqual({
      validationQueues: ["github-validation"],
      includeSheetsSync: true,
      unknownQueues: [],
    });
  });

  it("reports unknown queue names", () => {
    expect(selectWorkerQueues(providers, "discord-validation,missing")).toEqual(
      {
        validationQueues: ["discord-validation"],
        includeSheetsSync: false,
        unknownQueues: ["missing"],
      },
    );
  });

  describe("validateWorkerQueuesEnv", () => {
    it("allows unset and non-empty values", () => {
      expect(() => validateWorkerQueuesEnv(undefined)).not.toThrow();
      expect(() => validateWorkerQueuesEnv("discord-validation")).not.toThrow();
    });

    it.each(["", " , "])("rejects explicit empty values: %j", (value) => {
      expect(() => validateWorkerQueuesEnv(value)).toThrow(
        "WORKER_QUEUES did not select any available worker queues",
      );
    });
  });

  it.each([
    "",
    " , ",
  ])("treats %j as an explicit empty queue selection", (workerQueuesEnv) => {
    expect(selectWorkerQueues(providers, workerQueuesEnv)).toEqual({
      validationQueues: [],
      includeSheetsSync: false,
      unknownQueues: [],
    });
  });
});
