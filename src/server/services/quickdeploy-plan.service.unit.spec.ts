import quickDeployPlanService from './quickdeploy-plan.service';
import { AgentLaunchPlanRequest } from '@/shared/model/agent-launch-plan.model';

function plan(input: Partial<AgentLaunchPlanRequest>) {
    return quickDeployPlanService.plan({ evidence: [], flags: {}, ...input });
}

describe('quickdeploy plan service', () => {
    it('prioritizes managed source tar for Dockerfile repositories', () => {
        const result = plan({ evidence: [
            { kind: 'service-root', sourcePath: 'package.json', reason: 'root package', value: '.' },
            { kind: 'dockerfile', sourcePath: 'Dockerfile', reason: 'Dockerfile exists', value: 'Dockerfile' },
            { kind: 'port', sourcePath: 'Dockerfile', reason: 'EXPOSE 8080', value: 8080 },
        ] });

        expect(result.serviceRoot).toBe('.');
        expect(result.ports).toEqual([8080]);
        expect(result.buildStrategies.map(item => item.strategy)).toEqual(['source-tar', 'local-docker']);
        expect(result.questions).toEqual([]);
    });

    it('recommends source tar for static output repositories', () => {
        const result = plan({ evidence: [
            { kind: 'service-root', sourcePath: 'package.json', reason: 'root package', value: '.' },
            { kind: 'framework', sourcePath: 'package.json', reason: 'vite dependency', value: 'vite' },
            { kind: 'output-dir', sourcePath: 'dist', reason: 'dist exists', value: 'dist' },
            { kind: 'port', sourcePath: 'package.json', reason: 'framework default', value: 5173 },
        ] });

        expect(result.framework).toBe('vite');
        expect(result.outputDir).toBe('dist');
        expect(result.buildStrategies[0].strategy).toBe('source-tar');
    });

    it('uses an existing image strategy when an image flag is present', () => {
        const result = plan({ flags: { image: 'registry.example/app:latest' } });

        expect(result.buildStrategies).toEqual([{ strategy: 'existing-image', reason: 'An explicit image flag was provided, so no source build is required.', priority: 1 }]);
        expect(result.questions).toEqual([]);
    });

    it('asks for service selection in ambiguous multi-service monorepos', () => {
        const result = plan({ evidence: [
            { kind: 'service-root', sourcePath: 'apps/web/package.json', reason: 'package root', value: 'apps/web' },
            { kind: 'service-root', sourcePath: 'apps/api/package.json', reason: 'package root', value: 'apps/api' },
            { kind: 'framework', sourcePath: 'apps/web/package.json', reason: 'next dependency', value: 'next' },
            { kind: 'port', sourcePath: 'apps/api/Dockerfile', reason: 'EXPOSE 3000', value: 3000 },
        ] });

        expect(result.questions).toEqual([expect.objectContaining({ id: 'service-root' })]);
        expect(result.questions[0].options).toEqual([{ value: 'apps/web', label: 'apps/web' }, { value: 'apps/api', label: 'apps/api' }]);
    });
});
