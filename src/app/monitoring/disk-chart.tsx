'use client';

import {
    Label,
    PolarRadiusAxis,
    RadialBar,
    RadialBarChart,
} from 'recharts';

import { ChartConfig, ChartContainer, ChartTooltip, ChartTooltipContent } from '@/components/ui/chart';
import { NodeResourceModel } from '@/shared/model/node-resource.model';
import { KubeSizeConverter } from '@/shared/utils/kubernetes-size-converter.utils';

export default function ChartDiskResources({
    nodeResource,
}: {
    nodeResource: NodeResourceModel;
}) {

    const diskUsed = nodeResource.diskUsageAbsolut ?? 0;
    const diskReserved = nodeResource.diskUsageReserved ?? 0;
    const diskCapacity = nodeResource.diskUsageCapacity ?? 0;
    const diskSchedulable = nodeResource.diskSpaceSchedulable ?? Math.max(0, diskCapacity - diskUsed - diskReserved);
    const diskUsagePercent = diskCapacity > 0 ? (diskUsed / diskCapacity) * 100 : 0;

    const chartData = [{
        diskUsed,
        diskReserved,
        diskSchedulable
    }];

    const chartConfig = {
        diskUsed: {
            label: "Used",
            color: "hsl(var(--chart-1))",
        },
        diskReserved: {
            label: "Reserved (free but not usable)",
            color: "hsl(var(--chart-2))",
        },
        diskSchedulable: {
            label: "Schedulable",
            color: "hsl(var(--muted))",
        },
    } satisfies ChartConfig

    return (
        <ChartContainer
            config={chartConfig}
            className="mx-auto aspect-square w-full max-w-[250px]"
        >
            <RadialBarChart
                data={chartData}
                innerRadius={80}
                outerRadius={110}
            >
                <ChartTooltip
                    cursor={false}
                    content={<ChartTooltipContent hideLabel formatter={(value, name) => {
                        const formattedValue = KubeSizeConverter.convertBytesToReadableSize(value as number);
                        return <div className='flex gap-2'>
                            <div className='self-center rounded w-2 h-2' style={{ backgroundColor: (chartConfig as any)[name].color }}></div>
                            <div className='flex-1'>{(chartConfig as any)[name].label}:</div>
                            <div>{formattedValue}</div>
                        </div>
                    }} />}
                />
                <PolarRadiusAxis tick={false} tickLine={false} axisLine={false}>
                    <Label
                        content={({ viewBox }) => {
                            if (
                                viewBox &&
                                'cx' in viewBox &&
                                'cy' in viewBox
                            ) {
                                return (
                                    <text
                                        x={viewBox.cx}
                                        y={viewBox.cy}
                                        textAnchor="middle"
                                        dominantBaseline="middle"
                                    >
                                        <tspan
                                            x={viewBox.cx}
                                            y={(viewBox.cy || 0) - 10}
                                            className="fill-foreground text-4xl font-bold"
                                        >
                                            {diskUsagePercent.toFixed(0)}%
                                        </tspan>
                                        <tspan
                                            x={viewBox.cx}
                                            y={(viewBox.cy || 0) + 14}
                                            className="fill-muted-foreground"
                                        >
                                            Storage
                                        </tspan>
                                        <tspan
                                            x={viewBox.cx}
                                            y={(viewBox.cy || 0) + 30}
                                            className="fill-muted-foreground">
                                            {KubeSizeConverter.convertBytesToReadableSize(diskUsed, 1, true)} / {KubeSizeConverter.convertBytesToReadableSize(diskCapacity, 1)}
                                        </tspan>
                                    </text>
                                );
                            }
                        }}
                    />
                </PolarRadiusAxis>
                <RadialBar
                    dataKey="diskUsed"
                    stackId="a"
                    cornerRadius={5}
                    fill="var(--color-diskUsed)"
                    className="stroke-transparent stroke-2"
                />
                <RadialBar
                    dataKey="diskReserved"
                    fill="var(--color-diskReserved)"
                    stackId="a"
                    cornerRadius={5}
                    className="stroke-transparent stroke-2"
                />
                <RadialBar
                    dataKey="diskSchedulable"
                    fill="var(--color-diskSchedulable)"
                    stackId="a"
                    cornerRadius={5}
                    className="stroke-transparent stroke-2"
                />
            </RadialBarChart>
        </ChartContainer>
    );
}
