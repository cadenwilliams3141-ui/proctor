"use client";

/* Rig. The layout the driver sits in, and what they have said is in each slot.
 *
 * WHERE THE NAMES COME FROM. Proctor cannot detect hardware: nothing in a .ibt
 * names the product behind a channel. So the only thing this screen can show
 * about a rig is what the driver tells it, and that is what the builder is for.
 * They pick a layout, a screen count, and a product for each of the seven
 * slots, and the screen plays it back to them. It is their word, not a reading,
 * and every caveat on the screen says which.
 *
 * THE CATALOGUE IS A DEMO. The products come from lib/proctor/rigCatalog.ts, a
 * short hand-picked list that exists so the builder can be tried before there
 * is a real catalogue. Wherever a row from it is on screen, so is a "demo
 * catalogue" tag. See that file for what the list is and is not.
 *
 * WHERE IT IS KEPT. In this browser's storage and nowhere else. Proctor has no
 * table for a rig yet, so nothing here follows the driver to another device,
 * and nothing downstream reads it.
 *
 * WHAT THE DRAWING DOES WITH IT. The model stays generic whichever product is
 * picked: a part stands in for its category. Three things do change it, because
 * they are about shape rather than brand: the layout, one screen or three, and
 * a slot the driver says is empty, which is left out.
 *
 * THE GUIDED SETUP. On a first visit the driver is brought here as the second
 * step of setup (see shell/SetupScreen.tsx and lib/setup.ts). That is this same
 * screen with a strip across the top and a Back / Next under the picker, not a
 * second builder: what is built during setup is exactly what is edited later.
 *
 * Still left out on purpose, because each would be a figure with nothing
 * behind it:
 *
 *   - no install dates, session counts or wear       nothing records them
 *   - no field-of-view figure                         it would be the model's
 *   - no "add a product by hand"                      nowhere to keep one yet
 *
 * WHY THE ID IS `hardware` AND NOT `rig`. `rig` is taken: it is the Physics
 * screen's id, kept unchanged because it is in ?screen= links people have saved
 * (see shell/IconRail.tsx). This screen is labelled "Rig" and lives one item
 * below it.
 *
 * The 3D view pulls in three.js, which is most of a megabyte. It is loaded only
 * when this screen opens, so a driver who never comes here never downloads it. */

import { Check } from "lucide-react";
import dynamic from "next/dynamic";
import { createContext, useContext, useEffect, useState } from "react";

import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import Panel from "@/components/proctor/ui/Panel";
import { dim } from "@/lib/proctor/channels";
import {
  RIG_LAYOUTS,
  RIG_NONE,
  RIG_PREFS_KEY,
  RIG_SLOTS,
  emptySlots,
  parseRigPrefs,
  rigLayout,
  type RigLayoutKey,
  type RigPrefs,
  type RigScreens,
  type RigSlotKey,
} from "@/lib/proctor/rig";
import { productName, productsFor, rigChoice, type RigChoice } from "@/lib/proctor/rigCatalog";
import { useProctor } from "@/lib/proctor/store";
import { stepOf } from "@/lib/setup";

const SCREEN_CHOICES: readonly { key: RigScreens; label: string }[] = [
  { key: "single", label: "One screen" },
  { key: "triple", label: "Triples" },
];

/** What the builder is asking about: the layout, or one of the slots. */
type Step = "layout" | RigSlotKey;
const STEPS: readonly Step[] = ["layout", ...RIG_SLOTS.map((s) => s.key)];

const DEMO_NOTE =
  "A short, hand-picked list so the builder can be tried. The makes and models are real; the one-line descriptions have not been checked against the makers' own sheets, and a product missing from the list has simply not been added.";

/* Which layout's poster stands in while three.js is on its way. next/dynamic
   hands its loading component no props, so the layout reaches it this way.
   Null is the moment before the saved choice has been read. */
const PosterLayout = createContext<RigLayoutKey | null>(null);

/* The same box the scene will occupy, already showing the model, so the panel
   does not jump when the 3D view arrives. */
function StagePlaceholder() {
  const layout = useContext(PosterLayout);
  return (
    <div className="rig-stage" data-state="loading">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {layout && <img className="rig-poster" alt="" src={rigLayout(layout).poster} />}
      <span className="rig-note">loading the 3D view</span>
    </div>
  );
}

const RigScene = dynamic(() => import("@/components/proctor/views/RigScene"), {
  ssr: false,
  loading: StagePlaceholder,
});

/* One line of the rig as the driver has described it. */
function RigRow({
  label,
  value,
  said,
  active,
  onClick,
}: {
  label: string;
  value: string;
  /** False while the driver has not answered: the value is then a placeholder. */
  said: boolean;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="rig-row" data-active={active} aria-pressed={active} onClick={onClick}>
      <span className="rig-row-label">{label}</span>
      <span className="rig-row-value" data-said={said}>
        {value}
      </span>
    </button>
  );
}

/* One thing that can be picked for the step in hand. */
function Option({
  title,
  make,
  note,
  active,
  onClick,
}: {
  title: string;
  make?: string;
  note?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button type="button" className="rig-opt" data-active={active} aria-pressed={active} onClick={onClick}>
      <span className="rig-opt-main">
        {make && <span className="rig-opt-make">{make}</span>}
        <span className="rig-opt-name">{title}</span>
      </span>
      {note && <span className="rig-opt-note">{note}</span>}
      <Check className="rig-opt-check" size={14} strokeWidth={2} aria-hidden />
    </button>
  );
}

function choiceText(choice: RigChoice): string {
  if (choice.state === "product") return productName(choice.product);
  return choice.state === "none" ? "none fitted" : "not chosen";
}

export default function HardwareScreen() {
  const { state, dispatch } = useProctor();
  const guided = state.setup === "rig";

  const [step, setStep] = useState<Step | null>(guided ? "layout" : null);
  // A setup started from this screen begins at the top of the walk as well.
  useEffect(() => {
    if (guided) setStep("layout");
  }, [guided]);

  /* Null until the saved rig has been read, which can only happen in the
     browser. Starting on a default and correcting it a moment later would draw
     the wrong rig first, and would not match what the server rendered. */
  const [prefs, setPrefs] = useState<RigPrefs | null>(null);
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = localStorage.getItem(RIG_PREFS_KEY);
    } catch {
      /* storage is switched off: the defaults stand */
    }
    setPrefs(parseRigPrefs(raw));
  }, []);

  function save(next: RigPrefs) {
    setPrefs(next);
    try {
      localStorage.setItem(RIG_PREFS_KEY, JSON.stringify(next));
    } catch {
      /* the rig lasts until the page is closed, which is all it can do */
    }
  }

  /* In the guided setup an answer moves on to the next question. Outside it,
     the driver is editing one thing and stays where they are. */
  function answered(from: Step) {
    if (!guided) return;
    const next = STEPS[STEPS.indexOf(from) + 1];
    if (next) setStep(next);
  }

  function finish() {
    dispatch({ t: "setup", step: null });
    dispatch({ t: "screen", screen: "analyze" });
  }

  const layout = prefs ? rigLayout(prefs.layout) : null;
  const screens = prefs && layout ? prefs.screens[layout.key] : null;
  const slot = RIG_SLOTS.find((s) => s.key === step) ?? null;
  const choiceFor = (key: RigSlotKey): RigChoice =>
    prefs && layout ? rigChoice(key, layout.key, prefs.parts[key]) : { state: "unset" };
  const saidCount = RIG_SLOTS.filter((s) => choiceFor(s.key).state !== "unset").length;

  const stepIndex = step ? STEPS.indexOf(step) : -1;
  const stepAnswered = step === "layout" || (slot != null && choiceFor(slot.key).state !== "unset");
  const options = slot && layout ? productsFor(slot.key, layout.key) : [];
  const picked = slot ? choiceFor(slot.key) : null;

  const setPart = (key: RigSlotKey, id: string | null) => {
    if (!prefs) return;
    save({ ...prefs, parts: { ...prefs.parts, [key]: id } });
    if (id != null) answered(key);
  };

  return (
    <div
      className="scrollpane screen-pad"
      style={{ flex: 1, minHeight: 0, padding: "var(--space-6)" }}
    >
      {guided && (
        <section className="rig-guide" aria-label="Setup">
          <div className="rig-guide-text">
            <Eyebrow color="var(--ch-a)">Setup · {stepOf("rig")}</Eyebrow>
            <div className="rig-guide-title">Build your rig</div>
            <p>
              Pick the layout you drive from, then say what is in each slot. Skip any you are not
              sure of: all of it can be changed later, on this screen.
            </p>
          </div>
          <span className="rig-guide-count">
            <span className="num">{saidCount}</span> of <span className="num">{RIG_SLOTS.length}</span>{" "}
            slots answered
          </span>
          <button type="button" className="btn btn-primary" onClick={finish}>
            {saidCount === 0 ? "Skip for now" : "Finish"}
          </button>
        </section>
      )}

      <div className="rig-split">
        <Panel
          title="Rig layout"
          sub={`${RIG_SLOTS.length} mounting slots`}
          right={<Eyebrow>{slot ? slot.label : "click a part"}</Eyebrow>}
          foot={
            <Caveat>
              A generic rig, drawn to realistic proportions. The drawing follows the layout, the
              number of screens and any slot you say is empty; it does not change with the product
              you pick, because each part stands in for its category. Nothing on this screen comes
              from telemetry, and the road on the screens is decoration, not a replay of a session.
            </Caveat>
          }
        >
          <div className="rig-tools">
            <div className="seg" role="group" aria-label="Layout">
              {RIG_LAYOUTS.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  className="seg-opt"
                  title={l.blurb}
                  data-active={layout?.key === l.key}
                  aria-pressed={layout?.key === l.key}
                  disabled={!prefs}
                  onClick={() => prefs && save({ ...prefs, layout: l.key })}
                >
                  {l.label}
                </button>
              ))}
            </div>
            <div className="seg" role="group" aria-label="Screens">
              {SCREEN_CHOICES.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className="seg-opt"
                  data-active={screens === c.key}
                  aria-pressed={screens === c.key}
                  disabled={!prefs}
                  onClick={() =>
                    prefs && layout && save({ ...prefs, screens: { ...prefs.screens, [layout.key]: c.key } })
                  }
                >
                  {c.label}
                </button>
              ))}
            </div>
            <span className="rig-tools-note">{layout?.blurb}</span>
          </div>

          <PosterLayout.Provider value={layout?.key ?? null}>
            {prefs && layout && screens ? (
              <RigScene
                layout={layout.key}
                screens={screens}
                absent={emptySlots(prefs.parts)}
                selected={slot?.key ?? null}
                onSelect={setStep}
              />
            ) : (
              <StagePlaceholder />
            )}
          </PosterLayout.Provider>
        </Panel>

        <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-4)", minWidth: 0 }}>
          <Panel
            title="Your rig"
            sub="as you have described it"
            right={
              <span className="tag-warn" title={DEMO_NOTE}>
                demo catalogue
              </span>
            }
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 1 }}>
              <RigRow
                label="Layout"
                value={layout ? layout.label : "…"}
                said={layout != null}
                active={step === "layout"}
                onClick={() => setStep("layout")}
              />
              {RIG_SLOTS.map((s) => {
                const choice = choiceFor(s.key);
                return (
                  <RigRow
                    key={s.key}
                    label={s.label}
                    value={choiceText(choice)}
                    said={choice.state !== "unset"}
                    active={step === s.key}
                    onClick={() => setStep(s.key)}
                  />
                );
              })}
            </div>
            <Caveat>
              This is what you have told this browser, not something Proctor detected, and it is
              kept here only. &ldquo;Not chosen&rdquo; means you have not said. It does not mean
              nothing is mounted there, and it does not mean a reading is zero.
            </Caveat>
            {!guided && (
              <div className="rig-again">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => dispatch({ t: "setup", step: "detail" })}
                >
                  Run the guided setup again
                </button>
              </div>
            )}
          </Panel>

          <Panel
            title={step === "layout" ? "Layout" : slot ? slot.label : "Nothing selected"}
            sub={
              step === "layout"
                ? "what the rig is built on"
                : slot && picked
                  ? choiceText(picked)
                  : undefined
            }
          >
            {step == null && (
              <p style={{ margin: 0, fontSize: 12, lineHeight: 1.6, color: dim(58), textWrap: "pretty" }}>
                Click a part of the rig, a caption over it, or a line above, and say what you have
                there.
              </p>
            )}

            {step === "layout" && (
              <div className="rig-opts">
                {RIG_LAYOUTS.map((l) => (
                  <Option
                    key={l.key}
                    title={l.label}
                    note={l.blurb}
                    active={layout?.key === l.key}
                    onClick={() => {
                      if (!prefs) return;
                      save({ ...prefs, layout: l.key });
                      answered("layout");
                    }}
                  />
                ))}
              </div>
            )}

            {slot && (
              <>
                {slot.key === "monitors" && (
                  <div className="rig-count">
                    <span>How many</span>
                    <div className="seg" role="group" aria-label="How many screens">
                      {SCREEN_CHOICES.map((c) => (
                        <button
                          key={c.key}
                          type="button"
                          className="seg-opt"
                          data-active={screens === c.key}
                          aria-pressed={screens === c.key}
                          disabled={!prefs}
                          onClick={() =>
                            prefs &&
                            layout &&
                            save({ ...prefs, screens: { ...prefs.screens, [layout.key]: c.key } })
                          }
                        >
                          {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rig-opts scrollpane">
                  {options.map((p) => (
                    <Option
                      key={p.id}
                      title={p.model}
                      make={p.make}
                      note={p.kind}
                      active={picked?.state === "product" && picked.product.id === p.id}
                      onClick={() => setPart(slot.key, p.id)}
                    />
                  ))}
                  {slot.optional && (
                    <Option
                      title="None fitted"
                      note="leaves it out of the drawing"
                      active={picked?.state === "none"}
                      onClick={() => setPart(slot.key, RIG_NONE)}
                    />
                  )}
                </div>

                {picked && picked.state !== "unset" && (
                  <button type="button" className="rig-clear" onClick={() => setPart(slot.key, null)}>
                    Clear this answer
                  </button>
                )}

                <Caveat>
                  Demo catalogue. {DEMO_NOTE} Picking one records what you said and changes no
                  reading anywhere in Proctor: nothing in a .ibt identifies which product produced
                  a channel.
                </Caveat>
              </>
            )}

            {guided && step && (
              <div className="rig-nav">
                <span>
                  <span className="num">{stepIndex + 1}</span> of <span className="num">{STEPS.length}</span>
                </span>
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={stepIndex <= 0}
                  onClick={() => setStep(STEPS[stepIndex - 1])}
                >
                  Back
                </button>
                {stepIndex < STEPS.length - 1 ? (
                  <button type="button" className="btn btn-primary" onClick={() => setStep(STEPS[stepIndex + 1])}>
                    {stepAnswered ? "Next" : "Skip this one"}
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary" onClick={finish}>
                    Finish
                  </button>
                )}
              </div>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
