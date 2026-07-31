import { ImageResponse } from "next/og";

/* Favicon and PWA icon, generated at build time — same mark as apple-icon.tsx,
   sized for the manifest's install prompt. 192 is the size Android and desktop
   PWA installers look for. */

export const size = { width: 192, height: 192 };
export const contentType = "image/png";

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#161826",
        }}
      >
        <div
          style={{
            width: 128,
            height: 128,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            border: "4px solid #9184d9",
            borderRadius: 28,
            color: "#b5abfc",
            fontSize: 78,
            fontWeight: 500,
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
