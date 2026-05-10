vi.mock('@kubernetes/client-node', async () => {
    const actual = await vi.importActual<typeof import('@kubernetes/client-node')>('@kubernetes/client-node');
    class WatchMock {
        watch = vi.fn().mockResolvedValue({ abort: vi.fn() });
    }
    return {
        ...actual,
        Watch: WatchMock,
    };
});

vi.mock('@/server/adapter/kubernetes-api.adapter', () => ({
    default: {
        getKubeConfig: vi.fn(),
        batch: {
            listNamespacedJob: vi.fn().mockResolvedValue({ body: { items: [] } }),
        },
    },
}));
vi.mock('@/server/services/build.service', () => ({
    default: {
        getJobStatusString: vi.fn(),
    },
}));
vi.mock('@/server/services/deployment.service', () => ({
    default: {
        getDeployment: vi.fn(),
        createDeployment: vi.fn(),
    },
}));
vi.mock('@/server/services/app.service', () => ({
    default: {
        getExtendedById: vi.fn(),
    },
}));
vi.mock('@/server/services/deployment-logs.service', () => ({
    dlog: vi.fn(),
}));
const dataAccessMocks = vi.hoisted(() => ({
    quickDeployBuildFindFirst: vi.fn(),
    quickDeployBuildUpdate: vi.fn(),
}));

vi.mock('@/server/services/registry.service', () => ({
    BUILD_NAMESPACE: 'qs-build',
    default: {
        createContainerRegistryUrlForAppId: vi.fn((appId: string, tag: string) => `registry/${appId}:${tag}`),
    },
}));
vi.mock('@/server/adapter/db.client', () => ({
    default: {
        client: {
            quickDeployBuild: {
                findFirst: dataAccessMocks.quickDeployBuildFindFirst,
                update: dataAccessMocks.quickDeployBuildUpdate,
            },
        },
    },
}));
vi.mock('@/server/services/app-git-ssh-key.service', () => ({
    default: {
        deleteTemporaryBuildSecret: vi.fn(),
    },
}));

import buildService from '@/server/services/build.service';
import buildWatchService from '@/server/services/standalone-services/build-watch.service';
import deploymentService from '@/server/services/deployment.service';
import appService from '@/server/services/app.service';
import appGitSshKeyService from '@/server/services/app-git-ssh-key.service';

describe('BuildWatchService', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        dataAccessMocks.quickDeployBuildFindFirst.mockResolvedValue(null);
        (buildWatchService as any).processedJobs.clear();
    });

    it('ignores pending jobs and does not trigger deployment work', async () => {
        vi.mocked(buildService.getJobStatusString).mockReturnValue('PENDING');

        await (buildWatchService as any).handleJobEvent({
            metadata: {
                name: 'build-1',
                annotations: {
                    'qs-deplyoment-id': 'deployment-1',
                    'qs-git-ssh-secret': 'git-ssh-build-1',
                },
            },
        });

        expect(deploymentService.createDeployment).not.toHaveBeenCalled();
        expect(appGitSshKeyService.deleteTemporaryBuildSecret).not.toHaveBeenCalled();
    });

    it('logs failed jobs without triggering deployment', async () => {
        await (buildWatchService as any).handleFailed({
            metadata: {
                name: 'build-1',
                annotations: {
                    'qs-deplyoment-id': 'deployment-1',
                    'qs-git-ssh-secret': 'git-ssh-build-1',
                },
            },
        });

        expect(deploymentService.createDeployment).not.toHaveBeenCalled();
        expect(appGitSshKeyService.deleteTemporaryBuildSecret).toHaveBeenCalledWith('git-ssh-build-1');
    });

    it('marks matching QuickDeploy upload builds as failed when the build job fails', async () => {
        dataAccessMocks.quickDeployBuildFindFirst.mockResolvedValue({ id: 'quickdeploy-build-1' });

        await (buildWatchService as any).handleFailed({
            metadata: {
                name: 'build-1',
                annotations: {
                    'qs-deplyoment-id': 'deployment-1',
                    'qs-app-id': 'app-1',
                    'qs-git-commit': 'sha256:abc',
                },
            },
        });

        expect(dataAccessMocks.quickDeployBuildUpdate).toHaveBeenCalledWith({
            where: { id: 'quickdeploy-build-1' },
            data: { status: 'FAILED' },
        });
    });

    it('triggers deployment for succeeded jobs', async () => {
        vi.mocked(appService.getExtendedById).mockResolvedValue({
            buildMethod: 'RAILPACK',
        } as any);

        await (buildWatchService as any).handleSucceeded({
            metadata: {
                name: 'build-1',
                annotations: {
                    'qs-deplyoment-id': 'deployment-1',
                    'qs-app-id': 'app-1',
                    'qs-git-commit': 'abc123',
                    'qs-git-commit-message': 'feat: test',
                    'qs-build-method': 'RAILPACK',
                    'qs-git-ssh-secret': 'git-ssh-build-1',
                },
            },
        });

        expect(deploymentService.createDeployment).toHaveBeenCalled();
        expect(appGitSshKeyService.deleteTemporaryBuildSecret).toHaveBeenCalledWith('git-ssh-build-1');
    });

    it('marks matching QuickDeploy upload builds as succeeded after deployment', async () => {
        dataAccessMocks.quickDeployBuildFindFirst.mockResolvedValue({ id: 'quickdeploy-build-1' });
        vi.mocked(appService.getExtendedById).mockResolvedValue({
            buildMethod: 'DOCKERFILE',
        } as any);

        await (buildWatchService as any).handleSucceeded({
            metadata: {
                name: 'build-app-1-1234',
                annotations: {
                    'qs-deplyoment-id': 'deployment-1',
                    'qs-app-id': 'app-1',
                    'qs-git-commit': 'sha256:abc',
                    'qs-git-commit-message': 'QuickDeploy upload quickdeploy-build-1',
                    'qs-build-method': 'DOCKERFILE',
                },
            },
        });

        expect(dataAccessMocks.quickDeployBuildUpdate).toHaveBeenCalledWith({
            where: { id: 'quickdeploy-build-1' },
            data: {
                status: 'SUCCEEDED',
                imageReference: 'registry/app-1:build-app-1-1234',
            },
        });
    });
});
