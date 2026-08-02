/* Plain English, in one place.
 *
 * ┌ THE LINE THIS MODULE WALKS ─────────────────────────────────────────────┐
 * │ The product rule is "observations, not verdicts — describe, don't       │
 * │ prescribe". That rule is about CAUSE and TECHNIQUE, not about being     │
 * │ vague. Telemetry cannot see intent, so it can never honestly say "brake │
 * │ later" or "you turned in too early" — those are guesses about a         │
 * │ decision the file did not record.                                       │
 * │                                                                         │
 * │ What it CAN do, and what every sentence here does, is be specific:      │
 * │ name the thing, name its size, name where in the lap it happened, and   │
 * │ name what it is being measured against. A driver who reads "you lost    │
 * │ 0.31 s in Turn 4, nearly all of it between turn-in and the apex, and    │
 * │ you were 11 km/h slower at the slowest point" knows exactly where to    │
 * │ go and what to look at. That is as actionable as honest telemetry gets, │
 * │ and it is a great deal more useful than a number on its own.            │
 * │                                                                         │
 * │ So: `describe()` states what happened. `lookAt()` points at the moment  │
 * │ worth studying. Neither ever says what to do with the controls.         │
 * └─────────────────────────────────────────────────────────────────────────┘
 */

import { MATCHED_BAND_S } from "@/lib/proctor/channels";
import { SECTION_LABEL } from "@/lib/proctor/types";
import type {
  CornerDelta,
  CornerLedger,
  EventPattern,
  GripData,
  InputResponseData,
  Lap,
  StintData,
  Trace,
  TrackWidthData,
} from "@/lib/proctor/types";

/** A plain-English reading of one thing the session showed.
 *
 *  `headline` is the finding in one sentence. `detail` expands it. `lookAt` is
 *  a pointer to where in the lap the evidence is — never an instruction. */
export interface Explanation {
  headline: string;
  detail?: string;
  lookAt?: string;
}

const ms = (seconds: number) => `${Math.abs(seconds * 1000).toFixed(0)} ms`;
const secs = (seconds: number) => `${Math.abs(seconds).toFixed(3)} s`;
const kmh = (metresPerSecond: number) => `${Math.abs(metresPerSecond * 3.6).toFixed(0)} km/h`;

/** "T4" — corners are referred to the way a driver refers to them. */
const turn = (id: number) => `Turn ${id}`;

// ─────────────────────────────────────────────────────────────────────────────
// The lap comparison
// ─────────────────────────────────────────────────────────────────────────────

export function explainLap(
  ledger: CornerLedger,
  a: Trace,
  b: Trace,
): Explanation {
  const gap = ledger.lapDelta;
  const losses = ledger.corners.filter((c) => c.delta > MATCHED_BAND_S);
  const gains = ledger.corners.filter((c) => c.delta < -MATCHED_BAND_S);
  const worst = losses.length
    ? losses.reduce((w, c) => (c.delta > w.delta ? c : w))
    : null;

  if (Math.abs(gap) <= MATCHED_BAND_S) {
    return {
      headline: `Lap ${b.lap_number} matched lap ${a.lap_number} — inside ${ms(gap)} over the whole lap.`,
      detail:
        "Two laps this close are the same lap as far as the timing is concerned. The corner-by-corner breakdown below still shows where each one was quicker, which is where the two laps differed even though the totals did not.",
    };
  }

  const direction = gap > 0 ? "slower than" : "quicker than";
  const parts: string[] = [
    `Lap ${b.lap_number} was ${secs(gap)} ${direction} lap ${a.lap_number}.`,
  ];

  if (worst) {
    parts.push(
      `The single biggest difference was ${turn(worst.corner.id)}, worth ${ms(worst.delta)}, and most of that came ${SECTION_LABEL[worst.dominant]}.`,
    );
  }
  if (gains.length && gap > 0) {
    const back = gains.reduce((s, c) => s + c.delta, 0);
    parts.push(
      `You were quicker in ${gains.length} corner${gains.length === 1 ? "" : "s"} on this lap, worth ${ms(back)} back.`,
    );
  }

  const remainder = ledger.remainder;
  if (Math.abs(remainder) > 0.01) {
    parts.push(
      remainder > 0
        ? `${ms(remainder)} of the gap was not in any corner — it went to the parts of the lap between them.`
        : `The corners account for ${ms(remainder)} more than the lap gap, so that much came back on the parts of the lap that are not corners.`,
    );
  }

  return {
    headline: parts[0],
    detail: parts.slice(1).join(" "),
    lookAt: worst
      ? `${turn(worst.corner.id)}, ${SECTION_LABEL[worst.dominant]} — at ${(worst.corner.apex_pct * 100).toFixed(0)}% of the lap.`
      : undefined,
  };
}

/** One corner, in the words a driver would use about it. */
export function explainCorner(c: CornerDelta): Explanation {
  const where = SECTION_LABEL[c.dominant];
  const speedGap = c.minSpeedA - c.minSpeedB;

  if (Math.abs(c.delta) <= MATCHED_BAND_S) {
    return {
      headline: `${turn(c.corner.id)} matched your reference lap, inside ${ms(c.delta)}.`,
      detail: `You carried within ${kmh(speedGap)} of the same minimum speed through it.`,
    };
  }

  if (c.delta < 0) {
    return {
      headline: `${turn(c.corner.id)} was ${ms(c.delta)} quicker than your reference lap, mostly ${where}.`,
      detail:
        speedGap < -0.3
          ? `You carried ${kmh(speedGap)} more speed through the slowest point of it.`
          : "The gain came from the shape of the corner rather than from a higher minimum speed.",
    };
  }

  const detail =
    speedGap > 0.3
      ? `At the slowest point you were ${kmh(speedGap)} down on your reference lap.`
      : `Your minimum speed was within ${kmh(speedGap)} of the reference, so the time went somewhere other than the apex speed.`;

  return {
    headline: `${turn(c.corner.id)} cost ${ms(c.delta)} against your reference lap, and most of it went ${where}.`,
    detail,
    lookAt: `${turn(c.corner.id)} ${where}, at ${(c.corner.apex_pct * 100).toFixed(0)}% of the lap.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Grip
// ─────────────────────────────────────────────────────────────────────────────

export function explainGrip(g: GripData): Explanation[] {
  const out: Explanation[] = [];
  const s = g.session;

  out.push({
    headline: `At its highest, the car was producing ${s.peak_mu.toFixed(2)} g of grip for every 1 g of load pressing it into the road.`,
    detail:
      "That figure is measured, not modelled: horizontal force from the accelerometers over the vertical force at the same instant. It is the grip you used — the tires may have had more that you never asked for.",
  });

  const braking = g.states.find((st) => st.state === "braking");
  const cornering = g.states.find((st) => st.state === "cornering");
  const power = g.states.find((st) => st.state === "on power");
  const measured = [braking, cornering, power].filter(
    (st): st is NonNullable<typeof st> => st?.measured === true && st.peak_mu != null,
  );

  if (measured.length >= 2) {
    const best = measured.reduce((b, st) => ((st.peak_mu ?? 0) > (b.peak_mu ?? 0) ? st : b));
    const worst = measured.reduce((w, st) => ((st.peak_mu ?? 0) < (w.peak_mu ?? 0) ? st : w));
    out.push({
      headline: `You found the most grip while ${best.state} (${best.peak_mu?.toFixed(2)} g) and the least while ${worst.state} (${worst.peak_mu?.toFixed(2)} g).`,
      detail:
        "These states overlap on purpose — trail braking counts as both braking and cornering, which is exactly why they are measured separately.",
    });
  }

  if (g.downforce && Math.abs(g.downforce.peak_mu_change) > 0.05) {
    const rising = g.downforce.peak_mu_change > 0;
    out.push({
      headline: rising
        ? `The car had ${g.downforce.peak_mu_change.toFixed(2)} g more grip at ${g.downforce.fastest_band} than it did at ${g.downforce.slowest_band}.`
        : `The car did not find more grip at speed this session — the fastest band came out ${Math.abs(g.downforce.peak_mu_change).toFixed(2)} g below the slowest.`,
      detail: rising
        ? "Grip that grows with speed is what aerodynamic downforce looks like in these channels. It also means the slow corners are where the car has the least to give."
        : "Read carefully: this can mean the fast sections were driven with margin rather than that the downforce was absent.",
    });
  }

  const corners = g.corners.filter((c) => c.measured && c.peak_mu != null);
  if (corners.length >= 2) {
    const best = corners.reduce((b, c) => ((c.peak_mu ?? 0) > (b.peak_mu ?? 0) ? c : b));
    const worst = corners.reduce((w, c) => ((c.peak_mu ?? 0) < (w.peak_mu ?? 0) ? c : w));
    out.push({
      headline: `Across the lap, ${turn(best.id)} is where you reached the most grip (${best.peak_mu?.toFixed(2)} g) and ${turn(worst.id)} the least (${worst.peak_mu?.toFixed(2)} g).`,
      detail:
        "A corner low on this list is one where the car was carrying less force than it managed elsewhere — the file cannot say whether that was the corner, the tires or the lap.",
      lookAt: `${turn(worst.id)}${worst.apex_pct != null ? `, at ${(worst.apex_pct * 100).toFixed(0)}% of the lap` : ""}.`,
    });
  }

  if (g.stint.measured && g.stint.change != null && Math.abs(g.stint.change) >= 0.02) {
    const falling = g.stint.change < 0;
    out.push({
      headline: falling
        ? `The grip you were reaching fell ${Math.abs(g.stint.change).toFixed(2)} g between the first third of the run and the last.`
        : `The grip you were reaching rose ${g.stint.change.toFixed(2)} g between the first third of the run and the last.`,
      detail:
        g.stint.wear_masked === true
          ? "Tire wear is frozen in this session, so whatever moved, wear was not the cause of it."
          : "Tires, fuel load, track surface and simply settling into a pace all move this number, and one session cannot tell them apart.",
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Inputs against the car's response
// ─────────────────────────────────────────────────────────────────────────────

export function explainInputResponse(ir: InputResponseData): Explanation[] {
  const out: Explanation[] = [];

  if (ir.brake.measured) {
    const b = ir.brake;
    const abs = b.abs;
    if (abs && abs.engaged_pct_of_braking > 0) {
      const cut = abs.mean_cut_while_engaged_pct;
      out.push({
        headline: `On ${abs.engaged_pct_of_braking.toFixed(1)}% of your braking, the ABS was between your foot and the brakes.`,
        detail:
          cut != null
            ? `While it was working it took back ${cut.toFixed(1)}% of the pressure you were asking for. That gap is not the pedal failing — it is the car deciding the tires could not hold what you requested.`
            : "The file records that it engaged, but not how much pressure it removed.",
      });
    } else if (abs) {
      out.push({
        headline: "Every bit of brake pressure you asked for reached the brakes — the ABS never engaged.",
        detail:
          "Either the car has no ABS, or you never asked the front tires for more than they could hold.",
      });
    }

    if (b.decel_per_pedal_g != null) {
      out.push({
        headline: `A fully loaded brake pedal bought you about ${b.decel_per_pedal_g.toFixed(2)} g of deceleration this session.`,
        detail: `Your hardest application reached ${b.pedal_ceiling_pct.toFixed(0)}% of pedal travel${
          b.peak_deceleration_g != null ? ` and ${b.peak_deceleration_g.toFixed(2)} g of retardation` : ""
        }. Both are your own maximums this session, not a limit of the car or the rig.`,
      });
    }
  }

  if (ir.throttle.measured && ir.throttle.slip) {
    const slip = ir.throttle.slip;
    if (slip.share_of_on_power_pct > 0) {
      out.push({
        headline: `For ${slip.share_of_on_power_pct.toFixed(1)}% of the time you were on power, a wheel was turning faster than the car was travelling.`,
        detail: `At its worst that wheel was ${slip.peak_excess_pct.toFixed(0)}% ahead of the ground. A wheel that is spinning is a wheel converting engine torque into heat instead of forward motion.`,
      });
    } else {
      out.push({
        headline: "Every time you asked for power, the wheels put it down — no wheel ran meaningfully ahead of the ground.",
      });
    }
  }

  if (ir.steering.measured) {
    const st = ir.steering;
    const bands = st.bands.filter((b) => b.measured && b.peak_lateral_g != null);
    if (st.most_lateral_g_band && bands.length >= 2) {
      out.push({
        headline: `The most lateral grip you got back came at ${st.most_lateral_g_band} of steering.`,
        detail:
          st.falloff_past_peak_g != null && st.falloff_past_peak_g > 0
            ? `Past that, more lock did not buy more grip — the highest bands gave back ${st.falloff_past_peak_g.toFixed(2)} g less. That shape is what running out of front tire looks like in these channels, measured on your own data this session rather than assumed from a model.`
            : "Lateral force kept rising with lock across every band you used, so nothing in this session shows the front tires giving up.",
      });
    }
  }

  if (ir.wheel.measured && ir.wheel.clipping_pct_of_moving > 0) {
    out.push({
      headline: `Your wheel was pinned against its own force limit for ${ir.wheel.clipping_pct_of_moving.toFixed(2)}% of the time you were moving.`,
      detail:
        "While the wheel is saturated the force it hands back stops changing, so any detail about what the front tires were doing in that moment never reached your hands. This is a rig setting, not a driving finding.",
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The stint
// ─────────────────────────────────────────────────────────────────────────────

export function explainStint(s: StintData): Explanation[] {
  if (!s.trends.measured) {
    return [
      {
        headline: "This run was too short to say how it changed.",
        detail: s.trends.reason ?? "",
      },
    ];
  }

  const series = s.trends.series ?? {};
  const out: Explanation[] = [];

  const brake = series.decel_per_pedal_g;
  if (brake?.measured && brake.change != null) {
    if (brake.change < -0.02) {
      out.push({
        headline: `By the end of the run, the same brake pedal was buying ${Math.abs(brake.change).toFixed(2)} g less deceleration than at the start.`,
        detail: `It went from ${brake.first_third?.toFixed(2)} g per unit of pedal in the first third of your clean laps to ${brake.last_third?.toFixed(2)} g in the last. Brake temperature, tire surface, a lighter fuel load and simply braking differently once the lap is learned all move this figure, and one session cannot separate them.`,
      });
    } else if (brake.change > 0.02) {
      out.push({
        headline: `By the end of the run, the same brake pedal was buying ${brake.change.toFixed(2)} g MORE deceleration than at the start.`,
        detail: "Brakes and tires coming up to temperature look like this.",
      });
    } else {
      out.push({
        headline: "Your brakes gave back the same deceleration for the same pedal from the first lap to the last.",
      });
    }
  }

  const temp = series.lf_temp_middle_c;
  const spread = series.lf_temp_spread_c;
  if (temp?.measured && temp.change != null) {
    const detail =
      spread?.measured && spread.change != null && Math.abs(spread.change) >= 1
        ? `The spread across the tire's three edges moved ${spread.change > 0 ? "up" : "down"} ${Math.abs(spread.change).toFixed(1)} °C over the same laps, which is the edge-to-edge story rather than the overall one.`
        : "The spread across the tire's three edges held steady, so the whole surface moved together.";
    out.push({
      headline:
        Math.abs(temp.change) >= 1
          ? `The left-front tire's middle surface ran ${Math.abs(temp.change).toFixed(1)} °C ${temp.change > 0 ? "hotter" : "cooler"} by the end of the run — ${temp.first_third?.toFixed(0)} °C up to ${temp.last_third?.toFixed(0)} °C.`
          : "The left-front tire's surface temperature held level across the whole run.",
      detail: `${detail} Left-front is the only tire the .ibt carries temperatures for, so nothing is claimed about the other three.`,
    });
  }

  const lat = series.peak_lateral_g;
  if (lat?.measured && lat.change != null && Math.abs(lat.change) >= 0.03) {
    out.push({
      headline: `You were reaching ${Math.abs(lat.change).toFixed(2)} g ${lat.change < 0 ? "less" : "more"} lateral load by the end of the run than at the start.`,
      detail:
        "This is what you asked the car for, not what it could give. A driver managing tires and a driver whose tires are gone produce the same line here.",
    });
  }

  const pace = series.lap_time_s;
  if (pace?.measured && pace.change != null) {
    out.push({
      headline:
        Math.abs(pace.change) < 0.05
          ? `Your pace held flat across ${s.trends.clean_laps} clean laps.`
          : `Your last few clean laps averaged ${Math.abs(pace.change).toFixed(3)} s ${pace.change < 0 ? "quicker" : "slower"} than your first few.`,
      detail:
        pace.change != null && pace.change < -0.05
          ? "Improving over a run is usually the driver learning the lap, and it makes any tire or brake trend above harder to read — you were changing too."
          : undefined,
    });
  }

  if (s.fuel.measured && s.fuel.mean_per_lap_l != null) {
    out.push({
      headline: `You burned about ${s.fuel.mean_per_lap_l.toFixed(2)} L a lap, ${s.fuel.total_used_l?.toFixed(1)} L across the session.`,
      detail:
        "Fuel level is a measured channel, so this is a reading rather than an estimate. A car shedding fuel gets lighter and quicker, which is one more thing moving every trend above.",
    });
  }

  if (s.wear) {
    out.push({
      headline: "Tire wear is frozen in this session, so nothing above was caused by wear.",
      detail: s.wear.reason,
    });
  }

  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Slip events
// ─────────────────────────────────────────────────────────────────────────────

export function explainPattern(
  p: EventPattern,
  kind: "lockup" | "wheelspin",
  total: number,
): Explanation {
  const noun = kind === "lockup" ? "lockup" : "moment of wheelspin";
  const plural = kind === "lockup" ? "lockups" : "wheelspin";

  if (total === 0) {
    return {
      headline: `No ${plural} anywhere in this session.`,
      detail:
        kind === "lockup"
          ? "No wheel dropped below half the car's ground speed while you were on the brake."
          : "No wheel ran more than 10% ahead of the car's ground speed while you were on the throttle.",
    };
  }
  if (!p.measured) {
    return {
      headline: `${total} ${total === 1 ? noun : plural} this session.`,
      detail: p.reason ?? "",
    };
  }

  const bits: string[] = [];
  if (p.median_speed_kmh != null) bits.push(`typically at ${p.median_speed_kmh.toFixed(0)} km/h`);
  if (p.most_common_gear != null) {
    bits.push(
      `most often in ${ordinal(p.most_common_gear)} gear${
        p.most_common_gear_share_pct != null ? ` (${p.most_common_gear_share_pct.toFixed(0)}% of them)` : ""
      }`,
    );
  }
  if (p.while_turning_pct != null) {
    bits.push(
      p.while_turning_pct >= 60
        ? `and ${p.while_turning_pct.toFixed(0)}% of them while the car was already turning`
        : `and ${(100 - p.while_turning_pct).toFixed(0)}% of them in a straight line`,
    );
  }

  const detailParts: string[] = [];
  if (p.most_affected_wheel && p.most_affected_wheel_events != null) {
    detailParts.push(
      `The ${wheelName(p.most_affected_wheel)} was involved most often — ${p.most_affected_wheel_events} of the ${total}.`,
    );
  }
  if (kind === "lockup" && p.median_pedal_change_pct_per_100ms != null) {
    const rate = p.median_pedal_change_pct_per_100ms;
    detailParts.push(
      rate > 5
        ? `In the fifth of a second before they let go, the brake pedal was moving ${rate.toFixed(0)}% of its travel per 100 ms — the wheel gave up while the pressure was still building.`
        : `In the fifth of a second before they let go, the brake pedal was moving ${Math.abs(rate).toFixed(0)}% of its travel per 100 ms, so the pressure was already settled when the wheel gave up.`,
    );
  }
  if (kind === "wheelspin" && p.median_pedal_change_pct_per_100ms != null) {
    const rate = p.median_pedal_change_pct_per_100ms;
    detailParts.push(
      rate > 5
        ? `The throttle was opening at ${rate.toFixed(0)}% of its travel per 100 ms as they happened.`
        : `The throttle was already steady when they happened, opening at ${Math.abs(rate).toFixed(0)}% per 100 ms.`,
    );
  }
  if (p.with_abs_active_pct != null) {
    detailParts.push(
      p.with_abs_active_pct >= 50
        ? `The ABS was already active on ${p.with_abs_active_pct.toFixed(0)}% of them.`
        : `The ABS was active on only ${p.with_abs_active_pct.toFixed(0)}% of them.`,
    );
  }
  if (p.median_combined_g != null) {
    detailParts.push(
      `The car was carrying ${p.median_combined_g.toFixed(2)} g of combined load at the moment they began.`,
    );
  }

  return {
    headline: `${total} ${total === 1 ? noun : plural} this session${bits.length ? `, ${bits.join(", ")}` : ""}.`,
    detail: `${detailParts.join(" ")} These are the conditions the events shared — the file records what was happening, not why.`,
  };
}

function ordinal(n: number): string {
  if (n <= 0) return n === 0 ? "neutral" : "reverse";
  const suffix = ["th", "st", "nd", "rd"][n % 100 > 10 && n % 100 < 14 ? 0 : Math.min(n % 10, 4)] ?? "th";
  return `${n}${suffix}`;
}

const WHEEL_NAMES: Record<string, string> = {
  lf: "left front",
  rf: "right front",
  lr: "left rear",
  rr: "right rear",
};

export function wheelName(code: string): string {
  return WHEEL_NAMES[code] ?? code;
}

/** The one-line reading of a single slip event, from its input context. */
export function explainEvent(kind: "lockup" | "wheelspin", inputs?: {
  speed_kmh: number | null;
  gear: number | null;
  brake_pedal_pct: number | null;
  throttle_pct: number | null;
  turning?: boolean;
  turn_direction?: "left" | "right";
  combined_g?: number;
  abs_active?: boolean;
}): string {
  if (!inputs) return "No input context stored for this event — re-ingest the session to compute it.";

  const parts: string[] = [];
  if (inputs.speed_kmh != null) parts.push(`${inputs.speed_kmh.toFixed(0)} km/h`);
  if (inputs.gear != null) parts.push(`${ordinal(inputs.gear)} gear`);

  if (kind === "lockup" && inputs.brake_pedal_pct != null) {
    parts.push(`${inputs.brake_pedal_pct.toFixed(0)}% brake`);
  }
  if (kind === "wheelspin" && inputs.throttle_pct != null) {
    parts.push(`${inputs.throttle_pct.toFixed(0)}% throttle`);
  }
  if (inputs.turning && inputs.turn_direction) {
    parts.push(`turning ${inputs.turn_direction}`);
  } else if (inputs.turning === false) {
    parts.push("in a straight line");
  }
  if (inputs.combined_g != null) parts.push(`${inputs.combined_g.toFixed(2)} g on the car`);
  if (kind === "lockup" && inputs.abs_active) parts.push("ABS already in");

  return parts.join(" · ");
}

// ─────────────────────────────────────────────────────────────────────────────
// The road you used
// ─────────────────────────────────────────────────────────────────────────────

export function explainTrackWidth(tw: TrackWidthData): Explanation {
  const s = tw.summary;
  if (!s.measured || s.median_used_width_m == null) {
    return {
      headline: "There is not enough here to measure the road you used.",
      detail: s.reason ?? tw.caveat,
    };
  }

  const laps = tw.laps_used.length;
  return {
    headline: `Across ${laps} clean laps your lines covered a band ${s.median_used_width_m.toFixed(1)} m wide on average, opening to ${s.widest_m?.toFixed(1)} m at its widest and closing to ${s.narrowest_m?.toFixed(1)} m at its tightest.`,
    detail: `Where the band is thin you put the car in the same place every lap; where it opens out, your line moved from lap to lap. This is the road YOU used — the .ibt carries no kerbs, white lines or surveyed edges, so a narrow band means you were repeatable there, not that the track was narrow.`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// The session at a glance
// ─────────────────────────────────────────────────────────────────────────────

export function explainSession(laps: Lap[], clean: Lap[]): Explanation {
  const times = clean.map((l) => l.lap_time_s as number);
  if (times.length === 0) {
    return {
      headline: "No lap in this session was clean enough to compare against.",
      detail:
        "Out laps, in laps, partial laps and laps flagged for incidents are all shown, but none of them can serve as a reference.",
    };
  }

  const best = Math.min(...times);
  const mean = times.reduce((s, v) => s + v, 0) / times.length;
  const sd = Math.sqrt(times.reduce((s, v) => s + (v - mean) ** 2, 0) / times.length);
  const excluded = laps.length - clean.length;

  return {
    headline: `${clean.length} of your ${laps.length} laps were clean, your best was ${fmt(best)}, and your clean laps sat within ${sd.toFixed(3)} s of each other.`,
    detail: `${
      excluded > 0
        ? `${excluded} lap${excluded === 1 ? " was" : "s were"} left out of every comparison — out and in laps, partial laps, and laps flagged for incidents. They are still drawn, dimmed, because a lap that vanishes is a lap you cannot reason about. `
        : ""
    }The spread is your own consistency this session, not a grade — the right spread depends on the run you were doing.`,
  };
}

function fmt(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
}
