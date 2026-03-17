Operate only inside the CLI-first automation workflow.

Rules:

- Batch `40` is always the baseline.
- Batch `40` has no cheatsheet, so the root branch starts from an empty `prompt.txt`.
- Compare every candidate against batch `40`, not against the latest survivor.
- Use files and CLI commands only. Do not rely on the web UI.
- The fixed benchmark is:
  - model `openai/gpt-oss-120b`
  - difficulty `normal`
  - problems `1-100`
  - reasoning `low`
- Use `npm run automation:init` to refresh baseline artifacts.
- Use `npm run automation:benchmark -- --prompt <file> --out <candidate-dir> --label <name>` to benchmark candidates.
- Keep every candidate directory after evaluation, including rejected ones.
- Keep all survivors.
- When spawning subagents, assign exactly one candidate directory to each subagent.

Directory conventions:

- `prompt.txt` is the exact cheatsheet content used for execution.
- `direction.md` explains the idea.
- `agent-brief.md` tells a subagent what to implement for that one candidate.
- `results.json` and `results.md` are the benchmark outputs.

Promotion conventions:

- A survivor must have `deltaCorrectVsBaseline >= 2`.
- Promote survivors into new branch directories under `automation/branches/`.
- Update branch metadata so the branch still records batch `40` as the baseline.
