"use client";

/* One number, big, with a few words under it.
 *
 * The overview screens are built from these. The rule each one keeps: the
 * number comes off a module, and when a module could not measure it the tile
 * shows an em dash and says why in the same place the number would have been.
 * A tile can never show a zero standing in for "not measured". */

import { dim } from "@/lib/proctor/channels";

export interface TileProps {
  label: string;
  /** Already formatted. null renders as an em dash with `sub` as the reason. */
  value: string | null;
  unit?: string;
  /** A few words. With a null value this is the reason. */
  sub?: string;
  tone?: string;
  /** 0-100 for a bar under the number; omit for none. */
  bar?: number | null;
  /** Marks something worth a look — a colour, never a verdict in words. */
  flagged?: boolean;
  /** Full wording, for hover. The short `sub` is what is always on screen. */
  title?: string;
  onClick?: () => void;
}

export default function Tile({ label, value, unit, sub, tone, bar, flagged, title, onClick }: TileProps) {
  const Box = onClick ? "button" : "div";
  return (
    <Box
      type={onClick ? "button" : undefined}
      className={`ov-tile${onClick ? " pk" : ""}`}
      data-flagged={flagged ? "true" : undefined}
      title={title}
      onClick={onClick}
    >
      <div className="ov-tile-label">{label}</div>
      <div className="ov-tile-value num" style={{ color: value == null ? dim(40) : tone }}>
        {value ?? "—"}
        {value != null && unit && <span className="ov-tile-unit">{unit}</span>}
      </div>
      {bar != null && Number.isFinite(bar) && (
        <div className="ov-tile-bar" aria-hidden>
          <span style={{ width: `${Math.max(0, Math.min(100, bar)).toFixed(1)}%`, background: tone }} />
        </div>
      )}
      {sub && <div className="ov-tile-sub">{sub}</div>}
    </Box>
  );
}
