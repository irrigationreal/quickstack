'use client';

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cleanupOldBuildJobs, cleanupOldTmpFiles, deleteAllFailedAndSuccededPods, deleteAllNetworkPolicies, deleteOldAppLogs, purgeRegistryImages, updateRegistry } from "./actions";
import { Button } from "@/components/ui/button";
import { Toast } from "@/frontend/utils/toast.utils";
import { useConfirmDialog } from "@/frontend/states/zustand.states";
import { LogsDialog } from "@/components/custom/logs-overlay";
import { Constants } from "@/shared/utils/constants";
import { RotateCcw, SquareTerminal, Trash, ShieldOff } from "lucide-react";

export default function QuickStackMaintenanceSettings({
    qsPodName
}: {
    qsPodName?: string;
}) {

    const useConfirm = useConfirmDialog();

    return <div className="space-y-4">
        <Card>
            <CardHeader>
                <CardTitle>Free up disk space</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-4 flex-wrap">

                <Button variant="secondary" onClick={async () => {
                    if (await useConfirm.openConfirmDialog({
                        title: 'Purge images',
                        description: 'Delete all build images from the internal QuickStack container registry to free up disk space.',
                        okButton: "Purge images",
                    })) {
                        Toast.fromAction(() => purgeRegistryImages());
                    }
                }}><Trash /> Purge images</Button>

                <Button variant="secondary" onClick={async () => {
                    if (await useConfirm.openConfirmDialog({
                        title: 'Clean up old build jobs',
                        description: 'Delete old build jobs to free up disk space.',
                        okButton: "Clean up"
                    })) {
                        Toast.fromAction(() => cleanupOldBuildJobs());
                    }
                }}><Trash /> Clean up old build jobs</Button>

                <Button variant="secondary" onClick={async () => {
                    if (await useConfirm.openConfirmDialog({
                        title: 'Clean up temporary files',
                        description: 'Delete temporary files to free up disk space.',
                        okButton: "Clean up"
                    })) {
                        Toast.fromAction(() => cleanupOldTmpFiles());
                    }
                }}><Trash /> Clean up temporary files</Button>

                <Button variant="secondary" onClick={async () => {
                    if (await useConfirm.openConfirmDialog({
                        title: 'Delete old app logs',
                        description: 'Delete old app logs to free up disk space.',
                        okButton: "Delete old app logs"
                    })) {
                        Toast.fromAction(() => deleteOldAppLogs());
                    }
                }}><Trash /> Delete old app logs</Button>

                <Button variant="secondary" onClick={async () => {
                    if (await useConfirm.openConfirmDialog({
                        title: 'Delete orphaned containers',
                        description: 'Delete unused pods, including failed and succeeded ones, to free up resources.',
                        okButton: "Delete orphaned containers"
                    })) {
                        Toast.fromAction(() => deleteAllFailedAndSuccededPods());
                    }
                }}><Trash /> Delete orphaned containers</Button>
            </CardContent>
        </Card>
        <Card>
            <CardHeader>
                <CardTitle>Monitoring and troubleshooting</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-4 flex-wrap">

                {qsPodName && <LogsDialog namespace={Constants.QS_NAMESPACE} podName={qsPodName}>
                    <Button variant="secondary" ><SquareTerminal /> Open QuickStack logs</Button>
                </LogsDialog>}

                <Button variant="secondary" onClick={async () => {
                    if (await useConfirm.openConfirmDialog({
                        title: 'Update registry',
                        description: 'Restart the internal QuickStack container registry.',
                        okButton: "Update registry"
                    })) {
                        Toast.fromAction(() => updateRegistry());
                    }
                }}><RotateCcw /> Force update registry</Button>

            </CardContent>
        </Card>
        <Card>
            <CardHeader>
                <CardTitle>Network policies</CardTitle>
            </CardHeader>
            <CardContent className="flex gap-4 flex-wrap">

                <Button variant="destructive" onClick={async () => {
                    if (await useConfirm.openConfirmDialog({
                        title: 'Delete all network policies',
                        description: 'Warning: this deletes all network policies across all namespaces. Your applications will lose every network security restriction. Only use this for troubleshooting or emergencies. Are you sure you want to continue?',
                        okButton: "Yes, delete all policies",
                    })) {
                        Toast.fromAction(() => deleteAllNetworkPolicies());
                    }
                }}><ShieldOff /> Delete all network policies</Button>

            </CardContent>
        </Card>
    </div>;
}