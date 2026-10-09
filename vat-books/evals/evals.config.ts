import { defineEvalConfig } from "@cursor/bdk/evals";

export default defineEvalConfig({
  maxConcurrency: 20,
  timeoutMs: 180_000,
});
