import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import auditService from "@/server/services/audit.service";
import dataAccess from "@/server/adapter/db.client";
import { assertSessionCanWriteApp } from "@/server/utils/action-wrapper.utils";
import { appVolumeEditZodModel } from "@/shared/model/volume-edit.model";
import { ServiceException } from "@/shared/model/service.exception.model";
import { NextResponse } from "next/server";
import { z } from "zod";

export const dynamic = "force-dynamic";

const volumeAddZodModel = appVolumeEditZodModel.extend({
    id: z.string().min(1).optional(),
});

const volumeRemoveZodModel = z.object({
    id: z.string().min(1).optional(),
    containerMountPath: z.string().trim().min(1).optional(),
}).refine(value => Boolean(value.id || value.containerMountPath), {
    message: 'Volume id or containerMountPath is required.',
});

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to manage volumes for this app.') {
    return NextResponse.json({ status: 'error', message }, { status: 403 });
}

function mapVolume(volume: any) {
    return {
        id: volume.id,
        appId: volume.appId,
        containerMountPath: volume.containerMountPath,
        size: volume.size,
        accessMode: volume.accessMode,
        storageClassName: volume.storageClassName,
        shareWithOtherApps: volume.shareWithOtherApps,
        sharedVolumeId: volume.sharedVolumeId,
        createdAt: volume.createdAt,
        updatedAt: volume.updatedAt,
    };
}

async function authenticateAndAuthorize(request: Request, appId: string, scope: 'apps:read' | 'apps:write') {
    const authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    const app = await appService.getExtendedById(appId, false);

    if (!apiKeyService.hasScope(authenticated.apiKey, scope)) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_APP_VOLUME_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: appId,
            appId,
            message: `API key does not have ${scope} scope.`,
        });
        return { response: forbidden(scope === 'apps:read' ? 'API key does not have app read permission.' : 'API key does not have app configuration permission.') };
    }

    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
        await auditService.recordBestEffort({
            ...authenticated.auditActor,
            action: 'AGENT_APP_VOLUME_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: app.id,
            projectId: app.projectId,
            appId: app.id,
            appName: app.name,
            message: 'API key allowlist does not include this app.',
        });
        return { response: forbidden() };
    }

    if (scope === 'apps:write') {
        try {
            assertSessionCanWriteApp(authenticated.session, app.id);
        } catch (error) {
            await auditService.recordBestEffort({
                ...authenticated.auditActor,
                action: 'AGENT_APP_VOLUME_REQUESTED',
                outcome: 'DENIED',
                targetType: 'APP',
                targetId: app.id,
                projectId: app.projectId,
                appId: app.id,
                appName: app.name,
                message: error instanceof Error ? error.message : 'API key user is not authorized for this app.',
            });
            return { response: forbidden() };
        }
    }

    return { authenticated, app };
}

export async function GET(request: Request, { params }: { params: Promise<{ appId: string }> }) {
    const { appId } = await params;
    let authorized;
    try {
        authorized = await authenticateAndAuthorize(request, appId, 'apps:read');
    } catch {
        return unauthorized();
    }
    if ('response' in authorized) return authorized.response;

    return NextResponse.json({
        status: 'success',
        appId: authorized.app.id,
        projectId: authorized.app.projectId,
        volumes: authorized.app.appVolumes.map(mapVolume),
    });
}

export async function POST(request: Request, { params }: { params: Promise<{ appId: string }> }) {
    const { appId } = await params;
    let authorized;
    try {
        authorized = await authenticateAndAuthorize(request, appId, 'apps:write');
    } catch {
        return unauthorized();
    }
    if ('response' in authorized) return authorized.response;

    const parsed = volumeAddZodModel.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
        return NextResponse.json({ status: 'error', message: 'Invalid volume payload.' }, { status: 400 });
    }

    try {
        const existingVolume = parsed.data.id ? await appService.getVolumeById(parsed.data.id) : undefined;
        if (existingVolume && existingVolume.appId !== authorized.app.id) {
            return forbidden();
        }
        if (existingVolume && existingVolume.size > parsed.data.size) {
            throw new ServiceException('Volume size cannot be decreased');
        }
        if (existingVolume && existingVolume.storageClassName !== parsed.data.storageClassName) {
            throw new ServiceException('Storage class cannot be changed for existing volumes');
        }
        if (authorized.app.replicas > 1 && parsed.data.accessMode === 'ReadWriteOnce') {
            throw new ServiceException('Volume access mode must be ReadWriteMany because your app has more than one replica configured.');
        }
        if (parsed.data.accessMode === 'ReadWriteMany' && parsed.data.storageClassName === 'local-path') {
            throw new ServiceException('The Local Path storage class does not support ReadWriteMany access mode. Please choose another storage class / access mode.');
        }
        if (parsed.data.shareWithOtherApps && (existingVolume?.accessMode ?? parsed.data.accessMode) !== 'ReadWriteMany') {
            throw new ServiceException('Only ReadWriteMany volumes can be shared with other apps.');
        }

        const volume = await appService.saveVolume({
            appId: authorized.app.id,
            id: parsed.data.id,
            containerMountPath: parsed.data.containerMountPath,
            size: parsed.data.size,
            accessMode: existingVolume?.accessMode ?? parsed.data.accessMode ?? 'ReadWriteOnce',
            storageClassName: existingVolume?.storageClassName ?? parsed.data.storageClassName,
            shareWithOtherApps: parsed.data.shareWithOtherApps ?? false,
            sharedVolumeId: null,
        });

        await auditService.recordBestEffort({
            ...authorized.authenticated.auditActor,
            action: 'AGENT_APP_VOLUME_REQUESTED',
            outcome: 'SUCCESS',
            targetType: 'APP_VOLUME',
            targetId: volume.id,
            projectId: authorized.app.projectId,
            appId: authorized.app.id,
            appName: authorized.app.name,
            metadata: {
                containerMountPath: volume.containerMountPath,
                size: volume.size,
                accessMode: volume.accessMode,
                storageClassName: volume.storageClassName,
            },
        });

        return NextResponse.json({
            status: 'success',
            appId: authorized.app.id,
            projectId: authorized.app.projectId,
            volume: mapVolume(volume),
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Volume mutation failed.';
        await auditService.recordBestEffort({
            ...authorized.authenticated.auditActor,
            action: 'AGENT_APP_VOLUME_REQUESTED',
            outcome: 'DENIED',
            targetType: 'APP',
            targetId: authorized.app.id,
            projectId: authorized.app.projectId,
            appId: authorized.app.id,
            appName: authorized.app.name,
            message,
        });
        if (error instanceof ServiceException) {
            return NextResponse.json({ status: 'error', message }, { status: 400 });
        }
        throw error;
    }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ appId: string }> }) {
    const { appId } = await params;
    let authorized;
    try {
        authorized = await authenticateAndAuthorize(request, appId, 'apps:write');
    } catch {
        return unauthorized();
    }
    if ('response' in authorized) return authorized.response;

    const parsed = volumeRemoveZodModel.safeParse(await request.json().catch(() => Object.fromEntries(new URL(request.url).searchParams.entries())));
    if (!parsed.success) {
        return NextResponse.json({ status: 'error', message: 'Invalid volume removal payload.' }, { status: 400 });
    }

    const volume = parsed.data.id
        ? authorized.app.appVolumes.find(item => item.id === parsed.data.id)
        : authorized.app.appVolumes.find(item => item.containerMountPath === parsed.data.containerMountPath);
    if (!volume) {
        return NextResponse.json({ status: 'error', message: 'Volume not found.' }, { status: 404 });
    }

    const sharedDependents = await dataAccess.client.appVolume.count({ where: { sharedVolumeId: volume.id } });
    if (sharedDependents > 0) {
        return NextResponse.json({ status: 'error', message: 'Volume is shared with another app and cannot be removed until dependents are detached.' }, { status: 409 });
    }

    await appService.deleteVolumeById(volume.id);
    await auditService.recordBestEffort({
        ...authorized.authenticated.auditActor,
        action: 'AGENT_APP_VOLUME_REQUESTED',
        outcome: 'SUCCESS',
        targetType: 'APP_VOLUME',
        targetId: volume.id,
        projectId: authorized.app.projectId,
        appId: authorized.app.id,
        appName: authorized.app.name,
        message: 'Volume detached from app.',
        metadata: {
            containerMountPath: volume.containerMountPath,
            size: volume.size,
            accessMode: volume.accessMode,
            storageClassName: volume.storageClassName,
        },
    });

    return NextResponse.json({
        status: 'success',
        appId: authorized.app.id,
        projectId: authorized.app.projectId,
        removed: mapVolume(volume),
    });
}
