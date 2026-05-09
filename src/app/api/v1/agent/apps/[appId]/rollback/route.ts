import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import auditService from "@/server/services/audit.service";
import dataAccess from "@/server/adapter/db.client";
import deploymentService from "@/server/services/deployment.service";
import k3s from "@/server/adapter/kubernetes-api.adapter";
import { assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { ServiceException } from "@/shared/model/service.exception.model";
import { NextResponse } from "next/server";

type ReplicaSetLike = {
    metadata?: {
        name?: string;
        annotations?: Record<string, string>;
    };
    spec?: {
        template?: {
            spec?: {
                containers?: Array<{ name?: string; image?: string }>;
            };
        };
    };
};

export const dynamic = "force-dynamic";

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to rollback this app.') {
    return NextResponse.json({ status: 'error', message }, { status: 403 });
}

function revisionOf(replicaSet: ReplicaSetLike): number {
    const revision = Number(replicaSet.metadata?.annotations?.['deployment.kubernetes.io/revision'] ?? 0);
    return Number.isFinite(revision) ? revision : 0;
}

function firstContainerImage(replicaSet: ReplicaSetLike): string | undefined {
    return replicaSet.spec?.template?.spec?.containers?.[0]?.image;
}

async function previousReplicaSetImage(projectId: string, appId: string, currentImage: string) {
    const replicaSets = await k3s.apps.listNamespacedReplicaSet(projectId, undefined, undefined, undefined, undefined, `app=${appId}`) as { body: { items: ReplicaSetLike[] } };
    return replicaSets.body.items
        .filter(replicaSet => firstContainerImage(replicaSet))
        .sort((left, right) => revisionOf(right) - revisionOf(left))
        .find(replicaSet => firstContainerImage(replicaSet) !== currentImage);
}

export async function POST(request: Request, { params }: { params: Promise<{ appId: string }> }) {
    let authenticated;
    try {
        authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    } catch {
        return unauthorized();
    }

    const { appId } = await params;
    if (!apiKeyService.hasScope(authenticated.apiKey, 'deploy:write')) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_APP_ROLLBACK_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: appId,
            appId,
            message: 'API key does not have deploy:write scope.',
        });
        return forbidden('API key does not have deploy permission.');
    }

    const app = await appService.getById(appId).catch(() => null);
    if (!app) {
        return NextResponse.json({ status: 'error', message: 'App not found.' }, { status: 404 });
    }
    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
        return forbidden();
    }
    try {
        assertSessionCanWriteApp(authenticated.session, app.id);
    } catch {
        return forbidden();
    }

    try {
        const deployment = await deploymentService.getDeployment(app.projectId, app.id);
        const currentImage = deployment?.spec?.template?.spec?.containers?.[0]?.image;
        if (!deployment || !currentImage) {
            return NextResponse.json({ status: 'error', message: 'App has no deployed image to rollback.' }, { status: 400 });
        }

        const previousReplicaSet = await previousReplicaSetImage(app.projectId, app.id, currentImage);
        const previousImage = previousReplicaSet ? firstContainerImage(previousReplicaSet) : undefined;
        if (!previousImage) {
            return NextResponse.json({ status: 'error', message: 'No previous deployment image found for rollback.' }, { status: 409 });
        }

        deployment.spec!.template!.spec!.containers![0].image = previousImage;
        deployment.spec!.template!.metadata = {
            ...(deployment.spec!.template!.metadata ?? {}),
            annotations: {
                ...(deployment.spec!.template!.metadata?.annotations ?? {}),
                rollbackTimestamp: new Date().toISOString(),
            },
        };
        const replaced = await k3s.apps.replaceNamespacedDeployment(app.id, app.projectId, deployment);
        await dataAccess.client.app.update({
            where: { id: app.id },
            data: { sourceType: 'CONTAINER', containerImageSource: previousImage },
        });

        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_APP_ROLLBACK_REQUESTED',
            outcome: 'SUCCESS',
            targetType: 'APP',
            targetId: app.id,
            projectId: app.projectId,
            appId: app.id,
            appName: app.name,
            metadata: {
                fromImage: currentImage,
                toImage: previousImage,
                replicaSet: previousReplicaSet?.metadata?.name,
            },
        });

        return NextResponse.json({
            status: 'success',
            appId: app.id,
            projectId: app.projectId,
            fromImage: currentImage,
            toImage: previousImage,
            replicaSet: previousReplicaSet?.metadata?.name,
            readyReplicas: replaced.body?.status?.readyReplicas ?? null,
        });
    } catch (error) {
        if (error instanceof ServiceException) {
            return NextResponse.json({ status: 'error', message: error.message }, { status: 400 });
        }
        throw error;
    }
}
