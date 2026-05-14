import type { ManagedServiceFamily } from "@/shared/model/agent-managed-service.model";

export const managedAppTypes = ['POSTGRES', 'REDIS', 'MYSQL'] as const;

const appTypeByFamily: Record<ManagedServiceFamily, typeof managedAppTypes[number]> = {
    postgres: 'POSTGRES',
    redis: 'REDIS',
    mysql: 'MYSQL',
};

const familyByAppType = Object.fromEntries(
    Object.entries(appTypeByFamily).map(([family, appType]) => [appType, family]),
) as Record<string, ManagedServiceFamily | undefined>;

const defaultSecretByFamily: Record<ManagedServiceFamily, string> = {
    postgres: 'DATABASE_URL',
    redis: 'REDIS_URL',
    mysql: 'MYSQL_URL',
};

const familyBySecret = Object.fromEntries(
    Object.entries(defaultSecretByFamily).map(([family, secretName]) => [secretName, family]),
) as Record<string, ManagedServiceFamily | undefined>;

export function managedAppTypeForFamily(family: ManagedServiceFamily): typeof managedAppTypes[number] {
    return appTypeByFamily[family];
}

export function managedFamilyForAppType(appType: string): ManagedServiceFamily | null {
    return familyByAppType[appType] ?? null;
}

export function defaultManagedSecretName(family: ManagedServiceFamily): string {
    return defaultSecretByFamily[family];
}

export function managedFamilyForSecret(secretName: string): ManagedServiceFamily | null {
    return familyBySecret[secretName] ?? null;
}

export function managedServiceSecretRefs(family: ManagedServiceFamily): string[] {
    return [defaultManagedSecretName(family)];
}

export function hostnameFromConnection(value: string): string | undefined {
    try {
        return new URL(value).hostname;
    } catch {
        const match = value.match(/@([^/:]+)|^([^/:]+):/);
        return match?.[1] || match?.[2];
    }
}
