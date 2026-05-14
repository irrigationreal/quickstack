import fs from "fs/promises";
import { createReadStream } from "fs";
import { NextResponse } from "next/server";
import cliDistributionService from "@/server/services/cli-distribution.service";
import rootPackage from "../../../../../../../package.json";

export const dynamic = "force-dynamic";

type RouteContext = {
    params: Promise<{
        version: string;
        platform: string;
    }>;
};

async function binaryResponse({ params }: RouteContext, includeBody: boolean) {
    const { version, platform } = await params;
    const binaryPath = cliDistributionService.resolveBinaryPath(version, platform);
    if (!binaryPath) {
        return NextResponse.json(
            { status: "error", message: "QuickStack CLI binary is not available for the requested version/platform." },
            { status: 404, headers: { "X-QuickStack-Server-Version": rootPackage.version } },
        );
    }

    const stat = await fs.stat(binaryPath);
    return new NextResponse(includeBody ? createReadStream(binaryPath) as any : null, {
        headers: {
            "content-type": "application/octet-stream",
            "content-disposition": `attachment; filename="quickstack-${version}-${platform}"`,
            "content-length": String(stat.size),
            "cache-control": "public, max-age=31536000, immutable",
            "X-QuickStack-Server-Version": rootPackage.version,
        },
    });
}

export async function GET(_request: Request, context: RouteContext) {
    return binaryResponse(context, true);
}

export async function HEAD(_request: Request, context: RouteContext) {
    return binaryResponse(context, false);
}
