import type { ProblemRecord } from "@/lib/contracts";

export function renderSystemPrompt(
  problem: Pick<ProblemRecord, "equation1" | "equation2">,
  cheatsheet?: string | null,
) {
  const cheatsheetSection =
    cheatsheet && cheatsheet.trim().length > 0
      ? `${cheatsheet.trim()}\n`
      : "";

  return [
    "You are a mathematician specializing in equational theories of magmas.",
    "Your task is to determine whether Equation 1 (" +
      problem.equation1 +
      ") implies Equation 2 (" +
      problem.equation2 +
      ") over all magmas.",
    cheatsheetSection ? cheatsheetSection.trimEnd() : null,
    "Output format (use exact headers without any additional text or formatting):",
    "VERDICT: must be exactly TRUE or FALSE (in the same line).",
    "REASONING: must be non-empty.",
    "PROOF: required if VERDICT is TRUE, empty otherwise.",
    "COUNTEREXAMPLE: required if VERDICT is FALSE, empty otherwise.",
  ]
    .filter(Boolean)
    .join("\n");
}
