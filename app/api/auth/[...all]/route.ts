import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/src/auth/server";

// Khởi tạo lười: `next build` không cần DATABASE_URL/BETTER_AUTH_SECRET, chỉ cần khi có request.
export const GET = (req: Request) => toNextJsHandler(getAuth()).GET(req);
export const POST = (req: Request) => toNextJsHandler(getAuth()).POST(req);
