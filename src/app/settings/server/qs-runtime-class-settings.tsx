'use client';

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { useFormState } from "react-dom";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { Shield } from "lucide-react";
import { SubmitButton } from "@/components/custom/submit-button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormUtils } from "@/frontend/utils/form.utilts";
import { ServerActionResult } from "@/shared/model/server-action-error-return.model";
import { RuntimeClassSettingsModel, RuntimeClassSettingsViewModel, runtimeClassSettingsZodModel } from "@/shared/model/runtime-class-settings.model";
import { saveRuntimeClassSettings } from "./actions";

export default function QsRuntimeClassSettings({ settings }: { settings: RuntimeClassSettingsViewModel }) {
    const form = useForm<RuntimeClassSettingsModel>({
        resolver: zodResolver(runtimeClassSettingsZodModel),
        defaultValues: {
            defaultAppRuntimeClass: settings.defaultAppRuntimeClass ?? '',
        },
    });

    const [state, formAction] = useFormState(
        (state: ServerActionResult<any, any>, payload: RuntimeClassSettingsModel) => saveRuntimeClassSettings(state, payload),
        FormUtils.getInitialFormState<typeof runtimeClassSettingsZodModel>()
    );

    useEffect(() => {
        if (state.status === 'success') {
            toast.success('RuntimeClass settings saved.');
        }
        FormUtils.mapValidationErrorsToForm<typeof runtimeClassSettingsZodModel>(state, form);
    }, [state]);

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5" />Runtime isolation</CardTitle>
                <CardDescription>
                    Select a RuntimeClass for user apps only. Kata classes fail closed unless QuickStack can run a fresh per-node probe and read VM-backed runtime evidence before deployment.
                </CardDescription>
            </CardHeader>
            <Form {...form}>
                <form action={(e) => form.handleSubmit((data) => formAction(data))()}>
                    <CardContent className="space-y-6">
                        <FormField
                            control={form.control}
                            name="defaultAppRuntimeClass"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Default app RuntimeClass</FormLabel>
                                    <FormControl>
                                        <Input placeholder="e.g., kata" {...field} value={field.value ?? ''} />
                                    </FormControl>
                                    <p className="text-xs text-muted-foreground">
                                        Leave empty to use the node default runtime. Saving a Kata default runs the health probe now; every future deploy runs a fresh probe before creating Kubernetes objects. App-level overrides still win.
                                    </p>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />

                        <div className="space-y-2">
                            <div>
                                <p className="text-sm font-medium">Discovered RuntimeClasses</p>
                                <p className="text-xs text-muted-foreground">
                                    Kata health means a probe pod used the RuntimeClass on every eligible Ready node and returned runtime evidence. A missing or stale probe blocks new Kata deployments.
                                </p>
                            </div>
                            <Table>
                                <TableHeader>
                                    <TableRow>
                                        <TableHead>Name</TableHead>
                                        <TableHead>Handler</TableHead>
                                        <TableHead>Scheduling</TableHead>
                                        <TableHead>Overhead</TableHead>
                                        <TableHead>Health</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {settings.runtimeClasses.length === 0 && (
                                        <TableRow>
                                            <TableCell colSpan={5} className="text-muted-foreground">No RuntimeClasses found.</TableCell>
                                        </TableRow>
                                    )}
                                    {settings.runtimeClasses.map(runtimeClass => (
                                        <TableRow key={runtimeClass.name}>
                                            <TableCell>{runtimeClass.name}</TableCell>
                                            <TableCell>{runtimeClass.handler}</TableCell>
                                            <TableCell>{runtimeClass.hasScheduling ? 'Configured' : 'None'}</TableCell>
                                            <TableCell>{runtimeClass.hasOverhead ? 'Configured' : 'None'}</TableCell>
                                            <TableCell>
                                                {runtimeClass.isKata
                                                    ? runtimeClass.health
                                                        ? `${runtimeClass.health.healthy ? 'Healthy' : 'Failing'} (${runtimeClass.health.nodes?.length ?? 0} node${runtimeClass.health.nodes?.length === 1 ? '' : 's'})`
                                                        : 'Not probed'
                                                    : 'Object exists'}
                                            </TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        </div>
                    </CardContent>
                    <CardFooter className="gap-4">
                        <SubmitButton>Save RuntimeClass</SubmitButton>
                        <p className="text-red-500">{state?.message}</p>
                    </CardFooter>
                </form>
            </Form>
        </Card>
    );
}
