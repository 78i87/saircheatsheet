import { describe, expect, it } from "vitest";

import { parseEvalCliArgs } from "@/lib/eval-cli";

describe("parseEvalCliArgs", () => {
  it("resolves model aliases", () => {
    expect(
      parseEvalCliArgs([
        "--model",
        "gpt-oss",
        "--difficulty",
        "normal",
        "--problems",
        "1-2",
      ]),
    ).toEqual({
      kind: "run",
      modelId: "openai/gpt-oss-120b",
      difficulty: "normal",
      problemIndexes: [1, 2],
      reasoningMode: "default",
      cheatsheetPath: null,
    });
  });

  it("accepts full model ids", () => {
    expect(
      parseEvalCliArgs([
        "--model",
        "x-ai/grok-4.1-fast",
        "--difficulty",
        "hard",
        "--problems",
        "7",
        "--reasoning",
        "low",
        "--cheatsheet",
        "./notes.txt",
      ]),
    ).toEqual({
      kind: "run",
      modelId: "x-ai/grok-4.1-fast",
      difficulty: "hard",
      problemIndexes: [7],
      reasoningMode: "low",
      cheatsheetPath: "./notes.txt",
    });
  });
});
