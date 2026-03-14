# SAIR Model Eval

Local/self-hosted web app for benchmarking OpenRouter models on the SAIR equational-theory implication dataset.

## Features

- Run batches against the `normal` and `hard` SAIR problem banks.
- Select between:
  - `openai/gpt-oss-120b`
  - `x-ai/grok-4.1-fast`
  - `google/gemini-3.1-flash-lite-preview`
  - `meta-llama/llama-3.3-70b-instruct`
- Optional saved cheatsheets injected into the system prompt.
- Automatic verdict parsing and correctness scoring against the dataset label.
- Batch history with prompt, response, timing, tokens, reasoning tokens, and estimated cost.
- Durable local storage with SQLite.

## Setup

1. Install dependencies:

```bash
npm install
```

2. Create a local environment file:

```bash
cp .env.example .env.local
```

3. Set `OPENROUTER_API_KEY` in `.env.local`.

4. Start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

On first startup the app will download and seed:

- `1000` normal problems
- `200` hard problems

The SQLite database is stored at `data/sair-model-eval.sqlite`.

## Scripts

- `npm run dev`
- `npm run lint`
- `npm run test`
- `npm run build`

## Technical Notes

- OpenRouter calls are made server-side only.
- Run batches execute in the background with concurrency `5`.
- Cost is estimated from token usage and a pricing snapshot fetched from OpenRouter at run time, with a static fallback if the model catalog request fails.
- Llama 3.3 70B Instruct does not expose the low-reasoning toggle, so the UI disables it for that model.

## Verification

```bash
npm run lint
npm run test
npm run build
```

## Sources

- [OpenRouter model catalog](https://openrouter.ai/api/v1/models)
- [SAIR dataset](https://huggingface.co/datasets/SAIRfoundation/equational-theories-selected-problems)

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
