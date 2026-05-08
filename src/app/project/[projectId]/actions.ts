'use server'

import { SuccessActionResult } from "@/shared/model/server-action-error-return.model";
import appService from "@/server/services/app.service";
import { getAuthUserSession, isAuthorizedWriteForApp, saveFormAction, simpleAction } from "@/server/utils/action-wrapper.utils";
import { z } from "zod";
import appTemplateService from "@/server/services/app-template.service";
import { AppTemplateModel, appTemplateZodModel } from "@/shared/model/app-template.model";
import { ServiceException } from "@/shared/model/service.exception.model";
import dbGateService from "@/server/services/db-tool-services/dbgate.service";
import fileBrowserService from "@/server/services/file-browser-service";
import phpMyAdminService from "@/server/services/db-tool-services/phpmyadmin.service";
import pgAdminService from "@/server/services/db-tool-services/pgadmin.service";
import { UserGroupUtils } from "@/shared/utils/role.utils";
import auditService, { auditActorFromSession } from "@/server/services/audit.service";

const createAppSchema = z.object({
    appName: z.string().min(1)
});

export const createApp = async (appName: string, projectId: string, appId?: string) =>
    saveFormAction({ appName }, createAppSchema, async (validatedData) => {
        const session = await getAuthUserSession();
        if (!UserGroupUtils.sessionCanCreateNewAppsForProject(session, projectId)) {
            throw new ServiceException("You are not allowed to create new apps.");
        }

        const actor = auditActorFromSession(session);
        await auditService.recordRequired({
            ...actor,
            action: "APP_CREATE_REQUESTED",
            outcome: "REQUESTED",
            targetType: "APP",
            targetId: appId ?? undefined,
            projectId,
            metadata: { appName: validatedData.appName },
        });
        try {
            const returnData = await appService.save({
                id: appId ?? undefined,
                name: validatedData.appName,
                projectId
            });
            await auditService.recordBestEffort({
                ...actor,
                action: "APP_CREATE_REQUESTED",
                outcome: "SUCCESS",
                targetType: "APP",
                targetId: returnData.id,
                projectId,
                appId: returnData.id,
                appName: returnData.name,
            });
            return new SuccessActionResult(returnData, "App created successfully.");
        } catch (error) {
            await auditService.recordRequired({
                ...actor,
                action: "APP_CREATE_REQUESTED",
                outcome: "DENIED",
                targetType: "APP",
                targetId: appId ?? undefined,
                projectId,
                message: error instanceof Error ? error.message : "App creation failed.",
                metadata: { appName: validatedData.appName },
            });
            throw error;
        }
    });

export const createAppFromTemplate = async (prevState: any, inputData: AppTemplateModel, projectId: string) =>
    saveFormAction(inputData, appTemplateZodModel, async (validatedData) => {
        const session = await getAuthUserSession();
        if (!UserGroupUtils.sessionCanCreateNewAppsForProject(session, projectId)) {
            throw new ServiceException("You are not allowed to create new apps.");
        }
        if (validatedData.templates.some(x => x.inputSettings.some(y => !y.randomGeneratedIfEmpty && !y.value))) {
            throw new ServiceException('Please fill out all required fields.');
        }
        const actor = auditActorFromSession(session);
        await auditService.recordRequired({
            ...actor,
            action: "APP_TEMPLATE_CREATE_REQUESTED",
            outcome: "REQUESTED",
            targetType: "PROJECT",
            targetId: projectId,
            projectId,
            metadata: { templateCount: validatedData.templates.length },
        });
        try {
            await appTemplateService.createAppFromTemplate(projectId, validatedData);
            await auditService.recordBestEffort({
                ...actor,
                action: "APP_TEMPLATE_CREATE_REQUESTED",
                outcome: "SUCCESS",
                targetType: "PROJECT",
                targetId: projectId,
                projectId,
                metadata: { templateCount: validatedData.templates.length },
            });
        } catch (error) {
            await auditService.recordRequired({
                ...actor,
                action: "APP_TEMPLATE_CREATE_REQUESTED",
                outcome: "DENIED",
                targetType: "PROJECT",
                targetId: projectId,
                projectId,
                message: error instanceof Error ? error.message : "Template app creation failed.",
                metadata: { templateCount: validatedData.templates.length },
            });
            throw error;
        }
        return new SuccessActionResult(undefined, "");
    });

export const deleteApp = async (appId: string) =>
    simpleAction(async () => {
        const session = await getAuthUserSession();
        const app = await appService.getExtendedById(appId);
        if (!UserGroupUtils.sessionCanDeleteAppsForProject(session, app.projectId)) {
            throw new ServiceException("You are not allowed to delete apps in this project.");
        }
        // First delete external services wich might be running
        await dbGateService.deleteToolForAppIfExists(appId);
        await phpMyAdminService.deleteToolForAppIfExists(appId);
        await pgAdminService.deleteToolForAppIfExists(appId);
        for (const volume of app.appVolumes) {
            await fileBrowserService.deleteFileBrowserForVolumeIfExists(volume.id);
        }
        const actor = auditActorFromSession(session);
        await auditService.recordRequired({
            ...actor,
            action: "APP_DELETE_REQUESTED",
            outcome: "REQUESTED",
            targetType: "APP",
            targetId: app.id,
            projectId: app.projectId,
            projectName: app.project.name,
            appId: app.id,
            appName: app.name,
        });
        try {
            // delete the app drom database and all kubernetes objects
            await appService.deleteById(appId);
            await auditService.recordBestEffort({
                ...actor,
                action: "APP_DELETE_REQUESTED",
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
                action: "APP_DELETE_REQUESTED",
                outcome: "FAILED",
                targetType: "APP",
                targetId: app.id,
                projectId: app.projectId,
                projectName: app.project.name,
                appId: app.id,
                appName: app.name,
                message: error instanceof Error ? error.message : "App deletion failed.",
            });
            throw error;
        }
        return new SuccessActionResult(undefined, "App deleted successfully.");
    });