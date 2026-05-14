#!/usr/bin/env bun
import { parseArgv } from './lib/args';
import { printError } from './lib/output';
import { setup } from './commands/setup';
import { api } from './commands/api';
import { whoami } from './commands/whoami';
import { apps } from './commands/apps';
import { detect } from './commands/detect';
import { packageCommand } from './commands/package';
import { launch } from './commands/launch';
import { deploy } from './commands/deploy';
import { plan } from './commands/plan';
import { secrets } from './commands/secrets';
import { config } from './commands/config';
import { postgres } from './commands/postgres';
import { redis } from './commands/redis';
import { endpoints } from './commands/endpoints';
import { volumes } from './commands/volumes';
import { exec } from './commands/exec';
import { scale } from './commands/scale';
import { rollback } from './commands/rollback';
import { status } from './commands/status';
import { logs } from './commands/logs';
import { releases } from './commands/releases';

function help() {
  console.log(`QuickStack CLI

Usage:
  quickstack setup --url <quickstack-url> --api-key <qstk_key>
  quickstack whoami [--json]
  quickstack apps list [--json]
  quickstack plan [path] [--json]
  quickstack launch [path] [--plan|--dry-run] [--image <image>] [--project <id>] [--name <name>] [--json]
  quickstack deploy [path] [--plan|--dry-run] [--app <id>] [--json]
  quickstack detect [path]
  quickstack package <path> --out <context.tar>
  quickstack secrets import <.env> --app <appId> [--dry-run] [--json]
  quickstack secrets set --app <appId> (--from-env KEY|--from-file KEY=path) [--json]
  quickstack secrets list --app <appId> [--json]
  quickstack endpoints list [path] [--app <id>] [--json]
  quickstack endpoints reserve [path] --app <id> --public-ip <ip> --public-port <port> --target-port <port> [--json]
  quickstack endpoints release [path] --app <id> (--id <endpointId>|--public-ip <ip> --public-port <port>) [--json]
  quickstack status|releases [appId|path] [--app <id>] [--json]
  quickstack logs [appId|path] [--app <id>] [--tail <lines>] [--json]
  quickstack scale [appId|path] --replicas <count> [--json]
  quickstack rollback [appId|path] [--json]
  quickstack volumes list|add|remove --app <appId> [--json]
  quickstack exec [appId|path] -- <command> [args...]
  quickstack postgres create|list|attach|destroy ...
  quickstack redis create|list|attach|destroy ...
  quickstack config <show|validate>
  quickstack api <me|ensure|upload|deploy|scale|rollback|status|logs|releases|secrets-list|secrets-set|postgres|postgres-list|postgres-destroy|redis|redis-list|redis-destroy> ...
`);
}

async function main() {
  const ctx = parseArgv(process.argv.slice(2));
  if (!ctx.command || ctx.command === 'help' || ctx.command === '--help' || ctx.command === '-h') return help();
  if (ctx.commandArgs.includes('--help')) return help();
  if (ctx.command === 'setup') return setup(ctx);
  if (ctx.command === 'api') return api(ctx);
  if (ctx.command === 'whoami' || ctx.command === 'me') return whoami(ctx);
  if (ctx.command === 'apps') return apps(ctx);
  if (ctx.command === 'detect') return detect(ctx);
  if (ctx.command === 'plan') return plan(ctx);
  if (ctx.command === 'package') return packageCommand(ctx);
  if (ctx.command === 'launch') return launch(ctx);
  if (ctx.command === 'deploy') return deploy(ctx);
  if (ctx.command === 'secrets') return secrets(ctx);
  if (ctx.command === 'config') return config(ctx);
  if (ctx.command === 'postgres') return postgres(ctx);
  if (ctx.command === 'redis') return redis(ctx);
  if (ctx.command === 'endpoints') return endpoints(ctx);
  if (ctx.command === 'volumes') return volumes(ctx);
  if (ctx.command === 'exec' || ctx.command === 'ssh') return exec(ctx);
  if (ctx.command === 'scale') return scale(ctx);
  if (ctx.command === 'rollback') return rollback(ctx);
  if (ctx.command === 'status') return status(ctx);
  if (ctx.command === 'logs') return logs(ctx);
  if (ctx.command === 'releases') return releases(ctx);
  if (['checks', 'restart', 'domains', 'tokens', 'registry', 'proxy', 'shell', 'unlink', 'destroy'].includes(ctx.command)) {
    printError(ctx, `quickstack ${ctx.command} is not yet available in this build.`, 2);
  }
  printError(ctx, `Unknown command: ${ctx.command}`);
}

main().catch(error => {
  const ctx = parseArgv(process.argv.slice(2));
  printError(ctx, error instanceof Error ? error.message : String(error));
});
