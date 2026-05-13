import { V1Container } from "@kubernetes/client-node";
import { BuildJobBuilderContext } from "./build-job-builder.interface";
import { BUILD_SOURCE_PATH, BUILD_WORKSPACE_MOUNT_PATH, BUILD_WORKSPACE_VOLUME_NAME } from "./build-workspace.constants";

export const BUILD_GIT_INIT_CONTAINER_NAME = 'build-git-init';
export const BUILD_GIT_SSH_KEY_VOLUME_NAME = 'build-git-ssh-key';
export const BUILD_GIT_SSH_KEY_MOUNT_PATH = '/git-ssh-key';
const GIT_SSH_PRIVATE_KEY_SECRET_KEY = 'ssh-privatekey';
export const BUILD_GIT_SSH_KEY_PATH = `${BUILD_GIT_SSH_KEY_MOUNT_PATH}/${GIT_SSH_PRIVATE_KEY_SECRET_KEY}`;
export const GIT_INIT_IMAGE = process.env.QS_GIT_INIT_IMAGE || 'alpine/git:2.49.1';
export const UPLOADED_SOURCE_INIT_IMAGE = process.env.QS_UPLOADED_SOURCE_INIT_IMAGE || 'alpine:3.22';

class BuildGitInitContainerService {

    getInitContainer(ctx: BuildJobBuilderContext): V1Container {
        if (ctx.app.sourceType === 'QUICKDEPLOY_UPLOAD') {
            return this.getUploadedSourceInitContainer(ctx);
        }

        const script = [
            'set -eu',
            'rm -rf "$SOURCE_PATH"',
            'mkdir -p "$WORKSPACE_PATH"',
            'git clone --depth 1 --single-branch --branch "$GIT_BRANCH" "$GIT_URL" "$SOURCE_PATH"',
            'cd "$SOURCE_PATH"',
            'if ! git cat-file -e "$GIT_COMMIT^{commit}" 2>/dev/null; then',
            '  echo "Commit $GIT_COMMIT is not in the shallow clone. Fetching it directly."',
            '  git fetch --depth 1 origin "$GIT_COMMIT"',
            'fi',
            'git checkout --detach "$GIT_COMMIT"',
            'echo "Checked out git commit $(git rev-parse HEAD)"',
        ].filter(Boolean).join('\n');

        return {
            name: BUILD_GIT_INIT_CONTAINER_NAME,
            image: GIT_INIT_IMAGE,
            command: ['sh', '-c'],
            args: [script],
            env: [
                {
                    name: 'GIT_URL',
                    value: this.getAuthenticatedGitUrl(ctx),
                },
                {
                    name: 'GIT_BRANCH',
                    value: ctx.app.gitBranch ?? 'main',
                },
                {
                    name: 'GIT_COMMIT',
                    value: ctx.latestRemoteGitHash,
                },
                {
                    name: 'WORKSPACE_PATH',
                    value: BUILD_WORKSPACE_MOUNT_PATH,
                },
                {
                    name: 'SOURCE_PATH',
                    value: BUILD_SOURCE_PATH,
                },
                ...(ctx.gitSshPrivateKeySecretName ? [{
                    name: 'GIT_SSH_COMMAND',
                    value: `ssh -i ${BUILD_GIT_SSH_KEY_PATH} -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null`,
                }] : []),
            ],
            volumeMounts: [
                { name: BUILD_WORKSPACE_VOLUME_NAME, mountPath: BUILD_WORKSPACE_MOUNT_PATH },
                ...(ctx.gitSshPrivateKeySecretName ? [{
                    name: BUILD_GIT_SSH_KEY_VOLUME_NAME,
                    mountPath: BUILD_GIT_SSH_KEY_MOUNT_PATH,
                    readOnly: true,
                }] : []),
            ],
        };
    }

    private getUploadedSourceInitContainer(ctx: BuildJobBuilderContext): V1Container {
        const script = [
            'set -eu',
            'test -n "$QUICKDEPLOY_BUILD_ID"',
            'test -n "$QUICKDEPLOY_CONTENT_HASH"',
            'rm -rf "$SOURCE_PATH"',
            'mkdir -p "$SOURCE_PATH" "$WORKSPACE_PATH"',
            'wget --header="x-quickdeploy-content-hash: $QUICKDEPLOY_CONTENT_HASH" -O /tmp/quickdeploy-source.tar "$QUICKDEPLOY_ARCHIVE_URL"',
            'tar -xf /tmp/quickdeploy-source.tar -C "$SOURCE_PATH"',
            'if [ "$QUICKSTACK_GENERATED_STATIC_DOCKERFILE" = "true" ]; then',
            '  mkdir -p "$SOURCE_PATH/.quickstack"',
            '  cat > "$SOURCE_PATH/.quickstack/generated-static.Dockerfile" <<\'QUICKSTACK_STATIC_DOCKERFILE\'',
            'FROM nginx:1.27-alpine',
            'COPY . /usr/share/nginx/html',
            'RUN rm -rf /usr/share/nginx/html/.quickstack',
            'QUICKSTACK_STATIC_DOCKERFILE',
            'fi',
            'echo "Unpacked QuickDeploy archive $QUICKDEPLOY_BUILD_ID"',
        ].join('\n');

        return {
            name: BUILD_GIT_INIT_CONTAINER_NAME,
            image: UPLOADED_SOURCE_INIT_IMAGE,
            command: ['sh', '-c'],
            args: [script],
            env: [
                {
                    name: 'QUICKDEPLOY_BUILD_ID',
                    value: ctx.quickDeployBuildId,
                },
                {
                    name: 'QUICKDEPLOY_CONTENT_HASH',
                    value: ctx.quickDeployContentHash,
                },
                {
                    name: 'QUICKDEPLOY_ARCHIVE_URL',
                    value: `http://svc-quickstack.quickstack.svc.cluster.local:3000/api/v1/internal/quickdeploy-builds/${ctx.quickDeployBuildId}/archive`,
                },
                {
                    name: 'WORKSPACE_PATH',
                    value: BUILD_WORKSPACE_MOUNT_PATH,
                },
                {
                    name: 'SOURCE_PATH',
                    value: BUILD_SOURCE_PATH,
                },
                {
                    name: 'QUICKSTACK_GENERATED_STATIC_DOCKERFILE',
                    value: ctx.app.dockerfilePath === './.quickstack/generated-static.Dockerfile' ? 'true' : 'false',
                },
            ],
            volumeMounts: [
                { name: BUILD_WORKSPACE_VOLUME_NAME, mountPath: BUILD_WORKSPACE_MOUNT_PATH },
            ],
        };
    }

    private getAuthenticatedGitUrl(ctx: BuildJobBuilderContext) {
        if (ctx.app.sourceType !== 'GIT_SSH' && ctx.app.gitUsername && ctx.app.gitToken) {
            return ctx.app.gitUrl!.replace('https://', `https://${ctx.app.gitUsername}:${ctx.app.gitToken}@`);
        }
        return ctx.app.gitUrl!;
    }
}

const buildGitInitContainerService = new BuildGitInitContainerService();
export default buildGitInitContainerService;
