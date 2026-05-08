'use server'

import { SuccessActionResult } from "@/shared/model/server-action-error-return.model";
import { getAdminUserSession, getAuthUserSession, saveFormAction, simpleAction } from "@/server/utils/action-wrapper.utils";
import { S3TargetEditModel, s3TargetEditZodModel } from "@/shared/model/s3-target-edit.model";
import s3TargetService from "@/server/services/s3-target.service";
import s3Service from "@/server/services/aws-s3.service";
import { S3Target } from "@prisma/client";
import { ServiceException } from "@/shared/model/service.exception.model";
import auditService, { auditActorFromSession } from "@/server/services/audit.service";

export const saveS3Target = async (prevState: any, inputData: S3TargetEditModel) =>
    saveFormAction(inputData, s3TargetEditZodModel, async (validatedData) => {
        const session = await getAdminUserSession();

        const url = new URL(validatedData.endpoint.includes('://') ? validatedData.endpoint : `https://${validatedData.endpoint}`);
        validatedData.endpoint = url.hostname;

        if (!await s3Service.testConnection(validatedData as S3Target)) {
            throw new ServiceException('Could not connect to S3 Target, please check your credentials and try again');
        }

        const saved = await s3TargetService.save({
            ...validatedData,
            id: validatedData.id ?? undefined,
        });
        await auditService.recordBestEffort({
            ...auditActorFromSession(session),
            action: validatedData.id ? "S3_TARGET_UPDATE" : "S3_TARGET_CREATE",
            outcome: "SUCCESS",
            targetType: "S3_TARGET",
            targetId: saved.id,
            metadata: { changedFields: ["name", "bucketName", "endpoint", "region", "accessKeyId", "secretKey"] },
        });
    });

export const deleteS3Target = async (s3TargetId: string) =>
    simpleAction(async () => {
        const session = await getAdminUserSession();
        await s3TargetService.deleteById(s3TargetId);
        await auditService.recordBestEffort({
            ...auditActorFromSession(session),
            action: "S3_TARGET_DELETE",
            outcome: "SUCCESS",
            targetType: "S3_TARGET",
            targetId: s3TargetId,
        });
        return new SuccessActionResult(undefined, 'Successfully deleted S3 Target');
    });