import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/config/env";
import { getRepository } from "@/lib/database";
import { ensureMemoryReady } from "@/lib/memory/bootstrap";
import { runAutonomousCycle, saveCycle, lastCycle } from "@/backend/planner/autonomous-cycle";
import { DEFAULT_CYCLE_BUDGET } from "@/backend/planner/next-objective";

/**
 * FASE 5.6 — the scheduled trigger.
 *
 * Point Vercel Cron, GitHub Actions or n8n at this. There is no resident
 * process doing the scheduling: in a serverless deployment a `setInterval`
 * dies with the instance and duplicates itself across instances, so the
 * schedule lives outside and this endpoint is the door.
 *
 * The door is locked with a shared secret compared in constant time. Without
 * `AUTONOMOUS_CYCLE_SECRET` configured the endpoint refuses every request
 * rather than defaulting to open — an unauthenticated endpoint that spends
 * real time and real requests is not a default anyone should get by accident.
 */

// A cycle takes minutes, so this must not run on the edge or be prerendered.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function authorized(request: Request): { ok: true } | { ok: false; status: number; message: string } {
  const configured = env.AUTONOMOUS_CYCLE_SECRET;

  if (!configured) {
    return {
      ok: false,
      status: 503,
      message:
        "AUTONOMOUS_CYCLE_SECRET no está configurado. El endpoint permanece cerrado hasta que lo esté.",
    };
  }

  const header = request.headers.get("authorization") ?? "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";

  const expected = Buffer.from(configured);
  const actual = Buffer.from(presented);

  // Compare padded buffers of equal length: timingSafeEqual throws on a
  // length mismatch, and that throw would itself leak the secret's length.
  const size = Math.max(expected.length, actual.length);
  const expectedPadded = Buffer.alloc(size);
  const actualPadded = Buffer.alloc(size);
  expected.copy(expectedPadded);
  actual.copy(actualPadded);

  if (expected.length !== actual.length || !timingSafeEqual(expectedPadded, actualPadded)) {
    return { ok: false, status: 401, message: "Credencial no válida." };
  }

  return { ok: true };
}

export async function POST(request: Request) {
  const auth = authorized(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  // Without this the cycle would run against an empty memory and "learn"
  // from nothing, concluding there is no history every single time.
  const memory = await ensureMemoryReady();
  const repository = await getRepository();

  const record = await runAutonomousCycle({
    repository,
    trigger: "cron",
    budget: DEFAULT_CYCLE_BUDGET,
  });

  saveCycle(record);

  return NextResponse.json(
    {
      id: record.id,
      status: record.status,
      persistent: memory.persistent,
      persistenceNote: memory.reason,
      objective: {
        statement: record.goal.statement,
        mode: record.selectionMode,
        reason: record.selectionReason,
        sampleSize: record.sampleSize,
      },
      adjustmentsApplied: record.adjustmentsApplied.filter((a) => a.applied).length,
      adjustmentsRefused: record.adjustmentsApplied.filter((a) => !a.applied).length,
      targetsExecuted: record.targetsExecuted,
      businessesAnalyzed: record.businessesAnalyzed,
      leadsProduced: record.leadsProduced,
      durationMs: record.durationMs,
      estimatedCostUsd: record.estimatedCostUsd,
      stoppedBecause: record.stoppedBecause,
      error: record.error,
    },
    { status: record.status === "COMPLETED" ? 200 : 500 }
  );
}

/** Health/status probe for the scheduler, so a cron can check without running one. */
export async function GET(request: Request) {
  const auth = authorized(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.message }, { status: auth.status });
  }

  const memory = await ensureMemoryReady();
  const last = lastCycle();

  return NextResponse.json({
    ready: true,
    persistent: memory.persistent,
    persistenceNote: memory.reason,
    budget: DEFAULT_CYCLE_BUDGET,
    lastCycle: last
      ? {
          id: last.id,
          status: last.status,
          finishedAt: last.finishedAt,
          leadsProduced: last.leadsProduced,
          objective: last.goal.statement,
        }
      : null,
  });
}
