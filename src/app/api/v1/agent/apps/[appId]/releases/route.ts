import apiKeyService from "@/server/services/api-key.service";
import appService from "@/server/services/app.service";
import dataAccess from "@/server/adapter/db.client";
import deploymentRecordService from "@/server/services/deployment-record.service";
import deploymentService from "@/server/services/deployment.service";
import podService from "@/server/services/pod.service";
import { assertSessionCanReadApp } from "@/server/utils/action-wrapper.utils";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

function parseImageRef(imageReference: string | null | undefined) {
    if (!imageReference) return undefined;
    const slashIndex = imageReference.indexOf('/');
    const imagePath = slashIndex >= 0 ? imageReference.slice(slashIndex + 1) : imageReference;
    const registry = slashIndex >= 0 ? imageReference.slice(0, slashIndex) : '';
    const digestIndex = imagePath.indexOf('@');
    const tagIndex = imagePath.lastIndexOf(':');
    return {
        registry,
        repository: digestIndex >= 0 ? imagePath.slice(0, digestIndex) : tagIndex > 0 ? imagePath.slice(0, tagIndex) : imagePath,
        digest: digestIndex >= 0 ? imagePath.slice(digestIndex + 1) : undefined,
        tag: tagIndex > 0 && digestIndex < 0 ? imagePath.slice(tagIndex + 1) : undefined,
    };
}

function releaseStatus(status: string) {
    if (status === 'SUCCESS' || status === 'SUCCEEDED') return 'healthy';
    if (status === 'FAILED') return 'failed';
    return 'progressing';
}

function releaseStrategy(release: any) {
    if (release.buildStrategy) return release.buildStrategy;
    return release.sourceType === 'CONTAINER' ? 'existing-image' : 'source-tar';
}

function releaseImage(release: any, app: any) {
    if (release.imageJson) {
        try { return JSON.parse(release.imageJson); } catch { /* fall back below */ }
    }
    return parseImageRef(release.imageReference ?? app.containerImageSource);
}

function unauthorized() {
    return NextResponse.json({ status: 'error', message: 'Missing or invalid API key.' }, { status: 401 });
}

function forbidden(message = 'API key is not authorized to read releases for this app.') {
    return NextResponse.json({ status: 'error', message }, { status: 403 });
}

export async function GET(request: Request, { params }: { params: Promise<{ appId: string }> }) {
    let authenticated;
    try {
        authenticated = await apiKeyService.authenticateAuthorizationHeader(request.headers.get('authorization'));
    } catch {
        return unauthorized();
    }

    const { appId } = await params;
    if (!apiKeyService.hasScope(authenticated.apiKey, 'apps:read')) {
        return forbidden('API key does not have app read permission.');
    }

    const app = await appService.getById(appId).catch(() => null);
    if (!app) {
        return NextResponse.json({ status: 'error', message: 'App not found.' }, { status: 404 });
    }
    if (!apiKeyService.isAllowedForApp(authenticated.apiKey, app)) {
        return forbidden();
    }
    try { assertSessionCanReadApp(authenticated.session, app.id); } catch { return forbidden('API key user is not authorized to read this app.'); }

    const releaseId = new URL(request.url).searchParams.get('releaseId');
    const releases = await dataAccess.client.deploymentRecord.findMany({
        where: { appId: app.id, ...(releaseId ? { deploymentId: releaseId } : {}) },
        orderBy: { createdAt: 'desc' },
        take: releaseId ? 1 : 50,
    });
    if (releaseId && releases.length === 0) {
        return NextResponse.json({ status: 'error', message: 'Release not found.' }, { status: 404 });
    }

    const activeStatusByDeploymentId = new Map<string, string>();
    if (releases.some(release => release.status === 'RUNNING')) {
        const [deployment, pods] = await Promise.all([
            deploymentService.getDeployment(app.projectId, app.id).catch(() => null),
            podService.getPodsForApp(app.projectId, app.id).catch(() => []),
        ]);
        await Promise.all(releases.filter(release => release.status === 'RUNNING').map(async release => {
            const status = deploymentRecordService.deploymentStatus(release.deploymentId, deployment, app.replicas ?? 1, pods);
            const recordStatus = status.rolloutState === 'healthy' ? 'SUCCESS' : (status.rolloutState === 'failed' || status.rolloutState === 'timed_out') ? 'FAILED' : undefined;
            if (recordStatus) {
                activeStatusByDeploymentId.set(release.deploymentId, recordStatus);
                await dataAccess.client.deploymentRecord.updateMany({ where: { appId: app.id, deploymentId: release.deploymentId }, data: { status: recordStatus } }).catch(() => undefined);
            }
        }));
    }

    const mapped = releases.map((release, index) => {
        const releaseMetadata = release as any;
        const effectiveStatus = activeStatusByDeploymentId.get(release.deploymentId) ?? release.status;
        return {
            ...release,
            status: effectiveStatus,
            release: {
                id: release.deploymentId,
                deploymentId: release.deploymentId,
                image: releaseImage(releaseMetadata, app),
                imageReference: releaseMetadata.imageReference ?? app.containerImageSource,
                strategy: releaseStrategy(releaseMetadata),
                sourceProvenance: releaseMetadata.sourceProvenance,
                buildId: releaseMetadata.buildId,
                cacheHit: releaseMetadata.cacheHit ?? false,
                status: releaseStatus(effectiveStatus),
                createdAt: release.createdAt instanceof Date ? release.createdAt.toISOString() : String(release.createdAt),
                healthy: releaseStatus(effectiveStatus) === 'healthy',
                message: release.gitCommitHash ? `${effectiveStatus} (${release.gitCommitHash})` : effectiveStatus,
                priorReleaseId: releases[index + 1]?.deploymentId,
            },
        };
    });

    return NextResponse.json({
        status: 'success',
        appId: app.id,
        projectId: app.projectId,
        ...(releaseId ? { release: mapped[0].release, deploymentRecord: mapped[0] } : { releases: mapped }),
    });
}
