import { FileCode2, Loader2 } from "lucide-react";
import { IconInput } from "./source-wizard-fields";
import { defaultDockerfilePath } from "./types";

export function DockerfilePathStep({ value, isDetecting, onChange }: {
    value: string;
    isDetecting: boolean;
    onChange: (value: string) => void;
}) {
    return (
        <div className="space-y-4">
            {isDetecting && (
                <div className="flex min-h-20 items-center justify-center gap-2 rounded-md border text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Detecting the Dockerfile path...
                </div>
            )}
            <IconInput
                icon={FileCode2}
                label="Dockerfile path"
                placeholder={defaultDockerfilePath}
                value={value}
                onChange={(event) => onChange(event.target.value)}
            />
        </div>
    );
}
