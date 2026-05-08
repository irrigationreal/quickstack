'use client';

import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { useFormState } from "react-dom";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { ClipboardCopy, KeyRound } from "lucide-react";
import { SubmitButton } from "@/components/custom/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FormUtils } from "@/frontend/utils/form.utilts";
import { Toast } from "@/frontend/utils/toast.utils";
import { ApiKeyCreateModel, ApiKeyCreateResultModel, ApiKeyListItemModel, apiKeyCreateZodModel } from "@/shared/model/api-key.model";
import { ServerActionResult } from "@/shared/model/server-action-error-return.model";
import { createApiKey, revokeApiKey } from "./actions";

function formatDate(date?: Date | string | null) {
    return date ? new Date(date).toLocaleString() : 'Never';
}

export default function AgentSettings({ apiKeys }: { apiKeys: ApiKeyListItemModel[] }) {
    const [createdKey, setCreatedKey] = useState<ApiKeyCreateResultModel | null>(null);
    const [origin, setOrigin] = useState('');
    const form = useForm<ApiKeyCreateModel>({
        resolver: zodResolver(apiKeyCreateZodModel),
        defaultValues: {
            name: 'Claude Code agent',
            scopes: ['apps:read', 'apps:write', 'build:write', 'deploy:write'],
            appIds: [],
            projectIds: [],
        },
    });

    const [state, formAction] = useFormState(
        (state: ServerActionResult<any, ApiKeyCreateResultModel>, payload: ApiKeyCreateModel) => createApiKey(state, payload),
        FormUtils.getInitialFormState<typeof apiKeyCreateZodModel>()
    );

    useEffect(() => {
        setOrigin(window.location.origin);
    }, []);

    useEffect(() => {
        if (state.status === 'success' && state.data) {
            setCreatedKey(state.data);
            toast.success('API key created. Copy it now.');
        }
        FormUtils.mapValidationErrorsToForm<typeof apiKeyCreateZodModel>(state, form);
    }, [state]);

    const pluginConfig = origin ? `# QuickStack agent setup\nexport QUICKSTACK_URL=${origin}\nexport QUICKSTACK_API_KEY=<paste the one-time qstk_ key here>\n\n# Install the QuickDeploy skill assets\nmkdir -p ~/.claude/skills/quickdeploy/scripts ~/.claude/skills/quickdeploy/bin\ncurl -fsSL ${origin}/agent/skills/quickdeploy/SKILL.md -o ~/.claude/skills/quickdeploy/SKILL.md\ncurl -fsSL ${origin}/agent/skills/quickdeploy/scripts/detect.mjs -o ~/.claude/skills/quickdeploy/scripts/detect.mjs\ncurl -fsSL ${origin}/agent/skills/quickdeploy/scripts/package.mjs -o ~/.claude/skills/quickdeploy/scripts/package.mjs\ncurl -fsSL ${origin}/agent/skills/quickdeploy/scripts/quickstack-api.mjs -o ~/.claude/skills/quickdeploy/scripts/quickstack-api.mjs\ncurl -fsSL ${origin}/agent/skills/quickdeploy/bin/quickstack.mjs -o ~/.claude/skills/quickdeploy/bin/quickstack.mjs\nchmod +x ~/.claude/skills/quickdeploy/bin/quickstack.mjs ~/.claude/skills/quickdeploy/scripts/*.mjs\n\n# QuickStack CLI for this shell\nalias quickstack=\"node ~/.claude/skills/quickdeploy/bin/quickstack.mjs\"\nquickstack --help` : '';

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" />Configure your agent</CardTitle>
                <CardDescription>
                    Create a scoped API key for coding agents and use it with QuickStack agent commands. One-shot QuickDeploy keys include app configuration, managed builds, and deploy permission. Keys are shown once and can be revoked here.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                {createdKey && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-950 space-y-3">
                        <p className="font-medium">Copy this API key now. It will not be shown again.</p>
                        <Button
                            variant="secondary"
                            className="w-full justify-between truncate"
                            onClick={() => {
                                navigator.clipboard.writeText(createdKey.plaintextKey);
                                toast.success('API key copied.');
                            }}
                        >
                            <span className="truncate">{createdKey.plaintextKey}</span>
                            <ClipboardCopy className="h-4 w-4" />
                        </Button>
                    </div>
                )}

                <Form {...form}>
                    <form action={(e) => form.handleSubmit((data) => formAction(data))()} className="space-y-4">
                        <FormField
                            control={form.control}
                            name="name"
                            render={({ field }) => (
                                <FormItem>
                                    <FormLabel>Key name</FormLabel>
                                    <FormControl>
                                        <Input {...field} placeholder="Claude Code agent" />
                                    </FormControl>
                                    <FormMessage />
                                </FormItem>
                            )}
                        />
                        <SubmitButton>Create agent API key</SubmitButton>
                        <p className="text-red-500">{state?.message}</p>
                    </form>
                </Form>

                <div className="space-y-2">
                    <p className="text-sm font-medium">Claude Code setup</p>
                    <p className="text-sm text-muted-foreground">
                        Copy a pasteable setup block that installs the QuickStack CLI and QuickDeploy skill assets, configures the QuickStack URL/API key in your shell, and adds a local quickstack CLI alias. Do not paste keys into SKILL.md, .quickdeploy, or project files.
                    </p>
                    {pluginConfig && (
                        <Button
                            variant="secondary"
                            onClick={() => {
                                navigator.clipboard.writeText(pluginConfig);
                                toast.success('Agent setup copied.');
                            }}
                        >
                            Copy agent and CLI setup
                        </Button>
                    )}
                </div>

                <div className="space-y-2">
                    <p className="text-sm font-medium">Existing API keys</p>
                    <Table>
                        <TableHeader>
                            <TableRow>
                                <TableHead>Name</TableHead>
                                <TableHead>Prefix</TableHead>
                                <TableHead>Scopes</TableHead>
                                <TableHead>Last used</TableHead>
                                <TableHead>Status</TableHead>
                                <TableHead></TableHead>
                            </TableRow>
                        </TableHeader>
                        <TableBody>
                            {apiKeys.length === 0 && (
                                <TableRow>
                                    <TableCell colSpan={6} className="text-muted-foreground">No API keys yet.</TableCell>
                                </TableRow>
                            )}
                            {apiKeys.map(apiKey => (
                                <TableRow key={apiKey.id}>
                                    <TableCell>{apiKey.name}</TableCell>
                                    <TableCell>{apiKey.prefix}</TableCell>
                                    <TableCell>{apiKey.scopes.join(', ')}</TableCell>
                                    <TableCell>{formatDate(apiKey.lastUsedAt)}</TableCell>
                                    <TableCell>{apiKey.revokedAt ? 'Revoked' : 'Active'}</TableCell>
                                    <TableCell className="text-right">
                                        {!apiKey.revokedAt && (
                                            <Button variant="destructive" size="sm" onClick={() => Toast.fromAction(() => revokeApiKey(apiKey.id), 'API key revoked.')}>Revoke</Button>
                                        )}
                                    </TableCell>
                                </TableRow>
                            ))}
                        </TableBody>
                    </Table>
                </div>
            </CardContent>
        </Card>
    );
}
