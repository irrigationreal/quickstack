'use server'

import { SuccessActionResult } from "@/shared/model/server-action-error-return.model";
import projectService from "@/server/services/project.service";
import { getAdminUserSession, getAuthUserSession, saveFormAction, simpleAction } from "@/server/utils/action-wrapper.utils";
import { z } from "zod";
import { UserGroupUtils } from "@/shared/utils/role.utils";
import { ServiceException } from "@/shared/model/service.exception.model";
import auditService, { auditActorFromSession } from "@/server/services/audit.service";

const createProjectSchema = z.object({
    projectName: z.string().min(1),
    projectId: z.string().optional()
});

export const createProject = async (projectName: string, projectId?: string) =>
    saveFormAction({ projectName, projectId }, createProjectSchema, async (validatedData) => {
        const session = await getAdminUserSession();
        const actor = auditActorFromSession(session);
        await auditService.recordRequired({
            ...actor,
            action: "PROJECT_CREATE_REQUESTED",
            outcome: "REQUESTED",
            targetType: "PROJECT",
            targetId: validatedData.projectId ?? undefined,
            projectId: validatedData.projectId ?? undefined,
            metadata: { projectName: validatedData.projectName },
        });
        const project = await projectService.save({
            id: validatedData.projectId ?? undefined,
            name: validatedData.projectName
        });
        await auditService.recordBestEffort({
            ...actor,
            action: "PROJECT_CREATE_REQUESTED",
            outcome: "SUCCESS",
            targetType: "PROJECT",
            targetId: project.id,
            projectId: project.id,
            projectName: project.name,
        });
        return new SuccessActionResult(undefined, "Project created successfully.");
    });

export const deleteProject = async (projectId: string) =>
    simpleAction(async () => {
        const session = await getAdminUserSession();
        const project = await projectService.getById(projectId);
        const actor = auditActorFromSession(session);
        await auditService.recordRequired({
            ...actor,
            action: "PROJECT_DELETE_REQUESTED",
            outcome: "REQUESTED",
            targetType: "PROJECT",
            targetId: project.id,
            projectId: project.id,
            projectName: project.name,
        });
        await projectService.deleteById(projectId);
        await auditService.recordBestEffort({
            ...actor,
            action: "PROJECT_DELETE_REQUESTED",
            outcome: "SUCCESS",
            targetType: "PROJECT",
            targetId: project.id,
            projectId: project.id,
            projectName: project.name,
        });
        return new SuccessActionResult(undefined, "Project deleted successfully.");
    });