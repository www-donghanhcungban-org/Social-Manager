"use client";

import { createAuthClient } from "better-auth/react";

/** Client đăng nhập phía trình duyệt; gọi `/api/auth/*` cùng nguồn gốc. */
export const authClient = createAuthClient();
