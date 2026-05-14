import quickDeployBuildStrategyService from './quickdeploy-build-strategy.service';
import { BuildResult } from '@/shared/model/agent-build-strategy.model';

const recommendations = [
    { strategy: 'source-tar' as const, reason: 'managed source', priority: 1 },
    { strategy: 'local-docker' as const, reason: 'local fallback', priority: 2 },
];

describe('quickdeploy build strategy service', () => {
    it('uses the planner recommendation when user flag is auto', () => {
        const result = quickDeployBuildStrategyService.resolveForApp('app-1', recommendations, 'auto');

        expect(result).toEqual({ strategy: 'source-tar', reason: 'source-tar selected for app app-1.', cacheHit: false });
    });

    it('prefers local Docker in auto mode when registry push is available', () => {
        const getCapabilities = vi.spyOn(quickDeployBuildStrategyService, 'getCapabilities').mockReturnValue({
            strategies: ['source-tar', 'existing-image', 'local-docker'],
            registry: { url: 'localhost:30100', pushCredentials: true },
            remoteBuilder: false,
        });

        const result = quickDeployBuildStrategyService.resolveForApp('app-1', recommendations, 'auto');

        expect(result.strategy).toBe('local-docker');
        getCapabilities.mockRestore();
    });

    it('honors an available explicit user strategy', () => {
        const result = quickDeployBuildStrategyService.resolveForApp('app-1', recommendations, 'local-docker');

        expect(result.strategy).toBe('local-docker');
    });

    it('falls back when an auto recommendation is unavailable but another recommendation is available', () => {
        const result = quickDeployBuildStrategyService.resolveForApp('app-1', [
            { strategy: 'remote-builder', reason: 'fast path', priority: 1 },
            { strategy: 'source-tar', reason: 'managed fallback', priority: 2 },
        ], 'auto');

        expect(result).toEqual({ strategy: 'source-tar', reason: 'remote-builder is unavailable; using source-tar.', cacheHit: false });
    });

    it('short-circuits cache hits to existing-image', () => {
        const cachedResult: BuildResult = {
            image: { registry: 'registry.example', repository: 'app', tag: 'cached' },
            imageReference: 'registry.example/app:cached',
            strategy: 'source-tar',
            sourceProvenance: 'sha256:abc',
            cacheHit: true,
        };

        const result = quickDeployBuildStrategyService.resolveForApp('app-1', recommendations, 'auto', cachedResult);

        expect(result).toEqual({ strategy: 'existing-image', reason: 'Existing image metadata matches the current source input.', cacheHit: true, buildResult: cachedResult });
    });

    it('rejects remote-builder when no remote builder is configured', () => {
        expect(() => quickDeployBuildStrategyService.resolveForApp('app-1', [{ strategy: 'remote-builder', reason: 'requested', priority: 1 }], 'remote-builder'))
            .toThrow('remote builder is not configured on this server.');
    });
});
