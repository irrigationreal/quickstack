# Security Findings

Date: 2026-05-07
Scope: Entire QuickStack codebase

## Finding 1: Unauthenticated pod terminal exec

Severity: Critical
Status: Confirmed and fixed
OWASP: A01 Broken Access Control
STRIDE: Elevation of privilege

Location: `src/socket-io.server.ts:7-10`, `src/server/services/terminal.service.ts:26-62`

Before the fix, the `/pod-terminal` Socket.IO namespace accepted connections without authenticating the caller. The `openTerminal` event trusted client-supplied `namespace`, `podName`, and `containerName`, waited for the pod, then opened `/bin/sh` or `/bin/bash` through the Kubernetes exec API. A remote unauthenticated client with a known pod name could execute commands inside pods reachable by QuickStack's Kubernetes service account.

Fix applied: `src/socket-io.server.ts:11-26` now authenticates Socket.IO connections with `next-auth/jwt` and stores the user's session role on `socket.data`. `src/server/services/terminal.service.ts:41-52` now resolves the pod, requires an owning app id, requires write access to that app, and rejects mismatched containers before exec.

## Finding 2: Unauthenticated arbitrary pod log streaming

Severity: High
Status: Confirmed and fixed
OWASP: A01 Broken Access Control
STRIDE: Information disclosure

Location: `src/app/api/pod-logs/route.ts:17-31`

Before the fix, `/api/pod-logs` accepted a caller-supplied namespace and pod name, resolved the pod, and streamed Kubernetes logs without any session or app-level authorization check. This could expose application, build, database-tool, or system pod logs depending on service-account permissions and pod name knowledge.

Fix applied: `src/app/api/pod-logs/route.ts:25-31` now resolves the pod metadata, requires an app id, and calls `isAuthorizedReadForApp` before opening the Kubernetes log stream. `src/server/services/pod.service.ts:23-30` now returns app/project metadata from pod annotations or labels.

## Finding 3: Unauthenticated build log streaming

Severity: High
Status: Confirmed and fixed
OWASP: A01 Broken Access Control
STRIDE: Information disclosure

Location: `src/app/api/build-logs/route.ts:8-19`, `src/server/services/deployment-logs.service.ts:43-66`

Before the fix, `/api/build-logs` accepted an arbitrary `deploymentId` string and streamed the matching deployment log if it existed. Build/deployment logs include app id, project id, build method, Git metadata, build steps, and error output; failed builds can also leak operational details.

Fix applied: `src/app/api/build-logs/route.ts:8-19` now validates deployment ids as UUIDs, resolves the owning app from the deployment log header, and calls `isAuthorizedReadForApp` before streaming. `src/server/services/deployment-logs.service.ts:43-66` adds bounded header parsing for the owning app id.

## Finding 4: S3 credentials logged on connection-test failure

Severity: High
Status: Confirmed and fixed
OWASP: A09 Security Logging and Monitoring Failures
STRIDE: Information disclosure

Location: `src/server/services/aws-s3.service.ts:11-23`, Prisma `S3Target` model in `prisma/schema.prisma`

Before the fix, a failed S3 connection test logged the entire `S3Target` Prisma object. That model stores `accessKeyId` and `secretKey`, so a connection failure could place object-storage credentials into server logs. Combined with the unauthenticated pod-log route, this became a direct credential disclosure chain.

Fix applied: `src/server/services/aws-s3.service.ts:16-23` logs only non-secret fields: id, name, endpoint, bucket name, and region.

## Finding 5: Middleware protected only the root page

Severity: High
Status: Confirmed and fixed
OWASP: A01 Broken Access Control
STRIDE: Spoofing / elevation of privilege

Location: `src/middleware.ts:1-5`

Before the fix, NextAuth middleware used `matcher: ["/"]`, so only the root route was covered by middleware. Many server actions and pages had their own checks, but page-level middleware did not protect `/project/...`, `/settings/...`, `/backups`, `/builds`, or `/monitoring`.

Fix applied: `src/middleware.ts:3-4` now protects non-API, non-auth, non-static app pages.

## Finding 6: Vulnerable production dependency tree

Severity: High
Status: Confirmed and fixed
OWASP: A06 Vulnerable and Outdated Components
STRIDE: Tampering / denial of service

Location: `package.json`, `yarn.lock`

`yarn audit --groups dependencies --level high` initially reported critical/high advisories across direct and transitive dependencies, including AWS SDK XML parsing, simple-git RCE advisories, socket.io-parser unbounded attachments, bcrypt/node-pre-gyp tar/minimatch issues, Prisma dev/config dependencies, Recharts/lodash, Next.js DoS advisories, and Kubernetes client transitive dependencies.

Fix applied: upgraded `@aws-sdk/client-s3`, `simple-git`, `next`, `next-auth`, `@kubernetes/client-node`, `socket.io`, `socket.io-client`, `bcrypt`, `@types/bcrypt`, Prisma packages, `recharts`, and `tar`; added Yarn resolutions for patched transitive packages including `@babel/runtime`, `@hono/node-server`, `diff`, `js-yaml`, `postcss`, `recharts/lodash`, and `socket.io-parser`.

Compatibility work preserved the existing internal Kubernetes service contract through `src/server/adapter/kubernetes-api.adapter.ts`, which maps legacy positional calls to the Kubernetes client 1.x object-parameter API and returns the legacy `{ body }` response shape. `yarn audit --groups dependencies --level low` now reports 0 vulnerabilities.

## Finding 7: Authenticated temp artifact downloads lack object binding

Severity: Medium
Status: Confirmed, not fixed in this pass
OWASP: A01 Broken Access Control
STRIDE: Information disclosure

Location: `src/app/api/volume-data-download/route.ts:11-30`

The route requires a session and blocks basic basename traversal, but it does not bind the requested filename to the actor, app, volume, or original authorization decision that created the artifact. Any authenticated user who learns a temp export filename can download the artifact while it exists.

Recommended fix: generate short-lived random download tokens server-side, store token -> actor/resource/file mapping, and require the token plus current authorization before streaming. Delete or expire artifacts aggressively.

## Finding 8: Webhook deploy URLs are static bearer secrets without replay controls

Severity: Medium
Status: Confirmed, not fixed in this pass
OWASP: A07 Identification and Authentication Failures
STRIDE: Spoofing / denial of service

Location: `src/app/api/v1/webhook/deploy/route.ts:14-30`, `src/server/services/app.service.ts:250-257`

Webhook ids are 32 random bytes encoded as hex, so guessing is impractical. The route is intentionally unauthenticated. The risk is operational: URLs are bearer tokens in query strings, and a leaked URL can trigger repeated deploys because there is no POST-only requirement, HMAC signature, timestamp, replay window, or rate limiting.

Recommended fix: make the route POST-only, require an HMAC signature over body and timestamp, compare in constant time, reject stale timestamps/replays, and rate-limit per app/webhook id.

## Finding 9: Privileged build workloads

Severity: High
Status: Confirmed, not fixed in this pass
OWASP: A05 Security Misconfiguration
STRIDE: Tampering / elevation of privilege

Location: `src/server/services/build-job-builders/dockerfile-build-job-builder.service.ts`, `src/server/services/build-job-builders/railpack-build-job-builder.service.ts`

Dockerfile and Railpack build jobs run BuildKit containers as privileged. Because build contexts and Dockerfiles can come from user-controlled repositories, a malicious build has a larger path to node compromise.

Recommended fix: move to rootless BuildKit or another unprivileged builder, isolate builds on tainted nodes, restrict build triggers, and enforce Pod Security Admission and restrictive network policies around the build namespace.
