import { revalidateTag } from "next/cache";
import dataAccess from "../adapter/db.client";
import { CryptoUtils } from "../utils/crypto.utils";
import { Tags } from "../utils/cache-tag-generator.utils";
import auditService, { AuditActor } from "./audit.service";
import { ServiceException } from "@/shared/model/service.exception.model";

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

export type SecretEnvMutation = {
    name: string;
    value: string;
};

class AppSecretEnvService {
    assertValidSecretName(name: string) {
        if (!ENV_NAME_PATTERN.test(name)) {
            throw new ServiceException(`Invalid secret env name "${name}".`);
        }
    }

    async listNames(appId: string) {
        const rows = await (dataAccess.client as any).appSecretEnvVar.findMany({
            where: { appId },
            select: { name: true, createdAt: true, updatedAt: true },
            orderBy: { name: 'asc' },
        });
        return rows;
    }

    async upsertMany(input: {
        app: { id: string; projectId: string; name: string };
        secrets: SecretEnvMutation[];
        actor: AuditActor;
    }) {
        const uniqueSecrets = new Map<string, string>();
        for (const secret of input.secrets) {
            this.assertValidSecretName(secret.name);
            uniqueSecrets.set(secret.name, secret.value);
        }

        const names = Array.from(uniqueSecrets.keys()).sort();
        await dataAccess.client.$transaction(async (tx) => {
            for (const [name, value] of uniqueSecrets.entries()) {
                await (tx as any).appSecretEnvVar.upsert({
                    where: { appId_name: { appId: input.app.id, name } },
                    create: {
                        appId: input.app.id,
                        name,
                        encryptedValue: CryptoUtils.encrypt(value),
                    },
                    update: {
                        encryptedValue: CryptoUtils.encrypt(value),
                    },
                });
            }
        });

        await auditService.recordBestEffort({
            ...input.actor,
            action: 'APP_SECRET_ENV_UPDATED',
            outcome: 'SUCCESS',
            targetType: 'APP',
            targetId: input.app.id,
            projectId: input.app.projectId,
            appId: input.app.id,
            appName: input.app.name,
            metadata: { names },
        });
        revalidateTag(Tags.apps(input.app.projectId));
        revalidateTag(Tags.app(input.app.id));

        return this.listNames(input.app.id);
    }

    async deleteMany(input: {
        app: { id: string; projectId: string; name: string };
        names: string[];
        actor: AuditActor;
    }) {
        const names = Array.from(new Set(input.names));
        names.forEach(name => this.assertValidSecretName(name));
        await (dataAccess.client as any).appSecretEnvVar.deleteMany({
            where: {
                appId: input.app.id,
                name: { in: names },
            }
        });
        await auditService.recordBestEffort({
            ...input.actor,
            action: 'APP_SECRET_ENV_DELETED',
            outcome: 'SUCCESS',
            targetType: 'APP',
            targetId: input.app.id,
            projectId: input.app.projectId,
            appId: input.app.id,
            appName: input.app.name,
            metadata: { names },
        });
        revalidateTag(Tags.apps(input.app.projectId));
        revalidateTag(Tags.app(input.app.id));
        return this.listNames(input.app.id);
    }

    decryptForKubernetes(encryptedValue: string) {
        return CryptoUtils.decrypt(encryptedValue);
    }
}

const appSecretEnvService = new AppSecretEnvService();
export default appSecretEnvService;
