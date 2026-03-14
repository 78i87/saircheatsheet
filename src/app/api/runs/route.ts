import { NextResponse } from "next/server";
import { z } from "zod";

import { createRunBatch, listRunBatches } from "@/lib/store";

export const runtime = "nodejs";

const createRunSchema = z.object({
  problemIds: z.array(z.number().int().positive()).min(1),
  modelId: z.string().min(1),
  reasoningMode: z.enum(["default", "low"]),
  cheatsheetId: z.number().int().positive().nullable(),
});

export async function GET() {
  const batches = await listRunBatches();
  return NextResponse.json({ batches });
}

export async function POST(request: Request) {
  const payload = createRunSchema.parse(await request.json());
  const batchId = await createRunBatch(payload);
  return NextResponse.json({ batchId }, { status: 201 });
}
