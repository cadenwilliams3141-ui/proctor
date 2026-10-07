"use client";

/* Anatomy. A prototype-class racer taken apart, with each system tagged by the
 * sim hardware that stands in for it at home.
 *
 * It is an explainer, not a reading. It draws one fixed car and shows general
 * reference text, the same for every driver, and it needs no session — which is
 * why it is listed with the screens that survive a failed load in AppShell.
 *
 * The scene fills the workspace rather than sitting in a panel: the car needs
 * the room once it is apart, and the tags need somewhere to stand.
 *
 * three.js and a 7 MB model are behind this screen. Both are fetched only when
 * it opens, so a driver who never comes here downloads neither. */

import dynamic from "next/dynamic";

import { Eyebrow } from "@/components/proctor/ui/Caveat";

const AnatomyScene = dynamic(() => import("@/components/proctor/views/AnatomyScene"), {
  ssr: false,
  loading: () => (
    <div className="ana-root" data-state="loading">
      <div className="ana-center">
        <Eyebrow>Loading the 3D view</Eyebrow>
      </div>
    </div>
  ),
});

export default function AnatomyScreen() {
  return <AnatomyScene />;
}
