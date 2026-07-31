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
  useState,
  type ReactNode,
} from "react";

import { data } from "@/lib/proctor/data-source";
import { buildLedger } from "@/lib/proctor/ledger";
import type { CornerLedger, SessionBundle, Trace } from "@/lib/proctor/types";
import { isUsable } from "@/lib/proctor/types";
import { DEFAULT_TIER, parseTier, TIER_COOKIE, type Tier } from "@/lib/tier";

export type Screen =
  | "sessions"
  | "report"
  | "analyse"
  | "live"
  | "rig"
  | "upload";
export type AnalysisView = "loss" | "ribbon" | "map";

export interface ProctorState {
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
  /** phone only */
  sheet: number | null;
}

type Action =
  | { t: "screen"; screen: Screen }
  | { t: "view"; view: AnalysisView }
  | { t: "lapA"; lap: number }
  | { t: "lapB"; lap: number }
  | { t: "cursor"; cursor: number }
  | { t: "corner"; id: number | null }
  | { t: "tier"; tier: Tier }
  | { t: "speedMul"; mul: 1 | 2 | 4 | 8 }
  | { t: "splash"; on: boolean }
  | { t: "sheet"; id: number | null }
  | { t: "initLaps"; a: number; b: number };

function reducer(s: ProctorState, a: Action): ProctorState {
  switch (a.t) {
    case "screen":
      return { ...s, screen: a.screen, sheet: null };
    case "view":
      // Lap A, lap B, cursor and the selected corner all persist across a view
      // change. Switching how you look at the lap must not lose your place.
      return { ...s, view: a.view };
    case "lapA":
      return { ...s, lapA: a.lap, selCorner: null };
    case "lapB":
      // A new comparison lap invalidates the corner selection: the corner that
      // cost the most against the old lap is not the one that costs most now.
      return { ...s, lapB: a.lap, selCorner: null, sheet: null };
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
    case "sheet":
      return { ...s, sheet: a.id };
    case "initLaps":
      return { ...s, lapA: a.a, lapB: a.b };
    default:
      return s;
  }
}

const INITIAL: ProctorState = {
  screen: "analyse",
  view: "loss",
  lapA: null,
  lapB: null,
  cursor: 0.34,
  selCorner: null,
  tier: DEFAULT_TIER,
  speedMul: 4,
  splash: true,
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
  /** The selected corner, falling back to the biggest single loss. */
  selectedCornerId: number | null;
  setTier: (t: Tier) => void;
}

const ProctorCtx = createContext<Ctx | null>(null);

export function ProctorProvider({
  sessionId = "fixture",
  initialTier = DEFAULT_TIER,
  initialScreen = "analyse",
  initialView = "loss",
  skipSplash = false,
  children,
}: {
  sessionId?: string;
  initialTier?: Tier;
  /** From ?screen= — an analysis view is worth being able to link to. */
  initialScreen?: Screen;
  initialView?: AnalysisView;
  skipSplash?: boolean;
  children: ReactNode;
}) {
  const [state, dispatch] = useReducer(reducer, {
    ...INITIAL,
    tier: initialTier,
    screen: initialScreen,
    view: initialView,
    splash: !skipSplash,
  });
  const [bundle, setBundle] = useState<SessionBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    data
      .loadSession(sessionId)
      .then((b) => {
        if (!live) return;
        setBundle(b);
      })
      .catch((e) => live && setError(String(e?.message ?? e)));
    return () => {
      live = false;
    };
  }, [sessionId]);

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
    const worst = others.reduce((w, n) => {
      const t = bundle.laps.find((l) => l.lap_number === n)?.lap_time_s ?? 0;
      const wt = bundle.laps.find((l) => l.lap_number === w)?.lap_time_s ?? 0;
      return t > wt ? n : w;
    }, others[0] ?? referenceLap);
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
