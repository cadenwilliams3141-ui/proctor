"use client";

/* The exploded car.
 *
 * A prototype-class racer that comes apart into its systems, each one tagged
 * with the piece of sim hardware that stands in for it at home. Orbit it, click
 * a part or a chip, step through with the arrow keys.
 *
 * WHAT THIS IS NOT. It is not the car you drove and it reads nothing from a
 * session. The model is one fixed drawing, and the text beside it is general
 * reference kept in lib/proctor/anatomy.ts. The panel says so at its foot.
 *
 * WHY IT IS IMPERATIVE. 120 components move every frame while the car is
 * coming apart, and nine tags are re-placed every frame so they do not sit on
 * each other. None of that goes through React state (see the note at the top
 * of lib/proctor/store.tsx): the scene writes positions and tag transforms
 * directly, and React owns only what a click changes — which part is selected,
 * whether the car is apart, whether it is turning.
 *
 * This file and views/RigScene.tsx are the only importers of three.js, and
 * both are loaded with next/dynamic, so neither is in the bundle of a driver
 * who never opens their screen. */

import { useCallback, useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import Caveat, { Eyebrow } from "@/components/proctor/ui/Caveat";
import {
  ANATOMY_MODEL_URL,
  ANATOMY_PARTS,
  LEADER_NODES,
  classify,
  explodeProgress,
  partNumber,
  placeTag,
  tagRect,
  type AnatomyGroupId,
  type AnatomyPartId,
  type Rect,
} from "@/lib/proctor/anatomy";
import { CH, INK, dim } from "@/lib/proctor/channels";

/** What the frame loop reads from React, once per frame. */
interface Live {
  selected: AnatomyPartId | null;
  hover: AnatomyPartId | null;
  exploded: boolean;
  spin: boolean;
}

interface SceneHooks {
  onPick: (id: AnatomyPartId | null) => void;
  onHover: (id: AnatomyPartId | null) => void;
  /** The opening move: a beat after the car appears, it comes apart. */
  onIntro: () => void;
  onProgress: (percent: number) => void;
  onReady: () => void;
  onError: () => void;
  onNarrow: (narrow: boolean) => void;
  onTouch: () => void;
}

interface SceneHandle {
  /** A deliberate choice was made, so the opening move must not override it. */
  settle(): void;
  resetView(): void;
  dispose(): void;
}

type PartMaterial = THREE.MeshStandardMaterial;

interface Piece {
  obj: THREE.Object3D;
  name: string;
  /** Where it sits in the assembled car, and where it travels to. */
  p0: THREE.Vector3;
  off: THREE.Vector3;
  order: number;
  still: boolean;
  /** Its bounds and centre in the assembled car. */
  box: THREE.Box3;
  c0: THREE.Vector3;
  /** 0 in place, 1 fully out. */
  e: number;
  line?: THREE.Line<THREE.BufferGeometry, THREE.LineDashedMaterial>;
}

interface Group {
  id: AnatomyGroupId;
  pieces: Piece[];
  mats: PartMaterial[];
  /** Bodywork and aero: scenery, not a part you can select. */
  context: boolean;
  highlight: number;
  opacity: number;
  visible: boolean;
  ghosted: boolean;
  /** The tag: what it points at, how visible it is, and where it last sat. */
  anchor?: Piece;
  anchorAt: readonly [number, number, number];
  tag: number;
  noSlot: boolean;
  left?: boolean;
  down?: boolean;
  lead?: number;
}

const THETA0 = 0.55;
const PHI0 = 0.42;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const isGlass = (name: string) => /glass|light_|mirror/.test(name);

function createScene(
  root: HTMLDivElement,
  canvas: HTMLCanvasElement,
  live: { current: Live },
  hooks: SceneHooks,
  reduceMotion: boolean,
): SceneHandle | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }

  const listeners = new AbortController();
  const on = { signal: listeners.signal };
  let dead = false;

  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(INK.bg);
  scene.fog = new THREE.Fog(INK.bg, 18, 44);
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 120);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = room.texture;
  scene.environmentIntensity = 0.55;

  scene.add(new THREE.HemisphereLight(INK.text, INK.bg, 0.35));
  const key = new THREE.DirectionalLight(INK.text, 2.0);
  key.position.set(6, 12, 5);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  const rimLight = new THREE.DirectionalLight(INK.neutral500, 1.1);
  rimLight.position.set(-7, 5, -6);
  scene.add(key, rimLight);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: 0.45 }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  const grid = new THREE.GridHelper(32, 64, INK.neutral800, INK.surface);
  grid.position.y = 0.002;
  // Unmapped, so the lines fade into exactly the page's ground and not a
  // tone-mapped near miss of it.
  (grid.material as THREE.Material).toneMapped = false;
  scene.add(ground, grid);

  const accent = new THREE.Color(CH.a);
  const groups: Partial<Record<AnatomyGroupId, Group>> = {};
  const pieces: Piece[] = [];
  const pickables: THREE.Object3D[] = [];
  const tags = new Map<AnatomyPartId, HTMLElement>();
  let ready = false;

  const groupFor = (id: AnatomyGroupId): Group =>
    (groups[id] ??= {
      id, pieces: [], mats: [], context: id === "body" || id === "aero",
      highlight: 0, opacity: 1, visible: true, ghosted: false,
      anchorAt: [0.5, 1, 0.5], tag: 0, noSlot: false,
    });

  /* ── Camera: an orbit with a goal it eases toward ─────────────────────── */
  const cam = { theta: THETA0, phi: PHI0, zoom: 1, r: 9 };
  const goal = { theta: THETA0, phi: PHI0, zoom: 1 };
  const goalTarget = new THREE.Vector3(0, 0.5, 0);
  const camTarget = new THREE.Vector3(0, 0.5, 0);
  const tb = new THREE.Box3();
  const tb2 = new THREE.Box3();
  const tv = new THREE.Vector3();
  const v = new THREE.Vector3();
  const ray = new THREE.Raycaster();
  const mouse = new THREE.Vector2(9, 9);
  const size = { w: 1, h: 1 };
  let g = 0; // master explode progress, 0 together to 1 apart
  let t = 0;
  let last = performance.now();
  let lastInteract = 0;
  let introAt = 0;
  let viewX = 0;
  let viewY = 0;
  let bandFit = 1;
  let hoverDirty = false;
  let running = false;
  let onScreen = true;

  function pickAt(): AnatomyGroupId | null {
    ray.setFromCamera(mouse, camera);
    for (const hit of ray.intersectObjects(pickables, false)) {
      const G = groups[hit.object.userData.g as AnatomyGroupId];
      if (G && G.opacity > 0.5 && G.visible) return G.id;
    }
    return null;
  }
  const selectable = (id: AnatomyGroupId | null): AnatomyPartId | null =>
    id && !groups[id]?.context ? (id as AnatomyPartId) : null;

  function resize() {
    const w = Math.max(1, root.clientWidth);
    const h = Math.max(1, root.clientHeight);
    if (w === size.w && h === size.h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    size.w = w;
    size.h = h;
    hooks.onNarrow(w < 640);
  }

  /* ── The model ────────────────────────────────────────────────────────── */
  new GLTFLoader().load(
    ANATOMY_MODEL_URL,
    (gltf) => {
      if (dead) return;
      const model = gltf.scene;
      scene.add(model);
      const bounds = new THREE.Box3().setFromObject(model);
      const c = bounds.getCenter(new THREE.Vector3());
      model.position.set(-c.x, -bounds.min.y, -c.z);
      model.updateMatrixWorld(true);

      for (const obj of model.children.slice()) {
        const name = obj.name || "";
        const cls = classify(name, obj.userData?.group as string | undefined);
        const G = groupFor(cls.group);
        const box = new THREE.Box3().setFromObject(obj);
        const piece: Piece = {
          obj, name, p0: obj.position.clone(), off: new THREE.Vector3(...cls.offset),
          order: cls.order, still: cls.offset.every((n) => n === 0),
          box, c0: box.getCenter(new THREE.Vector3()), e: 0,
        };
        obj.traverse((o) => {
          const mesh = o as THREE.Mesh<THREE.BufferGeometry, PartMaterial>;
          if (!mesh.isMesh) return;
          // Its own copy: fading one group must not fade every other component
          // that happens to share the material.
          const mat = mesh.material.clone();
          mat.userData.opacity0 = mat.opacity;
          mat.userData.transparent0 = mat.transparent;
          mat.userData.glow0 = mat.emissive.clone().multiplyScalar(mat.emissiveIntensity);
          mat.emissiveIntensity = 1;
          mat.emissive.copy(mat.userData.glow0 as THREE.Color);
          mesh.material = mat;
          G.mats.push(mat);
          mesh.castShadow = !isGlass(mat.name);
          mesh.receiveShadow = true;
          mesh.userData.g = cls.group;
          pickables.push(mesh);
        });
        if (LEADER_NODES.has(name)) {
          const line = new THREE.Line(
            new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
            new THREE.LineDashedMaterial({
              color: INK.neutral700, dashSize: 0.08, gapSize: 0.06, transparent: true, opacity: 0, depthWrite: false,
            }),
          );
          line.frustumCulled = false;
          scene.add(line);
          piece.line = line;
        }
        G.pieces.push(piece);
        pieces.push(piece);
      }
      for (const part of ANATOMY_PARTS) {
        const G = groups[part.id];
        if (!G) continue;
        G.anchor = G.pieces.find((p) => p.name === part.anchor) ?? G.pieces[0];
        if (part.anchorAt) G.anchorAt = part.anchorAt;
      }
      root.querySelectorAll<HTMLElement>("[data-label-id]").forEach((el) => {
        tags.set(el.dataset.labelId as AnatomyPartId, el);
      });

      ready = true;
      resize();
      if (reduceMotion) {
        g = 1; // no opening move: arrive already apart
        hooks.onIntro();
      } else {
        introAt = performance.now() + 900;
      }
      hooks.onProgress(100);
      hooks.onReady();
      start();
    },
    (ev) => {
      if (dead || !ev.total) return;
      hooks.onProgress(Math.min(99, Math.round((ev.loaded / ev.total) * 100)));
    },
    () => {
      if (!dead) hooks.onError();
    },
  );

  /* ── Pointer ──────────────────────────────────────────────────────────── */
  const pointers = new Map<number, { x: number; y: number }>();
  let down: { x: number; y: number; theta: number; phi: number; moved: boolean } | null = null;
  let pinch: { d: number; zoom: number } | null = null;

  const setMouse = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    mouse.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  };
  const spread = () => {
    const [p, q] = [...pointers.values()];
    return Math.max(1, Math.hypot(p.x - q.x, p.y - q.y));
  };

  canvas.addEventListener("pointerdown", (e) => {
    setMouse(e);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    lastInteract = performance.now();
    try { canvas.setPointerCapture(e.pointerId); } catch { /* fine without it */ }
    if (e.pointerType === "touch") hooks.onTouch();
    if (pointers.size === 2) {
      pinch = { d: spread(), zoom: goal.zoom };
      down = null;
    } else if (pointers.size === 1) {
      down = { x: e.clientX, y: e.clientY, theta: goal.theta, phi: goal.phi, moved: false };
    }
  }, on);
  canvas.addEventListener("pointermove", (e) => {
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch) {
      if (pointers.size >= 2) {
        goal.zoom = clamp((pinch.zoom * pinch.d) / spread(), 0.3, 2.2);
        lastInteract = performance.now();
      }
      return;
    }
    setMouse(e);
    if (!down) {
      if (e.pointerType !== "touch") hoverDirty = true;
      return;
    }
    const dx = e.clientX - down.x;
    const dy = e.clientY - down.y;
    if (Math.abs(dx) + Math.abs(dy) > (e.pointerType === "touch" ? 10 : 5)) {
      down.moved = true;
      canvas.style.cursor = "grabbing";
    }
    if (down.moved) {
      goal.theta = down.theta - dx * 0.006;
      goal.phi = clamp(down.phi + dy * 0.004, 0.04, 1.35);
      lastInteract = performance.now();
    }
  }, on);
  const release = (e: PointerEvent) => {
    pointers.delete(e.pointerId);
    if (pinch) {
      if (pointers.size < 2) pinch = null;
      if (pointers.size === 1) {
        const [p] = [...pointers.values()];
        down = { x: p.x, y: p.y, theta: goal.theta, phi: goal.phi, moved: true };
      }
      return;
    }
    const d = down;
    down = null;
    canvas.style.cursor = "grab";
    if (e.pointerType !== "touch") hoverDirty = true;
    if (d && !d.moved && e.type === "pointerup" && ready) {
      setMouse(e);
      hooks.onPick(selectable(pickAt()));
    }
  };
  canvas.addEventListener("pointerup", release, on);
  canvas.addEventListener("pointercancel", release, on);
  canvas.addEventListener("pointerleave", () => {
    if (down || pointers.size) return;
    hooks.onHover(null);
    mouse.set(9, 9);
  }, on);
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    goal.zoom = clamp(goal.zoom * Math.exp(e.deltaY * 0.0012), 0.3, 2.2);
    lastInteract = performance.now();
  }, { passive: false, signal: listeners.signal });

  /* ── Frame ────────────────────────────────────────────────────────────── */
  function frame() {
    if (!running) return;
    requestAnimationFrame(frame);
    const now = performance.now();
    // Capped so a tab coming back from the background does not jump, but
    // loosely: on a slow GPU a tight cap turns every animation to slow motion.
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    t += dt;
    if (introAt && now > introAt) {
      introAt = 0;
      hooks.onIntro();
    }
    const { selected: sel, hover: hov, exploded, spin } = live.current;

    // The car takes 2.2 s to come apart, or no time at all under reduced motion.
    const step = reduceMotion ? 1 : dt / 2.2;
    g += clamp((exploded ? 1 : 0) - g, -step, step);
    const k4 = 1 - Math.exp(-dt * 4);
    const k6 = 1 - Math.exp(-dt * 6);
    const k8 = 1 - Math.exp(-dt * 8);
    const k10 = 1 - Math.exp(-dt * 10);

    let gi = 0;
    for (const G of Object.values(groups)) {
      gi++;
      const bob = reduceMotion ? 0 : Math.sin(t * 1.1 + gi * 1.7) * 0.025;
      for (const N of G.pieces) {
        N.e = explodeProgress(g, N.order);
        const p = N.obj.position;
        p.copy(N.p0).addScaledVector(N.off, N.e);
        if (!N.still) p.y += bob * N.e;
        if (N.line) {
          const a = N.line.geometry.attributes.position;
          a.setXYZ(0, N.c0.x, N.c0.y, N.c0.z);
          a.setXYZ(1, N.c0.x + p.x - N.p0.x, N.c0.y + p.y - N.p0.y, N.c0.z + p.z - N.p0.z);
          a.needsUpdate = true;
          N.line.computeLineDistances();
          N.line.material.opacity = N.e * (sel && sel !== G.id ? 0.12 : 0.55) * (G.opacity > 0.02 ? 1 : 0);
        }
      }
      const isSel = G.id === sel;
      G.highlight += ((G.context ? 0 : G.id === hov ? 1 : isSel ? 0.4 : 0) - G.highlight) * k10;
      // With a part selected, everything else steps back so it can be seen.
      const target = sel && !isSel ? (G.context ? 0.05 : 0.12) : 1;
      G.opacity += (target - G.opacity) * k8;
      const faded = G.opacity < 0.995;
      const visible = G.opacity > 0.01;
      if (visible !== G.visible) {
        G.visible = visible;
        for (const N of G.pieces) N.obj.visible = visible;
      }
      for (const m of G.mats) {
        const transparent = faded || (m.userData.transparent0 as boolean);
        if (m.transparent !== transparent) {
          m.transparent = transparent;
          m.depthWrite = !faded;
          m.needsUpdate = true;
        }
        m.opacity = (m.userData.opacity0 as number) * G.opacity;
        m.emissive.copy(m.userData.glow0 as THREE.Color).lerp(accent, G.highlight * 0.3);
      }
      if (faded !== G.ghosted) {
        G.ghosted = faded;
        for (const N of G.pieces) {
          N.obj.traverse((o) => {
            const mesh = o as THREE.Mesh<THREE.BufferGeometry, PartMaterial>;
            if (mesh.isMesh) mesh.castShadow = !faded && !isGlass(mesh.material.name);
          });
        }
      }
    }

    if (hoverDirty && !down) {
      hoverDirty = false;
      const id = selectable(pickAt());
      hooks.onHover(id);
      canvas.style.cursor = id ? "pointer" : "grab";
    }

    resize();
    const { w, h } = size;
    const narrow = w < 640;
    const fit = Math.max(1, 1.45 / (w / h)) * (narrow ? 0.7 : 1);
    const S = sel ? groups[sel] : undefined;
    let rGoal = (10.5 + 10 * g) * fit;
    if (S) {
      // Frame the selected part where it is now, mid-flight included.
      tb.makeEmpty();
      for (const N of S.pieces) {
        tv.subVectors(N.obj.position, N.p0);
        tb.union(tb2.copy(N.box).translate(tv));
      }
      tb.getCenter(goalTarget);
      rGoal = clamp(tb.getSize(tv).length() * 2.1, 3, 15) * fit;
    } else {
      goalTarget.set(0, 0.5 + 1.55 * g, 0);
    }
    camTarget.lerp(goalTarget, k6);
    if (spin && !S && !down && now - lastInteract > 2500) goal.theta += dt * 0.09;
    cam.theta += (goal.theta - cam.theta) * k6;
    cam.phi += (goal.phi - cam.phi) * k6;
    cam.zoom += (goal.zoom - cam.zoom) * k6;
    cam.r += (rGoal - cam.r) * k4;
    const R = cam.r * cam.zoom * bandFit;
    camera.position.set(
      camTarget.x + R * Math.cos(cam.phi) * Math.cos(cam.theta),
      camTarget.y + R * Math.sin(cam.phi),
      camTarget.z + R * Math.cos(cam.phi) * Math.sin(cam.theta),
    );
    camera.lookAt(camTarget);

    /* Centre the car in the space the chrome leaves: between the header and
       the chips, and to the left of the panel when one is open. */
    const o = root.getBoundingClientRect();
    let bandY = 0;
    let bf = 1;
    if (!S || narrow) {
      let top = 0;
      let bottom = h;
      root.querySelectorAll("[data-avoid]").forEach((n) => {
        top = Math.max(top, n.getBoundingClientRect().bottom - o.top);
      });
      const lower = root.querySelector(S ? "[data-panel]" : "[data-chips]");
      if (lower) bottom = lower.getBoundingClientRect().top - o.top;
      if (bottom - top > 60) {
        bandY = clamp(h / 2 - (top + bottom) / 2, -h * 0.3, h * 0.3);
        if (narrow) bf = clamp((h * 0.72) / (bottom - top), 1, 1.9);
      }
    }
    bandFit += (bf - bandFit) * k4;
    viewY += (bandY - viewY) * k6;
    viewX += ((S && w > 760 ? 190 : 0) - viewX) * k6;
    camera.setViewOffset(w, h, viewX, viewY, w, h);
    camera.updateMatrixWorld();

    /* Tags: project each anchor, then find every visible tag a place. */
    const items: { el: HTMLElement; G: Group; x: number; y: number; on: boolean }[] = [];
    for (const [id, el] of tags) {
      const G = groups[id];
      const A = G?.anchor;
      if (!G || !A) continue;
      const b = A.box;
      const f = G.anchorAt;
      v.set(
        b.min.x + (b.max.x - b.min.x) * f[0],
        b.min.y + (b.max.y - b.min.y) * f[1] + 0.02,
        b.min.z + (b.max.z - b.min.z) * f[2],
      ).add(A.obj.position).sub(A.p0).project(camera);
      const isOn = id === sel || id === hov;
      let want = A.e > 0.6 || isOn ? (sel && !isOn ? 0 : 1) : 0;
      if (v.z > 1) want = 0;
      const placing = want > 0;
      if (G.noSlot && !isOn) want = 0;
      G.tag += (want - G.tag) * k10;
      const x = ((v.x + 1) / 2) * w;
      const y = ((1 - v.y) / 2) * h;
      el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
      el.style.opacity = G.tag.toFixed(3);
      el.style.visibility = G.tag < 0.01 ? "hidden" : "visible";
      el.style.zIndex = isOn ? "2" : "1";
      if (placing) items.push({ el, G, x, y, on: isOn });
      else G.noSlot = false;
    }
    items.sort((p, q) => Number(q.on) - Number(p.on) || p.y - q.y);
    const taken: Rect[] = [];
    root.querySelectorAll("[data-avoid],[data-chips]").forEach((n) => {
      const r = n.getBoundingClientRect();
      taken.push([r.left - o.left - 6, r.top - o.top - 6, r.right - o.left + 6, r.bottom - o.top + 6]);
    });
    const chips = root.querySelector("[data-chips]");
    if (chips) taken.push([0, chips.getBoundingClientRect().top - o.top - 6, w, h]);
    for (const it of items) {
      const leadEl = it.el.children[1] as HTMLElement;
      const tag = it.el.children[2] as HTMLElement;
      const tw = tag.offsetWidth || 90;
      const th = tag.offsetHeight || 24;
      let place = placeTag(it.x, it.y, tw, th, taken, w, h);
      it.G.noSlot = !place;
      if (!place) {
        // Nowhere clear. An ordinary tag sits this frame out; the one being
        // pointed at is shown regardless, overlapping if it has to.
        if (!it.on) continue;
        const left = it.x + tw + 16 > w;
        place = { lead: 30, left, down: false, rect: tagRect(it.x, it.y, tw, th, 30, left, false) };
      }
      taken.push(place.rect);
      const G = it.G;
      if (G.left !== place.left) {
        G.left = place.left;
        tag.style.left = place.left ? "auto" : "0px";
        tag.style.right = place.left ? "0px" : "auto";
      }
      if (G.down !== place.down) {
        G.down = place.down;
        G.lead = place.lead;
      }
      G.lead = G.lead ? G.lead + (place.lead - G.lead) * k8 : place.lead;
      const L = G.lead.toFixed(1);
      leadEl.style.height = `${L}px`;
      if (place.down) {
        leadEl.style.top = "4px";
        tag.style.bottom = "auto";
        tag.style.top = `${+L + 4}px`;
      } else {
        leadEl.style.top = `${-(+L + 4)}px`;
        tag.style.top = "auto";
        tag.style.bottom = `${+L + 4}px`;
      }
    }

    renderer.render(scene, camera);
  }

  function start() {
    const want = ready && onScreen && !document.hidden && !dead;
    if (want && !running) {
      running = true;
      last = performance.now();
      requestAnimationFrame(frame);
    } else if (!want) {
      running = false;
    }
  }

  const viewWatch = new IntersectionObserver((entries) => {
    onScreen = entries[0]?.isIntersecting ?? true;
    start();
  });
  viewWatch.observe(root);
  document.addEventListener("visibilitychange", start, on);

  return {
    settle() {
      introAt = 0;
      goal.zoom = 1;
    },
    resetView() {
      // Unwind to the nearest whole turn, so the car does not spin back
      // through every lap it has made while idling.
      const turn = 2 * Math.PI;
      goal.theta = THETA0 + Math.round((goal.theta - THETA0) / turn) * turn;
      goal.phi = PHI0;
      goal.zoom = 1;
    },
    dispose() {
      dead = true;
      running = false;
      listeners.abort();
      viewWatch.disconnect();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (!mesh.isMesh && !(obj as THREE.Line).isLine) return;
        mesh.geometry.dispose();
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
      });
      room.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}

type Status = "loading" | "ready" | "failed";

export default function AnatomyScene() {
  const root = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<SceneHandle | null>(null);

  const [selected, setSelected] = useState<AnatomyPartId | null>(null);
  const [hover, setHover] = useState<AnatomyPartId | null>(null);
  const [exploded, setExploded] = useState(false);
  const [spin, setSpin] = useState(true);
  const [status, setStatus] = useState<Status>("loading");
  const [progress, setProgress] = useState(0);
  const [narrow, setNarrow] = useState(false);
  const [touch, setTouch] = useState(false);

  const live = useRef<Live>({ selected, hover, exploded, spin });
  useEffect(() => {
    live.current = { selected, hover, exploded, spin };
  }, [selected, hover, exploded, spin]);

  const select = useCallback((id: AnatomyPartId | null) => {
    scene.current?.settle();
    setSelected(id);
    if (id) setExploded(true); // a part can only be shown with the car apart
  }, []);

  const step = useCallback(
    (d: 1 | -1) => {
      const n = ANATOMY_PARTS.length;
      const i = ANATOMY_PARTS.findIndex((p) => p.id === selected);
      select(ANATOMY_PARTS[i < 0 ? (d > 0 ? 0 : n - 1) : (i + d + n) % n].id);
    },
    [selected, select],
  );

  useEffect(() => {
    if (!root.current || !canvas.current) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) setSpin(false);
    if (window.matchMedia("(pointer: coarse)").matches) setTouch(true);
    const handle = createScene(
      root.current,
      canvas.current,
      live,
      {
        onPick: (id) => select(id),
        onHover: setHover,
        onIntro: () => setExploded(true),
        onProgress: setProgress,
        onReady: () => setStatus("ready"),
        onError: () => setStatus("failed"),
        onNarrow: setNarrow,
        onTouch: () => setTouch(true),
      },
      reduceMotion,
    );
    scene.current = handle;
    if (!handle) setStatus("failed");
    return () => {
      handle?.dispose();
      scene.current = null;
    };
  }, [select]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === "Escape") select(null);
      else if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [select, step]);

  const n = ANATOMY_PARTS.length;
  const index = ANATOMY_PARTS.findIndex((p) => p.id === selected);
  const current = index >= 0 ? ANATOMY_PARTS[index] : null;

  return (
    <div ref={root} className="ana-root" data-state={status}>
      <canvas
        ref={canvas}
        role="img"
        aria-label="An exploded prototype-class race car, each system tagged with the sim hardware that stands in for it"
      />

      {status === "loading" && (
        <div className="ana-center">
          <Eyebrow>Loading the model{progress > 0 ? ` · ${progress}%` : ""}</Eyebrow>
          <div className="ana-bar">
            <span style={{ width: `${progress}%` }} />
          </div>
        </div>
      )}
      {status === "failed" && (
        /* A failure is a finding. The parts list below still works without the
           model, so it says that too rather than leaving a dark box. */
        <div className="ana-center" style={{ maxWidth: 420, textAlign: "center" }}>
          <div style={{ font: "500 14px var(--font-heading)", color: CH.loss }}>
            The 3D model could not be loaded.
          </div>
          <div style={{ fontSize: 12, lineHeight: 1.6, color: dim(55) }}>
            The parts are still listed along the bottom, and each one opens its notes without it.
          </div>
        </div>
      )}

      <div className="ana-tags">
        {ANATOMY_PARTS.map((p, i) => {
          const hi = p.id === selected || p.id === hover;
          return (
            <div key={p.id} data-label-id={p.id} className="ana-label">
              <span className="ana-dot" />
              <span className="ana-lead" />
              <button
                type="button"
                className="ana-tag"
                data-hi={hi}
                onClick={() => select(p.id === selected ? null : p.id)}
                onMouseEnter={() => setHover(p.id)}
                onMouseLeave={() => setHover(null)}
              >
                <span className="ana-n">{partNumber(i)}</span>
                <span className="ana-t">{p.short}</span>
              </button>
            </div>
          );
        })}
      </div>

      <div className="ana-ui">
        <div className="ana-top">
          <div data-avoid className="ana-intro">
            <Eyebrow color={CH.a}>Prototype-class racer, exploded</Eyebrow>
            {!narrow && (
              <p>
                The systems of a hybrid prototype racer, mapped to the rig hardware that recreates each
                one at home. Click any part.
              </p>
            )}
          </div>
          <div data-avoid className="ana-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                scene.current?.settle();
                setExploded(!exploded);
                if (exploded) setSelected(null);
              }}
            >
              {exploded ? "Assemble" : "Explode"}
            </button>
            <button type="button" className="btn btn-secondary" aria-pressed={spin} onClick={() => setSpin(!spin)}>
              {spin ? "Rotate · on" : "Rotate · off"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => {
                scene.current?.resetView();
                select(null);
              }}
            >
              Reset view
            </button>
          </div>
        </div>

        <div className="ana-mid" data-narrow={narrow}>
          {current && (
            <aside data-panel className="ana-panel scrollpane" aria-label={current.name}>
              <header>
                <Eyebrow>
                  Component {partNumber(index)} / {partNumber(n - 1)}
                </Eyebrow>
                <button type="button" className="pk" aria-label="Close" onClick={() => select(null)}>
                  <X size={15} strokeWidth={1.7} />
                </button>
              </header>
              <div className="ana-body">
                <Eyebrow color={CH.a}>On the car: {current.car}</Eyebrow>
                <h2>{current.name}</h2>
                <p>{current.desc}</p>
              </div>
              <dl>
                {current.specs.map(([k, val]) => (
                  <div key={k}>
                    <dt>{k}</dt>
                    <dd>{val}</dd>
                  </div>
                ))}
              </dl>
              <Caveat style={{ margin: 0, padding: "var(--space-3) var(--space-4)" }}>
                General reference for this kind of hardware, the same for every driver. Nothing here is
                read from your rig or from a session, and the car is an original drawing, not any
                maker&apos;s.
              </Caveat>
              <footer>
                <button type="button" className="pk" onClick={() => step(-1)}>
                  ← {ANATOMY_PARTS[(index - 1 + n) % n].short}
                </button>
                <button type="button" className="pk" onClick={() => step(1)}>
                  {ANATOMY_PARTS[(index + 1) % n].short} →
                </button>
              </footer>
            </aside>
          )}
        </div>

        {!(narrow && current) && (
          <div className="ana-bottom">
            <div data-chips className="ana-chips" data-narrow={narrow}>
              {ANATOMY_PARTS.map((p, i) => (
                <button
                  key={p.id}
                  type="button"
                  className="ana-chip"
                  data-on={p.id === selected}
                  data-hi={p.id === selected || p.id === hover}
                  aria-pressed={p.id === selected}
                  onClick={() => select(p.id === selected ? null : p.id)}
                  onMouseEnter={() => setHover(p.id)}
                  onMouseLeave={() => setHover(null)}
                >
                  <span className="ana-n">{partNumber(i)}</span>
                  <span className="ana-t">{p.short}</span>
                </button>
              ))}
            </div>
            <Eyebrow>
              {touch
                ? "Drag to orbit · pinch to zoom · tap a part"
                : "Drag to orbit · scroll to zoom · ← → to step"}
            </Eyebrow>
          </div>
        )}
      </div>
    </div>
  );
}
