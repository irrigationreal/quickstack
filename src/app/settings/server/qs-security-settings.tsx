'use client';

import { AuditEvent } from "@prisma/client";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useFormState } from "react-dom";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { Shield } from "lucide-react";
import { SubmitButton } from "@/components/custom/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormUtils } from "@/frontend/utils/form.utilts";
import { ServerActionResult } from "@/shared/model/server-action-error-return.model";
import { SecurityQuotaModel, securityQuotaZodModel } from "@/shared/model/security-quota.model";
import { saveSecurityQuota } from "./actions";

const quotaFields: Array<{ name: keyof SecurityQuotaModel; label: string; description: string }> = [
    { name: "maxAppsPerProject", label: "Max apps per project", description: "Blocks new apps after this project count." },
    { name: "maxReplicasPerApp", label: "Max replicas per app", description: "Blocks app resource updates above this replica count." },
    { name: "maxMemoryLimitMbPerReplica", label: "Max memory per replica (MB)", description: "Blocks per-replica memory limits above this value." },
    { name: "maxCpuLimitMillicoresPerReplica", label: "Max CPU per replica (m)", description: "Blocks per-replica CPU limits above this value." },
    { name: "maxTotalMemoryLimitMbPerProject", label: "Max project memory (MB)", description: "Blocks project-wide memory limit totals above this value." },
    { name: "maxTotalCpuLimitMillicoresPerProject", label: "Max project CPU (m)", description: "Blocks project-wide CPU limit totals above this value." },
    { name: "maxDeploysPerUserPerHour", label: "Max deploys per user/hour", description: "Blocks user-triggered deploys over this hourly count." },
    { name: "maxDeploysPerAppPerHour", label: "Max deploys per app/hour", description: "Blocks all deploy triggers over this hourly app count." },
    { name: "maxQuickDeployUploadBytes", label: "Max QuickDeploy upload (bytes)", description: "Rejects a single managed build upload above this size." },
    { name: "maxQuickDeployUploadBytesPerHour", label: "Max QuickDeploy bytes/hour", description: "Rejects managed build uploads after this hourly user byte total." },
    { name: "maxQuickDeployBuildsPerUserPerHour", label: "Max QuickDeploy builds user/hour", description: "Rejects managed builds over this hourly user count." },
    { name: "maxConcurrentQuickDeployBuilds", label: "Max concurrent QuickDeploy builds", description: "Rejects managed builds when this many are already pending or running." },
];

function formatDate(date: Date | string) {
    return new Date(date).toLocaleString();
}

export default function QsSecuritySettings({
    quota,
    auditEvents,
}: {
    quota: SecurityQuotaModel;
    auditEvents: AuditEvent[];
}) {
    const form = useForm<SecurityQuotaModel>({
        resolver: zodResolver(securityQuotaZodModel),
        defaultValues: quota,
    });

    const [state, formAction] = useFormState(
        (state: ServerActionResult<any, any>, payload: SecurityQuotaModel) => saveSecurityQuota(state, payload),
        FormUtils.getInitialFormState<typeof securityQuotaZodModel>()
    );

    useEffect(() => {
        if (state.status === 'success') {
            toast.success('Security quotas saved.');
        }
        FormUtils.mapValidationErrorsToForm<typeof securityQuotaZodModel>(state, form);
    }, [state]);

    return (
        <>
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" />Security quotas</CardTitle>
                    <CardDescription>
                        Empty fields are unlimited. Limits are enforced server-side before app creation, resource updates, and deploy work starts.
                    </CardDescription>
                </CardHeader>
                <Form {...form}>
                    <form action={(e) => form.handleSubmit((data) => formAction(data))()}>
                        <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {quotaFields.map(fieldInfo => (
                                <FormField
                                    key={fieldInfo.name}
                                    control={form.control}
                                    name={fieldInfo.name}
                                    render={({ field }) => (
                                        <FormItem>
                                            <FormLabel>{fieldInfo.label}</FormLabel>
                                            <FormControl>
                                                <Input type="number" min="1" {...field} value={field.value as string | number | undefined ?? ''} />
                                            </FormControl>
                                            <p className="text-xs text-muted-foreground">{fieldInfo.description}</p>
                                            <FormMessage />
                                        </FormItem>
                                    )}
                                />
                            ))}
                        </CardContent>
                        <CardFooter className="gap-4">
                            <SubmitButton>Save quotas</SubmitButton>
                            <p className="text-red-500">{state?.message}</p>
                        </CardFooter>
                    </form>
                </Form>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle>Audit events</CardTitle>
                    <CardDescription>Recent security-relevant events. Use filters to narrow deploys, user actions, and quota denials.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <form method="GET" action="/settings/server" className="grid grid-cols-1 md:grid-cols-4 gap-3">
                        <input type="hidden" name="tab" value="security" />
                        <Input name="actorEmail" placeholder="Actor email" />
                        <Input name="action" placeholder="Action" />
                        <Input name="outcome" placeholder="Outcome" />
                        <Input name="deploymentId" placeholder="Deployment ID" />
                        <Input name="projectId" placeholder="Project ID" />
                        <Input name="appId" placeholder="App ID" />
                        <Input name="from" type="datetime-local" />
                        <Input name="to" type="datetime-local" />
                        <div className="md:col-span-4 flex gap-2">
                            <Button type="submit">Filter</Button>
                            <Button type="button" variant="secondary" onClick={() => window.location.href = '/settings/server?tab=security'}>Clear</Button>
                        </div>
                    </form>

                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Time</TableHead>
                                <TableHead>Actor</TableHead>
                                <TableHead>Action</TableHead>
                                <TableHead>Outcome</TableHead>
                                <TableHead>Target</TableHead>
                                <TableHead>Message</TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {auditEvents.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-muted-foreground">No audit events found.</TableCell>
                                </TableRow>
                            )}
                            {auditEvents.map(event => (
                                <TableRow key={event.id}>
                                    <TableCell className="whitespace-nowrap">{formatDate(event.createdAt)}</TableCell>
                                    <TableCell>{event.actorEmail}</TableCell>
                                    <TableCell>{event.action}</TableCell>
                                    <TableCell>{event.outcome}</TableCell>
                                    <TableCell>{event.appName || event.projectName || event.targetId || event.targetType}</TableCell>
                                    <TableCell className="max-w-md truncate">{event.message}</TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </CardContent>
            </Card>
        </>
    );
}
