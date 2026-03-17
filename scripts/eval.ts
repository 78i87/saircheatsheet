import fs from "node:fs/promises";

import {
  formatEvalCliHelp,
  formatModelList,
  getModelDisplayName,
  parseEvalCliArgs,
} from "@/lib/eval-cli";
import { getRunBatch, listProblemsByIndexes, requestStopRunBatch, runBatchForeground } from "@/lib/store";
import { normalizeReasoningMode } from "@/lib/models";

function loadEnvFile(filePath: string) {
  try {
    process.loadEnvFile(filePath);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error ? error.code : undefined;

    if (code !== "ENOENT") {
      throw error;
    }
  }
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "--";
  }

  return `${Math.round(value * 100)}%`;
}

function formatCurrency(value: number | null) {
  if (value === null) {
    return "--";
  }

  return `$${value.toFixed(4)}`;
}

function formatDuration(startedAt: string, finishedAt: string | null) {
  const end = finishedAt ? Date.parse(finishedAt) : Date.now();
  const start = Date.parse(startedAt);
  const durationMs = Number.isNaN(start) ? 0 : Math.max(end - start, 0);
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function wasBatchStopped(batch: {
  stopRequestedAt: string | null;
  finishedAt: string | null;
  completedCount: number;
  totalCount: number;
}) {
  return (
    batch.stopRequestedAt !== null &&
    batch.finishedAt !== null &&
    batch.completedCount < batch.totalCount
  );
}

function getBatchOutcome(batch: {
  status: string;
  stopRequestedAt: string | null;
  finishedAt: string | null;
  completedCount: number;
  totalCount: number;
}) {
  return wasBatchStopped(batch) ? "stopped" : batch.status;
}

async function main(argv: string[]) {
  loadEnvFile(".env");
  loadEnvFile(".env.local");

  const command = parseEvalCliArgs(argv);

  if (command.kind === "help") {
    console.log(formatEvalCliHelp());
    return 0;
  }

  if (command.kind === "list-models") {
    console.log(formatModelList());
    return 0;
  }

  const problems = await listProblemsByIndexes({
    difficulty: command.difficulty,
    indexes: command.problemIndexes,
  });
  const problemByIndex = new Map(problems.map((problem) => [problem.index, problem]));
  const missingIndexes = command.problemIndexes.filter((index) => !problemByIndex.has(index));

  if (missingIndexes.length > 0) {
    throw new Error(
      `Unknown ${command.difficulty} problem indexes: ${missingIndexes.join(", ")}.`,
    );
  }

  const cheatsheetContent = command.cheatsheetPath
    ? await fs.readFile(command.cheatsheetPath, "utf8")
    : null;
  const resolvedReasoningMode = normalizeReasoningMode(
    command.modelId,
    command.reasoningMode,
  );
  let batchId: number | null = null;
  let stopRequested = false;
  let stopHandlersRegistered = false;

  const requestStop = () => {
    if (stopRequested || batchId === null) {
      return;
    }

    stopRequested = true;
    console.error("\nStop requested. Waiting for the current batch to finish cleanly...");
    void requestStopRunBatch(batchId);
  };

  const registerStopHandlers = () => {
    if (stopHandlersRegistered) {
      return;
    }

    stopHandlersRegistered = true;
    process.once("SIGINT", requestStop);
    process.once("SIGTERM", requestStop);
  };

  try {
    if (resolvedReasoningMode !== command.reasoningMode) {
      console.log(
        `Reasoning mode "${command.reasoningMode}" is not supported for ${command.modelId}; using "default".`,
      );
    }

    batchId = await runBatchForeground(
      {
        problemIds: problems.map((problem) => problem.id),
        modelId: command.modelId,
        reasoningMode: command.reasoningMode,
        cheatsheetId: null,
        cheatsheetContent,
      },
      {
        onBatchCreated(createdBatchId) {
          batchId = createdBatchId;
          registerStopHandlers();
          console.log(
            [
              `Batch ${createdBatchId} started`,
              `model=${command.modelId}`,
              `label="${getModelDisplayName(command.modelId)}"`,
              `difficulty=${command.difficulty}`,
              `problems=${problems.length}`,
              `reasoning=${resolvedReasoningMode}`,
            ].join(" | "),
          );
        },
        onProgress(event) {
          const suffix =
            event.status === "failed" && event.error
              ? ` failed (${event.error})`
              : event.isCorrect === true
                ? " correct"
                : event.isCorrect === false
                  ? " incorrect"
                  : ` ${event.status}`;

          console.log(
            `[${event.completedCount}/${event.totalCount}] ${command.difficulty} #${event.problemIndex}${suffix}`,
          );
        },
      },
    );
  } finally {
    if (stopHandlersRegistered) {
      process.removeListener("SIGINT", requestStop);
      process.removeListener("SIGTERM", requestStop);
    }
  }

  if (batchId === null) {
    throw new Error("Batch was not created.");
  }

  const batch = await getRunBatch(batchId);
  if (!batch) {
    throw new Error(`Run batch ${batchId} was not found after execution.`);
  }

  const outcome = getBatchOutcome(batch);
  console.log("");
  console.log(`Batch ${batchId} ${outcome}.`);
  console.log(
    `Completed ${batch.completedCount}/${batch.totalCount} | Correct ${batch.correctCount} | Accuracy ${formatPercent(batch.accuracy)}`,
  );
  console.log(
    `Duration ${formatDuration(batch.startedAt, batch.finishedAt)} | Estimated cost ${formatCurrency(batch.items.reduce((sum, item) => sum + (item.estimatedCostUsd ?? 0), 0))}`,
  );

  return outcome === "completed" ? 0 : 1;
}

main(process.argv.slice(2))
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Unknown CLI error.";
    console.error(message);
    process.exitCode = 1;
  });
