'use client';

import { useEffect, useMemo, useState } from "react";
import { useForm } from "react-hook-form";
import { useFormState } from "react-dom";
import { toast } from "sonner";
import { zodResolver } from "@hookform/resolvers/zod";
import { ClipboardCopy, KeyRound } from "lucide-react";
import { SubmitButton } from "@/components/custom/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime } from "@/frontend/utils/format.utils";
import { FormUtils } from "@/frontend/utils/form.utilts";
import { Toast } from "@/frontend/utils/toast.utils";
import { ApiKeyCreateModel, ApiKeyCreateResultModel, ApiKeyListItemModel, apiKeyCreateZodModel } from "@/shared/model/api-key.model";
import { QUICKDEPLOY_ASSET_PATHS } from "@/shared/model/quickdeploy-assets.model";
import { ServerActionResult } from "@/shared/model/server-action-error-return.model";
import { createApiKey, revokeApiKey } from "./actions";

type AgentSettingsProps = {
    apiKeys: ApiKeyListItemModel[];
};

function buildAgentSetupScript(origin: string): string {
    const assetDownloads = QUICKDEPLOY_ASSET_PATHS
        .map((path) => `curl -fsSL ${origin}/agent/skills/quickdeploy/${path} -o ~/.claude/skills/quickdeploy/${path}`)
        .join('\n');

    return `# QuickStack agent setup for ${origin}\n# Paste the qstk_ API key from this page when prompted. It is saved outside projects.\n#\n# Agent instructions:\n# - If the user provides a qstk_ API key, save it with quickstack setup. Do not ask for it again unless saving fails.\n# - Store credentials only in ~/.quickstack/config.json or QUICKSTACK_URL/QUICKSTACK_API_KEY for CI.\n# - Never put API keys, registry passwords, env secrets, upload tokens, or kubeconfig in .quickdeploy, SKILL.md, or repo files.\n# - Use .quickdeploy only for secret-free deployment state like app id, project id, hostname, service root, mode, port, content hash, and image reference.\n# - For first deploys, run: quickstack launch "$PWD" --json\n# - For repeat deploys from a linked folder, run: quickstack deploy "$PWD" --json\n# - If the CLI returns structured questions, ask the user instead of guessing service topology, public hostname, raw endpoints, secrets, project, or app choices.\n\nset -euo pipefail\n\n# Install the QuickDeploy skill assets\nmkdir -p ~/.claude/skills/quickdeploy/scripts ~/.claude/skills/quickdeploy/bin ~/.claude/commands ~/.quickstack\nchmod 700 ~/.quickstack\n${assetDownloads}\nchmod +x ~/.claude/skills/quickdeploy/bin/quickstack.mjs ~/.claude/skills/quickdeploy/scripts/*.mjs\n\n# Install slash-command wrappers so /quickdeploy and /quickstack work in Claude Code.\n# The commands delegate to the installed skill and CLI; they do not contain secrets.\ncat > ~/.claude/commands/quickdeploy.md <<'QUICKDEPLOY_COMMAND'\n---\ndescription: Deploy the current folder to QuickStack with the installed QuickDeploy skill and CLI\nargument-hint: [launch|deploy options]\ndisable-model-invocation: true\n---\n\nUse the installed QuickDeploy skill for this request.\n\nUser request:\n\n$ARGUMENTS\n\nCall node ~/.claude/skills/quickdeploy/bin/quickstack.mjs launch \"$PWD\" --json for a first deploy, or node ~/.claude/skills/quickdeploy/bin/quickstack.mjs deploy \"$PWD\" --json when .quickdeploy already links this folder to an app. If the user provides a qstk_ API key or says to configure this QuickStack instance, save it with node ~/.claude/skills/quickdeploy/bin/quickstack.mjs setup --url ${origin} --api-key <key> before deploying. Never store secrets in .quickdeploy or project files. If the CLI returns structured questions, ask those exact questions instead of guessing.\nQUICKDEPLOY_COMMAND\n\ncat > ~/.claude/commands/quickstack.md <<'QUICKSTACK_COMMAND'\n---\ndescription: Run QuickStack agent workflows with the installed QuickDeploy CLI\nargument-hint: [setup|launch|deploy|status|logs|secrets options]\ndisable-model-invocation: true\n---\n\nUse the installed QuickDeploy skill and QuickStack CLI for this request.\n\nUser request:\n\n$ARGUMENTS\n\nPrefer node ~/.claude/skills/quickdeploy/bin/quickstack.mjs ... over direct API calls. If the request includes a qstk_ API key, immediately save it with node ~/.claude/skills/quickdeploy/bin/quickstack.mjs setup --url ${origin} --api-key <key> and do not ask for it again unless saving fails. Keep .quickdeploy secret-free; it is only deployment state. Relay CLI JSON questions/errors back to the user when deployment topology, secrets, domains, public endpoints, or project/app choices are ambiguous.\nQUICKSTACK_COMMAND\n\n# Save instance credentials for agents and the CLI. Do not put this in .quickdeploy or a repo.\nread -r -s -p \"QuickStack API key (qstk_...): \" QUICKSTACK_API_KEY\nprintf '\\n'\nnode ~/.claude/skills/quickdeploy/bin/quickstack.mjs setup --url ${origin} --api-key \"$QUICKSTACK_API_KEY\"\nunset QUICKSTACK_API_KEY\n\n# Optional shell shortcut. Add this line to ~/.zshrc if you want it permanently.\nalias quickstack=\"node ~/.claude/skills/quickdeploy/bin/quickstack.mjs\"\nquickstack --help`;
}

export default function AgentSettings({ apiKeys }: AgentSettingsProps) {
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

    const pluginConfig = useMemo(() => origin ? buildAgentSetupScript(origin) : '', [origin]);

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
                        Copy a pasteable setup block that installs the QuickStack CLI and QuickDeploy skill assets, tells the agent exactly where to save the qstk_ API key, saves the QuickStack URL/API key to ~/.quickstack/config.json with 0600 permissions, and adds a local quickstack CLI alias. Do not paste keys into SKILL.md, .quickdeploy, or project files.
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
                                    <TableCell>{apiKey.lastUsedAt ? formatDateTime(new Date(apiKey.lastUsedAt)) : 'Never'}</TableCell>
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
