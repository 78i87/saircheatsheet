import type {
  CheatsheetRecord,
  ProblemRecord,
  RunBatchDetail,
  RunBatchStatus,
  RunBatchSummary,
  RunItemDetail,
} from "@/lib/contracts";
import { getDb, initializeDatabase } from "@/lib/db";
import { runWithConcurrency } from "@/lib/concurrency";
import {
  getModelOption,
  normalizeReasoningMode,
  type Difficulty,
  type ReasoningMode,
} from "@/lib/models";
import { executeModelRun } from "@/lib/openrouter";
import { parseModelResponse } from "@/lib/parser";
import { renderSystemPrompt } from "@/lib/prompt";

type RunBatchInput = {
  problemIds: number[];
  modelId: string;
  reasoningMode: ReasoningMode;
  cheatsheetId: number | null;
  cheatsheetContent?: string | null;
};

export type RunBatchProgressEvent = {
  batchId: number;
  totalCount: number;
  completedCount: number;
  correctCount: number;
  problemId: number;
  problemIndex: number;
  status: "completed" | "failed";
  isCorrect: boolean | null;
  error: string | null;
};

type PreparedRunBatch = {
  batchId: number;
  executionInput: Required<Pick<RunBatchInput, "cheatsheetId" | "problemIds">> &
    Pick<RunBatchInput, "cheatsheetContent"> & {
      modelId: string;
      reasoningMode: ReasoningMode;
    };
};

function mapProblem(row: {
  id: number;
  dataset_id: string;
  problem_index: number;
  difficulty: Difficulty;
  equation1: string;
  equation2: string;
  expected_answer: number;
}): ProblemRecord {
  return {
    id: row.id,
    datasetId: row.dataset_id,
    index: row.problem_index,
    difficulty: row.difficulty,
    equation1: row.equation1,
    equation2: row.equation2,
    expectedAnswer: Boolean(row.expected_answer),
  };
}

function nowIso() {
  return new Date().toISOString();
}

const batchAbortControllers = new Map<number, AbortController>();

function isAbortError(error: unknown) {
  return error instanceof Error && error.name === "AbortError";
}

async function getBatchStopRequestedAt(batchId: number) {
  await initializeDatabase();
  const db = getDb();
  const row = db
    .prepare("SELECT stop_requested_at FROM run_batches WHERE id = ?")
    .get(batchId) as { stop_requested_at: string | null } | undefined;

  return row?.stop_requested_at ?? null;
}

export async function listProblems(input: {
  difficulty?: Difficulty;
  search?: string;
}) {
  await initializeDatabase();
  const db = getDb();
  const where: string[] = [];
  const params: Record<string, string> = {};

  if (input.difficulty) {
    where.push("difficulty = @difficulty");
    params.difficulty = input.difficulty;
  }

  if (input.search?.trim()) {
    where.push(
      "(dataset_id LIKE @search OR equation1 LIKE @search OR equation2 LIKE @search)",
    );
    params.search = `%${input.search.trim()}%`;
  }

  const query = `
    SELECT *
    FROM problems
    ${where.length > 0 ? `WHERE ${where.join(" AND ")}` : ""}
    ORDER BY difficulty ASC, problem_index ASC
  `;

  const rows = db.prepare(query).all(params) as Array<{
    id: number;
    dataset_id: string;
    problem_index: number;
    difficulty: Difficulty;
    equation1: string;
    equation2: string;
    expected_answer: number;
  }>;

  return rows.map(mapProblem);
}

export async function listProblemsByIndexes(input: {
  difficulty: Difficulty;
  indexes: number[];
}) {
  await initializeDatabase();
  if (input.indexes.length === 0) {
    return [];
  }

  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT *
        FROM problems
        WHERE difficulty = ?
          AND problem_index IN (${input.indexes.map(() => "?").join(",")})
        ORDER BY problem_index ASC
      `,
    )
    .all(input.difficulty, ...input.indexes) as Array<{
    id: number;
    dataset_id: string;
    problem_index: number;
    difficulty: Difficulty;
    equation1: string;
    equation2: string;
    expected_answer: number;
  }>;

  return rows.map(mapProblem);
}

export async function listCheatsheets() {
  await initializeDatabase();
  const db = getDb();
  const rows = db
    .prepare("SELECT * FROM cheatsheets ORDER BY updated_at DESC, id DESC")
    .all() as Array<{
    id: number;
    name: string;
    content: string;
    created_at: string;
    updated_at: string;
  }>;

  return rows.map((row) => ({
      id: row.id,
      name: row.name,
      content: row.content,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    })) satisfies CheatsheetRecord[];
}

export async function createCheatsheet(input: { name: string; content: string }) {
  await initializeDatabase();
  const db = getDb();
  const timestamp = nowIso();
  const result = db
    .prepare(
      `
        INSERT INTO cheatsheets (name, content, created_at, updated_at)
        VALUES (@name, @content, @createdAt, @updatedAt)
      `,
    )
    .run({
      name: input.name.trim(),
      content: input.content,
      createdAt: timestamp,
      updatedAt: timestamp,
    });

  return getCheatsheetById(Number(result.lastInsertRowid));
}

export async function updateCheatsheet(
  id: number,
  input: { name: string; content: string },
) {
  await initializeDatabase();
  const db = getDb();
  db.prepare(
    `
      UPDATE cheatsheets
      SET name = @name, content = @content, updated_at = @updatedAt
      WHERE id = @id
    `,
  ).run({
    id,
    name: input.name.trim(),
    content: input.content,
    updatedAt: nowIso(),
  });

  return getCheatsheetById(id);
}

export async function deleteCheatsheet(id: number) {
  await initializeDatabase();
  const db = getDb();
  db.prepare("DELETE FROM cheatsheets WHERE id = ?").run(id);
}

export async function getCheatsheetById(id: number) {
  await initializeDatabase();
  const db = getDb();
  const row = db.prepare("SELECT * FROM cheatsheets WHERE id = ?").get(id) as
    | {
        id: number;
        name: string;
        content: string;
        created_at: string;
        updated_at: string;
      }
    | undefined;

  if (!row) {
    return null;
  }

  return {
    id: row.id,
    name: row.name,
    content: row.content,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } satisfies CheatsheetRecord;
}

async function createRunBatchRecord(input: RunBatchInput): Promise<PreparedRunBatch> {
  await initializeDatabase();
  if (input.problemIds.length === 0) {
    throw new Error("Run batches require at least one problem id.");
  }

  const db = getDb();
  const timestamps = {
    startedAt: nowIso(),
    createdAt: nowIso(),
  };
  const model = getModelOption(input.modelId);
  const resolvedReasoningMode = normalizeReasoningMode(
    input.modelId,
    input.reasoningMode,
  );

  const result = db
    .prepare(
      `
        INSERT INTO run_batches (
          model_id,
          model_label,
          reasoning_mode,
          cheatsheet_id,
          status,
          started_at,
          total_count,
          created_at,
          updated_at
        )
        VALUES (
          @modelId,
          @modelLabel,
          @reasoningMode,
          @cheatsheetId,
          'queued',
          @startedAt,
          @totalCount,
          @createdAt,
          @updatedAt
        )
      `,
    )
    .run({
      modelId: input.modelId,
      modelLabel: model.label,
      reasoningMode: resolvedReasoningMode,
      cheatsheetId: input.cheatsheetId,
      startedAt: timestamps.startedAt,
      totalCount: input.problemIds.length,
      createdAt: timestamps.createdAt,
      updatedAt: timestamps.createdAt,
    });

  return {
    batchId: Number(result.lastInsertRowid),
    executionInput: {
      problemIds: input.problemIds,
      modelId: input.modelId,
      reasoningMode: resolvedReasoningMode,
      cheatsheetId: input.cheatsheetId,
      cheatsheetContent: input.cheatsheetContent ?? null,
    },
  };
}

export async function createRunBatch(input: {
  problemIds: number[];
  modelId: string;
  reasoningMode: ReasoningMode;
  cheatsheetId: number | null;
}) {
  const prepared = await createRunBatchRecord(input);
  void executeRunBatch(prepared.batchId, prepared.executionInput).catch((error) => {
    console.error(`Run batch ${prepared.batchId} failed to execute.`, error);
  });
  return prepared.batchId;
}

export async function runBatchForeground(
  input: RunBatchInput,
  options?: {
    onBatchCreated?: (batchId: number) => void | Promise<void>;
    onProgress?: (event: RunBatchProgressEvent) => void;
  },
) {
  const prepared = await createRunBatchRecord(input);
  await options?.onBatchCreated?.(prepared.batchId);
  await executeRunBatch(prepared.batchId, prepared.executionInput, options?.onProgress);
  return prepared.batchId;
}

export async function listRunBatches() {
  await initializeDatabase();
  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT
          b.id,
          b.model_id,
          b.model_label,
          b.reasoning_mode,
          b.cheatsheet_id,
          c.name AS cheatsheet_name,
          b.status,
          b.stop_requested_at,
          b.started_at,
          b.finished_at,
          b.total_count,
          COALESCE(SUM(CASE WHEN i.is_correct = 1 THEN 1 ELSE 0 END), 0) AS correct_count,
          COALESCE(COUNT(i.id), 0) AS completed_count,
          GROUP_CONCAT(DISTINCT p.difficulty) AS difficulties
        FROM run_batches b
        LEFT JOIN cheatsheets c ON c.id = b.cheatsheet_id
        LEFT JOIN run_items i ON i.batch_id = b.id
        LEFT JOIN problems p ON p.id = i.problem_id
        GROUP BY b.id
        ORDER BY b.started_at DESC, b.id DESC
      `,
    )
    .all() as Array<{
    id: number;
    model_id: string;
    model_label: string;
    reasoning_mode: ReasoningMode;
    cheatsheet_id: number | null;
    cheatsheet_name: string | null;
    status: RunBatchStatus;
    stop_requested_at: string | null;
    started_at: string;
    finished_at: string | null;
    total_count: number;
    correct_count: number;
    completed_count: number;
    difficulties: string | null;
  }>;

  return rows.map((row) => ({
    id: row.id,
    modelId: row.model_id,
    modelLabel: row.model_label,
    reasoningMode: row.reasoning_mode,
    cheatsheetId: row.cheatsheet_id,
    cheatsheetName: row.cheatsheet_name,
    status: row.status,
    stopRequestedAt: row.stop_requested_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    totalCount: row.total_count,
    completedCount: row.completed_count,
    correctCount: row.correct_count,
    accuracy:
      row.completed_count > 0 ? row.correct_count / row.completed_count : null,
    difficulties: row.difficulties
      ? (row.difficulties.split(",") as Difficulty[])
      : [],
  })) satisfies RunBatchSummary[];
}

export async function requestStopRunBatch(batchId: number) {
  await initializeDatabase();
  const db = getDb();
  const timestamp = nowIso();

  const result = db
    .prepare(
      `
        UPDATE run_batches
        SET
          stop_requested_at = COALESCE(stop_requested_at, @stopRequestedAt),
          status = 'failed',
          finished_at = COALESCE(finished_at, @finishedAt),
          correct_count = (
            SELECT COALESCE(SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END), 0)
            FROM run_items
            WHERE batch_id = @id
          ),
          updated_at = @updatedAt
        WHERE id = @id
          AND status IN ('queued', 'running')
      `,
    )
    .run({
      id: batchId,
      stopRequestedAt: timestamp,
      finishedAt: timestamp,
      updatedAt: timestamp,
    });

  if (result.changes === 0) {
    return getRunBatch(batchId);
  }

  batchAbortControllers.get(batchId)?.abort();

  return getRunBatch(batchId);
}

export async function getRunBatch(batchId: number) {
  const summaries = await listRunBatches();
  const summary = summaries.find((entry) => entry.id === batchId);
  if (!summary) {
    return null;
  }

  const db = getDb();
  const rows = db
    .prepare(
      `
        SELECT
          i.*,
          p.id AS p_id,
          p.dataset_id,
          p.problem_index,
          p.difficulty,
          p.equation1,
          p.equation2,
          p.expected_answer
        FROM run_items i
        INNER JOIN problems p ON p.id = i.problem_id
        WHERE i.batch_id = ?
        ORDER BY p.problem_index ASC, i.id ASC
      `,
    )
    .all(batchId) as Array<{
    id: number;
    expected_answer: number;
    parsed_verdict: "TRUE" | "FALSE" | null;
    is_correct: number | null;
    raw_response: string | null;
    raw_reasoning: string | null;
    rendered_prompt: string;
    duration_ms: number | null;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    reasoning_tokens: number | null;
    estimated_cost_usd: number | null;
    error: string | null;
    status: "completed" | "failed";
    p_id: number;
    dataset_id: string;
    problem_index: number;
    difficulty: Difficulty;
    equation1: string;
    equation2: string;
    p_expected_answer: number;
  }>;

  const items = rows.map((row) => ({
    id: row.id,
    problem: {
      id: row.p_id,
      datasetId: row.dataset_id,
      index: row.problem_index,
      difficulty: row.difficulty,
      equation1: row.equation1,
      equation2: row.equation2,
      expectedAnswer: Boolean(row.expected_answer),
    },
    expectedAnswer: Boolean(row.expected_answer),
    parsedVerdict: row.parsed_verdict,
    isCorrect: row.is_correct === null ? null : Boolean(row.is_correct),
    rawResponse: row.raw_response,
    rawReasoning: row.raw_reasoning,
    renderedPrompt: row.rendered_prompt,
    durationMs: row.duration_ms,
    promptTokens: row.prompt_tokens,
    completionTokens: row.completion_tokens,
    reasoningTokens: row.reasoning_tokens,
    estimatedCostUsd: row.estimated_cost_usd,
    error: row.error,
    status: row.status,
  })) satisfies RunItemDetail[];

  return {
    ...summary,
    items,
  } satisfies RunBatchDetail;
}

async function executeRunBatch(
  batchId: number,
  input: PreparedRunBatch["executionInput"],
  onProgress?: (event: RunBatchProgressEvent) => void,
) {
  const db = getDb();
  const stopRequestedBeforeStart = await getBatchStopRequestedAt(batchId);
  const batchAbortController = new AbortController();
  batchAbortControllers.set(batchId, batchAbortController);

  if (stopRequestedBeforeStart) {
    batchAbortController.abort();
  }

  if (!stopRequestedBeforeStart) {
    db.prepare(
      "UPDATE run_batches SET status = 'running', updated_at = ? WHERE id = ?",
    ).run(nowIso(), batchId);
  }

  const savedCheatsheet = input.cheatsheetId
    ? await getCheatsheetById(input.cheatsheetId)
    : null;
  const cheatsheetContent = input.cheatsheetContent ?? savedCheatsheet?.content ?? null;
  const problems = db
    .prepare(
      `
        SELECT *
        FROM problems
        WHERE id IN (${input.problemIds.map(() => "?").join(",")})
        ORDER BY problem_index ASC
      `,
    )
    .all(...input.problemIds)
    .map(
      (row) =>
        mapProblem(
          row as {
            id: number;
            dataset_id: string;
            problem_index: number;
            difficulty: Difficulty;
            equation1: string;
            equation2: string;
            expected_answer: number;
          },
        ),
    );

  let hadFailure = false;
  let completedCount = 0;
  let correctCount = 0;

  try {
    await runWithConcurrency(problems, 5, async (problem) => {
      if (batchAbortController.signal.aborted) {
        return;
      }

      const stopRequestedAt = await getBatchStopRequestedAt(batchId);
      if (stopRequestedAt) {
        batchAbortController.abort();
        return;
      }

      const renderedPrompt = renderSystemPrompt(problem, cheatsheetContent);
      const createdAt = nowIso();

      try {
        const modelResult = await executeModelRun({
          modelId: input.modelId,
          reasoningMode: input.reasoningMode,
          systemPrompt: renderedPrompt,
          signal: batchAbortController.signal,
        });
        try {
          const parsed = parseModelResponse(modelResult.content);
          const isCorrect = parsed.verdict === problem.expectedAnswer;
          const updatedAt = nowIso();

          db.prepare(
            `
              INSERT INTO run_items (
                batch_id,
                problem_id,
                expected_answer,
                parsed_verdict,
                is_correct,
                raw_response,
                raw_reasoning,
                rendered_prompt,
                duration_ms,
                prompt_tokens,
                completion_tokens,
                reasoning_tokens,
                estimated_cost_usd,
                pricing_json,
                error,
                status,
                created_at,
                updated_at
              ) VALUES (
                @batchId,
                @problemId,
                @expectedAnswer,
                @parsedVerdict,
                @isCorrect,
                @rawResponse,
                @rawReasoning,
                @renderedPrompt,
                @durationMs,
                @promptTokens,
                @completionTokens,
                @reasoningTokens,
                @estimatedCostUsd,
                @pricingJson,
                NULL,
                'completed',
                @createdAt,
                @updatedAt
              )
            `,
          ).run({
            batchId,
            problemId: problem.id,
            expectedAnswer: problem.expectedAnswer ? 1 : 0,
            parsedVerdict: parsed.verdictLabel,
            isCorrect: isCorrect ? 1 : 0,
            rawResponse: modelResult.content,
            rawReasoning: modelResult.reasoning,
            renderedPrompt,
            durationMs: modelResult.durationMs,
            promptTokens: modelResult.promptTokens,
            completionTokens: modelResult.completionTokens,
            reasoningTokens: modelResult.reasoningTokens,
            estimatedCostUsd: modelResult.estimatedCostUsd,
            pricingJson: JSON.stringify(modelResult.pricing),
            createdAt,
            updatedAt,
          });

          completedCount += 1;
          if (isCorrect) {
            correctCount += 1;
          }
          onProgress?.({
            batchId,
            totalCount: input.problemIds.length,
            completedCount,
            correctCount,
            problemId: problem.id,
            problemIndex: problem.index,
            status: "completed",
            isCorrect,
            error: null,
          });
        } catch (error) {
          hadFailure = true;
          const message =
            error instanceof Error ? error.message : "Unknown response parsing error.";
          const updatedAt = nowIso();

          db.prepare(
            `
              INSERT INTO run_items (
                batch_id,
                problem_id,
                expected_answer,
                parsed_verdict,
                is_correct,
                raw_response,
                raw_reasoning,
                rendered_prompt,
                duration_ms,
                prompt_tokens,
                completion_tokens,
                reasoning_tokens,
                estimated_cost_usd,
                pricing_json,
                error,
                status,
                created_at,
                updated_at
              ) VALUES (
                @batchId,
                @problemId,
                @expectedAnswer,
                NULL,
                NULL,
                @rawResponse,
                @rawReasoning,
                @renderedPrompt,
                @durationMs,
                @promptTokens,
                @completionTokens,
                @reasoningTokens,
                @estimatedCostUsd,
                @pricingJson,
                @error,
                'failed',
                @createdAt,
                @updatedAt
              )
            `,
          ).run({
            batchId,
            problemId: problem.id,
            expectedAnswer: problem.expectedAnswer ? 1 : 0,
            rawResponse: modelResult.content,
            rawReasoning: modelResult.reasoning,
            renderedPrompt,
            durationMs: modelResult.durationMs,
            promptTokens: modelResult.promptTokens,
            completionTokens: modelResult.completionTokens,
            reasoningTokens: modelResult.reasoningTokens,
            estimatedCostUsd: modelResult.estimatedCostUsd,
            pricingJson: JSON.stringify(modelResult.pricing),
            error: message,
            createdAt,
            updatedAt,
          });

          completedCount += 1;
          onProgress?.({
            batchId,
            totalCount: input.problemIds.length,
            completedCount,
            correctCount,
            problemId: problem.id,
            problemIndex: problem.index,
            status: "failed",
            isCorrect: null,
            error: message,
          });
        }
      } catch (error) {
        if (isAbortError(error) && batchAbortController.signal.aborted) {
          return;
        }

        hadFailure = true;
        const message =
          error instanceof Error ? error.message : "Unknown model execution error.";
        const updatedAt = nowIso();
        db.prepare(
          `
            INSERT INTO run_items (
              batch_id,
              problem_id,
              expected_answer,
              parsed_verdict,
              is_correct,
              raw_response,
              raw_reasoning,
              rendered_prompt,
              duration_ms,
              prompt_tokens,
              completion_tokens,
              reasoning_tokens,
              estimated_cost_usd,
              pricing_json,
              error,
              status,
              created_at,
              updated_at
            ) VALUES (
              @batchId,
              @problemId,
              @expectedAnswer,
              NULL,
              NULL,
              NULL,
              NULL,
              @renderedPrompt,
              NULL,
              NULL,
              NULL,
              NULL,
              NULL,
              NULL,
              @error,
              'failed',
              @createdAt,
              @updatedAt
            )
          `,
        ).run({
          batchId,
          problemId: problem.id,
          expectedAnswer: problem.expectedAnswer ? 1 : 0,
          renderedPrompt,
          error: message,
          createdAt,
          updatedAt,
        });

        completedCount += 1;
        onProgress?.({
          batchId,
          totalCount: input.problemIds.length,
          completedCount,
          correctCount,
          problemId: problem.id,
          problemIndex: problem.index,
          status: "failed",
          isCorrect: null,
          error: message,
        });
      }
    });
  } finally {
    const totals = db
      .prepare(
        `
          SELECT
            COUNT(*) AS completed_count,
            COALESCE(SUM(CASE WHEN is_correct = 1 THEN 1 ELSE 0 END), 0) AS correct_count
          FROM run_items
          WHERE batch_id = ?
        `,
      )
      .get(batchId) as { completed_count: number; correct_count: number };
    const stopRequestedAt = await getBatchStopRequestedAt(batchId);
    const wasStopped =
      stopRequestedAt !== null && totals.completed_count < input.problemIds.length;
    const finalStatus: RunBatchStatus = wasStopped
      ? "failed"
      : hadFailure
        ? "failed"
        : "completed";
    const finishedAt = nowIso();

    db.prepare(
      `
        UPDATE run_batches
        SET
          correct_count = @correctCount,
          status = @status,
          finished_at = @finishedAt,
          updated_at = @updatedAt
        WHERE id = @id
      `,
    ).run({
      id: batchId,
      correctCount: totals.correct_count,
      status: finalStatus,
      finishedAt,
      updatedAt: finishedAt,
    });

    batchAbortControllers.delete(batchId);
  }
}
