export interface CliContext {
  command: string;
  commandArgs: string[];
  globalArgs: string[];
  json: boolean;
  nonInteractive: boolean;
}

export function hasFlag(flag: string, args: string[]) {
  return args.includes(flag);
}

export function optionValue(name: string, args: string[]) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function positionalArgs(args: string[]) {
  const values: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('--')) {
      if (!['--json', '--yes', '--non-interactive', '--no-deploy', '--dry-run', '--force', '--force-build', '--follow', '--wait', '--background', '--proxy-protocol', '--disabled', '--share', '--prune'].includes(arg)) index += 1;
      continue;
    }
    values.push(arg);
  }
  return values;
}

export function parseArgv(argv: string[]): CliContext {
  const command = argv.find(arg => !arg.startsWith('-')) || '';
  const commandIndex = command ? argv.indexOf(command) : -1;
  const commandArgs = commandIndex >= 0 ? argv.slice(commandIndex + 1) : [];
  const globalArgs = commandIndex >= 0 ? argv.slice(0, commandIndex) : argv;
  return {
    command,
    commandArgs,
    globalArgs,
    json: hasFlag('--json', globalArgs) || hasFlag('--json', commandArgs),
    nonInteractive: hasFlag('--non-interactive', globalArgs)
      || hasFlag('--non-interactive', commandArgs)
      || process.env.QUICKSTACK_NONINTERACTIVE === '1'
      || process.env.QUICKDEPLOY_NONINTERACTIVE === '1'
      || process.env.CI === 'true',
  };
}
