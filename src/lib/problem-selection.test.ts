import { describe, expect, it } from "vitest";

import { isProblemRangeQuery, parseProblemRange } from "@/lib/problem-selection";

describe("isProblemRangeQuery", () => {
  it("detects numeric range syntax", () => {
    expect(isProblemRangeQuery("1")).toBe(true);
    expect(isProblemRangeQuery("1,3,5-8")).toBe(true);
    expect(isProblemRangeQuery(" 1 - 50 ")).toBe(true);
  });

  it("ignores plain text search queries", () => {
    expect(isProblemRangeQuery("hard_0001")).toBe(false);
    expect(isProblemRangeQuery("x * y")).toBe(false);
    expect(isProblemRangeQuery("")).toBe(false);
  });
});

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
