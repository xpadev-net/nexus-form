import { describe, expect, it } from "vitest";
import {
  GOOGLE_SHEETS_SYNC_QUEUE,
  selectWorkerQueues,
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
