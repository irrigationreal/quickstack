# Dependency Audit

Date: 2026-05-07
Commands used:

- `yarn audit --groups dependencies --level high`
- `yarn audit --groups dependencies --level moderate`
- `yarn audit --groups dependencies --level low`

## Changes applied

Direct package upgrades applied in `package.json` and `yarn.lock`:

- `@aws-sdk/client-s3` -> `^3.1045.0`
- `@kubernetes/client-node` -> `^1.4.0`
- `next` -> `15.5.18`
- `next-auth` -> `^4.24.14`
- `socket.io` -> `^4.8.3`
- `socket.io-client` -> `^4.8.3`
- `bcrypt` -> `^6.0.0`
- `@types/bcrypt` -> `^6.0.0`
- `@prisma/client` -> `7.8.0`
- `prisma` -> `7.8.0`
- `@prisma/adapter-better-sqlite3` -> `7.8.0`
- `recharts` -> `^2.15.4`
- `simple-git` -> `^3.36.0`
- `tar` -> `^7.5.11`
- Vitest/tooling packages were updated with the lockfile migration.

Yarn resolutions added for vulnerable transitive packages where the parent packages did not yet resolve patched versions:

- `@babel/runtime` -> `^7.26.10`
- `@hono/node-server` -> `^1.19.13`
- `diff` -> `^4.0.4`
- `js-yaml` -> `^4.1.1`
- `postcss` -> `^8.5.10`
- `recharts/lodash` -> `^4.18.1`
- `socket.io-parser` -> `^4.2.6`

Prisma client was regenerated with `DATABASE_URL="file:./dev.db" yarn prisma-generate` after the Prisma package upgrade.

## Public API compatibility work

The `@kubernetes/client-node` 1.x migration changes API method signatures and response shapes. To preserve the existing service contract, `src/server/adapter/kubernetes-api.adapter.ts` now wraps generated clients and maps existing positional calls into the new object-parameter form, then returns the legacy `{ body: result }` shape expected by services. Existing service methods still call `k3s.core.listNamespacedPod(namespace)`, `k3s.network.replaceNamespacedIngress(name, namespace, body)`, and similar APIs as before.

Call sites that depended on implicit `any` list responses were given explicit Kubernetes list response types. `KubernetesObjectApi.read` usage in `src/server/services/upgrade-services/k3s-update.service.ts` was adjusted because the current client returns the object directly rather than `{ body }`.

The Next 15 migration required small app surface compatibility updates already reflected in the changed page/layout files and `next.config.mjs`. The behavioral contract remains: the same routes render, the same API route names exist, and the production build emits the same app pages/API surfaces.

## Final audit result

`yarn audit --groups dependencies --level low` now reports:

```text
0 vulnerabilities found - Packages audited: 643
```

## Validation evidence

- `yarn install` completed and saved the lockfile. The optional `cpu-features` native build failed because local Python 3.14's `pyexpat` cannot load against the system libexpat; Yarn marked it optional and completed.
- `DATABASE_URL="file:./dev.db" yarn prisma-generate` succeeded earlier in this remediation and generated Prisma Client v7.8.0.
- `DATABASE_URL="file:./dev.db" yarn build` succeeded on Next 15.5.18 after clearing generated `.next` output. One earlier retry failed with `ENOSPC` while copying `.next/standalone`; disk had only 117 MiB free before removing the generated build output.
- `DATABASE_URL="file:./dev.db" yarn test --project jsdom` passed: 31 files, 269 tests.
- Full `DATABASE_URL="file:./dev.db" yarn test` still cannot complete in this local environment because Testcontainers cannot find a working container runtime for K3s integration suites. Before that environment failure, the only unit failure was the cron UTC contract; `CronCheckUtils` now evaluates standard cron expressions in UTC and the jsdom suite passes.

## Remaining dependency work

No production dependency advisories remain in `yarn audit --groups dependencies --level low` as of this report. The remaining security work is design/architecture rather than dependency remediation: unprivileged build isolation, actor-bound temp downloads, signed webhook deploy triggers, secret handling hardening, and S3 endpoint validation.
