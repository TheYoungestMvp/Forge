import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { LoginScreen } from "@/components/login-screen";
import { assertDemoAccess } from "@/lib/projects/demo-access";
import { loginDestination } from "@/lib/login-path";

export const metadata: Metadata = { title: "进入工作台 — Forge" };
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const destination = loginDestination((await searchParams).next);
  let authenticated = false;
  try {
    assertDemoAccess(
      new Request("http://localhost/login", { headers: await headers() }),
    );
    authenticated = true;
  } catch {
    /* The form remains available for access and configuration errors. */
  }
  if (authenticated) redirect(destination);
  return <LoginScreen destination={destination} />;
}
