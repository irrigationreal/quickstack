import { BuildCapabilities, BuildResult, BuildStrategy } from "@/shared/model/agent-build-strategy.model";
import { BuildStrategyRecommendation } from "@/shared/model/agent-launch-plan.model";
import { ServiceException } from "@/shared/model/service.exception.model";

type UserFlag = BuildStrategy | 'auto' | undefined;

const DEFAULT_CAPABILITIES: BuildCapabilities = {
    strategies: ['source-tar', 'existing-image', 'local-docker'],
    registry: { url: 'registry.local', pushCredentials: false },
    remoteBuilder: false,
};

class QuickDeployBuildStrategyService {
    private readonly recordedBuilds = new Map<string, BuildResult>();

    getCapabilities(): BuildCapabilities {
        return DEFAULT_CAPABILITIES;
    }

    resolveForApp(appId: string, recommendations: BuildStrategyRecommendation[], userFlag: UserFlag = 'auto', cachedResult?: BuildResult) {
        if (cachedResult?.cacheHit) {
            return { strategy: 'existing-image' as const, reason: 'Existing image metadata matches the current source input.', cacheHit: true, buildResult: cachedResult };
        }

        const capabilities = this.getCapabilities();
        const sortedRecommendations = [...recommendations].sort((left, right) => left.priority - right.priority);
        const explicit = userFlag && userFlag !== 'auto';
        const localDockerRecommended = sortedRecommendations.some(item => item.strategy === 'local-docker');
        const requested = explicit
            ? userFlag
            : localDockerRecommended && capabilities.strategies.includes('local-docker') && capabilities.registry?.pushCredentials !== false
                ? 'local-docker'
                : sortedRecommendations[0]?.strategy ?? 'source-tar';
        if (!capabilities.strategies.includes(requested)) {
            if (requested === 'remote-builder' && explicit) {
                throw new ServiceException('remote builder is not configured on this server.');
            }
            const fallback = sortedRecommendations.find(item => capabilities.strategies.includes(item.strategy))?.strategy;
            if (!fallback) {
                throw new ServiceException(`No supported build strategy is available for app ${appId}.`);
            }
            return { strategy: fallback, reason: `${requested} is unavailable; using ${fallback}.`, cacheHit: false };
        }
        if (requested === 'remote-builder' && !capabilities.remoteBuilder) {
            if (explicit) {
                throw new ServiceException('remote builder is not configured on this server.');
            }
            const fallback = sortedRecommendations.find(item => item.strategy !== 'remote-builder' && capabilities.strategies.includes(item.strategy))?.strategy;
            if (fallback) {
                return { strategy: fallback, reason: `remote-builder is unavailable; using ${fallback}.`, cacheHit: false };
            }
            throw new ServiceException('remote builder is not configured on this server.');
        }
        return { strategy: requested, reason: `${requested} selected for app ${appId}.`, cacheHit: false };
    }

    recordBuildResult(appId: string, result: BuildResult) {
        this.recordedBuilds.set(appId, result);
        return result;
    }

    getRecordedBuildResult(appId: string) {
        return this.recordedBuilds.get(appId);
    }
}

const quickDeployBuildStrategyService = new QuickDeployBuildStrategyService();
export default quickDeployBuildStrategyService;
