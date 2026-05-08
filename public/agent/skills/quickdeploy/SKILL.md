---
name: quickdeploy
description: Deploy local projects to QuickStack from an agent. Use this skill whenever the user says /quickdeploy, asks to deploy this folder, ship a frontend/backend project, deploy Docker Compose, import Kubernetes manifests, configure a QuickStack agent deploy, or put a local app on QuickStack. This skill inspects the project, asks when topology is ambiguous, packages safely, calls QuickStack agent APIs, and keeps secrets out of .quickdeploy.
---

# QuickDeploy

QuickDeploy is QuickStack's agent-side launch/deploy workflow. Treat it like a platform deploy contract, not a generic shell script. The job is to turn local project intent into QuickStack apps, builds, secrets, ports, domains, and deploys while hiding Kubernetes unless the user explicitly brings Kubernetes manifests.

## Core rules

- Never store API keys, registry passwords, `.env` values, kubeconfig, upload tokens, or secret env values in `.quickdeploy`.
- Do not raw-apply Docker Compose or Kubernetes YAML. Compile common safe shapes into QuickStack app specs. Ask or refuse for unsafe primitives.
- Ask before making a topology decision that changes what will be public, stateful, or shared.
- Prefer one clear deployable service. If the repo contains multiple public services, present the plan and ask.
- In CI or when `QUICKDEPLOY_NONINTERACTIVE=1`, do not ask interactively. Fail with a structured list of questions that need answers.
- Do not deploy a managed upload until the app points at the produced managed image. If the server cannot reserve/build/update safely yet, stop with a capability error instead of deploying a placeholder or stale image.

## Required environment

Read these from sensitive local agent config or environment:

- `QUICKSTACK_URL`: base URL for QuickStack, for example `https://quickstack.example.com`.
- `QUICKSTACK_API_KEY`: `qstk_...` API key with the needed scopes.

Never read these from `.quickdeploy` and never write them there.

## Workflow

1. Inspect local state.
   - Read `.quickdeploy/index.json` and `.quickdeploy/apps/*.json` if present.
   - Run `node .agents/skills/quickdeploy/scripts/detect.mjs "$PWD"`.
   - Use the JSON output as the detection ledger.

2. Decide the deploy mode.
   - `image`: user supplied an existing image. Call ensure and deploy. No upload.
   - `dockerfile`: selected root has a Dockerfile. Package the Dockerfile context and upload only after backend managed-build capability is available.
   - `static`: selected root builds static assets. Run the chosen build command, create a minimal static-server context, package, upload, then deploy only after managed image is produced.
   - `compose`: Compose file is present. Translate supported services into QuickStack app specs; ask for multi-service topology.
   - `kubernetes`: Kubernetes manifests are present. Translate only safe Deployment/Service/Ingress/ConfigMap/Secret/PVC-like intent into QuickStack app specs; reject unsafe resources.

3. Ask only when the answer changes deployment.
   Ask for project selection, service selection, port, one-app-vs-two-app topology, Compose/Kubernetes mapping, database/cache treatment, secret/public env classification, build command/output folder, branch/environment target, private registry credentials, or whether to reuse an existing app.

4. Package safely when upload mode is used.
   - Run `node .agents/skills/quickdeploy/scripts/package.mjs <root> --out <tar-path>`.
   - The packager rejects symlinks/hardlinks and forbidden secret/cached paths.
   - Use the returned `sha256:<hex>` hash in `x-quickdeploy-metadata`.
   - Do not mutate the tar between hashing and upload.

5. Call QuickStack APIs.
   - Use `node .agents/skills/quickdeploy/scripts/quickstack-api.mjs me` to verify credentials and discover accessible projects/apps.
   - For existing image mode, call `ensure` once with image, app/project/name/port/domain, then `deploy`.
   - For managed uploads, only upload when an app id exists. If a new app needs an id first, require a server reservation/managed-build capability or an explicit safe bootstrap convention. Never deploy after bootstrap ensure until a produced image is set.
   - For Compose/Kubernetes imports, use the normalized import endpoint when available. If it is unavailable, stop and print the import plan rather than raw-applying manifests.

6. Poll and report.
   - Poll deploy status and HTTP readiness when endpoints exist.
   - Print phase logs: detected, planned, packaged, uploaded, built, ensured app, deployed, ready.
   - Write secret-free state under `.quickdeploy/` after successful config/build/deploy state changes.

## Docker Compose support

Detect `compose.yaml`, `compose.yml`, `docker-compose.yaml`, or `docker-compose.yml`.

Translate supported service fields: `image`, `build`, `ports`, `environment`, `env_file`, `.env`, `volumes`, `command`, `entrypoint`, `depends_on`, simple replica/resource hints.

Ask before deploying:

- more than one public service,
- web plus API split,
- database/cache/queue images,
- multiple public ports,
- private registry credentials,
- env values that may be public vs secret.

Reject or require an explicit backend feature for Docker socket mounts, host bind mounts, privileged mode, host networking, external networks, unsupported volume drivers, and services that cannot map to one app container.

## Kubernetes support

Detect YAML under `k8s/`, `kubernetes/`, `deploy/`, `.k8s/`, or files containing `apiVersion` and `kind`.

Translate only safe app intent: Deployment-like workload with one primary container, Service, Ingress, ConfigMap/file mounts, Secret env, and simple PVC references.

Reject RBAC, CRDs, Jobs/CronJobs, DaemonSets, hostPath, privileged security context, host network/PID/IPC, arbitrary init containers/sidecars, NodePort/LoadBalancer, arbitrary annotations, cluster-scoped resources, and multiple containers unless the primary app container is obvious.

## Secret handling

- Treat `.env`, Compose `env_file`, Compose `secrets`, and Kubernetes `Secret` values as secret by default.
- Only classify env values as public when they look intentionally public or the user says so.
- Redact secrets in summaries. Show names, not values.
- Registry credentials are secret inputs and should feed QuickStack Docker pull-secret support. Do not put them in `.quickdeploy`.

## `.quickdeploy` state

Use a directory layout for multi-service safety:

```json
.quickdeploy/index.json
.quickdeploy/apps/<appId>.json
```

State may include project id, app id, service root, branch/environment label, mode, port, domain, build command/output, last content hash, last build id, and last image reference. State must not include secret values.

If saved branch/environment differs from the current branch/environment, ask whether to reuse the app, create/update a preview app, or change mapping.
