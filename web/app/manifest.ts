import type { MetadataRoute } from "next";

/* Installed-app metadata. `start_url` is the PHONE app, not the desktop shell —
   the only reason to add Proctor to a home screen is the after-session read, and
   landing on the desktop shell on a phone would be the wrong thing to open. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Proctor — observations, not verdicts",
    short_name: "Proctor",
    description: "The after-session read. Every comparison is you against you.",
    start_url: "/m",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    // The Nocturne ground, so the launch screen and status bar match the app
    // rather than flashing white before it paints.
    background_color: "#161826",
    theme_color: "#161826",
    icons: [
      { src: "/icon", sizes: "192x192", type: "image/png" },
      { src: "/apple-icon", sizes: "180x180", type: "image/png" },
    ],
  };
}
