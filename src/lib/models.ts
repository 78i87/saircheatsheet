export type Difficulty = "normal" | "hard";
export type ReasoningMode = "default" | "low";

export type ModelOption = {
  id: string;
  label: string;
  provider: string;
  supportsLowReasoning: boolean;
  pricingFallback: {
    prompt: number;
    completion: number;
    reasoning?: number;
  };
};

export type ModelAlias = {
  alias: string;
  modelId: string;
};

export const SUPPORTED_MODELS: ModelOption[] = [
  {
    id: "openai/gpt-oss-120b",
    label: "GPT OSS 120B",
    provider: "OpenAI",
    supportsLowReasoning: true,
    pricingFallback: {
      prompt: 0.000000039,
      completion: 0.00000019,
    },
  },
  {
    id: "x-ai/grok-4.1-fast",
    label: "Grok 4.1 Fast",
    provider: "xAI",
    supportsLowReasoning: true,
    pricingFallback: {
      prompt: 0.0000002,
      completion: 0.0000005,
    },
  },
  {
    id: "google/gemini-3.1-flash-lite-preview",
    label: "Gemini 3.1 Flash Lite Preview",
    provider: "Google",
    supportsLowReasoning: true,
    pricingFallback: {
      prompt: 0.00000025,
      completion: 0.0000015,
      reasoning: 0.0000015,
    },
  },
  {
    id: "meta-llama/llama-3.3-70b-instruct",
    label: "Llama 3.3 70B Instruct",
    provider: "Meta",
    supportsLowReasoning: false,
    pricingFallback: {
      prompt: 0.0000001,
      completion: 0.00000032,
    },
  },
  {
    id: "meta-llama/llama-4-maverick",
    label: "Llama 4 Maverick",
    provider: "Meta",
    supportsLowReasoning: false,
    pricingFallback: {
      prompt: 0.00000015,
      completion: 0.0000006,
    },
  },
];

export const MODEL_ALIASES: ModelAlias[] = [
  { alias: "gpt-oss", modelId: "openai/gpt-oss-120b" },
  { alias: "grok", modelId: "x-ai/grok-4.1-fast" },
  {
    alias: "gemini-flash-lite",
    modelId: "google/gemini-3.1-flash-lite-preview",
  },
  {
    alias: "llama-3.3",
    modelId: "meta-llama/llama-3.3-70b-instruct",
  },
  { alias: "llama-4", modelId: "meta-llama/llama-4-maverick" },
];

export function getModelOption(modelId: string): ModelOption {
  const model = SUPPORTED_MODELS.find((entry) => entry.id === modelId);
  if (!model) {
    throw new Error(`Unsupported model: ${modelId}`);
  }
  return model;
}

export function resolveModelId(modelIdOrAlias: string) {
  const input = modelIdOrAlias.trim();
  const alias = MODEL_ALIASES.find((entry) => entry.alias === input);
  const resolvedId = alias?.modelId ?? input;

  return getModelOption(resolvedId).id;
}

export function buildReasoningPayload(
  modelId: string,
  reasoningMode: ReasoningMode,
) {
  if (modelId === "openai/gpt-oss-120b") {
    return {
      include_reasoning: true as const,
      ...(reasoningMode === "low"
        ? { reasoning: { effort: "low" as const } }
        : {}),
    };
  }

  if (reasoningMode !== "low") {
    return {};
  }

  if (
    modelId === "x-ai/grok-4.1-fast" ||
    modelId === "google/gemini-3.1-flash-lite-preview"
  ) {
    return { reasoning: { effort: "low" as const } };
  }

  return {};
}

export function supportsLowReasoning(modelId: string) {
  return getModelOption(modelId).supportsLowReasoning;
}

export function normalizeReasoningMode(
  modelId: string,
  reasoningMode: ReasoningMode,
): ReasoningMode {
  return supportsLowReasoning(modelId) ? reasoningMode : "default";
}
