import { AppBuildMethod, AppSourceInfoInputModel } from "@/shared/model/app-source-info.model";

export type SourceType = 'GIT' | 'GIT_SSH' | 'CONTAINER';
export type StepId = 'source' | 'git-url' | 'ssh-url' | 'branch' | 'build-method' | 'dockerfile' | 'container-image' | 'summary';
export type SourceFormPatch = Partial<AppSourceInfoInputModel>;

export const sourceTypeLabels: Record<SourceType, string> = {
    GIT: 'Git over HTTPS',
    GIT_SSH: 'Git over SSH',
    CONTAINER: 'Container image',
};

export const buildMethodLabels: Record<AppBuildMethod, string> = {
    RAILPACK: 'Railpack',
    DOCKERFILE: 'Dockerfile',
};

export const defaultDockerfilePath = './Dockerfile';
