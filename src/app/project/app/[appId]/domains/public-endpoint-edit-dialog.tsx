'use client'

import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Textarea } from "@/components/ui/textarea"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { useFormState } from 'react-dom'
import { useEffect, useState } from "react";
import { FormUtils } from "@/frontend/utils/form.utilts";
import { SubmitButton } from "@/components/custom/submit-button";
import { ServerActionResult } from "@/shared/model/server-action-error-return.model"
import { savePublicEndpoint } from "./actions"
import { toast } from "sonner"
import { PublicEndpointEditModel, formatSourceCidrsText, publicEndpointEditZodModel } from "@/shared/model/public-endpoint.model"
import { AppExtendedModel } from "@/shared/model/app-extended.model"

type PublicEndpointForEdit = NonNullable<AppExtendedModel['appPublicEndpoints']>[number];

export default function PublicEndpointEditDialog({ children, publicEndpoint, appId }: { children: React.ReactNode; publicEndpoint?: PublicEndpointForEdit; appId: string; }) {
    const [isOpen, setIsOpen] = useState<boolean>(false);

    const form = useForm<PublicEndpointEditModel>({
        resolver: zodResolver(publicEndpointEditZodModel),
        defaultValues: publicEndpoint ? {
            name: publicEndpoint.name ?? '',
            publicIp: publicEndpoint.publicIp,
            publicPort: publicEndpoint.publicPort,
            targetPort: publicEndpoint.targetPort,
            protocol: publicEndpoint.protocol as 'TCP' | 'UDP',
            sourceCidrsText: formatSourceCidrsText(publicEndpoint.sourceCidrsJson),
            proxyProtocol: publicEndpoint.proxyProtocol,
            enabled: publicEndpoint.enabled,
        } : {
            protocol: 'TCP',
            proxyProtocol: false,
            enabled: true,
            sourceCidrsText: '',
        }
    });

    const [state, formAction] = useFormState(
        (state: ServerActionResult<any, any>, payload: PublicEndpointEditModel) =>
            savePublicEndpoint(state, { ...payload, appId, id: publicEndpoint?.id }),
        FormUtils.getInitialFormState<typeof publicEndpointEditZodModel>()
    );

    useEffect(() => {
        if (state.status === 'success') {
            form.reset();
            toast.success('Public endpoint saved successfully.', {
                description: 'The gateway and network policy were updated immediately.',
            });
            setIsOpen(false);
        }
        FormUtils.mapValidationErrorsToForm<typeof publicEndpointEditZodModel>(state, form);
    }, [state]);

    useEffect(() => {
        if (publicEndpoint) {
            form.reset({
                name: publicEndpoint.name ?? '',
                publicIp: publicEndpoint.publicIp,
                publicPort: publicEndpoint.publicPort,
                targetPort: publicEndpoint.targetPort,
                protocol: publicEndpoint.protocol as 'TCP' | 'UDP',
                sourceCidrsText: formatSourceCidrsText(publicEndpoint.sourceCidrsJson),
                proxyProtocol: publicEndpoint.proxyProtocol,
                enabled: publicEndpoint.enabled,
            });
        }
    }, [publicEndpoint]);

    return (
        <>
            <div onClick={() => setIsOpen(true)}>{children}</div>
            <Dialog open={!!isOpen} onOpenChange={() => setIsOpen(false)}>
                <DialogContent className="sm:max-w-[520px]">
                    <DialogHeader>
                        <DialogTitle>{publicEndpoint ? 'Edit' : 'Add'} Public Endpoint</DialogTitle>
                        <DialogDescription>
                            Reserve a public IP and port for non-HTTP TCP services. Domains should still use the Domains section.
                        </DialogDescription>
                    </DialogHeader>
                    <Form {...form}>
                        <form action={(e) => form.handleSubmit((data) => formAction(data))()}>
                            <div className="space-y-4">
                                <FormField control={form.control} name="name" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Name</FormLabel>
                                        <FormControl><Input placeholder="minecraft" {...field} value={field.value ?? ''} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <div className="grid grid-cols-2 gap-4">
                                    <FormField control={form.control} name="publicIp" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Public IP</FormLabel>
                                            <FormControl><Input placeholder="65.21.9.20" {...field} /></FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                    <FormField control={form.control} name="protocol" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Protocol</FormLabel>
                                            <Select onValueChange={field.onChange} value={field.value}>
                                                <FormControl><SelectTrigger><SelectValue placeholder="Select protocol" /></SelectTrigger></FormControl>
                                                <SelectContent>
                                                    <SelectItem value="TCP">TCP</SelectItem>
                                                    <SelectItem value="UDP" disabled>UDP (coming soon)</SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                </div>
                                <div className="grid grid-cols-2 gap-4">
                                    <FormField control={form.control} name="publicPort" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Public Port</FormLabel>
                                            <FormControl><Input type="number" placeholder="25565" {...field} /></FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                    <FormField control={form.control} name="targetPort" render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>Container Port</FormLabel>
                                            <FormControl><Input type="number" placeholder="25565" {...field} /></FormControl>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                </div>
                                <FormField control={form.control} name="sourceCidrsText" render={({ field }) => (
                                    <FormItem>
                                        <FormLabel>Allowed Source CIDRs</FormLabel>
                                        <FormControl><Textarea placeholder="Leave empty to allow all\n203.0.113.10/32" {...field} /></FormControl>
                                        <FormMessage />
                                    </FormItem>
                                )} />
                                <div className="grid grid-cols-2 gap-4">
                                    <FormField control={form.control} name="proxyProtocol" render={({ field }) => (
                                        <FormItem className="flex flex-row items-center gap-2 space-y-0">
                                            <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                            <FormLabel>Send PROXY protocol</FormLabel>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                    <FormField control={form.control} name="enabled" render={({ field }) => (
                                        <FormItem className="flex flex-row items-center gap-2 space-y-0">
                                            <FormControl><Checkbox checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                                            <FormLabel>Enabled</FormLabel>
                                            <FormMessage />
                                        </FormItem>
                                    )} />
                                </div>
                                <p className="text-red-500">{state.message}</p>
                                <SubmitButton>Save</SubmitButton>
                            </div>
                        </form>
                    </Form>
                </DialogContent>
            </Dialog>
        </>
    );
}
