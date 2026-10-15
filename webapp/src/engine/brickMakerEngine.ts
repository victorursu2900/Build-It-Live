// @ts-nocheck
/** Studio Brick Maker — exact screw-block geometry and merged STL output. */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { SCREW_BLOCK } from '../domain/screwBlock';
import { SCREW_GRID, mergeScrewSurfaces, countScrewIslands } from '../domain/mergedScrewGeometry';

const GRID_COLUMNS = SCREW_GRID.columns;
const GRID_ROWS = SCREW_GRID.rows;
const BASE_BRICK_URL = new URL('../assets/blockScrew.stl', import.meta.url).href;
const BASE_BRICK_FILENAME = SCREW_BLOCK.sourceFilename;
const COLORS = {
  paper: 0xf7f6f1,
  ink: 0x0f0f0f,
  accent: 0xe93222,
};

// The bundled STL is the single source of truth for Brick Maker geometry.
// STL files do not encode units, so this project treats its coordinates as mm.
let baseBrickReady = false;
let baseBrickGeometry = null; // Exact normalized source STL, Z-up.
let baseBrickSize = new THREE.Vector3(
  SCREW_BLOCK.dimensions.width, SCREW_BLOCK.dimensions.depth, SCREW_BLOCK.dimensions.height,
); // Fallback only; actual STL bounds remain authoritative.

const grid = document.querySelector('#brickGrid');
const toolButtons = [...document.querySelectorAll('[data-brick-tool]')];
const clearButton = document.querySelector('#brickClear');
const studCount = document.querySelector('#studCount');
const footprint = document.querySelector('#brickFootprint');
const dimensions = document.querySelector('#brickDimensions');
const moduleSpec = document.querySelector('#brickModuleSpec');
const pitchSpec = document.querySelector('#brickPitchSpec');
const sourceSpec = document.querySelector('#brickSourceSpec');
const downloadButton = document.querySelector('#brickDownload');
const status = document.querySelector('#brickStatus');
const previewHost = document.querySelector('#brickPreview');
const previewFitButton = document.querySelector('#brickPreviewFit');

const cells = new Set();
let tool = 'draw';
let painting = false;
let paintValue = true;

function key(x, y) { return `${x},${y}`; }
function parseKey(value) { return value.split(',').map(Number); }
function formatMm(value) {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
}
function pitchX() { return baseBrickSize.x; }
function pitchY() { return baseBrickSize.y; }
function brickHeight() { return baseBrickSize.z; }

function sizeTextOrBounds() {
  return `${formatMm(pitchX())} × ${formatMm(pitchY())} × ${formatMm(brickHeight())} mm`;
}

function getFootprintData() {
  if (!cells.size) return { width: 0, depth: 0, minX: 0, minY: 0, maxX: 0, maxY: 0 };
  const coords = [...cells].map(parseKey);
  const xs = coords.map(([x]) => x);
  const ys = coords.map(([, y]) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    width: maxX - minX + 1,
    depth: maxY - minY + 1,
    minX,
    minY,
    maxX,
    maxY,
  };
}

function setTool(next) {
  tool = next;
  toolButtons.forEach((button) => {
    const active = button.dataset.brickTool === next;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  status.textContent = next === 'draw'
    ? 'DRAW active — place a 40 × 20 mm screw block per cell.'
    : 'ERASE active — remove a screw block from the layout.';
}

// ---------------------------------------------------------------------------
// LIVE 3D PREVIEW
// ---------------------------------------------------------------------------
const previewScene = new THREE.Scene();
previewScene.background = new THREE.Color(COLORS.paper);

const previewCamera = new THREE.PerspectiveCamera(34, 1, 0.1, 10000);
previewCamera.position.set(112, 92, 132);

const previewRenderer = new THREE.WebGLRenderer({ antialias: true });
previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
previewRenderer.toneMappingExposure = 1.05;
// Brick Maker is a floating object viewer, not a scene with a shadow-catching
// floor. Self-shadowing on the intricate STL surface creates false dark wedges
// and bands that resemble extra geometry. Keep directional light for readable
// edges but disable the shadow pass (STL preview and export stay identical).
previewRenderer.shadowMap.enabled = false;
previewHost.appendChild(previewRenderer.domElement);

const previewControls = new OrbitControls(previewCamera, previewRenderer.domElement);
previewControls.enableDamping = true;
previewControls.dampingFactor = 0.075;
previewControls.minDistance = 46;
previewControls.maxDistance = 16000;
previewControls.minPolarAngle = 0.08;
previewControls.maxPolarAngle = Math.PI * 0.92;
previewControls.target.set(0, brickHeight() * 0.42, 0);
previewControls.update();

previewScene.add(new THREE.HemisphereLight(0xffffff, 0xaaa59a, 2.2));
const previewKey = new THREE.DirectionalLight(0xffffff, 3.2);
previewKey.position.set(90, 150, 95);
previewKey.castShadow = false;
previewKey.shadow.mapSize.set(1024, 1024);
previewScene.add(previewKey);
const previewFill = new THREE.DirectionalLight(0xffded6, 1.25);
previewFill.position.set(-90, 70, -65);
previewScene.add(previewFill);
const previewUnderFill = new THREE.DirectionalLight(0xffffff, 1.15);
previewUnderFill.position.set(55, -95, 38);
previewScene.add(previewUnderFill);

let previewGrid = null;
function rebuildPreviewGrid() {
  if (previewGrid) {
    previewScene.remove(previewGrid);
    previewGrid.geometry.dispose();
    previewGrid.material.dispose();
  }
  const width = GRID_COLUMNS * pitchX();
  const depth = GRID_ROWS * pitchY();
  const points = [];
  for (let x = 0; x <= GRID_COLUMNS; x++) {
    const px = x * pitchX() - width / 2;
    points.push(new THREE.Vector3(px, -0.05, -depth / 2), new THREE.Vector3(px, -0.05, depth / 2));
  }
  for (let y = 0; y <= GRID_ROWS; y++) {
    const pz = y * pitchY() - depth / 2;
    points.push(new THREE.Vector3(-width / 2, -0.05, pz), new THREE.Vector3(width / 2, -0.05, pz));
  }
  previewGrid = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(points),
    new THREE.LineBasicMaterial({ color: COLORS.ink, transparent: true, opacity: .12 }),
  );
  previewScene.add(previewGrid);
  if (document.documentElement.dataset.theme === 'dark') {
    previewGrid.material.color.setHex(0xc0c2c8);
    previewGrid.material.opacity = .23;
  }
}
rebuildPreviewGrid();

// Display-only palette: the model's STL and brick color are never changed by the theme.
function applyBrickPreviewTheme() {
  const night = document.documentElement.dataset.theme === 'dark';
  previewScene.background.setHex(night ? 0x191b20 : COLORS.paper);
  if (previewGrid) {
    previewGrid.material.color.setHex(night ? 0xc0c2c8 : COLORS.ink);
    previewGrid.material.opacity = night ? .23 : .12;
  }
}
applyBrickPreviewTheme();
window.addEventListener('bil:theme-change', applyBrickPreviewTheme);

const previewSourceMaterial = new THREE.MeshStandardMaterial({
  color: COLORS.accent,
  roughness: 0.44,
  metalness: 0.01,
  side: THREE.DoubleSide,
});
let previewExactBrick = null;
let previewUnifiedBrick = null;
let pendingPreviewFrame = 0;
let lastFitSignature = '';

function makeUnifiedGeometry() {
  if (!baseBrickGeometry || !cells.size) return null;
  const positions = baseBrickGeometry.getAttribute('position').array;
  const mergedPositions = mergeScrewSurfaces(
    positions,
    [...cells].map(parseKey),
    { width: pitchX(), depth: pitchY(), height: brickHeight() },
  );
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mergedPositions, 3));
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}

function rebuildPreviewSourceGeometry() {
  if (previewUnifiedBrick) {
    previewScene.remove(previewUnifiedBrick);
    previewUnifiedBrick.geometry.dispose();
    previewUnifiedBrick = null;
  }
  if (previewExactBrick) {
    previewScene.remove(previewExactBrick);
    previewExactBrick.geometry.dispose();
    previewExactBrick = null;
  }
  if (!baseBrickGeometry) return;
  const geometry = baseBrickGeometry.clone();
  geometry.rotateX(-Math.PI / 2);
  previewExactBrick = new THREE.Mesh(geometry, previewSourceMaterial);
  previewExactBrick.castShadow = false;
  previewExactBrick.receiveShadow = false;
  previewExactBrick.visible = false;
  previewScene.add(previewExactBrick);
}

function updatePreview() {
  if (pendingPreviewFrame) cancelAnimationFrame(pendingPreviewFrame);
  pendingPreviewFrame = requestAnimationFrame(() => {
    pendingPreviewFrame = 0;
    const bounds = getFootprintData();
    const count = cells.size;
    if (previewExactBrick) previewExactBrick.visible = count === 1;
    if (previewUnifiedBrick) {
      previewScene.remove(previewUnifiedBrick);
      previewUnifiedBrick.geometry.dispose();
      previewUnifiedBrick = null;
    }
    if (count > 1 && baseBrickGeometry) {
      const geometry = makeUnifiedGeometry();
      // STL source: x/y footprint, z up. The viewport uses y up.
      geometry.rotateX(-Math.PI / 2);
      geometry.translate(
        -bounds.width * pitchX() / 2,
        0,
        bounds.depth * pitchY() / 2,
      );
      previewUnifiedBrick = new THREE.Mesh(geometry, previewSourceMaterial);
      previewUnifiedBrick.castShadow = false;
      previewUnifiedBrick.receiveShadow = false;
      previewScene.add(previewUnifiedBrick);
    }
    if (previewGrid) previewGrid.visible = count === 0;
  });
}

function fitPreviewCamera(force = false) {
  const bounds = getFootprintData();
  const signature = `${bounds.width}x${bounds.depth}@${formatMm(pitchX())}x${formatMm(pitchY())}:${previewCamera.aspect.toFixed(3)}`;
  if (!force && signature === lastFitSignature) return;
  lastFitSignature = signature;

  // Perspective fit must account for BOTH the 2:1 physical block and the
  // preview panel's aspect ratio. Previously the 620 mm distance cap clipped
  // wide screw-block layouts when the preview was narrow.
  const spanX = (bounds.width || 5) * pitchX();
  const spanZ = (bounds.depth || 5) * pitchY();
  const radius = 0.5 * Math.hypot(spanX, spanZ, brickHeight());
  const verticalFov = THREE.MathUtils.degToRad(previewCamera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * previewCamera.aspect);
  const narrowFov = Math.min(verticalFov, horizontalFov);
  const distance = THREE.MathUtils.clamp(radius / Math.sin(narrowFov / 2) * 1.15, 90, 14000);
  const direction = previewCamera.position.clone().sub(previewControls.target);
  if (direction.lengthSq() < 0.001) direction.set(1, 0.78, 1.15);
  direction.normalize();

  previewControls.target.set(0, brickHeight() * 0.42, 0);
  previewCamera.position.copy(previewControls.target).addScaledVector(direction, distance);
  previewCamera.near = Math.max(0.1, distance / 1000);
  previewCamera.far = Math.max(1000, distance * 5);
  previewCamera.updateProjectionMatrix();
  previewControls.update();
}

function resizePreview() {
  const width = Math.max(1, previewHost.clientWidth);
  const height = Math.max(1, previewHost.clientHeight);
  previewRenderer.setSize(width, height, false);
  previewCamera.aspect = width / height;
  previewCamera.updateProjectionMatrix();
  fitPreviewCamera();
}

const previewResizeObserver = new ResizeObserver(resizePreview);
previewResizeObserver.observe(previewHost);
resizePreview();

function animatePreview() {
  previewControls.update();
  previewRenderer.render(previewScene, previewCamera);
  requestAnimationFrame(animatePreview);
}
animatePreview();

previewFitButton.addEventListener('click', () => fitPreviewCamera(true));

function updateBrickSpecs() {
  const sizeText = `${formatMm(baseBrickSize.x)} × ${formatMm(baseBrickSize.y)} × ${formatMm(baseBrickSize.z)} mm`;
  if (moduleSpec) moduleSpec.textContent = sizeText;
  if (pitchSpec) pitchSpec.textContent = `${formatMm(pitchX())} × ${formatMm(pitchY())} mm`;
  if (sourceSpec) sourceSpec.textContent = BASE_BRICK_FILENAME;
}

function installBaseBrickGeometry(geometry) {
  geometry.computeBoundingBox();
  const bounds = geometry.boundingBox;
  if (!bounds) throw new Error('The base STL has no valid bounds.');

  // Normalize the uploaded STL without changing its physical scale.
  const centerX = (bounds.min.x + bounds.max.x) / 2;
  const centerY = (bounds.min.y + bounds.max.y) / 2;
  geometry.translate(-centerX, -centerY, -bounds.min.z);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.computeVertexNormals();

  geometry.boundingBox.getSize(baseBrickSize);

  baseBrickGeometry?.dispose();
  baseBrickGeometry = geometry;
  baseBrickReady = true;

  rebuildPreviewGrid();
  rebuildPreviewSourceGeometry();
  updateBrickSpecs();
  updateSummary();
  fitPreviewCamera(true);
  status.textContent = `Source loaded: ${BASE_BRICK_FILENAME} · ${sizeTextOrBounds()} · screw channels preserved.`;
}

function loadBaseBrick() {
  status.textContent = `Loading ${BASE_BRICK_FILENAME}…`;
  const loader = new STLLoader();
  loader.load(
    BASE_BRICK_URL,
    (geometry) => {
      try {
        installBaseBrickGeometry(geometry);
      } catch (error) {
        console.error(error);
        geometry.dispose();
        status.textContent = 'Could not prepare the base brick STL.';
      }
    },
    undefined,
    (error) => {
      console.error('Failed to load base brick STL:', error);
      status.textContent = `Could not load ${BASE_BRICK_FILENAME}.`;
      downloadButton.disabled = true;
    },
  );
}

// ---------------------------------------------------------------------------
// 2D DRAWING + LIVE METRICS
// ---------------------------------------------------------------------------
function updateSummary() {
  const count = cells.size;
  const bounds = getFootprintData();
  studCount.textContent = String(count).padStart(3, '0'); // One cell = one 40 × 20 mm block.
  downloadButton.disabled = count === 0 || !baseBrickReady;

  if (!count) {
    footprint.textContent = '00×00';
    dimensions.textContent = '0 × 0 × 0 mm';
    updatePreview();
    return;
  }

  footprint.textContent = `${String(bounds.width).padStart(2, '0')}×${String(bounds.depth).padStart(2, '0')}`;
  dimensions.textContent = `${formatMm(bounds.width * pitchX())} × ${formatMm(bounds.depth * pitchY())} × ${formatMm(brickHeight())} mm`;

  updatePreview();
}

function paintCell(cell, force = null) {
  const x = Number(cell.dataset.x);
  const y = Number(cell.dataset.y);
  const id = key(x, y);
  const next = force ?? (tool === 'draw');
  const currentlyOn = cells.has(id);
  if (next === currentlyOn) return;

  if (next) cells.add(id);
  else cells.delete(id);
  cell.classList.toggle('is-on', next);
  cell.setAttribute('aria-pressed', String(next));
  updateSummary();
}

for (let y = 0; y < GRID_ROWS; y += 1) {
  for (let x = 0; x < GRID_COLUMNS; x += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'brick-cell';
    button.dataset.x = x;
    button.dataset.y = y;
    button.setAttribute('role', 'gridcell');
    button.setAttribute('aria-label', `Brick ${x + 1}, ${y + 1}`);
    button.setAttribute('aria-pressed', 'false');
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      painting = true;
      paintValue = tool === 'draw';
      paintCell(button, paintValue);
    });
    button.addEventListener('pointerenter', () => {
      if (painting) paintCell(button, paintValue);
    });
    grid.appendChild(button);
  }
}

grid.addEventListener('pointermove', (event) => {
  if (!painting) return;
  const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('.brick-cell');
  if (target && grid.contains(target)) paintCell(target, paintValue);
});

function finishPainting() {
  if (!painting) return;
  painting = false;
  fitPreviewCamera();
}
window.addEventListener('pointerup', finishPainting);
window.addEventListener('pointercancel', finishPainting);

toolButtons.forEach((button) => button.addEventListener('click', () => setTool(button.dataset.brickTool)));
clearButton.addEventListener('click', () => {
  cells.clear();
  grid.querySelectorAll('.brick-cell').forEach((cell) => {
    cell.classList.remove('is-on');
    cell.setAttribute('aria-pressed', 'false');
  });
  updateSummary();
  fitPreviewCamera(true);
  status.textContent = 'Grid cleared.';
});

// ---------------------------------------------------------------------------
// STL EXPORT / HANDOFF
// ---------------------------------------------------------------------------
function buildBrickGroup() {
  if (!baseBrickReady || !baseBrickGeometry || !cells.size) return null;
  const group = new THREE.Group();
  group.name = cells.size === 1 ? 'ExactScrewBlock' : 'UnifiedScrewBlock';
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  // Single-cell result is literally the original STL surface, unmodified.
  const geometry = cells.size === 1 ? baseBrickGeometry.clone() : makeUnifiedGeometry();
  if (!geometry) return null;
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = group.name;
  // Source mesh is centered on X/Y. Unified multi-cell geometry starts at 0,0.
  if (cells.size === 1) mesh.position.set(pitchX() / 2, pitchY() / 2, 0);
  group.add(mesh);
  group.updateMatrixWorld(true);
  group.userData.dispose = () => { geometry.dispose(); material.dispose(); };
  return group;
}

function downloadStl() {
  if (!cells.size || !baseBrickReady) return;
  const group = buildBrickGroup();
  if (!group) return;

  try {
    const stl = new STLExporter().parse(group);
    const blob = new Blob([stl], { type: 'model/stl' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = cells.size === 1 ? 'blockScrew.stl' : `screw-block-merged-${cells.size}-modules.stl`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    status.textContent = cells.size === 1
      ? '3D file saved — exact screw block geometry.'
      : countScrewIslands([...cells].map(parseKey)) === 1
        ? '3D file saved — unified, watertight screw block with no internal walls.'
        : '3D file saved — merged connected blocks; disconnected islands remain separate solids.';
  } finally {
    group.userData.dispose?.();
  }
}

downloadButton.addEventListener('click', downloadStl);
window.addEventListener('keydown', (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return;
  const k = event.key.toLowerCase();
  if (k === 'd') setTool('draw');
  if (k === 'e') setTool('erase');
  if (k === 'c') clearButton.click();
});

setTool('draw');
updateBrickSpecs();
updateSummary();
fitPreviewCamera(true);
loadBaseBrick();
