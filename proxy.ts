import { NextResponse, type NextRequest } from "next/server";

import { isCrossSiteMutation } from "@/src/security/csrf";
import {
  cacheControlFor,
  newNonce,
  securityHeaders,
} from "@/src/security/headers";

/** Gắn CSP có nonce, header bảo mật và Cache-Control riêng tư cho mọi phản hồi (PRF-WEB-001/007). */
export function proxy(request: NextRequest) {
  if (isCrossSiteMutation(request.method, request.headers)) {
    return new NextResponse("Forbidden", {
      status: 403,
      headers: { "Cache-Control": "private, no-store" },
    });
  }
  const nonce = newNonce();
  const headers = securityHeaders({
    nonce,
    dev: process.env.NODE_ENV !== "production",
  });

  // Next đọc nonce từ CSP của *request* để gắn vào script nó sinh ra.
  const forwarded = new Headers(request.headers);
  forwarded.set("x-nonce", nonce);
  forwarded.set("Content-Security-Policy", headers["Content-Security-Policy"]);

  const response = NextResponse.next({ request: { headers: forwarded } });
  for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
  const cc = cacheControlFor(request.nextUrl.pathname);
  if (cc) response.headers.set("Cache-Control", cc);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|favicon.ico).*)",
      missing: [{ type: "header", key: "next-router-prefetch" }],
    },
  ],
};
