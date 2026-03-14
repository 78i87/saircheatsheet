import { describe, expect, it } from "vitest";

import { renderSystemPrompt } from "@/lib/prompt";

describe("renderSystemPrompt", () => {
  it("injects equations into the system prompt", () => {
    const prompt = renderSystemPrompt({
      equation1: "x = y",
      equation2: "y = x",
    });

    expect(prompt).toContain("Equation 1 (x = y)");
    expect(prompt).toContain("Equation 2 (y = x)");
    expect(prompt).toContain("VERDICT:");
  });

  it("includes cheatsheet content when provided", () => {
    const prompt = renderSystemPrompt(
      {
        equation1: "x = y",
        equation2: "y = x",
      },
      "Useful lemma",
    );

    expect(prompt).toContain("Useful lemma");
  });
});
