import { NextResponse } from "next/server";
import { z } from "zod";

import { getRunBatch, requestStopRunBatch } from "@/lib/store";

export const runtime = "nodejs";

const paramsSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const patchRunSchema = z.object({
  action: z.literal("stop"),
});

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = paramsSchema.parse(await context.params);
  const batch = await getRunBatch(params.id);
  if (!batch) {
    return NextResponse.json({ error: "Run batch not found." }, { status: 404 });
  }

  return NextResponse.json({ batch });
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const params = paramsSchema.parse(await context.params);
  patchRunSchema.parse(await request.json());

  const batch = await requestStopRunBatch(params.id);
  if (!batch) {
    return NextResponse.json({ error: "Run batch not found." }, { status: 404 });
  }

  return NextResponse.json({ batch });
}
