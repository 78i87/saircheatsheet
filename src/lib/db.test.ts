/** @vitest-environment node */

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";

import { applySchema, seedProblems } from "@/lib/db";

describe("seedProblems", () => {
  it("loads problems once and ignores duplicates", () => {
    const db = new Database(":memory:");
    applySchema(db);

    const rows = [
      {
        dataset_id: "normal_0001",
        index: 1,
        difficulty: "normal" as const,
        equation1: "x = y",
        equation2: "y = x",
        answer: true,
      },
      {
        dataset_id: "normal_0001",
        index: 1,
        difficulty: "normal" as const,
        equation1: "x = y",
        equation2: "y = x",
        answer: true,
      },
    ];

    seedProblems(db, rows);

    const count = db.prepare("SELECT COUNT(*) AS count FROM problems").get() as {
      count: number;
    };

    expect(count.count).toBe(1);
  });

  it("adds the raw_reasoning column to run_items", () => {
    const db = new Database(":memory:");
    applySchema(db);

    const columns = db
      .prepare("PRAGMA table_info(run_items)")
      .all() as Array<{ name: string }>;

    expect(columns.some((column) => column.name === "raw_reasoning")).toBe(true);
  });
});
