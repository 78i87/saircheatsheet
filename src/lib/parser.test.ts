import { describe, expect, it } from "vitest";

import { parseModelResponse } from "@/lib/parser";

describe("parseModelResponse", () => {
  it("parses a TRUE response with proof", () => {
    const parsed = parseModelResponse(`VERDICT: TRUE
REASONING: By substitution.
PROOF: A derivation exists.
COUNTEREXAMPLE:`);

    expect(parsed.verdict).toBe(true);
    expect(parsed.proof).toBe("A derivation exists.");
    expect(parsed.counterexample).toBe("");
  });

  it("parses a FALSE response with counterexample", () => {
    const parsed = parseModelResponse(`VERDICT: FALSE
REASONING: The implication fails.
PROOF:
COUNTEREXAMPLE: A two-element magma separates the identities.`);

    expect(parsed.verdict).toBe(false);
    expect(parsed.counterexample).toContain("two-element magma");
  });

  it("rejects malformed header order", () => {
    expect(() =>
      parseModelResponse(`REASONING: nope
VERDICT: TRUE
PROOF: yes
COUNTEREXAMPLE:`),
    ).toThrow(/required header format/i);
  });

  it("rejects missing proof for TRUE", () => {
    expect(() =>
      parseModelResponse(`VERDICT: TRUE
REASONING: Because.
PROOF:
COUNTEREXAMPLE:`),
    ).toThrow(/proof is required/i);
  });
});
