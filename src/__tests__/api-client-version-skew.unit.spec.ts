import { warnOnServerVersionSkew } from '../../packages/cli/src/lib/api-client';

describe('QuickStack API client version skew warning', () => {
  it('warns when server and CLI major versions differ', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    warnOnServerVersionSkew(new Headers({ 'X-QuickStack-Server-Version': '99.1.0' }));

    expect(warn).toHaveBeenCalledWith(expect.stringContaining('major-version skew'));
    warn.mockRestore();
  });

  it('stays quiet when the server version header is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    warnOnServerVersionSkew(new Headers());

    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
