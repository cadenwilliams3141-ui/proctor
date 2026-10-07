"use client";

/* The rig, drawn in 3D.
 *
 * WHAT THIS IS. A generic sim rig — frame and seat, three screens, wheelbase,
 * rim, pedals, shifter, handbrake — with one node per mounting slot, loaded
 * from public/rig/proctor_rig.glb. You can orbit it, sit in it, and click a
 * part to select its slot.
 *
 * WHAT THIS IS NOT. It is not the driver's rig and it reads nothing from a
 * session. Three things in here could be mistaken for data, so each is said
 * out loud where it is made:
 *
 *   - the model is one fixed drawing, the same for everyone
 *   - the picture on the screens is a procedural road, not a replay
 *   - the wheel's display shows an em dash, this app's mark for "not measured"
 *
 * WHY IT IS IMPERATIVE. three.js owns the canvas, and the captions and the
 * selection ring are repositioned every frame. Routing that through React state
 * would re-render the screen sixty times a second (see the note at the top of
 * lib/proctor/store.tsx), so the scene writes transforms straight to the DOM
 * nodes it is handed and React only owns what changes on a click.
 *
 * This file is the only importer of three.js, and the Rig screen loads it with
 * next/dynamic, so none of it is in the bundle of a driver who never opens the
 * screen. */

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { RectAreaLightUniformsLib } from "three/addons/lights/RectAreaLightUniformsLib.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { CH, INK } from "@/lib/proctor/channels";
import {
  RIG_EYE_NODE,
  RIG_FLOOR_SHADOW_URL,
  RIG_MODEL_URL,
  RIG_POSTER_URL,
  RIG_SLOTS,
  fitDistance,
  placeCaptions,
  pullBack,
  type CaptionPoint,
  type RigSlotKey,
} from "@/lib/proctor/rig";

type View = "orbit" | "seat";
type Status = "loading" | "live" | "failed";

interface SceneHandle {
  select(key: RigSlotKey | null, fly: boolean): void;
  setView(view: View): void;
  home(): void;
  dispose(): void;
}

interface SceneNodes {
  stage: HTMLDivElement;
  canvas: HTMLCanvasElement;
  ring: HTMLDivElement;
  captions: Partial<Record<RigSlotKey, HTMLButtonElement>>;
}

interface SceneOptions {
  reduceMotion: boolean;
  onPick: (key: RigSlotKey) => void;
  onStatus: (status: Status) => void;
}

/* ── Composition ───────────────────────────────────────────────────────────
   Camera positions, in the model's axes: x to the driver's right, y up, and
   the driver faces -z. These place a camera; none of them is a reading. */

const HOME = { pos: [-2.05, 1.8, 2.35], target: [0, 0.66, -0.42], fov: 30 } as const;
const SEAT = { look: [0, 0.97, -0.6], fov: 64 } as const;
const FALLBACK_EYE = [0, 1.1, 0.02] as const;

/** Which side to look at a slot from. A slot without one is shown from home. */
const VANTAGE: Partial<Record<RigSlotKey, readonly [number, number, number]>> = {
  wheelbase: [-0.95, 0.62, -0.55],
  rim: [-0.45, 0.42, 1.0],
  pedals: [0.55, 0.62, -1.0],
  shifter: [0.9, 0.45, 0.9],
  handbrake: [-0.9, 0.45, 0.9],
};

/** How much of the room each material reflects, by its name in the model. */
const REFLECT: Record<string, number> = {
  chrome: 0.6, steel_brushed: 0.32, alu_raw: 0.4, bolt: 0.4, anodized: 0.6, carbon: 0.45,
  seat_shell: 0.28, seat_bolster: 0.3, alu_black: 0.5, steel_black: 0.45, plastic: 0.4,
  bezel: 0.35, seat_fabric: 0.15, suede: 0.12, rubber: 0.2, grip_tape: 0.1,
};

const vec = (p: readonly [number, number, number]) => new THREE.Vector3(p[0], p[1], p[2]);

/** A palette hex as display-referred 0..1, for a shader that writes straight to
 *  the screen. */
function srgb(hex: string, gain = 1): THREE.Vector3 {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255).multiplyScalar(gain);
}

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function radialTexture(stops: [number, string][], inner = 0): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 256;
  const g = c.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(128, 128, inner * 128, 128, 128, 128);
    stops.forEach(([at, colour]) => grad.addColorStop(at, colour));
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
  }
  return new THREE.CanvasTexture(c);
}

/* The wheel's display. It shows an em dash because that is what this app
   renders for a figure it has not measured. A gear number here would be a
   literal describing a session nobody loaded. */
function dashTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = 232;
  c.height = 112;
  const g = c.getContext("2d");
  if (g) {
    g.fillStyle = INK.bg;
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = CH.a;
    g.font = "500 80px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("—", c.width / 2, c.height / 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.flipY = false;
  return t;
}

/* What the three screens show: a road at dusk, in the app's own palette.
 *
 * It is not a texture. Each pixel is shaded along the ray from the driver's eye
 * point through that spot on the glass, which is what makes the horizon level
 * and the road continuous across three panels turned at different angles. It is
 * decoration, and the screen that hosts this says so. */
function screenMaterial(eye: THREE.Vector3): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uEye: { value: eye },
      uTime: { value: 0 },
      uSteer: { value: 0 },
      cTop: { value: srgb(INK.bg) },
      cMid: { value: srgb(INK.accent800) },
      cAccent: { value: srgb(INK.accent) },
      cWarm: { value: srgb(CH.b) },
      cHill: { value: srgb(INK.accent900) },
      cGround: { value: srgb(INK.bg, 0.9) },
      cGrid: { value: srgb(INK.accent2_700) },
      cRoad: { value: srgb(INK.surface, 1.25) },
      cKerb: { value: srgb(CH.loss) },
      cPaint: { value: srgb(INK.text) },
    },
    vertexShader: /* glsl */ `
      varying vec3 vW;
      void main() {
        vec4 w = modelMatrix * vec4(position, 1.0);
        vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uEye; uniform float uTime; uniform float uSteer;
      uniform vec3 cTop, cMid, cAccent, cWarm, cHill, cGround, cGrid, cRoad, cKerb, cPaint;
      varying vec3 vW;

      vec3 sky(float el, float az) {
        vec3 c = mix(cMid, cTop, smoothstep(0.0, 0.5, el));
        c = mix(c, cAccent, 0.42 * exp(-el * 5.0));
        c += cWarm * 0.62 * exp(-el * 16.0) * (0.45 + 0.55 * cos(az * 0.8));
        return c;
      }

      void main() {
        vec3 d = normalize(vW - uEye);
        float az = atan(d.x, -d.z);
        float el = d.y / max(length(d.xz), 1e-4);
        vec3 col = sky(max(el, 0.0), az);

        float ridge = 0.030 + 0.020 * sin(az * 3.0 + 1.3) + 0.011 * sin(az * 7.0 + 0.4) + 0.005 * sin(az * 17.0 + 2.1);
        col = mix(col, cHill, (1.0 - smoothstep(ridge - 0.004, ridge + 0.004, el)) * 0.9);

        if (el < 0.0) {
          float dist = 1.02 / -el;
          vec2 p = normalize(d.xz) * dist;
          float fwd = -p.y;
          float s = fwd + uTime * 42.0;
          float x = p.x - uSteer * fwd * fwd * 0.0011;
          float aw = 0.02 + dist * 0.014;
          float fade = smoothstep(50.0, 150.0, dist);
          float road = 1.0 - smoothstep(5.0 - aw, 5.0 + aw, abs(x));
          float kerb = (1.0 - smoothstep(5.9 - aw, 5.9 + aw, abs(x))) * (1.0 - road);
          vec3 kc = mix(cKerb, cPaint, mix(step(0.5, fract(s / 4.0)), 0.5, fade));
          float edge = 1.0 - smoothstep(0.09, 0.09 + aw, abs(abs(x) - 4.6));
          float dash = (1.0 - smoothstep(0.07, 0.07 + aw, abs(x))) * step(fract(s / 12.0), 0.42) * (1.0 - fade);
          float grid = (1.0 - smoothstep(0.0, 0.5, abs(fract(s / 8.0) - 0.5) * 8.0 / (1.0 + dist * 0.2))) * (1.0 - fade) * 0.25;
          vec3 g = mix(cGround, cGrid, grid * (1.0 - road));
          g = mix(g, kc, kerb);
          g = mix(g, cRoad, road);
          g = mix(g, cPaint * 0.88, max(edge, dash) * road * 0.85);
          col = mix(g, sky(0.0, az), 1.0 - exp(-dist * 0.011));
        }
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
}

interface Slot {
  key: RigSlotKey;
  root: THREE.Object3D;
  meshes: THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>[];
  box: THREE.Box3;
  center: THREE.Vector3;
  radius: number;
  anchor: THREE.Vector3;
  hover: number;
  shown: number;
}

/* Where a slot's caption sits. Over the top of the part for most; over the
   middle screen for the monitors, whose bounding box spans all three; and at
   the rear of the base for the frame, whose top is the screen stand. */
function captionAnchor(key: RigSlotKey, box: THREE.Box3, center: THREE.Vector3): THREE.Vector3 {
  if (key === "frame") return new THREE.Vector3(center.x, box.min.y + 0.22, box.max.z + 0.02);
  if (key === "monitors") return new THREE.Vector3(center.x, box.max.y + 0.04, box.min.z + 0.15);
  return new THREE.Vector3(center.x, box.max.y + 0.03, center.z);
}

function createScene(nodes: SceneNodes, opts: SceneOptions): SceneHandle | null {
  const { stage, canvas, ring, captions } = nodes;
  const { reduceMotion } = opts;

  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  } catch {
    return null;
  }

  const listeners = new AbortController();
  const on = { signal: listeners.signal };
  let dead = false;

  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.45;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(INK.bg);
  const camera = new THREE.PerspectiveCamera(HOME.fov, 1.6, 0.03, 60);

  /* The room every surface reflects. It is handed to each material as its own
     envMap rather than set as scene.environment, because three only honours a
     material's envMapIntensity for a map the material owns — and black
     anodising, brushed steel and seat fabric must not all mirror the room by
     the same amount. */
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = pmrem.fromScene(new RoomEnvironment(), 0.04);
  RectAreaLightUniformsLib.init();

  /* ── Light ────────────────────────────────────────────────────────────── */
  const key = new THREE.DirectionalLight(INK.text, 4.6);
  key.position.set(-2.4, 3.8, 2.6);
  key.target.position.set(0, 0.5, -0.4);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -1.9, right: 1.9, top: 1.9, bottom: -1.9, near: 0.5, far: 9 });
  key.shadow.camera.updateProjectionMatrix();
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 3;
  const fill = new THREE.DirectionalLight(INK.accent, 2.0);
  fill.position.set(2.8, 1.6, 1.2);
  const back = new THREE.DirectionalLight(INK.text, 1.6);
  back.position.set(0.6, 2.6, -3.2);
  scene.add(key, key.target, fill, back, new THREE.HemisphereLight(INK.neutral500, INK.bg, 1.3));

  /* ── Floor: fades into the page, with a baked contact shadow under the rig ── */
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(7, 72),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(INK.surface).lerp(new THREE.Color(INK.neutral800), 0.4),
      roughness: 0.85,
      metalness: 0,
      transparent: true,
      depthWrite: false,
      // Grey levels, not colours: this is the mask that fades the floor out.
      alphaMap: radialTexture([[0, "#fff"], [0.55, "#666"], [1, "#000"]], 0.25),
      envMap: room.texture,
      envMapIntensity: 0.06,
    }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0, -0.45);
  floor.receiveShadow = true;
  scene.add(floor);

  const shadowMap = new THREE.Texture();
  const contact = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { map: { value: shadowMap }, lit: { value: 0.9 }, k: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D map; uniform float lit; uniform float k; varying vec2 vUv;
      void main() {
        float a = clamp((lit - texture2D(map, vUv).r) / lit, 0.0, 1.0);
        a *= 1.0 - smoothstep(0.34, 0.5, max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)));
        gl_FragColor = vec4(0.02, 0.02, 0.05, a * k);
      }`,
  });
  const contactPlane = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), contact);
  contactPlane.rotation.x = -Math.PI / 2;
  contactPlane.position.set(0, 0.002, -0.45);
  contactPlane.renderOrder = 1;
  scene.add(contactPlane);

  const shadowImg = new Image();
  shadowImg.onload = () => {
    if (dead) return;
    try {
      // The open floor's own grey is the "no shadow" level.
      const c = document.createElement("canvas");
      c.width = c.height = 8;
      const g = c.getContext("2d");
      if (g) {
        g.drawImage(shadowImg, 0, 0, 8, 8);
        contact.uniforms.lit.value = Math.max(0.5, g.getImageData(0, 0, 1, 1).data[0] / 255 - 0.02);
      }
    } catch {
      /* keep the default level */
    }
    shadowMap.image = shadowImg;
    shadowMap.needsUpdate = true;
    contact.uniforms.k.value = 0.85;
    dirty = true;
  };
  shadowImg.src = RIG_FLOOR_SHADOW_URL;

  const glowMap = radialTexture([
    [0, rgba(INK.accent, 0.55)],
    [0.5, rgba(INK.accent, 0.16)],
    [1, rgba(INK.accent, 0)],
  ]);
  glowMap.colorSpace = THREE.SRGBColorSpace;
  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: glowMap, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.3 }),
  );
  glow.position.set(0, 1.05, -1.05);
  glow.scale.set(4.4, 2.3, 1);
  scene.add(glow);

  const eye = vec(FALLBACK_EYE);
  const screens = screenMaterial(eye);
  const dash = new THREE.MeshBasicMaterial({ map: dashTexture(), toneMapped: false });
  const hoverTint = new THREE.Color(CH.a);

  /* ── Slots ────────────────────────────────────────────────────────────── */
  const slots: Partial<Record<RigSlotKey, Slot>> = {};
  const pickables: THREE.Object3D[] = [];
  let selected: RigSlotKey | null = null;
  let hover: RigSlotKey | null = null;
  let ready = false;
  let rim: { root: THREE.Object3D; rest: THREE.Quaternion } | null = null;

  /* Each screen lights the cockpit with a rectangle of its own size, placed and
     aimed from the screen's own triangles so it follows the model. */
  function screenLights(mesh: THREE.Mesh) {
    const g = mesh.geometry;
    const pos = g.attributes.position;
    const uv = g.attributes.uv;
    const idx = g.index;
    if (!uv) return;
    const acc = [0, 1, 2].map(() => ({ c: new THREE.Vector3(), n: new THREE.Vector3(), a: 0 }));
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const c = new THREE.Vector3();
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const i0 = idx ? idx.getX(i) : i;
      const i1 = idx ? idx.getX(i + 1) : i + 1;
      const i2 = idx ? idx.getX(i + 2) : i + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(mesh.matrixWorld);
      b.fromBufferAttribute(pos, i1).applyMatrix4(mesh.matrixWorld);
      c.fromBufferAttribute(pos, i2).applyMatrix4(mesh.matrixWorld);
      const which = Math.max(0, Math.min(2, Math.floor(((uv.getX(i0) + uv.getX(i1) + uv.getX(i2)) / 3) * 3)));
      const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a));
      const area = n.length() / 2;
      acc[which].c.addScaledVector(a.clone().add(b).add(c).multiplyScalar(1 / 3), area);
      acc[which].n.add(n);
      acc[which].a += area;
    }
    const size = new THREE.Vector3();
    new THREE.Box3().setFromObject(mesh).getSize(size);
    for (const s of acc) {
      if (!s.a) continue;
      s.c.multiplyScalar(1 / s.a);
      s.n.normalize();
      // area / height = width: the light is the size of the screen it stands for
      const light = new THREE.RectAreaLight(INK.accent, 5, s.a / size.y, size.y);
      light.position.copy(s.c).addScaledVector(s.n, 0.03);
      light.lookAt(s.c.clone().addScaledVector(s.n, 1));
      scene.add(light);
    }
  }

  new GLTFLoader().load(
    RIG_MODEL_URL,
    (gltf) => {
      if (dead) return;
      const model = gltf.scene;
      scene.add(model);
      model.updateMatrixWorld(true);
      model.getObjectByName(RIG_EYE_NODE)?.getWorldPosition(eye);

      for (const def of RIG_SLOTS) {
        const root = model.getObjectByName(def.node);
        if (!root) continue;
        const meshes: Slot["meshes"] = [];
        root.traverse((o) => {
          const mesh = o as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>;
          if (!mesh.isMesh) return;
          const name = mesh.material.name;
          if (name === "screen") {
            (mesh as THREE.Mesh).material = screens;
            screenLights(mesh);
          } else if (name === "dash_screen") {
            (mesh as THREE.Mesh).material = dash;
          } else {
            mesh.material = mesh.material.clone();
            mesh.material.envMap = room.texture;
            mesh.material.envMapIntensity = REFLECT[name] ?? 0.55;
            if (name === "seat_accent") mesh.material.color.multiplyScalar(0.5);
            mesh.userData.rest = mesh.material.emissive.clone();
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            meshes.push(mesh);
          }
          mesh.userData.slot = def.key;
          pickables.push(mesh);
        });
        const box = new THREE.Box3().setFromObject(root);
        const center = box.getCenter(new THREE.Vector3());
        slots[def.key] = {
          key: def.key, root, meshes, box, center,
          radius: box.getSize(new THREE.Vector3()).length() / 2,
          anchor: captionAnchor(def.key, box, center),
          hover: 0, shown: -1,
        };
      }
      if (slots.rim) rim = { root: slots.rim.root, rest: slots.rim.root.quaternion.clone() };

      ready = true;
      resize();
      goHome(0);
      opts.onStatus("live");
      start();
    },
    undefined,
    () => {
      if (!dead) opts.onStatus("failed");
    },
  );

  /* ── Camera ───────────────────────────────────────────────────────────── */
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableZoom = false; // wheel zoom only after a click, so the page still scrolls
  controls.minDistance = 0.7;
  controls.maxDistance = 6.5;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.7;
  controls.target.copy(vec(HOME.target));
  controls.addEventListener("change", () => { dirty = true; });
  controls.addEventListener("start", () => { atHome = false; });

  type Tween =
    | { kind: "fly"; t: number; ms: number; p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3; f0: number; f1: number; done?: () => void }
    | { kind: "turn"; t: number; ms: number; step: (e: number) => void };

  let mode: View = "orbit";
  let tween: Tween | null = null;
  let yaw = 0;
  let pitch = 0;
  let saved: { pos: THREE.Vector3; target: THREE.Vector3 } | null = null;
  let engaged = false;
  let atHome = false;
  let W = 1;
  let H = 1;
  let dirty = true;

  const homePos = () => {
    const target = vec(HOME.target);
    return target.clone().add(vec(HOME.pos).sub(target).multiplyScalar(pullBack(W / H)));
  };

  function fly(pos: THREE.Vector3, target: THREE.Vector3, fov: number, ms: number, done?: () => void) {
    tween = {
      kind: "fly", t: 0, ms: reduceMotion ? 0 : ms,
      p0: camera.position.clone(), p1: pos.clone(),
      t0: controls.target.clone(), t1: target.clone(),
      f0: camera.fov, f1: fov, done,
    };
    controls.enabled = false;
  }

  function goHome(ms: number) {
    fly(homePos(), vec(HOME.target), HOME.fov, ms);
    atHome = true;
  }

  /* From the seat, yaw is positive to the left and pitch positive up. */
  function seatLook() {
    const cp = Math.cos(pitch);
    controls.target.set(eye.x - Math.sin(yaw) * cp, eye.y + Math.sin(pitch), eye.z - Math.cos(yaw) * cp);
    camera.position.copy(eye);
    camera.lookAt(controls.target);
    dirty = true;
  }

  function aimAt(p: THREE.Vector3) {
    const d = p.clone().sub(eye).normalize();
    return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(Math.max(-1, Math.min(1, d.y))) };
  }

  function setView(v: View) {
    if (!ready || v === mode) return;
    if (v === "seat") {
      saved = atHome ? null : { pos: camera.position.clone(), target: controls.target.clone() };
      mode = "seat";
      const look = vec(SEAT.look);
      const a = aimAt(look);
      yaw = a.yaw;
      pitch = a.pitch;
      fly(eye, eye.clone().add(look.sub(eye).normalize()), SEAT.fov, 1100, seatLook);
    } else {
      mode = "orbit";
      if (saved) fly(saved.pos, saved.target, HOME.fov, 1100);
      else goHome(1100);
    }
  }

  function focus(k: RigSlotKey) {
    const s = slots[k];
    if (!ready || !s) return;
    if (mode === "seat") {
      const a = aimAt(s.center);
      const y0 = yaw;
      const p0 = pitch;
      const y1 = Math.max(-1.9, Math.min(1.9, a.yaw));
      const p1 = Math.max(-1.0, Math.min(0.5, a.pitch));
      tween = {
        kind: "turn", t: 0, ms: reduceMotion ? 0 : 700,
        step: (e) => { yaw = y0 + (y1 - y0) * e; pitch = p0 + (p1 - p0) * e; seatLook(); },
      };
      return;
    }
    const v = VANTAGE[k];
    if (!v) return goHome(900);
    atHome = false;
    const dist = Math.max(0.95, fitDistance(s.radius, HOME.fov, W / H));
    fly(s.center.clone().addScaledVector(vec(v).normalize(), dist), s.center, HOME.fov, 900);
  }

  /* ── Pointer: orbit, look around from the seat, hover and click a part ── */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down: { x: number; y: number; yaw: number; pitch: number } | null = null;
  let moved = false;
  let pendingHover: PointerEvent | null = null;

  function pick(ev: PointerEvent): RigSlotKey | null {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    return hit ? (hit.object.userData.slot as RigSlotKey) : null;
  }

  canvas.addEventListener("pointerdown", (ev) => {
    down = { x: ev.clientX, y: ev.clientY, yaw, pitch };
    moved = false;
    engaged = true;
    controls.enableZoom = true;
    if (mode === "seat") {
      try { canvas.setPointerCapture(ev.pointerId); } catch { /* fine without it */ }
    }
  }, on);
  canvas.addEventListener("pointermove", (ev) => {
    if (down) {
      const dx = ev.clientX - down.x;
      const dy = ev.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
      if (mode === "seat" && !tween) {
        yaw = Math.max(-1.9, Math.min(1.9, down.yaw + dx * 0.0034));
        pitch = Math.max(-1.0, Math.min(0.5, down.pitch + dy * 0.0034));
        seatLook();
      }
      return;
    }
    pendingHover = ev;
  }, on);
  canvas.addEventListener("pointerup", (ev) => {
    if (down && !moved) {
      const k = pick(ev);
      if (k) opts.onPick(k);
    }
    down = null;
  }, on);
  canvas.addEventListener("pointercancel", () => { down = null; }, on);
  canvas.addEventListener("pointerleave", () => {
    pendingHover = null;
    engaged = false;
    controls.enableZoom = false;
    if (hover) {
      hover = null;
      canvas.dataset.hot = "false";
      dirty = true;
    }
  }, on);
  canvas.addEventListener("wheel", (ev) => {
    if (mode !== "seat" || !engaged) return;
    ev.preventDefault();
    camera.fov = Math.max(38, Math.min(80, camera.fov + ev.deltaY * 0.03));
    camera.updateProjectionMatrix();
    dirty = true;
  }, { passive: false, signal: listeners.signal });
  canvas.addEventListener("dblclick", () => { if (mode === "orbit") goHome(900); }, on);

  /* ── Captions and the dashed ring round the selected slot ─────────────── */
  const v3 = new THREE.Vector3();
  function toStage(p: THREE.Vector3): { x: number; y: number } | null {
    v3.copy(p).applyMatrix4(camera.matrixWorldInverse);
    if (v3.z > -0.05) return null; // behind the camera
    v3.applyMatrix4(camera.projectionMatrix);
    return { x: (v3.x * 0.5 + 0.5) * W, y: (-v3.y * 0.5 + 0.5) * H };
  }

  function layout() {
    const at: Partial<Record<RigSlotKey, { x: number; y: number }>> = {};
    const points: CaptionPoint<RigSlotKey>[] = [];
    for (const def of RIG_SLOTS) {
      const s = slots[def.key];
      const p = s && toStage(s.anchor);
      if (!p) continue;
      at[def.key] = p;
      points.push({ key: def.key, x: p.x, y: p.y, rank: def.key === selected ? 1 : 0 });
    }
    const shown = placeCaptions(points, W, H);
    for (const def of RIG_SLOTS) {
      const el = captions[def.key];
      if (!el) continue;
      const p = at[def.key];
      const visible = !!p && shown.has(def.key);
      el.dataset.off = String(!visible);
      if (visible && p) {
        el.style.transform = `translate(${p.x.toFixed(1)}px,${p.y.toFixed(1)}px) translate(-50%,-100%)`;
      }
    }

    const s = selected ? slots[selected] : undefined;
    let show = false;
    if (s) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      let whole = true;
      for (let i = 0; i < 8 && whole; i++) {
        const p = toStage(new THREE.Vector3(
          i & 1 ? s.box.max.x : s.box.min.x,
          i & 2 ? s.box.max.y : s.box.min.y,
          i & 4 ? s.box.max.z : s.box.min.z,
        ));
        if (!p) { whole = false; break; }
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
      if (whole) {
        x0 = Math.max(5, x0 - 8); y0 = Math.max(5, y0 - 8); x1 = Math.min(W - 5, x1 + 8); y1 = Math.min(H - 5, y1 + 8);
        if (x1 - x0 > 12 && y1 - y0 > 12) {
          show = true;
          ring.style.transform = `translate(${x0.toFixed(1)}px,${y0.toFixed(1)}px)`;
          ring.style.width = `${(x1 - x0).toFixed(1)}px`;
          ring.style.height = `${(y1 - y0).toFixed(1)}px`;
        }
      }
    }
    ring.style.opacity = show ? "1" : "0";
  }

  /* ── Frame loop ───────────────────────────────────────────────────────── */
  let time = 0;
  let last = 0;
  let running = false;
  let onScreen = true;
  const spin = new THREE.Quaternion();
  const axis = new THREE.Vector3(0, 0, 1);

  function resize() {
    const r = stage.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    W = r.width;
    H = r.height;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    if (ready && atHome && mode === "orbit") goHome(0);
    dirty = true;
  }

  function frame(now: number) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    if (!reduceMotion) {
      time += dt;
      dirty = true;
    }

    if (tween) {
      const tw = tween;
      tw.t = tw.ms ? Math.min(1, tw.t + (dt * 1000) / tw.ms) : 1;
      const e = 1 - Math.pow(1 - tw.t, 3);
      if (tw.kind === "turn") {
        tw.step(e);
        if (tw.t >= 1) tween = null;
      } else {
        camera.position.lerpVectors(tw.p0, tw.p1, e);
        controls.target.lerpVectors(tw.t0, tw.t1, e);
        camera.fov = tw.f0 + (tw.f1 - tw.f0) * e;
        camera.updateProjectionMatrix();
        camera.lookAt(controls.target);
        dirty = true;
        if (tw.t >= 1) {
          tween = null;
          controls.enabled = mode === "orbit";
          tw.done?.();
        }
      }
    } else if (mode === "orbit") {
      controls.update();
    }

    if (pendingHover && !down) {
      const k = pick(pendingHover);
      pendingHover = null;
      if (k !== hover) {
        hover = k;
        canvas.dataset.hot = String(!!k);
        dirty = true;
      }
    }
    for (const def of RIG_SLOTS) {
      const s = slots[def.key];
      if (!s) continue;
      const want = hover === s.key ? 1 : 0;
      if (Math.abs(want - s.hover) > 0.002) {
        s.hover += (want - s.hover) * Math.min(1, dt * 12);
        dirty = true;
      }
      if (s.shown !== s.hover) {
        s.shown = s.hover;
        for (const m of s.meshes) m.material.emissive.copy(m.userData.rest as THREE.Color).lerp(hoverTint, 0.03 * s.hover);
      }
    }

    if (!dirty) return;
    dirty = false;
    const steer = Math.sin(time * 0.23) * 0.7 + Math.sin(time * 0.61 + 1.0) * 0.3;
    screens.uniforms.uTime.value = time;
    screens.uniforms.uSteer.value = steer;
    if (rim) rim.root.quaternion.copy(rim.rest).multiply(spin.setFromAxisAngle(axis, -steer * 0.3));
    glow.material.opacity = 0.22 + 0.1 * Math.sin(time * 1.05);
    renderer.render(scene, camera);
    layout();
  }

  function start() {
    const want = ready && onScreen && !document.hidden && !dead;
    if (want && !running) {
      running = true;
      last = performance.now();
      dirty = true;
      requestAnimationFrame(frame);
    } else if (!want) {
      running = false;
    }
  }

  const sizeWatch = new ResizeObserver(() => { resize(); start(); });
  sizeWatch.observe(stage);
  const viewWatch = new IntersectionObserver((entries) => {
    onScreen = entries[0]?.isIntersecting ?? true;
    start();
  });
  viewWatch.observe(stage);
  document.addEventListener("visibilitychange", start, on);

  return {
    select(k, flyThere) {
      const changed = k !== selected;
      selected = k;
      dirty = true;
      if (k && changed && flyThere) focus(k);
    },
    setView,
    home() {
      if (ready && mode === "orbit") goHome(900);
    },
    dispose() {
      dead = true;
      running = false;
      listeners.abort();
      sizeWatch.disconnect();
      viewWatch.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        mesh.geometry.dispose();
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) m.dispose();
      });
      for (const t of [glowMap, shadowMap, dash.map, floor.material.alphaMap]) t?.dispose();
      room.dispose();
      pmrem.dispose();
      renderer.dispose();
    },
  };
}

const NOTE: Record<Status, string> = {
  loading: "loading the model",
  live: "drag to look around · click a part",
  failed: "The 3D view could not start in this browser, so this is a rendered still of the same model.",
};

export default function RigScene({
  selected,
  onSelect,
}: {
  selected: RigSlotKey | null;
  onSelect: (key: RigSlotKey) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  const captions = useRef<Partial<Record<RigSlotKey, HTMLButtonElement>>>({});
  const handle = useRef<SceneHandle | null>(null);
  const pick = useRef(onSelect);
  const [status, setStatus] = useState<Status>("loading");
  const [view, setView] = useState<View>("orbit");

  useEffect(() => {
    pick.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    if (!stage.current || !canvas.current || !ring.current) return;
    const scene = createScene(
      { stage: stage.current, canvas: canvas.current, ring: ring.current, captions: captions.current },
      {
        reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
        onPick: (k) => pick.current(k),
        onStatus: setStatus,
      },
    );
    handle.current = scene;
    if (!scene) setStatus("failed");
    return () => {
      scene?.dispose();
      handle.current = null;
    };
  }, []);

  useEffect(() => {
    handle.current?.select(selected, true);
  }, [selected, status]);

  useEffect(() => {
    handle.current?.setView(view);
  }, [view, status]);

  return (
    <div ref={stage} className="rig-stage" data-state={status}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="rig-poster" alt="" src={RIG_POSTER_URL} />
      <canvas ref={canvas} role="img" aria-label="3D view of a generic sim rig and its seven mounting slots" />

      <div className="rig-overlay">
        <div ref={ring} className="rig-ring" />
        {RIG_SLOTS.map((s) => (
          <button
            key={s.key}
            type="button"
            className="rig-lbl"
            data-off="true"
            data-sel={selected === s.key}
            ref={(el) => {
              if (el) captions.current[s.key] = el;
              else delete captions.current[s.key];
            }}
            onClick={() => onSelect(s.key)}
          >
            {s.label}
          </button>
        ))}
      </div>

      <div className="rig-hud">
        <div className="seg" role="group" aria-label="Camera">
          <button
            type="button"
            className="seg-opt"
            data-active={view === "orbit"}
            onClick={() => (view === "orbit" ? handle.current?.home() : setView("orbit"))}
          >
            Orbit
          </button>
          <button
            type="button"
            className="seg-opt"
            data-active={view === "seat"}
            onClick={() => setView("seat")}
          >
            Driver&apos;s seat
          </button>
        </div>
      </div>

      <span className="rig-note">
        {status === "live" && view === "seat" ? "drag to look around" : NOTE[status]}
      </span>
    </div>
  );
}
