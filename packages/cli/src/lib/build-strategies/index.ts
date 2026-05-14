import type { BuildCapabilities, BuildResult, BuildStrategy } from '../../../../../src/shared/model/agent-build-strategy.model';
import type { BuildStrategyRecommendation } from '../../../../../src/shared/model/agent-launch-plan.model';

export function resolveBuildStrategy(input: {
  recommendations: BuildStrategyRecommendation[];
  userFlag?: BuildStrategy | 'auto';
  capabilities: BuildCapabilities;
  cachedResult?: BuildResult;
}) {
  if (input.cachedResult?.cacheHit) {
    return { strategy: 'existing-image' as const, reason: 'Cached build result matches current source.', cacheHit: true, buildResult: input.cachedResult };
  }
  const requested = input.userFlag && input.userFlag !== 'auto'
    ? input.userFlag
    : [...input.recommendations].sort((left, right) => left.priority - right.priority)[0]?.strategy ?? 'source-tar';
  if (requested === 'remote-builder' && !input.capabilities.remoteBuilder) {
    throw new Error('remote builder is not configured on this server.');
  }
  if (requested === 'local-docker' && input.capabilities.registry?.pushCredentials === false) {
    if (input.userFlag === 'local-docker') throw new Error('local-docker requires registry push credentials reachable by the CLI. Use source-tar or existing-image instead.');
    const fallback = input.recommendations.find(item => item.strategy !== 'local-docker' && input.capabilities.strategies.includes(item.strategy));
    if (fallback) return { strategy: fallback.strategy, reason: 'local-docker unavailable because registry push credentials are not advertised; using fallback.', cacheHit: false };
    throw new Error('local-docker requires registry push credentials reachable by the CLI. Use source-tar or existing-image instead.');
  }
  if (!input.capabilities.strategies.includes(requested)) {
    const fallback = input.recommendations.find(item => input.capabilities.strategies.includes(item.strategy));
    if (!fallback) throw new Error(`No supported build strategy is available for ${requested}.`);
    return { strategy: fallback.strategy, reason: `${requested} unavailable; using ${fallback.strategy}.`, cacheHit: false };
  }
  return { strategy: requested, reason: `${requested} selected.`, cacheHit: false };
}
