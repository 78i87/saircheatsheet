import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";

import type { Difficulty } from "@/lib/models";

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "sair-model-eval.sqlite");

export type SeedProblem = {
  dataset_id: string;
  index: number;
  difficulty: Difficulty;
  equation1: string;
  equation2: string;
  answer: boolean;
};

type RawDatasetProblem = {
  id: string;
  index: number;
  difficulty: Difficulty;
  equation1: string;
  equation2: string;
  answer: boolean;
};

let dbInstance: Database.Database | null = null;
let initPromise: Promise<void> | null = null;

function getDatabasePath() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  return DB_PATH;
}

export function getDb() {
  if (!dbInstance) {
    dbInstance = new Database(getDatabasePath());
    dbInstance.pragma("journal_mode = WAL");
    applySchema(dbInstance);
  }

  return dbInstance;
}

export function applySchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS problems (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dataset_id TEXT NOT NULL UNIQUE,
      problem_index INTEGER NOT NULL,
      difficulty TEXT NOT NULL CHECK (difficulty IN ('normal', 'hard')),
      equation1 TEXT NOT NULL,
      equation2 TEXT NOT NULL,
      expected_answer INTEGER NOT NULL CHECK (expected_answer IN (0, 1))
    );

    CREATE INDEX IF NOT EXISTS idx_problems_difficulty_index
      ON problems (difficulty, problem_index);

    CREATE TABLE IF NOT EXISTS cheatsheets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS run_batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      model_id TEXT NOT NULL,
      model_label TEXT NOT NULL,
      reasoning_mode TEXT NOT NULL CHECK (reasoning_mode IN ('default', 'low')),
      cheatsheet_id INTEGER,
      status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed')),
      started_at TEXT NOT NULL,
      finished_at TEXT,
      total_count INTEGER NOT NULL,
      correct_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (cheatsheet_id) REFERENCES cheatsheets (id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_run_batches_started_at
      ON run_batches (started_at DESC);

    CREATE TABLE IF NOT EXISTS run_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_id INTEGER NOT NULL,
      problem_id INTEGER NOT NULL,
      expected_answer INTEGER NOT NULL CHECK (expected_answer IN (0, 1)),
      parsed_verdict TEXT,
      is_correct INTEGER,
      raw_response TEXT,
      raw_reasoning TEXT,
      rendered_prompt TEXT NOT NULL,
      duration_ms INTEGER,
      prompt_tokens INTEGER,
      completion_tokens INTEGER,
      reasoning_tokens INTEGER,
      estimated_cost_usd REAL,
      pricing_json TEXT,
      error TEXT,
      status TEXT NOT NULL CHECK (status IN ('completed', 'failed')),
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (batch_id) REFERENCES run_batches (id) ON DELETE CASCADE,
      FOREIGN KEY (problem_id) REFERENCES problems (id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_run_items_batch_id
      ON run_items (batch_id, id);
  `);

  const runBatchColumns = db
    .prepare("PRAGMA table_info(run_batches)")
    .all() as Array<{ name: string }>;
  const hasStopRequestedAt = runBatchColumns.some(
    (column) => column.name === "stop_requested_at",
  );

  if (!hasStopRequestedAt) {
    db.exec(`
      ALTER TABLE run_batches
      ADD COLUMN stop_requested_at TEXT
    `);
  }

  const runItemColumns = db
    .prepare("PRAGMA table_info(run_items)")
    .all() as Array<{ name: string }>;
  const hasRawReasoning = runItemColumns.some(
    (column) => column.name === "raw_reasoning",
  );

  if (!hasRawReasoning) {
    db.exec(`
      ALTER TABLE run_items
      ADD COLUMN raw_reasoning TEXT
    `);
  }
}

export async function initializeDatabase() {
  if (!initPromise) {
    initPromise = (async () => {
      const db = getDb();
      const row = db
        .prepare("SELECT COUNT(*) AS count FROM problems")
        .get() as { count: number };

      if (row.count === 0) {
        const problems = await downloadAllProblems();
        seedProblems(db, problems);
      }
    })().catch((error) => {
      initPromise = null;
      throw error;
    });
  }

  return initPromise;
}

export function seedProblems(db: Database.Database, problems: SeedProblem[]) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO problems (
      dataset_id,
      problem_index,
      difficulty,
      equation1,
      equation2,
      expected_answer
    ) VALUES (
      @dataset_id,
      @index,
      @difficulty,
      @equation1,
      @equation2,
      @expected_answer
    )
  `);

  const transaction = db.transaction((rows: SeedProblem[]) => {
    for (const row of rows) {
      insert.run({
        ...row,
        expected_answer: row.answer ? 1 : 0,
      });
    }
  });

  transaction(problems);
}

async function downloadJsonl(url: string) {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Failed to fetch dataset from ${url}`);
  }

  const text = await response.text();
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const row = JSON.parse(line) as RawDatasetProblem;
      return {
        dataset_id: row.id,
        index: row.index,
        difficulty: row.difficulty,
        equation1: row.equation1,
        equation2: row.equation2,
        answer: row.answer,
      } satisfies SeedProblem;
    });
}

async function downloadAllProblems() {
  const [normal, hard] = await Promise.all([
    downloadJsonl(
      "https://huggingface.co/datasets/SAIRfoundation/equational-theories-selected-problems/resolve/main/data/normal.jsonl",
    ),
    downloadJsonl(
      "https://huggingface.co/datasets/SAIRfoundation/equational-theories-selected-problems/resolve/main/data/hard.jsonl",
    ),
  ]);

  return [...normal, ...hard];
}
