# Recommendations

Date: 2026-05-07
Scope: Entire QuickStack codebase

## Priority 1: Critical/High fixes already applied

### 1. Require authenticated and authorized pod terminal access

Status: Applied
Files: `src/socket-io.server.ts`, `src/server/services/terminal.service.ts`, `src/server/services/pod.service.ts`, `src/shared/model/pods-info.model.ts`

The terminal namespace now authenticates Socket.IO connections via NextAuth JWT, loads the user's role, resolves pod ownership, requires write access to the owning app, and rejects mismatched containers before Kubernetes exec.

### 2. Require app authorization for pod log streaming

Status: Applied
Files: `src/app/api/pod-logs/route.ts`, `src/server/services/pod.service.ts`

The pod log route now resolves the pod's app metadata and requires `isAuthorizedReadForApp` before opening the Kubernetes log stream.

### 3. Require app authorization for build log streaming

Status: Applied
Files: `src/app/api/build-logs/route.ts`, `src/server/services/deployment-logs.service.ts`

The build log route now validates UUID deployment ids, reads the owning app id from the log header, and requires `isAuthorizedReadForApp` before streaming.

### 4. Stop logging S3 credentials

Status: Applied
File: `src/server/services/aws-s3.service.ts`

S3 connection-test failures now log only non-secret target metadata.

### 5. Expand page middleware protection

Status: Applied
File: `src/middleware.ts`

Middleware now protects app pages except API, auth, and static asset paths.

### 6. Remove vulnerable dependency advisories

Status: Applied
Files: `package.json`, `yarn.lock`, `src/server/adapter/kubernetes-api.adapter.ts`, Kubernetes service call sites

Direct dependency upgrades, transitive Yarn resolutions, Next 15 compatibility work, and the Kubernetes client 1.x adapter migration reduced `yarn audit --groups dependencies --level low` to 0 vulnerabilities while keeping existing QuickStack service call semantics intact.

## Priority 2: High-risk follow-up work

### 1. Replace privileged builders

BuildKit jobs currently run privileged. Move to rootless BuildKit or another unprivileged builder, isolate builds on tainted nodes, restrict who can trigger builds, and apply namespace-level Pod Security Admission and network policy.

### 2. Bind temp downloads to authorization decisions

Replace basename-only `/api/volume-data-download` access with short-lived server-side download tokens bound to actor, app/resource id, file path, and expiry. Re-check current authorization before streaming.

### 3. Harden webhook deploy triggers

Make deployment webhooks POST-only and require HMAC signatures over body plus timestamp. Reject stale timestamps and replayed signatures, compare in constant time, and add per-app/webhook rate limits.

## Priority 3: Defense in depth

- Move S3 keys, basic-auth passwords, cluster join tokens, Git tokens, and the app encryption key out of ordinary DB/env storage and into Kubernetes Secrets or an external secret manager.
- Use a dedicated encryption key for Git SSH key encryption instead of reusing `NEXTAUTH_SECRET`.
- Stop embedding Git HTTPS credentials into build pod environment variables; use Kubernetes Secrets, mounted credential helpers, or short-lived tokens.
- Replace `StrictHostKeyChecking=no` for SSH builds with known-host pinning.
- Validate S3 endpoint hostnames and reject loopback, link-local, private, and cluster-local addresses unless explicitly allowed.
- Pin Docker images by digest and GitHub Actions by commit SHA.
- Use lockfile-enforced installs in CI and Docker (`yarn install --frozen-lockfile` for Yarn v1).
- Run backup helper containers as non-root with dropped capabilities, read-only root filesystems where possible, and checksum/signature verification for downloaded tools.
