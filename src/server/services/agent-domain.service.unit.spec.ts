const appMocks = vi.hoisted(() => ({ getDomainByHostname: vi.fn() }));
const paramMocks = vi.hoisted(() => ({ getStringUncached: vi.fn() }));

vi.mock('./app.service', () => ({ default: appMocks }));
vi.mock('./param.service', () => ({
    default: paramMocks,
    ParamService: {
        GENERATED_APP_DOMAIN_SUFFIX: 'generatedAppDomainSuffix',
        QS_SERVER_HOSTNAME: 'qsServerHostname',
    },
}));

import agentDomainService from './agent-domain.service';

describe('agent-domain.service', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        appMocks.getDomainByHostname.mockRejectedValue(new Error('not found'));
        paramMocks.getStringUncached.mockImplementation(async (name: string) => {
            if (name === 'generatedAppDomainSuffix') return undefined;
            if (name === 'qsServerHostname') return 'quickstack.irrigate.cc';
            return undefined;
        });
    });

    it('generates app hostnames under the configured app domain suffix', async () => {
        paramMocks.getStringUncached.mockImplementation(async (name: string) => name === 'generatedAppDomainSuffix' ? 'apps.irrigate.cc' : undefined);

        const hostname = await agentDomainService.generateHostname('Hello App');

        expect(hostname).toMatch(/^hello-app-[a-f0-9]{6}\.apps\.irrigate\.cc$/);
        expect(appMocks.getDomainByHostname).toHaveBeenCalledWith(hostname);
    });

    it('derives the app domain suffix from the configured QuickStack hostname', async () => {
        const hostname = await agentDomainService.generateHostname('Source Upload Smoke');

        expect(hostname).toMatch(/^source-upload-smoke-[a-f0-9]{6}\.irrigate\.cc$/);
    });
});
