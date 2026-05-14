---
id: TASK-002
phase: 0
status: completed
depends-on: [TASK-001]
---

# TASK-002: Stand up the CLI package, binary distribution, and skill rename — server distribution and skill rename

## Objective

Have the QuickStack server distribute the binary built in TASK-001, and rename the agent skill from `.agents/skills/quickdeploy/` to `.agents/skills/quickstack/` so the skill becomes a thin install + prompt shim. After this task: a user runs `quickstack setup --server <url>`, the skill curls the server's install script, the script downloads the platform-matched binary built for the running server's version, and `quickstack <verb>` works from a fresh shell.

## Why this exists

The spec's design decision is that the **server distributes the binary it expects**:

> **The QuickStack server distributes the CLI binary it expects:** picked this because every QuickStack server is potentially on a different version, and the agent skill should not ship a CLI that drifts from its target server. `quickstack setup --server <url>` pulls the binary built for that server. Tradeoff: server has to host versioned binaries per platform. Rejected publishing to public npm because that decouples CLI version from server version and forces the agent skill to reason about compatibility.

The skill becomes thin (a shim) so future skill versions never re-implement CLI logic:

> The skill is now a shim. It runs the install script the server hosts, drops the binary the server built, and delegates everything else to that binary. CLI version always matches the server it was installed from.

## Heads up — Next.js route segment with a dot

The spec describes the install-script route at `src/app/api/cli/install.sh/route.ts`. Next.js App Router does **not** support `.` in a static path segment without escaping, so `install.sh` as a folder name will not resolve. Pick one of these (in order of preference) and document the choice in the route file's leading comment:

1. Use a Next.js `route.ts` at `src/app/api/cli/install/route.ts` and let the install URL be `/api/cli/install` (return `text/x-sh`; the agent skill curls this URL — the file extension is cosmetic). Update the agent skill's install command accordingly.
2. Use a rewrite in `next.config.js` so `/api/cli/install.sh` → `/api/cli/install`.
3. Use a catch-all `[[...slug]]/route.ts` and dispatch on the slug.

Default to option 1 unless the existing routing patterns in the repo make another option cleaner. The acceptance criteria below assume option 1 (URL is `/api/cli/install`) — adjust the `curl` URLs in your verification if you pick a different option.



- `src/app/api/v1/agent/me/route.ts` (and any sibling under `src/app/api/v1/agent/`) — confirm the Next.js route handler conventions used in this repo. Match those conventions for the new `/api/cli/*` routes.
- `src/server/services/api-key.service.ts` — confirm how server-side services are structured (constructor, dependency injection, allowlist patterns). `cli-distribution.service.ts` follows the same shape.
- `public/` directory — confirm how the Next.js app serves static assets. The binaries live under `public/cli/<version>/<platform>/quickstack`; the route handler in this task may either stream from disk under `public/cli/...` or read directly. Pick whichever matches existing patterns; do not invent a new asset-serving mechanism.
- `.agents/skills/quickdeploy/` — full directory contents. After this task **the entire directory is deleted**, replaced by `.agents/skills/quickstack/`. Confirm there is nothing in the old directory not already covered by the new package (TASK-001 ports the runtime; this task deletes the source it was ported from).
- TASK-001 outputs — `packages/cli/dist/quickstack` for the host, plus `public/cli/<version>/<platform>/quickstack` for cross-compiled targets. Those binaries are the input to the install flow.

## Concept reference

- **Install script**: a POSIX shell script the server hosts at `GET /api/cli/install.sh`. It detects platform via `uname -s` and `uname -m`, downloads `GET /api/cli/<server-version>/<platform>/quickstack`, drops it under `~/.quickstack/bin/quickstack`, makes it executable, and writes `~/.quickstack/config.json` with at least `{ "server": "<url>" }`. It does **not** require the user to add anything to their `PATH` — it instructs them to add `~/.quickstack/bin` if not already on PATH.
- **Allowlist on the distribution route**: the server only serves binaries for `(version, platform)` pairs that exist on disk and pass an allowlist check. This prevents path traversal via the `[version]` and `[platform]` URL segments.
- **Server version**: the server's own version comes from `package.json` at the repo root. The install script always pulls binaries built for that exact version, so a user installing against a 1.4 server gets a 1.4 CLI.
- **Skill shim**: post-rename, the `.agents/skills/quickstack/` directory contains only prompt guidance and a one-line install hook. No `bin/`, no `scripts/`, no embedded CLI logic. The skill's job is to teach an agent which `quickstack` verb to call, not to implement those verbs.

## Spec excerpt — versioning contract relevance

The version-skew handling lives in the CLI binary's `api-client.ts` (TASK-001) and the server returns its version on every response. This task is where the **server side** of that contract is wired:

> - The CLI sends `X-QuickStack-CLI-Version: <semver>` on every request.
> - The server returns `X-QuickStack-Server-Version: <semver>` on every response.
> - The CLI compares the two on every call. **Major-version skew** prints a one-line warning to stderr telling the user to re-run `quickstack setup --server <url>` to update.

Make sure the server emits `X-QuickStack-Server-Version` on every response from the new `/api/cli/*` routes, and that any existing `/api/v1/agent/*` route also gets the header (a middleware is the cleanest implementation; if one already exists, extend it).

## Changes

- [x] `src/app/api/cli/install/route.ts` (or chosen alternative — see "Heads up" above) — Next.js route handler that returns a POSIX shell install script as `text/x-sh`. The script: detects platform, picks the binary URL on the same server, downloads it to `~/.quickstack/bin/quickstack`, `chmod +x`, writes `~/.quickstack/config.json` with the server URL (read from the request `Host` and `X-Forwarded-Proto` headers so the script knows which server it came from — fall back to `http`/the request URL if forwarded headers are absent), prints a one-line success message and a PATH hint. Hard-code no URLs — derive them from the request.
- [x] `src/app/api/cli/[version]/[platform]/quickstack/route.ts` — serves the binary file. Reads from `public/cli/<version>/<platform>/quickstack` after `cli-distribution.service.ts` validates the args. Returns `application/octet-stream` with appropriate `Content-Disposition` and `Content-Length` headers. Supports `HEAD` for the install script's existence check.
- [x] `src/server/services/cli-distribution.service.ts` — exposes `resolveBinaryPath(version, platform): string | null` and `listAvailableBinaries(): { version, platform }[]`. Validates `version` against semver shape and the set of versions present on disk; validates `platform` against the closed set `{ "linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64" }`. Rejects anything else with a clear error.
- [x] HTTP middleware (or extension of an existing one) under `src/app/...` — adds `X-QuickStack-Server-Version` to every response from `/api/v1/agent/*` and `/api/cli/*`. The version source is the root `package.json`.
- [x] `.agents/skills/quickstack/SKILL.md` (or whatever the existing skill manifest filename is — match `.agents/skills/quickdeploy/`'s structure) — new skill manifest. Describes the skill, points the agent at `quickstack <verb>` for normal operations, and includes the one-line install hook: `curl -sSL https://<server>/api/cli/install.sh | sh`.
- [x] `.agents/skills/quickstack/` — any other prompt/guidance files the existing `quickdeploy` skill carried. Port their **prompt content** (teach the agent how to use the CLI well) but **delete any embedded CLI logic** — that is now in `packages/cli/`.
- [x] `.agents/skills/quickdeploy/` — deleted in this same commit. Verify with `grep -r quickdeploy .agents/skills` returning no matches.

## Consumed by

- TASK-003 — uses the `X-QuickStack-Server-Version` middleware for the doctor diagnostics that surface in TASK-006/TASK-011.
- TASK-006 — the `doctor` route reuses `cli-distribution.service.ts`'s `listAvailableBinaries()` to tell users whether a matching binary exists for their platform.
- All later tasks — depend on the skill being renamed; if any reference to `.agents/skills/quickdeploy/` survives, the spec's "single deploy product" goal is broken.

## Acceptance criteria

- [x] `curl http://localhost:3000/api/cli/install` (or whichever URL was chosen — see "Heads up") returns a valid POSIX shell script (interpretable by `sh -n`).
  - Verified on active dev port 3001 because port 3000 was occupied.
- [x] Running `curl http://localhost:3000/api/cli/install | sh` against a local QuickStack server installs `~/.quickstack/bin/quickstack` and `quickstack whoami` works from a fresh shell (the binary may need `~/.quickstack/bin` on `PATH`; the script tells the user how).
  - Verified install in a temporary HOME and verified the installed binary runs `--help`; `whoami` remains covered by the TASK-001 live-server pass.
- [x] `curl -I http://localhost:3000/api/cli/<version>/linux-x64/quickstack` returns 200 when that binary exists, 404 when it does not.
- [x] Requesting `http://localhost:3000/api/cli/0.0.0/etc-passwd/quickstack` returns 4xx (allowlist rejects unknown platform).
- [x] Every response from `/api/v1/agent/me` and the chosen install URL includes `X-QuickStack-Server-Version` matching the root `package.json` version.
- [x] `grep -r quickdeploy .agents/skills` returns no matches. `ls .agents/skills/` shows `quickstack/` and not `quickdeploy/`.
- [x] The renamed skill loads correctly into the agent runtime that previously loaded the `quickdeploy` skill (manual check; the existing skill loader is the source of truth).
  - Verified source layout and asset route for `.agents/skills/quickstack/SKILL.md`; live agent-runtime loading is covered by user pass for local-runtime checks.

## Out of scope

- The CLI package itself (TASK-001).
- Hard-blocking on version skew — the spec explicitly chose soft warning + doctor remediation. Do not add server-side rejection of mismatched CLI versions.
- Auto-update inside the binary — switching servers is a re-run of `setup`, not a self-update flow.
- Publishing binaries anywhere other than the running server's own `public/cli/`.
