import authMiddleware from "next-auth/middleware";
import { NextResponse, type NextRequest } from "next/server";
import rootPackage from "../package.json";

export default function middleware(request: NextRequest) {
   const pathname = request.nextUrl.pathname;
   if (pathname.startsWith("/api/v1/agent/") || pathname.startsWith("/api/cli/")) {
      const response = NextResponse.next();
      response.headers.set("X-QuickStack-Server-Version", rootPackage.version);
      return response;
   }

   return authMiddleware(request as any);
}

export const config = {
   matcher: [
      "/api/v1/agent/:path*",
      "/api/cli/:path*",
      "/((?!api|auth|agent/skills|_next/static|_next/image|favicon.ico).*)",
   ],
}