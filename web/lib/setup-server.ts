import { cookies } from "next/headers";

import { isSetupDone, SETUP_COOKIE } from "@/lib/setup";

/* Server-side read of whether the guided setup has been through. Separate from
   lib/setup.ts so the pure helpers stay importable from client components
   (next/headers is server-only), the same split as tier.ts and tier-server.ts. */
export async function readSetupDone(): Promise<boolean> {
  const store = await cookies();
  return isSetupDone(store.get(SETUP_COOKIE)?.value);
}
