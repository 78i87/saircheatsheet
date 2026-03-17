import { z } from "zod";

import type { RunBatchDetail } from "@/lib/contracts";
import type { Difficulty, ReasoningMode } from "@/lib/models";
import { parseProblemRange } from "@/lib/problem-selection";

export const automationConfigSchema = z.object({
  baselineBatchId: z.number().int().positive(),
  benchmark: z.object({
    modelId: z.string().min(1),
    difficulty: z.enum(["normal", "hard"]),
    problemSelection: z.string().min(1),
    reasoningMode: z.enum(["default", "low"]),
  }),
  candidateCountPerIteration: z.number().int().positive(),
  survivorMinNetGainVsBaseline: z.number().int().min(1),
  survivorStrategy: z.literal("keep_all"),
  promptFileName: z.string().min(1),
});

export type AutomationConfig = z.infer<typeof automationConfigSchema>;

export const DEFAULT_AUTOMATION_CONFIG: AutomationConfig = {
  baselineBatchId: 40,
  benchmark: {
    modelId: "openai/gpt-oss-120b",
    difficulty: "normal",
    problemSelection: "1-100",
    reasoningMode: "low",
  },
  candidateCountPerIteration: 5,
  survivorMinNetGainVsBaseline: 2,
  survivorStrategy: "keep_all",
  promptFileName: "prompt.txt",
};

export type WrongItemSnapshot = {
  problemIndex: number;
  datasetId: string;
  equation1: string;
  equation2: string;
  expectedAnswer: boolean;
  parsedVerdict: "TRUE" | "FALSE" | null;
  error: string | null;
  rawReasoning: string | null;
  rawResponse: string | null;
};

export type BatchSnapshot = {
  batchId: number;
  modelId: string;
  modelLabel: string;
  reasoningMode: ReasoningMode;
  cheatsheetId: number | null;
  cheatsheetName: string | null;
  difficulty: Difficulty | null;
  totalCount: number;
  completedCount: number;
  correctCount: number;
  wrongCount: number;
  accuracy: number | null;
  problemIndexes: number[];
  wrongProblemIndexes: number[];
  wrongItems: WrongItemSnapshot[];
};

export type BatchComparison = {
  baselineBatchId: number;
  candidateBatchId: number;
  baselineCorrectCount: number;
  candidateCorrectCount: number;
  deltaCorrect: number;
  fixedProblemIndexes: number[];
  regressedProblemIndexes: number[];
  stillWrongProblemIndexes: number[];
};

function sortNumbers(values: number[]) {
  return [...values].sort((left, right) => left - right);
}

function formatPercent(value: number | null) {
  if (value === null) {
    return "--";
  }

  return `${(value * 100).toFixed(1)}%`;
}

function formatVerdict(value: boolean) {
  return value ? "TRUE" : "FALSE";
}

function formatSectionList(indexes: number[]) {
  return indexes.length > 0 ? indexes.join(", ") : "none";
}

function toWrongItemSnapshot(
  item: RunBatchDetail["items"][number],
): WrongItemSnapshot | null {
  if (item.isCorrect !== false) {
    return null;
  }

  return {
    problemIndex: item.problem.index,
    datasetId: item.problem.datasetId,
    equation1: item.problem.equation1,
    equation2: item.problem.equation2,
    expectedAnswer: item.expectedAnswer,
    parsedVerdict: item.parsedVerdict,
    error: item.error,
    rawReasoning: item.rawReasoning,
    rawResponse: item.rawResponse,
  };
}

export function getAutomationProblemIndexes(config: AutomationConfig) {
  return parseProblemRange(config.benchmark.problemSelection);
}

export function buildBatchSnapshot(batch: RunBatchDetail): BatchSnapshot {
  const sortedItems = [...batch.items].sort(
    (left, right) => left.problem.index - right.problem.index,
  );
  const wrongItems = sortedItems
    .map((item) => toWrongItemSnapshot(item))
    .filter((item): item is WrongItemSnapshot => item !== null);
  const problemIndexes = sortedItems.map((item) => item.problem.index);
  const wrongProblemIndexes = wrongItems.map((item) => item.problemIndex);

  return {
    batchId: batch.id,
    modelId: batch.modelId,
    modelLabel: batch.modelLabel,
    reasoningMode: batch.reasoningMode,
    cheatsheetId: batch.cheatsheetId,
    cheatsheetName: batch.cheatsheetName,
    difficulty: batch.difficulties[0] ?? null,
    totalCount: batch.totalCount,
    completedCount: batch.completedCount,
    correctCount: batch.correctCount,
    wrongCount: wrongItems.length,
    accuracy: batch.accuracy,
    problemIndexes,
    wrongProblemIndexes,
    wrongItems,
  };
}

export function compareBatchSnapshots(
  baseline: BatchSnapshot,
  candidate: BatchSnapshot,
): BatchComparison {
  const baselineWrong = new Set(baseline.wrongProblemIndexes);
  const candidateWrong = new Set(candidate.wrongProblemIndexes);
  const fixedProblemIndexes = sortNumbers(
    baseline.wrongProblemIndexes.filter((index) => !candidateWrong.has(index)),
  );
  const regressedProblemIndexes = sortNumbers(
    candidate.wrongProblemIndexes.filter((index) => !baselineWrong.has(index)),
  );
  const stillWrongProblemIndexes = sortNumbers(
    candidate.wrongProblemIndexes.filter((index) => baselineWrong.has(index)),
  );

  return {
    baselineBatchId: baseline.batchId,
    candidateBatchId: candidate.batchId,
    baselineCorrectCount: baseline.correctCount,
    candidateCorrectCount: candidate.correctCount,
    deltaCorrect: candidate.correctCount - baseline.correctCount,
    fixedProblemIndexes,
    regressedProblemIndexes,
    stillWrongProblemIndexes,
  };
}

export function validateBaselineBatch(
  config: AutomationConfig,
  snapshot: BatchSnapshot,
) {
  const expectedIndexes = getAutomationProblemIndexes(config);

  if (snapshot.modelId !== config.benchmark.modelId) {
    throw new Error(
      `Baseline batch ${snapshot.batchId} uses ${snapshot.modelId}, expected ${config.benchmark.modelId}.`,
    );
  }

  if (snapshot.reasoningMode !== config.benchmark.reasoningMode) {
    throw new Error(
      `Baseline batch ${snapshot.batchId} uses reasoning=${snapshot.reasoningMode}, expected ${config.benchmark.reasoningMode}.`,
    );
  }

  if (snapshot.difficulty !== config.benchmark.difficulty) {
    throw new Error(
      `Baseline batch ${snapshot.batchId} uses difficulty=${snapshot.difficulty}, expected ${config.benchmark.difficulty}.`,
    );
  }

  const actualIndexes = snapshot.problemIndexes.join(",");
  const configuredIndexes = expectedIndexes.join(",");
  if (actualIndexes !== configuredIndexes) {
    throw new Error(
      `Baseline batch ${snapshot.batchId} does not match configured problem selection ${config.benchmark.problemSelection}.`,
    );
  }
}

export function renderBatchSnapshotMarkdown(
  config: AutomationConfig,
  snapshot: BatchSnapshot,
) {
  const wrongSections = snapshot.wrongItems
    .map((item) => {
      const trace = item.rawReasoning?.trim() || item.rawResponse?.trim() || "(empty)";
      return [
        `### Problem ${item.problemIndex}`,
        `- Expected: ${formatVerdict(item.expectedAnswer)}`,
        `- Predicted: ${item.parsedVerdict ?? "unparsed"}`,
        `- Dataset ID: \`${item.datasetId}\``,
        `- Equation 1: \`${item.equation1}\``,
        `- Equation 2: \`${item.equation2}\``,
        item.error ? `- Error: ${item.error}` : null,
        "",
        "#### Reasoning Trace",
        "```text",
        trace,
        "```",
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return [
    `# Batch ${snapshot.batchId} Baseline`,
    "",
    `Batch ${config.baselineBatchId} is the permanent baseline for the automation loop.`,
    "",
    "## Benchmark",
    "",
    `- Model: \`${snapshot.modelId}\` (${snapshot.modelLabel})`,
    `- Reasoning: \`${snapshot.reasoningMode}\``,
    `- Cheatsheet: ${snapshot.cheatsheetId === null ? "none (empty baseline prompt)" : `#${snapshot.cheatsheetId} ${snapshot.cheatsheetName ?? ""}`.trim()}`,
    `- Difficulty: \`${snapshot.difficulty ?? "unknown"}\``,
    `- Problems: \`${config.benchmark.problemSelection}\``,
    "",
    "## Summary",
    "",
    `- Correct: ${snapshot.correctCount}/${snapshot.totalCount}`,
    `- Accuracy: ${formatPercent(snapshot.accuracy)}`,
    `- Wrong count: ${snapshot.wrongCount}`,
    `- Wrong indexes: ${formatSectionList(snapshot.wrongProblemIndexes)}`,
    "",
    "## Wrong Items",
    "",
    wrongSections || "No wrong items.",
    "",
  ].join("\n");
}

export function renderBenchmarkReportMarkdown(input: {
  label: string;
  promptPath: string;
  baseline: BatchSnapshot;
  candidate: BatchSnapshot;
  comparison: BatchComparison;
  survivorMinNetGainVsBaseline: number;
}) {
  const { label, promptPath, baseline, candidate, comparison, survivorMinNetGainVsBaseline } =
    input;
  const promoted = comparison.deltaCorrect >= survivorMinNetGainVsBaseline;

  return [
    `# ${label}`,
    "",
    `Prompt file: \`${promptPath}\``,
    "",
    "## Result",
    "",
    `- Batch ID: ${candidate.batchId}`,
    `- Correct: ${candidate.correctCount}/${candidate.totalCount}`,
    `- Accuracy: ${formatPercent(candidate.accuracy)}`,
    `- Delta vs batch ${baseline.batchId}: ${comparison.deltaCorrect >= 0 ? "+" : ""}${comparison.deltaCorrect}`,
    `- Promotion threshold: +${survivorMinNetGainVsBaseline}`,
    `- Promote: ${promoted ? "yes" : "no"}`,
    "",
    "## Comparison vs Baseline",
    "",
    `- Fixed indexes: ${formatSectionList(comparison.fixedProblemIndexes)}`,
    `- Regressed indexes: ${formatSectionList(comparison.regressedProblemIndexes)}`,
    `- Still wrong: ${formatSectionList(comparison.stillWrongProblemIndexes)}`,
    "",
  ].join("\n");
}
