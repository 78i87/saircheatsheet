import { describe, expect, it } from "vitest";

import {
  buildReasoningPayload,
  supportsLowReasoning,
} from "@/lib/models";

describe("model reasoning settings", () => {
  it("enables reasoning capture for gpt-oss", () => {
    expect(buildReasoningPayload("openai/gpt-oss-120b", "low")).toEqual({
      include_reasoning: true,
      reasoning: { effort: "low" },
    });
  });

  it("uses reasoning.effort for grok and gemini", () => {
    expect(buildReasoningPayload("x-ai/grok-4.1-fast", "low")).toEqual({
      reasoning: { effort: "low" },
    });
    expect(
      buildReasoningPayload("google/gemini-3.1-flash-lite-preview", "low"),
    ).toEqual({
      reasoning: { effort: "low" },
    });
  });

  it("disables low reasoning for llama models without reasoning support", () => {
    expect(supportsLowReasoning("meta-llama/llama-3.3-70b-instruct")).toBe(false);
    expect(
      buildReasoningPayload("meta-llama/llama-3.3-70b-instruct", "low"),
    ).toEqual({});
    expect(supportsLowReasoning("meta-llama/llama-4-maverick")).toBe(false);
    expect(buildReasoningPayload("meta-llama/llama-4-maverick", "low")).toEqual(
      {},
    );
  });
});
