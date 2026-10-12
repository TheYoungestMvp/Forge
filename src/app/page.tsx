import { AppBuilder } from "@/components/app-builder";
import { headers } from "next/headers";
import { assertDemoAccess } from "@/lib/projects/demo-access";

export const dynamic = "force-dynamic";

export default async function Home() {
  let authenticated = false;
  try {
    assertDemoAccess(
      new Request("http://localhost/", { headers: await headers() }),
    );
    authenticated = true;
  } catch {
    /* Visitors may explore the entry; private APIs remain protected. */
  }
  return (
    <AppBuilder
      key={authenticated ? "member" : "visitor"}
      authenticated={authenticated}
      accessRequired={Boolean(process.env.DEMO_ACCESS_PASSWORD)}
    />
  );
}
