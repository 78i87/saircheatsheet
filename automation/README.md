# Codex Automation Workspace

This workspace is for the prompt-optimization loop for the SAIR equational-theories challenge.

It is intentionally:

- CLI-first
- Codex-driven
- benchmark-fixed
- baseline-anchored to batch `40`

## Ground Rules

- Batch `40` is always the baseline.
- Batch `40` has no cheatsheet. The root `prompt.txt` is intentionally empty.
- All candidates are compared against batch `40`, even if they descend from a later survivor branch.
- The canonical benchmark is:
  - model: `openai/gpt-oss-120b`
  - difficulty: `normal`
  - problem selection: `1-100`
  - reasoning: `low`
- A candidate survives only if it improves by at least `+2` correct answers versus batch `40`.
- Keep all survivors.
- Keep rejected candidates on disk. Do not delete them.
- Use the CLI and files only. Do not depend on the web UI for the workflow.

## Workspace Layout

- `config.json`
  - fixed workflow config
- `baseline/`
  - persistent baseline artifacts generated from batch `40`
- `branches/`
  - prompt branches that evolve over time

The root editable branch is:

- `branches/branch-000-root/`

Each branch should follow this structure:

- `prompt.txt`
  - the exact cheatsheet/prompt artifact to benchmark
- `branch.json`
  - branch metadata
- `baseline-review.md`
  - working notes for why this branch exists
- `iterations/iteration-XXX/`
  - one loop cycle under this branch

Each iteration should use:

- `candidates/candidate-01/`
- `candidates/candidate-02/`
- `candidates/candidate-03/`
- `candidates/candidate-04/`
- `candidates/candidate-05/`

Each candidate directory should contain:

- `direction.md`
- `agent-brief.md`
- `prompt.txt`
- `results.json`
- `results.md`

## CLI Commands

Initialize or refresh the baseline workspace from batch `40`:

```bash
npm run automation:init
```

Benchmark a candidate prompt on the fixed challenge slice:

```bash
npm run automation:benchmark -- \
  --prompt automation/branches/branch-000-root/iterations/iteration-001/candidates/candidate-01/prompt.txt \
  --out automation/branches/branch-000-root/iterations/iteration-001/candidates/candidate-01 \
  --label candidate-01
```

Run the raw eval CLI directly if needed:

```bash
npm run eval -- \
  --model gpt-oss \
  --difficulty normal \
  --problems 1-100 \
  --reasoning low \
  --cheatsheet automation/branches/branch-000-root/prompt.txt
```

## Recommended Loop

1. Run `npm run automation:init`.
2. Read `automation/baseline/baseline.md`.
3. Work inside the current active branch under `automation/branches/`.
4. Create `iterations/iteration-XXX/`.
5. Propose five distinct prompt directions.
6. Create five candidate folders and write one `prompt.txt` in each.
7. Run `npm run automation:benchmark` for each candidate.
8. Promote every candidate with `deltaCorrectVsBaseline >= 2`.
9. Start the next iteration from each survivor branch.

## Ready-to-Use Codex Prompts

Use these prompts directly with Codex.

### Analyze the baseline

```text
Work inside /Users/morganye/Desktop/sair playground/automation.
Read baseline/baseline.md and branch-000-root/baseline-review.md.
Summarize the failure patterns in batch 40 and propose five distinct prompt directions.
Do not use the web UI. Use the CLI/files only.
```

### Create an iteration

```text
Work inside /Users/morganye/Desktop/sair playground/automation/branches/branch-000-root.
Create iterations/iteration-001/candidates/candidate-01 through candidate-05.
Write direction.md, agent-brief.md, and prompt.txt for each candidate.
All five directions must be materially distinct.
```

### Benchmark the five candidates

```text
Benchmark every candidate prompt in the current iteration with npm run automation:benchmark.
Write results.json and results.md into each candidate directory.
Compare every result against batch 40 only.
```

### Promote survivors

```text
Read every candidate results.json in the current iteration.
Promote every candidate with deltaCorrectVsBaseline >= 2 into a new branch under automation/branches/.
Leave rejected candidates in place and mark them rejected in the iteration notes.
```
