# Root Branch Review

This branch starts from batch 40. Batch 40 is always the baseline.

## Starting Point

- Baseline score: 80/100
- Wrong indexes: 1, 2, 4, 9, 13, 14, 19, 26, 28, 31, 40, 42, 53, 63, 67, 75, 78, 89, 93, 94
- Cheatsheet state: empty prompt file

## Codex Workflow

1. Read `automation/baseline/baseline.md` and inspect the wrong-item reasoning traces.
2. Create `iterations/iteration-XXX/` under this branch.
3. Create five candidate directories under `candidates/`.
4. Give each candidate a distinct `direction.md`, `agent-brief.md`, and `prompt.txt`.
5. Run `npm run automation:benchmark -- --prompt <candidate prompt> --out <candidate dir>` for each candidate.
6. Promote every candidate whose `deltaCorrectVsBaseline` is at least `+2`.

