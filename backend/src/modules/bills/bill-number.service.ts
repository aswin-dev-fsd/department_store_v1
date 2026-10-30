// Bill numbers (D-15; AGENTS.md → Bill numbers): one running number per branch and financial year,
// gapless across counters. The one query lives here rather than in a model file: it is the whole
// service, and the task names this file alone.
import { schema, type Tx } from '@ds/database';
import { sql } from 'drizzle-orm';

const { billSequences } = schema;

/**
 * Take the branch's next bill number for the financial year, inside the bill's own transaction.
 *
 * One statement: the first bill of a branch and year inserts the row at 1; every later one adds 1
 * to it. Updating the row locks it until the caller's transaction ends, so a second counter waits
 * and then reads the committed number (no duplicates), and a bill that fails rolls its number back
 * with it, so the next bill reuses it (no gaps). Never call it outside the bill transaction.
 */
export async function allocateBillSeq(tx: Tx, branchId: number, fy: string): Promise<number> {
  const [row] = await tx
    .insert(billSequences)
    .values({ branchId, fy, lastSeq: 1 })
    .onConflictDoUpdate({
      target: [billSequences.branchId, billSequences.fy],
      set: { lastSeq: sql`${billSequences.lastSeq} + 1` },
    })
    .returning({ lastSeq: billSequences.lastSeq });
  return row!.lastSeq;
}
