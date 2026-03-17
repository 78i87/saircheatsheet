import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUTOMATION_CONFIG,
  buildBatchSnapshot,
  compareBatchSnapshots,
  validateBaselineBatch,
} from "@/lib/automation";
import type { RunBatchDetail } from "@/lib/contracts";

function createBatchDetail(input: {
  batchId: number;
  correctIndexes: number[];
  wrongIndexes: number[];
}): RunBatchDetail {
  const items = [...input.correctIndexes, ...input.wrongIndexes]
    .sort((left, right) => left - right)
    .map((index) => {
      const isCorrect = input.correctIndexes.includes(index);
      return {
        id: index,
        problem: {
          id: index,
          datasetId: `p-${index}`,
          index,
          difficulty: "normal" as const,
          equation1: `eq1-${index}`,
          equation2: `eq2-${index}`,
          expectedAnswer: true,
        },
        expectedAnswer: true,
        parsedVerdict: isCorrect ? "TRUE" : "FALSE",
        isCorrect,
        rawResponse: `response-${index}`,
        rawReasoning: `reasoning-${index}`,
        renderedPrompt: `prompt-${index}`,
        durationMs: 100,
        promptTokens: 10,
        completionTokens: 20,
        reasoningTokens: 5,
        estimatedCostUsd: 0.001,
        error: null,
        status: "completed" as const,
      };
    });

  return {
    id: input.batchId,
    modelId: "openai/gpt-oss-120b",
    modelLabel: "GPT OSS 120B",
    reasoningMode: "low",
    cheatsheetId: null,
    cheatsheetName: null,
    status: "completed",
    stopRequestedAt: null,
    startedAt: "2026-03-17T00:00:00.000Z",
    finishedAt: "2026-03-17T00:01:00.000Z",
    totalCount: items.length,
    completedCount: items.length,
    correctCount: input.correctIndexes.length,
    accuracy: input.correctIndexes.length / items.length,
    difficulties: ["normal"],
    items,
  };
}

describe("compareBatchSnapshots", () => {
  it("tracks fixed, regressed, and still-wrong indexes against the baseline", () => {
    const baseline = buildBatchSnapshot(
      createBatchDetail({
        batchId: 40,
        correctIndexes: [3, 5],
        wrongIndexes: [1, 2, 4],
      }),
    );
    const candidate = buildBatchSnapshot(
      createBatchDetail({
        batchId: 41,
        correctIndexes: [1, 3, 5],
        wrongIndexes: [2, 4],
      }),
    );

    expect(compareBatchSnapshots(baseline, candidate)).toEqual({
      baselineBatchId: 40,
      candidateBatchId: 41,
      baselineCorrectCount: 2,
      candidateCorrectCount: 3,
      deltaCorrect: 1,
      fixedProblemIndexes: [1],
      regressedProblemIndexes: [],
      stillWrongProblemIndexes: [2, 4],
    });
  });
});

describe("validateBaselineBatch", () => {
  it("accepts a baseline that matches the configured benchmark", () => {
    const batch = buildBatchSnapshot(
      createBatchDetail({
        batchId: 40,
        correctIndexes: Array.from({ length: 100 }, (_, index) => index + 1),
        wrongIndexes: [],
      }),
    );

    expect(() => validateBaselineBatch(DEFAULT_AUTOMATION_CONFIG, batch)).not.toThrow();
  });

  it("rejects a baseline that does not match the configured problem selection", () => {
    const batch = buildBatchSnapshot(
      createBatchDetail({
        batchId: 40,
        correctIndexes: [1, 2, 3],
        wrongIndexes: [],
      }),
    );

    expect(() => validateBaselineBatch(DEFAULT_AUTOMATION_CONFIG, batch)).toThrow(
      /problem selection/,
    );
  });
});
