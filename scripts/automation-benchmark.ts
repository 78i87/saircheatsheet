import fs from "node:fs/promises";
import path from "node:path";

import {
  automationConfigSchema,
  buildBatchSnapshot,
  compareBatchSnapshots,
  renderBenchmarkReportMarkdown,
} from "@/lib/automation";
import { getRunBatch, listProblemsByIndexes, runBatchForeground } from "@/lib/store";
import { getAutomationProblemIndexes } from "@/lib/automation";

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

function parseArgs(argv: string[]) {
  let promptPath: string | null = null;
  let outputDir: string | null = null;
  let label: string | null = null;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];

    if (arg === "--prompt" && value) {
      promptPath = value;
      index += 1;
      continue;
    }

    if (arg === "--out" && value) {
      outputDir = value;
      index += 1;
      continue;
    }

    if (arg === "--label" && value) {
      label = value;
      index += 1;
      continue;
    }

    throw new Error(`Unknown or incomplete argument: ${arg}`);
  }

  if (!promptPath) {
    throw new Error("Missing required flag --prompt <path>.");
  }

  return {
    promptPath,
    outputDir,
    label,
  };
}

async function loadConfig(configPath: string) {
  const raw = await fs.readFile(configPath, "utf8");
  return automationConfigSchema.parse(JSON.parse(raw));
}

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeOutput(outputDir: string, fileName: string, content: string) {
  await ensureDir(outputDir);
  await fs.writeFile(path.join(outputDir, fileName), content, "utf8");
}

async function main(argv: string[]) {
  loadEnvFile(".env");
  loadEnvFile(".env.local");

  const args = parseArgs(argv);
  const automationRoot = path.join(process.cwd(), "automation");
  const config = await loadConfig(path.join(automationRoot, "config.json"));
  const promptPath = path.resolve(args.promptPath);
  const promptContent = await fs.readFile(promptPath, "utf8");
  const problemIndexes = getAutomationProblemIndexes(config);
  const problems = await listProblemsByIndexes({
    difficulty: config.benchmark.difficulty,
    indexes: problemIndexes,
  });

  if (problems.length !== problemIndexes.length) {
    throw new Error(
      `Configured benchmark selection ${config.benchmark.problemSelection} did not fully resolve.`,
    );
  }

  const baselineBatch = await getRunBatch(config.baselineBatchId);
  if (!baselineBatch) {
    throw new Error(`Baseline batch ${config.baselineBatchId} was not found.`);
  }

  const batchId = await runBatchForeground({
    problemIds: problems.map((problem) => problem.id),
    modelId: config.benchmark.modelId,
    reasoningMode: config.benchmark.reasoningMode,
    cheatsheetId: null,
    cheatsheetContent: promptContent,
  });

  const candidateBatch = await getRunBatch(batchId);
  if (!candidateBatch) {
    throw new Error(`Batch ${batchId} was not found after benchmark execution.`);
  }

  const baselineSnapshot = buildBatchSnapshot(baselineBatch);
  const candidateSnapshot = buildBatchSnapshot(candidateBatch);
  const comparison = compareBatchSnapshots(baselineSnapshot, candidateSnapshot);
  const promoted =
    comparison.deltaCorrect >= config.survivorMinNetGainVsBaseline;
  const label =
    args.label ??
    path.basename(args.outputDir ?? path.dirname(promptPath)) ??
    `batch-${candidateSnapshot.batchId}`;
  const resultsPayload = {
    label,
    promptPath: path.relative(process.cwd(), promptPath),
    batchId: candidateSnapshot.batchId,
    correctCount: candidateSnapshot.correctCount,
    totalCount: candidateSnapshot.totalCount,
    wrongCount: candidateSnapshot.wrongCount,
    deltaCorrectVsBaseline: comparison.deltaCorrect,
    baselineBatchId: config.baselineBatchId,
    fixedProblemIndexes: comparison.fixedProblemIndexes,
    regressedProblemIndexes: comparison.regressedProblemIndexes,
    stillWrongProblemIndexes: comparison.stillWrongProblemIndexes,
    promoted,
    wrongProblemIndexes: candidateSnapshot.wrongProblemIndexes,
  };

  if (args.outputDir) {
    const outputDir = path.resolve(args.outputDir);
    await writeOutput(outputDir, "results.json", `${JSON.stringify(resultsPayload, null, 2)}\n`);
    await writeOutput(
      outputDir,
      "results.md",
      `${renderBenchmarkReportMarkdown({
        label,
        promptPath: path.relative(process.cwd(), promptPath),
        baseline: baselineSnapshot,
        candidate: candidateSnapshot,
        comparison,
        survivorMinNetGainVsBaseline: config.survivorMinNetGainVsBaseline,
      })}\n`,
    );
  }

  console.log(JSON.stringify(resultsPayload, null, 2));
}

main(process.argv.slice(2)).catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown automation benchmark error.";
  console.error(message);
  process.exitCode = 1;
});
