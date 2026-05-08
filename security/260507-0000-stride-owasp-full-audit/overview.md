# Security Audit — STRIDE/OWASP Full Audit

Date: 2026-05-07
Scope: Entire QuickStack codebase
Focus: Comprehensive
Iterations: 10 completed, unlimited mode stopped after confirmed Critical/High fixes, dependency migration, validation, and report update

## Summary

Total findings: 9 plus 1 dependency-migration validation entry

- Critical: 1
- High: 5
- Medium: 2
- Info: 2 baseline/validation items
- Confirmed: 8
- Fixed in this pass: 6 code/dependency findings

The most serious issue was unauthenticated Socket.IO pod terminal access, which allowed Kubernetes exec into caller-selected pods. That Critical issue is fixed. The audit also confirmed unauthenticated pod-log and build-log streaming, S3 credential logging, narrow page middleware coverage, vulnerable dependency trees, temp artifact download authorization gaps, webhook replay/signature gaps, and privileged build workloads.

The dependency remediation is now complete for the current production audit: `yarn audit --groups dependencies --level low` reports 0 vulnerabilities after direct upgrades, Next 15 migration work, Kubernetes client 1.x compatibility work, and transitive resolutions.

## Top findings

1. [Unauthenticated pod terminal exec](./findings.md#finding-1-unauthenticated-pod-terminal-exec) — fixed by requiring NextAuth-backed Socket.IO sessions and app write authorization before Kubernetes exec.
2. [Unauthenticated arbitrary pod log streaming](./findings.md#finding-2-unauthenticated-arbitrary-pod-log-streaming) — fixed by resolving pod ownership and requiring app read authorization.
3. [Unauthenticated build log streaming](./findings.md#finding-3-unauthenticated-build-log-streaming) — fixed by UUID validation, owning-app lookup, and app read authorization.
4. [S3 credentials logged on connection-test failure](./findings.md#finding-4-s3-credentials-logged-on-connection-test-failure) — fixed by sanitized logging.
5. [Vulnerable production dependency tree](./findings.md#finding-6-vulnerable-production-dependency-tree) — fixed by dependency upgrades, compatibility work, and audited transitive resolutions.

## Files in this report

- [Threat Model](./threat-model.md) — STRIDE analysis, assets, and trust boundaries.
- [Attack Surface Map](./attack-surface-map.md) — entry points, data flows, abuse paths, and controls added.
- [Findings](./findings.md) — severity-ranked findings with evidence and mitigations.
- [OWASP Coverage](./owasp-coverage.md) — OWASP Top 10 coverage matrix and notes.
- [Dependency Audit](./dependency-audit.md) — audit command results, package upgrades, compatibility notes, and validation.
- [Recommendations](./recommendations.md) — prioritized remediation plan.
- [Iteration Log](./security-audit-results.tsv) — raw iteration log.

## Code changes made

- Added NextAuth token authentication to the `/pod-terminal` Socket.IO namespace.
- Added app write authorization before Kubernetes terminal exec.
- Added pod metadata ownership to pod info models/services.
- Added app read authorization to pod log streaming.
- Added UUID validation and app read authorization to build log streaming.
- Added bounded deployment-log header parsing to resolve owning app ids.
- Sanitized S3 connection-test logging to avoid credential disclosure.
- Expanded NextAuth middleware page coverage beyond `/`.
- Upgraded vulnerable direct dependencies, migrated Next to 15.5.18, migrated `@kubernetes/client-node` to 1.4.0, and added patched transitive resolutions.
- Added a Kubernetes client adapter compatibility layer so existing service calls keep the old positional-argument and `{ body }` response contract.
- Fixed Kubernetes call-site types exposed by the client migration.
- Kept cron schedule evaluation in UTC to preserve the tested backup scheduling contract after dependency/toolchain changes.
- Added `security-audit-results.tsv` to `.gitignore`.

## Validation

- `yarn install` completed and saved the lockfile. The optional `cpu-features` native build failed due to local Python 3.14/libexpat linkage, but Yarn marked it optional and completed.
- `DATABASE_URL="file:./dev.db" yarn prisma-generate` completed earlier in the remediation and generated Prisma Client v7.8.0.
- `yarn audit --groups dependencies --level low` reports 0 vulnerabilities.
- `DATABASE_URL="file:./dev.db" yarn build` completed successfully on Next 15.5.18. An earlier retry failed with `ENOSPC` while copying `.next/standalone`; clearing generated `.next` output freed enough space and the retry passed.
- `DATABASE_URL="file:./dev.db" yarn test --project jsdom` passed: 31 files, 269 tests.
- Full `DATABASE_URL="file:./dev.db" yarn test` could not complete locally because Testcontainers cannot find a working container runtime for K3s integration suites. That is an environment blocker, not a code assertion failure from this migration.

## Remaining work

The remaining security work is design/architecture work: temp downloads should use short-lived actor/resource-bound tokens, webhooks should use signed POST requests with replay protection, build jobs should move away from privileged builders, secrets should be moved out of ordinary DB/env storage where practical, and S3-compatible endpoint configuration should reject internal network targets unless explicitly allowed.
