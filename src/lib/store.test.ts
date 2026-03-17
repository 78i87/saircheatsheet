/** @vitest-environment node */

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getDb, resetDatabaseForTests, seedProblems } from "@/lib/db";
import {
  createRunBatch,
  getRunBatch,
  listProblemsByIndexes,
  requestStopRunBatch,
  runBatchForeground,
} from "@/lib/store";

const originalFetch = global.fetch;
const originalApiKey = process.env.OPENROUTER_API_KEY;
const originalDbPath = process.env.SAIR_DB_PATH;

async function createTempDbPath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sair-cli-store-"));
  return path.join(dir, "test.sqlite");
}

function seedTestProblems() {
  const db = getDb();
  seedProblems(db, [
    {
      dataset_id: "normal_0001",
      index: 1,
      difficulty: "normal",
      equation1: "x = y",
      equation2: "y = x",
      answer: true,
    },
    {
      dataset_id: "normal_0002",
      index: 2,
      difficulty: "normal",
      equation1: "x = x",
      equation2: "y = y",
      answer: false,
    },
    {
      dataset_id: "hard_0001",
      index: 1,
      difficulty: "hard",
      equation1: "xy = yx",
      equation2: "x = y",
      answer: false,
    },
  ]);
}

afterEach(() => {
  global.fetch = originalFetch;
  process.env.OPENROUTER_API_KEY = originalApiKey;

  if (originalDbPath === undefined) {
    delete process.env.SAIR_DB_PATH;
  } else {
    process.env.SAIR_DB_PATH = originalDbPath;
  }

  resetDatabaseForTests();
});

describe("runBatchForeground", () => {
  it("returns no problems when indexes is empty", async () => {
    process.env.SAIR_DB_PATH = await createTempDbPath();
    seedTestProblems();

    await expect(
      listProblemsByIndexes({
        difficulty: "normal",
        indexes: [],
      }),
    ).resolves.toEqual([]);
  });

  it("persists a completed batch, injects file cheatsheet content, and coerces unsupported low reasoning", async () => {
    process.env.SAIR_DB_PATH = await createTempDbPath();
    process.env.OPENROUTER_API_KEY = "test-key";
    seedTestProblems();

    global.fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/models")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "meta-llama/llama-4-maverick",
                pricing: {
                  prompt: "0.000001",
                  completion: "0.000002",
                },
              },
            ],
          }),
        );
      }

      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "VERDICT: FALSE\nREASONING: Counterexample.",
              },
            },
          ],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 6,
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    };

    const batchId = await runBatchForeground({
      problemIds: [1, 2],
      modelId: "meta-llama/llama-4-maverick",
      reasoningMode: "low",
      cheatsheetId: null,
      cheatsheetContent: "Lemma: preserve cancellativity.",
    });

    const batch = await getRunBatch(batchId);
    expect(batch).not.toBeNull();
    expect(batch?.status).toBe("completed");
    expect(batch?.reasoningMode).toBe("default");
    expect(batch?.items).toHaveLength(2);
    expect(batch?.items[0]?.renderedPrompt).toContain(
      "Lemma: preserve cancellativity.",
    );

    const db = getDb();
    const cheatsheetCount = db
      .prepare("SELECT COUNT(*) AS count FROM cheatsheets")
      .get() as { count: number };

    expect(cheatsheetCount.count).toBe(0);
  });

  it("marks a batch as failed when stop is requested and preserves partial results", async () => {
    process.env.SAIR_DB_PATH = await createTempDbPath();
    process.env.OPENROUTER_API_KEY = "test-key";
    seedTestProblems();

    let batchId: number | null = null;
    let chatRequests = 0;

    global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/models")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "openai/gpt-oss-120b",
                pricing: {
                  prompt: "0.000001",
                  completion: "0.000002",
                  internal_reasoning: "0.000003",
                },
              },
            ],
          }),
        );
      }

      chatRequests += 1;
      if (chatRequests === 1) {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: "VERDICT: TRUE\nREASONING: Immediate proof.",
                  reasoning: "done",
                },
              },
            ],
            usage: {
              prompt_tokens: 8,
              completion_tokens: 4,
              completion_tokens_details: {
                reasoning_tokens: 1,
              },
            },
          }),
          {
            headers: {
              "Content-Type": "application/json",
            },
          },
        );
      }

      const signal = init?.signal;
      if (!signal) {
        throw new Error("Expected an abort signal.");
      }

      return await new Promise<Response>((resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            reject(new DOMException("Aborted", "AbortError"));
          },
          { once: true },
        );
      });
    };

    batchId = await runBatchForeground(
      {
        problemIds: [1, 2],
        modelId: "openai/gpt-oss-120b",
        reasoningMode: "default",
        cheatsheetId: null,
      },
      {
        onBatchCreated(createdBatchId) {
          batchId = createdBatchId;
        },
        onProgress(event) {
          if (event.completedCount === 1 && batchId !== null) {
            void requestStopRunBatch(batchId);
          }
        },
      },
    );

    const batch = await getRunBatch(batchId);
    expect(batch).not.toBeNull();
    expect(batch?.status).toBe("failed");
    expect(batch?.stopRequestedAt).not.toBeNull();
    expect(batch?.completedCount).toBe(1);
    expect(batch?.items).toHaveLength(1);
  });

  it("rejects empty problem ids for foreground and background batches", async () => {
    process.env.SAIR_DB_PATH = await createTempDbPath();
    process.env.OPENROUTER_API_KEY = "test-key";
    seedTestProblems();

    await expect(
      runBatchForeground({
        problemIds: [],
        modelId: "openai/gpt-oss-120b",
        reasoningMode: "default",
        cheatsheetId: null,
      }),
    ).rejects.toThrow(/at least one problem id/i);

    await expect(
      createRunBatch({
        problemIds: [],
        modelId: "openai/gpt-oss-120b",
        reasoningMode: "default",
        cheatsheetId: null,
      }),
    ).rejects.toThrow(/at least one problem id/i);
  });
});
