import "./load-env";
import { handleGsDiffSync } from "./handlers/gs-diff-sync";
import { handleSheetsSync } from "./handlers/sheets-sync";
import { createWorker } from "./lib/worker-factory";

const syncWorker = createWorker("google-sheets-sync", handleSheetsSync);
const diffWorker = createWorker("google-sheets-diff-sync", handleGsDiffSync);

console.log(`Workers started: ${syncWorker.name}, ${diffWorker.name}`);
