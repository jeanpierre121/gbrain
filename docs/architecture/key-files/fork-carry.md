# Fork carry (run/full-facts)

Behaviour this fork keeps on top of upstream `latest-stable`.
Each item names the module that owns it.
Re-check every item at each upstream merge.

- `src/core/db-lock.ts` `lockHostIdentity()`: the host written into lock rows and compared by the dead-holder reaper, the sync lock break path, the supervisor cross-host check, the persistence journal's lease-holder test, the migration lease check and doctor's supervisor singleton check.
  `GBRAIN_LOCK_HOST` overrides `os.hostname()` for hosts whose hostname is not unique per process space (every Modal container reports `modal` and runs its worker as PID 2).
  A containerized plane sets it to a per-container id, so holders in other containers are `cross_host` and only the TTL plus steal grace can take a lock over.
- `src/core/brain-dir.ts` `resolveBrainDir(engine, explicit, sourceId)`: the one place that decides where a cycle's filesystem phases run (`gbrain dream`, the `autopilot-cycle` and `autopilot-global-maintenance` handlers and the per-phase handlers in `src/core/minions/handlers/`).
  Every path is checked on disk; a missing explicit path fails the job with `explicit_missing`; job results carry `brain_dir_reason`.
- `src/core/minions/handlers/cycle-phase.ts`: a phase job may carry `source_id`; it then takes the per-source cycle lock and binds to that source's checkout.
- `src/core/minions/handlers/autopilot-global-maintenance.ts`: a payload that names phases, none of them a maintenance phase, returns `status: skipped` with `report.reason: no_valid_phases` instead of running the full list.
- `src/core/cycle.ts` `formatPhaseLogLine`: one `[cycle.phase] name=<phase> event=start|end` stderr line per phase boundary; `extract_facts` refreshes the cycle lock through `ExtractFactsOpts.yieldDuringPhase`.
- `src/core/cycle/synthesize.ts`: when the daily synthesis cap is already spent, a transcript with no coalescible job row is skipped before chunking.
- `src/core/minions/queue.ts`: dream-inline queues stay live while their cycle lock is fresh (the #4250 ownership rule).
- `src/core/facts/reader-trust.ts`: fail-closed fact-read trust plus the `facts.trust_local_reads` owner opt-in for the stdio MCP pipe (`trustedFactReads`, set only by `src/mcp/server.ts`).
  `find_trajectory`, `recall` and the hot-memory `_meta` hook honour it; the hot-memory cache keys an owner-trusted reader as its own tier.
- `src/core/postgres-engine.ts` / `src/core/pglite-engine.ts` `searchKeyword`: the AND->OR retry is best-effort; a `statement_timeout` cancel keeps the strict-AND rows.
- `src/commands/extract-conversation-facts/` (`email.ts`, `entity-slug-canonicalizer.ts`, `model-flag.ts`): email-collector thread pages (`## From — RFC-2822 date (sent|received)`, builtin pattern `email-collector-thread`), the automated-sender denylist (`facts.email_automated_senders`), out-of-scope email skips, save-time slug canonicalization and the `--model` gate (CLI, job handler and core; `job.data.model` is forwarded).
