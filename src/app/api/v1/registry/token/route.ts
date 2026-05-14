import registryAuthService from "@/server/services/registry-auth.service";
import { ServiceException } from "@/shared/model/service.exception.model";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
    const url = new URL(request.url);
    try {
        const token = await registryAuthService.issueToken({
            authorization: request.headers.get('authorization'),
            service: url.searchParams.get('service'),
            scopes: url.searchParams.getAll('scope'),
        });
        return NextResponse.json(token);
    } catch (error) {
        if (error instanceof ServiceException) {
            return NextResponse.json({ status: 'error', message: error.message }, { status: 403 });
        }
        throw error;
    }
}
