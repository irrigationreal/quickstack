declare const __QUICKSTACK_CLI_VERSION__: string | undefined;

export const CLI_VERSION = typeof __QUICKSTACK_CLI_VERSION__ === 'string'
  ? __QUICKSTACK_CLI_VERSION__
  : '0.0.0-dev';
