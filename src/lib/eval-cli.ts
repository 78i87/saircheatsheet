import type { Difficulty, ReasoningMode } from "@/lib/models";
import {
  MODEL_ALIASES,
  SUPPORTED_MODELS,
  getModelOption,
  resolveModelId,
} from "@/lib/models";
import { parseProblemRange } from "@/lib/problem-selection";

export type EvalCliCommand =
  | { kind: "help" }
  | { kind: "list-models" }
  | {
      kind: "run";
      modelId: string;
      difficulty: Difficulty;
      problemIndexes: number[];
      reasoningMode: ReasoningMode;
      cheatsheetPath: string | null;
    };

function parseDifficulty(input: string): Difficulty {
  if (input === "normal" || input === "hard") {
    return input;
  }

  throw new Error(`Invalid difficulty "${input}". Expected normal or hard.`);
}

function parseReasoningMode(input: string): ReasoningMode {
  if (input === "default" || input === "low") {
    return input;
  }

  throw new Error(`Invalid reasoning mode "${input}". Expected default or low.`);
}

export function parseEvalCliArgs(argv: string[]): EvalCliCommand {
  if (argv.includes("--help") || argv.includes("-h")) {
    return { kind: "help" };
  }

  if (argv.includes("--list-models")) {
    return { kind: "list-models" };
  }

  const values = new Map<string, string>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument "${arg}".`);
    }

    if (arg === "--help" || arg === "--list-models") {
      continue;
    }

    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      throw new Error(`Missing value for ${arg}.`);
    }

    values.set(arg, next);
    index += 1;
  }

  const rawModel = values.get("--model");
  const rawDifficulty = values.get("--difficulty");
  const rawProblems = values.get("--problems");

  if (!rawModel) {
    throw new Error("Missing required flag --model.");
  }

  if (!rawDifficulty) {
    throw new Error("Missing required flag --difficulty.");
  }

  if (!rawProblems) {
    throw new Error("Missing required flag --problems.");
  }

  return {
    kind: "run",
    modelId: resolveModelId(rawModel),
    difficulty: parseDifficulty(rawDifficulty),
    problemIndexes: parseProblemRange(rawProblems),
    reasoningMode: parseReasoningMode(values.get("--reasoning") ?? "default"),
    cheatsheetPath: values.get("--cheatsheet") ?? null,
  };
}

export function formatModelList() {
  const aliasesByModelId = new Map<string, string[]>();

  for (const entry of MODEL_ALIASES) {
    const aliases = aliasesByModelId.get(entry.modelId) ?? [];
    aliases.push(entry.alias);
    aliasesByModelId.set(entry.modelId, aliases);
  }

  return SUPPORTED_MODELS.map((model) => {
    const aliases = aliasesByModelId.get(model.id) ?? [];
    const aliasLabel = aliases.length > 0 ? aliases.join(", ") : "none";
    return `${aliasLabel.padEnd(18)} ${model.id} (${model.label})`;
  }).join("\n");
}

export function formatEvalCliHelp() {
  return [
    "Usage:",
    "  npm run eval -- --model <alias|id> --difficulty <normal|hard> --problems <list>",
    "",
    "Options:",
    "  --model <alias|id>     Model alias or OpenRouter model id.",
    "  --difficulty <value>   Problem bank to use: normal or hard.",
    "  --problems <list>      Comma-separated indexes and inclusive ranges, e.g. 1,2,5-10.",
    "  --reasoning <mode>     default or low. Defaults to default.",
    "  --cheatsheet <path>    Plain-text file injected into the system prompt.",
    "  --list-models          Print supported aliases and model ids.",
    "  --help                 Show this message.",
    "",
    "Supported models:",
    formatModelList(),
  ].join("\n");
}

export function getModelDisplayName(modelId: string) {
  return getModelOption(modelId).label;
}
