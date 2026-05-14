import { DeploymentStatus, RolloutState } from "@/shared/model/agent-release.model";
import { Constants } from "@/shared/utils/constants";

type DeploymentLike = {
    metadata?: {
        generation?: number;
    };
    spec?: {
        template?: {
            metadata?: {
                annotations?: Record<string, string>;
            };
        };
    };
    status?: {
        observedGeneration?: number;
        replicas?: number;
        readyReplicas?: number;
        conditions?: { type?: string; status?: string; reason?: string; message?: string }[];
    };
};

type PodLike = {
    status?: string;
    state?: string;
    reason?: string;
};

class DeploymentRecordService {
    rolloutState(deployment: DeploymentLike | null | undefined, desiredReplicas: number, pods: PodLike[] = []): { state: RolloutState; message: string } {
        if (pods.filter(pod => pod.reason === 'CrashLoopBackOff' || pod.status === 'CrashLoopBackOff' || pod.state === 'CrashLoopBackOff').length > 0) {
            return { state: 'failed', message: 'One or more pods are in CrashLoopBackOff.' };
        }
        const conditions = deployment?.status?.conditions ?? [];
        const timedOut = conditions.find(condition => condition.reason === 'ProgressDeadlineExceeded');
        if (timedOut) {
            return { state: 'timed_out', message: timedOut.message || 'Deployment exceeded its progress deadline.' };
        }
        const available = conditions.find(condition => condition.type === 'Available' && condition.status === 'True');
        const readyReplicas = deployment?.status?.readyReplicas ?? 0;
        if (desiredReplicas > 0 && readyReplicas >= desiredReplicas && available) {
            return { state: 'healthy', message: 'Deployment is healthy.' };
        }
        const progressing = conditions.find(condition => condition.type === 'Progressing' && condition.status === 'True');
        if ((deployment?.status?.replicas ?? 0) > 0 || progressing) {
            return { state: 'progressing', message: progressing?.message || 'Deployment is progressing.' };
        }
        return { state: 'pending', message: 'Deployment is pending.' };
    }

    deploymentStatus(deploymentId: string, deployment: DeploymentLike | null | undefined, desiredReplicas: number, pods: PodLike[] = []): DeploymentStatus {
        const activeDeploymentId = deployment?.spec?.template?.metadata?.annotations?.[Constants.QS_ANNOTATION_DEPLOYMENT_ID];
        if (!deployment || activeDeploymentId !== deploymentId) {
            return {
                deploymentId,
                rolloutState: 'pending',
                message: activeDeploymentId ? `Waiting for deployment ${deploymentId} to replace active deployment ${activeDeploymentId}.` : `Waiting for deployment ${deploymentId} to be observed by Kubernetes.`,
                observedAt: new Date().toISOString(),
            };
        }
        const observedGeneration = deployment.status?.observedGeneration ?? 0;
        const generation = deployment.metadata?.generation ?? observedGeneration;
        if (generation > observedGeneration) {
            return {
                deploymentId,
                rolloutState: 'pending',
                message: `Waiting for Kubernetes to observe generation ${generation}.`,
                observedAt: new Date().toISOString(),
            };
        }
        const rollout = this.rolloutState(deployment, desiredReplicas, pods);
        return {
            deploymentId,
            rolloutState: rollout.state,
            message: rollout.message,
            observedAt: new Date().toISOString(),
        };
    }
}

const deploymentRecordService = new DeploymentRecordService();
export default deploymentRecordService;
