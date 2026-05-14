#!/usr/bin/env bun
import { parseArgv } from './lib/args';
import { printError } from './lib/output';
import { QuickStackApiError } from './lib/api-client';
import { setup } from './commands/setup';
import { api } from './commands/api';
import { whoami } from './commands/whoami';
import { apps } from './commands/apps';
import { detect } from './commands/detect';
import { packageCommand } from './commands/package';
import { launch } from './commands/launch';
import { deploy } from './commands/deploy';
import { plan } from './commands/plan';
import { build } from './commands/build';
import { doctor } from './commands/doctor';
import { secrets } from './commands/secrets';
import { config } from './commands/config';
import { postgres } from './commands/postgres';
import { redis } from './commands/redis';
import { mysql } from './commands/mysql';
import { services } from './commands/services';
import { endpoints } from './commands/endpoints';
import { volumes } from './commands/volumes';
import { exec } from './commands/exec';
import { scale } from './commands/scale';
import { rollback } from './commands/rollback';
import { status } from './commands/status';
import { logs } from './commands/logs';
import { releases } from './commands/releases';
import { restart } from './commands/restart';
import { suspend } from './commands/suspend';
import { resume } from './commands/resume';
import { destroy } from './commands/destroy';
import { checks } from './commands/checks';
import { image } from './commands/image';
import { storage } from './commands/storage';
import { env } from './commands/env';
import { domains } from './commands/domains';
import { proxy } from './commands/proxy';
import { ips } from './commands/ips';
import { certs } from './commands/certs';
import { ssh } from './commands/ssh';
import { tokens } from './commands/tokens';
import { version } from './commands/version';
import { metrics } from './commands/metrics';
import { jobs } from './commands/jobs';

function help() {
  console.log(`QuickStack CLI

Usage:
  quickstack setup --url <quickstack-url> --api-key <qstk_key>
  quickstack version [--json]
  quickstack whoami [--json]
  quickstack apps list [--json]
  quickstack plan [path] [--json]
  quickstack build [path] --app <appId> [--build-strategy auto|source-tar|local-docker|existing-image|remote-builder] [--dockerfile <path>] [--build-arg KEY=VALUE] [--build-secret id=NAME,src=path] [--target <stage>] [--json]
  quickstack doctor [appId] [--json]
  quickstack launch [path] [--plan|--dry-run] [--build-strategy auto|source-tar|local-docker|existing-image|remote-builder] [--image <image>] [--project <id>] [--name <name>] [--json]
  quickstack deploy [path] [--plan|--dry-run] [--app <id>] [--json]
  quickstack restart <app> [--wait] [--json]
  quickstack suspend <app> [--json]
  quickstack resume <app> [--replicas <count>] [--json]
  quickstack destroy <app> --yes [--json]
  quickstack checks list <app> [--json]
  quickstack image show <app> [--json]
  quickstack image deploy <app> <ref> [--json]
  quickstack domains list|add|remove <app> [hostname] [--json]
  quickstack certs status <app> [--json]
  quickstack ips list <app> [--json]
  quickstack proxy <local_port:remote_port> <remote_host> <app> [--background] [--json]
  quickstack ssh <app> [-- <command>] [--json]
  quickstack tokens list|create|revoke [--scope actor|project:<id>|app:<id>] [--json]
  quickstack detect [path]
  quickstack package <path> --out <context.tar>
  quickstack secrets import <.env> --app <appId> [--dry-run] [--json]
  quickstack secrets set --app <appId> (--from-env KEY|--from-file KEY=path) [--json]
  quickstack secrets list --app <appId> [--json]
  quickstack secrets unset --app <appId> <KEY> [--json]
  quickstack secrets diff|sync --app <appId> [--from <.env>] [--prune] [--dry-run] [--json]
  quickstack env list|set|unset|sync <app> [KEY=VALUE|KEY] [--from <.env>] [--json]
  quickstack storage show|snapshots <app> [--json]
  quickstack metrics <app> [--json]
  quickstack jobs run|list|show|cancel <app> [job] [--json]
  quickstack endpoints list [path] [--app <id>] [--json]
  quickstack endpoints reserve [path] --app <id> --public-ip <ip> --public-port <port> --target-port <port> [--json]
  quickstack endpoints release [path] --app <id> (--id <endpointId>|--public-ip <ip> --public-port <port>) [--json]
  quickstack status|releases [appId|path] [--app <id>] [--json]
  quickstack logs [appId|path] [--app <id>] [--tail <lines>] [--json]
  quickstack scale [appId|path] --replicas <count> [--json]
  quickstack rollback [appId|path] [--json]
  quickstack volumes list|show|create|update|destroy --app <app> [--json]
  quickstack exec [appId|path] -- <command> [args...]
  quickstack postgres create|list|attach|destroy|status ...
  quickstack redis create|list|attach|destroy|status ...
  quickstack mysql create|list|attach|destroy|status ...
  quickstack services list|attach|detach|status ...
  quickstack config <show|validate|pull|repair>
  quickstack api <me|ensure|upload|deploy|scale|rollback|status|logs|releases|secrets-list|secrets-set|postgres|postgres-list|postgres-destroy|redis|redis-list|redis-destroy> ...
`);
}

async function main() {
  const ctx = parseArgv(process.argv.slice(2));
  if (!ctx.command || ctx.command === 'help' || ctx.command === '--help' || ctx.command === '-h') return help();
  if (ctx.commandArgs.includes('--help')) return help();
  if (ctx.command === 'setup') return setup(ctx);
  if (ctx.command === 'api') return api(ctx);
  if (ctx.command === 'version' || ctx.command === '--version' || ctx.command === '-v') return version(ctx);
  if (ctx.command === 'whoami' || ctx.command === 'me') return whoami(ctx);
  if (ctx.command === 'apps') return apps(ctx);
  if (ctx.command === 'detect') return detect(ctx);
  if (ctx.command === 'plan') return plan(ctx);
  if (ctx.command === 'build') return build(ctx);
  if (ctx.command === 'doctor') return doctor(ctx);
  if (ctx.command === 'package') return packageCommand(ctx);
  if (ctx.command === 'launch') return launch(ctx);
  if (ctx.command === 'deploy') return deploy(ctx);
  if (ctx.command === 'secrets') return secrets(ctx);
  if (ctx.command === 'config') return config(ctx);
  if (ctx.command === 'postgres') return postgres(ctx);
  if (ctx.command === 'redis') return redis(ctx);
  if (ctx.command === 'mysql') return mysql(ctx);
  if (ctx.command === 'services') return services(ctx);
  if (ctx.command === 'endpoints') return endpoints(ctx);
  if (ctx.command === 'volumes') return volumes(ctx);
  if (ctx.command === 'exec') return exec(ctx);
  if (ctx.command === 'scale') return scale(ctx);
  if (ctx.command === 'rollback') return rollback(ctx);
  if (ctx.command === 'status') return status(ctx);
  if (ctx.command === 'logs') return logs(ctx);
  if (ctx.command === 'releases') return releases(ctx);
  if (ctx.command === 'restart') return restart(ctx);
  if (ctx.command === 'suspend') return suspend(ctx);
  if (ctx.command === 'resume') return resume(ctx);
  if (ctx.command === 'destroy') return destroy(ctx);
  if (ctx.command === 'checks') return checks(ctx);
  if (ctx.command === 'image') return image(ctx);
  if (ctx.command === 'storage') return storage(ctx);
  if (ctx.command === 'env') return env(ctx);
  if (ctx.command === 'domains') return domains(ctx);
  if (ctx.command === 'proxy') return proxy(ctx);
  if (ctx.command === 'ips') return ips(ctx);
  if (ctx.command === 'certs' || ctx.command === 'certificates') return certs(ctx);
  if (ctx.command === 'ssh' || ctx.command === 'shell') return ssh(ctx);
  if (ctx.command === 'tokens') return tokens(ctx);
  if (ctx.command === 'metrics') return metrics(ctx);
  if (ctx.command === 'jobs') return jobs(ctx);
  if (['registry', 'unlink'].includes(ctx.command)) {
    printError(ctx, `quickstack ${ctx.command} is not yet available in this build.`, 2);
  }
  printError(ctx, `Unknown command: ${ctx.command}`);
}

main().catch(error => {
  const ctx = parseArgv(process.argv.slice(2));
  if (error instanceof QuickStackApiError && error.body && typeof error.body === 'object') {
    const body = error.body as { message?: string; scope?: unknown; ownership?: unknown; remediation?: string };
    printError(ctx, {
      message: body.message || error.message,
      scope: body.scope,
      ownership: body.ownership,
      remediation: body.remediation,
    });
  }
  printError(ctx, error instanceof Error ? error.message : String(error));
});
