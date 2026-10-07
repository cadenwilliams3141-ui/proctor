/* ═════════════════════════════════════════════════════════════════════════
   rig3d — the 3D scene. The page script above stays the source of truth for
   what is mounted and what is selected; this only draws it and reports clicks
   through window.__rig.choose(slot).

   The model is one GLB with a node per slot (slot_frame, slot_monitors, …),
   built by blender/build_rig.py. Generic look-alike parts, real proportions.
   ═════════════════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const stage = document.getElementById("stage");
  if (!stage) return;
  const canvas = document.getElementById("rigCanvas");
  const overlay = document.getElementById("stageOverlay");
  const ring = document.getElementById("ring3d");
  const plus = document.getElementById("plus3d");
  const note = document.getElementById("stageMsg");
  const viewBtns = Array.from(document.querySelectorAll("#viewSeg .seg-opt"));
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const page = window.__rig;

  function still(why) {
    stage.dataset.state = "static";
    note.textContent = why;
  }
  const FALLBACK = "The live 3D view is not available here, so this is a rendered still. The component list works as usual.";

  if (!window.THREE || !THREE.GLTFLoader || !THREE.OrbitControls || !page) return still(FALLBACK);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, powerPreference: "high-performance" });
  } catch (e) {
    return still(FALLBACK);
  }

  /* Blender builds the rig X right, Y forward, Z up; the GLB is X right, Y up, -Z forward. */
  const B = (x, y, z) => new THREE.Vector3(x, z, -y);
  const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();
  const ACCENT = lin(0xb5abfc);

  renderer.outputEncoding = THREE.sRGBEncoding;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.45;
  renderer.physicallyCorrectLights = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x161826);          /* --color-bg, drawn as-is */
  const camera = new THREE.PerspectiveCamera(30, 1.6, 0.03, 60);

  const pmrem = new THREE.PMREMGenerator(renderer);
  if (THREE.RoomEnvironment) scene.environment = pmrem.fromScene(new THREE.RoomEnvironment(), 0.04).texture;
  if (THREE.RectAreaLightUniformsLib) THREE.RectAreaLightUniformsLib.init();

  /* ── Light ──────────────────────────────────────────────────────────── */
  const key = new THREE.DirectionalLight(lin(0xfff4e6), 4.6);
  key.position.copy(B(-2.4, -2.6, 3.8));
  key.target.position.copy(B(0, 0.4, 0.5));
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -1.9, right: 1.9, top: 1.9, bottom: -1.9, near: 0.5, far: 9 });
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.012;
  key.shadow.radius = 3;
  const fill = new THREE.DirectionalLight(lin(0x9184d9), 2.0);
  fill.position.copy(B(2.8, -1.2, 1.6));
  const back = new THREE.DirectionalLight(lin(0xcfd3e5), 1.6);
  back.position.copy(B(0.6, 3.2, 2.6));
  scene.add(key, key.target, fill, back, new THREE.HemisphereLight(lin(0x9397ab), lin(0x161826), 1.3));

  /* ── Floor: fades into the page, with a baked contact shadow under the rig ── */
  function radial(inner, outer, stops) {
    const c = document.createElement("canvas");
    c.width = c.height = 256;
    const g = c.getContext("2d");
    const grad = g.createRadialGradient(128, 128, inner * 128, 128, 128, outer * 128);
    stops.forEach((s) => grad.addColorStop(s[0], s[1]));
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    return new THREE.CanvasTexture(c);
  }
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(7, 72),
    new THREE.MeshStandardMaterial({
      color: lin(0x2e3040), roughness: 0.85, metalness: 0, transparent: true, depthWrite: false,
      alphaMap: radial(0.25, 1, [[0, "#fff"], [0.55, "#666"], [1, "#000"]]),
    })
  );
  floor.material.envMapIntensity = 0.06;
  floor.rotation.x = -Math.PI / 2;
  floor.position.copy(B(0, 0.45, 0));
  floor.receiveShadow = true;
  scene.add(floor);

  const aoTex = new THREE.Texture();
  const aoMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { map: { value: aoTex }, lit: { value: 0.9 }, k: { value: 0.0 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: [
      "uniform sampler2D map; uniform float lit; uniform float k; varying vec2 vUv;",
      "void main(){",
      "  float a = clamp((lit - texture2D(map, vUv).r) / lit, 0.0, 1.0);",
      "  a *= smoothstep(0.5, 0.34, max(abs(vUv.x - 0.5), abs(vUv.y - 0.5)));",
      "  gl_FragColor = vec4(0.02, 0.02, 0.05, a * k);",
      "}",
    ].join("\n"),
  });
  const ao = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), aoMat);
  ao.rotation.x = -Math.PI / 2;
  ao.position.copy(B(0, 0.45, 0.002));
  ao.renderOrder = 1;
  scene.add(ao);
  const aoImg = new Image();
  aoImg.onload = function () {
    try {                                               /* the open floor's own grey is the "no shadow" level */
      const c = document.createElement("canvas");
      c.width = c.height = 8;
      const g = c.getContext("2d");
      g.drawImage(aoImg, 0, 0, 8, 8);
      aoMat.uniforms.lit.value = Math.max(0.5, g.getImageData(0, 0, 1, 1).data[0] / 255 - 0.02);
    } catch (e) { /* keep the default */ }
    aoTex.image = aoImg;
    aoTex.needsUpdate = true;
    aoMat.uniforms.k.value = 0.85;
    dirty = true;
  };
  aoImg.src = window.RIG_FLOOR_AO || "";

  /* soft glow behind the screens, the schematic's glowPulse */
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({
    map: radial(0, 1, [[0, "rgba(145,132,217,.55)"], [0.5, "rgba(145,132,217,.16)"], [1, "rgba(145,132,217,0)"]]),
    blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.4,
  }));
  glow.position.copy(B(0, 1.05, 1.05));
  glow.scale.set(4.4, 2.3, 1);
  scene.add(glow);

  /* ── What the screens show ──────────────────────────────────────────────
     Not a texture. Each pixel looks out from the driver's eye point through
     the glass, so the horizon stays level and the road stays continuous
     across all three panels, the way a correctly set field of view does. */
  const EYE = B(0, -0.02, 1.10);
  const screenMat = new THREE.ShaderMaterial({
    uniforms: { uEye: { value: EYE }, uTime: { value: 0 }, uSteer: { value: 0 } },
    vertexShader: "varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }",
    fragmentShader: [
      "precision highp float;",
      "uniform vec3 uEye; uniform float uTime; uniform float uSteer; varying vec3 vW;",
      "vec3 rgb(float r, float g, float b){ return vec3(r, g, b) / 255.0; }",
      "vec3 sky(float el, float az){",
      "  vec3 c = mix(rgb(66.0, 58.0, 106.0), rgb(22.0, 24.0, 38.0), smoothstep(0.0, 0.5, el));",
      "  c = mix(c, rgb(145.0, 132.0, 217.0), 0.42 * exp(-el * 5.0));",
      "  c += rgb(224.0, 168.0, 106.0) * 0.62 * exp(-el * 16.0) * (0.45 + 0.55 * cos(az * 0.8));",
      "  return c;",
      "}",
      "void main(){",
      "  vec3 d = normalize(vW - uEye);",
      "  float az = atan(d.x, -d.z);",
      "  float el = d.y / max(length(d.xz), 1e-4);",
      "  vec3 col = sky(max(el, 0.0), az);",
      "  float ridge = 0.030 + 0.020 * sin(az * 3.0 + 1.3) + 0.011 * sin(az * 7.0 + 0.4) + 0.005 * sin(az * 17.0 + 2.1);",
      "  col = mix(col, rgb(31.0, 29.0, 52.0), (1.0 - smoothstep(ridge - 0.004, ridge + 0.004, el)) * 0.9);",
      "  if (el < 0.0) {",
      "    float dist = 1.02 / -el;",
      "    vec2 p = normalize(d.xz) * dist;",
      "    float fwd = -p.y;",
      "    float s = fwd + uTime * 42.0;",
      "    float x = p.x - uSteer * fwd * fwd * 0.0011;",
      "    float aw = 0.02 + dist * 0.014;",
      "    float fade = smoothstep(50.0, 150.0, dist);",
      "    float road = 1.0 - smoothstep(5.0 - aw, 5.0 + aw, abs(x));",
      "    float kerb = (1.0 - smoothstep(5.9 - aw, 5.9 + aw, abs(x))) * (1.0 - road);",
      "    vec3 kc = mix(rgb(224.0, 104.0, 94.0), rgb(233.0, 233.0, 237.0), mix(step(0.5, fract(s / 4.0)), 0.5, fade));",
      "    float edge = 1.0 - smoothstep(0.09, 0.09 + aw, abs(abs(x) - 4.6));",
      "    float dash = (1.0 - smoothstep(0.07, 0.07 + aw, abs(x))) * step(fract(s / 12.0), 0.42) * (1.0 - fade);",
      "    float grid = (1.0 - smoothstep(0.0, 0.5, abs(fract(s / 8.0) - 0.5) * 8.0 / (1.0 + dist * 0.2))) * (1.0 - fade) * 0.25;",
      "    vec3 g = mix(rgb(20.0, 22.0, 34.0), rgb(93.0, 82.0, 148.0), grid * (1.0 - road));",
      "    g = mix(g, kc, kerb);",
      "    g = mix(g, rgb(44.0, 45.0, 52.0), road);",
      "    g = mix(g, rgb(207.0, 211.0, 229.0), max(edge, dash) * road * 0.85);",
      "    col = mix(g, sky(0.0, az), 1.0 - exp(-dist * 0.011));",
      "  }",
      "  gl_FragColor = vec4(col, 1.0);",
      "}",
    ].join("\n"),
  });

  function dashTexture() {
    const c = document.createElement("canvas");
    c.width = 232;
    c.height = 112;
    const g = c.getContext("2d");
    g.fillStyle = "#07070c";
    g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = "#b5abfc";
    g.font = "500 84px Inter, system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText("4", c.width / 2, c.height / 2 + 6);
    g.fillStyle = "rgba(233,233,237,.5)";
    g.font = "500 15px Inter, system-ui, sans-serif";
    g.textAlign = "left";
    g.fillText("GEAR", 12, 18);
    const t = new THREE.CanvasTexture(c);
    t.encoding = THREE.sRGBEncoding;
    t.flipY = false;
    return t;
  }
  const dashMat = new THREE.MeshBasicMaterial({ map: dashTexture(), toneMapped: false });

  /* ── Slots ──────────────────────────────────────────────────────────── */
  const KEYS = ["monitors", "wheelbase", "rim", "pedals", "shifter", "handbrake", "frame"];
  const ANCHOR = {                                   /* where a slot's caption sits */
    monitors: B(0, 0.62, 1.29), wheelbase: B(0, 0.70, 0.78), rim: B(0, 0.39, 0.87), pedals: B(0, 1.02, 0.52),
    shifter: B(0.335, 0.31, 0.74), handbrake: B(-0.335, 0.27, 0.74), frame: B(0, -0.32, 0.22),
  };
  const VANTAGE = {                                  /* which way to look at a slot from, Blender axes */
    wheelbase: [-0.95, 0.55, 0.62], rim: [-0.45, -1.0, 0.42], pedals: [0.55, 1.0, 0.62],
    shifter: [0.9, -0.9, 0.45], handbrake: [-0.9, -0.9, 0.45],
  };
  const ENV = { chrome: 0.9, steel_brushed: 0.5, alu_raw: 0.6, bolt: 0.6, anodized: 0.9, carbon: 0.8, seat_shell: 1.0,
                seat_bolster: 0.8, alu_black: 0.75, steel_black: 0.7, plastic: 0.7, bezel: 0.6, seat_fabric: 0.3,
                suede: 0.25, rubber: 0.35, grip_tape: 0.2 };
  const slots = {};
  const pickables = [];
  let selected = null, hover = null, pending = null, ready = false, rimBase = null;

  const ghostFill = new THREE.MeshBasicMaterial({ color: 0x9184d9, transparent: true, opacity: 0.16, depthWrite: false });
  const ghostLine = new THREE.LineDashedMaterial({ color: 0xb5abfc, dashSize: 0.012, gapSize: 0.009 });

  function setGhost(s, on) {
    if (s.ghost === on) return;
    s.ghost = on;
    s.meshes.forEach((m) => {
      if (on) {
        if (!m.userData.edges) {
          const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 32), ghostLine);
          e.computeLineDistances();
          m.userData.edges = e;
          m.add(e);
        }
        m.userData.real = m.material;
        m.material = ghostFill;
      } else if (m.userData.real) {
        m.material = m.userData.real;
      }
      if (m.userData.edges) m.userData.edges.visible = on;
      m.castShadow = !on;
    });
  }

  function screenLights(mesh) {
    const g = mesh.geometry, pos = g.attributes.position, uv = g.attributes.uv, idx = g.index;
    if (!uv || !THREE.RectAreaLightUniformsLib) return;
    const acc = [0, 1, 2].map(() => ({ c: new THREE.Vector3(), n: new THREE.Vector3(), a: 0 }));
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    const count = idx ? idx.count : pos.count;
    for (let i = 0; i < count; i += 3) {
      const i0 = idx ? idx.getX(i) : i, i1 = idx ? idx.getX(i + 1) : i + 1, i2 = idx ? idx.getX(i + 2) : i + 2;
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
    acc.forEach((s) => {
      if (!s.a) return;
      s.c.multiplyScalar(1 / s.a);
      s.n.normalize();
      const L = new THREE.RectAreaLight(lin(0x8a7fdc), 5, 0.8, 0.335);
      L.position.copy(s.c).addScaledVector(s.n, 0.03);
      L.lookAt(s.c.clone().addScaledVector(s.n, 1));
      scene.add(L);
    });
  }

  function onModel(gltf) {
    const model = gltf.scene;
    scene.add(model);
    model.updateMatrixWorld(true);
    const eye = model.getObjectByName("anchor_eye");
    if (eye) eye.getWorldPosition(EYE);
    KEYS.forEach((k) => {
      const root = model.getObjectByName("slot_" + k);
      if (!root) return;
      const meshes = [];
      root.traverse((o) => {
        if (!o.isMesh) return;
        const name = o.material.name;
        if (name === "screen") { o.material = screenMat; screenLights(o); }
        else if (name === "dash_screen") { o.material = dashMat; }
        else {
          o.material = o.material.clone();
          o.material.envMapIntensity = ENV[name] !== undefined ? ENV[name] : 0.55;
          if (name === "seat_accent") o.material.color.multiplyScalar(0.5);
          o.userData.base = o.material.emissive.clone();
          o.castShadow = true;
          o.receiveShadow = true;
          meshes.push(o);
        }
        o.userData.slot = k;
        pickables.push(o);
      });
      const box = new THREE.Box3().setFromObject(root);
      slots[k] = { key: k, root: root, meshes: meshes, box: box, center: box.getCenter(new THREE.Vector3()),
                   radius: box.getSize(new THREE.Vector3()).length() / 2, scale: root.scale.clone(),
                   hl: 0, shown: -1, pop: 1, ghost: false };
    });
    if (slots.rim) rimBase = slots.rim.root.quaternion.clone();
    ready = true;
    resize();
    goHome(0);
    const st = pending || page.state();
    api.sync(st.selected, st.rig);
    stage.dataset.state = "live";
    note.textContent = "drag to look around · click a part";
    start();
  }

  /* ── Camera ─────────────────────────────────────────────────────────── */
  const HOME = { pos: B(-2.05, -2.35, 1.80), target: B(0, 0.42, 0.66), fov: 30 };
  const SEAT = { look: B(0, 0.60, 0.97), fov: 64 };
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableZoom = false;                        /* wheel zoom only after a click, so the page still scrolls */
  controls.minDistance = 0.7;
  controls.maxDistance = 6.5;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.rotateSpeed = 0.7;
  controls.zoomSpeed = 0.7;
  controls.addEventListener("change", () => { dirty = true; });
  controls.addEventListener("start", () => { atHome = false; });

  let mode = "orbit", tween = null, yaw = 0, pitch = 0, saved = null, engaged = false, atHome = false;
  let W = 1, H = 1, dirty = true;

  function homePos() {                                /* pull back when the stage is narrower than 16:10 */
    const k = Math.max(1, Math.pow(1.6 / (W / H), 0.9));
    return HOME.target.clone().add(HOME.pos.clone().sub(HOME.target).multiplyScalar(k));
  }

  function fly(pos, target, fov, ms, done) {
    tween = { t: 0, ms: reduce ? 0 : ms, p0: camera.position.clone(), p1: pos.clone(), t0: controls.target.clone(),
              t1: target.clone(), f0: camera.fov, f1: fov, done: done };
    controls.enabled = false;
  }
  function stepTween(dt) {
    const tw = tween;
    tw.t = tw.ms ? Math.min(1, tw.t + (dt * 1000) / tw.ms) : 1;
    const e = 1 - Math.pow(1 - tw.t, 3);
    camera.position.lerpVectors(tw.p0, tw.p1, e);
    controls.target.lerpVectors(tw.t0, tw.t1, e);
    camera.fov = tw.f0 + (tw.f1 - tw.f0) * e;
    camera.updateProjectionMatrix();
    camera.lookAt(controls.target);
    dirty = true;
    if (tw.t >= 1) {
      tween = null;
      controls.enabled = mode === "orbit";
      if (tw.done) tw.done();
    }
  }
  function goHome(ms) { fly(homePos(), HOME.target, HOME.fov, ms); atHome = true; }

  function seatLook() {                               /* yaw is positive to the left, pitch positive up */
    const cp = Math.cos(pitch);
    controls.target.set(EYE.x - Math.sin(yaw) * cp, EYE.y + Math.sin(pitch), EYE.z - Math.cos(yaw) * cp);
    camera.position.copy(EYE);
    camera.lookAt(controls.target);
    dirty = true;
  }
  function aimAt(p) {
    const d = p.clone().sub(EYE).normalize();
    return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.asin(Math.max(-1, Math.min(1, d.y))) };
  }

  function setView(v) {
    if (!ready) return;
    if (v === "orbit" && mode === "orbit") return goHome(900);
    if (v === mode) return;
    viewBtns.forEach((b) => (b.dataset.active = String(b.dataset.view === v)));
    stage.dataset.view = v;
    if (v === "seat") {
      saved = atHome ? null : { pos: camera.position.clone(), target: controls.target.clone() };
      mode = "seat";
      const a = aimAt(SEAT.look);
      yaw = a.yaw;
      pitch = a.pitch;
      fly(EYE, EYE.clone().add(SEAT.look.clone().sub(EYE).normalize()), SEAT.fov, 1100, seatLook);
      note.textContent = "drag to look around";
    } else {
      mode = "orbit";
      if (saved) fly(saved.pos, saved.target, HOME.fov, 1100); else goHome(1100);
      note.textContent = "drag to look around · click a part";
    }
  }
  viewBtns.forEach((b) => b.addEventListener("click", () => setView(b.dataset.view)));

  function focus(k) {
    const s = slots[k];
    if (!ready || !s) return;
    if (mode === "seat") {
      const a = aimAt(s.center), y0 = yaw, p0 = pitch;
      const y1 = Math.max(-1.9, Math.min(1.9, a.yaw)), p1 = Math.max(-1.0, Math.min(0.5, a.pitch));
      tween = { t: 0, ms: reduce ? 0 : 700, custom: true, step: function (e) { yaw = y0 + (y1 - y0) * e; pitch = p0 + (p1 - p0) * e; seatLook(); } };
      return;
    }
    const v = VANTAGE[k];
    if (!v) return goHome(900);
    atHome = false;
    const dir = B(v[0], v[1], v[2]).normalize();
    const fit = Math.max(1, Math.pow(1.6 / (W / H), 0.9));
    const dist = Math.max(0.95, (s.radius / Math.sin((HOME.fov * Math.PI) / 360)) * 1.05) * fit;
    fly(s.center.clone().addScaledVector(dir, dist), s.center, HOME.fov, 900);
  }

  /* ── Pointer: orbit, look around from the seat, hover and click a part ── */
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null, moved = false, pointerIn = false, needPick = false;

  function pick(ev) {
    const r = canvas.getBoundingClientRect();
    ndc.set(((ev.clientX - r.left) / r.width) * 2 - 1, -((ev.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(pickables, false)[0];
    return hit ? hit.object.userData.slot : null;
  }
  canvas.addEventListener("pointerdown", (ev) => {
    down = { x: ev.clientX, y: ev.clientY, yaw: yaw, pitch: pitch };
    moved = false;
    engaged = true;
    controls.enableZoom = true;
    if (mode === "seat") { try { canvas.setPointerCapture(ev.pointerId); } catch (e) { /* fine */ } }
  });
  canvas.addEventListener("pointermove", (ev) => {
    pointerIn = true;
    if (down) {
      const dx = ev.clientX - down.x, dy = ev.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 5) moved = true;
      if (mode === "seat" && !tween) {
        yaw = Math.max(-1.9, Math.min(1.9, down.yaw + dx * 0.0034));
        pitch = Math.max(-1.0, Math.min(0.5, down.pitch + dy * 0.0034));
        seatLook();
      }
      return;
    }
    needPick = ev;
  });
  function release(ev) {
    if (down && !moved && ev.type === "pointerup") {
      const k = pick(ev);
      if (k) page.choose(k);
    }
    down = null;
  }
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);
  canvas.addEventListener("pointerleave", () => {
    pointerIn = false;
    needPick = false;
    engaged = false;
    controls.enableZoom = false;
    if (hover) { hover = null; canvas.dataset.hot = "false"; dirty = true; }
  });
  canvas.addEventListener("wheel", (ev) => {
    if (mode !== "seat" || !engaged) return;
    ev.preventDefault();
    camera.fov = Math.max(38, Math.min(80, camera.fov + ev.deltaY * 0.03));
    camera.updateProjectionMatrix();
    dirty = true;
  }, { passive: false });
  canvas.addEventListener("dblclick", () => { if (mode === "orbit") goHome(900); });

  /* ── Captions, the dashed selection ring and the "+" on an empty slot ── */
  const labels = {};
  page.state().slots.forEach((s) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "lbl";
    b.dataset.slot = s.key;
    b.textContent = s.label;
    b.addEventListener("click", () => page.choose(s.key));
    overlay.appendChild(b);
    labels[s.key] = b;
  });
  let plusFor = null;
  plus.addEventListener("click", () => { if (plusFor) page.choose(plusFor); });

  const v3 = new THREE.Vector3();
  function toScreen(p) {
    v3.copy(p).applyMatrix4(camera.matrixWorldInverse);
    if (v3.z > -0.05) return null;
    v3.applyMatrix4(camera.projectionMatrix);
    return { x: (v3.x * 0.5 + 0.5) * W, y: (-v3.y * 0.5 + 0.5) * H };
  }
  function layout() {
    const placed = [];
    const rank = (k) => (slots[k] && slots[k].ghost ? 2 : k === selected ? 1 : 0);
    const order = KEYS.slice().sort((a, b) => rank(b) - rank(a));
    plusFor = null;
    order.forEach((k) => {
      const el = labels[k], s = slots[k];
      if (!el || !s) return;
      const p = toScreen(ANCHOR[k]);
      let off = !p || p.x < 8 || p.x > W - 8 || p.y < 14 || p.y > H - 8;
      if (W < 420 && !rank(k)) off = true;               /* small stage: only the selected and the empty slot */
      if (!off) off = placed.some((q) => Math.abs(q.x - p.x) < 62 && Math.abs(q.y - p.y) < 20);
      el.dataset.off = String(off);
      if (off) return;
      placed.push(p);
      el.style.transform = "translate(" + p.x.toFixed(1) + "px," + p.y.toFixed(1) + "px) translate(-50%,-100%)";
      if (s.ghost && !plusFor) {
        plusFor = k;
        plus.style.transform = "translate(" + p.x.toFixed(1) + "px," + (p.y - 26).toFixed(1) + "px) translate(-50%,-100%)";
      }
    });
    plus.classList.toggle("hidden", !plusFor);

    const s = slots[selected];
    let show = false;
    if (s) {
      let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9, ok = true;
      for (let i = 0; i < 8 && ok; i++) {
        const p = toScreen(new THREE.Vector3(i & 1 ? s.box.max.x : s.box.min.x, i & 2 ? s.box.max.y : s.box.min.y, i & 4 ? s.box.max.z : s.box.min.z));
        if (!p) { ok = false; break; }
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
      if (ok) {
        x0 = Math.max(5, x0 - 8); y0 = Math.max(5, y0 - 8); x1 = Math.min(W - 5, x1 + 8); y1 = Math.min(H - 5, y1 + 8);
        if (x1 - x0 > 12 && y1 - y0 > 12) {
          show = true;
          ring.style.transform = "translate(" + x0.toFixed(1) + "px," + y0.toFixed(1) + "px)";
          ring.style.width = (x1 - x0).toFixed(1) + "px";
          ring.style.height = (y1 - y0).toFixed(1) + "px";
        }
      }
    }
    ring.style.opacity = show ? "1" : "0";
  }

  /* ── Frame loop ─────────────────────────────────────────────────────── */
  let time = 0, last = 0, running = false, onScreen = true;

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

  function frame(now) {
    if (!running) return;
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    if (!reduce) { time += dt; dirty = true; }

    if (tween) {
      if (tween.custom) {
        tween.t = tween.ms ? Math.min(1, tween.t + (dt * 1000) / tween.ms) : 1;
        tween.step(1 - Math.pow(1 - tween.t, 3));
        if (tween.t >= 1) tween = null;
      } else stepTween(dt);
    } else if (mode === "orbit") controls.update();

    if (needPick && !down) {
      const k = pick(needPick);
      needPick = false;
      if (k !== hover) { hover = k; canvas.dataset.hot = String(!!k); dirty = true; }
    }
    KEYS.forEach((k) => {
      const s = slots[k];
      if (!s) return;
      const want = hover === k ? 1 : 0;
      if (Math.abs(want - s.hl) > 0.002) { s.hl += (want - s.hl) * Math.min(1, dt * 12); dirty = true; }
      if (s.shown !== s.hl && !s.ghost) {
        s.shown = s.hl;
        s.meshes.forEach((m) => { if (m.userData.base) m.material.emissive.copy(m.userData.base).lerp(ACCENT, 0.03 * s.hl); });
      }
      if (s.pop < 1) {
        s.pop = reduce ? 1 : Math.min(1, s.pop + dt / 0.34);
        const e = 1 - Math.pow(1 - s.pop, 3);
        s.root.scale.copy(s.scale).multiplyScalar(0.9 + 0.1 * e);
        dirty = true;
      }
    });

    if (!dirty) return;
    dirty = false;
    const steer = Math.sin(time * 0.23) * 0.7 + Math.sin(time * 0.61 + 1.0) * 0.3;
    screenMat.uniforms.uTime.value = time;
    screenMat.uniforms.uSteer.value = steer;
    if (rimBase) slots.rim.root.quaternion.copy(rimBase).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -steer * 0.3));
    glow.material.opacity = 0.22 + 0.10 * Math.sin(time * 1.05);
    renderer.render(scene, camera);
    layout();
  }
  function start() {
    const want = ready && onScreen && !document.hidden;
    if (want && !running) { running = true; last = performance.now(); dirty = true; requestAnimationFrame(frame); }
    else if (!want) running = false;
  }
  new ResizeObserver(() => { resize(); start(); }).observe(stage);
  new IntersectionObserver((es) => { onScreen = es[0].isIntersecting; start(); }).observe(stage);
  document.addEventListener("visibilitychange", start);

  /* ── What the page can ask for ──────────────────────────────────────── */
  const api = {
    sync: function (sel, rig) {
      if (!ready) { pending = { selected: sel, rig: rig }; return; }
      selected = sel;
      KEYS.forEach((k) => {
        const s = slots[k], el = labels[k];
        if (s) setGhost(s, !rig[k]);
        if (el) { el.dataset.sel = String(k === sel); el.dataset.empty = String(!rig[k]); }
      });
      dirty = true;
    },
    focus: focus,
    view: setView,
    camera: camera,                                   /* these two are for inspecting the scene from the console */
    scene: scene,
    pop: function (k) { if (slots[k]) { slots[k].pop = 0; slots[k].shown = -1; dirty = true; } },
  };
  window.rig3d = api;

  /* ── Load ───────────────────────────────────────────────────────────── */
  try {
    const b64 = document.getElementById("rigGlb").textContent.replace(/\s+/g, "");
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    new THREE.GLTFLoader().parse(buf.buffer, "", onModel, () => still(FALLBACK));
  } catch (e) {
    still(FALLBACK);
  }
})();
