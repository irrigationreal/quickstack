import { AuditEvent, Prisma } from "@prisma/client";
import { revalidateTag, unstable_cache } from "next/cache";
import dataAccess from "../adapter/db.client";
import { Tags } from "../utils/cache-tag-generator.utils";
import { ServiceException } from "@/shared/model/service.exception.model";
import { AuditEventFilterModel } from "@/shared/model/audit-event-filter.model";
import { UserSession } from "@/shared/model/sim-session.model";

type ActorType = "USER" | "WEBHOOK" | "SYSTEM" | "API_KEY";
type AuditOutcome = "REQUESTED" | "SUCCESS" | "DENIED" | "FAILED";

export type AuditActor = {
    actorType: ActorType;
    actorUserId?: string | null;
    actorEmail: string;
    actorGroupName?: string | null;
    apiKeyId?: string | null;
    apiKeyName?: string | null;
};

export type AuditEventInput = AuditActor & {
    action: string;
    outcome: AuditOutcome;
    targetType: string;
    targetId?: string | null;
    projectId?: string | null;
    projectName?: string | null;
    appId?: string | null;
    appName?: string | null;
    deploymentId?: string | null;
    apiKeyId?: string | null;
    apiKeyName?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
    message?: string | null;
    metadata?: unknown;
};

const SECRET_KEY_PATTERN = /(password|token|secret|key|credential|authorization|cookie|envvars|envVars|private)/i;
const EXPECTED_AUDIT_TRIGGERS = ["AuditEvent_no_update", "AuditEvent_no_delete"];

function sanitizeMetadata(value: unknown): unknown {
    if (value === null || value === undefined) {
        return value;
    }
    if (Array.isArray(value)) {
        return value.map(sanitizeMetadata);
    }
    if (value instanceof Date) {
        return value.toISOString();
    }
    if (typeof value === "object") {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, nestedValue]) => {
            if (SECRET_KEY_PATTERN.test(key)) {
                return [key, "[REDACTED]"];
            }
            return [key, sanitizeMetadata(nestedValue)];
        }));
    }
    return value;
}

export function auditActorFromSession(session: UserSession): AuditActor {
    return {
        actorType: "USER",
        actorUserId: session.id,
        actorEmail: session.email,
        actorGroupName: session.userGroup?.name ?? null,
    };
}

class AuditService {
    async assertIntegrityGuards() {
        if (process.env.NODE_ENV !== "production") {
            return;
        }
        const rows = await dataAccess.client.$queryRaw<Array<{ name: string }>>`
            SELECT name FROM sqlite_master WHERE type = 'trigger' AND tbl_name = 'AuditEvent'
        `;
        const triggerNames = new Set(rows.map(row => row.name));
        const missing = EXPECTED_AUDIT_TRIGGERS.filter(triggerName => !triggerNames.has(triggerName));
        if (missing.length > 0) {
            throw new ServiceException(`Audit integrity guard is missing required trigger(s): ${missing.join(", ")}.`);
        }
    }

    async record(event: AuditEventInput) {
        await this.assertIntegrityGuards();
        const metadataJson = event.metadata === undefined ? undefined : JSON.stringify(sanitizeMetadata(event.metadata));
        const saved = await dataAccess.client.auditEvent.create({
            data: {
                actorType: event.actorType,
                actorUserId: event.actorUserId ?? undefined,
                actorEmail: event.actorEmail,
                actorGroupName: event.actorGroupName ?? undefined,
                action: event.action,
                outcome: event.outcome,
                targetType: event.targetType,
                targetId: event.targetId ?? undefined,
                projectId: event.projectId ?? undefined,
                projectName: event.projectName ?? undefined,
                appId: event.appId ?? undefined,
                appName: event.appName ?? undefined,
                deploymentId: event.deploymentId ?? undefined,
                apiKeyId: event.apiKeyId ?? undefined,
                apiKeyName: event.apiKeyName ?? undefined,
                ipAddress: event.ipAddress ?? undefined,
                userAgent: event.userAgent ?? undefined,
                message: event.message ?? undefined,
                metadataJson,
            }
        });
        revalidateTag(Tags.auditEvents());
        return saved;
    }

    async recordRequired(event: AuditEventInput) {
        try {
            return await this.record(event);
        } catch (error) {
            console.error("Required audit event write failed", error);
            throw new ServiceException("Security audit trail is unavailable; refusing to continue.");
        }
    }

    async recordBestEffort(event: AuditEventInput) {
        try {
            await this.record(event);
        } catch (error) {
            console.error("Audit event write failed after side effect", error);
        }
    }

    async list(filters: AuditEventFilterModel = {}, take = 100): Promise<AuditEvent[]> {
        await this.assertIntegrityGuards();
        return unstable_cache(async (filters: AuditEventFilterModel, take: number) => {
            const where: Prisma.AuditEventWhereInput = {};
            if (filters.actorEmail) where.actorEmail = { contains: filters.actorEmail };
            if (filters.action) where.action = filters.action;
            if (filters.outcome) where.outcome = filters.outcome;
            if (filters.projectId) where.projectId = filters.projectId;
            if (filters.appId) where.appId = filters.appId;
            if (filters.deploymentId) where.deploymentId = filters.deploymentId;
            if (filters.from || filters.to) {
                where.createdAt = {
                    gte: filters.from ? new Date(filters.from) : undefined,
                    lte: filters.to ? new Date(filters.to) : undefined,
                };
            }
            return dataAccess.client.auditEvent.findMany({
                where,
                orderBy: {
                    createdAt: "desc"
                },
                take,
            });
        }, [Tags.auditEvents(), JSON.stringify(filters), String(take)], {
            tags: [Tags.auditEvents()]
        })(filters, take);
    }
}

const auditService = new AuditService();
export default auditService;
