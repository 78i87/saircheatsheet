export async function runWithConcurrency<TInput>(
  items: TInput[],
  concurrency: number,
  worker: (item: TInput, index: number) => Promise<void>,
) {
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const current = cursor;
      cursor += 1;
      await worker(items[current], current);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length || 1));
  await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
}
