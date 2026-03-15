import { describe, expect, it } from "vitest";

import { executeModelRun } from "@/lib/openrouter";

describe("executeModelRun", () => {
  it("parses streamed content and usage from OpenRouter SSE responses", async () => {
    const originalFetch = global.fetch;
    process.env.OPENROUTER_API_KEY = "test-key";

    global.fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/models")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "x-ai/grok-4.1-fast",
                pricing: {
                  prompt: "0.000001",
                  completion: "0.000002",
                  internal_reasoning: "0.000003",
                },
              },
            ],
          }),
        );
      }

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              [
                ": OPENROUTER PROCESSING\n\n",
                'data: {"choices":[{"delta":{"content":"VERDICT: TRUE\\n"}}]}\n\n',
                'data: {"choices":[{"delta":{"content":"REASONING: Done."}}]}\n\n',
                'data: {"usage":{"prompt_tokens":10,"completion_tokens":5,"reasoning_tokens":2}}\n\n',
                "data: [DONE]\n\n",
              ].join(""),
            ),
          );
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
        },
      });
    };

    try {
      const result = await executeModelRun({
        modelId: "x-ai/grok-4.1-fast",
        reasoningMode: "default",
        systemPrompt: "prompt",
      });

      expect(result.content).toBe("VERDICT: TRUE\nREASONING: Done.");
      expect(result.promptTokens).toBe(10);
      expect(result.completionTokens).toBe(5);
      expect(result.reasoningTokens).toBe(2);
      expect(result.reasoning).toBeNull();
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("captures reasoning output for GPT OSS 120B", async () => {
    const originalFetch = global.fetch;
    process.env.OPENROUTER_API_KEY = "test-key";
    const fetchMock = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/models")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "openai/gpt-oss-120b",
                pricing: {
                  prompt: "0.000001",
                  completion: "0.000002",
                  internal_reasoning: "0.000003",
                },
              },
            ],
          }),
        );
      }

      const payload = JSON.parse(String(init?.body)) as {
        include_reasoning?: boolean;
        reasoning?: { effort?: string };
      };

      expect(payload.include_reasoning).toBe(true);
      expect(payload.reasoning?.effort).toBe("low");

      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              [
                'data: {"choices":[{"delta":{"reasoning":"Step 1."}}]}\n\n',
                'data: {"choices":[{"delta":{"reasoning":" Step 2."}}]}\n\n',
                'data: {"choices":[{"delta":{"content":"VERDICT: FALSE\\nREASONING: Done."}}]}\n\n',
                'data: {"usage":{"prompt_tokens":12,"completion_tokens":8,"completion_tokens_details":{"reasoning_tokens":3}}}\n\n',
                "data: [DONE]\n\n",
              ].join(""),
            ),
          );
          controller.close();
        },
      });

      return new Response(stream, {
        headers: {
          "Content-Type": "text/event-stream",
        },
      });
    };

    global.fetch = fetchMock;

    try {
      const result = await executeModelRun({
        modelId: "openai/gpt-oss-120b",
        reasoningMode: "low",
        systemPrompt: "prompt",
      });

      expect(result.content).toBe("VERDICT: FALSE\nREASONING: Done.");
      expect(result.reasoning).toBe("Step 1. Step 2.");
      expect(result.reasoningTokens).toBe(3);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("retries GPT OSS default reasoning without streaming after an empty streamed response", async () => {
    const originalFetch = global.fetch;
    process.env.OPENROUTER_API_KEY = "test-key";
    let chatRequests = 0;

    global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();

      if (url.includes("/models")) {
        return new Response(
          JSON.stringify({
            data: [
              {
                id: "openai/gpt-oss-120b",
                pricing: {
                  prompt: "0.000001",
                  completion: "0.000002",
                  internal_reasoning: "0.000003",
                },
              },
            ],
          }),
        );
      }

      chatRequests += 1;
      const payload = JSON.parse(String(init?.body)) as {
        stream?: boolean;
        include_reasoning?: boolean;
      };

      expect(payload.include_reasoning).toBe(true);

      if (chatRequests === 1) {
        expect(payload.stream).toBe(true);
        const stream = new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
            controller.close();
          },
        });

        return new Response(stream, {
          headers: {
            "Content-Type": "text/event-stream",
          },
        });
      }

      expect(payload.stream).toBe(false);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: "VERDICT: TRUE\nREASONING: Recovered.",
                reasoning: "Recovered after non-stream retry.",
              },
            },
          ],
          usage: {
            prompt_tokens: 15,
            completion_tokens: 9,
            completion_tokens_details: {
              reasoning_tokens: 4,
            },
          },
        }),
        {
          headers: {
            "Content-Type": "application/json",
          },
        },
      );
    };

    try {
      const result = await executeModelRun({
        modelId: "openai/gpt-oss-120b",
        reasoningMode: "default",
        systemPrompt: "prompt",
      });

      expect(chatRequests).toBe(2);
      expect(result.content).toBe("VERDICT: TRUE\nREASONING: Recovered.");
      expect(result.reasoning).toBe("Recovered after non-stream retry.");
      expect(result.reasoningTokens).toBe(4);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
