# Tasks: [QuickStack CLI] Feature-compatibility lifecycle RFC

**Spec:** ../quickstack-cli-lifecycle-spec.md
**PRD/BR:** none provided
**Created:** 2026-05-13
**Status:** 11/11 complete

## Task list

| ID | Title | Phase | Depends on | Status |
|----|-------|-------|------------|--------|
| TASK-001 | Stand up the CLI package, binary distribution, and skill rename — CLI package scaffolding | 0 | — | completed |
| TASK-002 | Stand up the CLI package, binary distribution, and skill rename — server distribution and skill rename | 0 | TASK-001 | completed |
| TASK-003 | Make `quickstack` the canonical CLI and state surface | 1 | TASK-002 | completed |
| TASK-004 | Port the scanner into an evidence-first planner | 2 | TASK-003 | completed |
| TASK-005 | Port the image, build, and deployer model | 3 | TASK-003, TASK-004 | completed |
| TASK-006 | Add rollout watch, releases, logs, and operator diagnostics | 4 | TASK-003, TASK-005 | completed |
| TASK-007 | Add full app lifecycle and configuration verbs | 5 | TASK-003, TASK-005 | completed |
| TASK-008 | Add networking, domains, certificates, and proxy access | 6 | TASK-003, TASK-007 | completed |
| TASK-009 | Add volumes, runtime controls, and remote access | 7 | TASK-003, TASK-007 | completed |
| TASK-010 | Deepen managed services and app composition | 8 | TASK-003, TASK-008 | completed |
| TASK-011 | Add multi-user safety, tokens, and agent ergonomics | 9 | TASK-003, TASK-006, TASK-010 | completed |

## Notes

- The spec is delivered as **one PR** with phase-ordered commits. Tasks here mirror that execution order; they are not separate PRs.
- Phase 0 was split into TASK-001 (CLI package scaffolding) and TASK-002 (server distribution + skill rename) because the Changes list has 15 items across two distinct concerns. Both share `phase: 0`.
- Manual verification steps from the spec (deploying sample apps, opening a real shell session, etc.) are listed under each task's acceptance criteria but require a running QuickStack environment to execute.

## Known callouts for the executing agent

- **TASK-002 — Next.js routing:** The spec literally says `src/app/api/cli/install.sh/route.ts`, but Next.js App Router cannot have a `.` in a static segment without escaping. TASK-002 documents three remediation options (default: install URL becomes `/api/cli/install`).
- **TASK-005 — remote builder:** The route, contract, and CLI flag must exist; the actual remote build backend is allowed to be a stub that returns "not configured." Acceptance criterion pins the stub behavior.
- **TASK-007 — suspend/resume:** Initially excluded because no phase owned them; the user gave an explicit execution pass during autodrive, so they were implemented as a lifecycle extension rather than left as a follow-up.
- **TASK-009 — checks mutation:** Pinned to `PATCH` on the existing `checks/route.ts`, not a sibling route, so the agent doesn't waffle.

