import { V1Job } from "@kubernetes/client-node";
import { BuildJobBuilder, BuildJobBuilderContext } from "./build-job-builder.interface";
import { AppBuildMethod } from "@/shared/model/app-source-info.model";
import { Constants } from "@/shared/utils/constants";
import buildQueueInitContainer from "./build-init-container.service";
import buildGitInitContainerService, { BUILD_GIT_SSH_KEY_VOLUME_NAME } from "./build-git-init-container.service";
import registryService, { BUILD_NAMESPACE } from "../registry.service";
import { PathUtils } from "@/server/utils/path.utils";
import { BUILD_SOURCE_PATH, BUILD_WORKSPACE_MOUNT_PATH, BUILD_WORKSPACE_VOLUME_NAME } from "./build-workspace.constants";

export const BUILDKIT_IMAGE = process.env.QS_BUILDKIT_IMAGE || "moby/buildkit:v0.29.0";

class DockerfileBuildJobBuilder implements BuildJobBuilder {
    readonly buildMethod: AppBuildMethod = 'DOCKERFILE';

    async buildJobDefinition(ctx: BuildJobBuilderContext): Promise<V1Job> {
        const contextPaths = PathUtils.splitPath(ctx.app.dockerfilePath || './Dockerfile');
        const dockerfileContextPath = this.getDockerfileContextPath(contextPaths.folderPath);

        const cacheReference = registryService.createInternalContainerRegistryUrlForAppId(ctx.app.id, 'buildcache');
        const buildkitArgs = [
            "build",
            "--frontend",
            "dockerfile.v0",
            "--local",
            `context=${dockerfileContextPath}`,
            "--local",
            `dockerfile=${dockerfileContextPath}`,
            "--opt",
            `filename=${this.getDockerfileFilename(ctx.app.dockerfilePath || './Dockerfile', contextPaths.filePath)}`,
            "--import-cache",
            `type=registry,ref=${cacheReference},registry.insecure=true`,
            "--export-cache",
            `type=registry,ref=${cacheReference},mode=max,registry.insecure=true`,
            "--output",
            `type=image,name=${registryService.createInternalContainerRegistryUrlForAppId(ctx.app.id, ctx.buildName)},push=true,registry.insecure=true`
        ];

        return {
            apiVersion: "batch/v1",
            kind: "Job",
            metadata: {
                name: ctx.buildName,
                namespace: BUILD_NAMESPACE,
                annotations: {
                    [Constants.QS_ANNOTATION_APP_ID]: ctx.app.id,
                    [Constants.QS_ANNOTATION_PROJECT_ID]: ctx.app.projectId,
                    [Constants.QS_ANNOTATION_GIT_COMMIT]: ctx.latestRemoteGitHash,
                    [Constants.QS_ANNOTATION_GIT_COMMIT_MESSAGE]: ctx.latestRemoteGitCommitMessage.substring(0, 200),
                    [Constants.QS_ANNOTATION_DEPLOYMENT_ID]: ctx.deploymentId,
                    [Constants.QS_ANNOTATION_BUILD_QUEUED_AT]: ctx.queuedAt,
                    [Constants.QS_ANNOTATION_BUILD_METHOD]: this.buildMethod,
                    ...(ctx.gitSshPrivateKeySecretName ? { [Constants.QS_ANNOTATION_GIT_SSH_SECRET]: ctx.gitSshPrivateKeySecretName } : {}),
                }
            },
            spec: {
                ttlSecondsAfterFinished: 86400,
                template: {
                    metadata: {
                        annotations: {
                            [Constants.QS_ANNOTATION_APP_ID]: ctx.app.id,
                            [Constants.QS_ANNOTATION_PROJECT_ID]: ctx.app.projectId,
                            [Constants.QS_ANNOTATION_GIT_COMMIT]: ctx.latestRemoteGitHash,
                            [Constants.QS_ANNOTATION_GIT_COMMIT_MESSAGE]: ctx.latestRemoteGitCommitMessage.substring(0, 200),
                            [Constants.QS_ANNOTATION_DEPLOYMENT_ID]: ctx.deploymentId,
                            [Constants.QS_ANNOTATION_BUILD_METHOD]: this.buildMethod,
                            ...(ctx.gitSshPrivateKeySecretName ? { [Constants.QS_ANNOTATION_GIT_SSH_SECRET]: ctx.gitSshPrivateKeySecretName } : {}),
                        },
                    },
                    spec: {
                        hostUsers: false,
                        serviceAccountName: 'qs-build-watcher',
                        initContainers: [
                            buildQueueInitContainer.getInitContainer(ctx.buildName, ctx.queuedAt),
                            buildGitInitContainerService.getInitContainer(ctx),
                        ],
                        ...(ctx.nodeSelector ? { nodeSelector: ctx.nodeSelector } : {}),
                        containers: [
                            {
                                name: ctx.buildName,
                                image: BUILDKIT_IMAGE,
                                command: ["buildctl-daemonless.sh"],
                                args: buildkitArgs,
                                securityContext: {
                                    privileged: true
                                },
                                ...(ctx.resources ? { resources: ctx.resources } : {}),
                                volumeMounts: [{ name: BUILD_WORKSPACE_VOLUME_NAME, mountPath: BUILD_WORKSPACE_MOUNT_PATH }],
                            },
                        ],
                        restartPolicy: "Never",
                        volumes: [
                            {
                                name: BUILD_WORKSPACE_VOLUME_NAME,
                                emptyDir: {},
                            },
                            ...(ctx.gitSshPrivateKeySecretName ? [{
                                name: BUILD_GIT_SSH_KEY_VOLUME_NAME,
                                secret: {
                                    secretName: ctx.gitSshPrivateKeySecretName,
                                    defaultMode: 0o400,
                                },
                            }] : []),
                        ],
                    },
                },
                backoffLimit: 0,
            },
        };
    }

    private getDockerfileFilename(dockerfilePath: string, filePath: string) {
        return dockerfilePath === './.quickstack/generated-static.Dockerfile' ? '.quickstack/generated-static.Dockerfile' : filePath;
    }

    private getDockerfileContextPath(folderPath: string | undefined) {
        const normalizedFolderPath = folderPath?.replace(/\/$/, '');
        if (!normalizedFolderPath || normalizedFolderPath === './.quickstack' || normalizedFolderPath === '.quickstack') {
            return BUILD_SOURCE_PATH;
        }

        return `${BUILD_SOURCE_PATH}/${normalizedFolderPath.replace(/^\.\//, '')}`;
    }
}

const dockerfileBuildJobBuilder = new DockerfileBuildJobBuilder();
export default dockerfileBuildJobBuilder;
