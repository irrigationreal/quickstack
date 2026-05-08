'use server'

import { SuccessActionResult } from "@/shared/model/server-action-error-return.model";
import appService from "@/server/services/app.service";
import deploymentService from "@/server/services/deployment.service";
import { isAuthorizedReadForApp, isAuthorizedWriteForApp, simpleAction } from "@/server/utils/action-wrapper.utils";
import eventService from "@/server/services/event.service";
import auditService, { auditActorFromSession } from "@/server/services/audit.service";


export const deploy = async (appId: string, forceBuild = false) =>
    simpleAction(async () => {
        const session = await isAuthorizedWriteForApp(appId);
        await appService.buildAndDeploy(appId, forceBuild, auditActorFromSession(session));
        return new SuccessActionResult(undefined, 'Successfully started deployment.');
    });

export const stopApp = async (appId: string) =>
    simpleAction(async () => {
        const session = await isAuthorizedWriteForApp(appId);
        const app = await appService.getExtendedById(appId);
        const actor = auditActorFromSession(session);
        await auditService.recordRequired({
            ...actor,
            action: "APP_STOP_REQUESTED",
            outcome: "REQUESTED",
            targetType: "APP",
            targetId: app.id,
            projectId: app.projectId,
            projectName: app.project.name,
            appId: app.id,
            appName: app.name,
        });
        try {
            await deploymentService.setReplicasForDeployment(app.projectId, app.id, 0);
            await auditService.recordBestEffort({
                ...actor,
                action: "APP_STOP_REQUESTED",
                outcome: "SUCCESS",
                targetType: "APP",
                targetId: app.id,
                projectId: app.projectId,
                projectName: app.project.name,
                appId: app.id,
                appName: app.name,
            });
        } catch (error) {
            await auditService.recordBestEffort({
                ...actor,
                action: "APP_STOP_REQUESTED",
                outcome: "FAILED",
                targetType: "APP",
                targetId: app.id,
                projectId: app.projectId,
                projectName: app.project.name,
                appId: app.id,
                appName: app.name,
                message: error instanceof Error ? error.message : "Failed to stop app.",
            });
            throw error;
        }
        return new SuccessActionResult(undefined, 'Successfully stopped app.');
    });

export const startApp = async (appId: string) =>
    simpleAction(async () => {
        const session = await isAuthorizedWriteForApp(appId);
        const app = await appService.getExtendedById(appId);
        const actor = auditActorFromSession(session);
        await auditService.recordRequired({
            ...actor,
            action: "APP_START_REQUESTED",
            outcome: "REQUESTED",
            targetType: "APP",
            targetId: app.id,
            projectId: app.projectId,
            projectName: app.project.name,
            appId: app.id,
            appName: app.name,
            metadata: { replicas: app.replicas },
        });
        try {
            await deploymentService.setReplicasForDeployment(app.projectId, app.id, app.replicas);
            await auditService.recordBestEffort({
                ...actor,
                action: "APP_START_REQUESTED",
                outcome: "SUCCESS",
                targetType: "APP",
                targetId: app.id,
                projectId: app.projectId,
                projectName: app.project.name,
                appId: app.id,
                appName: app.name,
                metadata: { replicas: app.replicas },
            });
        } catch (error) {
            await auditService.recordBestEffort({
                ...actor,
                action: "APP_START_REQUESTED",
                outcome: "FAILED",
                targetType: "APP",
                targetId: app.id,
                projectId: app.projectId,
                projectName: app.project.name,
                appId: app.id,
                appName: app.name,
                message: error instanceof Error ? error.message : "Failed to start app.",
                metadata: { replicas: app.replicas },
            });
            throw error;
        }
        return new SuccessActionResult(undefined, 'Successfully started app.');
    });

export const getLatestAppEvents = async (appId: string) =>
    simpleAction(async () => {
        await isAuthorizedReadForApp(appId);
        const app = await appService.getById(appId);
        return await eventService.getEventsForApp(app.projectId, app.id);
    });
