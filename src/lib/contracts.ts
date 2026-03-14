import type { Difficulty, ReasoningMode } from "@/lib/models";

export type ProblemRecord = {
  id: number;
  datasetId: string;
  index: number;
  difficulty: Difficulty;
  equation1: string;
  equation2: string;
  expectedAnswer: boolean;
};

export type CheatsheetRecord = {
  id: number;
  name: string;
  content: string;
  createdAt: string;
  updatedAt: string;
};

export type RunBatchSummary = {
  id: number;
  modelId: string;
  modelLabel: string;
  reasoningMode: ReasoningMode;
  cheatsheetId: number | null;
  cheatsheetName: string | null;
  status: "queued" | "running" | "completed" | "failed";
  startedAt: string;
  finishedAt: string | null;
  totalCount: number;
  completedCount: number;
  correctCount: number;
  accuracy: number | null;
  difficulties: Difficulty[];
};

export type RunItemDetail = {
  id: number;
  problem: ProblemRecord;
  expectedAnswer: boolean;
  parsedVerdict: "TRUE" | "FALSE" | null;
  isCorrect: boolean | null;
  rawResponse: string | null;
  renderedPrompt: string;
  durationMs: number | null;
  promptTokens: number | null;
  completionTokens: number | null;
  reasoningTokens: number | null;
  estimatedCostUsd: number | null;
  error: string | null;
  status: "completed" | "failed";
};

export type RunBatchDetail = RunBatchSummary & {
  items: RunItemDetail[];
};
