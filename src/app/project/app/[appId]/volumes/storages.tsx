'use client';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { AppExtendedModel } from "@/shared/model/app-extended.model";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Download, EditIcon, Folder, TrashIcon, Share2, Unlink2, Unlink } from "lucide-react";
import DialogEditDialog from "./storage-edit-overlay";
import SharedStorageEditDialog from "./shared-storage-edit-overlay";
import { Toast } from "@/frontend/utils/toast.utils";
import { deleteVolume, downloadPvcData, getPvcUsage, openFileBrowserForVolume } from "./actions";
import { useConfirmDialog } from "@/frontend/states/zustand.states";
import { AppVolume } from "@prisma/client";
import React from "react";
import { KubeObjectNameUtils } from "@/server/utils/kube-object-name.utils";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip"
import { Code } from "@/components/custom/code";
import { Label } from "@/components/ui/label";
import { KubeSizeConverter } from "@/shared/utils/kubernetes-size-converter.utils";
import { Progress } from "@/components/ui/progress";
import { NodeInfoModel } from "@/shared/model/node-info.model";

type AppVolumeWithCapacity = (AppVolume & {
    usedBytes?: number;
    capacityBytes?: number;
    usedPercentage?: number;
});

export default function StorageList({ app, readonly, nodesInfo }: {
    app: AppExtendedModel;
    nodesInfo: NodeInfoModel[];
    readonly: boolean;
}) {

    const [volumesWithStorage, setVolumesWithStorage] = React.useState<AppVolumeWithCapacity[]>(app.appVolumes as AppVolumeWithCapacity[]);
    const [isLoading, setIsLoading] = React.useState(false);

    const loadAndMapStorageData = async () => {

        const response = (await getPvcUsage(app.id, app.projectId));

        if (response.status === 'success' && response.data) {
            const mappedVolumeData = [...app.appVolumes] as AppVolumeWithCapacity[];
            for (let item of mappedVolumeData) {
                const volume = response.data.find(x => x.pvcName === KubeObjectNameUtils.toPvcName(item.sharedVolumeId || item.id));
                if (volume) {
                    item.usedBytes = volume.usedBytes;
                    item.capacityBytes = KubeSizeConverter.fromMegabytesToBytes(item.size);
                    item.usedPercentage = Math.round(volume.usedBytes / item.capacityBytes * 100);
                }
            }
            setVolumesWithStorage(mappedVolumeData);
        } else {
            console.error(response);
        }
    }

    React.useEffect(() => {
        loadAndMapStorageData();
    }, [app.appVolumes, app]);

    const { openConfirmDialog: openDialog } = useConfirmDialog();

    const asyncDeleteVolume = async (volumeId: string, isBaseVolume: boolean) => {
        try {
            const confirm = await openDialog({
                title: isBaseVolume ? "Delete volume" : "Detach volume",
                description: isBaseVolume ? "This removes the volume and deletes its data. The change takes effect after you redeploy the app. Do you want to continue?" :
                    "This detaches the volume from the app, but keeps the data on the cluster so you can attach it again later. The change takes effect after you redeploy the app. Do you want to continue?",
                okButton: isBaseVolume ? "Delete volume" : "Detach volume"
            });
            if (confirm) {
                setIsLoading(true);
                await Toast.fromAction(() => deleteVolume(volumeId));
            }
        } finally {
            setIsLoading(false);
        }
    };

    const asyncDownloadPvcData = async (volumeId: string) => {
        try {
            const confirm = await openDialog({
                title: "Download volume data",
                description: "The volume data will be zipped and downloaded. Depending on the volume size, this may take a while. Do you want to continue?",
                okButton: "Download"
            });
            if (confirm) {
                setIsLoading(true);
                await Toast.fromAction(() => downloadPvcData(volumeId)).then(x => {
                    if (x.status === 'success' && x.data) {
                        window.open('/api/volume-data-download?fileName=' + x.data);
                    }
                });
            }
        } finally {
            setIsLoading(false);
        }
    }

    const openFileBrowserForVolumeAsync = async (volumeId: string) => {

        try {
            const confirm = await openDialog({
                title: "Open file browser",
                description: "To view the files in this volume, the app must be stopped first. The file browser will open in a new tab. Do you want to continue?",
                okButton: "Stop app and open file browser"
            });
            if (!confirm) {
                return;
            }
            setIsLoading(true);
            const fileBrowserStartResult = await Toast.fromAction(() => openFileBrowserForVolume(volumeId), undefined, 'Starting file browser...')
            if (fileBrowserStartResult.status !== 'success' || !fileBrowserStartResult.data) {
                return;
            }
            await openDialog({
                title: "File browser ready",
                description: <>
                    The file browser is ready and can be opened in a new tab. <br />
                    Use these credentials to log in:
                    <div className="pt-3 grid grid-cols-1 gap-1">
                        <Label>Username</Label>
                        <div> <Code>quickstack</Code></div>
                    </div>
                    <div className="pt-3 pb-4 grid grid-cols-1 gap-1">
                        <Label>Password</Label>
                        <div><Code>{fileBrowserStartResult.data.password}</Code></div>
                    </div>
                    <div>
                        <Button variant='outline' onClick={() => window.open(fileBrowserStartResult.data!.url, '_blank')}>Open file browser</Button>
                    </div>
                </>,
                okButton: '',
                cancelButton: "Close"
            });
        } finally {
            setIsLoading(false);
        }
    }

    return <>
        <Card>
            <CardHeader>
                <CardTitle>Volumes</CardTitle>
                <CardDescription>Add one or more volumes to configure persistent storage within your container.</CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableCaption>{app.appVolumes.length} Storage</TableCaption>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Mount Path</TableHead>
                            <TableHead>Storage Size</TableHead>
                            <TableHead>Storage Used</TableHead>
                            <TableHead>Storage Class</TableHead>
                            <TableHead>Access Mode</TableHead>
                            <TableHead>Shared</TableHead>
                            <TableHead className="w-[100px]">Action</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {volumesWithStorage.map(volume => (
                            <TableRow key={volume.containerMountPath}>
                                <TableCell className="font-medium">{volume.containerMountPath}</TableCell>
                                <TableCell className="font-medium">{volume.size} MB</TableCell>
                                <TableCell className="font-medium space-y-2">
                                    {volume.usedPercentage && <>
                                        <Progress value={volume.usedPercentage}
                                            color={volume.usedPercentage >= 90 ? 'red' : (volume.usedPercentage >= 80 ? 'orange' : undefined)} />
                                        <div className='text-xs text-slate-500'>
                                            {KubeSizeConverter.convertBytesToReadableSize(volume.usedBytes!)} used ({volume.usedPercentage}%)
                                        </div>
                                    </>}
                                </TableCell>
                                <TableCell className="font-medium capitalize">{volume.storageClassName?.replace('-', ' ')}</TableCell>
                                <TableCell className="font-medium">{volume.accessMode}</TableCell>
                                <TableCell className="font-medium">
                                    {volume.shareWithOtherApps && (
                                        <TooltipProvider>
                                            <Tooltip delayDuration={200}>
                                                <TooltipTrigger>
                                                    <span className="px-2 py-1 rounded-lg text-xs font-semibold bg-green-100 text-green-800 inline-flex items-center gap-1">
                                                        <Share2 className="h-3 w-3" />
                                                        Shareable
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>This volume can be mounted by other apps in this project</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    )}
                                    {volume.sharedVolumeId && (
                                        <TooltipProvider>
                                            <Tooltip delayDuration={200}>
                                                <TooltipTrigger>
                                                    <span className="px-2 py-1 rounded-lg text-xs font-semibold bg-blue-100 text-blue-800 inline-flex items-center gap-1">
                                                        <Share2 className="h-3 w-3" />
                                                        Shared
                                                    </span>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>This volume is mounted from another app's volume</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    )}
                                </TableCell>
                                <TableCell className="font-medium flex gap-2">
                                    {!volume.sharedVolumeId && <>
                                        <TooltipProvider>
                                            <Tooltip delayDuration={200}>
                                                <TooltipTrigger>
                                                    <Button variant="ghost" onClick={() => asyncDownloadPvcData(volume.id)} disabled={isLoading}>
                                                        <Download />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>Download volume content</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                        {!readonly && <TooltipProvider>
                                            <Tooltip delayDuration={200}>
                                                <TooltipTrigger>
                                                    <Button variant="ghost" onClick={() => openFileBrowserForVolumeAsync(volume.id)} disabled={isLoading}>
                                                        <Folder />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>View content of Volume</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>}
                                    </>}
                                    {/*<StorageRestoreDialog app={app} volume={volume}>
                                        <TooltipProvider>
                                            <Tooltip delayDuration={200}>
                                                <TooltipTrigger>
                                                    <Button variant="ghost" disabled={isLoading}>
                                                        <Upload />
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>Restore backup from zip</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </StorageRestoreDialog>*/}
                                    {!readonly && <>
                                        {volume.sharedVolumeId ? (
                                            <TooltipProvider>
                                                <Tooltip delayDuration={200}>
                                                    <TooltipTrigger>
                                                        <Button variant="ghost" disabled={true}><EditIcon /></Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent>
                                                        <p>Shared volumes cannot be edited (size and storage class are inherited)</p>
                                                    </TooltipContent>
                                                </Tooltip>
                                            </TooltipProvider>
                                        ) : (
                                            <DialogEditDialog app={app} volume={volume} nodesInfo={nodesInfo}>
                                                <TooltipProvider>
                                                    <Tooltip delayDuration={200}>
                                                        <TooltipTrigger>
                                                            <Button variant="ghost" disabled={isLoading}><EditIcon /></Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>
                                                            <p>Edit volume settings</p>
                                                        </TooltipContent>
                                                    </Tooltip>
                                                </TooltipProvider>
                                            </DialogEditDialog>
                                        )}
                                        <TooltipProvider>
                                            <Tooltip delayDuration={200}>
                                                <TooltipTrigger>
                                                    <Button variant="ghost" onClick={() => asyncDeleteVolume(volume.id, !volume.sharedVolumeId)} disabled={isLoading}>
                                                        {volume.sharedVolumeId ? <Unlink /> : <TrashIcon />}
                                                    </Button>
                                                </TooltipTrigger>
                                                <TooltipContent>
                                                    <p>{volume.sharedVolumeId ? 'Detach volume' : 'Delete volume'}</p>
                                                </TooltipContent>
                                            </Tooltip>
                                        </TooltipProvider>
                                    </>}
                                </TableCell>
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
            {!readonly && <CardFooter className="flex gap-2">
                <DialogEditDialog app={app} nodesInfo={nodesInfo}>
                    <Button>Add volume</Button>
                </DialogEditDialog>
                <SharedStorageEditDialog app={app}>
                    <Button variant="outline">Add shared volume</Button>
                </SharedStorageEditDialog>
            </CardFooter>}
        </Card >
    </>;
}