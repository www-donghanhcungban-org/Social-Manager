import { redirect } from "next/navigation";

import { currentUser } from "@/src/server/runtime";

export default async function Home() {
  redirect((await currentUser()) ? "/app" : "/login");
}
