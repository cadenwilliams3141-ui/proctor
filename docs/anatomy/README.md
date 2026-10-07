# Anatomy: the exploded car

The **Anatomy** item in the left rail (`?screen=anatomy`) opens a prototype-class race car that comes apart
into its systems, each tagged with the piece of sim hardware that stands in for it at home. Orbit it, click a
part or a chip, step through with the arrow keys.

## What it is, and what it is not

- **An explainer, not a reading.** It draws one fixed car and shows general reference text, the same for
  every driver. It reads no session and needs none.
- **The numbers in it are not measurements.** Ranges like "5 Nm entry level to 25 Nm+" describe a class of
  hardware. They live in `web/lib/proctor/anatomy.ts`, not in a screen's source, and the panel says at its
  foot that nothing there comes from a rig or a session.
- **The car is an original drawing.** A prototype-class design made for this view. It is not any maker's car
  and carries nobody's marks or light shapes. Keep it that way if it is restyled.

## Where it came from

The view was designed as a standalone page (the "Sim Rig Exploded View" artifact) around a model built
locally from FreeCAD scripts and finished in Blender. This is that view, moved into the app:

- same model, same nine parts and text, same explode choreography, tags, panel, chips and keys
- restyled to the app's Nocturne tokens and type, in place of the page's own orange and condensed type
- the page's big headline is gone, because the top bar already names the screen
- the page's design-time options (livery colours, x-ray body, explode distance) are not exposed; the car
  uses the paint baked into the model, which is the page's default livery
- under reduced motion the car arrives already apart and does not turn on its own

## The pieces

| Path | What it is |
|---|---|
| `web/public/anatomy/gtp_prototype.glb` | The car: 120 top-level nodes, one per component, about 354k triangles, 7 MB. Y up, metres, nose toward +Z. |
| `web/lib/proctor/anatomy.ts` | The nine parts and their text, the explode rules, and the tag-placement arithmetic. |
| `web/lib/proctor/anatomy.test.ts` | Opens the GLB and checks every component is claimed by a rule, every tag points at a component that exists, and left and right mirror each other. |
| `web/components/proctor/views/AnatomyScene.tsx` | The three.js scene and the chrome over it. |
| `web/components/proctor/screens/AnatomyScreen.tsx` | The screen: loads the scene only when it is opened. |

## How a component knows where to go

Every node in the model is named for what it is (`front_left_brake_disc`, `engine_cover`, `steering_rack`).
`EXPLODE_RULES` is a list of name patterns, first match wins. Each rule says which part of the story the
component belongs to (or none, for bodywork and aero), where it travels to, and in which wave it leaves.
A `_right` component mirrors its `_left` twin.

Rebuilding the model with a renamed or added component fails `anatomy.test.ts` until a rule claims it.

## Not done

- **The model is not compressed.** It is 7 MB, fetched only when the screen opens. Meshopt compression would
  cut that substantially (not measured), and three.js already ships the decoder; it was left out to keep the
  model byte-for-byte the one the view was built around.
- **The model's source is not in this repo.** The FreeCAD and Blender scripts that build it are a separate
  local project.
- **No phone version.** `/m` keeps its four tabs.
