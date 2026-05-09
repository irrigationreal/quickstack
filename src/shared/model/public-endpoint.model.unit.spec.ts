import { publicEndpointEditZodModel } from './public-endpoint.model';

describe('public-endpoint.model', () => {
    it('rejects invalid IPv4 addresses and CIDRs before reservation', () => {
        const base = {
            publicIp: '65.21.9.20',
            publicPort: 25565,
            targetPort: 25565,
            protocol: 'TCP',
            sourceCidrsText: '203.0.113.10/32',
            proxyProtocol: false,
            enabled: true,
        };

        expect(publicEndpointEditZodModel.safeParse(base).success).toBe(true);
        expect(publicEndpointEditZodModel.safeParse({ ...base, publicIp: '999.21.9.20' }).success).toBe(false);
        expect(publicEndpointEditZodModel.safeParse({ ...base, publicIp: '065.21.9.20' }).success).toBe(false);
        expect(publicEndpointEditZodModel.safeParse({ ...base, sourceCidrsText: '203.0.113.999/32' }).success).toBe(false);
        expect(publicEndpointEditZodModel.safeParse({ ...base, sourceCidrsText: '203.0.113.10/33' }).success).toBe(false);
    });
});
