import { describe, expect, it } from "vitest";

import { formatStoredResponse } from "@/lib/run-output";

describe("formatStoredResponse", () => {
  it("shows both the validation error and the raw response when both exist", () => {
    expect(
      formatStoredResponse({
        error: "Malformed output",
        rawResponse: "VERDICT: TRUE\nREASONING: ...",
      }),
    ).toContain("Validation error: Malformed output");
  });

  it("returns the raw response when there is no error", () => {
    expect(
      formatStoredResponse({
        rawResponse: "VERDICT: FALSE",
      }),
    ).toBe("VERDICT: FALSE");
  });
});
