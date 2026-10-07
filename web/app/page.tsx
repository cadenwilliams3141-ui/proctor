import AppShell from "@/components/proctor/AppShell";
import { ProctorProvider, type AnalysisView, type Screen } from "@/lib/proctor/store";
import { openingStep, SETUP_PARAM } from "@/lib/setup";
import { readSetupDone } from "@/lib/setup-server";
import { readTier } from "@/lib/tier-server";

/* The desktop app. One shell, eight screens, four analysis views.
 *
 * The tier is read on the server from its cookie so the first paint is already
 * at the right detail level — no flash of the default tier before the client
 * catches up. Everything below it is client-side, because the shared cursor,
 * the ribbon and the live sweep all need pointer and rAF state that a server
 * component cannot hold.
 *
 * ?screen= and ?view= make a particular reading of a lap linkable — "look at
 * T6 on the ribbon" is a thing one driver says to another.
 *
 * A first plain visit opens on the guided setup instead: how much detail, then
 * the rig. Whether that has been through is a cookie, read here for the same
 * reason the tier is. ?setup=1 runs it again. See lib/setup.ts. */

export const dynamic = "force-dynamic";

const SCREENS: Screen[] = [
  "sessions",
  "report",
  "analyze",
  "live",
  "rig",
  "hardware",
  "anatomy",
  "upload",
];
const VIEWS: AnalysisView[] = ["loss", "ribbon", "map", "line"];

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const tier = await readTier();
  const q = await searchParams;
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

  const screen = SCREENS.includes(one(q.screen) as Screen)
    ? (one(q.screen) as Screen)
    : "analyze";
  const view = VIEWS.includes(one(q.view) as AnalysisView)
    ? (one(q.view) as AnalysisView)
    : "loss";

  // Arriving via a shared link means someone already told you what you are
  // about to look at; the launch screen or a setup would just be in the way.
  const linked = q.screen != null || q.view != null;
  const setup = openingStep({
    done: await readSetupDone(),
    linked,
    asked: one(q[SETUP_PARAM]) === "1",
  });

  return (
    <ProctorProvider
      initialTier={tier}
      initialScreen={screen}
      initialView={view}
      skipSplash={linked}
      initialSetup={setup}
    >
      <AppShell />
    </ProctorProvider>
  );
}
