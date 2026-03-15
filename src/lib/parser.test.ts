import { describe, expect, it } from "vitest";

import { parseModelResponse } from "@/lib/parser";

describe("parseModelResponse", () => {
  it("parses a TRUE verdict from the verdict line", () => {
    const parsed = parseModelResponse(`VERDICT: TRUE
REASONING: By substitution.
PROOF: A derivation exists.
COUNTEREXAMPLE:`);

    expect(parsed.verdict).toBe(true);
    expect(parsed.verdictLabel).toBe("TRUE");
  });

  it("parses a FALSE verdict even if the rest of the output is messy", () => {
    const parsed = parseModelResponse(`VERDICT: FALSE
REASONING: The implication fails.
PROOF:
COUNTEREXAMPLE: A two-element magma separates the identities.`);

    expect(parsed.verdict).toBe(false);
    expect(parsed.verdictLabel).toBe("FALSE");
  });

  it("accepts verdict lines that appear after extra text", () => {
    const parsed = parseModelResponse(`Some preamble
More text
VERDICT: FALSE  
REASONING: ignored for scoring`);

    expect(parsed.verdict).toBe(false);
  });

  it("accepts the example shape with spacing after the verdict", () => {
    const parsed = parseModelResponse(`VERDICT: FALSE  
REASONING: Equation 1 does not force enough structure.

COUNTEREXAMPLE:

Long explanation continues here.`);

    expect(parsed.verdictLabel).toBe("FALSE");
  });

  it("rejects responses without a valid verdict line", () => {
    expect(() =>
      parseModelResponse(`REASONING: Because.\nNo explicit verdict.`),
    ).toThrow(/valid verdict line/i);
  });
});
