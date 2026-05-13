'use server'

import { getAuthUserSession, isAuthorizedForBackups } from "@/server/utils/action-wrapper.utils";
import PageTitle from "@/components/custom/page-title";
import backupService from "@/server/services/standalone-services/backup.service";
import BackupsTable from "./backups-table";
import { CatchUtils } from "@/shared/utils/catch.utils";
import { AlertCircle, AlertTriangleIcon } from "lucide-react"
import {
    Alert,
    AlertDescription,
    AlertTitle,
} from "@/components/ui/alert"


export default async function BackupsPage() {

    await isAuthorizedForBackups();
    const backupData = await CatchUtils.resultOrUndefined(() => backupService.getBackupsForAllS3Targets());

    const backupInfoModels = backupData?.backupInfoModels ?? [];
    const backupsVolumesWithoutActualBackups = backupData?.backupsVolumesWithoutActualBackups ?? [];
    const failedS3Targets = backupData?.failedS3Targets ?? [];

    const hasMissedBackups = backupInfoModels.some(x => x.missedBackup === true);

    return (
        <div className="flex-1 space-y-4 pt-6">
            <PageTitle
                title={'Backups'}
                subtitle={`View all backups stored across your S3 target destinations. If a backup belongs to an app that no longer exists, it will be shown as orphaned.`}>
            </PageTitle>
            <div className="space-y-4">
                {!backupData && <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Backup data could not be loaded</AlertTitle>
                    <AlertDescription>
                        The configured backup storage could not be reached. Please verify your S3/B2 target settings and credentials.
                    </AlertDescription>
                </Alert>}
                {failedS3Targets.length > 0 && <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Some S3 targets could not be loaded</AlertTitle>
                    <AlertDescription>
                        Backups from the following locations could not be fetched: {failedS3Targets.map((target) => `${target.name} (${target.endpoint}/${target.bucketName})`).join(', ')}
                    </AlertDescription>
                </Alert>}
                {backupsVolumesWithoutActualBackups.length > 0 && <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Apps without backups</AlertTitle>
                    <AlertDescription>
                        The following apps have backups configured, but no backups have been created for them yet:<br />
                        {backupsVolumesWithoutActualBackups.map((item) => `${item.volume.app.name} (mount: ${item.volume.containerMountPath})`).join(', ')}
                    </AlertDescription>
                </Alert>}
                {hasMissedBackups && <Alert variant="destructive" className="border-orange-400 text-orange-400">
                    <AlertTriangleIcon className="h-4 w-4 text-orange-400" />
                    <AlertTitle>Missed backups</AlertTitle>
                    <AlertDescription>
                        Some backups may not have been created for their last scheduled interval. Check the Status column below for details.
                    </AlertDescription>
                </Alert>}
                {backupsVolumesWithoutActualBackups.length === 0 && backupInfoModels.length === 0 && <Alert>
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>No backups configured</AlertTitle>
                    <AlertDescription>
                        No backups are currently stored in the S3 targets. To configure backups for your apps, go to each app's settings and add a backup schedule in the "Storage" tab.
                    </AlertDescription>
                </Alert>}
                <BackupsTable data={backupInfoModels} />
            </div>
        </div>
    )
}
