'use client';

import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { deletePublicEndpoint } from "./actions";
import { AppExtendedModel } from "@/shared/model/app-extended.model";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import PublicEndpointEditDialog from "./public-endpoint-edit-dialog";
import { Button } from "@/components/ui/button";
import { EditIcon, Plus, TrashIcon } from "lucide-react";
import { Toast } from "@/frontend/utils/toast.utils";
import { useConfirmDialog } from "@/frontend/states/zustand.states";

export default function PublicEndpointsCard({ app, readonly }: {
    app: AppExtendedModel;
    readonly: boolean;
}) {
    const { openConfirmDialog: openDialog } = useConfirmDialog();
    const endpoints = app.appPublicEndpoints ?? [];

    const asyncDeletePublicEndpoint = async (publicEndpointId: string) => {
        const confirm = await openDialog({
            title: 'Delete Public Endpoint',
            description: 'The public endpoint reservation will be removed and the gateway will update immediately. Are you sure you want to remove it?',
            okButton: 'Delete Public Endpoint',
        });
        if (confirm) {
            await Toast.fromAction(() => deletePublicEndpoint(publicEndpointId));
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle>Public Endpoints</CardTitle>
                <CardDescription>
                    Reserve an explicit public IP and port for non-HTTP TCP workloads such as game servers, SFTP, or custom protocols. Use Domains for normal HTTP and HTTPS apps.
                </CardDescription>
            </CardHeader>
            <CardContent>
                <Table>
                    <TableCaption>{endpoints.length} Public Endpoint{endpoints.length !== 1 ? 's' : ''}</TableCaption>
                    <TableHeader>
                        <TableRow>
                            <TableHead>Name</TableHead>
                            <TableHead>Public Endpoint</TableHead>
                            <TableHead>Container Port</TableHead>
                            <TableHead>Status</TableHead>
                            {!readonly && <TableHead className="w-[100px]">Actions</TableHead>}
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {endpoints.map((endpoint) => (
                            <TableRow key={endpoint.id}>
                                <TableCell className="font-medium">{endpoint.name || '—'}</TableCell>
                                <TableCell className="font-medium">{endpoint.publicIp}:{endpoint.publicPort}/{endpoint.protocol}</TableCell>
                                <TableCell className="font-medium">{endpoint.targetPort}</TableCell>
                                <TableCell className="font-medium">{endpoint.enabled ? endpoint.status : 'DISABLED'}</TableCell>
                                {!readonly && (
                                    <TableCell className="font-medium flex gap-2">
                                        <PublicEndpointEditDialog appId={app.id} publicEndpoint={endpoint}>
                                            <Button variant="ghost"><EditIcon /></Button>
                                        </PublicEndpointEditDialog>
                                        <Button variant="ghost" onClick={() => asyncDeletePublicEndpoint(endpoint.id)}>
                                            <TrashIcon />
                                        </Button>
                                    </TableCell>
                                )}
                            </TableRow>
                        ))}
                    </TableBody>
                </Table>
            </CardContent>
            {!readonly && (
                <CardFooter>
                    <PublicEndpointEditDialog appId={app.id}>
                        <Button><Plus /> Add Public Endpoint</Button>
                    </PublicEndpointEditDialog>
                </CardFooter>
            )}
        </Card>
    );
}
