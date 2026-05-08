# OWASP Coverage

Date: 2026-05-07
Scope: Entire QuickStack codebase

| ID | Category | Tested | Findings | Status |
|---|---:|---:|---:|---|
| A01 | Broken Access Control | Yes | 4 | Issues found and partially fixed |
| A02 | Cryptographic Failures | Yes | 1 | Design risk: `NEXTAUTH_SECRET` also protects encrypted SSH keys |
| A03 | Injection | Yes | 0 confirmed app-code RCE/injection from reviewed paths | No direct shell injection confirmed in Git/build command paths |
| A04 | Insecure Design | Yes | 3 | Temp download artifacts, webhook replay controls, privileged builds |
| A05 | Security Misconfiguration | Yes | 4 | Middleware scope, privileged builds, mutable build inputs, dependency install flags |
| A06 | Vulnerable and Outdated Components | Yes | 1 | Fixed; dependency audit reports 0 vulnerabilities |
| A07 | Identification and Authentication Failures | Yes | 2 | Socket.IO auth fixed; webhook bearer URL remains design risk |
| A08 | Software and Data Integrity Failures | Yes | 3 | Privileged builds, Git credential exposure in pod env, mutable tags/actions |
| A09 | Security Logging and Monitoring Failures | Yes | 1 | S3 credential logging fixed |
| A10 | Server-Side Request Forgery | Yes | 1 possible | S3 endpoint configuration can target internal hosts if attacker controls S3 target settings |

## Per-category notes

A01 coverage traced NextAuth middleware, server actions, API routes, pod/build log routes, project/app permission checks, Socket.IO terminal access, and temp download routes. The Critical terminal issue and High log routes were fixed. The temp download endpoint still needs object-bound tokens.

A02 coverage reviewed password hashing, TOTP checks, Git SSH key encryption, and secret storage. Password hashing uses bcrypt; Git SSH private keys are encrypted, but the encryption key is derived from `NEXTAUTH_SECRET`, which is also present in deployment env.

A03 coverage checked Git/build shell construction, Kubernetes exec/cp helpers, log/download path handling, and generated input schemas. No direct shell injection was confirmed in reviewed Git/build paths; Kubernetes exec terminal access was an auth issue rather than injection.

A04 coverage identified missing replay controls for webhook deployment, temp artifact ownership design, and privileged build architecture.

A05 coverage identified the overly narrow middleware matcher, privileged build workloads, tag-pinned images/actions, non-frozen installs in CI/Docker, and missing endpoint validation for S3-compatible storage.

A06 coverage used `yarn audit --groups dependencies --level low`. Direct packages were upgraded, Next and the Kubernetes client were migrated, patched transitive resolutions were added, and the final audit reports 0 vulnerabilities.

A07 coverage found and fixed unauthenticated Socket.IO terminal access. Webhook deploy remains intentionally unauthenticated but should use signed requests.

A08 coverage reviewed build jobs, Git credentials, Docker images, GitHub Actions, and package installs. Build workloads still need rootless isolation and credential handling improvements.

A09 coverage found S3 credential logging and fixed it.

A10 coverage reviewed S3 endpoint handling. The AWS SDK limits the shape of requests, but user-configurable endpoints should reject private, loopback, and link-local targets unless explicitly intended.
