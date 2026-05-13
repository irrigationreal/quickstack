import { AppBuildMethod, AppSourceInfoInputModel } from "@/shared/model/app-source-info.model";
import { SecretSummaryRow, SummaryRow } from "./source-wizard-fields";
import { buildMethodLabels, defaultDockerfilePath, SourceType, sourceTypeLabels } from "./types";

export function SourceSummaryStep({ formData, publicKey, showGitToken, setShowGitToken, showRegistryPassword, setShowRegistryPassword }: {
    formData: AppSourceInfoInputModel;
    publicKey?: string;
    showGitToken: boolean;
    setShowGitToken: (show: boolean) => void;
    showRegistryPassword: boolean;
    setShowRegistryPassword: (show: boolean) => void;
}) {
    const isGitSource = formData.sourceType === 'GIT' || formData.sourceType === 'GIT_SSH';
    return (
        <div className="space-y-4 rounded-md border p-4">
            <SummaryRow label="Source type" value={sourceTypeLabels[formData.sourceType as SourceType]} />
            {isGitSource && (
                <>
                    <SummaryRow label="Git URL" value={formData.gitUrl ?? ''} mono />
                    <SummaryRow label="Git branch" value={formData.gitBranch ?? ''} />
                    <SummaryRow label="Build method" value={buildMethodLabels[(formData.buildMethod as AppBuildMethod | undefined) ?? 'RAILPACK']} />
                    {formData.buildMethod === 'DOCKERFILE' && <SummaryRow label="Dockerfile path" value={formData.dockerfilePath ?? defaultDockerfilePath} mono />}
                </>
            )}
            {formData.sourceType === 'GIT' && (
                <>
                    <SummaryRow label="Git username" value={formData.gitUsername || 'Not configured'} />
                    <SecretSummaryRow label="Git password or token" value={formData.gitToken ?? ''} visible={showGitToken} onVisibleChange={setShowGitToken} />
                </>
            )}
            {formData.sourceType === 'GIT_SSH' && (
                <SummaryRow label="Deploy key" value={publicKey ? 'Generated' : 'Not generated'} />
            )}
            {formData.sourceType === 'CONTAINER' && (
                <>
                    <SummaryRow label="Image" value={formData.containerImageSource ?? ''} mono />
                    <SummaryRow label="Registry username" value={formData.containerRegistryUsername || 'Not configured'} />
                    <SecretSummaryRow label="Registry password" value={formData.containerRegistryPassword ?? ''} visible={showRegistryPassword} onVisibleChange={setShowRegistryPassword} />
                </>
            )}
        </div>
    );
}
