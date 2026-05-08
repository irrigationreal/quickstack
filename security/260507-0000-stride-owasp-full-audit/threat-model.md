# Threat Model

Date: 2026-05-07
Scope: Entire QuickStack codebase
Focus: Comprehensive STRIDE/OWASP audit

## Assets

| Asset | Location | Primary threats |
|---|---|---|
| NextAuth sessions and user roles | `src/server/utils/auth-options.ts`, `src/server/utils/action-wrapper.utils.ts`, Prisma `User`/`UserGroup` models | Spoofing, elevation of privilege, broken access control |
| Project, app, and role permission data | Prisma `Project`, `App`, `RoleProjectPermission`, `RoleAppPermission` | IDOR, information disclosure, privilege escalation |
| Kubernetes cluster control plane access | `src/server/adapter/kubernetes-api.adapter.ts`, `src/server/services/**` | Remote command execution, namespace breakout through service-account permissions, data disclosure |
| Pod logs, build logs, deployment logs | `src/app/api/pod-logs/route.ts`, `src/app/api/build-logs/route.ts`, `src/server/services/deployment-logs.service.ts` | Secret disclosure, broken access control |
| Pod terminal sessions | `src/socket-io.server.ts`, `src/server/services/terminal.service.ts` | Remote command execution, elevation of privilege |
| S3 backup credentials and targets | Prisma `S3Target`, `src/server/services/aws-s3.service.ts` | Credential disclosure, SSRF, backup exfiltration |
| Git/container credentials | Prisma `App` fields, build-job builders, Git SSH key service | Credential disclosure, MITM, supply-chain compromise |
| Volume/system backup artifacts | `src/app/api/volume-data-download/route.ts`, backup/volume actions | Object-level authorization bypass, data exfiltration |
| Deployment/build supply chain | `package.json`, `yarn.lock`, Dockerfiles, GitHub workflows, Kubernetes build jobs | Dependency CVEs, mutable tags, privileged builds |

## Trust boundaries

1. Browser/client to Next.js pages, server actions, API routes, and Socket.IO namespaces.
2. Authenticated user session to role/project/app authorization checks.
3. Next.js server to Prisma/SQLite storage.
4. Next.js server to Kubernetes API using QuickStack service-account permissions.
5. Build jobs to user-controlled Git/container sources.
6. Backup jobs to databases, volumes, and S3-compatible object storage.
7. CI/Docker build pipeline to public npm, base images, and GitHub Actions.

## STRIDE matrix

| Category | Confirmed risk | Notes |
|---|---|---|
| Spoofing | Medium | Webhook deploy route is bearer-token based and unauthenticated by design; leaked URL enables repeated deployment triggers. Socket.IO had no session binding before fix. |
| Tampering | High | Build jobs run privileged, and Git/container inputs reach Kubernetes workloads. Supply-chain dependencies include known high/critical advisories. |
| Repudiation | Medium | Some sensitive operations rely on logs that may contain secrets; log access and terminal access needed stronger actor binding. |
| Information disclosure | High | Unauthenticated pod/build log routes and S3 target logging could expose secrets. Authenticated temp download endpoint lacks object binding. |
| Denial of service | High | Next.js 14.2.35 has high-severity DoS advisories; webhook deploy URL lacks replay/rate controls. |
| Elevation of privilege | Critical | Unauthenticated pod terminal Socket.IO namespace allowed shell exec inside Kubernetes pods before fix. |

## Baseline risk after applied fixes

The directly exploitable unauthenticated pod terminal, pod log, build log, and S3 credential logging issues were mitigated in code. Remaining high-risk areas require larger migration or design work: Next.js 15+ migration for patched advisories, Kubernetes client major-version migration away from vulnerable transitive dependencies, unprivileged/rootless builds, and object-bound download tokens for exported volume/backup artifacts.
