import path from "path";
import { readFile } from "fs/promises";
import { NextResponse } from "next/server";
import { QUICKDEPLOY_ASSET_CONTENT_TYPES } from "@/shared/model/quickdeploy-assets.model";

export const dynamic = "force-dynamic";

const SKILL_ROOT = path.join(process.cwd(), ".agents", "skills", "quickdeploy");

export async function GET(_request: Request, { params }: { params: Promise<{ path: string[] }> }) {
    const requestedPath = (await params).path.join("/");
    const contentType = QUICKDEPLOY_ASSET_CONTENT_TYPES.get(requestedPath);

    if (!contentType) {
        return NextResponse.json({ status: "error", message: "QuickDeploy skill asset was not found." }, { status: 404 });
    }

    const absolutePath = path.join(SKILL_ROOT, requestedPath);
    const relativePath = path.relative(SKILL_ROOT, absolutePath);
    if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        return NextResponse.json({ status: "error", message: "Invalid QuickDeploy skill asset path." }, { status: 400 });
    }

    try {
        const body = await readFile(absolutePath, "utf8");
        return new NextResponse(body, {
            headers: {
                "content-type": contentType,
                "cache-control": "no-store",
            },
        });
    } catch {
        return NextResponse.json({ status: "error", message: "QuickDeploy skill asset is not available on this server." }, { status: 404 });
    }
}
