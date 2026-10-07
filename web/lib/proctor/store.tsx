"use client";

/* One store for the whole analysis surface.
 *
 * Two deliberate omissions, both for the same reason — a state update at 60fps
 * re-renders the subtree, and a re-render that changes an element's `animation`
 * string restarts every entrance animation on screen:
 *
 *   - `liveIdx` is NOT here. The Live screen owns its own rAF loop and local
 *     state, so a playing sweep re-renders one screen instead of the app.
 *   - The KPI count-up writes to refs, not through here. See MapDelta.
 *
 * `cursor` IS here, because the shared cursor has to survive a view change —
 * switching between Ribbon and Map & delta must not lose your place. Everything
 * derived from it is cheap; the expensive path strings are memoised on
 * (lapA, lapB) so a pointer move never rebuilds a 900-point polyline.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from "react";

import { data } from "@/lib/proctor/data-source";
import { buildLedger } from "@/lib/proctor/ledger";
import { deriveReadiness, type Readiness } from "@/lib/proctor/readiness";
import type { CornerLedger, SessionBundle, Trace } from "@/lib/proctor/types";
import { isUsable } from "@/lib/proctor/types";
import { SETUP_COOKIE, SETUP_DONE, SETUP_PARAM, type SetupStep } from "@/lib/setup";
import { DEFAULT_TIER, parseTier, TIER_COOKIE, type Tier } from "@/lib/tier";

export type Screen =
  | "sessions"
  | "report"
  | "analyze"
  | "live"
  | "rig"
  | "hardware"
  | "anatomy"
  | "upload";
export type AnalysisView = "loss" | "ribbon" | "map" | "line";

export interface ProctorState {
  /** Which session the whole surface is reading. "latest" is resolved
   *  server-side to the newest ingested session — the shell has to open on
   *  something before the driver has picked anything, and the session they
   *  just drove is the one they came to look at. */
  sessionId: string;
  screen: Screen;
  view: AnalysisView;
  lapA: number | null;
  lapB: number | null;
  /** 0..1 along the lap. */
  cursor: number;
  /** null falls back to the biggest loss rather than showing nothing. */
  selCorner: number | null;
  tier: Tier;
  speedMul: 1 | 2 | 4 | 8;
  splash: boolean;
  /** The guided setup's current step, or null when it is not running.
   *
   *  "detail" is a screen of its own, laid over the shell. "rig" is not: it
   *  happens ON the Rig screen, with a strip across the top that walks the
   *  driver through it, so there is one rig builder and not a second copy of
   *  it that only exists during setup. */
  setup: SetupStep | null;
  /** Which slot the lap rail assigns to on the next click.
   *
   *  Lap A used to be pinned to the reference lap with no way to move it, so
   *  two thirds of the comparisons a driver might want could not be asked for:
   *  lap 7 against lap 12 was unreachable when neither was the fastest. Both
   *  slots are selectable now, and this is which one is being set. */
  pick: "A" | "B";
  /** phone only */
  sheet: number | null;
}

type Action =
  | { t: "session"; id: string }
  | { t: "screen"; screen: Screen }
  | { t: "view"; view: AnalysisView }
  | { t: "lapA"; lap: number }
  | { t: "lapB"; lap: number }
  | { t: "cursor"; cursor: number }
  | { t: "corner"; id: number | null }
  | { t: "tier"; tier: Tier }
  | { t: "speedMul"; mul: 1 | 2 | 4 | 8 }
  | { t: "splash"; on: boolean }
  | { t: "setup"; step: SetupStep | null }
  | { t: "pick"; which: "A" | "B" }
  | { t: "sheet"; id: number | null }
  | { t: "initLaps"; a: number; b: number | null };

function reducer(s: ProctorState, a: Action): ProctorState {
  switch (a.t) {
    case "session":
      // A different session shares nothing with the one before it: lap 4 of
      // yesterday's race is not lap 4 of this one, and carrying the selection
      // across would put a stale lap number against a new set of traces.
      if (a.id === s.sessionId) return { ...s, screen: "analyze", setup: null };
      return {
        ...s,
        sessionId: a.id,
        screen: "analyze",
        setup: null,
        lapA: null,
        lapB: null,
        selCorner: null,
        sheet: null,
      };
    case "screen":
      /* Walking off to another screen in the middle of the rig step is an
         answer: not now. The setup ends there rather than following the driver
         round the app or dragging them back. */
      return {
        ...s,
        screen: a.screen,
        sheet: null,
        setup: s.setup === "rig" && a.screen !== "hardware" ? null : s.setup,
      };
    case "view":
      // Lap A, lap B, cursor and the selected corner all persist across a view
      // change. Switching how you look at the lap must not lose your place.
      return { ...s, view: a.view };
    /* Picking a lap that is already in the other slot SWAPS them rather than
       putting the same lap on both sides. A lap compared against itself is a
       flat delta trace and an empty ledger, which reads as a bug. */
    case "lapA":
      if (a.lap === s.lapB) return { ...s, lapA: a.lap, lapB: s.lapA, selCorner: null, sheet: null };
      return { ...s, lapA: a.lap, selCorner: null, sheet: null };
    case "lapB":
      // A new comparison lap invalidates the corner selection: the corner that
      // cost the most against the old lap is not the one that costs most now.
      if (a.lap === s.lapA) return { ...s, lapB: a.lap, lapA: s.lapB, selCorner: null, sheet: null };
      return { ...s, lapB: a.lap, selCorner: null, sheet: null };
    case "pick":
      return { ...s, pick: a.which };
    case "cursor":
      return { ...s, cursor: a.cursor };
    case "corner":
      return { ...s, selCorner: a.id };
    case "tier":
      return { ...s, tier: a.tier };
    case "speedMul":
      return { ...s, speedMul: a.mul };
    case "splash":
      return { ...s, splash: a.on };
    case "setup":
      // The rig step is the Rig screen, so entering it goes there. The launch
      // screen never plays over a setup: one full-screen thing at a time.
      if (a.step === "rig") return { ...s, setup: "rig", screen: "hardware", splash: false };
      return { ...s, setup: a.step, splash: a.step ? false : s.splash };
    case "sheet":
      return { ...s, sheet: a.id };
    case "initLaps":
      return { ...s, lapA: a.a, lapB: a.b };
    default:
      return s;
  }
}

const INITIAL: ProctorState = {
  sessionId: "latest",
  screen: "analyze",
  view: "loss",
  lapA: null,
  lapB: null,
  cursor: 0.34,
  selCorner: null,
  tier: DEFAULT_TIER,
  speedMul: 4,
  splash: true,
  setup: null,
  pick: "B",
  sheet: null,
};

interface Ctx {
  state: ProctorState;
  dispatch: (a: Action) => void;
  bundle: SessionBundle | null;
  /** Load error, surfaced as a finding rather than an empty screen. */
  error: string | null;
  /** The driver's own fastest clean lap. */
  referenceLap: number | null;
  cleanLaps: number[];
  traceA: Trace | null;
  traceB: Trace | null;
  ledger: CornerLedger | null;
  /** Whether a comparison view can draw, and if not, why not. */
  readiness: Readiness;
  /** The selected corner, falling back to the biggest single loss. */
  selectedCornerId: number | null;
  setTier: (t: Tier) => void;
}

const ProctorCtx = createContext<Ctx | null>(null);

export function ProctorProvider({
  sessionId = "latest",
  initialTier = DEFAULT_TIER,
  initialScreen = "analyze",
  initialView = "loss",
  skipSplash = false,
  initialSetup = null,
  children,
}: {
  sessionId?: string;
  initialTier?: Tier;
  /** From ?screen= — an analysis view is worth being able to link to. */
  initialScreen?: Screen;
  initialView?: AnalysisView;
  skipSplash?: boolean;
  /** The setup step this visit opens on, decided on the server from a cookie
   *  (lib/setup.ts). The phone app never passes one. */
  initialSetup?: SetupStep | null;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, {
    ...INITIAL,
    sessionId,
    tier: initialTier,
    screen: initialScreen,
    view: initialView,
    splash: !skipSplash && initialSetup == null,
    setup: initialSetup,
  });
  const [bundle, setBundle] = useState<SessionBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    /* Drop the previous session's bundle before the next one lands. Holding it
       would show one session's laps under another session's header for as long
       as the fetch takes — the loading state has to be empty, not stale. */
    setBundle(null);
    setError(null);
    data
      .loadSession(state.sessionId)
      .then((b) => {
        if (!live) return;
        setBundle(b);
      })
      .catch((e) => live && setError(String(e?.message ?? e)));
    return () => {
      live = false;
    };
  }, [state.sessionId]);

  const cleanLaps = useMemo(
    () => (bundle ? bundle.laps.filter(isUsable).map((l) => l.lap_number) : []),
    [bundle],
  );

  const referenceLap = useMemo(() => {
    if (!bundle || cleanLaps.length === 0) return null;
    return cleanLaps.reduce((best, n) => {
      const t = bundle.laps.find((l) => l.lap_number === n)?.lap_time_s ?? Infinity;
      const bt = bundle.laps.find((l) => l.lap_number === best)?.lap_time_s ?? Infinity;
      return t < bt ? n : best;
    }, cleanLaps[0]);
  }, [bundle, cleanLaps]);

  // Open on the reference lap against the slowest clean lap — the comparison
  // with something to say. The driver can pick any other lap from the rail.
  useEffect(() => {
    if (!bundle || referenceLap == null || state.lapA != null) return;
    const others = cleanLaps.filter((n) => n !== referenceLap);
    /* With one clean lap there is no second lap to open against. This used to
       fall back to `referenceLap` itself, putting the same lap in both slots —
       a lap compared against itself gives a flat delta trace and an empty
       ledger, which the reducer's own guard calls out as reading like a bug.
       Better to seat the reference and let the view say there is nothing to
       compare it with. */
    if (others.length === 0) {
      dispatch({ t: "initLaps", a: referenceLap, b: null });
      return;
    }
    const worst = others.reduce((w, n) => {
      const t = bundle.laps.find((l) => l.lap_number === n)?.lap_time_s ?? 0;
      const wt = bundle.laps.find((l) => l.lap_number === w)?.lap_time_s ?? 0;
      return t > wt ? n : w;
    }, others[0]);
    dispatch({ t: "initLaps", a: referenceLap, b: worst });
  }, [bundle, referenceLap, cleanLaps, state.lapA]);

  const traceA = bundle && state.lapA != null ? bundle.traces[state.lapA] ?? null : null;
  const traceB = bundle && state.lapB != null ? bundle.traces[state.lapB] ?? null : null;

  /* Memoised on the lap pair. A pointer move changes `cursor`, which re-renders
     consumers — but it must never land here and rebuild the ledger. */
  const ledger = useMemo(() => {
    if (!bundle || !traceA || !traceB) return null;
    return buildLedger(bundle.corners, traceA, traceB);
  }, [bundle, traceA, traceB]);

  /* One place decides whether a comparison view can draw, so every view gives
     the same answer and none of them can drift back into showing a spinner for
     a session that will never produce a ledger. The rule itself lives in
     lib/proctor/readiness.ts as a pure function, where it is unit-tested. */
  const readiness = useMemo<Readiness>(
    () =>
      deriveReadiness({
        error,
        lapCount: bundle ? bundle.laps.length : null,
        referenceLap,
        lapA: state.lapA,
        lapB: state.lapB,
        traceA,
        traceB,
      }),
    [error, bundle, referenceLap, state.lapA, state.lapB, traceA, traceB],
  );

  const selectedCornerId = useMemo(() => {
    if (state.selCorner != null) return state.selCorner;
    if (!ledger || ledger.corners.length === 0) return null;
    // Fall back to the biggest single loss rather than to nothing.
    return ledger.corners.reduce((w, c) => (c.delta > w.delta ? c : w)).corner.id;
  }, [state.selCorner, ledger]);

  const setTier = useCallback((t: Tier) => {
    dispatch({ t: "tier", tier: t });
    document.cookie = `${TIER_COOKIE}=${t}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  /* Once a setup that was running stops, remember that it has been through,
     however it ended: finished, skipped, or walked away from. A visit that
     never opened one (a shared link, say) writes nothing, so the setup is still
     there for that driver the first time they open the app plainly. */
  const inSetup = useRef(false);
  useEffect(() => {
    if (state.setup) {
      inSetup.current = true;
      return;
    }
    if (!inSetup.current) return;
    inSetup.current = false;
    document.cookie = `${SETUP_COOKIE}=${SETUP_DONE}; path=/; max-age=31536000; samesite=lax`;
    // ?setup=1 asked for this run. Left in the address it would ask again on
    // every reload, and travel with the link if it were copied.
    const url = new URL(window.location.href);
    if (url.searchParams.has(SETUP_PARAM)) {
      url.searchParams.delete(SETUP_PARAM);
      window.history.replaceState(null, "", url);
    }
  }, [state.setup]);

  // Pick up a tier written by a previous visit.
  useEffect(() => {
    const hit = document.cookie
      .split("; ")
      .find((c) => c.startsWith(`${TIER_COOKIE}=`));
    const t = parseTier(hit?.split("=")[1]);
    if (t !== state.tier) dispatch({ t: "tier", tier: t });
    // Intentionally once, on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<Ctx>(
    () => ({
      state,
      dispatch,
      bundle,
      error,
      referenceLap,
      cleanLaps,
      traceA,
      traceB,
      ledger,
      readiness,
      selectedCornerId,
      setTier,
    }),
    [
      state,
      bundle,
      error,
      referenceLap,
      cleanLaps,
      traceA,
      traceB,
      ledger,
      readiness,
      selectedCornerId,
      setTier,
    ],
  );

  return <ProctorCtx.Provider value={value}>{children}</ProctorCtx.Provider>;
}

export function useProctor(): Ctx {
  const ctx = useContext(ProctorCtx);
  if (!ctx) throw new Error("useProctor must be used inside <ProctorProvider>");
  return ctx;
}
