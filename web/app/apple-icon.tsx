import { ImageResponse } from "next/og";

import { INK } from "@/lib/proctor/channels";

/* The home-screen icon, generated at build time rather than shipped as a raster
   asset — the design has no raster assets, and this keeps it that way. It is the
   same mark as the brand button in the desktop icon rail: a dark "P" on a
   filled accent tile, on the Carbon ground. */

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: INK.bg,
        }}
      >
        <div
          style={{
            width: 120,
            height: 120,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: INK.accent,
            borderRadius: 26,
            color: INK.onAccent,
            fontSize: 72,
            fontWeight: 700,
            // Matches the wordmark's tracking at rest.
            letterSpacing: "0.01em",
          }}
        >
          P
        </div>
      </div>
    ),
    size,
  );
}
