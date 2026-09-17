import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';

const GRID = 16;
const MODULE_SIZE = 15; // Matches Build It Live: 15 × 15 × 15 mm per occupied cell.
const PITCH = MODULE_SIZE;
const BLOCK_HEIGHT = MODULE_SIZE;
const STUD_RADIUS = 4;
const STUD_HEIGHT = 2;
const COLORS = {
  paper: 0xf7f6f1,
  ink: 0x0f0f0f,
  accent: 0xe93222,
};

const grid = document.querySelector('#brickGrid');
const toolButtons = [...document.querySelectorAll('[data-brick-tool]')];
const clearButton = document.querySelector('#brickClear');
const studCount = document.querySelector('#studCount');
const footprint = document.querySelector('#brickFootprint');
const dimensions = document.querySelector('#brickDimensions');
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
  toolButtons.forEach((button) => button.classList.toggle('is-active', button.dataset.brickTool === next));
  status.textContent = next === 'draw'
    ? 'DRAW active — tap or drag to place studs.'
    : 'ERASE active — tap or drag to remove studs.';
}

// ---------------------------------------------------------------------------
// LIVE 3D PREVIEW
// ---------------------------------------------------------------------------
const previewScene = new THREE.Scene();
previewScene.background = new THREE.Color(COLORS.paper);

const previewCamera = new THREE.PerspectiveCamera(34, 1, 0.1, 1200);
previewCamera.position.set(112, 92, 132);

const previewRenderer = new THREE.WebGLRenderer({ antialias: true });
previewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
previewRenderer.outputColorSpace = THREE.SRGBColorSpace;
previewRenderer.toneMapping = THREE.ACESFilmicToneMapping;
previewRenderer.toneMappingExposure = 1.05;
previewRenderer.shadowMap.enabled = true;
previewRenderer.shadowMap.type = THREE.PCFSoftShadowMap;
previewHost.appendChild(previewRenderer.domElement);

const previewControls = new OrbitControls(previewCamera, previewRenderer.domElement);
previewControls.enableDamping = true;
previewControls.dampingFactor = 0.075;
previewControls.minDistance = 58;
previewControls.maxDistance = 560;
previewControls.minPolarAngle = 0.08;
previewControls.maxPolarAngle = Math.PI * 0.92;
previewControls.target.set(0, BLOCK_HEIGHT * 0.42, 0);
previewControls.update();

previewScene.add(new THREE.HemisphereLight(0xffffff, 0xaaa59a, 2.2));
const previewKey = new THREE.DirectionalLight(0xffffff, 3.2);
previewKey.position.set(90, 150, 95);
previewKey.castShadow = true;
previewKey.shadow.mapSize.set(1024, 1024);
previewScene.add(previewKey);
const previewFill = new THREE.DirectionalLight(0xffded6, 1.25);
previewFill.position.set(-90, 70, -65);
previewScene.add(previewFill);
const previewUnderFill = new THREE.DirectionalLight(0xffffff, 1.15);
previewUnderFill.position.set(55, -95, 38);
previewScene.add(previewUnderFill);

const previewGrid = new THREE.GridHelper(GRID * PITCH, GRID, COLORS.ink, COLORS.ink);
previewGrid.material.transparent = true;
previewGrid.material.opacity = 0.12;
previewGrid.position.y = -0.05;
previewScene.add(previewGrid);

const previewPlateGeometry = new THREE.BoxGeometry(MODULE_SIZE, BLOCK_HEIGHT, MODULE_SIZE);
const previewStudGeometry = new THREE.CylinderGeometry(STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, 28);
const previewPlateMaterial = new THREE.MeshStandardMaterial({
  color: COLORS.accent,
  roughness: 0.55,
  metalness: 0.02,
});
const previewStudMaterial = new THREE.MeshStandardMaterial({
  color: COLORS.accent,
  roughness: 0.42,
  metalness: 0.01,
});

const previewPlateInstances = new THREE.InstancedMesh(
  previewPlateGeometry,
  previewPlateMaterial,
  GRID * GRID,
);
const previewStudInstances = new THREE.InstancedMesh(
  previewStudGeometry,
  previewStudMaterial,
  GRID * GRID,
);
previewPlateInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
previewStudInstances.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
previewPlateInstances.castShadow = true;
previewPlateInstances.receiveShadow = true;
previewStudInstances.castShadow = true;
previewStudInstances.receiveShadow = true;
previewPlateInstances.count = 0;
previewStudInstances.count = 0;
previewScene.add(previewPlateInstances, previewStudInstances);

const matrix = new THREE.Matrix4();
let lastFitSignature = '';

function updatePreview() {
  const count = cells.size;
  const bounds = getFootprintData();
  const centerX = count ? (bounds.minX + bounds.maxX) / 2 : (GRID - 1) / 2;
  const centerY = count ? (bounds.minY + bounds.maxY) / 2 : (GRID - 1) / 2;

  let index = 0;
  for (const id of cells) {
    const [x, y] = parseKey(id);
    const worldX = (x - centerX) * PITCH;
    const worldZ = (y - centerY) * PITCH;

    matrix.makeTranslation(worldX, BLOCK_HEIGHT / 2, worldZ);
    previewPlateInstances.setMatrixAt(index, matrix);

    matrix.makeTranslation(worldX, BLOCK_HEIGHT + STUD_HEIGHT / 2, worldZ);
    previewStudInstances.setMatrixAt(index, matrix);
    index += 1;
  }

  previewPlateInstances.count = count;
  previewStudInstances.count = count;
  previewPlateInstances.instanceMatrix.needsUpdate = true;
  previewStudInstances.instanceMatrix.needsUpdate = true;

  previewGrid.visible = count === 0;
}

function fitPreviewCamera(force = false) {
  const bounds = getFootprintData();
  const signature = `${bounds.width}x${bounds.depth}`;
  if (!force && signature === lastFitSignature) return;
  lastFitSignature = signature;

  const span = Math.max(bounds.width || 7, bounds.depth || 7) * PITCH;
  const distance = THREE.MathUtils.clamp(span * 1.28 + 54, 98, 470);
  const direction = previewCamera.position.clone().sub(previewControls.target);
  if (direction.lengthSq() < 0.001) direction.set(1, 0.78, 1.15);
  direction.normalize();

  previewControls.target.set(0, BLOCK_HEIGHT * 0.42, 0);
  previewCamera.position.copy(previewControls.target).addScaledVector(direction, distance);
  previewCamera.near = Math.max(0.1, distance / 1000);
  previewCamera.far = Math.max(800, distance * 5);
  previewCamera.updateProjectionMatrix();
  previewControls.update();
}

function resizePreview() {
  const width = Math.max(1, previewHost.clientWidth);
  const height = Math.max(1, previewHost.clientHeight);
  previewRenderer.setSize(width, height, false);
  previewCamera.aspect = width / height;
  previewCamera.updateProjectionMatrix();
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

// ---------------------------------------------------------------------------
// 2D DRAWING + LIVE METRICS
// ---------------------------------------------------------------------------
function updateSummary() {
  const count = cells.size;
  const bounds = getFootprintData();
  studCount.textContent = String(count).padStart(3, '0');
  downloadButton.disabled = count === 0;

  if (!count) {
    footprint.textContent = '00×00';
    dimensions.textContent = '0 × 0 × 0 mm';
    updatePreview();
    return;
  }

  footprint.textContent = `${String(bounds.width).padStart(2, '0')}×${String(bounds.depth).padStart(2, '0')}`;
  dimensions.textContent = `${bounds.width * PITCH} × ${bounds.depth * PITCH} × ${BLOCK_HEIGHT + STUD_HEIGHT} mm`;

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

for (let y = 0; y < GRID; y += 1) {
  for (let x = 0; x < GRID; x += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'brick-cell';
    button.dataset.x = x;
    button.dataset.y = y;
    button.setAttribute('role', 'gridcell');
    button.setAttribute('aria-label', `Stud ${x + 1}, ${y + 1}`);
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
  const group = new THREE.Group();
  group.name = 'CustomStudBrick';

  // STL is kept Z-up: rotate the Y-up Three.js primitives onto Z before export.
  const plateGeometry = new THREE.BoxGeometry(MODULE_SIZE, BLOCK_HEIGHT, MODULE_SIZE);
  plateGeometry.rotateX(Math.PI / 2);
  const studGeometry = new THREE.CylinderGeometry(STUD_RADIUS, STUD_RADIUS, STUD_HEIGHT, 32);
  studGeometry.rotateX(Math.PI / 2);
  const material = new THREE.MeshBasicMaterial();

  for (const id of cells) {
    const [x, y] = parseKey(id);
    const plate = new THREE.Mesh(plateGeometry, material);
    plate.position.set((x + 0.5) * PITCH, (y + 0.5) * PITCH, BLOCK_HEIGHT / 2);
    plate.name = `plate_${x}_${y}`;
    group.add(plate);

    const stud = new THREE.Mesh(studGeometry, material);
    stud.position.set((x + 0.5) * PITCH, (y + 0.5) * PITCH, BLOCK_HEIGHT + STUD_HEIGHT / 2);
    stud.name = `stud_${x}_${y}`;
    group.add(stud);
  }

  group.updateMatrixWorld(true);
  group.userData.dispose = () => {
    plateGeometry.dispose();
    studGeometry.dispose();
    material.dispose();
  };
  return group;
}

function downloadStl() {
  if (!cells.size) return;
  const group = buildBrickGroup();
  try {
    const stl = new STLExporter().parse(group);
    const blob = new Blob([stl], { type: 'model/stl' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `custom-brick-${cells.size}-studs.stl`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    status.textContent = `3D file saved — ${cells.size} stud${cells.size === 1 ? '' : 's'}.`;
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
updateSummary();
fitPreviewCamera(true);
