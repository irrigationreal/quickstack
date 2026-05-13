import { Command, CommandGroup, CommandItem, CommandList } from "@/components/ui/command";
import { AppBuildMethod } from "@/shared/model/app-source-info.model";
import { Check, FileCode2, Package, type LucideIcon } from "lucide-react";

export function BuildMethodStep({ value, onChange }: {
    value: AppBuildMethod;
    onChange: (buildMethod: AppBuildMethod) => void;
}) {
    const options: Array<{ value: AppBuildMethod; label: string; description: string; icon: LucideIcon }> = [
        { value: 'DOCKERFILE', label: 'Dockerfile', description: 'Build from the Dockerfile in the repository.', icon: FileCode2 },
        { value: 'RAILPACK', label: 'Railpack', description: 'Detect the app and build it automatically.', icon: Package },
    ];

    return (<div>
        <Command className="rounded-md border">
            <CommandList>
                <CommandGroup>
                    {options.map((option) => (
                        <CommandItem
                            key={option.value}
                            value={option.value}
                            className="cursor-pointer"
                            onSelect={() => onChange(option.value)}
                        >
                            <option.icon className="mr-2 h-4 w-4" />
                            <div className="min-w-0">
                                <p className="font-medium">{option.label}</p>
                                <p className="text-sm text-muted-foreground">{option.description}</p>
                            </div>
                            <Check className={value === option.value ? 'ml-auto h-4 w-4' : 'ml-auto h-4 w-4 opacity-0'} />
                        </CommandItem>
                    ))}
                </CommandGroup>
            </CommandList>
        </Command>
    </div>);
}
