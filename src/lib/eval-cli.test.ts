import { describe, expect, it } from "vitest";

import { parseEvalCliArgs, parseProblemRange } from "@/lib/eval-cli";

describe("parseProblemRange", () => {
  it("parses a single problem index", () => {
    expect(parseProblemRange("1")).toEqual([1]);
  });

  it("parses mixed indexes and inclusive ranges", () => {
    expect(parseProblemRange("1,3,5-8")).toEqual([1, 3, 5, 6, 7, 8]);
  });

  it("rejects descending ranges", () => {
    expect(() => parseProblemRange("8-5")).toThrow(/invalid problem range/i);
  });

  it("rejects zero", () => {
    expect(() => parseProblemRange("0")).toThrow(/positive integers/i);
  });

  it("rejects duplicates", () => {
    expect(() => parseProblemRange("1,2,2")).toThrow(/duplicate problem index/i);
    expect(() => parseProblemRange("1-3,3")).toThrow(/duplicate problem index/i);
  });

  it("rejects malformed tokens", () => {
    expect(() => parseProblemRange("abc")).toThrow(/invalid problem index/i);
    expect(() => parseProblemRange("1,,2")).toThrow(/empty entry/i);
  });
});

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
