# Attack Surface Map

Date: 2026-05-07
Scope: Entire QuickStack codebase

## Entry points reviewed

| Surface | Files | Security boundary |
|---|---|---|
| Authentication | `src/app/api/auth/[...nextauth]/route.ts`, `src/server/utils/auth-options.ts`, `src/app/auth/actions.ts` | Credential auth, 2FA, session issuance |
| Middleware | `src/middleware.ts` | Page-level session enforcement |
| Server actions | `src/app/**/actions.ts` | Authenticated app/project/admin operations |
| Build logs | `src/app/api/build-logs/route.ts` | Deployment log streaming by deployment id |
| Pod logs | `src/app/api/pod-logs/route.ts` | Kubernetes pod log streaming by namespace/pod |
| Download endpoints | `src/app/api/logs-download/route.ts`, `src/app/api/volume-data-download/route.ts` | File download from generated artifacts |
| Deployment status | `src/app/api/deployment-status/route.ts` | Authenticated app status polling |
| Webhook deploy | `src/app/api/v1/webhook/deploy/route.ts` | Bearer URL deploy trigger |
| Socket.IO terminal | `src/socket-io.server.ts`, `src/server/services/terminal.service.ts` | Interactive Kubernetes exec |
| Kubernetes services | `src/server/services/**`, `src/server/adapter/kubernetes-api.adapter.ts` | Deployment, pod, service, ingress, network policy, backup, restore operations |
| Supply chain | `package.json`, `yarn.lock`, `Dockerfile`, `.github/workflows/*` | Dependency install/build/release path |

## Key data flows

1. Authenticated UI -> server action -> `isAuthorizedReadForApp`/`isAuthorizedWriteForApp` -> service -> Prisma/Kubernetes.
2. Client log component -> `/api/pod-logs` -> pod metadata lookup -> app authorization -> Kubernetes log stream.
3. Client build log component -> `/api/build-logs` -> deployment log header app lookup -> app authorization -> filesystem stream.
4. Client terminal component -> Socket.IO `/pod-terminal` -> NextAuth JWT extraction -> user role lookup -> pod app lookup -> write authorization -> Kubernetes exec.
5. Backup/volume export action -> temp file creation -> `/api/volume-data-download` authenticated file retrieval.
6. CI/Docker build -> Yarn dependency resolution -> Next/server TypeScript build -> container image.

## Abuse paths validated

1. Unauthenticated Socket.IO connection to `/pod-terminal`, followed by `openTerminal` with attacker-selected namespace/pod/container, reached Kubernetes exec before the fix.
2. Unauthenticated POST to `/api/pod-logs` with namespace and pod name streamed logs before the fix.
3. Unauthenticated POST to `/api/build-logs` with a deployment id streamed deployment logs before the fix.
4. Failed S3 target connection logged the full Prisma object, including `accessKeyId` and `secretKey`, before the fix.
5. Authenticated download of temp export artifacts can still retrieve files by basename without binding artifact ownership to a user, app, or authorization decision.
6. Leaked webhook deploy URL can trigger repeated deployments because it is a static bearer secret in the query string.

## Controls added in this pass

- Socket.IO `/pod-terminal` now authenticates via NextAuth token and loads the user's role before accepting terminal events.
- Terminal open events now resolve pod metadata and require write access to the owning app.
- Pod log streaming now resolves pod metadata and requires read access to the owning app.
- Build log streaming now validates UUID deployment ids, resolves the owning app from the deployment log header, and requires read access.
- S3 connection-test logging now redacts access keys and secret keys.
- Middleware now protects all non-API/non-auth app pages instead of only `/`.
