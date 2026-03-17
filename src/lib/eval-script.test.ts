/** @vitest-environment node */

import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getRunBatch } from "@/lib/store";
import { getDb, resetDatabaseForTests, seedProblems } from "@/lib/db";

const originalDbPath = process.env.SAIR_DB_PATH;
const repoRoot = process.cwd();

async function createTempDbPath() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sair-cli-script-"));
  return path.join(dir, "cli.sqlite");
}

async function writeFetchMock(mode: "success" | "stop") {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "sair-cli-mock-"));
  const filePath = path.join(dir, "mock-fetch.mjs");
  const source = `
let chatRequests = 0;

globalThis.fetch = async (input, init = {}) => {
  const url = typeof input === "string" ? input : input.toString();

  if (url.includes("/models")) {
    return new Response(JSON.stringify({
      data: [
        {
          id: "openai/gpt-oss-120b",
          pricing: {
            prompt: "0.000001",
            completion: "0.000002",
            internal_reasoning: "0.000003"
          }
        }
      ]
    }));
  }

  chatRequests += 1;

  if (${JSON.stringify(mode)} === "stop" && chatRequests === 2) {
    const signal = init.signal;
    if (!signal) {
      throw new Error("Expected an abort signal.");
    }

    console.error("waiting-for-abort");
    return await new Promise((resolve, reject) => {
      const keepAlive = setInterval(() => {}, 50);
      signal.addEventListener("abort", () => {
        clearInterval(keepAlive);
        reject(new DOMException("Aborted", "AbortError"));
      }, { once: true });
    });
  }

  return new Response(JSON.stringify({
    choices: [
      {
        message: {
          content: chatRequests === 1
            ? "VERDICT: TRUE\\nREASONING: Quick result."
            : "VERDICT: FALSE\\nREASONING: Later result.",
          reasoning: "mocked reasoning"
        }
      }
    ],
    usage: {
      prompt_tokens: 10,
      completion_tokens: 6,
      completion_tokens_details: {
        reasoning_tokens: 2
      }
    }
  }), {
    headers: {
      "Content-Type": "application/json"
    }
  });
};
`;

  await fs.writeFile(filePath, source);
  return filePath;
}

function seedCliProblems() {
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
  ]);
}

async function runCli(input: {
  args: string[];
  mockPath: string;
  dbPath: string;
  onStdout?: (chunk: string, child: ReturnType<typeof spawn>) => void;
  onStderr?: (chunk: string, child: ReturnType<typeof spawn>) => void;
}) {
  return await new Promise<{ code: number | null; stdout: string; stderr: string }>(
    (resolve, reject) => {
      const child = spawn(
        process.execPath,
        ["--import", input.mockPath, "--import", "tsx", "scripts/eval.ts", ...input.args],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            OPENROUTER_API_KEY: "test-key",
            SAIR_DB_PATH: input.dbPath,
          },
        },
      );

      let stdout = "";
      let stderr = "";

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");

      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
        input.onStdout?.(chunk, child);
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
        input.onStderr?.(chunk, child);
      });
      child.on("error", reject);
      child.on("close", (code) => resolve({ code, stdout, stderr }));
    },
  );
}

afterEach(() => {
  if (originalDbPath === undefined) {
    delete process.env.SAIR_DB_PATH;
  } else {
    process.env.SAIR_DB_PATH = originalDbPath;
  }

  resetDatabaseForTests();
});

describe("scripts/eval.ts", () => {
  it("prints readable progress and a final summary for successful runs", async () => {
    const dbPath = await createTempDbPath();
    process.env.SAIR_DB_PATH = dbPath;
    seedCliProblems();
    resetDatabaseForTests();

    const mockPath = await writeFetchMock("success");
    const result = await runCli({
      args: ["--model", "gpt-oss", "--difficulty", "normal", "--problems", "1-2"],
      mockPath,
      dbPath,
    });

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("Batch");
    expect(result.stdout).toContain("[1/2] normal #1");
    expect(result.stdout).toContain("Accuracy");

    process.env.SAIR_DB_PATH = dbPath;
    const batch = await getRunBatch(1);
    expect(batch?.status).toBe("completed");
  });

  it("exits non-zero when interrupted and reports the batch as stopped", async () => {
    const dbPath = await createTempDbPath();
    process.env.SAIR_DB_PATH = dbPath;
    seedCliProblems();
    resetDatabaseForTests();

    const mockPath = await writeFetchMock("stop");
    let signalSent = false;

    const result = await runCli({
      args: ["--model", "gpt-oss", "--difficulty", "normal", "--problems", "1-2"],
      mockPath,
      dbPath,
      onStderr(chunk, child) {
        if (!signalSent && chunk.includes("waiting-for-abort")) {
          signalSent = true;
          child.kill("SIGINT");
        }
      },
    });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("Stop requested");
    expect(result.stdout).toContain("stopped");

    process.env.SAIR_DB_PATH = dbPath;
    const batch = await getRunBatch(1);
    expect(batch?.stopRequestedAt).not.toBeNull();
    expect(batch?.completedCount).toBe(1);
  });
});
