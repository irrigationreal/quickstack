import { AppExtendedModel } from "@/shared/model/app-extended.model";

export type PersistedAppSourceType = 'GIT' | 'GIT_SSH' | 'CONTAINER' | 'QUICKDEPLOY_UPLOAD';

const sourceTypeLabels: Record<PersistedAppSourceType, string> = {
    GIT: 'Git over HTTPS',
    GIT_SSH: 'Git over SSH',
    CONTAINER: 'Container image',
    QUICKDEPLOY_UPLOAD: 'Uploaded source bundle',
};

export class AppSourceUtils {

    static isConfiguredSource(app: AppExtendedModel) {
        if (app.sourceType === 'GIT' || app.sourceType === 'GIT_SSH') {
            return !!app.gitUrl?.trim() && !!app.gitBranch?.trim();
        }
        if (app.sourceType === 'CONTAINER') {
            return !!app.containerImageSource?.trim();
        }
        if (app.sourceType === 'QUICKDEPLOY_UPLOAD') {
            return true;
        }
        return false;
    }

    static getSourceTypeLabel(sourceType: string) {
        return sourceTypeLabels[sourceType as PersistedAppSourceType] ?? 'App source';
    }

    static getSourceDescription(app: AppExtendedModel) {
        if (app.sourceType === 'GIT' || app.sourceType === 'GIT_SSH') {
            return app.gitUrl;
        }
        if (app.sourceType === 'QUICKDEPLOY_UPLOAD') {
            return 'Uploaded by QuickStack CLI';
        }
        return app.containerImageSource;
    }
}
