import { resolveBuildStrategy } from '../../packages/cli/src/lib/build-strategies';

const recommendations = [
  { strategy: 'source-tar' as const, reason: 'managed source upload', priority: 1 },
  { strategy: 'local-docker' as const, reason: 'local registry build', priority: 2 },
];

describe('CLI build strategy selection', () => {
  it('prefers local Docker in auto mode when registry push is available', () => {
    const selected = resolveBuildStrategy({
      recommendations,
      userFlag: 'auto',
      capabilities: {
        strategies: ['source-tar', 'local-docker', 'existing-image'],
        registry: { url: 'localhost:30100', pushCredentials: true },
        remoteBuilder: false,
      },
    });

    expect(selected.strategy).toBe('local-docker');
  });

  it('keeps source tar as the auto fallback when registry push is unavailable', () => {
    const selected = resolveBuildStrategy({
      recommendations,
      userFlag: 'auto',
      capabilities: {
        strategies: ['source-tar', 'local-docker', 'existing-image'],
        registry: { url: 'localhost:30100', pushCredentials: false },
        remoteBuilder: false,
      },
    });

    expect(selected.strategy).toBe('source-tar');
  });

  it('honors an explicit source tar request even when local Docker is available', () => {
    const selected = resolveBuildStrategy({
      recommendations,
      userFlag: 'source-tar',
      capabilities: {
        strategies: ['source-tar', 'local-docker', 'existing-image'],
        registry: { url: 'localhost:30100', pushCredentials: true },
        remoteBuilder: false,
      },
    });

    expect(selected.strategy).toBe('source-tar');
  });
});
