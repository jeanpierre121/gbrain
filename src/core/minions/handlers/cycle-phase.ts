/**
 * Phase-wrapper Minion job handlers (built-in; registered by registerBuiltinHandlers in
 * src/commands/jobs.ts for synthesize, patterns, consolidate, extract_facts,
 * resolve_symbol_edges and recompute_emotional_weight).
 */
import type { BrainEngine } from '../../engine.ts';
import type { MinionHandler } from '../types.ts';

/**
 * Phase-wrapper handlers — each delegates to runCycle({ phases: [name] }).
 * Cycle owns the lock + abort signal + progress reporter per D10.
 * Smaller diff than full standalone phase extraction; cycle.ts remains
 * the single source of truth for phase semantics.
 */
export function makeCyclePhaseHandler(engine: BrainEngine, phase: string): MinionHandler {
  return async (job: any) => {
    const { runCycle } = await import('../../cycle.ts');
    const { resolveBrainDir } = await import('../../brain-dir.ts');
    // v0.41.38 (codex P2 review): fall back to null (NOT cwd '.') when no repo
    // is configured, matching the autopilot-cycle handler + `gbrain dream`. On a
    // checkout-less postgres brain a filesystem phase (synthesize/patterns/...)
    // skips with reason 'no_brain_dir' instead of running against the worker cwd;
    // DB-only phases (resolve_symbol_edges/embed/...) ignore brainDir either way.
    //
    // Fork carry (run/full-facts): every path is checked on disk
    // (src/core/brain-dir.ts), and an optional `source_id` (validated like the
    // autopilot-cycle handler) takes the per-source cycle lock
    // (`gbrain-cycle:<id>`) and binds to that source's checkout, so a queued
    // `extract_facts` for one source never runs against the global checkout
    // under the legacy lock. A payload WITHOUT source_id resolves the global
    // path and the legacy lock as before.
    const explicitRepoPath: string | null = typeof job.data.repoPath === 'string'
      ? job.data.repoPath
      : null;
    let sourceId: string | undefined;
    const rawSourceId = job.data.source_id;
    if (rawSourceId !== undefined && rawSourceId !== null) {
      const { isValidSourceId } = await import('../../source-id.ts');
      if (typeof rawSourceId !== 'string' || !isValidSourceId(rawSourceId)) {
        throw new Error(`${phase}: invalid source_id: ${JSON.stringify(rawSourceId)}`);
      }
      sourceId = rawSourceId;
    }
    const brainDirResolution = await resolveBrainDir(engine, sourceId ? null : explicitRepoPath, sourceId, { explicitMustBeAbsolute: true });
    if (brainDirResolution.reason === 'explicit_missing') {
      throw new Error(`${phase}: repoPath does not exist: ${explicitRepoPath} (brain_dir: explicit_missing)`);
    }
    const report = await runCycle(engine, {
      brainDir: brainDirResolution.dir,
      phases: [phase as any],
      signal: job.signal,
      deadlineAtMs: job.deadlineAtMs, // #2781: phases budget sub-work from remaining time
      privateQueueOwnerJobId: job.id,
      ...(sourceId ? { sourceId } : {}),
    });
    return { phase, status: report.status, report, brain_dir_reason: brainDirResolution.reason };
  };
}
