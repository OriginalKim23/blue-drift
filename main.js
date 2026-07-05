import * as THREE from 'https://unpkg.com/three@0.166.1/build/three.module.js';

const container = document.getElementById('app');
const startOverlay = document.getElementById('start');
const startButton = document.getElementById('startButton');
const settingsButton = document.getElementById('settingsButton');
const settingsPanel = document.getElementById('settingsPanel');
const closeSettings = document.getElementById('closeSettings');
const underwaterVolumeInput = document.getElementById('underwaterVolume');
const musicToggle = document.getElementById('musicToggle');
const musicVolumeInput = document.getElementById('musicVolume');
const touchVolumeInput = document.getElementById('touchVolume');

let audioCtx = null;
let underwaterMaster = null;
let touchMaster = null;
let musicBuffer = null;
let musicMaster = null;
let musicSourceNode = null;
let musicLoadPromise = null;
let musicLoopStart = 0;
let musicLoopEnd = 0;
let audioStarted = false;

let underwaterVolume = 0.38;
let musicVolume = 0.28;
let touchVolume = 0.38;

let bellTouchPulse = 0;
let bellTouchTarget = 0;
let bellGlowWave = 0;
let bellGlowTarget = 0;
let bellShockWave = 0;
let bellShockTarget = 0;
let bellShockStart = -99;
let tentacleRubPulse = 0;
let lastHarpTime = 0;
let lastTapTime = 0;
let diveStartTime = null;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000104, 0.085);
const baseFogColor = new THREE.Color(0x000104);
const touchFogColor = new THREE.Color(0x071a33);
const baseClearColor = new THREE.Color(0x000104);
const touchClearColor = new THREE.Color(0x020a18);

const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.01, 120);
camera.position.set(0, 0.05, 8.6);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.65));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.setClearColor(0x000104, 1);
container.appendChild(renderer.domElement);

const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();

function pointerToNdc(x, y) {
  const rect = renderer.domElement.getBoundingClientRect();
  ndc.x = ((x - rect.left) / rect.width) * 2 - 1;
  ndc.y = -((y - rect.top) / rect.height) * 2 + 1;
  return ndc;
}

function smoothstep(edge0, edge1, x) {
  const t = THREE.MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

// ---------- Background dome ----------
const domeGeo = new THREE.SphereGeometry(70, 48, 32);
const domeMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  uniforms: {
    top: { value: new THREE.Color(0x020816) },
    mid: { value: new THREE.Color(0x000208) },
    bottom: { value: new THREE.Color(0x000104) },
  },
  vertexShader: `
    varying vec3 vWorld;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vWorld = normalize(wp.xyz);
      gl_Position = projectionMatrix * viewMatrix * wp;
    }
  `,
  fragmentShader: `
    varying vec3 vWorld;
    uniform vec3 top;
    uniform vec3 mid;
    uniform vec3 bottom;
    void main() {
      float h = clamp(vWorld.y * 0.5 + 0.5, 0.0, 1.0);
      vec3 col = mix(bottom, mid, smoothstep(0.0, 0.72, h));
      col = mix(col, top, smoothstep(0.92, 1.0, h));
      gl_FragColor = vec4(col, 1.0);
    }
  `,
});
scene.add(new THREE.Mesh(domeGeo, domeMat));

scene.add(new THREE.AmbientLight(0x061a34, 0.18));

const topLight = new THREE.PointLight(0x1759ff, 0.65, 42, 2.0);
topLight.position.set(0, 9, -6);
scene.add(topLight);

const jellyLight = new THREE.PointLight(0x168cff, 18, 42, 1.15);
scene.add(jellyLight);

const seaTouchLight = new THREE.PointLight(0x1e9bff, 0, 58, 1.05);
scene.add(seaTouchLight);

// ---------- White motes / suspended particles ----------
const particleCount = 1800;
const pPositions = new Float32Array(particleCount * 3);
const pSizes = new Float32Array(particleCount);
const pBrightness = new Float32Array(particleCount);
const pSoftness = new Float32Array(particleCount);
const pSeed = new Float32Array(particleCount);

for (let i = 0; i < particleCount; i++) {
  pPositions[i * 3 + 0] = (Math.random() - 0.5) * 28;
  pPositions[i * 3 + 1] = (Math.random() - 0.5) * 18;
  pPositions[i * 3 + 2] = (Math.random() - 0.5) * 24;

  const r = Math.random();
  const near = r > 0.90;
  const misty = r < 0.24;

  pSizes[i] =
    near ? 0.95 + Math.random() * 1.10 :
    misty ? 0.52 + Math.random() * 0.75 :
    0.26 + Math.random() * 0.48;

  pBrightness[i] =
    near ? 0.85 + Math.random() * 0.25 :
    misty ? 0.42 + Math.random() * 0.25 :
    0.46 + Math.random() * 0.28;

  pSoftness[i] =
    near ? 0.50 + Math.random() * 0.25 :
    misty ? 0.78 + Math.random() * 0.18 :
    0.18 + Math.random() * 0.32;

  pSeed[i] = Math.random();
}

const particleGeo = new THREE.BufferGeometry();
particleGeo.setAttribute('position', new THREE.BufferAttribute(pPositions, 3));
particleGeo.setAttribute('aSize', new THREE.BufferAttribute(pSizes, 1));
particleGeo.setAttribute('aBrightness', new THREE.BufferAttribute(pBrightness, 1));
particleGeo.setAttribute('aSoftness', new THREE.BufferAttribute(pSoftness, 1));
particleGeo.setAttribute('aSeed', new THREE.BufferAttribute(pSeed, 1));

const particleMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  uniforms: {
    uTime: { value: 0 },
    uPixelRatio: { value: Math.min(window.devicePixelRatio, 1.65) },
    uReveal: { value: 1 },
  },
  vertexShader: `
    uniform float uTime;
    uniform float uPixelRatio;
    attribute float aSize;
    attribute float aBrightness;
    attribute float aSoftness;
    attribute float aSeed;
    varying float vAlpha;
    varying float vSoftness;
    varying float vSeed;

    void main() {
      vec3 p = position;
      float driftSeed = aSeed * 6.28318;
      p.x += sin(uTime * 0.045 + position.y * 0.23 + driftSeed) * (0.05 + aSoftness * 0.05);
      p.y += sin(uTime * 0.035 + position.x * 0.17 + driftSeed * 0.7) * (0.04 + aSoftness * 0.03);
      p.z += sin(uTime * 0.026 + position.x * 0.11 + position.y * 0.08 + driftSeed * 0.5) * (0.05 + aSoftness * 0.05);

      vec4 mvPosition = modelViewMatrix * vec4(p, 1.0);
      gl_Position = projectionMatrix * mvPosition;

      gl_PointSize = (0.9 + aSize * 2.1) * uPixelRatio * (18.0 / -mvPosition.z);
      vAlpha = (0.05 + aSize * 0.18) * aBrightness;
      vSoftness = aSoftness;
      vSeed = aSeed;
    }
  `,
  fragmentShader: `
    uniform float uReveal;
    varying float vAlpha;
    varying float vSoftness;
    varying float vSeed;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    void main() {
      vec2 uv = gl_PointCoord - 0.5;
      float theta = vSeed * 6.28318;
      vec2 axis = vec2(cos(theta), sin(theta));
      vec2 drift = axis * (0.04 + vSoftness * 0.07);
      vec2 warped = uv + drift * 0.35;
      warped.x *= 1.0 + (vSoftness - 0.5) * 0.25;
      warped.y *= 1.0 - (vSoftness - 0.5) * 0.16;

      float r = length(warped);
      float softBody = smoothstep(0.58, 0.03, r);
      float crispCore = smoothstep(0.22 + vSoftness * 0.08, 0.0, length(uv + drift * 0.18));
      float sideDust = smoothstep(0.18, 0.0, length(uv - drift * 0.45));

      float grain = hash(gl_PointCoord * 19.3 + vSeed * 13.7);
      float sparkle = mix(0.85, 1.10, grain);
      float alpha = mix(crispCore * 1.15, softBody * 0.88 + sideDust * 0.26, vSoftness);
      alpha *= sparkle * vAlpha * uReveal;

      vec3 col = mix(vec3(0.92, 0.97, 1.0), vec3(0.82, 0.92, 1.0), vSoftness * 0.35);
      gl_FragColor = vec4(col, alpha);
    }
  `,
});
const particles = new THREE.Points(particleGeo, particleMat);
scene.add(particles);

// ---------- Glow texture ----------
function makeGlowTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(130,235,255,0.95)');
  g.addColorStop(0.26, 'rgba(48,145,255,0.55)');
  g.addColorStop(0.62, 'rgba(18,92,255,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// ---------- Jellyfish ----------
const jelly = new THREE.Group();
jelly.scale.setScalar(0.78);
jelly.position.set(-0.36, 0.28, -5.45);
scene.add(jelly);

function addBasicMesh(mesh) {
  jelly.add(mesh);
  return mesh;
}

const bell = addBasicMesh(new THREE.Mesh(
  (() => {
    const g = new THREE.SphereGeometry(1.18, 80, 44, 0, Math.PI * 2, 0, Math.PI * 0.54);
    g.scale(1.07, 0.70, 1.0);
    return g;
  })(),
  new THREE.MeshPhysicalMaterial({
    color: 0x2aa8ff,
    transparent: true,
    opacity: 0.32,
    roughness: 0.2,
    metalness: 0,
    ior: 1.08,
    transmission: 0.55,
    thickness: 0.7,
    emissive: 0x006eff,
    emissiveIntensity: 1.15,
    side: THREE.DoubleSide,
    depthWrite: false,
    clearcoat: 0.38,
    clearcoatRoughness: 0.18,
  })
));

const innerBell = addBasicMesh(new THREE.Mesh(
  (() => {
    const g = new THREE.SphereGeometry(1.0, 56, 30, 0, Math.PI * 2, 0, Math.PI * 0.50);
    g.scale(0.96, 0.61, 0.88);
    return g;
  })(),
  new THREE.MeshBasicMaterial({
    color: 0x1c8cff,
    transparent: true,
    opacity: 0.22,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  })
));

const capGlow = addBasicMesh(new THREE.Mesh(
  new THREE.SphereGeometry(0.76, 32, 18),
  new THREE.MeshBasicMaterial({
    color: 0x82e8ff,
    transparent: true,
    opacity: 0.20,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
));
capGlow.position.set(0, -0.48, 0);
capGlow.scale.set(1.05, 0.55, 0.88);

const core = addBasicMesh(new THREE.Mesh(
  new THREE.SphereGeometry(0.44, 32, 18),
  new THREE.MeshBasicMaterial({
    color: 0x0a78ff,
    transparent: true,
    opacity: 0.38,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })
));
core.position.y = -0.42;
core.scale.set(0.82, 1.72, 0.62);

const rim1 = addBasicMesh(new THREE.Mesh(
  new THREE.TorusGeometry(1.12, 0.031, 8, 144),
  new THREE.MeshBasicMaterial({
    color: 0x67e8ff,
    transparent: true,
    opacity: 0.96,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })
));
rim1.rotation.x = Math.PI / 2;
rim1.position.y = -0.02;
rim1.scale.z = 0.82;

const rim2 = addBasicMesh(new THREE.Mesh(
  new THREE.TorusGeometry(0.92, 0.014, 8, 120),
  new THREE.MeshBasicMaterial({
    color: 0x126cff,
    transparent: true,
    opacity: 0.68,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  })
));
rim2.rotation.x = Math.PI / 2;
rim2.position.y = -0.17;
rim2.scale.z = 0.77;

// specks on dome
const speckGroup = new THREE.Group();
jelly.add(speckGroup);
for (let i = 0; i < 170; i++) {
  const r = Math.sqrt(Math.random()) * 0.98;
  const theta = Math.random() * Math.PI * 2;
  const x = Math.cos(theta) * r;
  const z = Math.sin(theta) * r * 0.84;
  const y = -0.68 + Math.pow(1 - r, 0.68) * 0.62 + Math.random() * 0.03;
  const speck = new THREE.Mesh(
    new THREE.SphereGeometry(0.011 + Math.random() * 0.018, 8, 6),
    new THREE.MeshBasicMaterial({
      color: Math.random() > 0.7 ? 0xe4fbff : 0x9fefff,
      transparent: true,
      opacity: 0.94,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  speck.position.set(x, y, z);
  speckGroup.add(speck);
}

// build dynamic tubes
function buildTube(points, radius, radialSegments, color, opacity) {
  const curve = new THREE.CatmullRomCurve3(points);
  curve.curveType = 'centripetal';
  const geo = new THREE.TubeGeometry(curve, 56, radius, radialSegments, false);
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  return new THREE.Mesh(geo, mat);
}

const dynamicTubes = [];
const tentacleTouchHelpers = [];
const radialVeins = [];
const bellRibs = [];
const bellBioRings = [];
const rimCells = [];

function addTubeObject(kind, index, angle, radius, len, thickness, color, opacity) {
  const count = kind === 'oral' ? 14 : 15;
  const pts = [];
  for (let j = 0; j < count; j++) {
    const t = j / (count - 1);
    pts.push(new THREE.Vector3(
      Math.cos(angle) * radius * (1 - t * 0.12),
      -0.05 - t * len,
      Math.sin(angle) * radius * (1 - t * 0.12)
    ));
  }
  const mesh = buildTube(pts, thickness, kind === 'oral' ? 7 : 4, color, opacity);
  mesh.userData = { kind, index, angle, radius, len, thickness, phase: Math.random() * 10, baseOpacity: opacity, baseColor: new THREE.Color(color), touch: 0 };
  dynamicTubes.push(mesh);
  jelly.add(mesh);

  if (kind === 'tentacle' || kind === 'hair') {
    const helperThickness = kind === 'hair' ? thickness * 4.8 : thickness * 2.18;
    const helper = buildTube(pts, helperThickness, kind === 'oral' ? 7 : 4, color, 0.0);
    helper.material.transparent = true;
    helper.material.opacity = 0.0;
    helper.material.depthWrite = false;
    helper.material.depthTest = false;
    helper.userData = { ...mesh.userData, thickness: helperThickness, sourceMesh: mesh, isTouchHelper: true };
    tentacleTouchHelpers.push(helper);
    jelly.add(helper);
  }

  return mesh;
}

// radial veins
for (let i = 0; i < 28; i++) {
  const angle = i / 28 * Math.PI * 2;
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(Math.cos(angle) * 0.08, -0.03, Math.sin(angle) * 0.08),
    new THREE.Vector3(Math.cos(angle) * 0.38, -0.10, Math.sin(angle) * 0.34),
    new THREE.Vector3(Math.cos(angle) * 0.96, -0.18 - Math.random() * 0.06, Math.sin(angle) * 0.78)
  ]);
  const geo = new THREE.TubeGeometry(curve, 20, 0.005, 4, false);
  const mat = new THREE.MeshBasicMaterial({
    color: 0x73deff,
    transparent: true,
    opacity: 0.24,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const vein = new THREE.Mesh(geo, mat);
  vein.userData.baseOpacity = mat.opacity;
  radialVeins.push(vein);
  jelly.add(vein);
}

// oral arms
for (let i = 0; i < 6; i++) {
  const angle = i / 6 * Math.PI * 2 + (Math.random() - 0.5) * 0.24;
  addTubeObject('oral', i, angle, 0.16, 2.2 + Math.random() * 0.9, 0.048, i % 2 ? 0x9fe4ff : 0xdaf7ff, 0.16);
}

// long tentacles
for (let i = 0; i < 46; i++) {
  const angle = Math.random() * Math.PI * 2;
  addTubeObject('tentacle', i, angle, 0.84 + Math.random() * 0.26, 3.9 + Math.random() * 4.0, 0.0055 + Math.random() * 0.0035, i % 5 === 0 ? 0x76e7ff : 0x2c7cff, 0.42);
}

// very fine hairs
for (let i = 0; i < 20; i++) {
  const angle = Math.random() * Math.PI * 2;
  addTubeObject('hair', i + 300, angle, 0.9 + Math.random() * 0.16, 4.8 + Math.random() * 2.5, 0.0028, 0xa8f0ff, 0.28);
}

// glow sprites
const glowTex = makeGlowTexture();
const glow1 = addBasicMesh(new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTex,
  color: 0x2b8cff,
  transparent: true,
  opacity: 0.52,
  blending: THREE.AdditiveBlending,
  depthWrite: false
})));
glow1.scale.set(5.2, 5.2, 1);
glow1.position.set(0, -0.42, 0);

const glow2 = addBasicMesh(new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTex,
  color: 0x88ecff,
  transparent: true,
  opacity: 0.24,
  blending: THREE.AdditiveBlending,
  depthWrite: false
})));
glow2.scale.set(2.5, 2.5, 1);
glow2.position.set(0, -0.18, 0);

const seaGlow = addBasicMesh(new THREE.Sprite(new THREE.SpriteMaterial({
  map: glowTex,
  color: 0x1f8cff,
  transparent: true,
  opacity: 0,
  blending: THREE.AdditiveBlending,
  depthWrite: false
})));
seaGlow.scale.set(18.0, 18.0, 1);
seaGlow.position.set(0, -0.38, -1.15);

const aura = addBasicMesh(new THREE.Mesh(
  new THREE.SphereGeometry(4.6, 40, 28),
  new THREE.MeshBasicMaterial({
    color: 0x0b6dff,
    transparent: true,
    opacity: 0.026,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.BackSide
  })
));

// organic 3D glow rings inside the bell, not a 2D screen effect
function addBellBioRing(radius, y, zScale, baseOpacity, color = 0x8beeff) {
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity: baseOpacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(radius, 0.009, 8, 160), mat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = y;
  ring.scale.z = zScale;
  ring.userData.baseOpacity = baseOpacity;
  ring.userData.radius = radius;
  ring.userData.zScale = zScale;
  bellBioRings.push(ring);
  jelly.add(ring);
}

addBellBioRing(1.06, -0.045, 0.82, 0.28, 0x9af2ff);
addBellBioRing(0.84, -0.145, 0.74, 0.20, 0x74e7ff);
addBellBioRing(0.58, -0.275, 0.66, 0.15, 0x43b9ff);
addBellBioRing(0.32, -0.410, 0.58, 0.12, 0xc9fbff);

// soft vertical ribs on the bell surface
for (let i = 0; i < 34; i++) {
  const angle = i / 34 * Math.PI * 2;
  const points = [];
  for (let j = 0; j < 8; j++) {
    const t = j / 7;
    const r = THREE.MathUtils.lerp(0.16, 1.06, t);
    const y = THREE.MathUtils.lerp(0.32, -0.17, t);
    const wave = Math.sin(t * Math.PI) * 0.035;
    points.push(new THREE.Vector3(
      Math.cos(angle) * (r + wave),
      y,
      Math.sin(angle) * (r + wave) * 0.82
    ));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, 24, 0.0065, 4, false);
  const mat = new THREE.MeshBasicMaterial({
    color: i % 3 === 0 ? 0xbdf8ff : 0x65dfff,
    transparent: true,
    opacity: i % 3 === 0 ? 0.24 : 0.16,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const rib = new THREE.Mesh(geo, mat);
  rib.userData.baseOpacity = mat.opacity;
  bellRibs.push(rib);
  jelly.add(rib);
}

// subtle living cells along the lower bell edge
for (let i = 0; i < 28; i++) {
  const angle = i / 28 * Math.PI * 2;
  const cell = new THREE.Mesh(
    new THREE.SphereGeometry(0.014 + Math.random() * 0.010, 8, 6),
    new THREE.MeshBasicMaterial({
      color: i % 4 === 0 ? 0xd8fbff : 0x78eaff,
      transparent: true,
      opacity: 0.20,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    })
  );
  cell.position.set(
    Math.cos(angle) * (1.06 + Math.sin(i * 1.7) * 0.025),
    -0.075 + Math.sin(i * 1.3) * 0.018,
    Math.sin(angle) * (0.86 + Math.cos(i * 1.1) * 0.018)
  );
  cell.userData.baseOpacity = cell.material.opacity;
  rimCells.push(cell);
  jelly.add(cell);
}

const innerMembranes = [];
for (let i = 0; i < 10; i++) {
  const angle = i / 10 * Math.PI * 2 + 0.12;
  const points = [];
  for (let j = 0; j < 9; j++) {
    const t = j / 8;
    const r = 0.24 + Math.sin(t * Math.PI + i) * 0.025;
    const sway = Math.sin(t * 5.0 + i * 0.7) * 0.055 * t;
    points.push(new THREE.Vector3(
      Math.cos(angle) * r + Math.cos(angle + Math.PI / 2) * sway,
      -0.24 - t * (0.92 + Math.random() * 0.20),
      Math.sin(angle) * r + Math.sin(angle + Math.PI / 2) * sway
    ));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const geo = new THREE.TubeGeometry(curve, 34, 0.018, 5, false);
  const mat = new THREE.MeshBasicMaterial({
    color: i % 2 ? 0xb8efff : 0xe1fbff,
    transparent: true,
    opacity: 0.075,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
  const membrane = new THREE.Mesh(geo, mat);
  membrane.userData.baseOpacity = mat.opacity;
  membrane.userData.phase = Math.random() * 10;
  innerMembranes.push(membrane);
  jelly.add(membrane);
}

// ---------- Tube animation ----------
function updateTubeMesh(mesh, time, breath) {
  const d = mesh.userData;
  const pts = [];
  const isOral = d.kind === 'oral';
  const isHair = d.kind === 'hair';
  const count = isOral ? 16 : 20;
  const bellPump = (breath - 0.5) * 2.0;
  const recoil = 1.0 - breath;
  const shockAge = Math.max(0, time - bellShockStart);

  const rub = d.rub || 0;
  const rubX = d.rubX || 0;
  const rubY = d.rubY || 0;

  for (let j = 0; j < count; j++) {
    const t = j / (count - 1);
    const lag = t * (isOral ? 2.7 : 4.8);
    const slow = isHair ? 0.86 : 1.0;

    const flowA = Math.sin(time * 0.30 + d.phase - lag + d.index * 0.071);
    const flowB = Math.sin(time * 0.145 + d.phase * 0.65 + t * 6.4);
    const flowC = Math.cos(time * 0.215 + d.phase * 1.10 - lag * 0.62);

    const angleDrift =
      d.angle +
      Math.sin(time * 0.056 + d.phase) * 0.10 +
      Math.sin(time * 0.112 + d.phase - lag) * 0.050 * t;

    const rootFollow = isOral
      ? (0.28 + t * 0.72)
      : (0.24 + t * 0.76);

    const rootPulse = 1 + bellPump * (isOral ? 0.050 : 0.068) * rootFollow;
    const baseRadius = isOral
      ? (d.radius + Math.sin(t * 3.1 + time * 0.10 + d.phase) * 0.040) * rootPulse
      : d.radius * (1 - t * 0.088) * rootPulse;

    const sideX = Math.cos(angleDrift + Math.PI / 2);
    const sideZ = Math.sin(angleDrift + Math.PI / 2);

    // 기본 흐느적거림 강화
    const sideAmp = isOral ? (0.040 + t * 0.28) : (isHair ? 0.032 + t * 0.37 : 0.050 + t * 0.58);
    const depthAmp = isOral ? (0.028 + t * 0.18) : (isHair ? 0.026 + t * 0.24 : 0.040 + t * 0.37);

    const sideWave = (flowA * sideAmp + flowB * (0.016 + t * 0.13)) * slow;
    const depthWave = (flowC * depthAmp + Math.sin(time * 0.072 + t * 4.0 + d.phase) * 0.050 * t) * slow;

    const rootY = isOral ? -0.22 : -0.11;

    const pulseDown = bellPump * (isOral ? 0.050 : 0.078) * (0.28 + t * 0.72);
    const delayedY = Math.sin(time * 0.24 + d.phase - lag * 0.84) * (isOral ? 0.036 : 0.075) * (0.12 + t * 0.88);

    // 머리 터치 시: 시작부부터 훅 반응하고, 긴 큰 물결이 끝까지 전달.
    const travelDelay = t * (isOral ? 0.36 : 0.50);
    const localAge = shockAge - travelDelay;
    const waveLead = smoothstep(0.0, 0.12, localAge);
    const waveFade = 1.0 - smoothstep(isOral ? 2.25 : 2.70, isOral ? 4.00 : 4.85, localAge);
    const waveWindow = Math.max(0.0, waveLead * waveFade);

    const mainWave = Math.sin(Math.min(Math.PI, Math.max(0.0, localAge) * (isOral ? 1.25 : 1.05)));
    const trailingWave = Math.sin(Math.max(0.0, localAge) * (isOral ? 3.1 : 2.7) - t * 2.6 + d.phase * 0.22)
      * smoothstep(0.18, 0.55, localAge)
      * (1.0 - smoothstep(isOral ? 2.6 : 3.0, isOral ? 4.2 : 5.0, localAge));

    const shockPulse = bellShockWave * (mainWave * 0.95 + trailingWave * 0.20) * waveWindow;

    const waveStrength = isOral ? (0.055 + t * 0.13) : (0.085 + t * 0.24);
    const shockSide = shockPulse * waveStrength * 0.92;
    const shockDepth = shockPulse * waveStrength * 0.68;
    const shockDrop = -Math.abs(shockPulse) * (isOral ? (0.020 + t * 0.060) : (0.035 + t * 0.105));
    const rootDip = -Math.abs(shockPulse) * (isOral ? 0.022 : 0.034) * (0.75 + t * 0.25);

    // 문지름 미세 반응
    const rubLag = smoothstep(0.08, 0.88, t);
    const rubSide = rub * rubLag * rubX * (isOral ? 0.24 : 0.54);
    const rubDepth = rub * rubLag * rubY * (isOral ? 0.16 : 0.32);
    const rubDrop = -Math.abs(rub * rubLag) * (isOral ? 0.010 : 0.020);

    const x = Math.cos(angleDrift) * baseRadius + sideX * (sideWave + shockSide + rubSide);
    const y = rootY - t * d.len + pulseDown + delayedY + shockDrop + rootDip + rubDrop - recoil * 0.013;
    const z = Math.sin(angleDrift) * baseRadius + sideZ * (depthWave + shockDepth + rubDepth);

    pts.push(new THREE.Vector3(x, y, z));
  }

  const curve = new THREE.CatmullRomCurve3(pts);
  curve.curveType = 'centripetal';
  mesh.geometry.dispose();
  mesh.geometry = new THREE.TubeGeometry(curve, isOral ? 58 : 76, d.thickness, isOral ? 7 : (isHair ? 3 : 4), false);
}

// ---------- Controls / interactions ----------
const controls = {
  yaw: 0,
  pitch: 0,
  targetYaw: 0,
  targetPitch: 0,
  distance: 8.6,
  targetDistance: 8.6,
  dragging: false,
  lastX: 0,
  lastY: 0,
  downX: 0,
  downY: 0,
  hasDragged: false,
};

const activePointers = new Map();
let pinchStartDistance = 0;
let pinchStartZoom = controls.targetDistance;

function distanceBetweenPointers() {
  const pts = [...activePointers.values()];
  if (pts.length < 2) return 0;
  const dx = pts[0].x - pts[1].x;
  const dy = pts[0].y - pts[1].y;
  return Math.hypot(dx, dy);
}

function raycastAt(clientX, clientY, objects) {
  pointerToNdc(clientX, clientY);
  raycaster.setFromCamera(ndc, camera);
  return raycaster.intersectObjects(objects, true);
}

const screenProbe = new THREE.Vector3();

function findNearbyTentaclesOnScreen(clientX, clientY, threshold = 48, maxCount = 8) {
  const rect = renderer.domElement.getBoundingClientRect();
  const results = [];

  for (const tube of dynamicTubes) {
    const kind = tube.userData && tube.userData.kind;
    if (kind !== 'tentacle' && kind !== 'hair') continue;
    const pos = tube.geometry && tube.geometry.attributes && tube.geometry.attributes.position;
    if (!pos) continue;

    let best = Infinity;
    const step = Math.max(8, Math.floor(pos.count / 16));
    for (let i = 0; i < pos.count; i += step) {
      screenProbe.fromBufferAttribute(pos, i);
      tube.localToWorld(screenProbe);
      screenProbe.project(camera);

      if (screenProbe.z < -1 || screenProbe.z > 1) continue;

      const sx = (screenProbe.x * 0.5 + 0.5) * rect.width + rect.left;
      const sy = (-screenProbe.y * 0.5 + 0.5) * rect.height + rect.top;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < best) best = d;
    }

    if (best <= threshold) {
      results.push({ tube, dist: best });
    }
  }

  results.sort((a, b) => a.dist - b.dist);
  return results.slice(0, maxCount);
}

function handleTap(clientX, clientY) {
  const bellHits = raycastAt(clientX, clientY, [bell, innerBell, capGlow, core, rim1, rim2]);
  if (bellHits.length > 0) {
    bellTouchTarget = Math.max(bellTouchTarget, 1.0);
    bellGlowTarget = Math.max(bellGlowTarget, 1.0);
    bellShockTarget = Math.max(bellShockTarget, 1.32);
    bellShockStart = clock.getElapsedTime();
    playBloomTone();
    return;
  }

  const now = performance.now();
  if (now - lastTapTime < 320) {
    controls.targetYaw = 0;
    controls.targetPitch = 0;
    controls.targetDistance = 8.6;
  }
  lastTapTime = now;
}

function tentaclePitchValue(tube, worldPoint) {
  if (!tube || !worldPoint || !tube.userData) return 0.5;
  const local = tube.worldToLocal(worldPoint.clone());
  const len = Math.max(0.001, tube.userData.len || 5.0);
  const rootY = tube.userData.kind === 'oral' ? -0.22 : -0.11;
  // root 근처 0, 촉수 끝으로 갈수록 1.
  // 살짝 과장해서 끝으로 갈수록 음 차이가 더 크게 느껴지게.
  let norm = THREE.MathUtils.clamp((rootY - local.y) / len, 0, 1);
  norm = Math.pow(norm, 0.82);
  return norm;
}

function checkTentacleRub(clientX, clientY, moveDX = 0, moveDY = 0) {
  if (!dynamicTubes || dynamicTubes.length === 0) return;

  // 5174의 차분한 감성은 유지하되, 정말 살짝만 더 잘 잡히게.
  const hits = raycastAt(clientX, clientY, dynamicTubes);
  const touched = [];
  const seen = new Set();

  for (const h of hits) {
    const kind = h.object.userData && h.object.userData.kind;
    if ((kind === 'tentacle' || kind === 'hair') && !seen.has(h.object.uuid)) {
      seen.add(h.object.uuid);
      touched.push({ tube: h.object, point: h.point, pitchValue: tentaclePitchValue(h.object, h.point), strength: touched.length === 0 ? 0.72 : 0.44 });
      if (touched.length >= 3) break;
    }
  }

  // 히트가 전혀 없을 때만, 아주 작은 screen-space 보정으로 1가닥 정도만 보완.
  if (touched.length === 0) {
    const nearby = findNearbyTentaclesOnScreen(clientX, clientY, 18, 1);
    if (nearby.length > 0) {
      touched.push({ tube: nearby[0].tube, point: null, pitchValue: 0.5, strength: 0.52 });
    }
  }

  if (touched.length === 0) return;

  const now = performance.now();
  tentacleRubPulse = 1.0;

  const rubX = THREE.MathUtils.clamp(moveDX * 0.020, -0.22, 0.22);
  const rubY = THREE.MathUtils.clamp(moveDY * 0.016, -0.18, 0.18);

  for (let i = 0; i < touched.length; i++) {
    const tube = touched[i].tube;
    const s = touched[i].strength * (i === 0 ? 1.0 : 0.92);
    tube.userData.touch = Math.max(tube.userData.touch || 0, s);
    tube.userData.rub = Math.max(tube.userData.rub || 0, i === 0 ? 0.85 : 0.42);
    tube.userData.rubX = (tube.userData.rubX || 0) * 0.35 + rubX;
    tube.userData.rubY = (tube.userData.rubY || 0) * 0.35 + rubY;
  }

  // 따다다다 방지. 위치별 음 높낮이는 유지.
  if (now - lastHarpTime > 285) {
    lastHarpTime = now;
    playHarpTone(touched[0].pitchValue ?? 0.5);
  }
}

renderer.domElement.addEventListener('pointerdown', (e) => {
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  renderer.domElement.setPointerCapture(e.pointerId);

  if (activePointers.size === 1) {
    controls.dragging = true;
    controls.lastX = e.clientX;
    controls.lastY = e.clientY;
    controls.downX = e.clientX;
    controls.downY = e.clientY;
    controls.hasDragged = false;
  }

  if (activePointers.size === 2) {
    pinchStartDistance = distanceBetweenPointers();
    pinchStartZoom = controls.targetDistance;
  }
});

renderer.domElement.addEventListener('pointermove', (e) => {
  if (!activePointers.has(e.pointerId)) return;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (activePointers.size >= 2) {
    const currentDistance = distanceBetweenPointers();
    if (pinchStartDistance > 0 && currentDistance > 0) {
      const scale = pinchStartDistance / currentDistance;
      controls.targetDistance = THREE.MathUtils.clamp(pinchStartZoom * scale, 5.4, 10.8);
    }
    return;
  }

  if (!controls.dragging) return;

  const prevX = controls.lastX;
  const prevY = controls.lastY;
  const dx = e.clientX - prevX;
  const dy = e.clientY - prevY;
  controls.lastX = e.clientX;
  controls.lastY = e.clientY;

  if (Math.hypot(e.clientX - controls.downX, e.clientY - controls.downY) > 8) {
    controls.hasDragged = true;
  }

  controls.targetYaw -= dx * 0.00145;
  controls.targetPitch = THREE.MathUtils.clamp(controls.targetPitch - dy * 0.001, -0.55, 0.55);

  checkTentacleRub(e.clientX, e.clientY, dx, dy);
});

function finishPointer(e) {
  const wasSingle = activePointers.size === 1 && activePointers.has(e.pointerId);
  if (wasSingle && !controls.hasDragged) {
    handleTap(e.clientX, e.clientY);
  }

  activePointers.delete(e.pointerId);

  if (activePointers.size < 2) {
    pinchStartDistance = 0;
  }

  if (activePointers.size === 0) {
    controls.dragging = false;
  } else {
    const first = [...activePointers.values()][0];
    controls.lastX = first.x;
    controls.lastY = first.y;
  }
}

renderer.domElement.addEventListener('pointerup', finishPointer);
renderer.domElement.addEventListener('pointercancel', finishPointer);

renderer.domElement.addEventListener('wheel', (e) => {
  e.preventDefault();
  controls.targetDistance = THREE.MathUtils.clamp(controls.targetDistance + e.deltaY * 0.0024, 5.4, 10.8);
}, { passive: false });

// ---------- Audio / settings ----------
function updateAudioVolumes() {
  if (underwaterMaster && audioCtx) {
    underwaterMaster.gain.setTargetAtTime(underwaterVolume, audioCtx.currentTime, 0.08);
  }
  if (touchMaster && audioCtx) {
    touchMaster.gain.setTargetAtTime(touchVolume, audioCtx.currentTime, 0.04);
  }
  if (musicMaster && audioCtx) {
    const targetMusicVolume = musicToggle.checked ? musicVolume : 0;
    musicMaster.gain.setTargetAtTime(targetMusicVolume, audioCtx.currentTime, 0.05);
  }
}


function detectMusicLoopRegion(buffer) {
  const sr = buffer.sampleRate;
  const ch0 = buffer.getChannelData(0);
  const ch1 = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : ch0;
  const step = 512;
  const threshold = 0.0007;

  let start = 0;
  let end = ch0.length - 1;

  for (let i = 0; i < ch0.length; i += step) {
    let peak = 0;
    for (let j = 0; j < step && i + j < ch0.length; j++) {
      peak = Math.max(peak, Math.abs(ch0[i + j]), Math.abs(ch1[i + j]));
    }
    if (peak > threshold) {
      start = i;
      break;
    }
  }

  for (let i = ch0.length - step; i >= 0; i -= step) {
    let peak = 0;
    for (let j = 0; j < step && i + j < ch0.length; j++) {
      peak = Math.max(peak, Math.abs(ch0[i + j]), Math.abs(ch1[i + j]));
    }
    if (peak > threshold) {
      end = Math.min(ch0.length - 1, i + step);
      break;
    }
  }

  const pad = Math.floor(sr * 0.035);
  musicLoopStart = Math.max(0, (start - pad) / sr);
  musicLoopEnd = Math.min(buffer.duration, (end + pad) / sr);

  if (musicLoopEnd - musicLoopStart < 2.0) {
    musicLoopStart = 0;
    musicLoopEnd = buffer.duration;
  }
}

async function loadMusicBuffer() {
  if (musicBuffer) return musicBuffer;
  if (!audioCtx) return null;

  if (!musicLoadPromise) {
    musicLoadPromise = fetch('./music.mp3')
      .then((res) => {
        if (!res.ok) throw new Error(`music.mp3 load failed: ${res.status}`);
        return res.arrayBuffer();
      })
      .then((arrayBuffer) => audioCtx.decodeAudioData(arrayBuffer))
      .then((buffer) => {
        musicBuffer = buffer;
        detectMusicLoopRegion(buffer);
        return buffer;
      });
  }

  return musicLoadPromise;
}

function stopMusicLoop() {
  if (!musicSourceNode || !audioCtx) return;
  try {
    musicSourceNode.stop(audioCtx.currentTime + 0.03);
  } catch (e) {}
  try {
    musicSourceNode.disconnect();
  } catch (e) {}
  musicSourceNode = null;
}

function startMusicLoop() {
  if (!audioCtx || !musicMaster || !musicBuffer || musicSourceNode) return;

  const source = audioCtx.createBufferSource();
  source.buffer = musicBuffer;
  source.loop = true;
  source.loopStart = musicLoopStart;
  source.loopEnd = musicLoopEnd || musicBuffer.duration;
  source.connect(musicMaster);
  source.onended = () => {
    if (musicSourceNode === source) {
      musicSourceNode = null;
    }
  };
  source.start(audioCtx.currentTime, musicLoopStart);
  musicSourceNode = source;
}

async function ensureMusicLoop() {
  if (!audioStarted || !audioCtx || !musicToggle.checked) return;

  try {
    await loadMusicBuffer();
    if (!musicToggle.checked) return;
    startMusicLoop();
  } catch (e) {
    console.warn('Music failed:', e);
  }
}

function setupAudio() {
  if (audioStarted) return;
  audioStarted = true;

  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();

    underwaterMaster = audioCtx.createGain();
    underwaterMaster.gain.value = 0.0;
    underwaterMaster.connect(audioCtx.destination);

    touchMaster = audioCtx.createGain();
    touchMaster.gain.value = touchVolume;
    touchMaster.connect(audioCtx.destination);

    musicMaster = audioCtx.createGain();
    musicMaster.gain.value = musicToggle.checked ? musicVolume : 0;
    musicMaster.connect(audioCtx.destination);

    const bus = audioCtx.createGain();
    bus.connect(underwaterMaster);

    const lowShelf = audioCtx.createBiquadFilter();
    lowShelf.type = 'lowshelf';
    lowShelf.frequency.value = 95;
    lowShelf.gain.value = 3;

    const lowpass = audioCtx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.value = 300;
    lowpass.Q.value = 0.35;

    const highpass = audioCtx.createBiquadFilter();
    highpass.type = 'highpass';
    highpass.frequency.value = 20;
    highpass.Q.value = 0.35;

    lowShelf.connect(lowpass).connect(highpass).connect(bus);

    const frames = audioCtx.sampleRate * 6;
    const noiseBuffer = audioCtx.createBuffer(1, frames, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    let last = 0;
    for (let i = 0; i < frames; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.012 * white) / 1.012;
      data[i] = last * 3.3;
    }

    const noise = audioCtx.createBufferSource();
    noise.buffer = noiseBuffer;
    noise.loop = true;

    const noiseGain = audioCtx.createGain();
    noiseGain.gain.value = 0.15;
    noise.connect(noiseGain).connect(lowShelf);
    noise.start();

    const sub = audioCtx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = 31;

    const subGain = audioCtx.createGain();
    subGain.gain.value = 0.018;
    sub.connect(subGain).connect(lowShelf);
    sub.start();

    const lfo = audioCtx.createOscillator();
    const lfoGain = audioCtx.createGain();
    lfo.type = 'sine';
    lfo.frequency.value = 0.026;
    lfoGain.gain.value = 34;
    lfo.connect(lfoGain).connect(lowpass.frequency);
    lfo.start();

    underwaterMaster.gain.linearRampToValueAtTime(underwaterVolume, audioCtx.currentTime + 3.6);

    updateAudioVolumes();
    if (musicToggle.checked) {
      ensureMusicLoop();
    }
  } catch (e) {
    console.warn('Audio failed:', e);
  }
}

function playBloomTone() {
  if (!audioCtx || !touchMaster) return;

  const now = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const overtone = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const overtoneGain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();

  osc.type = 'sine';
  osc.frequency.setValueAtTime(92, now);
  osc.frequency.exponentialRampToValueAtTime(54, now + 1.85);

  overtone.type = 'sine';
  overtone.frequency.setValueAtTime(184, now);
  overtone.frequency.exponentialRampToValueAtTime(108, now + 1.85);
  overtoneGain.gain.value = 0.20;

  filter.type = 'lowpass';
  filter.frequency.value = 360;
  filter.Q.value = 0.55;

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.070, now + 0.18);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.95);

  osc.connect(filter);
  overtone.connect(overtoneGain).connect(filter);
  filter.connect(gain).connect(touchMaster);

  osc.start(now);
  overtone.start(now);
  osc.stop(now + 2.0);
  overtone.stop(now + 2.0);
}

function playHarpTone(hitValue = 0) {
  if (!audioCtx || !touchMaster) return;

  const now = audioCtx.currentTime;
  // 기존 음색은 유지하고, 위치별 높낮이 차이만 더 크게.
  const scale = [164.81, 196.00, 220.00, 261.63, 329.63, 392.00, 493.88, 587.33, 698.46];
  const normalized = THREE.MathUtils.clamp(hitValue, 0, 1);
  const idx = THREE.MathUtils.clamp(Math.floor(normalized * (scale.length - 1) + 0.0001), 0, scale.length - 1);
  const freq = scale[idx];

  const carrier = audioCtx.createOscillator();
  const shimmer = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const shimmerGain = audioCtx.createGain();
  const filter = audioCtx.createBiquadFilter();
  const delay = audioCtx.createDelay();
  const feedback = audioCtx.createGain();
  const wet = audioCtx.createGain();

  carrier.type = 'sine';
  carrier.frequency.setValueAtTime(freq, now);
  carrier.frequency.exponentialRampToValueAtTime(freq * 0.992, now + 1.55);

  shimmer.type = 'triangle';
  shimmer.frequency.setValueAtTime(freq * 2.01, now);
  shimmer.frequency.exponentialRampToValueAtTime(freq * 1.985, now + 1.55);
  shimmerGain.gain.value = 0.12;

  filter.type = 'bandpass';
  filter.frequency.value = freq * 1.45;
  filter.Q.value = 1.15;

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.023, now + 0.060);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 1.65);

  delay.delayTime.value = 0.235;
  feedback.gain.value = 0.20;
  wet.gain.value = 0.25;

  carrier.connect(filter);
  shimmer.connect(shimmerGain).connect(filter);
  filter.connect(gain);
  gain.connect(touchMaster);
  gain.connect(delay).connect(feedback).connect(delay);
  delay.connect(wet).connect(touchMaster);

  carrier.start(now);
  shimmer.start(now);
  carrier.stop(now + 1.75);
  shimmer.stop(now + 1.75);
}

settingsButton.addEventListener('click', () => {
  settingsPanel.classList.toggle('hidden');
});

closeSettings.addEventListener('click', () => {
  settingsPanel.classList.add('hidden');
});

underwaterVolumeInput.addEventListener('input', () => {
  underwaterVolume = Number(underwaterVolumeInput.value);
  updateAudioVolumes();
});

musicVolumeInput.addEventListener('input', () => {
  musicVolume = Number(musicVolumeInput.value);
  updateAudioVolumes();
});

touchVolumeInput.addEventListener('input', () => {
  touchVolume = Number(touchVolumeInput.value);
  updateAudioVolumes();
});

musicToggle.addEventListener('change', () => {
  updateAudioVolumes();
  if (musicToggle.checked) {
    ensureMusicLoop();
  } else {
    stopMusicLoop();
  }
});

startButton.addEventListener('click', () => {
  diveStartTime = clock.getElapsedTime() + 0.85;
  setupAudio();
  startOverlay.style.opacity = '0';
  setTimeout(() => startOverlay.remove(), 1100);
});

// ---------- Resize ----------
function resize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  particleMat.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 1.65);
}
window.addEventListener('resize', resize);

// ---------- Animation ----------
const clock = new THREE.Clock();
const jellyTarget = new THREE.Vector3();

function animate() {
  requestAnimationFrame(animate);

  const time = clock.getElapsedTime();
  const introElapsed = diveStartTime === null ? 0 : Math.max(0, time - diveStartTime);
  const introBody = smoothstep(0.10, 2.55, introElapsed);
  const introGlow = introBody;
  const introParticles = smoothstep(0.35, 2.85, introElapsed);
  const approach = smoothstep(2.9, 20.0, introElapsed);

  particleMat.uniforms.uTime.value = time;
  particleMat.uniforms.uReveal.value = introParticles;
  particles.rotation.y = Math.sin(time * 0.018) * 0.08;
  particles.rotation.x = Math.sin(time * 0.012 + 1.2) * 0.035;

  const breathBase = 0.5 + 0.5 * Math.sin(time * 0.62 + Math.sin(time * 0.10) * 0.38);
  const breath = Math.pow(breathBase, 1.35);
  const microPulse = 0.5 + 0.5 * Math.sin(time * 1.34 + 1.2);
  const softPulse = breath * 0.88 + microPulse * 0.12;
  const recoil = 1.0 - breath;

  const swimTime = Math.max(0, time - 2);
  const farX = -0.30 + Math.sin(swimTime * 0.055) * 0.18;
  const nearX = -0.04 + Math.sin(swimTime * 0.070) * 0.34 + Math.sin(swimTime * 0.024) * 0.12;
  const farY = 0.34 + Math.sin(time * 0.095) * 0.055;
  const nearY = 0.20 + Math.sin(time * 0.125) * 0.18 + Math.sin(time * 0.045) * 0.07 + breath * 0.06 - recoil * 0.022;
  const farZ = -5.65 + Math.cos(swimTime * 0.040) * 0.08;
  const nearZ = -3.45 + Math.cos(swimTime * 0.055) * 0.14;

  jellyTarget.set(
    THREE.MathUtils.lerp(farX, nearX, approach),
    THREE.MathUtils.lerp(farY, nearY, approach),
    THREE.MathUtils.lerp(farZ, nearZ, approach)
  );
  jelly.position.lerp(jellyTarget, 0.013);

  jelly.rotation.y += (Math.sin(time * 0.080) * 0.36 - jelly.rotation.y) * 0.022;
  jelly.rotation.z += (Math.sin(time * 0.108) * 0.115 - jelly.rotation.z) * 0.024;
  jelly.rotation.x += (Math.sin(time * 0.088 + 1.4) * 0.065 - jelly.rotation.x) * 0.022;

  bellTouchTarget *= 0.948;
  bellTouchPulse += (bellTouchTarget - bellTouchPulse) * 0.15;
  bellGlowTarget *= 0.950;
  bellGlowWave += (bellGlowTarget - bellGlowWave) * 0.090;
  bellShockTarget *= 0.968;
  bellShockWave += (bellShockTarget - bellShockWave) * 0.082;
  tentacleRubPulse *= 0.90;

  const touchBoost = bellTouchPulse;
  const flashBoost = bellGlowWave;
  const bellPress = softPulse * 0.23 + touchBoost * 0.34;
  const bellExpand = softPulse * 0.17 + touchBoost * 0.24;

  bell.scale.set(1 + bellExpand, 1 - bellPress, 1 + bellExpand);
  bell.position.y = -bellPress * 0.04;
  innerBell.scale.set(1 + softPulse * 0.11 + touchBoost * 0.10, 1 - softPulse * 0.14 - touchBoost * 0.12, 1 + softPulse * 0.11 + touchBoost * 0.10);
  innerBell.position.y = -0.02 - bellPress * 0.03;
  core.scale.set(0.82 + softPulse * 0.12 + touchBoost * 0.08, 1.72 - softPulse * 0.20 - touchBoost * 0.15, 0.62 + softPulse * 0.10 + touchBoost * 0.06);
  core.position.y = -0.42 - bellPress * 0.05;
  capGlow.scale.set(1.05 + softPulse * 0.09 + touchBoost * 0.11 + flashBoost * 0.12, 0.55 + softPulse * 0.04 + touchBoost * 0.05, 0.88 + softPulse * 0.09 + touchBoost * 0.11 + flashBoost * 0.12);
  capGlow.position.y = -0.48 - bellPress * 0.05;
  rim1.scale.set(1 + softPulse * 0.13 + touchBoost * 0.13, 1 + softPulse * 0.13 + touchBoost * 0.13, 0.82);
  rim1.position.y = -0.02 - bellPress * 0.04;
  rim2.scale.set(1 + softPulse * 0.10 + touchBoost * 0.09, 1 + softPulse * 0.10 + touchBoost * 0.09, 0.77);
  rim2.position.y = -0.17 - bellPress * 0.05;
  aura.scale.setScalar(1 + softPulse * 0.08 + touchBoost * 0.14 + flashBoost * 0.08);

  bell.material.opacity = 0.32 * introBody;
  innerBell.material.opacity = (0.22 + flashBoost * 0.06) * introBody;
  capGlow.material.opacity = (0.20 + flashBoost * 0.22) * introBody;
  core.material.opacity = (0.38 + flashBoost * 0.18) * introBody;
  aura.material.opacity = (0.018 + flashBoost * 0.018) * introBody;

  glow1.material.opacity = (0.38 + softPulse * 0.24 + touchBoost * 0.10 + flashBoost * 0.62) * introBody;
  glow2.material.opacity = (0.16 + softPulse * 0.16 + touchBoost * 0.08 + flashBoost * 0.42) * introBody;
  seaGlow.material.opacity = (0.010 + flashBoost * 0.060) * introBody;
  glow1.scale.set(5.2 + flashBoost * 3.5, 5.2 + flashBoost * 3.5, 1);
  glow2.scale.set(2.5 + flashBoost * 1.8, 2.5 + flashBoost * 1.8, 1);
  seaGlow.scale.set(18.0 + flashBoost * 14.0, 18.0 + flashBoost * 14.0, 1);

  bell.material.emissiveIntensity = (1.05 + softPulse * 0.78 + touchBoost * 0.45 + flashBoost * 1.60) * introBody;
  rim1.material.opacity = (0.72 + softPulse * 0.24 + touchBoost * 0.08 + flashBoost * 0.16) * introBody;
  rim2.material.opacity = (0.44 + softPulse * 0.22 + touchBoost * 0.06 + flashBoost * 0.10) * introBody;

  speckGroup.children.forEach((s, i) => {
    s.material.opacity = (0.58 + Math.sin(time * 1.12 + i * 0.41) * 0.20 + flashBoost * 0.10) * introBody;
  });

  dynamicTubes.forEach((tube) => {
    updateTubeMesh(tube, time, breath);

    const fiberTouch = tube.userData.touch || 0;
    tube.userData.touch = fiberTouch * 0.926;
    tube.userData.rub = (tube.userData.rub || 0) * 0.920;
    tube.userData.rubX = (tube.userData.rubX || 0) * 0.900;
    tube.userData.rubY = (tube.userData.rubY || 0) * 0.900;

    if (tube.userData.kind === 'tentacle' || tube.userData.kind === 'hair') {
      tube.material.opacity = (tube.userData.baseOpacity + fiberTouch * 0.34) * introBody;
      tube.material.color.copy(tube.userData.baseColor).lerp(new THREE.Color(0xd8f7ff), Math.min(1, fiberTouch * 0.52));
    } else {
      tube.material.opacity = tube.userData.baseOpacity * introBody;
    }
  });

  tentacleTouchHelpers.forEach((helper, i) => {
    updateTubeMesh(helper, time, breath);
    helper.material.opacity = 0.0;
  });

  radialVeins.forEach((vein, i) => {
    vein.material.opacity = (vein.userData.baseOpacity + flashBoost * 0.07) * introBody;
  });

  bellRibs.forEach((rib, i) => {
    rib.material.opacity = (rib.userData.baseOpacity + flashBoost * 0.11 + Math.sin(time * 0.7 + i * 0.33) * 0.012) * introBody;
  });

  bellBioRings.forEach((ring, i) => {
    const pulse = 0.5 + 0.5 * Math.sin(time * 0.95 + i * 0.8);
    ring.material.opacity = (ring.userData.baseOpacity + flashBoost * (0.34 - i * 0.045) + touchBoost * 0.045 + pulse * 0.018) * introGlow;
    const s = 1 + flashBoost * (0.055 - i * 0.004) + touchBoost * 0.035;
    ring.scale.x = s;
    ring.scale.y = s;
    ring.scale.z = ring.userData.zScale * s;
  });

  rimCells.forEach((cell, i) => {
    cell.material.opacity = (cell.userData.baseOpacity + flashBoost * 0.14 + Math.sin(time * 1.4 + i) * 0.028) * introBody;
  });

  if (typeof innerMembranes !== 'undefined') {
    innerMembranes.forEach((membrane, i) => {
      membrane.material.opacity = (membrane.userData.baseOpacity + flashBoost * 0.035) * introBody;
      membrane.rotation.y = Math.sin(time * 0.12 + membrane.userData.phase) * 0.035;
    });
  }

  seaGlow.position.set(jelly.position.x * 0.20, jelly.position.y - 0.40, jelly.position.z - 0.55);

  jellyLight.position.copy(jelly.position);
  jellyLight.intensity = (14.0 + softPulse * 8.0 + bellTouchPulse * 4.5 + bellGlowWave * 15.0 + tentacleRubPulse * 1.5) * introBody;
  seaTouchLight.position.copy(jelly.position);
  seaTouchLight.intensity = bellGlowWave * 11.5 * introBody;
  seaTouchLight.distance = 100;

  scene.fog.color.copy(baseFogColor).lerp(touchFogColor, Math.min(1, bellGlowWave * 0.72));
  scene.fog.density = THREE.MathUtils.lerp(0.085, 0.074, Math.min(1, bellGlowWave * 0.65));
  renderer.setClearColor(baseClearColor.clone().lerp(touchClearColor, Math.min(1, bellGlowWave * 0.42)), 1);

  controls.yaw += (controls.targetYaw - controls.yaw) * 0.012;
  controls.pitch += (controls.targetPitch - controls.pitch) * 0.012;
  controls.distance += (controls.targetDistance - controls.distance) * 0.016;

  const driftX = Math.sin(time * 0.04) * 0.14 + Math.sin(time * 0.018) * 0.09;
  const driftY = Math.sin(time * 0.05 + 1.8) * 0.06;

  camera.position.set(
    Math.sin(controls.yaw) * controls.distance + driftX,
    0.12 + Math.sin(controls.pitch) * 1.75 + driftY,
    Math.cos(controls.yaw) * controls.distance
  );
  camera.lookAt(0, -0.98, -3.95);
  camera.rotation.z += Math.sin(time * 0.06) * 0.01;

  renderer.render(scene, camera);
}

animate();
