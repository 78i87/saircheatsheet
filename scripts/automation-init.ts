import fs from "node:fs/promises";
import path from "node:path";

import {
  DEFAULT_AUTOMATION_CONFIG,
  automationConfigSchema,
  buildBatchSnapshot,
  renderBatchSnapshotMarkdown,
  validateBaselineBatch,
} from "@/lib/automation";
import { getRunBatch } from "@/lib/store";

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

async function ensureDir(dirPath: string) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function writeFile(filePath: string, content: string) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, content, "utf8");
}

async function ensureFile(filePath: string, content: string) {
  try {
    await fs.access(filePath);
  } catch {
    await writeFile(filePath, content);
  }
}

async function loadConfig(configPath: string) {
  try {
    const raw = await fs.readFile(configPath, "utf8");
    return automationConfigSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      await writeFile(`${configPath}`, `${JSON.stringify(DEFAULT_AUTOMATION_CONFIG, null, 2)}\n`);
      return DEFAULT_AUTOMATION_CONFIG;
    }

    throw error;
  }
}

function renderBranchReviewMarkdown(input: {
  baselineBatchId: number;
  wrongIndexes: number[];
  correctCount: number;
  totalCount: number;
}) {
  return [
    "# Root Branch Review",
    "",
    `This branch starts from batch ${input.baselineBatchId}. Batch ${input.baselineBatchId} is always the baseline.`,
    "",
    "## Starting Point",
    "",
    `- Baseline score: ${input.correctCount}/${input.totalCount}`,
    `- Wrong indexes: ${input.wrongIndexes.length > 0 ? input.wrongIndexes.join(", ") : "none"}`,
    `- Cheatsheet state: empty prompt file`,
    "",
    "## Codex Workflow",
    "",
    "1. Read `automation/baseline/baseline.md` and inspect the wrong-item reasoning traces.",
    "2. Create `iterations/iteration-XXX/` under this branch.",
    "3. Create five candidate directories under `candidates/`.",
    "4. Give each candidate a distinct `direction.md`, `agent-brief.md`, and `prompt.txt`.",
    "5. Run `npm run automation:benchmark -- --prompt <candidate prompt> --out <candidate dir>` for each candidate.",
    "6. Promote every candidate whose `deltaCorrectVsBaseline` is at least `+2`.",
    "",
  ].join("\n");
}

async function main() {
  loadEnvFile(".env");
  loadEnvFile(".env.local");

  const automationRoot = path.join(process.cwd(), "automation");
  const configPath = path.join(automationRoot, "config.json");
  const config = await loadConfig(configPath);
  const baselineBatch = await getRunBatch(config.baselineBatchId);

  if (!baselineBatch) {
    throw new Error(`Baseline batch ${config.baselineBatchId} was not found.`);
  }

  const baselineSnapshot = buildBatchSnapshot(baselineBatch);
  validateBaselineBatch(config, baselineSnapshot);

  const baselineDir = path.join(automationRoot, "baseline");
  const branchDir = path.join(automationRoot, "branches", "branch-000-root");
  const iterationsDir = path.join(branchDir, "iterations");
  const promptPath = path.join(branchDir, config.promptFileName);
  const baselineJsonPath = path.join(baselineDir, "baseline.json");
  const baselineMdPath = path.join(baselineDir, "baseline.md");
  const branchJsonPath = path.join(branchDir, "branch.json");
  const branchReviewPath = path.join(branchDir, "baseline-review.md");
  const gitkeepPath = path.join(iterationsDir, ".gitkeep");

  await writeFile(
    baselineJsonPath,
    `${JSON.stringify(
      {
        baselineBatchId: config.baselineBatchId,
        benchmark: config.benchmark,
        snapshot: baselineSnapshot,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    baselineMdPath,
    `${renderBatchSnapshotMarkdown(config, baselineSnapshot)}`,
  );
  await ensureFile(promptPath, "\n");
  await writeFile(
    branchJsonPath,
    `${JSON.stringify(
      {
        id: "branch-000-root",
        title: "Root prompt branch",
        status: "active",
        baselineBatchId: config.baselineBatchId,
        comparisonMode: "always_vs_baseline",
        startingPromptState: "empty_cheatsheet",
        parentBranchId: null,
        sourceIterationId: null,
        sourceCandidateId: null,
        promptFile: path.relative(process.cwd(), promptPath),
        latestBatchId: config.baselineBatchId,
        latestCorrectCount: baselineSnapshot.correctCount,
        latestDeltaVsBaseline: 0,
      },
      null,
      2,
    )}\n`,
  );
  await writeFile(
    branchReviewPath,
    `${renderBranchReviewMarkdown({
      baselineBatchId: config.baselineBatchId,
      wrongIndexes: baselineSnapshot.wrongProblemIndexes,
      correctCount: baselineSnapshot.correctCount,
      totalCount: baselineSnapshot.totalCount,
    })}\n`,
  );
  await ensureFile(gitkeepPath, "\n");

  console.log(`Automation workspace initialized at ${automationRoot}`);
  console.log(`Baseline files refreshed from batch ${config.baselineBatchId}.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "Unknown automation init error.";
  console.error(message);
  process.exitCode = 1;
});
