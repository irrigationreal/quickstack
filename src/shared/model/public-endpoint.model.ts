import { z } from "zod";
import { stringToNumber } from "@/shared/utils/zod.utils";

export const PUBLIC_ENDPOINT_NAMESPACE = 'quickstack-public-endpoints';
export const PUBLIC_ENDPOINT_GATEWAY_LABEL = 'quickstack-public-endpoint-gateway';

function isIpv4Address(value: string): boolean {
    const parts = value.split('.');
    return parts.length === 4 && parts.every(part => {
        if (!/^\d+$/.test(part)) return false;
        if (part.length > 1 && part.startsWith('0')) return false;
        const parsed = Number(part);
        return Number.isInteger(parsed) && parsed >= 0 && parsed <= 255;
    });
}

function isIpv4Cidr(value: string): boolean {
    const [address, prefix, ...rest] = value.split('/');
    if (rest.length > 0 || prefix === undefined || !isIpv4Address(address)) return false;
    if (!/^\d+$/.test(prefix)) return false;
    const parsedPrefix = Number(prefix);
    return Number.isInteger(parsedPrefix) && parsedPrefix >= 0 && parsedPrefix <= 32;
}

export const publicEndpointProtocolZodModel = z.enum(['TCP', 'UDP']);

export const publicEndpointEditZodModel = z.object({
    name: z.string().trim().max(100).optional().nullable(),
    publicIp: z.string().trim().refine(isIpv4Address, 'Public IP must be an IPv4 address.'),
    publicPort: stringToNumber.refine((val) => val >= 1 && val <= 65535, {
        message: 'Public port must be between 1 and 65535.',
    }),
    targetPort: stringToNumber.refine((val) => val >= 1 && val <= 65535, {
        message: 'Target container port must be between 1 and 65535.',
    }),
    protocol: publicEndpointProtocolZodModel.default('TCP'),
    sourceCidrsText: z.string().optional().default('').refine((value) => {
        if (!value.trim()) {
            return true;
        }
        return value.split(/[\n,]/).map(item => item.trim()).filter(Boolean).every(isIpv4Cidr);
    }, 'Source CIDRs must be comma or newline separated IPv4 CIDR ranges.'),
    proxyProtocol: z.boolean().default(false),
    enabled: z.boolean().default(true),
});

export type PublicEndpointEditModel = z.infer<typeof publicEndpointEditZodModel>;

export function parseSourceCidrsText(value: string | undefined): string[] {
    return (value ?? '')
        .split(/[\n,]/)
        .map(item => item.trim())
        .filter(Boolean);
}

export function filterValidSourceCidrs(value: string[]): string[] {
    return value.filter(isIpv4Cidr);
}

export function parseSourceCidrsJson(value: string | null | undefined): string[] {
    if (!value) {
        return [];
    }
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed)
            ? parsed.map(item => typeof item === 'string' ? item.trim() : '').filter(isIpv4Cidr)
            : [];
    } catch {
        return [];
    }
}

export function formatSourceCidrsText(value: string | null | undefined): string {
    return parseSourceCidrsJson(value).join('\n');
}
