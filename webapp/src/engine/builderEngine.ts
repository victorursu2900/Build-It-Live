// @ts-nocheck
// Different workflows, shared geometry engine. Firmware input only exists on hardware.html.
const BUILDER_MODE = document.documentElement.dataset.builderMode === 'hardware' ? 'hardware' : 'digital';
const IS_HARDWARE_BUILDER = BUILDER_MODE === 'hardware';
// Virtual board remains unavailable: Hardware Builder is for real sensor input.
const HARDWARE_ONLY_EDITION = true;
import { safeModelFilename, surfaceModeFilename } from '../domain/modelFilenames';

/**
 * Migrated original Three.js engine. DOM-driven behaviours remain until
 * the UI state is incrementally moved into dedicated React hooks.
 * This preserves STL / CSG and peripheral hardware behaviour exactly.
 */
import * as THREE from 'three';
import { SmoothWorkerClient } from './SmoothWorkerClient';
import { installStudioTools } from '../studioTools.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { toCreasedNormals } from 'three/addons/utils/BufferGeometryUtils.js';
import { VoxelModel } from '../domain/VoxelModel';
import { validateGridMapping, matchSensorResistance, sensorChannelToCell, hardwareDigitalDimensions } from '../domain/hardwareRules';
import { SCREW_BLOCK } from '../domain/screwBlock';
import { smoothWorkspaceOrigin } from '../domain/smoothWorkspaceFrame';
import { workspaceBlockDimensionsMm } from '../domain/workspaceExport';
import { buildVoxelSurface } from '../domain/voxelSurface';
import { centerWorkspaceBlocks } from '../domain/centerWorkspaceBlocks';
import { getStlPreviewLayout } from '../domain/stlPreviewLayout';
import { embedEditableStateInStl, readEditableStateFromStl } from '../domain/stlEditableState';
import { makeSurfaceViewPreference, restoreModelSurfaceView } from '../domain/surfaceViewPreference';
import { saveImportedMeshSession, loadImportedMeshSession, clearImportedMeshSession } from '../domain/importedMeshSession';
import { restoreRecentModelVault, archiveRecentModels, eraseRecentModel, eraseAllRecentModels, requestDurableBrowserStorage, listEntireProjectLibrary, importProjectLibrary } from '../domain/recentModelVault';
import { buildLibraryBackup, readStoredZipManifest, makeModelThumbnail, summarizeVersionDifference } from '../domain/projectLibraryTools';
import { analyzeBlockPrintability, analyzeTriangleGeometry } from '../domain/printabilityReport';

// -----------------------------------------------------------------------------
// 1. ADJUSTABLE HARDWARE / SIMULATOR CONFIG
// -----------------------------------------------------------------------------
// The physical limits are centralized here. Change MAX_HEIGHT later if your
// analog divider becomes capable of reading taller stacks.
const CONFIG = {
  GRID_SIZE: 16, // maximum coordinate / legacy-file ceiling
  MIN_GRID_SIZE: 1,
  MAX_HEIGHT: 16,
  CELL_SIZE: 1,
  CELL_WIDTH: 2,  // one screw module: 40 mm wide / 20 mm per scene unit
  CELL_DEPTH: 1,  // one screw module: 20 mm deep
  CELL_HEIGHT: 0.925, // screw block: 18.5 mm tall
  WORKSPACE_COLUMNS: 8,
  WORKSPACE_ROWS: 16,
  BLOCK_GAP: 0,
  BASE_HEIGHT: 0.28,

  // One scene unit equals 20 mm. The workspace block is a plain cuboid:
  // 2 × 1 × 0.925 scene units = 40 × 20 × 18.5 mm (not the Brick Maker STL).
  PHYSICAL_BLOCK_MM: 20,
};

const DEFAULT_BLOCK_COLOR = '#e93222';

const COLORS = {
  paper: 0xf1efe9,
  ink: 0x111111,
  accent: 0xe93222,
  support: 0xdde1df,
  invalid: 0xe93222,
  validGhost: 0x111111,
};

// --- HARDWARE PROFILES ---
const HARDWARE_TOLERANCE = 0.25; // ±25% approximate, adjustable after on-board measurements.
const DEFAULT_HARDWARE_CONFIG = {
  boardWidth: 2, boardDepth: 4, digitalWidth: 2, digitalDepth: 4,
  standardResistance: 10, supportResistance: 5.1,
  standardColor: '#e93222', extras: [],
};
let HARDWARE_CONFIG = structuredClone(DEFAULT_HARDWARE_CONFIG);
let BLOCK_PROFILES = [];
function rebuildHardwareProfiles() {
  BLOCK_PROFILES = [
    { resistance: HARDWARE_CONFIG.standardResistance, type: 'standard', color: HARDWARE_CONFIG.standardColor },
    { resistance: HARDWARE_CONFIG.supportResistance, type: 'support', color: '#dde1df' },
    ...HARDWARE_CONFIG.extras.map((entry) => ({ ...entry, type: 'standard' })),
  ];
}
rebuildHardwareProfiles();

// Incoming firmware supplies delta in µS. For R in kΩ, G in µS:
// R = 1000 / G. Prefer the nearest profile within ±25% resistance.
function matchResistanceProfile(measuredUs) {
  return matchSensorResistance(Number(measuredUs), BLOCK_PROFILES, HARDWARE_TOLERANCE);
}

// -----------------------------------------------------------------------------
// 2. PURE DATA MODEL
// -----------------------------------------------------------------------------
const model = new VoxelModel({
  gridSize: CONFIG.GRID_SIZE,
  maxHeight: CONFIG.MAX_HEIGHT,
});
model.setGridDimensions(
  IS_HARDWARE_BUILDER ? HARDWARE_CONFIG.boardWidth : CONFIG.WORKSPACE_COLUMNS,
  IS_HARDWARE_BUILDER ? HARDWARE_CONFIG.boardDepth : CONFIG.WORKSPACE_ROWS,
);

// Rendering never mutates blocks directly. Pointer input asks the model to
// mutate, then syncViewFromModel() redraws strictly from the model snapshot.
let selectedTool = 'standard';
let lastBuildTool = 'standard';
let selectedBlockColor = DEFAULT_BLOCK_COLOR;
// Hardware Builder has no manual placement scope: default to recoloring the model.
// Digital Builder still starts with the NEW blocks scope.
const DEFAULT_RECOLOR_TARGET = IS_HARDWARE_BUILDER ? 'all' : 'new';
let recolorTarget = DEFAULT_RECOLOR_TARGET;
// Eye dropper has a distinct sample → paint lifecycle; it never changes the
// model until the user actually clicks a destination block.
let colorTransferMode = 'off'; // off | pick | paint
let sampledBlockColor = null;
const recolorSelectedKeys = new Set();
let freeMoveBeforeOrganic = false;
let hoveredCandidate = null;
let lastPointerDown = null;

// Optional continuous editing mode. When enabled, left-click + hold paints blocks
// across columns; holding still stacks vertically. Eraser works continuously too.
let continuousBuildEnabled = false;
let continuousStrokeActive = false;
let continuousStrokeDirty = false;
let continuousPointerId = null;
let continuousCurrentColumn = null;
let continuousLastColumnKey = null;
let continuousLastPointer = null;
let continuousHoldTimeout = null;
let continuousHoldInterval = null;
const CONTINUOUS_HOLD_DELAY_MS = 360;
const CONTINUOUS_REPEAT_MS = 220;

// -----------------------------------------------------------------------------
// 3. DOM REFERENCES
// -----------------------------------------------------------------------------
const viewport = document.querySelector('#viewport');
const toolButtons = [...document.querySelectorAll('.tool-button')];
const freeMoveButton = document.querySelector('#freeMoveButton');
const standardToolButton = document.querySelector('[data-tool="standard"]');
const standardColorSwatch = document.querySelector('#standardColorSwatch');
const blockColorPopover = document.querySelector('#blockColorPopover');
const blockColorChoices = [...document.querySelectorAll('[data-block-color]')];
const blockColorName = document.querySelector('#blockColorName');
const blockColorCurrentSwatch = document.querySelector('#blockColorCurrentSwatch');
const blockColorTargetHint = document.querySelector('#blockColorTargetHint');
const blockColorHelp = document.querySelector('#blockColorHelp');
const customColorToggle = document.querySelector('#customColorToggle');
const customColorPanel = document.querySelector('#customColorPanel');
const customColorClose = document.querySelector('#customColorClose');
const customHue = document.querySelector('#customHue');
const customSaturation = document.querySelector('#customSaturation');
const customLightness = document.querySelector('#customLightness');
const customColorPreview = document.querySelector('#customColorPreview');
const customColorHex = document.querySelector('#customColorHex');
const customColorApply = document.querySelector('#customColorApply');
const recolorTargetButtons = [...document.querySelectorAll('[data-color-target]')];
const recolorSelectedCount = document.querySelector('#recolorSelectedCount');
const blockMetric = document.querySelector('#blockMetric');
const gridMetric = document.querySelector('#gridMetric');
const gridSizeSlider = document.querySelector('#gridSizeSlider');
const gridSizeValue = document.querySelector('#gridSizeValue');
const openGridSettingsButton = document.querySelector('#openGridSettings');
const closeGridSettingsButton = document.querySelector('#closeGridSettings');
const gridSettingsPopover = document.querySelector('#gridSettingsPopover');

// Keep Grid Settings in its own compositor layer. When nested inside Live Data,
// backdrop-filter mostly samples the parent card instead of the WebGL scene.
// Portaling the popover to <body> makes the frosted blur visibly match the
// other top-level popup cards.
if (gridSettingsPopover && gridSettingsPopover.parentElement !== document.body) {
  document.body.appendChild(gridSettingsPopover);
}
const heightMetric = document.querySelector('#heightMetric');
const feedbackCard = document.querySelector('.feedback-card');
const feedbackTitle = document.querySelector('#feedbackTitle');
const feedbackText = document.querySelector('#feedbackText');
const systemStatus = document.querySelector('#systemStatus');
const clearBuildButton = document.querySelector('#clearBuild');
const resetViewButton = document.querySelector('#resetView');
const saveBuildButton = document.querySelector('#saveBuild');
const loadBuildButton = document.querySelector('#loadBuild');
const exportBuildButton = document.querySelector('#exportBuild');
const loadBuildInput = document.querySelector('#loadBuildInput');
const saveModal = document.querySelector('#saveModal');
const saveModalBackdrop = document.querySelector('#saveModalBackdrop');
const closeSaveModalButton = document.querySelector('#closeSaveModal');
const exportFormatButtons = [...document.querySelectorAll('[data-export-format]')];
const exportSurfaceButtons = [...document.querySelectorAll('[data-export-surface]')];
const exportSurfaceDescription = document.querySelector('#exportSurfaceDescription');
const exportModelViewValue = document.querySelector('#exportModelViewValue');
const smoothingStrengthControl = document.querySelector('#smoothingStrengthControl');
const smoothingStrengthSlider = document.querySelector('#smoothingStrengthSlider');
const smoothingStrengthValue = document.querySelector('#smoothingStrengthValue');
const smoothingPreviewMount = document.querySelector('#smoothingPreview');
const smoothingPreviewLabel = document.querySelector('#smoothingPreviewLabel');
const realtimeSurfaceButtons = [...document.querySelectorAll('[data-live-surface]')];
const realtimeRenderStatus = document.querySelector('#realtimeRenderStatus');
const realtimeSmoothingControls = document.querySelector('#realtimeSmoothingControls');
let realtimeSmoothingCloseTimer = null;
let realtimeSurfaceTransitionTimer = null;
const realtimeSmoothingSlider = document.querySelector('#realtimeSmoothingSlider');
const realtimeSmoothingValue = document.querySelector('#realtimeSmoothingValue');
const smoothEdgeProfileButtons = [...document.querySelectorAll('[data-smooth-edge-profile]')];
const smoothEdgeProfileHint = document.querySelector('#smoothEdgeProfileHint');
const realtimeSmoothingState = document.querySelector('#realtimeSmoothingState');
const loadModal = document.querySelector('#loadModal');
const loadModalBackdrop = document.querySelector('#loadModalBackdrop');
const closeLoadModalButton = document.querySelector('#closeLoadModal');
const loadFormatButtons = [...document.querySelectorAll('[data-load-format]')];
const loadDropZone = document.querySelector('#loadDropZone');
const undoBuildButton = document.querySelector('#undoBuild');
const redoBuildButton = document.querySelector('#redoBuild');
const continuousToggle = document.querySelector('#continuousToggle');
const continuousStatus = document.querySelector('#continuousStatus');
const layerSlider = document.querySelector('#layerSlider');
const layerValue = document.querySelector('#layerValue');
const showAllLayersButton = document.querySelector('#showAllLayers');
const connectSerialButton = document.querySelector('#connectSerial');
const disconnectSerialButton = document.querySelector('#disconnectSerial');
const serialStatus = document.querySelector('#serialStatus');
const serialBaud = document.querySelector('#serialBaud');
// Inert internal handle retained for the shared hardware engine; no SIMULATE element is rendered.
const simulateHardwareButton = { disabled: true, addEventListener() {} };
const hardwareMenuButton = document.querySelector('#hardwareMenuButton');
const hardwareStandardOhms = document.querySelector('#hardwareStandardOhms');
const hardwareSupportOhms = document.querySelector('#hardwareSupportOhms');
const hardwareDefaultColor = document.querySelector('#hardwareDefaultColor');
const hardwareDefaultHex = document.querySelector('#hardwareDefaultHex');
const hardwareDefaultSwatch = document.querySelector('#hardwareDefaultSwatch');
const hardwareAddProfile = document.querySelector('#hardwareAddProfile');
const hardwareExtraProfiles = document.querySelector('#hardwareExtraProfiles');
const hardwareSubmitLabel = document.querySelector('#hardwareSubmitLabel');
const hardwareSetupFootnote = document.querySelector('#hardwareSetupFootnote');
const hardwareModalStatus = document.querySelector('#hardwareModalStatus');
const hardwareModeTabs = document.querySelector('#hardwareModeTabs');
const hardwareSettingsTab = document.querySelector('#hardwareSettingsTab');
const hardwareSimulatorTab = document.querySelector('#hardwareSimulatorTab');
const hardwareSimulationPanel = document.querySelector('#hardwareSimulationPanel');
const hardwareSimCells = document.querySelector('#hardwareSimCells');
const hardwareSimProfile = document.querySelector('#hardwareSimProfile');
const hardwareSimResistance = document.querySelector('#hardwareSimResistance');
const hardwareSimAdd = document.querySelector('#hardwareSimAdd');
const hardwareSimRemove = document.querySelector('#hardwareSimRemove');
const hardwareSimClear = document.querySelector('#hardwareSimClear');
const hardwareSimFeedback = document.querySelector('#hardwareSimFeedback');
const hardwareSetupModal = document.querySelector('#hardwareSetupModal');
const hardwareSetupForm = document.querySelector('#hardwareSetupForm');
const hardwareSetupError = document.querySelector('#hardwareSetupError');
const hardwareBoardWidth = document.querySelector('#hardwareBoardWidth');
const hardwareBoardDepth = document.querySelector('#hardwareBoardDepth');

const closeHardwareSetupButton = document.querySelector('#closeHardwareSetup');
const hardwareSetupBackdrop = document.querySelector('#hardwareSetupBackdrop');
const cancelHardwareSetupButton = document.querySelector('#cancelHardwareSetup');
const autosaveToggle = document.querySelector('#autosaveToggle');
const autosaveStatus = document.querySelector('#autosaveStatus');
const autosaveMeta = document.querySelector('#autosaveMeta');
const openRecentModelsButton = document.querySelector('#openRecentModels');
const recentModal = document.querySelector('#recentModal');
const recentModalBackdrop = document.querySelector('#recentModalBackdrop');
const closeRecentModalButton = document.querySelector('#closeRecentModal');
const clearRecentModelsButton = document.querySelector('#clearRecentModels');
const recentModelsList = document.querySelector('#recentModelsList');
const backupLibraryButton = document.querySelector('#backupProjectLibrary');
const restoreLibraryButton = document.querySelector('#restoreProjectLibrary');
const restoreLibraryInput = document.querySelector('#restoreProjectLibraryFile');
const libraryStatus = document.querySelector('#projectLibraryStatus');
const printabilityStatus = document.querySelector('#printabilityReport');
let expandedVersionProjectId = null;

/** Styled native dialog: focus trapping, Escape, and backdrop are browser-managed. */
function requestProjectAction({title, description, confirmLabel='CONFIRM', eyebrow='PROJECT LIBRARY / CONFIRM', danger=false, warning='', inputLabel='', inputValue=''}) {
  const dialog = document.querySelector('#projectActionDialog');
  if (!(dialog instanceof HTMLDialogElement)) return Promise.resolve(inputLabel ? null : false);
  if (dialog.open) return Promise.resolve(inputLabel ? null : false);
  const lastFocus = document.activeElement;
  const titleElement = dialog.querySelector('#projectActionTitle');
  const descriptionElement = dialog.querySelector('#projectActionDescription');
  const eyebrowElement = dialog.querySelector('#projectActionEyebrow');
  const warningElement = dialog.querySelector('#projectActionWarning');
  const inputLabelElement = dialog.querySelector('#projectActionInputLabel');
  const input = dialog.querySelector('#projectActionInput');
  const confirmButton = dialog.querySelector('#projectActionConfirm');
  const cancelButton = dialog.querySelector('#projectActionCancel');
  const closeButton = dialog.querySelector('#projectActionClose');
  titleElement.textContent = title;
  descriptionElement.textContent = description;
  eyebrowElement.textContent = eyebrow;
  warningElement.textContent = warning;
  warningElement.hidden = !warning;
  inputLabelElement.hidden = !inputLabel;
  inputLabelElement.firstChild.textContent = inputLabel ? `${inputLabel} ` : '';
  input.value = inputValue;
  confirmButton.textContent = confirmLabel;
  dialog.classList.toggle('is-danger', danger);
  return new Promise((resolve) => {
    let settled = false;
    const cleanup = () => {
      confirmButton.removeEventListener('click', confirm);
      cancelButton.removeEventListener('click', cancel);
      closeButton.removeEventListener('click', cancel);
      dialog.removeEventListener('cancel', onEscape);
      dialog.removeEventListener('click', onBackdrop);
      input.removeEventListener('keydown', onInputKeydown);
    };
    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (dialog.open) dialog.close();
      if (lastFocus instanceof HTMLElement && lastFocus.isConnected) lastFocus.focus({preventScroll:true});
      resolve(result);
    };
    const confirm = () => finish(inputLabel ? input.value.trim().slice(0,55) : true);
    const cancel = () => finish(inputLabel ? null : false);
    const onEscape = (event) => { event.preventDefault(); cancel(); };
    const onBackdrop = (event) => {
      if (event.target !== dialog) return;
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) cancel();
    };
    const onInputKeydown = (event) => { if (event.key === 'Enter') { event.preventDefault(); confirm(); } };
    confirmButton.addEventListener('click', confirm);
    cancelButton.addEventListener('click', cancel);
    closeButton.addEventListener('click', cancel);
    dialog.addEventListener('cancel', onEscape);
    dialog.addEventListener('click', onBackdrop);
    input.addEventListener('keydown', onInputKeydown);
    dialog.showModal();
    (inputLabel ? input : danger ? cancelButton : confirmButton).focus();
    if (inputLabel) input.select();
  });
}


// View-only layer filter. null = show the complete model.
let layerEditEnabled = false;
let activeLayerView = null;
let modelDimensionsVisible=false,measurementUnit='mm',measurementBox=null;
let measurementCardAnimation=null,measurementCardClosing=false,measurementCardGeneration=0;
let exportSurfaceMode = 'voxel';
let smoothingStrength = 3;
let smoothEdgeProfile = 'classic'; // 'classic' preserves V135 geometry; 'rounded' softens stairs and concave joins.

// Undo/redo stores pure model snapshots, never Three.js objects.
const HISTORY_LIMIT = 100;
let history = [model.getBlocks()];
let historyIndex = 0;

// Browser persistence: latest autosave + a persistent, user-managed library of projects.
const AUTOSAVE_STORAGE_KEY = `digital-twin.${BUILDER_MODE}.autosave.v1`;
const AUTOSAVE_PREF_STORAGE_KEY = `digital-twin.${BUILDER_MODE}.autosave-enabled.v1`;
const SURFACE_VIEW_STORAGE_KEY = `digital-twin.${BUILDER_MODE}.active-surface-view.v1`;
const ACTIVE_WORKSPACE_KIND_KEY = `digital-twin.${BUILDER_MODE}.active-workspace-kind.v1`;
const RECENT_MODELS_STORAGE_KEY = `digital-twin.${BUILDER_MODE}.recent-models.v1`;
const ACTIVE_RECENT_MODEL_STORAGE_KEY = `digital-twin.${BUILDER_MODE}.active-recent-model-id.v1`;
const STL_EXPORT_REGISTRY_STORAGE_KEY = 'digital-twin.stl-export-registry.v1';
const EDITABLE_STL_HASH_REGISTRY_KEY = 'digital-twin.exact-stl-hash-registry.v1';
const STL_EXPORT_REGISTRY_LIMIT = 16;
// A small synchronous cache keeps the page responsive while the full unlimited
// library is restored from IndexedDB. No saved project is removed by age/count.
const RECENT_MODELS_LOCAL_CACHE_LIMIT = 12;
let recentModelsMemory = null;
const deletedRecentIdsDuringHydration = new Set();
let clearedRecentsDuringHydration = false;
// Bring existing V44 digital projects into the new namespace on first use.
if (!IS_HARDWARE_BUILDER) {
  const oldKeys = [
    ['digital-twin.autosave.v1', AUTOSAVE_STORAGE_KEY],
    ['digital-twin.autosave-enabled.v1', AUTOSAVE_PREF_STORAGE_KEY],
    ['digital-twin.recent-models.v1', RECENT_MODELS_STORAGE_KEY],
    ['digital-twin.active-recent-model-id.v1', ACTIVE_RECENT_MODEL_STORAGE_KEY],
  ];
  try {
    for (const [legacy, next] of oldKeys) {
      if (window.localStorage.getItem(next) === null) {
        const saved = window.localStorage.getItem(legacy);
        if (saved !== null) window.localStorage.setItem(next, saved);
      }
    }
  } catch { /* Private browsing or disabled storage: existing fallback handles this. */ }
}
const AUTOSAVE_DELAY_MS = 900;
let autosaveTimer = null;
let storageEnabled = true;
let autosaveEnabled = true;
let activeRecentModelId = null;
let importedProjectName = null;

// Web Serial runtime state. Hardware messages update the same VoxelModel.
let serialPort = null;
let serialReader = null;
let serialReadTask = null;
let serialKeepReading = false;
let serialBuffer = '';
let serialConnected = false;
let simulationActive = false;
let hardwareConnectionTarget = 'esp';
let hardwareSetupMode = 'start';
let simulationSelectedChannel = 0;
let serialSetupPending = false;
let resolveHardwareSetup = null;
let hardwareSetupCloseTimer = null;

// Keep UI labels bound to the same config as the model.
gridMetric.textContent = `${model.gridWidth}×${model.gridDepth}`;
if (gridSizeSlider) gridSizeSlider.value = String(model.gridWidth);
if (gridSizeValue) gridSizeValue.textContent = String(model.gridWidth).padStart(2, '0');
heightMetric.textContent = `00/${String(CONFIG.MAX_HEIGHT).padStart(2, '0')}`;

// -----------------------------------------------------------------------------
// 4. THREE.JS SCENE
// -----------------------------------------------------------------------------
const scene = new THREE.Scene();
const layerRepairMarkers=new THREE.Group();scene.add(layerRepairMarkers);
let repairBlinkUntil=0;
scene.background = new THREE.Color(COLORS.paper);
// Fog disabled so the grid remains crisp even when zoomed far out.
scene.fog = null;

const camera = new THREE.PerspectiveCamera(
  38,
  Math.max(1, viewport.clientWidth) / Math.max(1, viewport.clientHeight),
  0.1,
  100,
);

const defaultCameraPosition = new THREE.Vector3(16, 15, 19);
camera.position.copy(defaultCameraPosition);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// Let the layout own the canvas CSS dimensions from the very first frame.
// Otherwise Three.js writes a fixed pixel width and the canvas jumps when the rails settle.
renderer.setSize(Math.max(1, viewport.clientWidth), Math.max(1, viewport.clientHeight), false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
viewport.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.07;
controls.target.set(0, 2.2, 0);
controls.minDistance = 9;
controls.maxDistance = 40;
controls.maxPolarAngle = Math.PI * 0.49;
controls.update();

// Bright, soft illumination for an approachable prototype environment.
scene.add(new THREE.HemisphereLight(0xffffff, 0xaaa59a, 2.2));

const keyLight = new THREE.DirectionalLight(0xffffff, 3.4);
keyLight.position.set(10, 18, 8);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(4096, 4096);
// Restrict depth range and offset the receiver slightly to avoid repeating
// self-shadow stripes on coplanar walls, terraces and rounded boundaries.
keyLight.shadow.camera.near=.5;
keyLight.shadow.camera.far=70;
keyLight.shadow.bias=-.00006;
keyLight.shadow.normalBias=.025;
keyLight.shadow.camera.left = -13;
keyLight.shadow.camera.right = 13;
keyLight.shadow.camera.top = 13;
keyLight.shadow.camera.bottom = -13;
scene.add(keyLight);

const fillLight = new THREE.DirectionalLight(0xffdfd7, 1.2);
fillLight.position.set(-12, 9, -8);
scene.add(fillLight);

// -----------------------------------------------------------------------------
// 5. BASE + GRID
// -----------------------------------------------------------------------------
const baseMaterial = new THREE.MeshStandardMaterial({
  color: 0xe6e2d9,
  roughness: 0.82,
  metalness: 0,
});

const baseMesh = new THREE.Mesh(
  new THREE.BoxGeometry(
    model.gridWidth * CONFIG.CELL_WIDTH + 0.28,
    CONFIG.BASE_HEIGHT,
    model.gridDepth * CONFIG.CELL_DEPTH + 0.28,
  ),
  baseMaterial,
);
baseMesh.position.y = -CONFIG.BASE_HEIGHT / 2;
baseMesh.receiveShadow = true;
baseMesh.userData.kind = 'base';
scene.add(baseMesh);

function makeRectangularGrid() {
  const width = model.gridWidth * CONFIG.CELL_WIDTH;
  const depth = model.gridDepth * CONFIG.CELL_DEPTH;
  const coords = [];
  for (let col = 0; col <= model.gridWidth; col += 1) {
    const x = col * CONFIG.CELL_WIDTH - width / 2;
    coords.push(x, 0.004, -depth / 2, x, 0.004, depth / 2);
  }
  for (let row = 0; row <= model.gridDepth; row += 1) {
    const z = row * CONFIG.CELL_DEPTH - depth / 2;
    coords.push(-width / 2, 0.004, z, width / 2, 0.004, z);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(coords, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
    color: COLORS.ink, opacity: 0.36, transparent: true,
  }));
}
let gridHelper = makeRectangularGrid();
scene.add(gridHelper);

function updateGridSceneGeometry() {
  baseMesh.geometry.dispose();
  baseMesh.geometry = new THREE.BoxGeometry(
    model.gridWidth * CONFIG.CELL_WIDTH + 0.28,
    CONFIG.BASE_HEIGHT,
    model.gridDepth * CONFIG.CELL_DEPTH + 0.28,
  );
  scene.remove(gridHelper);
  gridHelper.geometry.dispose();
  gridHelper.material.dispose();
  gridHelper = makeRectangularGrid();
  scene.add(gridHelper);
  applyBuilderSceneTheme();
}

// A large invisible-ish ground plane catches shadows without affecting picking.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(80, 80),
  new THREE.ShadowMaterial({ color: 0x000000, opacity: 0.11 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -CONFIG.BASE_HEIGHT - 0.01;
ground.receiveShadow = true;
scene.add(ground);

// Theme changes only the display environment, never saved block colors or export geometry.
function applyBuilderSceneTheme() {
  const night = document.documentElement.dataset.theme === 'dark';
  scene.background.setHex(night ? 0x17191e : COLORS.paper);
  baseMaterial.color.setHex(night ? 0x303239 : 0xe6e2d9);
  gridHelper.material.color.setHex(night ? 0xa2a6ac : COLORS.ink);
  gridHelper.material.opacity = night ? .31 : .36;
  ground.material.opacity = night ? .19 : .11;
}
applyBuilderSceneTheme();
window.addEventListener('bil:theme-change', applyBuilderSceneTheme);

// -----------------------------------------------------------------------------
// 6. BLOCK VISUALS
// -----------------------------------------------------------------------------
const blocksGroup = new THREE.Group();
scene.add(blocksGroup);

// Real-time Organic Print surface. This uses the same reconstruction math as
// export, but at an interactive sampling quality. The editable voxel model stays
// authoritative; this group is only a live rendering of that state.
const realtimeOrganicGroup = new THREE.Group();
realtimeOrganicGroup.name = 'RealtimeOrganicPrint';
scene.add(realtimeOrganicGroup);
let realtimeOrganicObject = null;
let realtimeSmoothTimer = null;
let realtimeSmoothRevision = 0;
const REALTIME_SMOOTH_DELAY_MS = 250;
let smoothOriginalOutline=false;
const smoothGeometryCache=new Map();
const smoothWorker=new SmoothWorkerClient();
let realtimeSmoothBusy=false,queuedLiveSmooth=false,realtimeSmoothTask=null;
window.addEventListener('pagehide',()=>smoothWorker.dispose());
window.addEventListener('pageshow',event=>{if(event.persisted)scheduleRealtimeOrganicSurface({immediate:true});});
const smoothOutlineGroup=new THREE.Group();scene.add(smoothOutlineGroup);

// The standard geometric prisms are hidden while SMOOTH is visible. Support
// prisms and their outlines remain readable; the voxel model stays canonical.

// Exact STL round-trip mode. STL does not carry editable voxel metadata, so
// loading an STL keeps its triangle mesh verbatim instead of reconstructing
// cubes and changing the saved surface.
const exactStlGroup = new THREE.Group();
exactStlGroup.name = 'ExactImportedStl';
scene.add(exactStlGroup);
let exactImportedStl = null;
// A smooth STL without editable metadata cannot identify original Standard /
// Support cubes. Never invent a voxel model and present it as the authored build.
// In Blocks mode, show the *same exact triangle mesh* with a reference grid.
// The mesh is never replaced or edited until original .BIL/STL state is loaded.
function isApproximateBlockPreview() { return false; }
function isImportedGridReferenceView() { return Boolean(exactImportedStl && exportSurfaceMode === 'voxel'); }
const exactStlMaterial = new THREE.MeshStandardMaterial({
  color: COLORS.accent,
  roughness: 0.52,
  metalness: 0.01,
  flatShading: true,
});

// STL fallback: a surface-aligned reference grid, NOT reconstructed blocks.
// Lines are a render-only effect. No vertex is moved and no new cube is claimed.
const exactStlGridOrigin = new THREE.Vector3();
const exactStlGridPitch = new THREE.Vector3(CONFIG.CELL_WIDTH, CONFIG.CELL_HEIGHT, CONFIG.CELL_DEPTH);
const exactStlGridMaterial = exactStlMaterial.clone();
exactStlGridMaterial.onBeforeCompile = (shader) => {
  shader.uniforms.bilGridOrigin = { value: exactStlGridOrigin };
  shader.uniforms.bilGridPitch = { value: exactStlGridPitch };
  shader.vertexShader = shader.vertexShader.replace('void main() {',
    'varying vec3 vBilGridPos;\nvoid main() {\n  vBilGridPos = position;');
  shader.fragmentShader = 'varying vec3 vBilGridPos;\nuniform vec3 bilGridOrigin;\nuniform vec3 bilGridPitch;\n' + shader.fragmentShader;
  shader.fragmentShader = shader.fragmentShader.replace('#include <dithering_fragment>', `
    // Anti-aliased stripes where the imported surface intersects nominal
    // 40 x 20 x 18.5 mm grid planes; never mistaken for saved block boundaries.
    vec3 grid = (vBilGridPos - bilGridOrigin) / bilGridPitch;
    vec3 d = abs(fract(grid + 0.5) - 0.5);
    vec3 aa = max(fwidth(grid), vec3(0.001));
    vec3 edges = vec3(1.0) - smoothstep(aa * 0.55, aa * 1.8, d);
    float line = max(edges.x, max(edges.y, edges.z));
    gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(0.12, 0.10, 0.10), line * 0.47);
    #include <dithering_fragment>
  `);
};

const blockGeometry = new THREE.BoxGeometry(
  CONFIG.CELL_WIDTH - CONFIG.BLOCK_GAP,
  CONFIG.CELL_HEIGHT - CONFIG.BLOCK_GAP,
  CONFIG.CELL_DEPTH - CONFIG.BLOCK_GAP,
);
const blockEdgesGeometry = new THREE.EdgesGeometry(blockGeometry);

// Both Builders render rectangular workspace blocks. Their exports use the
// same cuboid footprint and height, never the detailed Brick Maker screw STL.
// STLLoader is kept solely for users importing an existing, exact STL mesh.


const standardMaterial = new THREE.MeshStandardMaterial({
  color: COLORS.accent,
  roughness: 0.58,
  metalness: 0.02,
});

const standardMaterialCache = new Map([[DEFAULT_BLOCK_COLOR, standardMaterial]]);

function normalizeStandardBlockColor(value, fallback = DEFAULT_BLOCK_COLOR) {
  const text = String(value ?? '').trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(text) ? text : fallback;
}

function modelBlockKey(x, y, z) {
  return `${x},${y},${z}`;
}

function usesDarkSelectionOutline(color) {
  const hex = normalizeStandardBlockColor(color).slice(1);
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.58;
}

function getStandardBlockMaterial(color) {
  const key = normalizeStandardBlockColor(color);
  if (standardMaterialCache.has(key)) return standardMaterialCache.get(key);
  const material = new THREE.MeshStandardMaterial({
    color: key,
    roughness: 0.58,
    metalness: 0.02,
  });
  standardMaterialCache.set(key, material);
  return material;
}

const supportMaterial = new THREE.MeshStandardMaterial({
  color: COLORS.support,
  transparent: true,
  opacity: 0.32,
  roughness: 0.34,
  metalness: 0.02,
  depthWrite: false,
});

const supportEdgeMaterial = new THREE.LineBasicMaterial({
  color: COLORS.ink,
  transparent: true,
  opacity: 0.98,
});

const recolorSelectionDarkMaterial = new THREE.LineBasicMaterial({
  color: 0x111111,
  transparent: true,
  opacity: 0.95,
  depthTest: false,
});
const recolorSelectionLightMaterial = new THREE.LineBasicMaterial({
  color: 0xffffff,
  transparent: true,
  opacity: 0.98,
  depthTest: false,
});

// Ghost = transparent fill + crisp outline.
const ghostMaterial = new THREE.MeshBasicMaterial({
  color: COLORS.validGhost,
  transparent: true,
  opacity: 0.075,
  depthWrite: false,
});

const ghostEdgeMaterial = new THREE.LineBasicMaterial({
  color: COLORS.validGhost,
  transparent: true,
  opacity: 0.95,
});

const ghost = new THREE.Group();
const ghostFill = new THREE.Mesh(blockGeometry, ghostMaterial);
const ghostEdges = new THREE.LineSegments(blockEdgesGeometry, ghostEdgeMaterial);
ghost.add(ghostFill, ghostEdges);
ghost.visible = false;
scene.add(ghost);

/** Model coordinates -> Three.js world coordinates.
 * Model z is vertical, while Three.js uses world Y as vertical.
 */
function modelToWorld(x, y, z) {
  return new THREE.Vector3(
    (x - (model.gridWidth - 1) / 2) * CONFIG.CELL_WIDTH,
    z * CONFIG.CELL_HEIGHT + CONFIG.CELL_HEIGHT / 2,
    ((model.gridDepth - 1) / 2 - y) * CONFIG.CELL_DEPTH,
  );
}

function disposeExactStlDisplay() {
  exactStlGroup.traverse((object) => {
    if (object.isMesh && object.geometry) object.geometry.dispose();
  });
  exactStlGroup.clear();
}

function clearExactStlMode() {
  disposeExactStlDisplay();
  exactImportedStl?.rawGeometry?.dispose?.();
  exactImportedStl = null;
  exactStlGroup.visible = true;
  blocksGroup.visible = true;
}

function activateExactStlMode({ buffer, geometry, gridSize }) {
  clearExactStlMode();

  geometry.computeBoundingBox();
  const box = geometry.boundingBox?.clone() ?? new THREE.Box3();
  const sizeMm = new THREE.Vector3();
  box.getSize(sizeMm);

  const displayGeometry = geometry.clone();
  const position = displayGeometry.getAttribute('position');
  // STL has no workspace origin. Center its actual XY bounding box and rest
  // its lowest Z point on the virtual base. This also handles negative or
  // non-zero coordinates from Bambu/other slicers without moving vertices in
  // the original STL file (which stays available for a lossless re-export).
  const placement = getStlPreviewLayout({ min: box.min, max: box.max }, CONFIG.PHYSICAL_BLOCK_MM);
  for (let index = 0; index < position.count; index += 1) {
    const xMm = position.getX(index);
    const yMm = position.getY(index);
    const zMm = position.getZ(index);
    const [wx, wy, wz] = placement.toWorld(xMm, yMm, zMm);
    position.setXYZ(index, wx, wy, wz);
  }
  position.needsUpdate = true;
  displayGeometry.deleteAttribute('normal');
  displayGeometry.computeVertexNormals();
  displayGeometry.computeBoundingBox();
  displayGeometry.computeBoundingSphere();

  // Align the reference grid symmetrically around the STL bounds. This does
  // not imply recovered construction cells; it is only a visual scale guide.
  exactStlGridOrigin.set(
    -placement.gridWidth * CONFIG.CELL_WIDTH / 2,
    0,
    -placement.gridDepth * CONFIG.CELL_DEPTH / 2,
  );
  const mesh = new THREE.Mesh(displayGeometry,
    exportSurfaceMode === 'voxel' ? exactStlGridMaterial : exactStlMaterial);
  mesh.name = 'exact_stl_mesh';
  // Imported smooth surfaces have dense self-intersecting/tight geometry;
  // self-shadow maps introduce false dark artifacts without adding shape detail.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.userData.kind = 'exact-stl';
  exactStlGroup.add(mesh);

  exactImportedStl = {
    originalBuffer: buffer.slice(0),
    rawGeometry: geometry,
    gridSize,
    minimumColumns: placement.gridWidth,
    minimumRows: placement.gridDepth,
    heightMm: Math.max(0, sizeMm.z),
  };
  exactStlGroup.visible = true;
  blocksGroup.visible = false;
  ghost.visible = false;
  hoveredCandidate = null;
}

/** World point on the base -> integer model grid coordinate. */
function worldToBaseCell(point) {
  const x = Math.floor((point.x + model.gridWidth * CONFIG.CELL_WIDTH / 2) / CONFIG.CELL_WIDTH);
  const y = Math.floor((model.gridDepth * CONFIG.CELL_DEPTH / 2 - point.z) / CONFIG.CELL_DEPTH);
  return { x, y, z: 0 };
}

function cloneBlocks(blocks = model.getBlocks()) {
  return blocks.map((block) => ({ ...block }));
}

function clampGridSize(value) {
  const numeric = Math.round(Number(value));
  if (!Number.isFinite(numeric)) return model.gridWidth;
  return Math.min(CONFIG.WORKSPACE_COLUMNS, Math.max(CONFIG.MIN_GRID_SIZE, numeric));
}

function getRequiredGridSize(blocks = []) {
  if (!blocks.length) return CONFIG.MIN_GRID_SIZE;
  const maxCoordinate = Math.max(...blocks.flatMap((block) => [Number(block.x) || 0, Number(block.y) || 0]));
  return clampGridSize(maxCoordinate + 1);
}

function setRangeProgress(slider) {
  if (!slider) return;
  const min = Number(slider.min || 0);
  const max = Number(slider.max || 100);
  const value = Number(slider.value);
  const progress = max > min ? ((value - min) / (max - min)) * 100 : 0;
  slider.style.setProperty('--range-progress', `${THREE.MathUtils.clamp(progress, 0, 100)}%`);
}

function updateGridUi() {
  gridMetric.textContent = `${model.gridWidth}×${model.gridDepth}`;
  if (gridSizeSlider) {
    gridSizeSlider.value = String(Math.min(CONFIG.WORKSPACE_COLUMNS, model.gridWidth));
    setRangeProgress(gridSizeSlider);
  }
  if (gridSizeValue) gridSizeValue.textContent = String(model.gridWidth).padStart(2, '0');
}

function restoreRectangularDimensions(width, depth) {
  const w = Number(width);
  const d = Number(depth);
  if (!Number.isInteger(w) || !Number.isInteger(d) || w < 1 || w > CONFIG.WORKSPACE_COLUMNS || d < 1 || d > CONFIG.WORKSPACE_ROWS) return;
  if (model.gridWidth === w && model.gridDepth === d) return;
  model.setGridDimensions(w, d);
  updateGridSceneGeometry();
  updateGridUi();
}

function setActiveGridSize(value, { preserveBlocks = true, silent = false, autosave = true } = {}) {
  const nextSize = clampGridSize(value);
  // An imported STL is displayed as its original centered triangle surface.
  // Users may enlarge the workspace without altering that surface; only
  // shrinking below its footprint is disallowed. Editable original blocks
  // can only be restored from a project with saved Standard/Support data.
  if (exactImportedStl && preserveBlocks &&
      (nextSize < exactImportedStl.minimumColumns || nextSize * 2 < exactImportedStl.minimumRows)) {
    updateGridUi();
    if (!silent) setFeedback('GRID TOO SMALL', `Imported mesh needs at least ${exactImportedStl.minimumColumns}×${exactImportedStl.minimumRows} cells. Increase the grid size.`, true);
    return false;
  }
  if (model.gridWidth === nextSize && model.gridDepth === nextSize * 2) {
    updateGridUi();
    return true;
  }

  if ((serialConnected || simulationActive) && preserveBlocks) {
    updateGridUi();
    if (!silent) setFeedback('HARDWARE MODE', 'Disconnect the ESP32 before resizing the digital build area.', true);
    return false;
  }

  const currentBlocks = cloneBlocks();
  const fitted = preserveBlocks && !IS_HARDWARE_BUILDER
    ? centerWorkspaceBlocks(currentBlocks, nextSize, nextSize * 2)
    : { fits: true, shifted: false, offsetX: 0, offsetY: 0, blocks: currentBlocks };

  if (!fitted.fits) {
    updateGridUi();
    if (!silent) {
      setFeedback(
        'GRID TOO SMALL',
        `The current footprint does not fit inside ${nextSize}×${nextSize * 2}. Erase or compact the build first.`,
        true,
      );
    }
    return false;
  }

  model.setGridDimensions(nextSize, nextSize * 2);
  if (preserveBlocks) {
    model.replaceExact(fitted.blocks);
    // Selected blocks follow the same translation as the geometry, so a grid
    // resize cannot leave selection/highlighting pointing at old positions.
    if (fitted.shifted && recolorSelectedKeys.size) {
      const shiftedSelection = [...recolorSelectedKeys].map(key => {
        const [x, y, z] = key.split(',').map(Number);
        return modelBlockKey(x + fitted.offsetX, y + fitted.offsetY, z);
      });
      recolorSelectedKeys.clear();
      shiftedSelection.forEach(key => recolorSelectedKeys.add(key));
      updateRecolorTargetUi();
    }
  }

  updateGridSceneGeometry();
  updateGridUi();
  ghost.visible = false;
  hoveredCandidate = null;
  setLayerView(0);
  syncViewFromModel();

  if (preserveBlocks) resetHistoryToCurrent();
  if (exactImportedStl?.sessionId && preserveBlocks) {
    void saveImportedMeshSession({
      buffer: exactImportedStl.originalBuffer,
      id: exactImportedStl.sessionId,
      gridSize: nextSize,
      gridWidth: model.gridWidth,
      gridDepth: model.gridDepth,
    });
  }
  if (autosave && preserveBlocks) scheduleAutosave();

  if (!silent) {
    systemStatus.textContent = `GRID ${nextSize}×${nextSize * 2}`;
    setFeedback(
      'GRID RESIZED',
      fitted.shifted
        ? `Grid resized to ${nextSize}×${nextSize * 2}. Your existing model is centered in the new build area.`
        : `Active build area is now ${nextSize}×${nextSize * 2}.`,
    );
  }

  return true;
}

function snapshotSignature(blocks) {
  return JSON.stringify(blocks);
}

function safeStorageRead(key, fallback = null) {
  if (!storageEnabled) return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (error) {
    console.warn('Browser storage unavailable:', error);
    storageEnabled = false;
    return fallback;
  }
}

function safeStorageWrite(key, value) {
  // Recent Models have a separate IndexedDB archive and must not be limited by
  // localStorage size or the Autosave toggle.
  if (key === RECENT_MODELS_STORAGE_KEY) return saveRecentLibrary(value);
  if (!storageEnabled) return false;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (error) {
    console.warn('Could not write browser storage:', error);
    storageEnabled = false;
    return false;
  }
}

function safeStorageRemove(key) {
  if (!storageEnabled) return;
  try {
    window.localStorage.removeItem(key);
  } catch (error) {
    console.warn('Could not clear browser storage:', error);
    storageEnabled = false;
  }
}

function saveRecentLibrary(recents) {
  recentModelsMemory = recents;
  // Archive every project. Missing IDs are never deleted automatically.
  void archiveRecentModels(BUILDER_MODE, recents).then((archived) => {
    if (archived || recentModelsMemory !== recents || !storageEnabled) return;
    // If IndexedDB is blocked, attempt to preserve the full gallery in
    // localStorage instead of silently retaining only the recent cache.
    try {
      window.localStorage.setItem(RECENT_MODELS_STORAGE_KEY, JSON.stringify(recents));
      setAutosaveUi('saved', 'Local library fallback / back up .BIL files');
    } catch (error) {
      console.warn('Project library storage is full:', error);
      setAutosaveUi('error', 'Project storage full — back up .BIL files');
    }
  });
  if (!storageEnabled) return typeof indexedDB !== 'undefined';
  try {
    // localStorage is only the quick-loading cache. IndexedDB keeps all IDs.
    const cache = typeof indexedDB !== 'undefined'
      ? recents.slice(0, RECENT_MODELS_LOCAL_CACHE_LIMIT)
      : recents;
    window.localStorage.setItem(RECENT_MODELS_STORAGE_KEY, JSON.stringify(cache));
    return true;
  } catch (error) {
    console.warn('Project library local cache unavailable:', error);
    return typeof indexedDB !== 'undefined';
  }
}

async function hydrateRecentLibrary() {
  const localModels = readRecentModels();
  const restored = await restoreRecentModelVault(BUILDER_MODE, localModels);
  if (clearedRecentsDuringHydration) return;
  const merged = new Map();
  for (const entry of restored) {
    if (entry?.id && !deletedRecentIdsDuringHydration.has(String(entry.id))) merged.set(String(entry.id), entry);
  }
  // Keep any project saved between initialization and IndexedDB restoration.
  for (const entry of readRecentModels()) {
    if (entry?.id && !deletedRecentIdsDuringHydration.has(String(entry.id))) merged.set(String(entry.id), entry);
  }
  recentModelsMemory = [...merged.values()].sort((a, b) => (Date.parse(b.savedAt || '') || 0) - (Date.parse(a.savedAt || '') || 0));
  renderRecentModels();
}

function getModelHeight(blocks = []) {
  return blocks.length > 0 ? Math.max(...blocks.map((block) => block.z)) + 1 : 0;
}

function formatAutosaveTime(isoString) {
  if (!isoString) return 'Waiting for changes';
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) return 'Saved';
  return `Saved ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function makeStoredSnapshot(blocks = cloneBlocks()) {
  return {
    version: 3,
    modelId: activeRecentModelId,
    savedAt: new Date().toISOString(),
    gridSize: model.gridSize,
    gridWidth: model.gridWidth,
    gridDepth: model.gridDepth,
    maxHeight: CONFIG.MAX_HEIGHT,
    surfaceMode: exportSurfaceMode,
    smoothingStrength,
    smoothEdgeProfile,
    blocks: cloneBlocks(blocks),
  };
}

/**
 * Generate a short, deterministic title from the voxel geometry.
 * This deliberately describes broad structural qualities rather than pretending
 * to recognize semantic objects such as a house or animal.
 */
function generateSmartModelName(blocks = []) {
  if (!blocks.length) return 'EMPTY BUILD';

  const xs = blocks.map((block) => block.x);
  const ys = blocks.map((block) => block.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const width = maxX - minX + 1;
  const depth = maxY - minY + 1;
  const height = getModelHeight(blocks);

  const columnMap = new Map();
  for (const block of blocks) {
    const key = `${block.x},${block.y}`;
    columnMap.set(key, Math.max(columnMap.get(key) ?? 0, block.z + 1));
  }

  const columns = [...columnMap.values()];
  const columnCount = columns.length;
  const peakCount = columns.filter((value) => value === height).length;
  const uniqueHeights = [...new Set(columns)].sort((a, b) => a - b);
  const volume = Math.max(1, width * depth * height);
  const density = blocks.length / volume;
  const footprintArea = Math.max(1, width * depth);
  const footprintDensity = columnCount / footprintArea;
  const longestSide = Math.max(width, depth);
  const shortestSide = Math.max(1, Math.min(width, depth));

  const mirroredOnX = [...columnMap.entries()].every(([key, value]) => {
    const [x, y] = key.split(',').map(Number);
    return columnMap.get(`${minX + maxX - x},${y}`) === value;
  });
  const mirroredOnY = [...columnMap.entries()].every(([key, value]) => {
    const [x, y] = key.split(',').map(Number);
    return columnMap.get(`${x},${minY + maxY - y}`) === value;
  });
  const symmetric = (mirroredOnX || mirroredOnY) && columnCount >= 4;

  if (columnCount === 1) return height >= 7 ? 'TALL COLUMN' : 'SINGLE COLUMN';
  if (peakCount === 2 && height >= 5 && columnCount <= 6) return 'TWIN COLUMNS';
  if (height >= longestSide * 1.8 && height >= 6) {
    return columnCount <= 4 ? 'TALL TOWER' : 'VERTICAL CLUSTER';
  }
  if (height <= 3 && longestSide >= 7) {
    return longestSide / shortestSide >= 2.2 ? 'LONG PLATFORM' : 'LOW PLATFORM';
  }
  if (uniqueHeights.length >= 4 && height >= 5) return 'STEPPED FORM';
  if (symmetric) return height >= 5 ? 'SYMMETRIC TOWER' : 'SYMMETRIC FORM';
  if (longestSide / shortestSide >= 2.5 && columnCount >= 4) return 'LONG FORM';
  if (width <= 3 && depth <= 3 && height >= 4) return 'COMPACT STACK';
  if (density >= 0.72 && footprintDensity >= 0.7) return 'SOLID MASS';
  if (columnCount >= 8 && footprintDensity <= 0.45) return 'OPEN CLUSTER';
  if (height > longestSide) return 'VERTICAL FORM';
  if (longestSide > height * 1.7) return 'WIDE FORM';
  return 'VOXEL FORM';
}

function makeUniqueSmartModelName(blocks, recents = []) {
  const base = generateSmartModelName(blocks);
  const names = recents.map((entry) => String(entry?.name ?? '').trim()).filter(Boolean);
  const matching = names.filter((name) => name === base || name.startsWith(`${base} / `));
  if (matching.length === 0) return base;

  let suffix = 2;
  while (names.includes(`${base} / ${String(suffix).padStart(2, '0')}`)) suffix += 1;
  return `${base} / ${String(suffix).padStart(2, '0')}`;
}

function makeUniqueDuplicateName(sourceName, blocks, recents = []) {
  const source = String(sourceName || generateSmartModelName(blocks)).trim();
  const names = new Set(recents.map((entry) => String(entry?.name ?? '').trim()).filter(Boolean));
  const base = `${source} / COPY`;
  if (!names.has(base)) return base;

  let suffix = 2;
  while (names.has(`${base} ${String(suffix).padStart(2, '0')}`)) suffix += 1;
  return `${base} ${String(suffix).padStart(2, '0')}`;
}

function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function readRecentModels() {
  const stored = recentModelsMemory ?? safeStorageRead(RECENT_MODELS_STORAGE_KEY, []);
  if (!Array.isArray(stored)) return [];

  let changed = false;
  const normalized = stored
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;

      const legacyBlocks = extractLegacyBlockArray(entry);
      if (!legacyBlocks) return null;
      const blocks = dedupeImportedBlocks(legacyBlocks);
      if (blocks.length === 0 && legacyBlocks.length > 0) return null;

      const id = entry.id || (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`);
      const gridSize = getLegacyGridSize(entry, blocks);
      const migrated = {
        ...entry,
        id,
        gridSize,
        blocks,
      };

      if (!entry.id || entry.blocks !== legacyBlocks || JSON.stringify(entry.blocks ?? []) !== JSON.stringify(blocks) || entry.gridSize !== gridSize) {
        changed = true;
      }
      return migrated;
    })
    .filter(Boolean);

  if (changed) safeStorageWrite(RECENT_MODELS_STORAGE_KEY, normalized);
  return normalized;
}

function setActiveRecentModel(id, { persist = true } = {}) {
  activeRecentModelId = id ? String(id) : null;
  if (!activeRecentModelId) importedProjectName = null;

  if (!persist || !storageEnabled) return;

  if (activeRecentModelId) {
    safeStorageWrite(ACTIVE_RECENT_MODEL_STORAGE_KEY, activeRecentModelId);
  } else {
    safeStorageRemove(ACTIVE_RECENT_MODEL_STORAGE_KEY);
  }
}

function initializeActiveRecentModel() {
  const storedId = safeStorageRead(ACTIVE_RECENT_MODEL_STORAGE_KEY, null);
  activeRecentModelId = storedId ? String(storedId) : null;

  if (activeRecentModelId) {
    const exists = readRecentModels().some((entry) => String(entry.id) === activeRecentModelId);
    if (!exists) setActiveRecentModel(null);
  }
}

function bindActiveModelFromSnapshot(snapshot) {
  const recents = readRecentModels();
  const requestedId = snapshot?.modelId ? String(snapshot.modelId) : null;

  if (requestedId && recents.some((entry) => String(entry.id) === requestedId)) {
    setActiveRecentModel(requestedId);
    return;
  }

  // Backward compatibility with autosaves created before model IDs were stored.
  if (Array.isArray(snapshot?.blocks) && snapshot.blocks.length > 0) {
    const signature = snapshotSignature(snapshot.blocks);
    const match = recents.find((entry) => snapshotSignature(entry.blocks) === signature);
    if (match?.id) {
      setActiveRecentModel(match.id);
      return;
    }
  }

  setActiveRecentModel(null);
}

function setAutosaveUi(state = 'saved', label = '') {
  if (!autosaveStatus || !autosaveMeta || !autosaveToggle) return;

  const isSaving = state === 'saving';
  const isError = state === 'error';
  const isOn = autosaveEnabled && !isError;

  autosaveToggle.classList.toggle('is-on', isOn);
  autosaveToggle.classList.toggle('is-saving', isSaving);
  autosaveToggle.classList.toggle('is-error', isError);
  autosaveToggle.setAttribute('aria-checked', String(isOn));
  autosaveStatus.textContent = isError ? 'ERROR' : isSaving ? 'SAVING' : isOn ? 'ON' : 'OFF';

  if (label) {
    autosaveMeta.textContent = label;
  } else if (isError) {
    autosaveMeta.textContent = 'Browser storage unavailable';
  } else if (!autosaveEnabled) {
    autosaveMeta.textContent = 'Autosave paused';
  } else {
    autosaveMeta.textContent = 'Autosave ready';
  }
}

function initializeAutosavePreference() {
  const storedPreference = safeStorageRead(AUTOSAVE_PREF_STORAGE_KEY, true);
  autosaveEnabled = storedPreference !== false;
  setAutosaveUi(autosaveEnabled ? 'saved' : 'disabled');
}

function setAutosaveEnabled(enabled) {
  if (!storageEnabled) {
    setAutosaveUi('error');
    return;
  }

  autosaveEnabled = Boolean(enabled);
  window.clearTimeout(autosaveTimer);
  autosaveTimer = null;

  if (!safeStorageWrite(AUTOSAVE_PREF_STORAGE_KEY, autosaveEnabled)) {
    setAutosaveUi('error');
    return;
  }

  if (autosaveEnabled) {
    setAutosaveUi('saving', 'Autosave enabled…');
    persistCurrentModel({ addRecent: false });
    systemStatus.textContent = 'AUTOSAVE ON';
  } else {
    setAutosaveUi('disabled', 'Autosave paused');
    systemStatus.textContent = 'AUTOSAVE OFF';
  }
}

document.querySelector('#recentProjectSearch')?.addEventListener('input',()=>renderRecentModels());
document.querySelector('#recentProjectSort')?.addEventListener('change',()=>renderRecentModels());
function renderRecentModels() {
  if (!recentModelsList) return;
  const recents = readRecentModels();
  const query=(document.querySelector('#recentProjectSearch')?.value||'').trim().toLocaleLowerCase(),sort=document.querySelector('#recentProjectSort')?.value||'latest';
  const storedPins=safeStorageRead('bil:pinned-projects:'+BUILDER_MODE,[]),pins=new Set(Array.isArray(storedPins)?storedPins.map(String):[]);
  const rows=recents.map((entry,index)=>({entry,index})).filter(({entry})=>String(entry.name||generateSmartModelName(entry.blocks)).toLocaleLowerCase().includes(query));
  rows.sort((a,b)=>Number(pins.has(String(b.entry.id)))-Number(pins.has(String(a.entry.id)))||(sort==='name'?String(a.entry.name||'').localeCompare(String(b.entry.name||'')):sort==='blocks'?b.entry.blocks.length-a.entry.blocks.length:sort==='oldest'?new Date(a.entry.savedAt).getTime()-new Date(b.entry.savedAt).getTime():new Date(b.entry.savedAt).getTime()-new Date(a.entry.savedAt).getTime())||a.index-b.index);
  const counter=document.querySelector('#recentSearchCount');if(counter)counter.textContent=`${rows.length} / ${recents.length} PROJECTS · PINNED FIRST`;

  if (recents.length === 0) {
    recentModelsList.innerHTML = `
      <div class="recent-empty">
        <strong>NO RECENT MODELS YET</strong>
        <span>Build something and it will appear here automatically.</span>
      </div>`;
    return;
  }

  if(!rows.length){recentModelsList.innerHTML='<div class="recent-empty"><strong>NO MATCHING PROJECTS</strong><span>Try another name or clear the search.</span></div>';return;}
  recentModelsList.innerHTML = rows.map(({entry,index}) => {
    const date = new Date(entry.savedAt);
    const dateText = Number.isNaN(date.getTime())
      ? 'Saved model'
      : `${date.toLocaleDateString([], { month: 'short', day: '2-digit' })} · ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    const blocks = entry.blocks.length;
    const height = getModelHeight(entry.blocks);
    const name = String(entry.name || generateSmartModelName(entry.blocks)).trim();
    const id = String(entry.id ?? index);

    const isActive = activeRecentModelId && id === activeRecentModelId;

    const versions = Array.isArray(entry.versions) ? entry.versions : [];
    const expanded = expandedVersionProjectId === id;
    return `
      <article class="recent-item${isActive ? ' is-active' : ''}" data-recent-index="${index}" data-recent-id="${escapeHtml(id)}">
        <div class="recent-item__preview">
          <img class="recent-item__thumb" src="${makeModelThumbnail(entry.blocks)}" alt="Preview of ${escapeHtml(name)}" loading="lazy" />
          <span class="recent-item__preview-label">${isActive ? 'CURRENT' : String(index + 1).padStart(2,'0')}</span>
        </div>
        <div class="recent-item__copy">
          <div class="recent-title-row"><strong class="recent-item__title">${escapeHtml(name)}</strong><button class="recent-pin" data-recent-action="pin" data-recent-index="${index}" type="button" aria-pressed="${pins.has(id)}" aria-label="${pins.has(id)?'Unpin':'Pin'} ${escapeHtml(name)}"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 2h6l-1 4 2 3H4l2-3-1-4Zm3 7v5"/></svg><span>${pins.has(id)?'PINNED':'PIN'}</span></button></div>
          <span class="recent-item__date">${escapeHtml(dateText)}</span>
          <span class="recent-item__meta">${String(blocks).padStart(3, '0')} BLOCKS <i aria-hidden="true">/</i> ${String(entry.gridWidth ?? Math.min(CONFIG.WORKSPACE_COLUMNS, Number(entry.gridSize) || CONFIG.WORKSPACE_COLUMNS)).padStart(2, '0')}×${String(entry.gridDepth ?? Math.min(CONFIG.WORKSPACE_ROWS, Number(entry.gridSize) * 2 || CONFIG.WORKSPACE_ROWS)).padStart(2, '0')} GRID <i aria-hidden="true">/</i> ${String(height).padStart(2, '0')}/${String(CONFIG.MAX_HEIGHT).padStart(2, '0')} HEIGHT</span>
        </div>
        <div class="recent-item__actions">
          <button class="recent-open" data-recent-action="open" data-recent-index="${index}" type="button">OPEN ↗</button>
          <button class="recent-rename" data-recent-action="rename" data-recent-index="${index}" type="button">RENAME</button>
          <button class="recent-duplicate" data-recent-action="duplicate" data-recent-index="${index}" type="button">DUPLICATE</button>
          <button class="recent-checkpoint" data-recent-action="checkpoint" data-recent-index="${index}" type="button" title="Save a new version">+ VERSION</button>
          <button class="recent-versions-toggle" data-recent-action="versions" data-recent-index="${index}" type="button" aria-expanded="${expanded}" aria-controls="recent-versions-${index}">HISTORY <span class="recent-count">${versions.length}</span><span class="recent-chevron" aria-hidden="true"></span></button>
          <button class="recent-delete modal-close" data-recent-action="delete" data-recent-index="${index}" type="button" aria-label="Delete ${escapeHtml(name)}" title="Delete this saved project">×</button>
        </div>
        <section id="recent-versions-${index}" class="recent-versions${expanded ? ' is-open' : ''}" aria-label="Saved versions of ${escapeHtml(name)}" aria-hidden="${!expanded}" ${expanded ? '' : 'inert'}>
          <div class="recent-versions__inner">
            <div class="recent-versions__heading"><strong>VERSION HISTORY</strong><span>${versions.length} SAVED</span></div>
            ${!versions.length ? '<p class="recent-versions__empty">No checkpoints yet. Select + VERSION to save one.</p>' : versions.map((version, vi) => `<div class="recent-version-row">
              <div class="recent-version-row__preview"><img ${expanded ? `src="${makeModelThumbnail(Array.isArray(version.blocks) ? version.blocks : [])}"` : ''} data-version-preview="${vi}" alt="" loading="lazy" /></div>
              <div class="recent-version-row__info"><strong>${escapeHtml(version.label || 'Checkpoint')}</strong>
              <span>${escapeHtml(new Date(version.savedAt).toLocaleString())}</span><small class="recent-version-comparison">${escapeHtml(summarizeVersionDifference(entry.blocks, version.blocks))}</small></div>
              <div class="recent-version-row__actions"><button data-recent-action="restore-version" data-recent-index="${index}" data-version-index="${vi}" type="button">RESTORE</button>
              <button data-recent-action="delete-version" data-recent-index="${index}" data-version-index="${vi}" type="button" aria-label="Delete version ${escapeHtml(version.label || 'Checkpoint')}">DELETE</button></div>
            </div>`).join('')}
          </div>
        </section>
      </article>`;
  }).join('');

  // Bind actions directly after each render. This avoids any ambiguity with
  // nested modal elements and makes the Rename interaction reliable.
  recentModelsList.querySelectorAll('[data-recent-action]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const index = Number(button.dataset.recentIndex);
      if (!Number.isInteger(index)) return;

      const action = button.dataset.recentAction;
      if(action==='pin'){const id=String(button.closest('[data-recent-id]').dataset.recentId);pins.has(id)?pins.delete(id):pins.add(id);safeStorageWrite('bil:pinned-projects:'+BUILDER_MODE,[...pins]);renderRecentModels();return;}
      if (action === 'open') openRecentModel(index);
      if (action === 'rename') beginRenameRecentModel(index);
      if (action === 'rename-save') saveRecentModelRename(index);
      if (action === 'duplicate') duplicateRecentModel(index);
      if (action === 'delete') deleteRecentModel(index);
      if (action === 'checkpoint') checkpointRecentModel(index);
      if (action === 'versions') {
        const nextId = String(readRecentModels()[index]?.id);
        expandedVersionProjectId = expandedVersionProjectId === nextId ? null : nextId;
        recentModelsList.querySelectorAll('.recent-versions').forEach((panel) => {
          const item = panel.closest('.recent-item');
          const open = item?.dataset.recentId === expandedVersionProjectId;
          panel.classList.toggle('is-open', Boolean(open));
          panel.setAttribute('aria-hidden', String(!open));
          panel.inert = !open;
          const toggle = item?.querySelector('.recent-versions-toggle');
          toggle?.setAttribute('aria-expanded', String(Boolean(open)));
          // Generate checkpoint thumbnails only when their History is opened.
          // This keeps very large persistent libraries responsive.
          if (open) {
            const entry = readRecentModels()[Number(item?.dataset.recentIndex)];
            panel.querySelectorAll('[data-version-preview]').forEach((img) => {
              if (img.getAttribute('src')) return;
              const vi = Number(img.dataset.versionPreview);
              img.src = makeModelThumbnail(Array.isArray(entry?.versions?.[vi]?.blocks) ? entry.versions[vi].blocks : []);
            });
          }
        });
      }
      if (action === 'restore-version') restoreRecentVersion(index, Number(button.dataset.versionIndex));
      if (action === 'delete-version') deleteRecentVersion(index, Number(button.dataset.versionIndex));
      if (action === 'rename-cancel') renderRecentModels();
    });
  });
}

function persistCurrentModel({ addRecent = true, force = false, includeEmpty = false } = {}) {
  if (!autosaveEnabled && !force) {
    setAutosaveUi('disabled', 'Autosave paused');
    return;
  }

  if (!storageEnabled) {
    setAutosaveUi('error');
    return;
  }

  const snapshot = makeStoredSnapshot();
  setAutosaveUi('saving', 'Saving locally…');

  // Recent Models behave as persistent model entries, not a stream of duplicate
  // snapshots. If a recent model is active, autosave updates that same entry.
  if (addRecent && (snapshot.blocks.length > 0 || includeEmpty)) {
    const recents = readRecentModels();
    const activeIndex = activeRecentModelId
      ? recents.findIndex((entry) => String(entry.id) === String(activeRecentModelId))
      : -1;

    if (activeIndex >= 0) {
      const existing = recents[activeIndex];
      const otherRecents = recents.filter((_, index) => index !== activeIndex);
      const updated = {
        ...existing,
        ...snapshot,
        id: existing.id,
        modelId: existing.id,
        name: existing.customName
          ? existing.name
          : makeUniqueSmartModelName(snapshot.blocks, otherRecents),
        customName: Boolean(existing.customName),
      };

      // Most recently edited model goes to the top, but keeps its identity.
      recents.splice(activeIndex, 1);
      recents.unshift(updated);
      setActiveRecentModel(existing.id);
      snapshot.modelId = String(existing.id);
      safeStorageWrite(RECENT_MODELS_STORAGE_KEY, recents);
    } else {
      const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
      setActiveRecentModel(id);
      snapshot.modelId = String(id);
      recents.unshift({
        id,
        name: importedProjectName || makeUniqueSmartModelName(snapshot.blocks, recents),
        customName: Boolean(importedProjectName),
        ...snapshot,
      });
      safeStorageWrite(RECENT_MODELS_STORAGE_KEY, recents);
    }
  } else {
    snapshot.modelId = activeRecentModelId;
  }

  if (!safeStorageWrite(AUTOSAVE_STORAGE_KEY, snapshot)) {
    setAutosaveUi('error');
    return;
  }

  setAutosaveUi('saved', formatAutosaveTime(snapshot.savedAt));
  renderRecentModels();
}

function scheduleAutosave(options = {}) {
  if (!storageEnabled || !autosaveEnabled) return;
  window.clearTimeout(autosaveTimer);
  setAutosaveUi('saving', 'Changes pending…');
  autosaveTimer = window.setTimeout(() => persistCurrentModel(options), AUTOSAVE_DELAY_MS);
}

/**
 * Store a view change immediately, not after the 900ms block-autosave delay.
 * Also update the current project's persisted mode without adding another
 * Recent Models entry or changing any of its editable geometry.
 */
function markEditableWorkspaceActive() {
  if (!IS_HARDWARE_BUILDER) {
    safeStorageWrite(ACTIVE_WORKSPACE_KIND_KEY, 'blocks');
    void clearImportedMeshSession();
  }
}

function rememberSurfaceView() {
  const modelId = exactImportedStl?.sessionId ?? activeRecentModelId;
  const preference = makeSurfaceViewPreference(modelId, exportSurfaceMode);
  safeStorageWrite(SURFACE_VIEW_STORAGE_KEY, preference);

  const autosave = safeStorageRead(AUTOSAVE_STORAGE_KEY, null);
  if (!exactImportedStl && autosaveEnabled && autosave &&
      String(autosave.modelId ?? '') === String(activeRecentModelId ?? '')) {
    safeStorageWrite(AUTOSAVE_STORAGE_KEY, { ...autosave, surfaceMode: exportSurfaceMode });
  }
  if (activeRecentModelId) {
    const recents = readRecentModels();
    const index = recents.findIndex((entry) => String(entry.id) === String(activeRecentModelId));
    if (index >= 0) {
      recents[index] = { ...recents[index], surfaceMode: exportSurfaceMode };
      safeStorageWrite(RECENT_MODELS_STORAGE_KEY, recents);
    }
  }
}

function restoreLatestAutosave() {
  if (!autosaveEnabled) {
    setAutosaveUi('disabled', 'Autosave paused');
    return false;
  }

  const snapshot = safeStorageRead(AUTOSAVE_STORAGE_KEY, null);
  const legacyBlocks = extractLegacyBlockArray(snapshot);
  if (!snapshot || !legacyBlocks) {
    setAutosaveUi(storageEnabled ? 'saved' : 'error', storageEnabled ? 'Autosave ready' : 'Browser storage unavailable');
    return false;
  }
  const restoredBlocks = dedupeImportedBlocks(legacyBlocks);

  clearExactStlMode();
  bindActiveModelFromSnapshot({ ...snapshot, blocks: restoredBlocks });
  setActiveGridSize(getLegacyGridSize(snapshot, restoredBlocks), { preserveBlocks: false, silent: true, autosave: false });
  restoreRectangularDimensions(snapshot.gridWidth, snapshot.gridDepth);
  const rejected = model.replaceExact(cloneBlocks(restoredBlocks));
  exportSurfaceMode = restoreModelSurfaceView(snapshot, safeStorageRead(SURFACE_VIEW_STORAGE_KEY, null));
  smoothEdgeProfile = snapshot.smoothEdgeProfile === 'rounded' ? 'rounded' : 'classic';
  if (Number.isFinite(Number(snapshot.smoothingStrength))) {
    smoothingStrength = THREE.MathUtils.clamp(Math.round(Number(snapshot.smoothingStrength)), 1, 5);
  }
  setExportSurfaceMode(exportSurfaceMode, { rebuild: false, remember: false });
  updateSmoothingStrengthUi(smoothingStrength);
  scheduleRealtimeOrganicSurface({ immediate: true });
  setAutosaveUi('saved', formatAutosaveTime(snapshot.savedAt));
  systemStatus.textContent = rejected.length ? 'AUTOSAVE PARTLY RESTORED' : 'AUTOSAVE RESTORED';
  setFeedback(
    rejected.length ? 'AUTOSAVE PARTLY RESTORED' : 'AUTOSAVE RESTORED',
    rejected.length
      ? `${model.getBlockCount()} block(s) restored; ${rejected.length} invalid saved block(s) rejected.`
      : `${model.getBlockCount()} block(s) restored from your latest browser autosave.`,
    rejected.length > 0,
  );
  return true;
}

async function restoreLastImportedMesh() {
  const session = await loadImportedMeshSession();
  if (!session || !(session.buffer instanceof ArrayBuffer) || !session.buffer.byteLength) {
    safeStorageRemove(ACTIVE_WORKSPACE_KIND_KEY);
    restoreLatestAutosave();
    syncViewFromModel();
    return;
  }
  try {
    const geometry = new STLLoader().parse(session.buffer);
    geometry.computeBoundingBox();
    setActiveGridSize(session.gridSize, { preserveBlocks: false, silent: true, autosave: false });
    restoreRectangularDimensions(session.gridWidth, session.gridDepth);
    model.replaceExact([]);
    activateExactStlMode({ buffer: session.buffer, geometry, gridSize: session.gridSize });
    exactImportedStl.sessionId = session.id;
    const surfaceMode = restoreModelSurfaceView(
      { modelId: session.id, surfaceMode: 'soft1' },
      safeStorageRead(SURFACE_VIEW_STORAGE_KEY, null),
    );
    setExportSurfaceMode(surfaceMode, { rebuild: false, remember: false });
    const bounds = geometry.boundingBox;
    const preview = getStlPreviewLayout({ min: bounds.min, max: bounds.max }, CONFIG.PHYSICAL_BLOCK_MM);
    const focusHeight = preview.size.height / 2;
    const cameraRange = Math.max(17, Math.min(38, preview.maxWorldDimension * 2.3 + 11));
    controls.target.set(0, focusHeight, 0);
    camera.position.set(cameraRange * .56, focusHeight + cameraRange * .54, cameraRange * .64);
    controls.update();
    syncViewFromModel();
    setFeedback('STL RESTORED', 'Original mesh and selected view restored.');
  } catch (error) {
    console.warn('Could not restore previous STL:', error);
    safeStorageRemove(ACTIVE_WORKSPACE_KIND_KEY);
    restoreLatestAutosave();
    syncViewFromModel();
  }
}

function prepareSourceMorph(element, sourceElement, {
  xVar = '--modal-source-x',
  yVar = '--modal-source-y',
  scaleVar = '--modal-source-scale',
  travel = 0.68,
  minScale = 0.28,
  maxScale = 0.42,
  scaleBoost = 2.5,
} = {}) {
  if (!element || !sourceElement) return;

  const sourceRect = sourceElement.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const sourceCenterX = sourceRect.left + sourceRect.width / 2;
  const sourceCenterY = sourceRect.top + sourceRect.height / 2;
  const elementCenterX = elementRect.left + elementRect.width / 2;
  const elementCenterY = elementRect.top + elementRect.height / 2;
  const elementWidth = Math.max(1, element.offsetWidth);
  const elementHeight = Math.max(1, element.offsetHeight);
  const sourceScale = Math.min(sourceRect.width / elementWidth, sourceRect.height / elementHeight) * 0.92;
  const clampedScale = Math.max(minScale, Math.min(maxScale, (sourceScale || minScale) * scaleBoost));

  element.style.setProperty(xVar, `${(sourceCenterX - elementCenterX) * travel}px`);
  element.style.setProperty(yVar, `${(sourceCenterY - elementCenterY) * travel}px`);
  element.style.setProperty(scaleVar, clampedScale.toFixed(4));
}

function prepareModalSourceMorph(modal, sourceElement) {
  const panel = modal?.querySelector('[class$="__panel"]');
  if (!modal || !panel || !sourceElement) return;
  prepareSourceMorph(panel, sourceElement, {
    xVar: '--modal-source-x',
    yVar: '--modal-source-y',
    scaleVar: '--modal-source-scale',
    travel: 0.64,
    minScale: 0.38,
    maxScale: 0.50,
    scaleBoost: 3.1,
  });
}

function preparePopoverSourceMorph(popover, sourceElement, options = {}) {
  if (!popover || !sourceElement) return;
  prepareSourceMorph(popover, sourceElement, {
    xVar: '--popover-source-x',
    yVar: '--popover-source-y',
    scaleVar: '--popover-source-scale',
    travel: 0.50,
    minScale: 0.78,
    maxScale: 0.94,
    scaleBoost: 2.15,
    ...options,
  });
}

// Compensate for the browser's actual scrollbar width, including thin bars.
if (recentModelsList) {
  new ResizeObserver(() => {
    if (!recentModelsList.offsetWidth) return;
    const gutter = Math.max(0, recentModelsList.offsetWidth - recentModelsList.clientWidth);
    recentModelsList.style.setProperty('--recent-scrollbar-width', `${gutter}px`);
  }).observe(recentModelsList);
}

function openRecentModal(sourceElement = openRecentModelsButton) {
  if (activeLayerView !== null) {
    setFeedback('LAYER VIEW ONLY', 'Return to ALL layers before opening another saved build.', true);
    return;
  }
  renderRecentModels();
  recentModal.hidden = false;
  prepareModalSourceMorph(recentModal, sourceElement);
  document.body.classList.add('modal-open');
  controls.enabled = false;
  requestAnimationFrame(() => {
    recentModal.classList.add('is-open');
    recentModelsList.querySelector('.recent-open')?.focus();
  });
}

function closeRecentModal() {
  prepareModalSourceMorph(recentModal, openRecentModelsButton);
  recentModal.classList.remove('is-open');
  document.body.classList.remove('modal-open');
  controls.enabled = true;
  window.setTimeout(() => {
    recentModal.hidden = true;
  }, 560);
}

function openRecentModel(index) {
  if (serialConnected || simulationActive) {
    closeRecentModal();
    setFeedback('HARDWARE MODE', 'Disconnect the ESP32 before restoring a recent digital model.', true);
    return;
  }

  const recents = readRecentModels();
  const entry = recents[index];
  if (!entry?.blocks) return;

  clearExactStlMode();
  markEditableWorkspaceActive();

  // Switch identity first. Restoring an existing model must never create a new
  // Recent Models entry merely because it was opened.
  setActiveRecentModel(entry.id);
  setActiveGridSize(entry.gridSize ?? CONFIG.GRID_SIZE, { preserveBlocks: false, silent: true, autosave: false });
  restoreRectangularDimensions(entry.gridWidth, entry.gridDepth);
  const rejected = model.replaceExact(cloneBlocks(entry.blocks));
  if (['voxel', 'soft1'].includes(entry.surfaceMode)) exportSurfaceMode = entry.surfaceMode;
  smoothEdgeProfile = entry.smoothEdgeProfile === 'rounded' ? 'rounded' : 'classic';
  if (Number.isFinite(Number(entry.smoothingStrength))) {
    smoothingStrength = THREE.MathUtils.clamp(Math.round(Number(entry.smoothingStrength)), 1, 5);
  }
  setExportSurfaceMode(exportSurfaceMode, { rebuild: false, remember: false });
  updateSmoothingStrengthUi(smoothingStrength);
  resetHistoryToCurrent();
  setLayerView(0);
  syncViewFromModel();
  persistCurrentModel({ addRecent: false });
  closeRecentModal();
  systemStatus.textContent = rejected.length ? 'RECENT MODEL PARTLY RESTORED' : 'RECENT MODEL RESTORED';
  setFeedback(
    rejected.length ? 'RECENT MODEL PARTLY RESTORED' : 'RECENT MODEL RESTORED',
    `${model.getBlockCount()} block(s) loaded from browser history${rejected.length ? `; ${rejected.length} rejected` : ''}.`,
    rejected.length > 0,
  );
}

function makeCheckpointSnapshot(entry, label) {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`,
    label, savedAt: new Date().toISOString(),
    blocks: cloneBlocks(entry.blocks), gridSize: entry.gridSize,
    gridWidth: entry.gridWidth, gridDepth: entry.gridDepth,
    surfaceMode: entry.surfaceMode, smoothingStrength: entry.smoothingStrength, smoothEdgeProfile: entry.smoothEdgeProfile,
  };
}
async function checkpointRecentModel(index) {
  const recents = readRecentModels();
  const entry = recents[index];
  if (!entry) return;
  const defaultName = `Version ${(entry.versions?.length || 0) + 1}`;
  const label = await requestProjectAction({title:'SAVE A CHECKPOINT',description:'Create a named version you can restore later.',eyebrow:'PROJECT LIBRARY / VERSION',confirmLabel:'SAVE VERSION',inputLabel:'VERSION NAME',inputValue:defaultName});
  if (label === null) return;
  // If this saved project is currently open, capture the LIVE model, including
  // changes that haven't yet autosaved, rather than an older disk snapshot.
  const snapshot = String(entry.id) === String(activeRecentModelId) && !exactImportedStl
    ? {...entry, ...makeStoredSnapshot(), blocks: cloneBlocks()}
    : entry;
  const checkpoint = makeCheckpointSnapshot(snapshot, label.trim().slice(0, 55) || defaultName);
  recents[index] = {...entry, versions:[...(entry.versions || []), checkpoint]};
  safeStorageWrite(RECENT_MODELS_STORAGE_KEY, recents);
  expandedVersionProjectId = String(entry.id);
  renderRecentModels();
  if (libraryStatus) libraryStatus.textContent = `VERSION SAVED / ${checkpoint.label}`;
  setFeedback('CHECKPOINT SAVED', checkpoint.label);
}
async function restoreRecentVersion(index, versionIndex) {
  const recents = readRecentModels();
  const entry = recents[index];
  const version = entry?.versions?.[versionIndex];
  if (!version) return;
  if (!(await requestProjectAction({title:'RESTORE THIS VERSION?', description:`Restore “${version.label}” to the project. Your current work will be saved as a safety checkpoint.`, confirmLabel:'RESTORE VERSION', eyebrow:'PROJECT LIBRARY / HISTORY'}))) return;
  if (serialConnected || simulationActive) { setFeedback('HARDWARE CONNECTED', 'Disconnect ESP32 before restoring a checkpoint.', true); return; }
  const current = String(entry.id) === String(activeRecentModelId) && !exactImportedStl
    ? {...entry, ...makeStoredSnapshot(), blocks: cloneBlocks()}
    : entry;
  const safety = makeCheckpointSnapshot(current, 'Before restore');
  recents[index] = {...entry,
    blocks: cloneBlocks(version.blocks), gridSize: version.gridSize,
    gridWidth: version.gridWidth, gridDepth: version.gridDepth,
    surfaceMode: version.surfaceMode, smoothingStrength: version.smoothingStrength, smoothEdgeProfile: version.smoothEdgeProfile,
    savedAt: new Date().toISOString(), versions: [...entry.versions, safety],
  };
  safeStorageWrite(RECENT_MODELS_STORAGE_KEY, recents);
  // Open the restored snapshot using the existing, tested project loader.
  openRecentModel(index);
  setFeedback('VERSION RESTORED', `${version.label}. Previous state saved as a checkpoint.`);
}
async function deleteRecentVersion(index, versionIndex) {
  const recents = readRecentModels();
  const entry = recents[index];
  const version = entry?.versions?.[versionIndex];
  if (!version) return;
  if (!(await requestProjectAction({title:'DELETE THIS VERSION?', description:`The checkpoint “${version.label}” will be removed from this project.`, confirmLabel:'DELETE VERSION', eyebrow:'PROJECT LIBRARY / DELETE', danger:true, warning:'This checkpoint cannot be recovered unless it is backed up.'}))) return;
  recents[index] = {...entry, versions:entry.versions.filter((_, i)=>i!==versionIndex)};
  safeStorageWrite(RECENT_MODELS_STORAGE_KEY, recents);
  renderRecentModels();
  if (libraryStatus) libraryStatus.textContent = 'CHECKPOINT DELETED';
}

function duplicateRecentModel(index) {
  const recents = readRecentModels();
  const source = recents[index];
  if (!source?.blocks) return;

  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
  const savedAt = new Date().toISOString();
  const duplicate = {
    ...source,
    id,
    modelId: id,
    name: makeUniqueDuplicateName(source.name, source.blocks, recents),
    customName: true,
    savedAt,
    blocks: cloneBlocks(source.blocks),
  };

  // Keep the original model active. DUPLICATE creates a separate branch in the
  // browser gallery; the user can OPEN it explicitly when they want to edit it.
  recents.unshift(duplicate);
  if (!safeStorageWrite(RECENT_MODELS_STORAGE_KEY, recents)) {
    systemStatus.textContent = 'DUPLICATE FAILED';
    setAutosaveUi('error', 'Could not duplicate recent model');
    return;
  }

  renderRecentModels();
  systemStatus.textContent = 'RECENT MODEL DUPLICATED';
  setAutosaveUi('saved', `Created ${duplicate.name}`);
}

async function deleteRecentModel(index) {
  const recents = readRecentModels();
  const removed = recents[index];
  if (!removed) return;
  if (!(await requestProjectAction({title:'DELETE THIS PROJECT?', description:`“${removed.name || 'This project'}” and its saved versions will be removed from this browser.`, confirmLabel:'DELETE PROJECT', eyebrow:'PROJECT LIBRARY / DELETE', danger:true, warning:'This action cannot be undone. Export a backup first if needed.'}))) return;
  // Resolve by stable ID again after the async confirmation; the list may
  // have changed due to an autosave while the dialog was open.
  const latest = readRecentModels();
  const currentIndex = latest.findIndex((item) => String(item.id) === String(removed.id));
  if (currentIndex < 0) return;
  deletedRecentIdsDuringHydration.add(String(removed.id));
  latest.splice(currentIndex, 1);
  safeStorageWrite(RECENT_MODELS_STORAGE_KEY, latest);
  void eraseRecentModel(BUILDER_MODE, String(removed.id));
  if (removed?.id && String(removed.id) === String(activeRecentModelId)) {
    setActiveRecentModel(null);
  }
  renderRecentModels();
  if (libraryStatus) libraryStatus.textContent = `PROJECT DELETED / ${removed.name || 'SAVED MODEL'}`;
}

function beginRenameRecentModel(index) {
  const recents = readRecentModels();
  const entry = recents[index];
  const item = recentModelsList.querySelector(`[data-recent-index="${index}"]`);
  const copy = item?.querySelector('.recent-item__copy');
  const title = item?.querySelector('.recent-item__title');
  const renameButton = item?.querySelector('.recent-rename');
  if (!entry || !item || !copy || !title || !renameButton) return;

  // Prevent opening multiple rename editors in the same list.
  recentModelsList.querySelectorAll('.recent-item.is-renaming').forEach((otherItem) => {
    if (otherItem !== item) otherItem.classList.remove('is-renaming');
  });

  item.classList.add('is-renaming');

  const input = document.createElement('input');
  input.className = 'recent-rename-input';
  input.type = 'text';
  input.maxLength = 48;
  input.value = String(entry.name || generateSmartModelName(entry.blocks));
  input.setAttribute('aria-label', 'Rename recent model');
  input.autocomplete = 'off';
  input.spellcheck = false;
  title.replaceWith(input);

  renameButton.textContent = 'SAVE';
  renameButton.dataset.recentAction = 'rename-save';

  // Add a visible cancel affordance while renaming by reusing the open button.
  const openButton = item.querySelector('.recent-open');
  if (openButton) {
    openButton.textContent = 'CANCEL';
    openButton.dataset.recentAction = 'rename-cancel';
  }

  input.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveRecentModelRename(index);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      renderRecentModels();
    }
  });

  input.addEventListener('click', (event) => event.stopPropagation());

  requestAnimationFrame(() => {
    input.focus({ preventScroll: true });
    input.select();
  });
}

function saveRecentModelRename(index) {
  const recents = readRecentModels();
  const entry = recents[index];
  const item = recentModelsList.querySelector(`[data-recent-index="${index}"]`);
  const input = item?.querySelector('.recent-rename-input');
  if (!entry || !input) return;

  const nextName = input.value.trim().replace(/\s+/g, ' ').slice(0, 48);
  entry.name = nextName || generateSmartModelName(entry.blocks);
  entry.customName = Boolean(nextName);

  if (!safeStorageWrite(RECENT_MODELS_STORAGE_KEY, recents)) {
    systemStatus.textContent = 'RENAME FAILED';
    setAutosaveUi('error', 'Could not save model name');
    return;
  }

  renderRecentModels();
  systemStatus.textContent = 'RECENT MODEL RENAMED';
  setAutosaveUi('saved', `Named ${entry.name}`);
}

function updateHistoryControls() {
  const lockedByHardware = serialConnected || simulationActive;
  const lockedByLayerView = activeLayerView !== null;
  const historyLocked = lockedByHardware || lockedByLayerView;
  undoBuildButton.disabled = historyLocked || historyIndex <= 0;
  redoBuildButton.disabled = historyLocked || historyIndex >= history.length - 1;
  undoBuildButton.title = lockedByHardware
    ? 'Disconnect ESP32 to use history'
    : lockedByLayerView
      ? 'Return Layer View to ALL to use Undo'
      : 'Undo (Ctrl/Cmd + Z)';
  redoBuildButton.title = lockedByHardware
    ? 'Disconnect ESP32 to use history'
    : lockedByLayerView
      ? 'Return Layer View to ALL to use Redo'
      : 'Redo (Ctrl/Cmd + Shift + Z)';
}

function recordHistory() {
  const snapshot = cloneBlocks();
  const current = history[historyIndex] ?? [];
  if (snapshotSignature(snapshot) === snapshotSignature(current)) {
    updateHistoryControls();
    return;
  }

  history = history.slice(0, historyIndex + 1);
  history.push(snapshot);

  if (history.length > HISTORY_LIMIT) {
    history.shift();
  } else {
    historyIndex += 1;
  }

  historyIndex = history.length - 1;
  updateHistoryControls();
  scheduleAutosave();
}

function resetHistoryToCurrent() {
  history = [cloneBlocks()];
  historyIndex = 0;
  updateHistoryControls();
}

function applyHistorySnapshot(index, label) {
  if (activeLayerView !== null) {
    setFeedback('LAYER VIEW ONLY', 'Return to ALL layers before using Undo / Redo.', true);
    return;
  }
  if (exactImportedStl) {
    setFeedback('EXACT STL MODE', 'Undo / Redo applies to editable voxel builds. Clear the imported STL first.', true);
    return;
  }
  if (serialConnected || simulationActive) {
    setFeedback('HARDWARE MODE', 'Disconnect the ESP32 before using Undo / Redo.', true);
    return;
  }

  const snapshot = history[index];
  if (!snapshot) return;

  model.replaceExact(cloneBlocks(snapshot));
  historyIndex = index;
  syncViewFromModel();
  ghost.visible = false;
  hoveredCandidate = null;
  updateHistoryControls();
  systemStatus.textContent = label;
  setFeedback(label, `${model.getBlockCount()} block(s) in the restored model state.`);
  scheduleAutosave();
}

function undoBuild() {
  if (historyIndex <= 0) return;
  applyHistorySnapshot(historyIndex - 1, 'UNDO APPLIED');
}

function redoBuild() {
  if (historyIndex >= history.length - 1) return;
  applyHistorySnapshot(historyIndex + 1, 'REDO APPLIED');
}

function setLayerView(value) {
  const missing=!IS_HARDWARE_BUILDER&&!exactImportedStl?getMissingLayerSupportCells():[];
  if(missing.length&&Number(value)!==missing[0].z+1){layerSlider.value=String(activeLayerView===null?missing[0].z+1:activeLayerView+1);setRangeProgress(layerSlider);pulseLayerRepair();return;}

  layerEditEnabled = false;
  if (exportSurfaceMode === 'soft1' && Number(value) > 0) {
    activeLayerView = null;
    layerSlider.value = '0';
    layerSlider.classList.remove('is-active');
    setRangeProgress(layerSlider);
    showAllLayersButton.classList.add('is-active');
    layerValue.textContent = 'ALL';
    setFeedback('SMOOTH VIEW', 'Layer View is disabled while Smooth is active. Switch to Blocks to inspect individual layers.', true);
    return;
  }
  if (exactImportedStl && !isApproximateBlockPreview()) {
    activeLayerView = null;
    layerSlider.value = '0';
    layerSlider.classList.remove('is-active');
    setRangeProgress(layerSlider);
    showAllLayersButton.classList.add('is-active');
    layerValue.textContent = 'ALL';
    return;
  }
  const numeric = Number(value);
  activeLayerView = numeric <= 0 ? null : numeric - 1;
  const sliderValue = activeLayerView === null ? 0 : activeLayerView + 1;
  layerSlider.value = String(sliderValue);
  layerSlider.classList.toggle('is-active', activeLayerView !== null);
  setRangeProgress(layerSlider);
  showAllLayersButton.classList.toggle('is-active', activeLayerView === null);
  layerValue.textContent = activeLayerView === null
    ? 'ALL'
    : `${String(activeLayerView + 1).padStart(2, '0')}/${String(CONFIG.MAX_HEIGHT).padStart(2, '0')}`;

  ghost.visible = false;
  hoveredCandidate = null;
  syncViewFromModel();
  updateOrganicEditingLocks();
  updateHistoryControls();

  if (activeLayerView === null) {
    setFeedback('ALL LAYERS', 'Full model visible. Building controls are active.');
  } else {
    setFeedback(
      `LAYERS 01–${String(activeLayerView + 1).padStart(2, '0')}`,
      IS_HARDWARE_BUILDER ? 'Showing physical blocks up to this layer. ESP32 readings continue in the background.' : 'Showing the build from the base up to this layer. Set the slider to ALL to edit the build.',
    );
  }
  announceLayerRepair();
}

/**
 * Render every editable module as a clean 2:1 cuboid, preserving its per-block
 * picking ID. The export pipeline builds the same simple cuboid surfaces.
 */
function syncViewFromModel() {
  refreshMeasurementBounds();
  refreshLayerRepairNotice();
  // Shared box geometry and support outlines are reused; clear only instances.
  blocksGroup.clear();

  if (exactImportedStl) {
    // Smooth and Blocks-reference use identical original triangles. The latter
    // swaps only the shading; the unsafe estimated 162-cube church is gone.
    exactStlGroup.visible = true;
    blocksGroup.visible = false;
    realtimeOrganicGroup.visible = false;
    window.clearTimeout(realtimeSmoothTimer);
    const importedMesh = exactStlGroup.children.find(child => child.isMesh);
    if (importedMesh) importedMesh.material = isImportedGridReferenceView() ? exactStlGridMaterial : exactStlMaterial;
    blockMetric.textContent = 'MESH';
    const liveHeight = Math.min(CONFIG.MAX_HEIGHT, Math.ceil(exactImportedStl.heightMm / CONFIG.PHYSICAL_BLOCK_MM));
    heightMetric.textContent = `${String(liveHeight).padStart(2, '0')}/${String(CONFIG.MAX_HEIGHT).padStart(2, '0')}`;
    applyRealtimeSurfaceVisibility();
    return;
  } else {
    exactStlGroup.visible = false;
    blocksGroup.visible = true;
  }

  const shownBlocks = model.getBlocks().filter(block => activeLayerView === null || block.z <= activeLayerView);
  // Visible modules are pure geometric prisms, independent of STL topology.
  // Individual meshes retain stable picking/recolor IDs in every view.
  for (const block of shownBlocks) {
    const material = block.type === 'support' ? supportMaterial : getStandardBlockMaterial(block.color);
    const mesh = new THREE.Mesh(blockGeometry, material);
    mesh.position.copy(modelToWorld(block.x, block.y, block.z));
    mesh.castShadow = block.type !== 'support';
    mesh.receiveShadow = block.type !== 'support';
    mesh.userData = {
      kind: 'block',
      x: block.x,
      y: block.y,
      z: block.z,
      type: block.type,
      ...(block.type === 'standard' ? { color: normalizeStandardBlockColor(block.color) } : {}),
    };
    if (block.type === 'support') {
      // An independent, high-contrast outline stays legible against the base
      // and neighbouring translucent support modules (including in SMOOTH).
      const edges = new THREE.LineSegments(blockEdgesGeometry, supportEdgeMaterial);
      edges.scale.setScalar(1.004);
      edges.renderOrder = 15;
      edges.userData.kind = 'support-outline';
      mesh.add(edges);
    }
    if (recolorSelectedKeys.has(modelBlockKey(block.x, block.y, block.z))) {
      const outline = new THREE.LineSegments(
        blockEdgesGeometry,
        usesDarkSelectionOutline(block.color) ? recolorSelectionDarkMaterial : recolorSelectionLightMaterial,
      );
      outline.scale.setScalar(1.045);
      outline.renderOrder = 17;
      outline.userData.kind = 'recolor-selection';
      mesh.add(outline);
    }
    blocksGroup.add(mesh);
  }

  const blocks = model.getBlocks();
  const liveHeight = blocks.length > 0
    ? Math.max(...blocks.map((block) => block.z)) + 1
    : 0;

  blockMetric.textContent = String(model.getBlockCount()).padStart(3, '0');
  heightMetric.textContent = `${String(liveHeight).padStart(2, '0')}/${String(CONFIG.MAX_HEIGHT).padStart(2, '0')}`;
  applyRealtimeSurfaceVisibility();
  scheduleRealtimeOrganicSurface();
}

// -----------------------------------------------------------------------------
// 7. RAYCASTING + PHYSICAL PLACEMENT PREVIEW
// -----------------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function updatePointerFromEvent(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
}

function getClosestInteractiveIntersection(event) {
  updatePointerFromEvent(event);
  raycaster.setFromCamera(pointer, camera);

  // Base + currently rendered block meshes are the only interactive surfaces.
  const targets = [baseMesh, ...blocksGroup.children.filter(object => object.userData.kind === 'block')];
  return raycaster.intersectObjects(targets, false)[0] ?? null;
}

/**
 * Convert a hit surface into the candidate cell next to that surface.
 * This is what lets a side-face hover visibly demonstrate an invalid overhang.
 */
function intersectionToCandidate(intersection) {
  if (!intersection) return null;

  if (intersection.object.userData.kind === 'base') {
    return worldToBaseCell(intersection.point);
  }

  if (intersection.object.userData.kind === 'block') {
    const { x, y, z } = intersection.object.userData;
    const normal = intersection.face?.normal ?? new THREE.Vector3(0, 1, 0);

    // Blocks are never rotated, so local face normal maps directly to world axes.
    // world X -> model X, world Z -> model Y, world Y -> model Z.
    return {
      x: x + Math.round(normal.x),
      y: y - Math.round(normal.z),
      z: z + Math.round(normal.y),
    };
  }

  return null;
}

let constraintPulseTimeout: number | null = null;
let lastConstraintMessage = '';
function setFeedback(title, text, invalid = false) {
  // Feedback text, state and pulse are committed in the same interaction tick.
  // A new constraint restarts the dot immediately; ordinary pointer-move
  // updates over the same invalid cell do not restart the animation every frame.
  const constraintMessage = `${title}\u0000${text}`;
  const newConstraint = invalid && (
    !feedbackCard.classList.contains('is-invalid') ||
    !feedbackCard.classList.contains('constraint-pulse') ||
    lastConstraintMessage !== constraintMessage
  );
  feedbackTitle.textContent = title;
  feedbackText.textContent = text;
  feedbackCard.classList.toggle('is-invalid', invalid);
  if (constraintPulseTimeout !== null) {
    window.clearTimeout(constraintPulseTimeout);
    constraintPulseTimeout = null;
  }
  if (invalid) {
    if (newConstraint) {
      feedbackCard.classList.remove('constraint-pulse');
      // Only force a reflow for a NEW constraint, never on every hover frame.
      // This restarts the blink on the same frame as the updated warning.
      void feedbackCard.offsetWidth;
      feedbackCard.classList.add('constraint-pulse');
    }
    lastConstraintMessage = constraintMessage;
    constraintPulseTimeout = window.setTimeout(() => {
      feedbackCard.classList.remove('constraint-pulse');
      constraintPulseTimeout = null;
    }, 1200);
  } else {
    lastConstraintMessage = '';
    feedbackCard.classList.remove('constraint-pulse');
  }
}

function setGhostColor(valid) {
  if (valid && selectedTool === 'standard') {
    ghostMaterial.color.set(selectedBlockColor);
    ghostEdgeMaterial.color.set(selectedBlockColor);
  } else {
    const color = valid ? COLORS.validGhost : COLORS.invalid;
    ghostMaterial.color.setHex(color);
    ghostEdgeMaterial.color.setHex(color);
  }
  ghostMaterial.opacity = valid ? 0.12 : 0.18;
  ghostEdgeMaterial.opacity = 1;
}

function updateHover(event) {
  if (exactImportedStl && !isApproximateBlockPreview()) {
    ghost.visible = false;
    hoveredCandidate = null;
    return;
  }

  if (colorTransferMode !== 'off') {
    ghost.visible = false;
    hoveredCandidate = null;
    const hit=getClosestInteractiveIntersection(event);
    const isStandard=hit?.object.userData.kind==='block'&&hit.object.userData.type==='standard';
    renderer.domElement.classList.toggle('color-transfer-hover',Boolean(isStandard));
    return;
  }

  if (recolorTarget === 'selected') {
    ghost.visible = false;
    hoveredCandidate = null;
    const intersection = getClosestInteractiveIntersection(event);
    if (intersection?.object.userData.kind === 'block' && intersection.object.userData.type === 'standard') {
      const { x, y, z } = intersection.object.userData;
      if(layerEditEnabled && z!==activeLayerView){ghost.visible=false;return;}
      const key = modelBlockKey(x, y, z);
      const action = recolorSelectedKeys.has(key) ? 'deselect' : 'select';
      setFeedback('SELECT MODEL COLOR', `Click Standard Block [${x}, ${y}, ${z}] to ${action} it · ${String(recolorSelectedKeys.size).padStart(2, '0')} selected.`);
    } else {
      setFeedback('SELECT MODEL COLOR', `Select Standard Blocks in the model, then choose a color · ${String(recolorSelectedKeys.size).padStart(2, '0')} selected.`);
    }
    return;
  }

  if (IS_HARDWARE_BUILDER) { ghost.visible = false; hoveredCandidate = null; return; }

  if (exportSurfaceMode === 'soft1' || selectedTool === 'free') {
    ghost.visible = false;
    hoveredCandidate = null;
    return;
  }

  if (activeLayerView !== null && !layerEditEnabled) {
    ghost.visible = false;
    hoveredCandidate = null;
    setFeedback(
      `LAYERS 01–${String(activeLayerView + 1).padStart(2, '0')}`,
      'Cumulative layer view is inspection-only. Return to ALL layers to place or erase blocks.',
    );
    return;
  }

  if (serialConnected || simulationActive) {
    ghost.visible = false;
    hoveredCandidate = null;
    setFeedback('HARDWARE MODE', 'ESP32 is the source of truth. Disconnect it to edit with the mouse.');
    return;
  }

  const intersection = getClosestInteractiveIntersection(event);

  if (selectedTool === 'eraser') {
    hoveredCandidate = null;
    ghost.visible = false;

    if (intersection?.object.userData.kind === 'block') {
      const { x, y, z } = intersection.object.userData;
      if(layerEditEnabled && z!==activeLayerView){ghost.visible=false;return;}
      ghost.position.copy(modelToWorld(x, y, z));
      setGhostColor(false);
      ghost.visible = true;
      setFeedback('ERASE BLOCK', `Remove [${x}, ${y}, ${z}] and apply gravity to its stack.`);
    } else {
      setFeedback('ERASER ACTIVE', 'Hover an existing block to remove it.');
    }
    return;
  }

  const candidate = intersectionToCandidate(intersection);
  if(layerEditEnabled && candidate && candidate.z!==activeLayerView){ghost.visible=false;hoveredCandidate=null;setFeedback('EDIT SELECTED LAYER',`Place or erase on layer ${activeLayerView+1} only.`);return;}
  hoveredCandidate = candidate;

  if (!candidate) {
    ghost.visible = false;
    setFeedback('PLACE ON BASE', 'Hover a cell or block face to preview a physically valid placement.');
    return;
  }

  const validation = model.validatePlacement(candidate.x, candidate.y, candidate.z);
  ghost.position.copy(modelToWorld(candidate.x, candidate.y, candidate.z));
  setGhostColor(validation.valid);
  ghost.visible = true;

  if (validation.valid) {
    setFeedback(
      'VALID PLACEMENT',
      `[${candidate.x}, ${candidate.y}, ${candidate.z}] · ${validation.reason}`,
      false,
    );
  } else {
    setFeedback(
      'PHYSICAL CONSTRAINT',
      `[${candidate.x}, ${candidate.y}, ${candidate.z}] · ${validation.reason}`,
      true,
    );
  }
}

// -----------------------------------------------------------------------------
// 8. INPUT -> MODEL MUTATION -> RENDER SYNC
// -----------------------------------------------------------------------------
function handleCanvasAction(event) {
  if(document.body.classList.contains("studio-presenting"))return;
  if (exactImportedStl) {
    setFeedback('ORIGINAL STL', 'Exact blocks unavailable. Load the original .BIL to edit.', true);
    return;
  }

  if (colorTransferMode !== 'off') {
    const hit = getClosestInteractiveIntersection(event);
    if(hit?.object.userData.kind!=='block'||hit.object.userData.type!=='standard') {
      setFeedback('EYEDROPPER', 'Choose an existing Standard Block. Support Blocks cannot be sampled or painted.');
      return;
    }
    const {x,y,z}=hit.object.userData;
    const block=model.getBlocks().find(b=>b.x===x&&b.y===y&&b.z===z&&b.type==='standard');
    if(!block)return;
    if(colorTransferMode==='pick'){
      sampledBlockColor=normalizeStandardBlockColor(block.color);
      selectedBlockColor=sampledBlockColor;
      updateBlockColorUi();
      setColorTransferMode('paint');
      setFeedback('COLOR SAMPLED', `${sampledBlockColor.toUpperCase()} copied from [${x}, ${y}, ${z}]. Click another block to paint it.`);
      return;
    }
    const result=model.setStandardBlocksColor([modelBlockKey(x,y,z)],sampledBlockColor);
    if(result.changed){recordHistory();syncViewFromModel();}
    setFeedback('EYEDROPPER / PAINT', `${sampledBlockColor.toUpperCase()} ${result.changed?'applied to':'already on'} block [${x}, ${y}, ${z}]. Continue painting or press Esc.`);
    return;
  }

  if (recolorTarget === 'selected') {
    const intersection = getClosestInteractiveIntersection(event);


    if (intersection?.object.userData.kind !== 'block' || intersection.object.userData.type !== 'standard') {
      setFeedback('SELECT MODEL COLOR', 'Only Standard Blocks can be selected for recoloring.');
      return;
    }
    const { x, y, z } = intersection.object.userData;
    const key = modelBlockKey(x, y, z);
    if (recolorSelectedKeys.has(key)) recolorSelectedKeys.delete(key);
    else recolorSelectedKeys.add(key);
    updateRecolorTargetUi();
    syncViewFromModel();
    setFeedback('SELECT MODEL COLOR', `${String(recolorSelectedKeys.size).padStart(2, '0')} Standard Block(s) selected · choose a color in the open color panel.`);
    return;
  }

  if (IS_HARDWARE_BUILDER) {
    setFeedback('PHYSICAL INPUT ONLY', 'Place or remove bricks on the sensor baseplate. The digital scene mirrors valid ESP32 readings.');
    return;
  }

  if (exportSurfaceMode === 'soft1') {
    setFeedback('SMOOTH VIEW', 'Editing is disabled in Smooth view. Switch Model View to Blocks to place or erase cubes.', true);
    return;
  }

  if (selectedTool === 'free') {
    return;
  }

  if (activeLayerView !== null && !layerEditEnabled) {
    setFeedback('LAYER VIEW ONLY', 'Cumulative layer view is inspection-only. Return to ALL layers before editing the build.', true);
    return;
  }

  if (serialConnected || simulationActive) {
    setFeedback('HARDWARE MODE', 'ESP32 is connected. Disconnect it before using mouse placement.', true);
    return;
  }

  const intersection = getClosestInteractiveIntersection(event);
  if(layerEditEnabled && activeLayerView!==null){
    if(getMissingLayerSupportCells().length){const rect=renderer.domElement.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);const hit=ray.intersectObjects(layerRepairMarkers.children,false)[0];if(hit&&['standard','support'].includes(selectedTool)){const cell=hit.object.userData.repairCell;editSelectedLayerCell('place',cell.x,cell.y,selectedTool);}else pulseLayerRepair();return;}

    if(selectedTool==='eraser'){const b=intersection?.object.userData;if(b?.kind!=='block'||b.z!==activeLayerView){setFeedback('SELECTED LAYER ONLY','Choose a block on the selected layer.',true);return;}editSelectedLayerCell('remove',b.x,b.y);return;}
    const candidate=intersectionToCandidate(intersection);if(!candidate||candidate.z!==activeLayerView){setFeedback('SELECTED LAYER ONLY','Place blocks on the selected layer only.',true);return;}editSelectedLayerCell('place',candidate.x,candidate.y,selectedTool);return;
  }

  if (selectedTool === 'eraser') {
    if (intersection?.object.userData.kind !== 'block') return;

    const { x, y, z } = intersection.object.userData;
    const result = model.removeBlockAndApplyGravity(x, y, z);
    if (result.removed) recordHistory();
    syncViewFromModel();
    ghost.visible = false;
    systemStatus.textContent = result.reason;
    setFeedback('STACK UPDATED', result.reason);
    return;
  }

  const candidate = intersectionToCandidate(intersection);
  if (!candidate) return;

  const result = placeStudioBlock(
    candidate.x,
    candidate.y,
    candidate.z,
    selectedTool,
    selectedTool === 'standard' ? selectedBlockColor : null,
  );

  if (!result.valid) {
    systemStatus.textContent = result.reason;
    setFeedback('PLACEMENT BLOCKED', result.reason, true);
    return;
  }

  recordHistory();
  syncViewFromModel();
  systemStatus.textContent = 'MODEL STATE UPDATED';

  // Re-evaluate hover after placement because the surface under the pointer changed.
  updateHover(event);
}

// -----------------------------------------------------------------------------
// CONTINUOUS BUILD / ERASE
// -----------------------------------------------------------------------------
// In Continuous Build mode, the canvas behaves like a paint surface:
// - Hold + drag with Standard/Support to place one block on top of each column.
// - Hold still to keep stacking the same column upward.
// - Eraser removes continuously while dragging/holding.
// - Alt + left-drag is reserved for OrbitControls while the mode is enabled.
// A whole press/drag/release stroke is recorded as ONE Undo step.
function canUseDigitalEditing() {
  return recolorTarget === 'new' && exportSurfaceMode !== 'soft1' && selectedTool !== 'free' && activeLayerView === null && !(serialConnected || simulationActive) && !exactImportedStl;
}

function findNextStackLevel(x, y) {
  let z = 0;
  while (z < CONFIG.MAX_HEIGHT && model.has(x, y, z)) z += 1;
  return z;
}

function getContinuousColumnFromEvent(event) {
  const intersection = getClosestInteractiveIntersection(event);
  if (!intersection) return null;

  if (intersection.object.userData.kind === 'block') {
    const { x, y } = intersection.object.userData;
    return { x, y };
  }

  if (intersection.object.userData.kind === 'base') {
    const cell = worldToBaseCell(intersection.point);
    return model.isInsideBase(cell.x, cell.y) ? { x: cell.x, y: cell.y } : null;
  }

  return null;
}

function markContinuousMutation(label, message) {
  continuousStrokeDirty = true;
  syncViewFromModel();
  systemStatus.textContent = label;
  setFeedback('CONTINUOUS EDIT', message);
}

function applyContinuousAtPointer(event, { fromHold = false } = {}) {
  if(document.body.classList.contains("studio-presenting"))return false;
  if (!continuousStrokeActive || !canUseDigitalEditing()) return false;

  continuousLastPointer = { clientX: event.clientX, clientY: event.clientY };

  if (selectedTool === 'eraser') {
    const intersection = getClosestInteractiveIntersection(event);
    if (intersection?.object.userData.kind !== 'block') return false;

    const { x, y, z } = intersection.object.userData;
    const columnKey = `${x},${y}`;
    continuousCurrentColumn = { x, y };

    // During a drag, erase once per entered column. Holding still bypasses this
    // guard so the column can be removed progressively.
    if (!fromHold && continuousLastColumnKey === columnKey) return false;
    continuousLastColumnKey = columnKey;

    const result = model.removeBlockAndApplyGravity(x, y, z);
    if (!result.removed) return false;

    markContinuousMutation('CONTINUOUS ERASE', `Removed [${x}, ${y}, ${z}] · hold or drag to continue.`);
    return true;
  }

  const column = getContinuousColumnFromEvent(event);
  if (!column) return false;

  const columnKey = `${column.x},${column.y}`;
  continuousCurrentColumn = column;

  // Dragging paints a single block per entered column. Holding still is what
  // intentionally repeats the same column vertically.
  if (!fromHold && continuousLastColumnKey === columnKey) return false;
  continuousLastColumnKey = columnKey;

  const z = findNextStackLevel(column.x, column.y);
  if (z >= CONFIG.MAX_HEIGHT) {
    setFeedback('MAX HEIGHT', `Column [${column.x}, ${column.y}] is already ${CONFIG.MAX_HEIGHT} blocks high.`, true);
    return false;
  }

  const result = placeStudioBlock(
    column.x,
    column.y,
    z,
    selectedTool,
    selectedTool === 'standard' ? selectedBlockColor : null,
  );
  if (!result.valid) {
    setFeedback('PLACEMENT BLOCKED', result.reason, true);
    return false;
  }

  markContinuousMutation(
    selectedTool === 'support' ? 'SUPPORT PAINT' : 'STANDARD PAINT',
    `Placed ${selectedTool} at [${column.x}, ${column.y}, ${z}] · hold still to stack upward.`,
  );
  return true;
}

function clearContinuousHoldTimers() {
  if (continuousHoldTimeout) clearTimeout(continuousHoldTimeout);
  if (continuousHoldInterval) clearInterval(continuousHoldInterval);
  continuousHoldTimeout = null;
  continuousHoldInterval = null;
}

function startContinuousHoldTimers() {
  clearContinuousHoldTimers();
  if (!continuousStrokeActive || !continuousLastPointer) return;

  continuousHoldTimeout = setTimeout(() => {
    if (!continuousStrokeActive || !continuousLastPointer) return;

    const repeat = () => {
      if (!continuousStrokeActive || !continuousLastPointer) return;
      applyContinuousAtPointer(continuousLastPointer, { fromHold: true });
    };

    repeat();
    continuousHoldInterval = setInterval(repeat, CONTINUOUS_REPEAT_MS);
  }, CONTINUOUS_HOLD_DELAY_MS);
}

function beginContinuousStroke(event) {
  if (!canUseDigitalEditing()) {
    if (activeLayerView !== null) {
      setFeedback('LAYER VIEW ONLY', 'Return to ALL layers before continuous editing.', true);
    } else if (serialConnected || simulationActive) {
      setFeedback('HARDWARE MODE', 'Disconnect the ESP32 before continuous editing.', true);
    }
    return;
  }

  continuousStrokeActive = true;
  continuousStrokeDirty = false;
  continuousPointerId = event.pointerId;
  continuousCurrentColumn = null;
  continuousLastColumnKey = null;
  continuousLastPointer = { clientX: event.clientX, clientY: event.clientY };
  lastPointerDown = null;

  try {
    renderer.domElement.setPointerCapture(event.pointerId);
  } catch {
    // Pointer capture is a convenience; continuous editing still works without it.
  }

  applyContinuousAtPointer(event);
  startContinuousHoldTimers();
}

function finishContinuousStroke(event = null) {
  if (!continuousStrokeActive) return;

  clearContinuousHoldTimers();

  if (continuousStrokeDirty) {
    // One whole paint/erase gesture = one history entry.
    recordHistory();
  }

  if (continuousPointerId !== null) {
    try {
      renderer.domElement.releasePointerCapture(continuousPointerId);
    } catch {
      // Ignore if the browser already released capture.
    }
  }

  continuousStrokeActive = false;
  continuousStrokeDirty = false;
  continuousPointerId = null;
  continuousCurrentColumn = null;
  continuousLastColumnKey = null;
  continuousLastPointer = null;
  controls.enabled = true;

  if (event) updateHover(event);
}

function setContinuousBuildEnabled(enabled) {
  if (enabled && (serialConnected || simulationActive)) {
    setFeedback('SENSOR INPUT ACTIVE', 'Use the physical board to modify the build. Continuous Build is paused.', true);
    return;
  }
  if (enabled && activeLayerView !== null) {
    setFeedback('LAYER VIEW ONLY', 'Continuous Build is disabled while inspecting layers. Return to ALL to edit.', true);
    return;
  }
  if (enabled && exportSurfaceMode === 'soft1') {
    setFeedback('SMOOTH VIEW', 'Continuous Build is disabled while Smooth is active. Switch to Blocks to edit.', true);
    return;
  }
  if (enabled && selectedTool === 'free') {
    setFeedback('FREE MOVE', 'Camera-only mode is active. Choose a cube or eraser tool before enabling Continuous Build.', true);
    return;
  }
  if (enabled && exactImportedStl) {
    setFeedback('ORIGINAL STL', 'Original cubes unavailable. Load .BIL to edit.', true);
    return;
  }
  if (!enabled && continuousStrokeActive) finishContinuousStroke();

  continuousBuildEnabled = Boolean(enabled);
  continuousToggle.classList.toggle('is-on', continuousBuildEnabled);
  continuousToggle.setAttribute('aria-checked', String(continuousBuildEnabled));
  continuousStatus.textContent = continuousBuildEnabled ? 'ON' : 'OFF';

  if (continuousBuildEnabled) {
    systemStatus.textContent = 'CONTINUOUS BUILD ON';
    setFeedback(
      'CONTINUOUS BUILD',
      selectedTool === 'eraser'
        ? 'Hold / drag to erase continuously. Hold still to keep removing from the same column.'
        : 'Hold / drag to paint a row or path. Hold still to stack a vertical column. Alt + drag orbits.',
    );
  } else {
    systemStatus.textContent = 'CONTINUOUS BUILD OFF';
    setFeedback('SINGLE BUILD', 'Click to place or erase one block. Drag normally to orbit the model.');
  }
}

// Capture phase runs before OrbitControls. In continuous mode we temporarily
// disable left-drag orbit for a paint stroke, while Alt+drag keeps orbit active.
renderer.domElement.addEventListener('pointerdown', (event) => {
  const shouldPaint = continuousBuildEnabled
    && event.button === 0
    && !event.altKey
    && canUseDigitalEditing();

  if (shouldPaint) controls.enabled = false;
}, { capture: true });

renderer.domElement.addEventListener('pointermove', (event) => {
  if (continuousStrokeActive) {
    const previous = continuousLastPointer;
    const moved = !previous || Math.hypot(event.clientX - previous.clientX, event.clientY - previous.clientY) > 3;

    applyContinuousAtPointer(event);
    if (moved) startContinuousHoldTimers();
    updateHover(event);
    return;
  }

  updateHover(event);
});

renderer.domElement.addEventListener('pointerleave', () => {
  if (continuousStrokeActive) return;
  ghost.visible = false;
  hoveredCandidate = null;
});

// Normal mode keeps the original click-vs-orbit behavior. Continuous mode uses
// press/drag/release instead, with Alt+drag reserved for camera orbit.
renderer.domElement.addEventListener('pointerdown', (event) => {
  if (continuousBuildEnabled && event.button === 0 && !event.altKey && canUseDigitalEditing()) {
    beginContinuousStroke(event);
    return;
  }

  lastPointerDown = { x: event.clientX, y: event.clientY, skipAction: Boolean(event.altKey) };
});

renderer.domElement.addEventListener('pointerup', (event) => {
  if (continuousStrokeActive) {
    finishContinuousStroke(event);
    return;
  }

  if (!lastPointerDown) return;

  const distance = Math.hypot(
    event.clientX - lastPointerDown.x,
    event.clientY - lastPointerDown.y,
  );

  if (distance <= 4 && event.button === 0 && !lastPointerDown.skipAction) {
    handleCanvasAction(event);
  }

  lastPointerDown = null;
});

renderer.domElement.addEventListener('pointercancel', (event) => {
  if (continuousStrokeActive) finishContinuousStroke(event);
  lastPointerDown = null;
});

// -----------------------------------------------------------------------------
// 9. TOOL UI
// -----------------------------------------------------------------------------
let blockColorCloseTimer = null;

function getFriendlyColorName(color) {
  const normalized = normalizeStandardBlockColor(color);
  const preset = blockColorChoices.find((button) => normalizeStandardBlockColor(button.dataset.blockColor) === normalized);
  return preset?.dataset.colorName?.toUpperCase() ?? 'CUSTOM';
}

function hexToHsl(hex) {
  const normalized = normalizeStandardBlockColor(hex).slice(1);
  const r = Number.parseInt(normalized.slice(0, 2), 16) / 255;
  const g = Number.parseInt(normalized.slice(2, 4), 16) / 255;
  const b = Number.parseInt(normalized.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * (((b - r) / delta) + 2);
    else h = 60 * (((r - g) / delta) + 4);
  }
  if (h < 0) h += 360;
  const l = (max + min) / 2;
  const sat = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h: Math.round(h), s: Math.round(sat * 100), l: Math.round(l * 100) };
}

function hslToHex(h, s, l) {
  const hue = ((Number(h) % 360) + 360) % 360;
  const sat = Math.max(0, Math.min(100, Number(s))) / 100;
  const light = Math.max(0, Math.min(100, Number(l))) / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const x = c * (1 - Math.abs(((hue / 60) % 2) - 1));
  const m = light - c / 2;
  let rp = 0, gp = 0, bp = 0;
  if (hue < 60) [rp, gp, bp] = [c, x, 0];
  else if (hue < 120) [rp, gp, bp] = [x, c, 0];
  else if (hue < 180) [rp, gp, bp] = [0, c, x];
  else if (hue < 240) [rp, gp, bp] = [0, x, c];
  else if (hue < 300) [rp, gp, bp] = [x, 0, c];
  else [rp, gp, bp] = [c, 0, x];
  const toHex = (value) => Math.round((value + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(rp)}${toHex(gp)}${toHex(bp)}`;
}

function updateCustomColorPanel(color = selectedBlockColor) {
  const normalized = normalizeStandardBlockColor(color);
  const hsl = hexToHsl(normalized);
  if (customHue) customHue.value = String(hsl.h);
  if (customSaturation) customSaturation.value = String(hsl.s);
  if (customLightness) customLightness.value = String(Math.max(8, Math.min(92, hsl.l)));
  if (customColorHex) customColorHex.value = normalized.toUpperCase();
  const hueColor = hslToHex(hsl.h, 100, 50);
  if (customColorPanel) {
    customColorPanel.style.setProperty('--custom-color', normalized);
    customColorPanel.style.setProperty('--custom-hue-color', hueColor);
  }
  if (customColorPreview) customColorPreview.style.background = normalized;
}

function getCustomColorFromControls() {
  return hslToHex(customHue?.value ?? 0, customSaturation?.value ?? 80, customLightness?.value ?? 50);
}

function syncCustomColorFromControls() {
  const color = normalizeStandardBlockColor(getCustomColorFromControls());
  const hueColor = hslToHex(customHue?.value ?? 0, 100, 50);
  if (customColorHex) customColorHex.value = color.toUpperCase();
  if (customColorPanel) {
    customColorPanel.style.setProperty('--custom-color', color);
    customColorPanel.style.setProperty('--custom-hue-color', hueColor);
  }
  if (customColorPreview) customColorPreview.style.background = color;
  return color;
}

// Keep this reference fresh whenever the color menu gains or loses hints.
// The eyedropper adds a visible instruction row, so an earlier cached height
// would otherwise leave the expanded Custom Color mixer outside the viewport.
function measureCompactBlockColorPopover() {
  if (IS_HARDWARE_BUILDER || !blockColorPopover || blockColorPopover.hidden ||
      customColorPanel?.classList.contains('is-open')) return;
  const height = blockColorPopover.offsetHeight;
  if (height > 0) compactColorPopoverHeight = height;
}

function setCustomColorPanelOpen(open, { focus = false } = {}) {
  if (!customColorPanel || !customColorToggle) return;
  const next = Boolean(open);
  customColorToggle.setAttribute('aria-expanded', String(next));
  if (blockColorHelp) {
    const isPreset = blockColorChoices.some((button) => normalizeStandardBlockColor(button.dataset.blockColor) === normalizeStandardBlockColor(selectedBlockColor));
    blockColorHelp.hidden = next || !isPreset;
  }
  if (next) {
    // Includes any active eyedropper guidance, before Custom Color expands.
    measureCompactBlockColorPopover();
    updateCustomColorPanel(selectedBlockColor);
    customColorPanel.hidden = false;
    blockColorPopover?.classList.add('has-custom-color-open');
    requestAnimationFrame(() => {
      customColorPanel.classList.add('is-open');
      // Raise the whole palette *with* the mixer animation, keeping the
      // combined menu in view without snapping its outer card afterward.
      positionBlockColorPopover();
    });
    if (focus) requestAnimationFrame(() => customHue?.focus());
    return;
  }
  customColorPanel.classList.remove('is-open');
  blockColorPopover?.classList.remove('has-custom-color-open');
  // Return to the compact palette anchor using the same animated top offset.
  requestAnimationFrame(() => positionBlockColorPopover());
  window.setTimeout(() => {
    if (!customColorPanel.classList.contains('is-open')) {
      customColorPanel.hidden = true;
    }
  }, 310);
}

function updateBlockColorUi() {
  const color = normalizeStandardBlockColor(selectedBlockColor);
  selectedBlockColor = color;
  if (standardColorSwatch) standardColorSwatch.style.background = color;
  if (blockColorName) blockColorName.textContent = getFriendlyColorName(color);
  if (blockColorCurrentSwatch) blockColorCurrentSwatch.style.backgroundColor = color;
  if (blockColorHelp) {
    const isPreset = blockColorChoices.some((button) => normalizeStandardBlockColor(button.dataset.blockColor) === color);
    const customEditorOpen = Boolean(customColorPanel && !customColorPanel.hidden && customColorPanel.classList.contains('is-open'));
    blockColorHelp.hidden = !isPreset || customEditorOpen;
  }
  for (const button of blockColorChoices) {
    const active = normalizeStandardBlockColor(button.dataset.blockColor) === color;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  if (customColorToggle) {
    const isPreset = blockColorChoices.some((button) => normalizeStandardBlockColor(button.dataset.blockColor) === color);
    customColorToggle.classList.toggle('is-active', !isPreset);
    customColorToggle.setAttribute('aria-pressed', String(!isPreset));
  }
  if (!customColorPanel || customColorPanel.hidden) updateCustomColorPanel(color);
}

// Remember the compact palette height. The mixer adds height below it, so
// position math never reads the growing popover and introduces a late jump.
let compactColorPopoverHeight = 0;
function positionBlockColorPopover() {
  if (IS_HARDWARE_BUILDER) return; // Integrated workbench palette participates in normal layout.
  if (!blockColorPopover || !standardToolButton) return;
  const buildKit = standardToolButton.closest('.tool-panel');
  const buttonRect = standardToolButton.getBoundingClientRect();
  const panelRect = buildKit?.getBoundingClientRect() ?? buttonRect;
  const edge = 12;
  const gap = 12;
  const width = blockColorPopover.offsetWidth || 318;
  const expanded = Boolean(customColorPanel && !customColorPanel.hidden && customColorPanel.classList.contains('is-open'));
  const closedHeight = compactColorPopoverHeight || blockColorPopover.offsetHeight || 290;
  // scrollHeight reflects the content even during the opening animation. Account
  // for the mixer's own padding/border and 13px outer gap, rather than assuming
  // the menu retained its height from before eyedropper guidance appeared.
  const mixerContent = customColorPanel?.scrollHeight || 220;
  const expandedAddition = expanded ? Math.min(325, mixerContent + 26) + 13 : 0;
  const fullHeight = closedHeight + expandedAddition;
  let left = panelRect.right + gap + 5; // V12: shift palette 19px left
  let top = buttonRect.top;
  if (left + width > window.innerWidth - edge) {
    left = Math.max(edge, Math.min(window.innerWidth - width - edge, panelRect.left));
    top = buttonRect.bottom + gap;
  }
  const compactTop = Math.max(edge, Math.min(top, window.innerHeight - closedHeight - edge));
  // Raise it a little even where it would already fit: this prevents the
  // mixer from visually running against the bottom of the workspace.
  top = expanded ? Math.min(compactTop - 24, window.innerHeight - fullHeight - edge - 18) : compactTop;
  top = Math.max(edge, top);
  blockColorPopover.style.left = `${Math.round(left)}px`;
  blockColorPopover.style.top = `${Math.round(top)}px`;
}

function setBlockColorPopoverOpen(open, { focus = false } = {}) {
  if (IS_HARDWARE_BUILDER) return; // Permanent hardware palette; swatch selection never hides it.
  if (!blockColorPopover || !standardToolButton) return;
  window.clearTimeout(blockColorCloseTimer);
  blockColorCloseTimer = null;
  const canOpen = Boolean(open) && exportSurfaceMode !== 'soft1' && !standardToolButton.disabled;
  if(!canOpen&&colorTransferMode!=='off')setColorTransferMode('off',{announce:false});
  standardToolButton.setAttribute('aria-expanded', String(canOpen));
  if (!canOpen) {
    setCustomColorPanelOpen(false);
    if (recolorTarget !== 'new') setRecolorTarget('new', { announce: false });
  }
  if (canOpen) {
    blockColorPopover.hidden = false;
    // Capture this height before the custom editor starts expanding.
    if (customColorPanel?.hidden || !customColorPanel?.classList.contains('is-open')) {
      measureCompactBlockColorPopover();
    }
    positionBlockColorPopover();
    requestAnimationFrame(() => {
      positionBlockColorPopover();
      blockColorPopover.classList.add('is-open');
    });
    if (focus) requestAnimationFrame(() => blockColorChoices[0]?.focus());
    return;
  }
  blockColorPopover.classList.remove('is-open');
  blockColorCloseTimer = window.setTimeout(() => {
    if (!blockColorPopover.classList.contains('is-open')) blockColorPopover.hidden = true;
    blockColorCloseTimer = null;
  }, 330);
}

function updateRecolorTargetUi() {
  if (blockColorTargetHint) {
    // No redundant hint for NEW; the selected scope button already explains it.
    // Preserve useful instructions for SELECTED and ENTIRE MODEL scopes.
    blockColorTargetHint.hidden = IS_HARDWARE_BUILDER ? recolorTarget !== 'selected' : recolorTarget === 'new';
    blockColorTargetHint.textContent = recolorTarget === 'selected'
      ? 'Click blocks in the model to select them, then choose a swatch.'
      : recolorTarget === 'all'
        ? 'Choose a swatch to recolor every standard block.'
        : '';
  }
  if (recolorSelectedCount) recolorSelectedCount.textContent = String(recolorSelectedKeys.size).padStart(2, '0');
  for (const button of recolorTargetButtons) {
    const active = button.dataset.colorTarget === recolorTarget;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
}

function clearRecolorSelection({ sync = true } = {}) {
  if (!recolorSelectedKeys.size) return;
  recolorSelectedKeys.clear();
  updateRecolorTargetUi();
  if (sync) syncViewFromModel();
}

function updateColorTransferUi() {
  const trigger = document.querySelector('#colorEyedropperToggle');
  const hint = document.querySelector('#colorEyedropperHint');
  const action = document.querySelector('#colorEyedropperAction');
  const swatch = document.querySelector('#colorEyedropperSwatch');
  const active = colorTransferMode !== 'off';
  trigger?.setAttribute('aria-pressed', String(active));
  trigger?.classList.toggle('is-active', active);
  if(action) action.textContent = colorTransferMode === 'pick' ? 'CLICK A SOURCE BLOCK' : colorTransferMode === 'paint' ? 'PAINT TARGET BLOCKS' : 'PICK FROM MODEL';
  if(hint) { hint.hidden = !active; hint.textContent = colorTransferMode === 'pick'
    ? 'Click a colored Standard Block in the 3D viewport to sample it.'
    : colorTransferMode === 'paint'
      ? 'Color sampled. Click as many Standard Blocks as you like. Esc to finish.'
      : 'Sample any Standard Block, then paint that color onto other blocks.'; }
  if(trigger) {
    trigger.setAttribute('aria-label', colorTransferMode==='pick' ? 'Eyedropper: click a block to sample color; click again or press Escape to cancel' : colorTransferMode==='paint' ? 'Eyedropper: painting sampled color; click again or press Escape to stop' : 'Eyedropper: sample a block color');
    trigger.setAttribute('title', colorTransferMode==='pick' ? 'Click a block to sample • Esc to exit' : colorTransferMode==='paint' ? 'Click blocks to paint • Esc to exit' : 'Eyedropper — pick a block color');
  }
  if(swatch){swatch.style.backgroundColor = sampledBlockColor || selectedBlockColor;swatch.classList.toggle('is-visible',colorTransferMode==='paint');}
  renderer.domElement.classList.toggle('color-transfer-active', active);
  if(!active)renderer.domElement.classList.remove('color-transfer-hover');
  if (!IS_HARDWARE_BUILDER && blockColorPopover && !blockColorPopover.hidden) {
    if (!customColorPanel?.classList.contains('is-open')) measureCompactBlockColorPopover();
    positionBlockColorPopover();
  }
}
function setColorTransferMode(next, { announce = true } = {}) {
  if(next !== 'off' && (IS_HARDWARE_BUILDER || exactImportedStl || exportSurfaceMode === 'soft1' || activeLayerView !== null || serialConnected || simulationActive)) {
    if(announce)setFeedback('EYEDROPPER UNAVAILABLE', 'Switch to Blocks, show all layers, and disconnect hardware to use the eyedropper.', true);
    return;
  }
  if(next !== 'off') {
    if(continuousBuildEnabled) setContinuousBuildEnabled(false);
    recolorTarget = DEFAULT_RECOLOR_TARGET;
    clearRecolorSelection({sync:false});
    updateRecolorTargetUi();
    ghost.visible = false;
    hoveredCandidate = null;
  }
  colorTransferMode = next;
  if(next==='pick') sampledBlockColor = null;
  updateColorTransferUi();
  if(announce){
    if(next==='pick')setFeedback('EYEDROPPER / PICK', 'Click a Standard Block in the model to pick up its color.');
    else if(next==='paint')setFeedback('EYEDROPPER / PAINT', 'Click other Standard Blocks to paint them. Press Esc or click the eyedropper again to finish.');
    else setFeedback('EYEDROPPER', 'Color painting finished.');
  }
}

function setRecolorTarget(target, { announce = true } = {}) {
  const allowed = IS_HARDWARE_BUILDER ? ['selected', 'all'] : ['new', 'selected', 'all'];
  const next = allowed.includes(target) ? target : DEFAULT_RECOLOR_TARGET;
  if(colorTransferMode!=='off')setColorTransferMode('off',{announce:false});
  if (!IS_HARDWARE_BUILDER && (serialConnected || simulationActive) && next !== 'new') {
    if (announce) setFeedback('SENSOR INPUT ACTIVE', 'Change cube colors through Hardware Settings while a session is active.', true);
    return;
  }

  if (next === 'selected') {
    if ((exactImportedStl && !isApproximateBlockPreview()) || exportSurfaceMode === 'soft1' || activeLayerView !== null || (!IS_HARDWARE_BUILDER && (serialConnected || simulationActive))) {
      recolorTarget = DEFAULT_RECOLOR_TARGET;
      clearRecolorSelection({ sync: false });
      updateRecolorTargetUi();
      if (announce) setFeedback('MODEL COLOR', IS_HARDWARE_BUILDER ? 'Selection recoloring requires Blocks view with ALL layers visible.' : 'Selection recoloring is available in Blocks view with ALL layers visible and hardware disconnected.', true);
      return;
    }
    if (continuousBuildEnabled) setContinuousBuildEnabled(false);
    recolorTarget = 'selected';
    ghost.visible = false;
    hoveredCandidate = null;
    updateRecolorTargetUi();
    syncViewFromModel();
    if (announce) setFeedback('SELECT MODEL COLOR', `Click Standard Blocks to select them · ${String(recolorSelectedKeys.size).padStart(2, '0')} selected · then choose a color.`);
    return;
  }

  if (recolorTarget === 'selected') clearRecolorSelection({ sync: false });
  recolorTarget = next;
  updateRecolorTargetUi();
  syncViewFromModel();

  if (!announce) return;
  if (next === 'all') setFeedback('MODEL COLOR / ALL', 'Choose a color to recolor every Standard Block already in the model.');
  else setFeedback('BLOCK COLOR / NEW', 'Choose the color used by newly placed Standard Blocks.');
}

function chooseBlockColor(color, { close = true, announce = true } = {}) {
  if (!IS_HARDWARE_BUILDER && (serialConnected || simulationActive)) {
    setFeedback('SENSOR INPUT ACTIVE', 'Change the cube color using Hardware Settings while a sensor session is running.', true);
    return;
  }
  const normalized = normalizeStandardBlockColor(color);
  if(colorTransferMode!=='off')setColorTransferMode('off',{announce:false});

  if (recolorTarget === 'new') {
    if (IS_HARDWARE_BUILDER) {
      HARDWARE_CONFIG.standardColor = normalized;
      if (hardwareDefaultColor) hardwareDefaultColor.value = normalized;
      if (hardwareDefaultHex) hardwareDefaultHex.value = normalized.toUpperCase();
      if (hardwareDefaultSwatch) hardwareDefaultSwatch.style.backgroundColor = normalized;
      rebuildHardwareProfiles();
    }
    selectedBlockColor = normalized;
    updateBlockColorUi();
    if (close) setBlockColorPopoverOpen(false);
    if (announce) setFeedback('BLOCK COLOR', IS_HARDWARE_BUILDER ? `${getFriendlyColorName(selectedBlockColor)} selected for future sensor-detected Standard Blocks.` : `${getFriendlyColorName(selectedBlockColor)} selected. New Standard Blocks will use this color.`);
    return;
  }

  if (recolorTarget === 'all') {
    const standardCount = model.getBlocks().filter((block) => block.type === 'standard').length;
    if (!standardCount) {
      setFeedback('MODEL COLOR / ALL', 'Add at least one Standard Block before recoloring the model.', true);
      return;
    }
    const result = model.setAllStandardColor(normalized);
    if (result.changed) recordHistory();
    if (IS_HARDWARE_BUILDER) { selectedBlockColor = normalized; updateBlockColorUi(); }
    syncViewFromModel();
    setFeedback('MODEL COLOR / ALL', `${String(standardCount).padStart(2, '0')} Standard Block(s) now use ${getFriendlyColorName(normalized)}.`);
    recolorTarget = DEFAULT_RECOLOR_TARGET;
    updateRecolorTargetUi();
    if (close) setBlockColorPopoverOpen(false);
    return;
  }

  if (!recolorSelectedKeys.size) {
    setFeedback('SELECT MODEL COLOR', 'Select at least one Standard Block in the viewport before choosing a color.', true);
    return;
  }

  const selectedCount = recolorSelectedKeys.size;
  const result = model.setStandardBlocksColor([...recolorSelectedKeys], normalized);
  if (result.changed) recordHistory();
  if (IS_HARDWARE_BUILDER) { selectedBlockColor = normalized; updateBlockColorUi(); }
  recolorSelectedKeys.clear();
  recolorTarget = DEFAULT_RECOLOR_TARGET;
  updateRecolorTargetUi();
  syncViewFromModel();
  if (close) setBlockColorPopoverOpen(false);
  if (announce) setFeedback('MODEL COLOR / SELECTED', `${String(selectedCount).padStart(2, '0')} selected Standard Block(s) now use ${getFriendlyColorName(normalized)}.`);
}

updateBlockColorUi();
updateRecolorTargetUi();
updateColorTransferUi();
document.querySelector('#colorEyedropperToggle')?.addEventListener('click', () => {
  if(colorTransferMode!=='off')setColorTransferMode('off');
  else {
    setColorTransferMode('pick');
    // Keep the palette open to show which phase is active.
    if(colorTransferMode==='pick')setBlockColorPopoverOpen(true);
  }
});

function selectTool(tool, { announce = true } = {}) {
  if (IS_HARDWARE_BUILDER && tool !== 'free') return;
  const nextTool = ['standard', 'support', 'eraser', 'free'].includes(tool) ? tool : 'standard';
  if ((serialConnected || simulationActive) && nextTool !== 'free') {
    if (announce) setFeedback('SENSOR INPUT ACTIVE', 'Use the sensor grid to place or remove cubes. Digital block tools are temporarily unavailable.', true);
    return;
  }

  if (nextTool !== 'free' && activeLayerView !== null && !layerEditEnabled) {
    if (announce) {
      setFeedback('LAYER VIEW ONLY', 'Cube tools and Eraser are disabled while inspecting layers. Return to ALL to edit.', true);
    }
    return;
  }

  if (nextTool !== 'free' && exportSurfaceMode === 'soft1') {
    if (announce) {
      setFeedback('SMOOTH VIEW', 'Cube tools and Eraser are disabled while Smooth is active. Switch to Blocks to edit.', true);
    }
    return;
  }

  if (nextTool !== 'standard') {
    if(colorTransferMode!=='off')setColorTransferMode('off',{announce:false});
    if (recolorTarget !== DEFAULT_RECOLOR_TARGET) setRecolorTarget(DEFAULT_RECOLOR_TARGET, { announce: false });
    setBlockColorPopoverOpen(false);
  }

  if (nextTool === 'free') {
    if (continuousBuildEnabled) setContinuousBuildEnabled(false);
    selectedTool = 'free';
  } else {
    selectedTool = nextTool;
    lastBuildTool = nextTool;
  }

  for (const button of toolButtons) {
    button.classList.toggle('is-active', button.dataset.tool === selectedTool);
  }
  if (freeMoveButton) {
    const active = selectedTool === 'free';
    freeMoveButton.classList.toggle('is-active', active);
    freeMoveButton.setAttribute('aria-pressed', String(active));
  }

  ghost.visible = false;
  hoveredCandidate = null;

  const names = {
    standard: `STANDARD BLOCK / ${getFriendlyColorName(selectedBlockColor)}`,
    support: 'SUPPORT BLOCK SELECTED',
    eraser: 'ERASER SELECTED',
    free: 'FREE MOVE SELECTED',
  };
  systemStatus.textContent = names[selectedTool];

  if (!announce) return;

  if (selectedTool === 'free') {
    setFeedback('FREE MOVE', 'Camera-only mode. Drag to orbit the model without placing or erasing cubes.');
  } else if (exactImportedStl) {
    setFeedback('ORIGINAL STL', 'Exact blocks unavailable. Load the original .BIL to edit.');
  } else if (activeLayerView !== null && !layerEditEnabled) {
    setFeedback(
      `LAYERS 01–${String(activeLayerView + 1).padStart(2, '0')}`,
      layerEditEnabled?'Click blocks on the selected layer to edit.':'Enable EDIT THIS LAYER to place or erase on this layer.',
    );
  } else if (serialConnected || simulationActive) {
    setFeedback('HARDWARE MODE', 'ESP32 is connected and controls the model state.');
  } else if (continuousBuildEnabled && selectedTool === 'eraser') {
    setFeedback('CONTINUOUS ERASE', 'Hold / drag to erase blocks. Hold still to keep removing from the same column.');
  } else if (continuousBuildEnabled) {
    setFeedback('CONTINUOUS BUILD', 'Hold / drag to paint a row or path. Hold still to stack a vertical column. Alt + drag orbits.');
  } else if (selectedTool === 'eraser') {
    setFeedback('ERASER ACTIVE', 'Click a block. Higher blocks in that column drop down.');
  } else {
    setFeedback('PLACE ON BASE', 'Hover a cell or block face to preview a physically valid placement.');
  }
}

toolButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const tool = button.dataset.tool;
    if (tool === 'standard' && IS_HARDWARE_BUILDER) {
      const open = blockColorPopover?.hidden || !blockColorPopover?.classList.contains('is-open');
      setBlockColorPopoverOpen(open);
      return;
    }
    if (tool === 'standard') {
      if(!IS_HARDWARE_BUILDER&&getMissingLayerSupportCells().length){selectTool('standard');setBlockColorPopoverOpen(false);return;}
      const alreadyStandard = selectedTool === 'standard';
      selectTool('standard');
      if (selectedTool === 'standard') {
        setBlockColorPopoverOpen(alreadyStandard ? blockColorPopover?.hidden || !blockColorPopover?.classList.contains('is-open') : true);
      }
      return;
    }
    selectTool(tool);
  });
});

for (const button of recolorTargetButtons) {
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    setCustomColorPanelOpen(false);
    setRecolorTarget(button.dataset.colorTarget);
  });
}

for (const button of blockColorChoices) {
  button.addEventListener('click', (event) => {
    event.stopPropagation();
    setCustomColorPanelOpen(false);
    chooseBlockColor(button.dataset.blockColor);
  });
}
customColorToggle?.addEventListener('click', (event) => {
  event.stopPropagation();
  const open = customColorPanel?.hidden || !customColorPanel?.classList.contains('is-open');
  setCustomColorPanelOpen(open, { focus: open });
});
customColorClose?.addEventListener('click', (event) => {
  event.stopPropagation();
  setCustomColorPanelOpen(false);
  customColorToggle?.focus();
});
for (const control of [customHue, customSaturation, customLightness]) {
  control?.addEventListener('input', syncCustomColorFromControls);
}
customColorHex?.addEventListener('input', (event) => {
  const raw = String(event.target.value || '').trim();
  const candidate = raw.startsWith('#') ? raw : `#${raw}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(candidate)) return;
  updateCustomColorPanel(candidate);
});
customColorHex?.addEventListener('blur', () => {
  const raw = String(customColorHex.value || '').trim();
  const candidate = raw.startsWith('#') ? raw : `#${raw}`;
  if (/^#[0-9a-fA-F]{6}$/.test(candidate)) updateCustomColorPanel(candidate);
  else updateCustomColorPanel(selectedBlockColor);
});
customColorApply?.addEventListener('click', (event) => {
  event.stopPropagation();
  const raw = String(customColorHex?.value || '').trim();
  const candidate = raw.startsWith('#') ? raw : `#${raw}`;
  const color = /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate : getCustomColorFromControls();
  chooseBlockColor(color, { close: true, announce: true });
});
blockColorPopover?.addEventListener('pointerdown', (event) => event.stopPropagation());
window.addEventListener('resize', () => {
  if (blockColorPopover && !blockColorPopover.hidden) {
    measureCompactBlockColorPopover();
    positionBlockColorPopover();
  }
});
window.addEventListener('pointerdown', (event) => {
  if (IS_HARDWARE_BUILDER) return; // The integrated palette is not a dismissible overlay.
  if (!blockColorPopover || blockColorPopover.hidden) return;
  if (blockColorPopover.contains(event.target) || standardToolButton?.contains(event.target)) return;
  if ((recolorTarget === 'selected' || colorTransferMode !== 'off') && renderer.domElement.contains(event.target)) return;
  setBlockColorPopoverOpen(false);
});
backupLibraryButton?.addEventListener('click', async () => {
  try {
    backupLibraryButton.disabled = true;
    // Flush pending updates and include synchronous local cache if necessary.
    await archiveRecentModels(BUILDER_MODE, readRecentModels());
    const entries = await listEntireProjectLibrary();
    if (!entries.length) throw new Error('Save a project first. Your library is empty.');
    const backup = buildLibraryBackup(entries);
    downloadBlob(backup, 'zip', {filename:`build-it-live-library-${new Date().toISOString().slice(0,10)}.zip`});
    if (libraryStatus) libraryStatus.textContent = `BACKUP READY / ${entries.length} PROJECTS`;
  } catch (error) { if (libraryStatus) libraryStatus.textContent = error instanceof Error ? error.message : 'Backup failed'; }
  finally {backupLibraryButton.disabled = false;}
});
restoreLibraryButton?.addEventListener('click', () => restoreLibraryInput?.click());
restoreLibraryInput?.addEventListener('change', async () => {
  const file = restoreLibraryInput.files?.[0];
  restoreLibraryInput.value = '';
  if (!file) return;
  try {
    const entries = await readStoredZipManifest(await file.arrayBuffer());
    if (!(await requestProjectAction({title:'RESTORE PROJECT LIBRARY?', description:`Import ${entries.length} saved project(s). Existing projects will be kept and duplicates skipped.`, confirmLabel:'RESTORE PROJECTS', eyebrow:'PROJECT LIBRARY / IMPORT'}))) return;
    const result = await importProjectLibrary(entries);
    await hydrateRecentLibrary();
    if (libraryStatus) libraryStatus.textContent = `${result.added} IMPORTED / ${result.skipped} ALREADY SAVED`;
  } catch (error) { if (libraryStatus) libraryStatus.textContent = error instanceof Error ? error.message : 'Cannot read backup'; }
});

window.addEventListener('keydown', (event) => {
  if (document.querySelector('#projectActionDialog')?.open) return;
  if (!hardwareSetupModal.hidden && resolveHardwareSetup) {
    if (event.key === 'Escape') finishHardwareSetup();
    return;
  }
  if (event.key === 'Escape' && customColorPanel && !customColorPanel.hidden) {
    setCustomColorPanelOpen(false);
    customColorToggle?.focus();
    return;
  }
  if (event.key === 'Escape' && colorTransferMode !== 'off') {
    setColorTransferMode('off');
    return;
  }
  if (event.key === 'Escape' && recolorTarget === 'selected') {
    setRecolorTarget(DEFAULT_RECOLOR_TARGET, { announce: false });
    setFeedback('MODEL COLOR', 'Selection recoloring cancelled.');
    return;
  }
  if (!IS_HARDWARE_BUILDER && event.key === 'Escape' && blockColorPopover && !blockColorPopover.hidden) {
    setBlockColorPopoverOpen(false);
    standardToolButton?.focus();
  }
});

freeMoveButton?.addEventListener('click', () => {
  if (selectedTool === 'free' && exportSurfaceMode !== 'soft1') selectTool(lastBuildTool);
  else selectTool('free');
});

backupLibraryButton?.addEventListener('click', async () => {
  try {
    backupLibraryButton.disabled = true;
    // Flush pending updates and include synchronous local cache if necessary.
    await archiveRecentModels(BUILDER_MODE, readRecentModels());
    const entries = await listEntireProjectLibrary();
    if (!entries.length) throw new Error('Save a project first. Your library is empty.');
    const backup = buildLibraryBackup(entries);
    downloadBlob(backup, 'zip', {filename:`build-it-live-library-${new Date().toISOString().slice(0,10)}.zip`});
    if (libraryStatus) libraryStatus.textContent = `BACKUP READY / ${entries.length} PROJECTS`;
  } catch (error) { if (libraryStatus) libraryStatus.textContent = error instanceof Error ? error.message : 'Backup failed'; }
  finally {backupLibraryButton.disabled = false;}
});
restoreLibraryButton?.addEventListener('click', () => restoreLibraryInput?.click());
restoreLibraryInput?.addEventListener('change', async () => {
  const file = restoreLibraryInput.files?.[0];
  restoreLibraryInput.value = '';
  if (!file) return;
  try {
    const entries = await readStoredZipManifest(await file.arrayBuffer());
    if (!(await requestProjectAction({title:'RESTORE PROJECT LIBRARY?', description:`Import ${entries.length} saved project(s). Existing projects will be kept and duplicates skipped.`, confirmLabel:'RESTORE PROJECTS', eyebrow:'PROJECT LIBRARY / IMPORT'}))) return;
    const result = await importProjectLibrary(entries);
    await hydrateRecentLibrary();
    if (libraryStatus) libraryStatus.textContent = `${result.added} IMPORTED / ${result.skipped} ALREADY SAVED`;
  } catch (error) { if (libraryStatus) libraryStatus.textContent = error instanceof Error ? error.message : 'Cannot read backup'; }
});

window.addEventListener('keydown', (event) => {
  if (document.querySelector('#projectActionDialog')?.open) return;
  if (event.key === 'Escape' && gridSettingsPopover && !gridSettingsPopover.hidden) {
    setGridSettingsOpen(false);
    return;
  }
  if (event.key === '1') selectTool('standard');
  if (event.key === '2') selectTool('support');
  if (event.key.toLowerCase() === 'e') selectTool('eraser');
  if (event.key.toLowerCase() === 'm') {
    if (selectedTool === 'free' && exportSurfaceMode !== 'soft1') selectTool(lastBuildTool);
    else selectTool('free');
  }
});


clearBuildButton.addEventListener('click', () => {
  if (serialConnected || simulationActive) {
    setFeedback('SENSOR INPUT ACTIVE', 'Disconnect the ESP32 before clearing the digital plate.', true);
    return;
  }
  if (exactImportedStl) {
    setActiveRecentModel(null);
    clearExactStlMode();
    markEditableWorkspaceActive();
    model.clear();
    resetHistoryToCurrent();
    syncViewFromModel();
    systemStatus.textContent = 'STL CLEARED';
    setFeedback('EMPTY GRID', `STL mesh removed. The ${model.gridWidth}×${model.gridDepth} grid is editable again.`);
    return;
  }

  if (activeLayerView !== null) {
    setFeedback('LAYER VIEW ONLY', 'Cumulative layer view is inspection-only. Return to ALL layers before clearing the build.', true);
    return;
  }

  if (serialConnected || simulationActive) {
    setFeedback('HARDWARE MODE', 'Disconnect the ESP32 before clearing the digital model.', true);
    return;
  }

  if (model.getBlockCount() === 0) return;
  // Clearing starts a new build branch. The old autosaved model remains in
  // Recent Models and the next placed block creates a fresh model entry.
  setActiveRecentModel(null);
  markEditableWorkspaceActive();
  model.clear();
  recordHistory();
  syncViewFromModel();
  ghost.visible = false;
  systemStatus.textContent = 'BUILD CLEARED';
  setFeedback('EMPTY GRID', `The ${model.gridWidth}×${model.gridDepth} active grid has been reset.`);
});

resetViewButton.addEventListener('click', () => {
  camera.position.copy(defaultCameraPosition);
  controls.target.set(0, 2.2, 0);
  controls.update();
  systemStatus.textContent = 'CAMERA RESET';
});

undoBuildButton.addEventListener('click', undoBuild);
redoBuildButton.addEventListener('click', redoBuild);
continuousToggle.addEventListener('click', () => setContinuousBuildEnabled(!continuousBuildEnabled));

layerSlider.addEventListener('input', () => setLayerView(layerSlider.value));
showAllLayersButton.addEventListener('click', () => setLayerView(0));

let gridSettingsCloseTimer = null;
let gridSettingsIsOpen = false;

function positionGridSettingsPopover() {
  if (!gridSettingsPopover || gridSettingsPopover.hidden) return;
  const toolbar = document.querySelector('.studio-canvas-toolbar');
  const workspace = document.querySelector('.studio-scene');
  const anchor = toolbar?.getBoundingClientRect();
  // The 3D scene now spans behind the rails, so anchor to the visible
  // toolbar bounds rather than the full-bleed scene bounds.
  const bounds = toolbar?.getBoundingClientRect() ?? workspace?.getBoundingClientRect();
  const buttonRect = openGridSettingsButton?.getBoundingClientRect();
  const edge = 12;
  const gap = 10;
  const width = gridSettingsPopover.offsetWidth || 258;
  const height = gridSettingsPopover.offsetHeight || 190;
  // Attach the menu to the 3D WORKSPACE bar, not to the Live Data metric.
  const top = Math.max(edge, Math.min((anchor?.bottom ?? buttonRect?.bottom ?? 70) + gap,
    window.innerHeight - height - edge));
  const sceneRight = bounds?.right ?? window.innerWidth;
  const sceneLeft = bounds?.left ?? edge;
  const preferredLeft = sceneRight - width - 4; // V12: shift settings 10px right
  const left = Math.max(edge, Math.min(preferredLeft,
    Math.max(edge, window.innerWidth - width - edge)));
  gridSettingsPopover.style.left = `${Math.round(Math.max(sceneLeft + 8, Math.min(left, window.innerWidth - width - edge)))}px`;
  gridSettingsPopover.style.top = `${Math.round(top)}px`;
  gridSettingsPopover.style.right = 'auto';
  gridSettingsPopover.style.bottom = 'auto';
  gridSettingsPopover.style.transformOrigin = '85% 0%';
}

function setGridSettingsOpen(open) {
  if (!gridSettingsPopover || !openGridSettingsButton) return;
  if (open && (serialConnected || simulationActive)) {
    setFeedback('SENSOR INPUT ACTIVE', 'Edit grid dimensions from Hardware Settings while the sensor session is active.', true);
    return;
  }
  if (open && activeLayerView !== null) {
    setFeedback('LAYER VIEW ONLY', 'Return to ALL layers before changing the build area size.', true);
    return;
  }
  if (gridSettingsCloseTimer) {
    window.clearTimeout(gridSettingsCloseTimer);
    gridSettingsCloseTimer = null;
  }

  gridSettingsIsOpen = open;
  openGridSettingsButton.classList.toggle('is-active', open);
  openGridSettingsButton.setAttribute('aria-expanded', String(open));

  if (open) {
    gridSettingsPopover.hidden = false;
    positionGridSettingsPopover();
    // Two frames guarantee the browser paints the resting state before the
    // opening transform, so the compact settings card eases into place.
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (!gridSettingsPopover.hidden) {
          positionGridSettingsPopover();
          gridSettingsPopover.classList.add('is-open');
        }
      });
    });
    return;
  }

  gridSettingsPopover.classList.remove('is-open');
  gridSettingsCloseTimer = window.setTimeout(() => {
    if (!gridSettingsPopover.classList.contains('is-open')) gridSettingsPopover.hidden = true;
    gridSettingsCloseTimer = null;
  }, 270);
}

openGridSettingsButton?.addEventListener('click', (event) => {
  event.stopPropagation();
  setGridSettingsOpen(!gridSettingsIsOpen);
});

closeGridSettingsButton?.addEventListener('click', () => setGridSettingsOpen(false));
gridSettingsPopover?.addEventListener('click', (event) => event.stopPropagation());
window.addEventListener('resize', () => {
  if (gridSettingsPopover && !gridSettingsPopover.hidden) positionGridSettingsPopover();
});
window.addEventListener('pointerdown', (event) => {
  if (!gridSettingsPopover || gridSettingsPopover.hidden) return;
  if (openGridSettingsButton?.contains(event.target) || gridSettingsPopover?.contains(event.target)) return;
  setGridSettingsOpen(false);
});

if (gridSizeSlider) {
  gridSizeSlider.addEventListener('input', () => {
    if (gridSizeValue) gridSizeValue.textContent = String(clampGridSize(gridSizeSlider.value)).padStart(2, '0');
    setRangeProgress(gridSizeSlider);
  });
  gridSizeSlider.addEventListener('change', () => setActiveGridSize(gridSizeSlider.value));
}

// -----------------------------------------------------------------------------
// 10. SAVE / EXPORT / LOAD MODEL FILES
// -----------------------------------------------------------------------------
// Native .BIL is the authoritative editable project format: exact x/y/z +
// Standard/Support semantics, workspace settings, live surface settings, and
// camera state. STL / GLB / OBJ are static export products. Legacy readers for
// older JSON/GLB/OBJ/STL files remain below only for backwards compatibility.
const MODEL_FILE_FORMAT = 'digital-twin-voxel-model';
const MODEL_FILE_VERSION = 1;
const PROJECT_FILE_FORMAT = 'build-it-live-project';
const PROJECT_FILE_VERSION = 1;

function getCurrentModelName() {
  // The Recent Models name is authoritative, including user renames/duplicates.
  const entry = activeRecentModelId
    ? readRecentModels().find((item) => String(item.id) === String(activeRecentModelId))
    : null;
  return String(entry?.name || importedProjectName || generateSmartModelName(model.getBlocks())).trim();
}

function makeProjectDocument() {
  return {
    format: PROJECT_FILE_FORMAT,
    version: PROJECT_FILE_VERSION,
    app: 'Build It Live',
    savedAt: new Date().toISOString(),
    project: {
      name: getCurrentModelName(),
      units: 'mm',
      physicalBlockMm: CONFIG.PHYSICAL_BLOCK_MM,
    },
    workspace: {
      gridSize: model.gridSize,
      gridWidth: model.gridWidth,
      gridDepth: model.gridDepth,
      maxHeight: CONFIG.MAX_HEIGHT,
      selectedBlockColor,
    },
    model: {
      blocks: cloneBlocks(),
    },
    render: {
      surfaceMode: exportSurfaceMode,
      smoothingStrength,
      smoothEdgeProfile,
      layerView: activeLayerView === null ? 0 : activeLayerView + 1,
    },
    camera: {
      position: camera.position.toArray(),
      target: controls.target.toArray(),
    },
  };
}

function makeModelDocument() {
  return {
    format: MODEL_FILE_FORMAT,
    version: MODEL_FILE_VERSION,
    createdAt: new Date().toISOString(),
    simulator: {
      gridSize: model.gridSize,
      gridWidth: model.gridWidth,
      gridDepth: model.gridDepth,
      maxHeight: CONFIG.MAX_HEIGHT,
      physicalBlockMm: CONFIG.PHYSICAL_BLOCK_MM,
    },
    blocks: cloneBlocks(),
  };
}

function makeTimestampForFilename(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function makeDownloadFilename(extension) {
  return surfaceModeFilename(getCurrentModelName(), exportSurfaceMode, extension);
}

/** Keep slicer STLs strictly standard, but let the same browser recover the
 * precise editable state when the user reopens its own unmodified export.
 * A file from another device/browser has no such state and instead uses
 * automatic approximate reconstruction when geometry permits. Never match
 * by filename alone.
 */
async function stlContentFingerprint(buffer) {
  try {
    if (!globalThis.crypto?.subtle) return null;
    const result = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256', buffer));
    return [...result].map(byte => byte.toString(16).padStart(2, '0')).join('');
  } catch { return null; }
}

async function storeEditableStlExportSnapshot(buffer) {
  const hash = await stlContentFingerprint(buffer);
  if (!hash) return;
  const previous = safeStorageRead(EDITABLE_STL_HASH_REGISTRY_KEY, []);
  const records = Array.isArray(previous) ? previous : [];
  const snapshot = {
    hash, gridSize: model.gridSize, gridWidth: model.gridWidth, gridDepth: model.gridDepth,
    blocks: cloneBlocks(),
    projectState: {
      surfaceMode: exportSurfaceMode,
      smoothingStrength,
      smoothEdgeProfile,
      selectedBlockColor,
      layerView: 0,
    },
  };
  safeStorageWrite(EDITABLE_STL_HASH_REGISTRY_KEY, [snapshot, ...records.filter(item => item?.hash !== hash)].slice(0, 12));
}

async function getEditableStlExportSnapshot(buffer) {
  const hash = await stlContentFingerprint(buffer);
  if (!hash) return null;
  const records = safeStorageRead(EDITABLE_STL_HASH_REGISTRY_KEY, []);
  if (!Array.isArray(records)) return null;
  const match = records.find(entry => entry?.hash === hash && Array.isArray(entry.blocks) && entry.blocks.length > 0);
  return match ?? null;
}

function normalizeExportRegistryName(name = '') {
  return String(name)
    .trim()
    .toLowerCase()
    .replace(/\s*\(\d+\)(?=\.[^.]+$)/, '');
}

function registerStlExport(filename, blob, { exportId = null, token = null } = {}) {
  if (!filename || !blob) return;
  const registry = safeStorageRead(STL_EXPORT_REGISTRY_STORAGE_KEY, []);
  const entries = Array.isArray(registry) ? registry : [];
  const normalizedName = normalizeExportRegistryName(filename);
  const snapshot = {
    gridSize: model.gridSize,
    blocks: cloneBlocks(),
  };
  const next = [
    {
      name: normalizedName,
      size: Number(blob.size) || 0,
      savedAt: new Date().toISOString(),
      exportId,
      token,
      // Store the editable state directly. The export ID is only a lookup key
      // avoids making a successful local round-trip depend on token decoding.
      state: snapshot,
    },
    ...entries.filter((entry) => !(entry?.name === normalizedName && Number(entry?.size) === Number(blob.size))),
  ].slice(0, STL_EXPORT_REGISTRY_LIMIT);
  safeStorageWrite(STL_EXPORT_REGISTRY_STORAGE_KEY, next);
}

function recoverRegisteredStlState(file, exportId = null) {
  const registry = safeStorageRead(STL_EXPORT_REGISTRY_STORAGE_KEY, []);
  if (!Array.isArray(registry) || !file) return null;
  const normalizedName = normalizeExportRegistryName(file.name);
  const byId = exportId ? registry.find((entry) => entry?.exportId === exportId) : null;
  const exact = registry.find((entry) => entry?.name === normalizedName && Number(entry?.size) === Number(file.size));
  const sameName = registry.find((entry) => entry?.name === normalizedName);
  const entry = byId ?? exact ?? sameName;
  if (!entry) return null;

  if (Array.isArray(entry?.state?.blocks) && entry.state.blocks.length > 0) {
    return {
      gridSize: clampGridSize(entry.state.gridSize ?? getRequiredGridSize(entry.state.blocks)),
      blocks: cloneBlocks(entry.state.blocks),
    };
  }

  if (!entry?.token) return null;
  const decoded = decodeCompactStateToken(entry.token);
  return decoded?.blocks?.length ? decoded : null;
}


function getStandardBlockBounds(blocks = []) {
  const standard = blocks.filter((block) => block?.type !== 'support');
  if (standard.length === 0) return null;
  const xs = standard.map((block) => Number(block.x));
  const ys = standard.map((block) => Number(block.y));
  const zs = standard.map((block) => Number(block.z));
  return {
    minX: Math.min(...xs), maxX: Math.max(...xs),
    minY: Math.min(...ys), maxY: Math.max(...ys),
    minZ: Math.min(...zs), maxZ: Math.max(...zs),
  };
}

function getStlCellBounds(geometry, scale = CONFIG.PHYSICAL_BLOCK_MM) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!box || box.isEmpty()) return null;
  const snapMin = (value) => Math.round(value / scale);
  const snapMax = (value) => Math.round(value / scale) - 1;
  return {
    minX: snapMin(box.min.x), maxX: snapMax(box.max.x),
    minY: snapMin(box.min.y), maxY: snapMax(box.max.y),
    minZ: snapMin(box.min.z), maxZ: snapMax(box.max.z),
  };
}

function sameBounds(a, b) {
  if (!a || !b) return false;
  return ['minX', 'maxX', 'minY', 'maxY', 'minZ', 'maxZ'].every((key) => a[key] === b[key]);
}

function parseVoxelExportTime(name = '') {
  const match = String(name).match(/voxel-model-(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})?/i);
  if (!match) return null;
  const [, year, month, day, hour, minute, second = '30'] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  return Number.isNaN(date.getTime()) ? null : date;
}

function recoverLegacyStlStateFromRecents(file, geometry) {
  // Compatibility rescue for STL files exported by older builds of this app
  // before the redundant registry existed. We only attempt this for the app's
  // own generated filename pattern, and only when the printable Standard-cube
  // bounding box matches a locally saved editable snapshot exactly.
  if (!/^voxel-model-\d{8}-\d{4,6}(?:\s*\(\d+\))?\.stl$/i.test(String(file?.name ?? ''))) return null;

  const stlBounds = getStlCellBounds(geometry);
  if (!stlBounds) return null;
  const exportedAt = parseVoxelExportTime(file.name);
  const recent = readRecentModels();
  const autosave = safeStorageRead(AUTOSAVE_STORAGE_KEY, null);
  const snapshots = [...recent];
  if (Array.isArray(autosave?.blocks)) snapshots.push(autosave);

  const candidates = snapshots
    .filter((entry) => Array.isArray(entry?.blocks) && entry.blocks.length > 0)
    .map((entry) => {
      const savedAt = new Date(entry.savedAt ?? 0);
      const delta = exportedAt && !Number.isNaN(savedAt.getTime())
        ? Math.abs(savedAt.getTime() - exportedAt.getTime())
        : Number.POSITIVE_INFINITY;
      return {
        entry,
        delta,
        boundsMatch: sameBounds(getStandardBlockBounds(entry.blocks), stlBounds),
      };
    })
    .sort((a, b) => {
      if (a.boundsMatch !== b.boundsMatch) return a.boundsMatch ? -1 : 1;
      return a.delta - b.delta;
    });

  if (candidates.length === 0) return null;
  const best = candidates[0];

  // Prefer an exact printable-bounds match. For older Organic Print files, however,
  // chamfering/straight-diagonal geometry can move the raw triangle bounds by a
  // fraction of a cell. In that case the app-generated timestamp is a stronger
  // recovery key: use a uniquely close local snapshot from the same session.
  const closeByTime = Number.isFinite(best.delta) && best.delta <= 15 * 60 * 1000;
  if (!best.boundsMatch && !closeByTime) return null;

  return {
    gridSize: clampGridSize(best.entry.gridSize ?? getRequiredGridSize(best.entry.blocks)),
    blocks: cloneBlocks(best.entry.blocks),
  };
}

function downloadBlob(blob, extension, { filename = null, registerStlState = false, stlExportId = null, stlToken = null } = {}) {
  const resolvedFilename = filename ?? makeDownloadFilename(extension);
  if (registerStlState && String(extension).toLowerCase() === 'stl') {
    registerStlExport(resolvedFilename, blob, { exportId: stlExportId, token: stlToken });
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = resolvedFilename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Some browsers (notably Safari) can still be consuming the blob when the
  // synthetic click returns. Revoking synchronously can cancel the download.
  window.setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return resolvedFilename;
}

function saveNativeProject() {
  void requestDurableBrowserStorage();
  if (exactImportedStl && !isApproximateBlockPreview()) {
    throw new Error('Original blocks unavailable. Load .BIL to save an editable project, or export this mesh as STL.');
  }
  const document = makeProjectDocument();
  const json = JSON.stringify(document, null, 2);
  const filename = makeDownloadFilename('bil');
  downloadBlob(new Blob([json], { type: 'application/json' }), 'bil', { filename });
  // Saving a portable .BIL also pins/upserts the same editable model in the
  // browser's Recent Models, even if automatic saves are switched OFF.
  // Repeated clicks update the active entry instead of adding duplicates.
  window.clearTimeout(autosaveTimer);
  autosaveTimer = null;
  persistCurrentModel({ force: true, addRecent: true, includeEmpty: true });
  return filename;
}

function saveJsonModel() {
  if (exactImportedStl && !isApproximateBlockPreview()) throw new Error('ORIGINAL BLOCKS NOT STORED IN STL / LOAD .BIL FOR EDITABLE PROJECT');
  const json = JSON.stringify(makeModelDocument(), null, 2);
  downloadBlob(new Blob([json], { type: 'application/json' }), 'json');
}

/**
 * Export the same clean cuboids that the Digital and Hardware Builder render.
 * The detailed blockScrew.stl belongs only to Brick Maker (or to an explicit
 * exact-STL import); generated Builder models never use its channels/studs.
 *
 * The greedy voxel surface removes internal faces between adjacent blocks of
 * the same color. Different colors stay in distinct meshes (and 3MF regions).
 * Support blocks are excluded from printable STL / 3MF and retained for
 * material-aware OBJ / GLB, as in the existing export selection.
 *
 * unitScale: millimetres = 1 (STL, OBJ, 3MF); metres = 0.001 (GLB).
 */
function makeWorkspaceExportGroup(unitScale = 1, { includeSupports = false, yUp = false, respectColors = true } = {}) {
  const group = new THREE.Group();
  group.name = 'BuildItLiveWorkspaceBlocks';
  const materials = [];
  const resources = [];
  const blocks = model.getBlocks().filter((block) => includeSupports || block.type !== 'support');
  const dimensions = workspaceBlockDimensionsMm(CONFIG.CELL_WIDTH, CONFIG.CELL_DEPTH, CONFIG.CELL_HEIGHT, CONFIG.PHYSICAL_BLOCK_MM);
  // Build ONE exterior for the whole model, even if adjacent blocks have
  // different colors. Otherwise each color generates intersecting interior
  // walls, which slicers may repair into missing or diagonal surfaces.
  const surface = buildVoxelSurface(blocks, block => block.type === 'support'
    ? 'support' : respectColors ? normalizeStandardBlockColor(block.color) : DEFAULT_BLOCK_COLOR);
  const facesByMaterial = new Map();
  for (const triangle of surface.triangles) {
    if (!facesByMaterial.has(triangle.material)) facesByMaterial.set(triangle.material, []);
    facesByMaterial.get(triangle.material).push(triangle);
  }
  for (const [color, faces] of facesByMaterial) {
    const positions = [];
    for (const triangle of faces) {
      for (const vertexIndex of [triangle.a, triangle.b, triangle.c]) {
        const point = surface.vertices[vertexIndex];
        positions.push(point[0] * dimensions.width * unitScale,
          point[1] * dimensions.depth * unitScale,
          point[2] * dimensions.height * unitScale);
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    const material = new THREE.MeshStandardMaterial({
      name: color === 'support' ? 'SupportBlock' : 'StandardBlock',
      color: color === 'support' ? COLORS.support : color,
      transparent: color === 'support',
      opacity: color === 'support' ? 0.32 : 1,
      roughness: 0.58,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = color === 'support' ? 'support_workspace_blocks' : `standard_workspace_${color.slice(1)}`;
    group.add(mesh);
    materials.push(material);
    resources.push(geometry);
  }
  if (yUp) {
    group.rotation.x = -Math.PI / 2;
    group.position.x = -model.gridWidth * dimensions.width * unitScale / 2;
    group.position.z = model.gridDepth * dimensions.depth * unitScale / 2;
  }
  group.updateMatrixWorld(true);
  group.userData.disposeExportResources = () => {
    resources.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
  };
  return group;
}

function makeGeometryExportGroup(exportScale = .001) {
  return makeWorkspaceExportGroup(exportScale, { includeSupports: true, yUp: true });
}

function makeSlicerExportGroup(exportScale = 1, { includeSupportFrames = true, respectColors = true } = {}) {
  // STL omits temporary supports and unifies all visible standard blocks;
  // OBJ retains their materials and optional support cuboids.
  return makeWorkspaceExportGroup(exportScale, { includeSupports: includeSupportFrames, respectColors });
}

function createLinearChamferPrismGeometry(width, depth, height, chamfer, {
  chamferBottom = false,
  chamferTop = true,
} = {}) {
  const safeWidth = Math.max(0.001, Number(width) || 0.001);
  const safeDepth = Math.max(0.001, Number(depth) || 0.001);
  const safeHeight = Math.max(0.001, Number(height) || 0.001);
  const maxChamfer = Math.min(safeWidth, safeDepth, safeHeight) * 0.22;
  const c = THREE.MathUtils.clamp(Number(chamfer) || 0, 0, maxChamfer);

  const rings = [];
  const addRing = (z, inset) => {
    const halfW = Math.max(0.0005, safeWidth / 2 - inset);
    const halfD = Math.max(0.0005, safeDepth / 2 - inset);
    rings.push({
      z,
      points: [
        [-halfW, -halfD],
        [ halfW, -halfD],
        [ halfW,  halfD],
        [-halfW,  halfD],
      ],
    });
  };

  if (chamferBottom && c > 1e-6) {
    addRing(0, c);
    addRing(c, 0);
  } else {
    addRing(0, 0);
  }

  if (chamferTop && c > 1e-6) {
    const shoulderZ = Math.max(rings[rings.length - 1].z + 1e-5, safeHeight - c);
    if (shoulderZ > rings[rings.length - 1].z + 1e-5) addRing(shoulderZ, 0);
    addRing(safeHeight, c);
  } else if (safeHeight > rings[rings.length - 1].z + 1e-5) {
    addRing(safeHeight, 0);
  }

  const positions = [];
  const indices = [];
  for (const ring of rings) {
    for (const [x, y] of ring.points) positions.push(x, y, ring.z);
  }

  // Side surfaces. Ring points are CCW when viewed from +Z.
  for (let r = 0; r < rings.length - 1; r += 1) {
    const lower = r * 4;
    const upper = (r + 1) * 4;
    for (let edge = 0; edge < 4; edge += 1) {
      const next = (edge + 1) % 4;
      indices.push(
        lower + edge, lower + next, upper + next,
        lower + edge, upper + next, upper + edge,
      );
    }
  }

  // Bottom cap faces down; top cap faces up.
  indices.push(0, 2, 1, 0, 3, 2);
  const top = (rings.length - 1) * 4;
  indices.push(top, top + 1, top + 2, top, top + 2, top + 3);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  flat.computeVertexNormals();
  flat.computeBoundingBox();
  flat.computeBoundingSphere();
  return flat;
}

function cross2D(o, a, b) {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function convexHull2D(points = []) {
  const unique = new Map();
  for (const point of points) {
    const x = Number(point.x);
    const y = Number(point.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    unique.set(`${x.toFixed(6)},${y.toFixed(6)}`, new THREE.Vector2(x, y));
  }

  const sorted = [...unique.values()].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 3) return sorted;

  const lower = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross2D(lower[lower.length - 2], lower[lower.length - 1], point) <= 1e-9) lower.pop();
    lower.push(point);
  }

  const upper = [];
  for (let i = sorted.length - 1; i >= 0; i -= 1) {
    const point = sorted[i];
    while (upper.length >= 2 && cross2D(upper[upper.length - 2], upper[upper.length - 1], point) <= 1e-9) upper.pop();
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function insetConvexPolygon(points, distance) {
  if (distance <= 1e-8 || points.length < 3) return points.map((point) => point.clone());
  const result = [];
  const lineIntersection = (p1, d1, p2, d2) => {
    const denominator = d1.x * d2.y - d1.y * d2.x;
    if (Math.abs(denominator) < 1e-9) return null;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const t = (dx * d2.y - dy * d2.x) / denominator;
    return new THREE.Vector2(p1.x + d1.x * t, p1.y + d1.y * t);
  };

  for (let i = 0; i < points.length; i += 1) {
    const prev = points[(i - 1 + points.length) % points.length];
    const curr = points[i];
    const next = points[(i + 1) % points.length];

    const dPrev = curr.clone().sub(prev).normalize();
    const dNext = next.clone().sub(curr).normalize();
    const nPrev = new THREE.Vector2(-dPrev.y, dPrev.x).multiplyScalar(distance);
    const nNext = new THREE.Vector2(-dNext.y, dNext.x).multiplyScalar(distance);
    const a = prev.clone().add(nPrev);
    const b = curr.clone().add(nNext);
    const intersection = lineIntersection(a, dPrev, b, dNext);
    result.push(intersection ?? curr.clone());
  }
  return result;
}

function createLinearChamferPolygonPrismGeometry(points, height, chamfer) {
  let polygon = convexHull2D(points);
  if (polygon.length < 3) throw new Error('DIAGONAL RUN HAS NO VALID POLYGON');

  const signedArea = polygon.reduce((sum, point, index) => {
    const next = polygon[(index + 1) % polygon.length];
    return sum + point.x * next.y - next.x * point.y;
  }, 0);
  if (signedArea < 0) polygon = polygon.reverse();

  const safeHeight = Math.max(0.001, Number(height) || 0.001);
  const c = THREE.MathUtils.clamp(Number(chamfer) || 0, 0, safeHeight * 0.2);
  const topPolygon = insetConvexPolygon(polygon, c);
  const rings = [{ z: 0, points: polygon }];
  if (c > 1e-6 && safeHeight > c + 1e-6) rings.push({ z: safeHeight - c, points: polygon });
  rings.push({ z: safeHeight, points: c > 1e-6 ? topPolygon : polygon });

  const positions = [];
  const indices = [];
  const n = polygon.length;
  for (const ring of rings) {
    for (const point of ring.points) positions.push(point.x, point.y, ring.z);
  }

  for (let r = 0; r < rings.length - 1; r += 1) {
    const lower = r * n;
    const upper = (r + 1) * n;
    for (let i = 0; i < n; i += 1) {
      const next = (i + 1) % n;
      indices.push(lower + i, lower + next, upper + next, lower + i, upper + next, upper + i);
    }
  }

  const bottomTriangles = THREE.ShapeUtils.triangulateShape(rings[0].points, []);
  for (const triangle of bottomTriangles) indices.push(triangle[0], triangle[2], triangle[1]);
  const topOffset = (rings.length - 1) * n;
  const topTriangles = THREE.ShapeUtils.triangulateShape(rings[rings.length - 1].points, []);
  for (const triangle of topTriangles) indices.push(topOffset + triangle[0], topOffset + triangle[1], topOffset + triangle[2]);

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  const flat = geometry.toNonIndexed();
  geometry.dispose();
  flat.computeVertexNormals();
  flat.computeBoundingBox();
  flat.computeBoundingSphere();
  return flat;
}

function canonicalEdgeKey(a, b) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

// Organic Print is intentionally CAD-biased on the XY grid. When an authored
// run is already close to a canonical grid angle, lock it to an exact 45°
// increment. This keeps 0° / 45° / 90° / 135° members mathematically straight
// in both the live preview and exported mesh instead of leaving tiny PCA drift.
function snapDirectionToCadAngle(direction) {
  const rawAngle = Math.atan2(direction.y, direction.x);
  const step = Math.PI / 4;
  let snappedAngle = Math.round(rawAngle / step) * step;
  let angularError = Math.abs(Math.atan2(Math.sin(rawAngle - snappedAngle), Math.cos(rawAngle - snappedAngle)));
  angularError = Math.min(angularError, Math.PI - angularError);

  // Only lock lines that are already authored close to a canonical direction.
  // Arbitrary staircase lines can still use their fitted vector direction.
  if (angularError > THREE.MathUtils.degToRad(8)) {
    return { direction: direction.clone(), cadAngle: false, cadAngleDeg: null };
  }

  let snapped = new THREE.Vector2(Math.cos(snappedAngle), Math.sin(snappedAngle)).normalize();
  if (snapped.x < -1e-8 || (Math.abs(snapped.x) <= 1e-8 && snapped.y < 0)) snapped.multiplyScalar(-1);
  snappedAngle = Math.atan2(snapped.y, snapped.x);
  const normalizedDeg = ((Math.round(THREE.MathUtils.radToDeg(snappedAngle)) % 180) + 180) % 180;
  return { direction: snapped, cadAngle: true, cadAngleDeg: normalizedDeg };
}

function splitChainAtGridTurns(blocks) {
  if (!Array.isArray(blocks) || blocks.length < 3) return { segments: [blocks], turnCount: 0 };

  const stepKey = (a, b) => {
    const dx = Math.sign(b.x - a.x);
    const dy = Math.sign(b.y - a.y);
    return `${dx},${dy}`;
  };

  const turnIndices = [];
  let previous = stepKey(blocks[0], blocks[1]);
  for (let i = 2; i < blocks.length; i += 1) {
    const current = stepKey(blocks[i - 1], blocks[i]);
    if (current !== previous) turnIndices.push(i - 1);
    previous = current;
  }

  if (!turnIndices.length) return { segments: [blocks], turnCount: 0 };

  // A real elbow/V/U has only a small number of deliberate direction changes.
  // A staircase approximation of an arbitrary straight line alternates direction
  // repeatedly, so leave those for the PCA line fitter instead of turning them
  // into a zig-zag of small beams.
  const maxDeliberateTurns = Math.max(2, Math.floor((blocks.length - 1) * 0.3));
  if (turnIndices.length > maxDeliberateTurns) return { segments: [blocks], turnCount: turnIndices.length };

  const segments = [];
  let start = 0;
  for (const turnIndex of turnIndices) {
    const segment = blocks.slice(start, turnIndex + 1);
    if (segment.length >= 2) segments.push(segment);
    start = turnIndex;
  }
  const tail = blocks.slice(start);
  if (tail.length >= 2) segments.push(tail);
  return { segments: segments.length ? segments : [blocks], turnCount: turnIndices.length };
}

function fitVectorLine(blocks, { allowShort = true } = {}) {
  if (!blocks || blocks.length < 2) return null;

  const points = blocks.map((block) => new THREE.Vector2(block.x + 0.5, block.y + 0.5));
  const mean = points.reduce((acc, point) => acc.add(point), new THREE.Vector2()).multiplyScalar(1 / points.length);

  let xx = 0;
  let xy = 0;
  let yy = 0;
  for (const point of points) {
    const dx = point.x - mean.x;
    const dy = point.y - mean.y;
    xx += dx * dx;
    xy += dx * dy;
    yy += dy * dy;
  }
  xx /= points.length;
  xy /= points.length;
  yy /= points.length;

  const angle = 0.5 * Math.atan2(2 * xy, xx - yy);
  let direction = new THREE.Vector2(Math.cos(angle), Math.sin(angle)).normalize();
  // Canonical orientation keeps signatures stable from one layer to the next.
  if (direction.x < -1e-8 || (Math.abs(direction.x) <= 1e-8 && direction.y < 0)) {
    direction.multiplyScalar(-1);
  }
  const cadLock = snapDirectionToCadAngle(direction);
  direction = cadLock.direction;
  const normal = new THREE.Vector2(-direction.y, direction.x);

  const projections = points.map((point) => point.dot(direction));
  const perpendiculars = points.map((point) => point.dot(normal));
  const minProjection = Math.min(...projections);
  const maxProjection = Math.max(...projections);
  const meanPerpendicular = perpendiculars.reduce((sum, value) => sum + value, 0) / perpendiculars.length;
  const maxDeviation = Math.max(...perpendiculars.map((value) => Math.abs(value - meanPerpendicular)));

  const trace = xx + yy;
  const determinant = xx * yy - xy * xy;
  const discriminant = Math.max(0, trace * trace * 0.25 - determinant);
  const major = trace * 0.5 + Math.sqrt(discriminant);
  const minor = Math.max(0, trace * 0.5 - Math.sqrt(discriminant));
  const aspect = major / Math.max(0.02, minor);

  // Exact grid lines (horizontal / vertical / true diagonals) are accepted even
  // when they contain only two control voxels. A staircase approximation to an
  // arbitrary angle needs a longer authored run before it is vectorised.
  const essentiallyCollinear = maxDeviation <= 0.08;
  if (!essentiallyCollinear && (!allowShort || blocks.length < 4)) return null;
  if (!essentiallyCollinear && maxDeviation > 0.52) return null;
  if (!essentiallyCollinear && aspect < 4.0) return null;

  const centerProjection = (minProjection + maxProjection) * 0.5;
  const center = direction.clone().multiplyScalar(centerProjection)
    .add(normal.clone().multiplyScalar(meanPerpendicular));

  return {
    blocks,
    direction,
    normal,
    angle: Math.atan2(direction.y, direction.x),
    center,
    minProjection,
    maxProjection,
    maxDeviation,
    essentiallyCollinear,
    cadAngle: cadLock.cadAngle,
    cadAngleDeg: cadLock.cadAngleDeg,
  };
}

function findVectorLineRuns(blocks) {
  const blocksByLayer = new Map();
  for (const block of blocks) {
    if (!blocksByLayer.has(block.z)) blocksByLayer.set(block.z, new Map());
    blocksByLayer.get(block.z).set(`${block.x},${block.y}`, block);
  }

  const lines = [];
  const excluded = new Set();
  const neighborOffsets = [];
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (dx || dy) neighborOffsets.push([dx, dy]);
    }
  }
  const orthogonalOffsets = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (const [z, layer] of blocksByLayer.entries()) {
    // Line candidates deliberately exclude dense body cells. Edge/corner cells
    // may still participate, which lets a vector member terminate cleanly into
    // a larger voxel mass without vectorising that mass itself.
    const candidates = new Map();
    for (const block of layer.values()) {
      const n8 = neighborOffsets.reduce((count, [dx, dy]) => count + Number(layer.has(`${block.x + dx},${block.y + dy}`)), 0);
      const n4 = orthogonalOffsets.reduce((count, [dx, dy]) => count + Number(layer.has(`${block.x + dx},${block.y + dy}`)), 0);
      if (n8 <= 4 && n4 <= 2) candidates.set(`${block.x},${block.y}`, block);
    }

    const graph = new Map();
    for (const [key, block] of candidates.entries()) {
      const neighbors = [];
      for (const [dx, dy] of neighborOffsets) {
        const neighborKey = `${block.x + dx},${block.y + dy}`;
        if (candidates.has(neighborKey)) neighbors.push(neighborKey);
      }
      graph.set(key, neighbors);
    }

    const visitedEdges = new Set();
    const chains = [];
    const traceFrom = (startKey, nextKey) => {
      const chainKeys = [startKey];
      let previous = startKey;
      let current = nextKey;
      visitedEdges.add(canonicalEdgeKey(previous, current));

      while (true) {
        chainKeys.push(current);
        const neighbors = graph.get(current) ?? [];
        if (neighbors.length !== 2) break;
        const following = neighbors[0] === previous ? neighbors[1] : neighbors[0];
        const edgeKey = canonicalEdgeKey(current, following);
        if (visitedEdges.has(edgeKey)) break;
        visitedEdges.add(edgeKey);
        previous = current;
        current = following;
      }
      return chainKeys;
    };

    // Split sparse networks at endpoints and junctions. Each branch is fitted
    // independently, so a V/Y/cross does not get collapsed into one diagonal.
    for (const [key, neighbors] of graph.entries()) {
      if (neighbors.length === 2) continue;
      for (const neighborKey of neighbors) {
        const edgeKey = canonicalEdgeKey(key, neighborKey);
        if (visitedEdges.has(edgeKey)) continue;
        chains.push(traceFrom(key, neighborKey));
      }
    }

    // Components with degree 2 everywhere are closed loops. They are already
    // cleanly handled by the merged voxel surface, so do not force-fit them.

    for (const chainKeys of chains) {
      const chainBlocks = chainKeys.map((key) => candidates.get(key)).filter(Boolean);
      const split = splitChainAtGridTurns(chainBlocks);

      // Prefer deliberate 45°/90° elbows as separate exact members. If the
      // chain changes direction repeatedly (a raster staircase approximating a
      // single arbitrary line), keep the original one-line PCA fit instead.
      const deliberateCorner = split.turnCount > 0 && split.segments.length > 1;
      const pieces = deliberateCorner ? split.segments : [chainBlocks];
      let accepted = false;

      for (const piece of pieces) {
        const fitted = fitVectorLine(piece, { allowShort: true });
        if (!fitted) continue;
        fitted.z = z;
        fitted.cellSignature = [...new Set(piece.map((block) => `${block.x},${block.y}`))].sort().join(';');
        lines.push(fitted);
        accepted = true;
        for (const block of piece) excluded.add(`${block.x},${block.y},${block.z}`);
      }

      // If a tentative corner split did not produce valid members, fall back to
      // the original fitter so older arbitrary-angle authored lines still work.
      if (!accepted && deliberateCorner) {
        const fitted = fitVectorLine(chainBlocks, { allowShort: true });
        if (!fitted) continue;
        fitted.z = z;
        fitted.cellSignature = [...new Set(chainBlocks.map((block) => `${block.x},${block.y}`))].sort().join(';');
        lines.push(fitted);
        for (const block of chainBlocks) excluded.add(`${block.x},${block.y},${block.z}`);
      }
    }

    // Recover interrupted authored lines: isolated/short sparse pieces that are
    // exactly collinear across a small gap are kept as separate straight pieces
    // rather than being left as pixel cubes. The gap itself remains a gap.
    const unclaimed = [...candidates.values()].filter((block) => !excluded.has(`${block.x},${block.y},${block.z}`));
    const directionFamilies = [
      [1, 0], [0, 1], [1, 1], [1, -1], [2, 1], [2, -1], [1, 2], [1, -2],
    ];
    const usedFallback = new Set();
    for (const [dx0, dy0] of directionFamilies) {
      const len = Math.hypot(dx0, dy0);
      const dx = dx0 / len;
      const dy = dy0 / len;
      const nx = -dy;
      const ny = dx;
      const bins = new Map();
      for (const block of unclaimed) {
        const key = `${block.x},${block.y}`;
        if (usedFallback.has(key)) continue;
        const cx = block.x + 0.5;
        const cy = block.y + 0.5;
        const offset = Math.round((cx * nx + cy * ny) * 1000) / 1000;
        const binKey = `${offset}`;
        if (!bins.has(binKey)) bins.set(binKey, []);
        bins.get(binKey).push(block);
      }
      for (const group of bins.values()) {
        if (group.length < 2) continue;
        group.sort((a, b) => ((a.x + 0.5) * dx + (a.y + 0.5) * dy) - ((b.x + 0.5) * dx + (b.y + 0.5) * dy));
        let segment = [group[0]];
        const flush = () => {
          if (segment.length < 2) return;
          const fitted = fitVectorLine(segment, { allowShort: true });
          if (!fitted || !fitted.essentiallyCollinear) return;
          fitted.z = z;
          fitted.cellSignature = segment.map((block) => `${block.x},${block.y}`).sort().join(';');
          lines.push(fitted);
          for (const block of segment) {
            usedFallback.add(`${block.x},${block.y}`);
            excluded.add(`${block.x},${block.y},${block.z}`);
          }
        };
        for (let i = 1; i < group.length; i += 1) {
          const a = group[i - 1];
          const b = group[i];
          const delta = Math.hypot(b.x - a.x, b.y - a.y);
          if (Math.max(Math.abs(b.x-a.x),Math.abs(b.y-a.y)) > 1 || delta > len + 1e-6) {
            flush();
            segment = [b];
          } else {
            segment.push(b);
          }
        }
        flush();
      }
    }
  }

  return { lines, excluded };
}

function groupVectorLinesVertically(lines) {
  const bySignature = new Map();
  for (const line of lines) {
    // Cell membership is more stable than floating-point angle/center values.
    const signature = line.cellSignature;
    if (!bySignature.has(signature)) bySignature.set(signature, []);
    bySignature.get(signature).push(line);
  }

  const grouped = [];
  for (const sameLines of bySignature.values()) {
    sameLines.sort((a, b) => a.z - b.z);
    let current = null;
    for (const line of sameLines) {
      if (!current || line.z !== current.zEnd + 1) {
        if (current) grouped.push(current);
        current = { ...line, zStart: line.z, zEnd: line.z };
      } else {
        current.zEnd = line.z;
      }
    }
    if (current) grouped.push(current);
  }
  return grouped;
}

function greedyRectangles(cells) {
  const remaining = new Set(cells);
  const rectangles = [];
  const parse = (key) => key.split(',').map(Number);

  while (remaining.size) {
    let seed = null;
    for (const key of remaining) {
      const [u, v] = parse(key);
      if (!seed || v < seed.v || (v === seed.v && u < seed.u)) seed = { key, u, v };
    }
    const { u, v } = seed;
    let width = 1;
    while (remaining.has(`${u + width},${v}`)) width += 1;

    let height = 1;
    outer: while (true) {
      for (let du = 0; du < width; du += 1) {
        if (!remaining.has(`${u + du},${v + height}`)) break outer;
      }
      height += 1;
    }

    for (let dv = 0; dv < height; dv += 1) {
      for (let du = 0; du < width; du += 1) remaining.delete(`${u + du},${v + dv}`);
    }
    rectangles.push({ u, v, width, height });
  }
  return rectangles;
}


function sdfBoxLocal(px, py, pz, cx, cy, cz, hx, hy, hz) {
  const qx = Math.abs(px - cx) - hx;
  const qy = Math.abs(py - cy) - hy;
  const qz = Math.abs(pz - cz) - hz;
  const ox = Math.max(qx, 0);
  const oy = Math.max(qy, 0);
  const oz = Math.max(qz, 0);
  const outside = Math.hypot(ox, oy, oz);
  const inside = Math.min(Math.max(qx, Math.max(qy, qz)), 0);
  return outside + inside;
}

function smoothMinDistance(a, b, radius) {
  if (!Number.isFinite(a)) return b;
  if (!Number.isFinite(b)) return a;
  const k = Math.max(0, Number(radius) || 0);
  if (k <= 1e-7) return Math.min(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (h * h * k * 0.25);
}

function createOrganicVectorSurfaceGeometry(bodyBlocks, vectorLines, allBlocks, scale, blendRadiusCells, { quality = 'export' } = {}) {
  if (!allBlocks.length) return null;

  const occupied = new Set(bodyBlocks.map((block) => `${block.x},${block.y},${block.z}`));
  const beamDescriptors = vectorLines.map((line) => {
    const layers = line.zEnd - line.zStart + 1;
    const halfFootprintAlongLine = 0.5 * (Math.abs(line.direction.x) + Math.abs(line.direction.y));
    const lengthCells = Math.max(1, (line.maxProjection - line.minProjection) + 2 * halfFootprintAlongLine);
    const cos = Math.cos(line.angle);
    const sin = Math.sin(line.angle);
    return {
      cx: line.center.x,
      cy: line.center.y,
      cz: line.zStart + layers * 0.5,
      halfLength: lengthCells * 0.5,
      halfWidth: 0.5,
      halfHeight: layers * 0.5,
      cos,
      sin,
      angle: line.angle,
      cadAngle: Boolean(line.cadAngle),
      cadAngleDeg: line.cadAngleDeg,
    };
  });

  const minBlockX = Math.min(...allBlocks.map((block) => block.x));
  const minBlockY = Math.min(...allBlocks.map((block) => block.y));
  const minBlockZ = Math.min(...allBlocks.map((block) => block.z));
  const maxBlockX = Math.max(...allBlocks.map((block) => block.x + 1));
  const maxBlockY = Math.max(...allBlocks.map((block) => block.y + 1));
  const maxBlockZ = Math.max(...allBlocks.map((block) => block.z + 1));

  // A small exterior margin is enough because the zero-isosurface cannot move
  // farther than the local blend radius. Keep z below zero so the marching pass
  // can close the mesh against the print-bed plane exactly.
  const margin = Math.max(0.45, blendRadiusCells + 0.22);
  const bounds = {
    minX: minBlockX - margin,
    minY: minBlockY - margin,
    minZ: Math.min(-0.35, minBlockZ - margin),
    maxX: maxBlockX + margin,
    maxY: maxBlockY + margin,
    maxZ: maxBlockZ + margin,
  };

  // High-resolution implicit sampling is the main surface-quality control.
  // Earlier versions used 4-5 samples/cell, which left visible saw-tooth facets
  // in Bambu Studio. Start much denser and only step down for genuinely large
  // builds so exported beams read as manufactured parts rather than voxel mesh.
  const realtimeQuality = quality === 'preview';
  let samplesPerCell = realtimeQuality ? 6 : 10;
  const countFor = (spc) => {
    const nx = Math.ceil((bounds.maxX - bounds.minX) * spc) + 1;
    const ny = Math.ceil((bounds.maxY - bounds.minY) * spc) + 1;
    const nz = Math.ceil((bounds.maxZ - bounds.minZ) * spc) + 1;
    return { nx, ny, nz, total: nx * ny * nz };
  };
  let dims = countFor(samplesPerCell);
  const maxSamples = realtimeQuality ? 950000 : 2800000;
  const qualitySteps = realtimeQuality ? [5, 4, 3] : [9, 8, 7, 6];
  for (const candidate of qualitySteps) {
    if (dims.total <= maxSamples) break;
    samplesPerCell = candidate;
    dims = countFor(samplesPerCell);
  }
  const { nx, ny, nz } = dims;
  const step = 1 / samplesPerCell;
  const field = new Float32Array(nx * ny * nz);
  const indexOf = (ix, iy, iz) => ix + nx * (iy + ny * iz);

  const bodyDistanceAt = (px, py, pz) => {
    if (!occupied.size) return Number.POSITIVE_INFINITY;
    const fx = Math.floor(px);
    const fy = Math.floor(py);
    const fz = Math.floor(pz);
    let best = Number.POSITIVE_INFINITY;
    // Only local cells can influence the zero surface. This keeps a dense model
    // fast while preserving the exact union of its axis-aligned voxel boxes.
    for (let z = fz - 2; z <= fz + 2; z += 1) {
      for (let y = fy - 2; y <= fy + 2; y += 1) {
        for (let x = fx - 2; x <= fx + 2; x += 1) {
          if (!occupied.has(`${x},${y},${z}`)) continue;
          const distance = sdfBoxLocal(px, py, pz, x + 0.5, y + 0.5, z + 0.5, 0.5, 0.5, 0.5);
          if (distance < best) best = distance;
        }
      }
    }
    return best;
  };

  const beamAngleDelta = (beamA, beamB) => {
    if (!beamA || !beamB) return Number.POSITIVE_INFINITY;
    let delta = Math.abs(beamA.angle - beamB.angle) % Math.PI;
    if (delta > Math.PI / 2) delta = Math.PI - delta;
    return Math.abs(delta);
  };

  const isCadBeamCorner = (beamA, beamB) => {
    const delta = beamAngleDelta(beamA, beamB);
    const tolerance = THREE.MathUtils.degToRad(3.5);
    return Math.abs(delta - Math.PI / 4) <= tolerance || Math.abs(delta - Math.PI / 2) <= tolerance;
  };

  const sampleBeamDistances = (px, py, pz) => beamDescriptors.map((beam) => {
    const dx = px - beam.cx;
    const dy = py - beam.cy;
    const lx = dx * beam.cos + dy * beam.sin;
    const ly = -dx * beam.sin + dy * beam.cos;
    const d = sdfBoxLocal(lx, ly, pz, 0, 0, beam.cz, beam.halfLength, beam.halfWidth, beam.halfHeight);
    return { beam, lx, ly, d, ad: Math.abs(d) };
  });

  const beamDistanceAt = (px, py, pz) => {
    if (!beamDescriptors.length) return Number.POSITIVE_INFINITY;
    const samples = sampleBeamDistances(px, py, pz);
    const byAbs = [...samples].sort((a, b) => a.ad - b.ad);
    const hardDistance = Math.min(...samples.map((entry) => entry.d));

    // Canonical 45° and 90° member-to-member corners are deliberate CAD
    // geometry. Keep those unions hard/miter-like instead of melting them with
    // the organic smooth-min. Other junctions can still use the local blend.
    const beamJoinRadius = blendRadiusCells * 0.72;
    if (byAbs.length > 1
      && byAbs[0].ad < beamJoinRadius * 2.2
      && byAbs[1].ad < beamJoinRadius * 2.2
      && isCadBeamCorner(byAbs[0].beam, byAbs[1].beam)) {
      return hardDistance;
    }

    let distance = Number.POSITIVE_INFINITY;
    for (const entry of samples) distance = smoothMinDistance(distance, entry.d, beamJoinRadius);
    return distance;
  };

  const beamInfoAt = (px, py, pz) => {
    const samples = sampleBeamDistances(px, py, pz).sort((a, b) => a.ad - b.ad);
    const nearest = samples[0] ?? null;
    const second = samples[1] ?? null;
    return {
      nearest,
      second,
      nearestAbs: nearest?.ad ?? Number.POSITIVE_INFINITY,
      secondAbs: second?.ad ?? Number.POSITIVE_INFINITY,
      cadCorner: Boolean(nearest && second && isCadBeamCorner(nearest.beam, second.beam)),
    };
  };

  // Keep manufactured-looking planes away from junctions. The implicit union is
  // only allowed to own the transition zone; everywhere else its vertices are
  // snapped back onto the exact beam/body planes. This removes the serrated
  // marching-tetrahedra edge without making the join hard or disconnected.
  const refineSurfacePoint = (point) => {
    const bodyDistance = bodyDistanceAt(point.x, point.y, point.z);
    const info = beamInfoAt(point.x, point.y, point.z);
    const beamDistance = info.nearest?.d ?? Number.POSITIVE_INFINITY;
    const transitionBand = Math.max(blendRadiusCells * 1.75, step * 2.2);
    const bodyBeamJoin = Number.isFinite(bodyDistance) && Number.isFinite(beamDistance)
      && Math.abs(bodyDistance - beamDistance) < transitionBand
      && Math.min(Math.abs(bodyDistance), Math.abs(beamDistance)) < transitionBand * 1.25;
    const beamBeamJoin = info.secondAbs < transitionBand * 1.15;
    const cadBeamCorner = beamBeamJoin && info.cadCorner;
    const nearBed = point.z < step * 1.4;
    // Organic blending still owns body/member transitions. A 45° or 90°
    // member-to-member corner is different: allow the normal beam-plane snap
    // below to clean it into a crisp manufactured elbow instead of leaving a
    // faceted implicit-surface patch.
    if (bodyBeamJoin || (beamBeamJoin && !cadBeamCorner) || nearBed) {
      if (nearBed) point.z = Math.max(0, point.z);
      return point;
    }

    if (info.nearest && info.nearestAbs <= Math.abs(bodyDistance) + step * 0.7) {
      const { beam, lx, ly } = info.nearest;
      let lz = point.z - beam.cz;
      const faceTolerance = step * 1.65;
      const candidates = [
        { axis: 'x', distance: Math.abs(Math.abs(lx) - beam.halfLength) },
        { axis: 'y', distance: Math.abs(Math.abs(ly) - beam.halfWidth) },
        { axis: 'z', distance: Math.abs(Math.abs(lz) - beam.halfHeight) },
      ];
      const minFace = Math.min(...candidates.map((entry) => entry.distance));
      let sx = lx;
      let sy = ly;
      for (const face of candidates) {
        if (face.distance > Math.min(faceTolerance, minFace + step * 0.42)) continue;
        if (face.axis === 'x') sx = (lx < 0 ? -1 : 1) * beam.halfLength;
        if (face.axis === 'y') sy = (ly < 0 ? -1 : 1) * beam.halfWidth;
        if (face.axis === 'z') lz = (lz < 0 ? -1 : 1) * beam.halfHeight;
      }
      point.x = beam.cx + sx * beam.cos - sy * beam.sin;
      point.y = beam.cy + sx * beam.sin + sy * beam.cos;
      point.z = beam.cz + lz;
      return point;
    }

    if (Number.isFinite(bodyDistance)) {
      // A voxel body is a union of axis-aligned cells, so every manufactured
      // exterior face lies on an integer grid plane. Snap *all* coordinates
      // that are already close to such a plane rather than only the closest
      // one. Snapping a single axis left tiny chamfer-like terraces around
      // every cell in the live Organic Print view, making the cubes visible
      // through what should read as one clean skin.
      const snapTolerance = step * 1.58;
      const px = Math.round(point.x);
      const py = Math.round(point.y);
      const pz = Math.round(point.z);
      if (Math.abs(point.x - px) < snapTolerance) point.x = px;
      if (Math.abs(point.y - py) < snapTolerance) point.y = py;
      if (Math.abs(point.z - pz) < snapTolerance) point.z = pz;
    }
    return point;
  };

  for (let iz = 0; iz < nz; iz += 1) {
    const pz = bounds.minZ + iz * step;
    for (let iy = 0; iy < ny; iy += 1) {
      const py = bounds.minY + iy * step;
      for (let ix = 0; ix < nx; ix += 1) {
        const px = bounds.minX + ix * step;
        const bodyDistance = bodyDistanceAt(px, py, pz);
        const beamDistance = beamDistanceAt(px, py, pz);
        let distance = smoothMinDistance(bodyDistance, beamDistance, blendRadiusCells);
        // Never let the smooth union bulge below the print bed. This clips the
        // whole result against z >= 0 and guarantees one flat printable base.
        distance = Math.max(distance, -pz);
        field[indexOf(ix, iy, iz)] = Number.isFinite(distance) ? distance : 10;
      }
    }
  }

  const positions = [];
  const cubeCorners = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  // Six tetrahedra sharing the 0 -> 6 diagonal. This decomposition is stable
  // across adjacent cells and avoids the ambiguous cases of marching cubes.
  const tetrahedra = [
    [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
    [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
  ];

  const planarVertexCache=new Map();
  const anchorPlanarVertex=(p)=>{
    const key=[p.x,p.y,p.z].map(n=>Math.round(n*1e7)).join(',');
    const cached=planarVertexCache.get(key);if(cached){p.x=cached[0];p.y=cached[1];return p;}
    const straightAcrossLayers=(vertical,edge,tangent)=>{
      let reference=null;
      for(const dz of [-.3,0,.3]){
        const body=blocksByLayer.get(THREE.MathUtils.clamp(Math.floor(p.z+dz),minZ,maxZ))||new Set();
        for(const dt of [-.3,0,.3]){
          const along=Math.floor(tangent+dt),a=vertical?body.has(`${edge-1},${along}`):body.has(`${along},${edge-1}`),b=vertical?body.has(`${edge},${along}`):body.has(`${along},${edge}`);
          if(a===b||reference!==null&&reference!==a)return false;reference=a;
        }
      }return true;
    };
    const ex=Math.round(p.x),ey=Math.round(p.y);
    if(Math.abs(p.x-ex)<.075&&straightAcrossLayers(true,ex,p.y))p.x=ex;
    if(Math.abs(p.y-ey)<.075&&straightAcrossLayers(false,ey,p.x))p.y=ey;
    planarVertexCache.set(key,[p.x,p.y]);return p;
  };
  // Neighbouring tetrahedra must share exactly the same edge intersection.
  // Reuse those vertices instead of repeating interpolation and planar anchoring.
  const intersectionCache=new Map();
  const interpolate = (pa, pb, va, vb) => {
    const edgeKey=Math.min(pa.sampleIndex,pb.sampleIndex)*field.length+Math.max(pa.sampleIndex,pb.sampleIndex);
    const shared=intersectionCache.get(edgeKey);if(shared)return shared;
    const denominator = va - vb;
    const t = Math.abs(denominator) < 1e-8 ? 0.5 : THREE.MathUtils.clamp(va / denominator, 0, 1);
    const vertex=anchorPlanarVertex(new THREE.Vector3(
      THREE.MathUtils.lerp(pa.x, pb.x, t),
      THREE.MathUtils.lerp(pa.y, pb.y, t),
      THREE.MathUtils.lerp(pa.z, pb.z, t),
    ));
    intersectionCache.set(edgeKey,vertex);return vertex;
  };

  const addTriangle = (a, b, c, outwardHint) => {
    const ab = b.clone().sub(a);
    const ac = c.clone().sub(a);
    const normal = ab.cross(ac);
    if (normal.lengthSq() < 1e-12) return;
    if (outwardHint && normal.dot(outwardHint) < 0) {
      const tmp = b;
      b = c;
      c = tmp;
    }
    for (const point of [a, b, c]) {
      const refined = refineSurfacePoint(point.clone());
      positions.push(refined.x * scale, refined.y * scale, refined.z * scale);
    }
  };

  for (let iz = 0; iz < nz - 1; iz += 1) {
    for (let iy = 0; iy < ny - 1; iy += 1) {
      for (let ix = 0; ix < nx - 1; ix += 1) {
        const points = cubeCorners.map(([dx, dy, dz]) => {const point=new THREE.Vector3(
          bounds.minX + (ix + dx) * step,
          bounds.minY + (iy + dy) * step,
          bounds.minZ + (iz + dz) * step,
        );point.sampleIndex=indexOf(ix+dx,iy+dy,iz+dz);return point;});
        const values = cubeCorners.map(([dx, dy, dz]) => field[indexOf(ix + dx, iy + dy, iz + dz)]);
        const allOutside = values.every((value) => value >= 0);
        const allInside = values.every((value) => value < 0);
        if (allOutside || allInside) continue;

        for (const tetra of tetrahedra) {
          const inside = tetra.filter((corner) => values[corner] < 0);
          const outside = tetra.filter((corner) => values[corner] >= 0);
          if (inside.length === 0 || inside.length === 4) continue;

          if (inside.length === 1) {
            const i0 = inside[0];
            const p0 = interpolate(points[i0], points[outside[0]], values[i0], values[outside[0]]);
            const p1 = interpolate(points[i0], points[outside[1]], values[i0], values[outside[1]]);
            const p2 = interpolate(points[i0], points[outside[2]], values[i0], values[outside[2]]);
            const outsideCenter = points[outside[0]].clone().add(points[outside[1]]).add(points[outside[2]]).multiplyScalar(1 / 3);
            const insidePoint = points[i0];
            addTriangle(p0, p1, p2, outsideCenter.sub(insidePoint));
          } else if (inside.length === 3) {
            const o0 = outside[0];
            const p0 = interpolate(points[o0], points[inside[0]], values[o0], values[inside[0]]);
            const p1 = interpolate(points[o0], points[inside[1]], values[o0], values[inside[1]]);
            const p2 = interpolate(points[o0], points[inside[2]], values[o0], values[inside[2]]);
            const insideCenter = points[inside[0]].clone().add(points[inside[1]]).add(points[inside[2]]).multiplyScalar(1 / 3);
            addTriangle(p0, p1, p2, points[o0].clone().sub(insideCenter));
          } else {
            const [ia, ib] = inside;
            const [oa, ob] = outside;
            const pac = interpolate(points[ia], points[oa], values[ia], values[oa]);
            const pad = interpolate(points[ia], points[ob], values[ia], values[ob]);
            const pbc = interpolate(points[ib], points[oa], values[ib], values[oa]);
            const pbd = interpolate(points[ib], points[ob], values[ib], values[ob]);
            const insideCenter = points[ia].clone().add(points[ib]).multiplyScalar(0.5);
            const outsideCenter = points[oa].clone().add(points[ob]).multiplyScalar(0.5);
            const hint = outsideCenter.sub(insideCenter);
            addTriangle(pac, pad, pbd, hint);
            addTriangle(pac, pbd, pbc, hint);
          }
        }
      }
    }
  }

  if (!positions.length) return null;
  const rawGeometry = new THREE.BufferGeometry();
  rawGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));

  // Creased normals give the two surface types the shading they need:
  // broad/straight CAD planes keep crisp highlights, while triangles inside a
  // genuinely organic transition share a smooth normal field. Plain
  // computeVertexNormals() on the non-indexed marching mesh made every small
  // triangle visible and exaggerated the underlying voxel pattern.
  const geometry = toCreasedNormals(rawGeometry, THREE.MathUtils.degToRad(48));
  if (geometry !== rawGeometry) rawGeometry.dispose();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}


// -----------------------------------------------------------------------------
// OVERSAMPLED 2.5D ORGANIC RECONSTRUCTION
// -----------------------------------------------------------------------------
// The editor is deliberately low-resolution (4..16 cells). Organic Print treats
// that grid as an authoring resolution rather than a final surface resolution:
// each occupied Z layer is rasterised at a much higher XY resolution, converted
// to a signed-distance field, lightly morphologically closed / filtered, then
// extruded as a thin level-set slab. Adjacent slabs are joined with a small
// anisotropic blend. This produces continuous silhouettes without globally
// melting the model in Z. Sparse authored lines are rasterised as exact vector
// rectangles before the distance transform, so diagonal members remain straight.
function rasterMorph(mask, width, height, radius, mode) {
  const r = Math.max(0, Math.round(radius));
  if (r <= 0) return new Uint8Array(mask);
  const out = new Uint8Array(mask.length);
  const wantAny = mode === 'dilate';
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      let value = wantAny ? 0 : 1;
      outer: for (let oy = -r; oy <= r; oy += 1) {
        for (let ox = -r; ox <= r; ox += 1) {
          if (ox * ox + oy * oy > r * r) continue;
          const sx = x + ox;
          const sy = y + oy;
          const sample = sx >= 0 && sx < width && sy >= 0 && sy < height
            ? mask[sx + width * sy]
            : 0;
          if (wantAny && sample) { value = 1; break outer; }
          if (!wantAny && !sample) { value = 0; break outer; }
        }
      }
      out[x + width * y] = value;
    }
  }
  return out;
}

function closeRasterMask(mask, width, height, radius) {
  if (radius <= 0) return new Uint8Array(mask);
  return rasterMorph(rasterMorph(mask, width, height, radius, 'dilate'), width, height, radius, 'erode');
}

function chamferDistanceTo(mask, width, height, targetValue) {
  const INF = 1e9;
  const SQRT2 = Math.SQRT2;
  const d = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i += 1) d[i] = mask[i] === targetValue ? 0 : INF;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = x + width * y;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1);
      if (y > 0) v = Math.min(v, d[i - width] + 1);
      if (x > 0 && y > 0) v = Math.min(v, d[i - width - 1] + SQRT2);
      if (x + 1 < width && y > 0) v = Math.min(v, d[i - width + 1] + SQRT2);
      d[i] = v;
    }
  }
  for (let y = height - 1; y >= 0; y -= 1) {
    for (let x = width - 1; x >= 0; x -= 1) {
      const i = x + width * y;
      let v = d[i];
      if (x + 1 < width) v = Math.min(v, d[i + 1] + 1);
      if (y + 1 < height) v = Math.min(v, d[i + width] + 1);
      if (x + 1 < width && y + 1 < height) v = Math.min(v, d[i + width + 1] + SQRT2);
      if (x > 0 && y + 1 < height) v = Math.min(v, d[i + width - 1] + SQRT2);
      d[i] = v;
    }
  }
  return d;
}

function blurScalarField2D(input, width, height, passes = 1) {
  const kernel = [1, 4, 6, 4, 1];
  const norm = 16;
  let src = new Float32Array(input);
  const tmp = new Float32Array(input.length);
  const out = new Float32Array(input.length);
  for (let pass = 0; pass < passes; pass += 1) {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let k = -2; k <= 2; k += 1) {
          const sx = THREE.MathUtils.clamp(x + k, 0, width - 1);
          sum += src[sx + width * y] * kernel[k + 2];
        }
        tmp[x + width * y] = sum / norm;
      }
    }
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sum = 0;
        for (let k = -2; k <= 2; k += 1) {
          const sy = THREE.MathUtils.clamp(y + k, 0, height - 1);
          sum += tmp[x + width * sy] * kernel[k + 2];
        }
        out[x + width * y] = sum / norm;
      }
    }
    src = new Float32Array(out);
  }
  return src;
}

function makeRasterLineDescriptor(line) {
  const halfFootprintAlongLine = 0.5 * (Math.abs(line.direction.x) + Math.abs(line.direction.y));
  const lengthCells = Math.max(1, (line.maxProjection - line.minProjection) + 2 * halfFootprintAlongLine);
  return {
    z: line.z,
    cx: line.center.x,
    cy: line.center.y,
    cos: Math.cos(line.angle),
    sin: Math.sin(line.angle),
    halfLength: lengthCells * 0.5,
    halfWidth: 0.5,
  };
}

// Local polynomial blend between two signed distances. Unlike blurring the
// complete voxel field, these blends are restricted to the actual junctions
// between contour sides and a layer cap. Large planes, windows and pillars do
// not enter the filter, so their silhouette is not globally distorted.
function localSmoothMax(a,b,radius){
  if(radius<=0)return Math.max(a,b);
  const h=Math.max(radius-Math.abs(a-b),0);
  return Math.max(a,b)+h*h/(4*radius);
}
function localSmoothMin(a,b,radius){
  return -localSmoothMax(-a,-b,radius);
}
// A 45-degree planar join at an authored height step. This is a bounded
// chamfer (not a 3D blur): it preserves the original straight walls and roofs.
function localChamferMin(a,b,radius){
  if(radius<=0)return Math.min(a,b);
  return Math.min(a,b,(a+b-radius)*Math.SQRT1_2);
}

function createOversampledLayerSdfGeometry(standardBlocks, scale, strength, { quality = 'export', style = 'classic' } = {}) {
  if (!standardBlocks.length) return null;

  const preview = quality === 'preview';
  const rounded = style === 'rounded';
  const rasterFactor = 12; // Fixed contour resolution: strength and quality share the same shape.
  const surfaceSamplesPerCell = rounded ? 10 : preview ? 6 : 8;
  const strengthT = THREE.MathUtils.clamp((strength - 1) / 4, 0, 1);
  const closeRadiusPx = 0; // Do not close intentional openings or join separate parts.
  // Keep the familiar Classic XY footprint: only targeted vertical step joints
  // are filleted. Global field blurs produced the melting towers seen in V139.
  const blurPasses = 3;
  const filterWeight = THREE.MathUtils.lerp(.20, 1, strengthT);
  const contourOutset = THREE.MathUtils.lerp(.025, .065, strengthT);
  const contourInset = THREE.MathUtils.lerp(.04, .12, strengthT);
  const capRadius = rounded ? THREE.MathUtils.lerp(.22, .44, strengthT) : 0;
  // One-cell stairs need a readable diagonal, while shallow isolated supports
  // receive a curved relief around the cut's lip. Never blend entire volumes.
  const stepJoinRadius = rounded ? THREE.MathUtils.lerp(.42, .82, strengthT) : 0;
  const supportLipRadius = rounded ? THREE.MathUtils.lerp(.16, .32, strengthT) : 0;
  const isolatedSupportLipRadius = rounded ? THREE.MathUtils.lerp(.24, .44, strengthT) : 0;


  // Only detached diagonal runs need fitted rectangles. Replacing cells in a
  // face-connected wall changes its footprint at cutout corners and can open
  // seams between layers. Axis-aligned runs already have an exact raster edge.
  const fitted = findVectorLineRuns(standardBlocks);
  const occupied = new Set(standardBlocks.map(b => `${b.x},${b.y},${b.z}`));
  const lines = fitted.lines.filter(line =>
    Math.abs(line.direction.x) > 1e-6 && Math.abs(line.direction.y) > 1e-6 &&
    line.blocks.every(b => [[1,0],[-1,0],[0,1],[0,-1]].every(([dx,dy]) =>
      !occupied.has(`${b.x+dx},${b.y+dy},${b.z}`))));
  const excluded = new Set(lines.flatMap(line => line.blocks.map(b => `${b.x},${b.y},${b.z}`)));
  const linesByLayer = new Map();
  for (const line of lines) {
    if (!linesByLayer.has(line.z)) linesByLayer.set(line.z, []);
    linesByLayer.get(line.z).push(makeRasterLineDescriptor(line));
  }

  const minX = Math.max(-1, Math.min(...standardBlocks.map((b) => b.x)) - 1);
  const minY = Math.max(-1, Math.min(...standardBlocks.map((b) => b.y)) - 1);
  const maxX = Math.min(model.gridWidth + 1, Math.max(...standardBlocks.map((b) => b.x + 1)) + 1);
  const maxY = Math.min(model.gridDepth + 1, Math.max(...standardBlocks.map((b) => b.y + 1)) + 1);
  const minZ = Math.min(...standardBlocks.map((b) => b.z));
  const maxZ = Math.max(...standardBlocks.map((b) => b.z));
  const rasterW = Math.max(4, Math.ceil((maxX - minX) * rasterFactor));
  const rasterH = Math.max(4, Math.ceil((maxY - minY) * rasterFactor));

  const blocksByLayer = new Map();
  for (const block of standardBlocks) {
    if (excluded.has(`${block.x},${block.y},${block.z}`)) continue;
    if (!blocksByLayer.has(block.z)) blocksByLayer.set(block.z, new Set());
    blocksByLayer.get(block.z).add(`${block.x},${block.y}`);
  }

  const supportBlocks=model.getBlocks().filter(b=>b.type==='support');
  const layerRows=new Map(),layerColumns=new Map();
  for(const b of [...standardBlocks,...supportBlocks]){
    for(const [map,key,coordinate] of [[layerRows,`${b.z},${b.y}`,b.x],[layerColumns,`${b.z},${b.x}`,b.y]]){
      const line=map.get(key)||new Map();line.set(coordinate,b);map.set(key,line);
    }
  }
  const enclosedSupport=new Set();
  for(const map of [layerRows,layerColumns])for(const line of map.values()){
    const coordinates=[...line.keys()].sort((a,b)=>a-b);let run=[];
    const flush=()=>{const standards=run.filter(n=>line.get(n).type==='standard');if(standards.length>1){const first=standards[0],last=standards[standards.length-1];for(const n of run){const b=line.get(n);if(n>first&&n<last&&b.type==='support')enclosedSupport.add(`${b.x},${b.y},${b.z}`);}}run=[];};
    for(const n of coordinates){if(run.length&&n!==run[run.length-1]+1)flush();run.push(n);}flush();
  }
  for(const b of supportBlocks)if(enclosedSupport.has(`${b.x},${b.y},${b.z}`)){
    const body=blocksByLayer.get(b.z)||new Set();body.add(`${b.x},${b.y}`);blocksByLayer.set(b.z,body);
  }
  const layers = new Map(), contourCache=new Map();
  for (let z = minZ; z <= maxZ; z += 1) {
    const mask = new Uint8Array(rasterW * rasterH);
    const body = blocksByLayer.get(z) ?? new Set();
    const lineDescriptors = linesByLayer.get(z) ?? [];
    const signature=[...body].sort().join(';')+'|'+lineDescriptors.map(({z,...shape})=>JSON.stringify(Object.fromEntries(Object.entries(shape).map(([key,value])=>[key,Math.round(value*1e9)/1e9])))).sort().join('|');
    if(contourCache.has(signature)){layers.set(z,contourCache.get(signature));continue;}

    for (let py = 0; py < rasterH; py += 1) {
      const y = minY + (py + 0.5) / rasterFactor;
      for (let px = 0; px < rasterW; px += 1) {
        const x = minX + (px + 0.5) / rasterFactor;
        const bx = Math.floor(x);
        const by = Math.floor(y);
        let inside = body.has(`${bx},${by}`);
        if (!inside) {
          for (const line of lineDescriptors) {
            const dx = x - line.cx;
            const dy = y - line.cy;
            const lx = dx * line.cos + dy * line.sin;
            const ly = -dx * line.sin + dy * line.cos;
            if (Math.abs(lx) <= line.halfLength && Math.abs(ly) <= line.halfWidth) {
              inside = true;
              break;
            }
          }
        }
        if (inside) mask[px + rasterW * py] = 1;
      }
    }

    const closed = closeRasterMask(mask, rasterW, rasterH, closeRadiusPx);
    const distInside = chamferDistanceTo(closed, rasterW, rasterH, 1);
    const distOutside = chamferDistanceTo(closed, rasterW, rasterH, 0);
    const sdf = new Float32Array(closed.length);
    for (let i = 0; i < closed.length; i += 1) {
      sdf[i] = (closed[i] ? -distOutside[i] : distInside[i]) / rasterFactor;
    }
    // Filtering the distance field rather than the binary occupancy acts like
    // anti-aliasing on a physical contour: straight vectorised spans remain
    // straight, while one-cell raster stair-steps become continuous curves.
    const blurred = blurScalarField2D(sdf, rasterW, rasterH, blurPasses), filtered=new Float32Array(sdf.length);
    // Filtering a straight authored face near a distant opening can move it
    // by a fraction of a pixel in one layer only, producing tiny horizontal
    // ledges and shadows. Keep exact distances on locally straight faces;
    // continue filtering real corners and diagonal contours.
    const straightFace=(edge,tangent,vertical)=>{
      const pairs=[-.3,0,.3].map(offset=>{
        const along=Math.floor(tangent+offset);
        return vertical ? [body.has(`${edge-1},${along}`),body.has(`${edge},${along}`)]
          : [body.has(`${along},${edge-1}`),body.has(`${along},${edge}`)];
      });
      return pairs[1][0]!==pairs[1][1]&&pairs.every(p=>p[0]===pairs[1][0]&&p[1]===pairs[1][1]);
    };
    for(let i=0;i<sdf.length;i++){
      const x=minX+(i%rasterW+.5)/rasterFactor,y=minY+(Math.floor(i/rasterW)+.5)/rasterFactor;
      const ex=Math.round(x),ey=Math.round(y);
      const planar=(Math.abs(x-ex)<.2&&straightFace(ex,y,true))||(Math.abs(y-ey)<.2&&straightFace(ey,x,false));
      filtered[i]=planar?sdf[i]:THREE.MathUtils.clamp(THREE.MathUtils.lerp(sdf[i],blurred[i],filterWeight),sdf[i]-contourOutset,sdf[i]+contourInset);
    }
    contourCache.set(signature,filtered);layers.set(z, filtered);
  }

  const sampleLayerSdf = (z, x, y) => {
    const sdf = layers.get(z);
    if (!sdf) return 10;
    const fx = (x - minX) * rasterFactor - 0.5;
    const fy = (y - minY) * rasterFactor - 0.5;
    if (fx < -1 || fy < -1 || fx > rasterW || fy > rasterH) return 10;
    const x0 = THREE.MathUtils.clamp(Math.floor(fx), 0, rasterW - 1);
    const y0 = THREE.MathUtils.clamp(Math.floor(fy), 0, rasterH - 1);
    const x1 = Math.min(rasterW - 1, x0 + 1);
    const y1 = Math.min(rasterH - 1, y0 + 1);
    const tx = THREE.MathUtils.clamp(fx - Math.floor(fx), 0, 1);
    const ty = THREE.MathUtils.clamp(fy - Math.floor(fy), 0, 1);
    const a = THREE.MathUtils.lerp(sdf[x0 + rasterW * y0], sdf[x1 + rasterW * y0], tx);
    const b = THREE.MathUtils.lerp(sdf[x0 + rasterW * y1], sdf[x1 + rasterW * y1], tx);
    return THREE.MathUtils.lerp(a, b, ty);
  };

  const slabs=[];for(let z=minZ;z<=maxZ;z++){const last=slabs[slabs.length-1];if(last&&layers.get(last.layer)===layers.get(z))last.top=z+1;else slabs.push({layer:z,bottom:z,top:z+1});}
  const authoredBounds={minX:Math.min(...standardBlocks.map(b=>b.x)),maxX:Math.max(...standardBlocks.map(b=>b.x+1)),minY:Math.min(...standardBlocks.map(b=>b.y)),maxY:Math.max(...standardBlocks.map(b=>b.y+1))};
  const supportCells = new Set(supportBlocks.map(b=>`${b.x},${b.y},${b.z}`));
  const adjacentSupportOffsets=[[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]];
  const isolatedSupportCells=new Set(supportBlocks.filter(b=>adjacentSupportOffsets.every(([dx,dy,dz])=>
    !supportCells.has(`${b.x+dx},${b.y+dy},${b.z+dz}`))).map(b=>`${b.x},${b.y},${b.z}`));
  const allAuthoredCells=new Set(model.getBlocks().map(b=>`${b.x},${b.y},${b.z}`)),supportCuts=new Map();
  for(const b of supportBlocks){
    const empty=(dx,dy,dz)=>!allAuthoredCells.has(`${b.x+dx},${b.y+dy},${b.z+dz}`);
    // Extend exposed cuts into empty space to remove any filtered rim beyond
    // a Support face. Faces adjoining Standard cells stay exactly on the grid.
    const margin=.25;
    supportCuts.set(`${b.x},${b.y},${b.z}`,{
      minX:b.x-(empty(-1,0,0)?margin:0),maxX:b.x+1+(empty(1,0,0)?margin:0),
      minY:b.y-(empty(0,-1,0)?margin:0),maxY:b.y+1+(empty(0,1,0)?margin:0),
      minZ:b.z-(empty(0,0,-1)?margin:0),maxZ:b.z+1+(empty(0,0,1)?margin:0),
    });
  }
  // Consecutive Support cubes in a window are one cut volume. Keeping a
  // separate capped box per layer introduces zero-distance internal planes.
  const cutColumns=new Map();
  for(const [key,cut] of supportCuts){const shape=[cut.minX,cut.maxX,cut.minY,cut.maxY].join(',');const list=cutColumns.get(shape)||[];list.push({key,cut});cutColumns.set(shape,list);}
  for(const list of cutColumns.values()){
    list.sort((a,b)=>a.cut.minZ-b.cut.minZ);let group=[],merged=null;
    const flush=()=>{for(const item of group)supportCuts.set(item.key,merged);};
    for(const item of list){if(merged&&item.cut.minZ<=merged.maxZ){merged.maxZ=Math.max(merged.maxZ,item.cut.maxZ);group.push(item);}else{flush();merged={...item.cut};group=[item];}}flush();
  }
  // The support cut stays open in BOTH profiles. The nearest authored Support
  // block identifies whether the exposed rim surrounds a lone cube or a row.
  // Radius is held in the local closure to avoid allocating a per-voxel object.
  let nearestSupportLipRadius=supportLipRadius;
  const supportVoidAt = (x,y,z) => {
    nearestSupportLipRadius=supportLipRadius;
    if(!supportCells.size)return Infinity;
    let nearest=Infinity;const bx=Math.floor(x),by=Math.floor(y),bz=Math.floor(z);
    for(let iz=bz-1;iz<=bz+1;iz++)for(let iy=by-1;iy<=by+1;iy++)for(let ix=bx-1;ix<=bx+1;ix++){
      const key=`${ix},${iy},${iz}`;
      if(!supportCells.has(key))continue;
      const cut=supportCuts.get(key);const qx=Math.max(cut.minX-x,x-cut.maxX),qy=Math.max(cut.minY-y,y-cut.maxY),qz=Math.max(cut.minZ-z,z-cut.maxZ);
      const distance=Math.hypot(Math.max(qx,0),Math.max(qy,0),Math.max(qz,0))+Math.min(Math.max(qx,qy,qz),0);
      if(distance<nearest){nearest=distance;nearestSupportLipRadius=isolatedSupportCells.has(key)?isolatedSupportLipRadius:supportLipRadius;}
    }return nearest;
  };
  // Preserve a narrow interior and the shared faces of authored Standard
  // blocks. Contour reconstruction may round their exterior, but cannot cut
  // a passage through a connected solid or detach one authored layer.
  const authoredCells=new Set(standardBlocks.map(b=>`${b.x},${b.y},${b.z}`)),coreColumns=new Map();
  const addCore=(x,y,dx,dy)=>{const layers=[];for(let z=minZ;z<=maxZ;z++)if(authoredCells.has(`${x},${y},${z}`)&&(!dx&&!dy||authoredCells.has(`${x+dx},${y+dy},${z}`)))layers.push(z);let start=null,previous=null;const flush=()=>{if(start===null)return;const key=`${x},${y}`,list=coreColumns.get(key)||[];list.push({cx:x+.5+dx*.5,cy:y+.5+dy*.5,hx:dx?.8:.3,hy:dy?.8:.3,bottom:start,top:previous+1});coreColumns.set(key,list);};for(const z of layers){if(previous!==null&&z!==previous+1){flush();start=null;}if(start===null)start=z;previous=z;}flush();};
  const authoredColumns=new Set(standardBlocks.map(b=>`${b.x},${b.y}`));for(const key of authoredColumns){const [x,y]=key.split(',').map(Number);addCore(x,y,0,0);addCore(x,y,1,0);addCore(x,y,0,1);}
  // Edge-touching roof cells are not face neighbours. Rounding their two
  // contours independently separates a thin shell even though it was authored
  // as one roof. Add a small local joint only at actual Standard edge contacts.
  // Support subtraction below still removes every Support cell's volume.
  const contactOffsets=[];
  for(let dz=0;dz<=1;dz++)for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    const axes=Number(dx!==0)+Number(dy!==0)+Number(dz!==0);
    if(axes!==2||(!dz&&(dy<0||(!dy&&dx<=0))))continue;
    contactOffsets.push([dx,dy,dz]);
  }
  for(const b of standardBlocks)for(const [dx,dy,dz] of contactOffsets){
    if(!authoredCells.has(`${b.x+dx},${b.y+dy},${b.z+dz}`))continue;
    // Face-connected cells already fill this junction. Avoid unnecessary
    // joints at ordinary wall corners or beside intentionally cut windows.
    if((dx && authoredCells.has(`${b.x+dx},${b.y},${b.z}`)) ||
       (dy && authoredCells.has(`${b.x},${b.y+dy},${b.z}`)) ||
       (dz && authoredCells.has(`${b.x},${b.y},${b.z+dz}`)))continue;
    const cx=b.x+.5+dx*.5,cy=b.y+.5+dy*.5,cz=b.z+.5+dz*.5;
    const hx=dx?.125:.5,hy=dy?.125:.5,hz=dz?.125:.5;
    const key=`${Math.floor(cx)},${Math.floor(cy)}`,list=coreColumns.get(key)||[];
    list.push({cx,cy,hx,hy,bottom:cz-hz,top:cz+hz});coreColumns.set(key,list);
  }
  // A repeated vertical joint is one column, not a stack of capped boxes.
  // Otherwise the union is exactly zero on an internal layer plane.
  for(const [key,cores] of coreColumns){
    const groups=new Map();
    for(const core of cores){const shape=[core.cx,core.cy,core.hx,core.hy].join(',');const group=groups.get(shape)||[];group.push(core);groups.set(shape,group);}
    const merged=[];
    for(const group of groups.values()){
      group.sort((a,b)=>a.bottom-b.bottom);let previous=null;
      for(const core of group){if(previous&&core.bottom<=previous.top+1e-8)previous.top=Math.max(previous.top,core.top);else{previous={...core};merged.push(previous);}}
    }
    coreColumns.set(key,merged);
  }
  const localProfileCache=new Map();
  const fieldAt = (x, y, zWorld) => {
    let d = Number.POSITIVE_INFINITY;
    const profileKey=`${Math.round(x*1e6)},${Math.round(y*1e6)}`;
    let profile=localProfileCache.get(profileKey);
    if(!profile){profile=[];for(const run of slabs){const contour=sampleLayerSdf(run.layer,x,y);const previous=profile[profile.length-1];if(previous&&run.bottom===previous.top&&Math.abs(previous.contour-contour)<1e-5)previous.top=run.top;else profile.push({contour,bottom:run.bottom,top:run.top});}profile.solid=[];for(let iy=Math.floor(y)-1;iy<=Math.floor(y)+1;iy++)for(let ix=Math.floor(x)-1;ix<=Math.floor(x)+1;ix++)for(const core of coreColumns.get(`${ix},${iy}`)||[]){const contour=Math.max(Math.abs(x-core.cx)-core.hx,Math.abs(y-core.cy)-core.hy);if(contour<.2)profile.solid.push({contour,bottom:core.bottom===0?0:core.bottom+(rounded?Math.min(capRadius*.5,(core.top-core.bottom)*.2):0),top:core.top-(rounded?Math.min(capRadius*.5,(core.top-core.bottom)*.2):0)});}if(localProfileCache.size<40000)localProfileCache.set(profileKey,profile);}
    // Both profiles start with the original signed union of exact slabs. The
    // Classic mode remains identical to V135, including flat tops and support
    // cuts. A single 3D smooth-min across slabs produced raised blobs and
    // scallops in concave architectural details. Do not use it here.
    let previousRun=null;
    let previousDistance=Number.POSITIVE_INFINITY;
    for(const run of profile){
      if(run.contour>3){previousRun=run;previousDistance=Number.POSITIVE_INFINITY;continue;}
      const cap=Math.max(run.bottom-zWorld,zWorld-run.top);
      // Round the exterior 90-degree junction between a horizontal cap and
      // its vertical wall. This is a genuine curved fillet, not an inflated
      // interpolation of full level contours.
      const slabDistance=rounded?Math.max(run.bottom===0?-zWorld:-Infinity,localSmoothMax(run.contour,run.bottom===0?zWorld-run.top:cap,capRadius)):Math.max(run.contour,cap);
      // Blend only the joined terrace, with continuous falloff at its exposed
      // footprint and away from the shared layer. No whole-volume inflation.
      if(rounded && previousRun && previousRun.top===run.bottom){
        const footprintT=THREE.MathUtils.clamp(-previousRun.contour/.25,0,1);
        const heightT=THREE.MathUtils.clamp((stepJoinRadius*1.2-Math.abs(zWorld-run.bottom))/(stepJoinRadius*.6),0,1);
        const joinRadius=stepJoinRadius*footprintT*footprintT*(3-2*footprintT)*heightT*heightT*(3-2*heightT);
        d=Math.min(d,localSmoothMin(previousDistance,slabDistance,joinRadius));
      } else d=Math.min(d,slabDistance);
      // A shared authored face is internal, not an exposed cap. Restore the
      // intersection of neighboring footprints through that plane; otherwise
      // rounding both caps can carve a slit beside a changing layer contour.
      if(rounded && previousRun && previousRun.top===run.bottom){
        const sharedContour=Math.max(previousRun.contour,run.contour);
        const bridgeHalf=Math.min(capRadius,(previousRun.top-previousRun.bottom)*.45,(run.top-run.bottom)*.45);
        const joinedCap=Math.max(run.bottom-bridgeHalf-zWorld,zWorld-run.bottom-bridgeHalf);
        d=Math.min(d,Math.max(sharedContour,joinedCap));
      }
      previousRun=run;previousDistance=slabDistance;
    }
    // A continuous union is essential: a conditional replacement at d=0
    // gives finite-difference normals a discontinuity along the wall.
    if(d>-.3)for(const core of profile.solid)d=Math.min(d,Math.max(core.contour,core.bottom-zWorld,zWorld-core.top));
    // Exact print-bed plane: XY smoothing is allowed, under-side rounding is not.
    // SDF may round outside the original cells, but it must NEVER leave
    // the actual rectangular build plate (including at the outer rows).
    const plateBoundary = Math.max(-x, x - model.gridWidth, -y, y - model.gridDepth);
    const footprintBoundary=Math.max(authoredBounds.minX-x,x-authoredBounds.maxX,authoredBounds.minY-y,y-authoredBounds.maxY,minZ-zWorld,zWorld-(maxZ+1));
    const supportDistance=supportVoidAt(x,y,zWorld);
    // A curved concave fillet at the Standard/Support cut makes openings
    // softer, including a single isolated Support cube. Smooth subtraction
    // can only REMOVE material at its mouth; the Support interior stays empty.
    const withOpening=rounded && Number.isFinite(supportDistance)
      ? localSmoothMax(d,-supportDistance,nearestSupportLipRadius)
      : Math.max(d,-supportDistance);
    return Math.max(withOpening, -zWorld, plateBoundary,footprintBoundary);
  };

  const margin = 0.45;
  const bounds = {
    minX: minX - margin,
    minY: minY - margin,
    minZ: -0.30,
    maxX: maxX + margin,
    maxY: maxY + margin,
    maxZ: maxZ + 1 + margin,
  };
  const step = 1 / surfaceSamplesPerCell;
  const nx = Math.ceil((bounds.maxX - bounds.minX) / step) + 1;
  const ny = Math.ceil((bounds.maxY - bounds.minY) / step) + 1;
  const nz = Math.ceil((bounds.maxZ - bounds.minZ) / step) + 1;
  const field = new Float32Array(nx * ny * nz);
  const indexOf = (ix, iy, iz) => ix + nx * (iy + ny * iz);
  for (let iz = 0; iz < nz; iz += 1) {
    const z = bounds.minZ + iz * step;
    for (let iy = 0; iy < ny; iy += 1) {
      const y = bounds.minY + iy * step;
      for (let ix = 0; ix < nx; ix += 1) {
        const x = bounds.minX + ix * step;
        field[indexOf(ix, iy, iz)] = fieldAt(x, y, z);
      }
    }
  }

  const positions = [];
  const cubeCorners = [
    [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
    [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
  ];
  const tetrahedra = [
    [0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6],
    [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6],
  ];
  const planarVertexCache=new Map();
  const anchorPlanarVertex=(p)=>{
    const key=[p.x,p.y,p.z].map(n=>Math.round(n*1e7)).join(',');
    const cached=planarVertexCache.get(key);if(cached){p.x=cached[0];p.y=cached[1];return p;}
    const straightAcrossLayers=(vertical,edge,tangent)=>{
      let reference=null;
      for(const dz of [-.3,0,.3]){
        const body=blocksByLayer.get(THREE.MathUtils.clamp(Math.floor(p.z+dz),minZ,maxZ))||new Set();
        for(const dt of [-.3,0,.3]){
          const along=Math.floor(tangent+dt),a=vertical?body.has(`${edge-1},${along}`):body.has(`${along},${edge-1}`),b=vertical?body.has(`${edge},${along}`):body.has(`${along},${edge}`);
          if(a===b||reference!==null&&reference!==a)return false;reference=a;
        }
      }return true;
    };
    const ex=Math.round(p.x),ey=Math.round(p.y);
    if(Math.abs(p.x-ex)<.075&&straightAcrossLayers(true,ex,p.y))p.x=ex;
    if(Math.abs(p.y-ey)<.075&&straightAcrossLayers(false,ey,p.x))p.y=ey;
    planarVertexCache.set(key,[p.x,p.y]);return p;
  };
  // Neighbouring tetrahedra must share exactly the same edge intersection.
  // Reuse those vertices instead of repeating interpolation and planar anchoring.
  const intersectionCache=new Map();
  const interpolate = (pa, pb, va, vb) => {
    const edgeKey=Math.min(pa.sampleIndex,pb.sampleIndex)*field.length+Math.max(pa.sampleIndex,pb.sampleIndex);
    const shared=intersectionCache.get(edgeKey);if(shared)return shared;
    const denom = va - vb;
    const t = Math.abs(denom) < 1e-9 ? 0.5 : THREE.MathUtils.clamp(va / denom, 0, 1);
    const vertex=anchorPlanarVertex(new THREE.Vector3(
      THREE.MathUtils.lerp(pa.x, pb.x, t),
      THREE.MathUtils.lerp(pa.y, pb.y, t),
      THREE.MathUtils.lerp(pa.z, pb.z, t),
    ));
    intersectionCache.set(edgeKey,vertex);return vertex;
  };
  const addTriangle = (a, b, c, outwardHint) => {
    const normal = b.clone().sub(a).cross(c.clone().sub(a));
    // Keep nonzero sliver triangles: removing these opens cracks between tetrahedra.
    if (normal.lengthSq() < 1e-24) return;
    if (outwardHint && normal.dot(outwardHint) < 0) [b, c] = [c, b];
    for (const p of [a, b, c]) {
      // Preserve horizontal manufacturing planes. XY contours remain sub-voxel
      // continuous; only Z faces close to authored layer boundaries are snapped.
      if(Math.abs(p.z)<1e-6)p.z=0;
      positions.push(p.x * scale, p.y * scale, p.z * scale);
    }
  };

  for (let iz = 0; iz < nz - 1; iz += 1) {
    for (let iy = 0; iy < ny - 1; iy += 1) {
      for (let ix = 0; ix < nx - 1; ix += 1) {
        const values = cubeCorners.map(([dx, dy, dz]) => field[indexOf(ix + dx, iy + dy, iz + dz)]);
        if (values.every((v) => v >= 0) || values.every((v) => v < 0)) continue;
        // Most sampled cubes are solid interior or empty space. Allocate the
        // eight intersection vectors only when this cube contains the surface.
        const points = cubeCorners.map(([dx, dy, dz]) => {const point=new THREE.Vector3(
          bounds.minX + (ix + dx) * step,
          bounds.minY + (iy + dy) * step,
          bounds.minZ + (iz + dz) * step,
        );point.sampleIndex=indexOf(ix+dx,iy+dy,iz+dz);return point;});
        for (const tetra of tetrahedra) {
          const inside = tetra.filter((corner) => values[corner] < 0);
          const outside = tetra.filter((corner) => values[corner] >= 0);
          if (!inside.length || inside.length === 4) continue;
          if (inside.length === 1) {
            const i0 = inside[0];
            const p0 = interpolate(points[i0], points[outside[0]], values[i0], values[outside[0]]);
            const p1 = interpolate(points[i0], points[outside[1]], values[i0], values[outside[1]]);
            const p2 = interpolate(points[i0], points[outside[2]], values[i0], values[outside[2]]);
            const hint = points[outside[0]].clone().add(points[outside[1]]).add(points[outside[2]]).multiplyScalar(1 / 3).sub(points[i0]);
            addTriangle(p0, p1, p2, hint);
          } else if (inside.length === 3) {
            const o0 = outside[0];
            const p0 = interpolate(points[o0], points[inside[0]], values[o0], values[inside[0]]);
            const p1 = interpolate(points[o0], points[inside[1]], values[o0], values[inside[1]]);
            const p2 = interpolate(points[o0], points[inside[2]], values[o0], values[inside[2]]);
            const hint = points[o0].clone().sub(points[inside[0]].clone().add(points[inside[1]]).add(points[inside[2]]).multiplyScalar(1 / 3));
            addTriangle(p0, p1, p2, hint);
          } else {
            const [ia, ib] = inside;
            const [oa, ob] = outside;
            const pac = interpolate(points[ia], points[oa], values[ia], values[oa]);
            const pad = interpolate(points[ia], points[ob], values[ia], values[ob]);
            const pbc = interpolate(points[ib], points[oa], values[ib], values[oa]);
            const pbd = interpolate(points[ib], points[ob], values[ib], values[ob]);
            const hint = points[oa].clone().add(points[ob]).multiplyScalar(0.5)
              .sub(points[ia].clone().add(points[ib]).multiplyScalar(0.5));
            addTriangle(pac, pad, pbd, hint);
            addTriangle(pac, pbd, pbc, hint);
          }
        }
      }
    }
  }

  if (!positions.length) return null;
  const raw = new THREE.BufferGeometry();
  raw.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  // Field-derived normals already shade curves; avoid the expensive crease
  // adjacency pass, which is overwritten immediately below. Same vertices.
  const geometry=raw;geometry.computeVertexNormals();
  // Shade curved surfaces from the reconstruction field rather than tiny
  // tetrahedron faces. Preserve the authored horizontal cap normals.
  const vertex=geometry.getAttribute('position'),normals=geometry.getAttribute('normal'),gradientCache=new Map(),epsilon=step*.2;
  for(let i=0;i<vertex.count;i++){
    if(!rounded && Math.abs(normals.getZ(i))>.995)continue;
    const x=vertex.getX(i)/scale,y=vertex.getY(i)/scale,z=vertex.getZ(i)/scale,key=[x,y,z].map(n=>Math.round(n*1e6)).join(',');let normal=gradientCache.get(key);
    if(!normal){const surface=fieldAt;normal=new THREE.Vector3(surface(x+epsilon,y,z)-surface(x-epsilon,y,z),surface(x,y+epsilon,z)-surface(x,y-epsilon,z),surface(x,y,z+epsilon)-surface(x,y,z-epsilon));if(normal.lengthSq()>1e-12)normal.normalize();gradientCache.set(key,normal);}
    if(normal.lengthSq()>1e-12)normals.setXYZ(i,normal.x,normal.y,normal.z);
  }
  normals.needsUpdate=true;
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = {
    reconstruction: 'oversampled-2.5d-raster-sdf',
    rasterFactor,
    closeRadiusPx,
    blurPasses,
    capRadius,stepJoinRadius,supportLipRadius,isolatedSupportLipRadius,filterWeight,contourOutset,contourInset,slabCount:slabs.length,style:rounded?'rounded':'classic',
  };
  return geometry;
}

function addSmoothBlockColors(geometry, standardBlocks, exportScale = 1) {
  const scale = Math.max(1e-6, Number(exportScale) || 1);
  const blockMap = new Map();
  const palette = [];
  const paletteIndex = new Map();

  for (const block of standardBlocks) {
    const color = normalizeStandardBlockColor(block.color);
    blockMap.set(modelBlockKey(block.x, block.y, block.z), { ...block, color });
    if (!paletteIndex.has(color)) {
      paletteIndex.set(color, palette.length);
      palette.push(color);
    }
  }

  const position = geometry.getAttribute('position');
  if (!position || position.count < 3) return { palette, triangleColorIndices: [] };

  if(palette.length===1){const value=new THREE.Color(palette[0]),colors=new Float32Array(position.count*3);for(let i=0;i<colors.length;i+=3){colors[i]=value.r;colors[i+1]=value.g;colors[i+2]=value.b;}const triangleColorIndices=Array(Math.floor(position.count/3)).fill(0);geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));geometry.userData.colorPalette=palette;geometry.userData.triangleColorIndices=triangleColorIndices;return {palette,triangleColorIndices};}
  const nearestBlockColor = (cx, cy, cz) => {
    const gx = cx / scale;
    const gy = cy / scale;
    const gz = cz / scale;
    const baseX = Math.floor(gx);
    const baseY = Math.floor(gy);
    const baseZ = Math.floor(gz);
    let best = null;
    let bestDistance = Infinity;

    for (let radius = 0; radius <= 2 && !best; radius += 1) {
      for (let z = baseZ - radius; z <= baseZ + radius; z += 1) {
        for (let y = baseY - radius; y <= baseY + radius; y += 1) {
          for (let x = baseX - radius; x <= baseX + radius; x += 1) {
            const block = blockMap.get(modelBlockKey(x, y, z));
            if (!block) continue;
            const dx = gx - (x + 0.5);
            const dy = gy - (y + 0.5);
            const dz = gz - (z + 0.5);
            const distance = dx * dx + dy * dy + dz * dz;
            if (distance < bestDistance) {
              bestDistance = distance;
              best = block;
            }
          }
        }
      }
    }

    return best?.color ?? palette[0] ?? DEFAULT_BLOCK_COLOR;
  };

  const vertexColors = new Float32Array(position.count * 3);
  const triangleColorIndices = [];
  const colorValue = new THREE.Color();

  for (let i = 0; i + 2 < position.count; i += 3) {
    const cx = (position.getX(i) + position.getX(i + 1) + position.getX(i + 2)) / 3;
    const cy = (position.getY(i) + position.getY(i + 1) + position.getY(i + 2)) / 3;
    const cz = (position.getZ(i) + position.getZ(i + 1) + position.getZ(i + 2)) / 3;
    const color = nearestBlockColor(cx, cy, cz);
    const pIndex = paletteIndex.get(color) ?? 0;
    triangleColorIndices.push(pIndex);
    colorValue.set(color);
    for (let vertex = 0; vertex < 3; vertex += 1) {
      const offset = (i + vertex) * 3;
      vertexColors[offset] = colorValue.r;
      vertexColors[offset + 1] = colorValue.g;
      vertexColors[offset + 2] = colorValue.b;
    }
  }

  geometry.setAttribute('color', new THREE.BufferAttribute(vertexColors, 3));
  geometry.userData.colorPalette = palette;
  geometry.userData.triangleColorIndices = triangleColorIndices;
  return { palette, triangleColorIndices };
}

function smoothCacheKey(blocks,strength,quality='export',style=smoothEdgeProfile){
 const snapshot=blocks.map(b=>[b.x,b.y,b.z,b.type,b.type==='standard'?normalizeStandardBlockColor(b.color):'']).sort((a,b)=>a[2]-b[2]||a[1]-b[1]||a[0]-b[0]);
 return JSON.stringify([model.gridWidth,model.gridDepth,strength,quality,style,snapshot]);
}
function cacheSmoothTemplate(key,geometry){smoothGeometryCache.set(key,geometry);while(smoothGeometryCache.size>2){const oldest=smoothGeometryCache.keys().next().value;smoothGeometryCache.get(oldest).dispose();smoothGeometryCache.delete(oldest);}}

function makeSmoothExportGroup(exportScale = 1, { yUp = false, quality = 'export', blocks:sourceBlocks = model.getBlocks() } = {}) {
  const standardBlocks = sourceBlocks.filter((block) => block.type !== 'support');
  if (standardBlocks.length === 0) {
    throw new Error('NO STANDARD BLOCKS TO TREAT / SUPPORT BLOCKS ARE OMITTED');
  }

  const strength = THREE.MathUtils.clamp(Math.round(Number(smoothingStrength) || 3), 1, 5);

  const group = new THREE.Group();
  group.name = 'BuildItLiveOrganicRasterModel';
  const cacheKey=smoothCacheKey(sourceBlocks,strength,quality);
  let template=smoothGeometryCache.get(cacheKey);
  if(template){smoothGeometryCache.delete(cacheKey);smoothGeometryCache.set(cacheKey,template);}
  else{template=createOversampledLayerSdfGeometry(standardBlocks,1,strength,{quality,style:smoothEdgeProfile});if(!template)throw new Error('SMOOTH MODEL COULD NOT BUILD A PRINTABLE SURFACE');if(template.index){const flat=template.toNonIndexed();template.dispose();template=flat;}addSmoothBlockColors(template,standardBlocks,1);cacheSmoothTemplate(cacheKey,template);}
  const geometry=template.clone();geometry.scale(exportScale,exportScale,exportScale);
  geometry.scale(CONFIG.CELL_WIDTH, CONFIG.CELL_DEPTH, CONFIG.CELL_HEIGHT);

  const material = new THREE.MeshStandardMaterial({
    name: 'OrganicRasterSdfSurface',
    color: 0xffffff,
    vertexColors: true,
    roughness: 0.58,
    metalness: 0.0,
    flatShading: false,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'organic_oversampled_surface';
  mesh.userData.exportGeometry = 'oversampled-2.5d-raster-sdf-layer-reconstruction';
  group.add(mesh);
  group.userData = {
    surface: 'organic-print',
    joinBlend: strength,
    smoothEdgeProfile,
    edgeTreatment: 'oversampled-layer-raster_distance-field_anisotropic-z-loft',
  };

  if (yUp) {
    group.rotation.x = -Math.PI / 2;
    const origin = smoothWorkspaceOrigin(model.gridWidth, model.gridDepth, CONFIG.CELL_WIDTH, CONFIG.CELL_DEPTH, exportScale);
    group.position.x = origin.x;
    group.position.z = origin.z;
  }

  group.updateMatrixWorld(true);
  group.userData.disposeExportResources = () => {
    geometry.dispose();
    material.dispose();
  };
  return group;
}

function disposeExportObject(object) {
  object.userData.disposeExportResources?.();
}

function disposeExportGroup(group) {
  group.userData.disposeExportResources?.();
}

// -----------------------------------------------------------------------------
// REAL-TIME ORGANIC PRINT RENDERING
// -----------------------------------------------------------------------------
// The voxel model remains the editable source of truth. Organic Print is a live
// derived render generated with the same line detection, straight-member math,
// and local-junction SDF used by the export pipeline. Preview quality changes
// sampling density only; it does not use a different smoothing algorithm.
function disposeRealtimeOrganicSurface() {
  if (realtimeOrganicObject) {
    realtimeOrganicGroup.remove(realtimeOrganicObject);
    disposeExportGroup(realtimeOrganicObject);
    realtimeOrganicObject = null;
  }
  realtimeOrganicGroup.clear();
}

function isRealtimeOrganicVisible() {
  return exportSurfaceMode === 'soft1' && !exactImportedStl && activeLayerView === null;
}

function setRealtimeSmoothingState(label) {
  const busy=label.includes('BUILDING')||label.includes('UPDATING');
  if (realtimeSmoothingState) realtimeSmoothingState.textContent = label;
  document.querySelector('#realtimeSmoothingControls')?.setAttribute('aria-busy',String(busy));
  const indicator=document.querySelector('#smoothLoadingIndicator'),loadingLabel=document.querySelector('#smoothLoadingLabel');
  if(indicator)indicator.hidden=!busy;
  if(loadingLabel&&busy)loadingLabel.textContent=label.includes('BUILDING')?'GENERATING SMOOTH VIEW':'PREPARING SMOOTH VIEW';
}

function refreshSmoothOutline(){
 smoothOutlineGroup.children.forEach(o=>o.material.dispose());smoothOutlineGroup.clear();
 smoothOutlineGroup.visible=smoothOriginalOutline&&isRealtimeOrganicVisible();
 if(smoothOutlineGroup.visible)for(const block of model.getBlocks().filter(b=>b.type==='standard')){const line=new THREE.LineSegments(blockEdgesGeometry,new THREE.LineBasicMaterial({color:0x222222,transparent:true,opacity:.4,depthTest:false}));line.position.copy(modelToWorld(block.x,block.y,block.z));line.renderOrder=19;smoothOutlineGroup.add(line);}
 document.querySelector('#smoothOriginalOutline')?.setAttribute('aria-pressed',String(smoothOriginalOutline));
}
function applyRealtimeSurfaceVisibility() {
  const organic = isRealtimeOrganicVisible() && Boolean(realtimeOrganicObject);
  realtimeOrganicGroup.visible = organic;
  blocksGroup.traverse((object) => {
    if (!object.isMesh || object.userData?.kind !== 'block') return;
    if (object.userData.type === 'support') {
      object.visible = true;
      object.material = supportMaterial;
      object.castShadow = false;
      return;
    }
    object.visible = !organic;
    object.material = getStandardBlockMaterial(object.userData.color);
    object.castShadow = !organic;
  });
  if (realtimeRenderStatus) {
    realtimeRenderStatus.textContent = exactImportedStl ? (isImportedGridReferenceView() ? 'MESH / GRID' : 'ORIGINAL STL') :
      exportSurfaceMode === 'soft1' && activeLayerView !== null ? 'BLOCKS / LAYER' :
      exportSurfaceMode === 'soft1' ? 'SMOOTH' : 'BLOCKS';
  }
}

async function rebuildRealtimeOrganicSurface(revision) {
  if (revision !== realtimeSmoothRevision || !isRealtimeOrganicVisible()) return;

  const standardCount = model.getBlocks().filter((block) => block.type !== 'support').length;
  if (standardCount === 0) {
    disposeRealtimeOrganicSurface();
    setRealtimeSmoothingState('EMPTY');
    applyRealtimeSurfaceVisibility();
    return;
  }

  setRealtimeSmoothingState('BUILDING…');
  realtimeSmoothBusy=true;
  try {
    const blocks=cloneBlocks(),strength=THREE.MathUtils.clamp(Math.round(Number(smoothingStrength)||3),1,5),cacheKey=smoothCacheKey(blocks,strength);
    if(!smoothGeometryCache.has(cacheKey)){
      const result=await smoothWorker.compute({blocks,gridWidth:model.gridWidth,gridDepth:model.gridDepth,strength,quality:'export',style:smoothEdgeProfile});
      if(revision!==realtimeSmoothRevision||!isRealtimeOrganicVisible())return;
      const template=new THREE.BufferGeometry();
      for(const name of ['position','normal','color'])template.setAttribute(name,new THREE.BufferAttribute(result[name],3));
      template.userData={...result.userData,triangleColorIndices:Array.from(result.triangleColorIndices)};
      template.computeBoundingBox();template.computeBoundingSphere();cacheSmoothTemplate(cacheKey,template);
    }
    const nextObject = makeSmoothExportGroup(1, { quality: 'export',blocks });
    nextObject.traverse((object) => {
      if (!object.isMesh) return;
      object.castShadow = true;
      object.receiveShadow = true;
    });
    if (revision !== realtimeSmoothRevision) {
      disposeExportGroup(nextObject);
      return;
    }

    // Organic geometry is authored in model coordinates (X, grid-Y, height-Z).
    // The editor is Three.js Y-up, so map it to (X, height, grid-Y) while keeping
    // the same centered grid footprint as the editable cubes.
    // Keep orientation right-handed: the extra Y-axis flip in V39 made
    // grid-depth coordinates run OUTWARD rather than back into the plate.
    nextObject.scale.set(1, 1, 1);
    nextObject.rotation.x = -Math.PI / 2;
    const origin = smoothWorkspaceOrigin(model.gridWidth, model.gridDepth, CONFIG.CELL_WIDTH, CONFIG.CELL_DEPTH);
    nextObject.position.set(origin.x, 0, origin.z);
    nextObject.updateMatrixWorld(true);

    disposeRealtimeOrganicSurface();
    realtimeOrganicObject = nextObject;
    realtimeOrganicGroup.add(nextObject);
    realtimeOrganicGroup.visible = true;
    setRealtimeSmoothingState('LIVE / EXPORT QUALITY');
    refreshMeasurementBounds();
    applyRealtimeSurfaceVisibility();
  } catch (error) {
    if(error?.name==='AbortError'||revision!==realtimeSmoothRevision)return;
    console.warn('Live Organic Print render failed:', error);
    disposeRealtimeOrganicSurface();
    setRealtimeSmoothingState('UNAVAILABLE');
    // Keep the voxel representation visible if the derived preview cannot build.
    realtimeOrganicGroup.visible = false;
    blocksGroup.traverse((object) => {
      if (object.isMesh && object.userData?.kind === 'block' && object.userData.type !== 'support') {
        object.material = getStandardBlockMaterial(object.userData.color);
        object.visible = true;
        object.castShadow = true;
      }
    });
  } finally {
    if(revision===realtimeSmoothRevision){realtimeSmoothBusy=false;if(queuedLiveSmooth){queuedLiveSmooth=false;scheduleRealtimeOrganicSurface();}}
  }
}

function scheduleRealtimeOrganicSurface({ immediate = false } = {}) {
  // In a live sensor session frames can arrive faster than the 150 ms preview
  // delay. A normal trailing-edge debounce would cancel every pending render,
  // leaving SMOOTH permanently stuck on UPDATING. Coalesce those frames into
  // one pending refresh; it samples the latest VoxelModel when the timer fires.
  const liveSensorSmooth = IS_HARDWARE_BUILDER && (serialConnected || simulationActive) && isRealtimeOrganicVisible();
  if(liveSensorSmooth&&!immediate&&realtimeSmoothBusy){queuedLiveSmooth=true;return;}
  if (liveSensorSmooth && !immediate && realtimeSmoothTimer !== null) return;

  realtimeSmoothRevision += 1;
  const revision = realtimeSmoothRevision;
  smoothWorker.cancel();realtimeSmoothBusy=false;queuedLiveSmooth=false;
  window.clearTimeout(realtimeSmoothTimer);
  realtimeSmoothTimer = null;

  applyRealtimeSurfaceVisibility();refreshSmoothOutline();
  if (!isRealtimeOrganicVisible()) {
    if (exportSurfaceMode !== 'soft1') disposeRealtimeOrganicSurface();
    setRealtimeSmoothingState(exportSurfaceMode === 'soft1' ? 'LAYER VIEW' : 'READY');
    return;
  }

  setRealtimeSmoothingState('UPDATING…');
  realtimeSmoothTimer = window.setTimeout(() => {
    realtimeSmoothTimer = null;
    setRealtimeSmoothingState('BUILDING…');requestAnimationFrame(()=>requestAnimationFrame(()=>window.setTimeout(()=>{realtimeSmoothTask=rebuildRealtimeOrganicSurface(revision);},0)));
  }, immediate ? 0 : REALTIME_SMOOTH_DELAY_MS);
}

function makeObjMetadataHeader() {
  const lines = [
    `# DIGITAL_TWIN_VOXEL_MODEL ${MODEL_FILE_VERSION}`,
    `# GRID_SIZE ${model.gridSize}`,
    `# GRID_WIDTH ${model.gridWidth}`,
    `# GRID_DEPTH ${model.gridDepth}`, 
    `# MAX_HEIGHT ${CONFIG.MAX_HEIGHT}`,
  ];

  for (const block of model.getBlocks()) {
    lines.push(`# DIGITAL_TWIN_BLOCK ${block.type} ${block.x} ${block.y} ${block.z}`);
  }

  return `${lines.join('\n')}\n`;
}

function encodeCompactStlMetadata() {
  const gridSize = model.gridSize;
  const maxHeight = CONFIG.MAX_HEIGHT;
  const cellCount = gridSize * gridSize * maxHeight;
  const bytes = new Uint8Array(2 + Math.ceil(cellCount * 2 / 8));
  bytes[0] = gridSize;
  bytes[1] = maxHeight;

  for (const block of model.getBlocks()) {
    if (block.x < 0 || block.x >= gridSize || block.y < 0 || block.y >= gridSize || block.z < 0 || block.z >= maxHeight) continue;
    const value = block.type === 'support' ? 2 : 1;
    const index = (block.z * gridSize * gridSize) + (block.y * gridSize) + block.x;
    const bit = index * 2;
    const byteIndex = 2 + Math.floor(bit / 8);
    const shift = bit % 8;
    bytes[byteIndex] |= value << shift;
  }

  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return `DTWIN1_${btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')}`;
}

function decodeCompactStateToken(token = '') {
  const cleanToken = String(token).match(/DTWIN1_[A-Za-z0-9_-]+/i)?.[0];
  if (!cleanToken) return null;

  try {
    const encoded = cleanToken.slice('DTWIN1_'.length).replace(/-/g, '+').replace(/_/g, '/');
    const padded = encoded + '='.repeat((4 - encoded.length % 4) % 4);
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    if (bytes.length < 3) return null;

    const gridSize = clampGridSize(bytes[0]);
    const maxHeight = Number(bytes[1]) || CONFIG.MAX_HEIGHT;
    const blocks = [];
    const cellCount = gridSize * gridSize * maxHeight;
    const requiredBytes = 2 + Math.ceil(cellCount * 2 / 8);
    if (bytes.length < requiredBytes) return null;

    for (let index = 0; index < cellCount; index += 1) {
      const bit = index * 2;
      const byteIndex = 2 + Math.floor(bit / 8);
      const shift = bit % 8;
      const value = (bytes[byteIndex] >> shift) & 0b11;
      if (value !== 1 && value !== 2) continue;
      const z = Math.floor(index / (gridSize * gridSize));
      const rem = index % (gridSize * gridSize);
      const y = Math.floor(rem / gridSize);
      const x = rem % gridSize;
      blocks.push({ x, y, z, type: value === 2 ? 'support' : 'standard' });
    }

    return { gridSize, blocks };
  } catch (error) {
    console.warn('Could not decode Digital Twin STL metadata', error);
    return null;
  }
}

function decodeCompactStlMetadata(text = '') {
  const match = String(text).match(/DTWIN1_[A-Za-z0-9_-]+/i);
  return match ? decodeCompactStateToken(match[0]) : null;
}

function attachCompactStlMetadata(stlText, token = encodeCompactStlMetadata()) {
  if (typeof stlText !== 'string') return stlText;
  let result = stlText;
  if (/^solid[^\r\n]*/i.test(result)) {
    result = result.replace(/^solid[^\r\n]*/i, `solid ${token}`);
  } else {
    result = `solid ${token}\n${result}`;
  }
  if (/endsolid[^\r\n]*\s*$/i.test(result)) {
    result = result.replace(/endsolid[^\r\n]*\s*$/i, `endsolid ${token}`);
  }
  return result;
}

const STL_TRAILER_PREFIX = 'DTWIN2_BEGIN';
const STL_TRAILER_SUFFIX = 'DTWIN2_END';
const STL_HEADER_ID_PREFIX = 'DTWIN3:';

function makeStlExportId() {
  const timePart = Date.now().toString(36).toUpperCase();
  let randomPart = '';
  if (globalThis.crypto?.getRandomValues) {
    const values = new Uint32Array(2);
    globalThis.crypto.getRandomValues(values);
    randomPart = [...values].map((value) => value.toString(36).toUpperCase().padStart(7, '0')).join('');
  } else {
    randomPart = Math.random().toString(36).slice(2, 16).toUpperCase();
  }
  return `${timePart}-${randomPart}`.slice(0, 52);
}

function getBinaryStlBytes(binaryStl) {
  if (binaryStl instanceof DataView) {
    return new Uint8Array(binaryStl.buffer, binaryStl.byteOffset, binaryStl.byteLength);
  }
  if (binaryStl instanceof ArrayBuffer) return new Uint8Array(binaryStl);
  if (ArrayBuffer.isView(binaryStl)) {
    return new Uint8Array(binaryStl.buffer, binaryStl.byteOffset, binaryStl.byteLength);
  }
  throw new Error('STL EXPORTER DID NOT RETURN BINARY DATA');
}

function crc16Ccitt(bytes, end = bytes.length) {
  let crc = 0xffff;
  for (let i = 0; i < end; i += 1) {
    crc ^= bytes[i] << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function encodeBinaryVoxelState(blocks = model.getBlocks(), gridSize = model.gridSize) {
  const clean = [];
  const seen = new Set();
  for (const raw of blocks) {
    const x = Math.round(Number(raw?.x));
    const y = Math.round(Number(raw?.y));
    const z = Math.round(Number(raw?.z));
    const type = raw?.type === 'support' ? 'support' : 'standard';
    if (![x, y, z].every(Number.isFinite)) continue;
    if (x < 0 || x > 15 || y < 0 || y > 15 || z < 0 || z > 15) continue;
    const key = `${x},${y},${z}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({ x, y, z, type });
  }

  clean.sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
  const bytes = new Uint8Array(7 + clean.length * 2);
  bytes[0] = 0x42; // B
  bytes[1] = 0x34; // 4 — Build It Live binary voxel state v4
  bytes[2] = clampGridSize(gridSize);
  const view = new DataView(bytes.buffer);
  view.setUint16(3, clean.length, true);
  let offset = 5;
  for (const block of clean) {
    const packed =
      (block.x & 0x0f) |
      ((block.y & 0x0f) << 4) |
      ((block.z & 0x0f) << 8) |
      ((block.type === 'support' ? 1 : 0) << 12);
    view.setUint16(offset, packed, true);
    offset += 2;
  }
  view.setUint16(offset, crc16Ccitt(bytes, offset), true);
  return bytes;
}

function decodeBinaryVoxelState(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 7) return null;
  if (bytes[0] !== 0x42 || bytes[1] !== 0x34) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const gridSize = clampGridSize(bytes[2]);
  const count = view.getUint16(3, true);
  const expected = 7 + count * 2;
  if (bytes.length !== expected) return null;
  const storedCrc = view.getUint16(expected - 2, true);
  if (storedCrc !== crc16Ccitt(bytes, expected - 2)) return null;

  const blocks = [];
  let offset = 5;
  for (let i = 0; i < count; i += 1) {
    const packed = view.getUint16(offset, true);
    offset += 2;
    blocks.push({
      x: packed & 0x0f,
      y: (packed >> 4) & 0x0f,
      z: (packed >> 8) & 0x0f,
      type: ((packed >> 12) & 0x01) ? 'support' : 'standard',
    });
  }
  return { gridSize, blocks };
}

function embedVoxelStateInBinaryStl(output, payload) {
  const view = new DataView(output.buffer, output.byteOffset, output.byteLength);
  const triangleCount = view.getUint32(80, true);
  const nibbleCount = payload.length * 2;
  const capacity = triangleCount * 3;
  if (nibbleCount > capacity) {
    throw new Error(`STL GEOMETRY IS TOO SIMPLE TO CARRY EDITABLE STATE (${payload.length} B > ${Math.floor(capacity / 2)} B CAPACITY)`);
  }

  // Store four payload bits in the least-significant four bits of each normal
  // float. Vertex coordinates and triangle topology are untouched, so slicers
  // receive exactly the same printable geometry. The normal perturbation is
  // only a few ULPs and is visually/geometrically negligible.
  for (let nibbleIndex = 0; nibbleIndex < nibbleCount; nibbleIndex += 1) {
    const byte = payload[Math.floor(nibbleIndex / 2)];
    const nibble = (nibbleIndex % 2 === 0) ? (byte & 0x0f) : ((byte >> 4) & 0x0f);
    const triangle = Math.floor(nibbleIndex / 3);
    const component = nibbleIndex % 3;
    const normalOffset = 84 + triangle * 50 + component * 4;
    const bits = view.getUint32(normalOffset, true);
    view.setUint32(normalOffset, (bits & 0xfffffff0) | nibble, true);
  }
}

function extractVoxelStateFromBinaryStl(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 84) return null;
  const bytes = new Uint8Array(buffer);
  const header = new TextDecoder().decode(bytes.subarray(0, 80)).replace(/\0/g, '').trim();
  const match = header.match(/BIL4:([A-Z0-9-]+):([0-9A-Z]+)/i);
  if (!match) return null;
  const payloadLength = Number.parseInt(match[2], 36);
  if (!Number.isFinite(payloadLength) || payloadLength < 7) return null;

  const view = new DataView(buffer);
  const triangleCount = view.getUint32(80, true);
  if (payloadLength * 2 > triangleCount * 3) return null;

  const payload = new Uint8Array(payloadLength);
  for (let nibbleIndex = 0; nibbleIndex < payloadLength * 2; nibbleIndex += 1) {
    const triangle = Math.floor(nibbleIndex / 3);
    const component = nibbleIndex % 3;
    const normalOffset = 84 + triangle * 50 + component * 4;
    const nibble = view.getUint32(normalOffset, true) & 0x0f;
    const byteIndex = Math.floor(nibbleIndex / 2);
    if (nibbleIndex % 2 === 0) payload[byteIndex] = nibble;
    else payload[byteIndex] |= nibble << 4;
  }
  return decodeBinaryVoxelState(payload);
}

function stampStandardBinaryStl(binaryStl, exportId = makeStlExportId(), voxelState = encodeBinaryVoxelState()) {
  const source = getBinaryStlBytes(binaryStl);
  if (source.byteLength < 84) throw new Error('STL EXPORT CONTAINS NO GEOMETRY DATA');

  const sourceView = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const triangleCount = sourceView.getUint32(80, true);
  const expectedLength = 84 + triangleCount * 50;
  if (triangleCount < 1 || source.byteLength < expectedLength) {
    throw new Error('STL EXPORT CONTAINS NO VALID TRIANGLE GEOMETRY');
  }

  // Strict standard binary STL: no trailing bytes, no non-standard attributes.
  // The editable voxel state is hidden only in insignificant normal-vector LSBs;
  // all vertex geometry remains byte-for-byte identical to the slicer export.
  const output = new Uint8Array(expectedLength);
  output.set(source.subarray(0, expectedLength));
  const payload = voxelState instanceof Uint8Array ? voxelState : encodeBinaryVoxelState();
  embedVoxelStateInBinaryStl(output, payload);

  output.fill(0, 0, 80);
  const headerText = new TextEncoder().encode(`BIL4:${exportId}:${payload.length.toString(36).toUpperCase()}`);
  output.set(headerText.subarray(0, 80), 0);
  return { buffer: output.buffer, exportId, triangleCount, embeddedStateBytes: payload.length };
}

function makeStaticBinaryStl(binaryStl) {
  const source = getBinaryStlBytes(binaryStl);
  if (source.byteLength < 84) throw new Error('STL EXPORT CONTAINS NO GEOMETRY DATA');
  const view = new DataView(source.buffer, source.byteOffset, source.byteLength);
  const triangleCount = view.getUint32(80, true);
  const expectedLength = 84 + triangleCount * 50;
  if (triangleCount < 1 || source.byteLength < expectedLength) {
    throw new Error('STL EXPORT CONTAINS NO VALID TRIANGLE GEOMETRY');
  }

  // Native project state deliberately does NOT travel inside exports anymore.
  // Keep a strict, conventional STL payload for slicers and downstream tools.
  const output = new Uint8Array(expectedLength);
  output.set(source.subarray(0, expectedLength));
  output.fill(0, 0, 80);
  const header = new TextEncoder().encode('BUILD IT LIVE / STATIC STL EXPORT');
  output.set(header.subarray(0, 80), 0);
  return { buffer: output.buffer, triangleCount };
}

function extractStlExportId(buffer) {
  const bytes = new Uint8Array(buffer, 0, Math.min(80, buffer.byteLength));
  const header = new TextDecoder().decode(bytes).replace(/\0/g, '').trim();
  const modern = header.match(/BIL4:([A-Z0-9-]+):/i);
  if (modern) return modern[1];
  const legacy = header.match(/DTWIN3:([A-Z0-9-]+)/i);
  return legacy?.[1] ?? null;
}

function decodeCompactStlMetadataFromBuffer(buffer) {
  const bytes = new Uint8Array(buffer);

  // Backwards compatibility only: older experimental builds appended state
  // after the binary STL payload. New exports never do this because some
  // slicers (including Bambu Studio) reject trailing bytes.
  const tailStart = Math.max(0, bytes.byteLength - 65536);
  const tailText = new TextDecoder().decode(bytes.subarray(tailStart));
  const trailerIndex = tailText.lastIndexOf(STL_TRAILER_PREFIX);
  if (trailerIndex >= 0) {
    const trailerText = tailText.slice(trailerIndex);
    const decoded = decodeCompactStlMetadata(trailerText);
    if (decoded?.blocks?.length) return decoded;
  }

  // Backwards compatibility for the previous ASCII solid-name metadata.
  const headText = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.byteLength, 16384)));
  return decodeCompactStlMetadata(headText) ?? decodeCompactStlMetadata(tailText);
}

function makeExactStlExportGroup({ yUp = false, metres = false } = {}) {
  if (!exactImportedStl?.rawGeometry) throw new Error('NO EXACT STL MESH LOADED');
  const geometry = exactImportedStl.rawGeometry.clone();
  if (metres) geometry.scale(0.001, 0.001, 0.001);
  const material = new THREE.MeshStandardMaterial({ color: COLORS.accent, roughness: 0.52, flatShading: true });
  const mesh = new THREE.Mesh(geometry, material);
  const group = new THREE.Group();
  group.name = 'ExactImportedStlExport';
  group.add(mesh);
  if (yUp) group.rotation.x = -Math.PI / 2;
  group.updateMatrixWorld(true);
  group.userData.disposeExportResources = () => {
    geometry.dispose();
    material.dispose();
  };
  return group;
}

function crc32Bytes(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function concatUint8Arrays(chunks) {
  const size = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function makeStoredZip(files) {
  const encoder = new TextEncoder();
  const localChunks = [];
  const centralChunks = [];
  let localOffset = 0;

  const u16 = (view, offset, value) => view.setUint16(offset, value, true);
  const u32 = (view, offset, value) => view.setUint32(offset, value >>> 0, true);

  for (const [name, content] of Object.entries(files)) {
    const nameBytes = encoder.encode(name);
    const data = content instanceof Uint8Array ? content : encoder.encode(String(content));
    const crc = crc32Bytes(data);

    const localHeader = new Uint8Array(30);
    const localView = new DataView(localHeader.buffer);
    u32(localView, 0, 0x04034b50);
    u16(localView, 4, 20);
    u16(localView, 6, 0);
    u16(localView, 8, 0); // stored / no compression
    u16(localView, 10, 0);
    u16(localView, 12, 0);
    u32(localView, 14, crc);
    u32(localView, 18, data.length);
    u32(localView, 22, data.length);
    u16(localView, 26, nameBytes.length);
    u16(localView, 28, 0);
    localChunks.push(localHeader, nameBytes, data);

    const centralHeader = new Uint8Array(46);
    const centralView = new DataView(centralHeader.buffer);
    u32(centralView, 0, 0x02014b50);
    u16(centralView, 4, 20);
    u16(centralView, 6, 20);
    u16(centralView, 8, 0);
    u16(centralView, 10, 0);
    u16(centralView, 12, 0);
    u16(centralView, 14, 0);
    u32(centralView, 16, crc);
    u32(centralView, 20, data.length);
    u32(centralView, 24, data.length);
    u16(centralView, 28, nameBytes.length);
    u16(centralView, 30, 0);
    u16(centralView, 32, 0);
    u16(centralView, 34, 0);
    u16(centralView, 36, 0);
    u32(centralView, 38, 0);
    u32(centralView, 42, localOffset);
    centralChunks.push(centralHeader, nameBytes);

    localOffset += localHeader.length + nameBytes.length + data.length;
  }

  const localData = concatUint8Arrays(localChunks);
  const centralData = concatUint8Arrays(centralChunks);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  u32(endView, 0, 0x06054b50);
  u16(endView, 4, 0);
  u16(endView, 6, 0);
  u16(endView, 8, Object.keys(files).length);
  u16(endView, 10, Object.keys(files).length);
  u32(endView, 12, centralData.length);
  u32(endView, 16, localData.length);
  u16(endView, 20, 0);

  return concatUint8Arrays([localData, centralData, end]);
}

function getThreeMfVoxelMesh(exportScale = 1) {
  const blocks = model.getBlocks().filter((block) => block.type === 'standard');
  if (!blocks.length) throw new Error('NO STANDARD BLOCKS TO EXPORT');
  const dimensions = workspaceBlockDimensionsMm(CONFIG.CELL_WIDTH, CONFIG.CELL_DEPTH, CONFIG.CELL_HEIGHT, CONFIG.PHYSICAL_BLOCK_MM);
  const surface = buildVoxelSurface(blocks, block => normalizeStandardBlockColor(block.color));
  const palette = [...new Set(surface.triangles.map(triangle => triangle.material))];
  const materialIndices = new Map(palette.map((color, index) => [color, index]));
  const vertices = surface.vertices.map(([x, y, z]) =>
    [x * dimensions.width * exportScale, y * dimensions.depth * exportScale, z * dimensions.height * exportScale]);
  const triangles = surface.triangles.map(triangle =>
    [triangle.a, triangle.b, triangle.c, materialIndices.get(triangle.material)]);
  return { vertices, triangles, palette };
}

function getThreeMfSmoothMesh(exportScale = CONFIG.PHYSICAL_BLOCK_MM) {
  const group = makeSmoothExportGroup(exportScale);
  try {
    const mesh = group.children.find((child) => child.isMesh);
    if (!mesh?.geometry) throw new Error('SMOOTH 3MF GEOMETRY IS UNAVAILABLE');
    const geometry = mesh.geometry;
    const position = geometry.getAttribute('position');
    if (!position) throw new Error('SMOOTH 3MF HAS NO VERTEX DATA');

    const vertices = [];
    for (let i = 0; i < position.count; i += 1) {
      vertices.push([position.getX(i), position.getY(i), position.getZ(i)]);
    }

    const palette = [...(geometry.userData.colorPalette ?? [])];
    if (!palette.length) palette.push(DEFAULT_BLOCK_COLOR);
    const triangleColors = geometry.userData.triangleColorIndices ?? [];
    const triangles = [];
    for (let i = 0, triangle = 0; i + 2 < position.count; i += 3, triangle += 1) {
      triangles.push([i, i + 1, i + 2, triangleColors[triangle] ?? 0]);
    }
    return { vertices, triangles, palette };
  } finally {
    disposeExportGroup(group);
  }
}

function makeThreeMfXml({ vertices, triangles, palette }) {
  const materials = palette.map((color, index) => (
    `<base name="Build It Live ${normalizeStandardBlockColor(color).toUpperCase()}" displaycolor="${normalizeStandardBlockColor(color).toUpperCase()}FF"/>`
  )).join('');
  const vertexXml = vertices.map(([x, y, z]) => `<vertex x="${Number(x).toFixed(5)}" y="${Number(y).toFixed(5)}" z="${Number(z).toFixed(5)}"/>`).join('');
  const triangleXml = triangles.map(([v1, v2, v3, material]) => (
    `<triangle v1="${v1}" v2="${v2}" v3="${v3}" pid="1" p1="${material}" p2="${material}" p3="${material}"/>`
  )).join('');

  return `<?xml version="1.0" encoding="UTF-8"?>\n<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n  <metadata name="Application">Build It Live</metadata>\n  <metadata name="Title">${exportSurfaceMode === 'soft1' ? 'Build It Live Smooth Multicolor' : 'Build It Live Blocks Multicolor'}</metadata>\n  <resources>\n    <basematerials id="1">${materials}</basematerials>\n    <object id="2" type="model" pid="1" pindex="0">\n      <mesh>\n        <vertices>${vertexXml}</vertices>\n        <triangles>${triangleXml}</triangles>\n      </mesh>\n    </object>\n  </resources>\n  <build><item objectid="2"/></build>\n</model>`;
}

function makeBambuThreeMfBlob() {
  if (exactImportedStl && !isApproximateBlockPreview()) throw new Error('MULTICOLOR 3MF NEEDS THE ORIGINAL EDITABLE BLOCK DATA / LOAD .BIL');
  const meshData = exportSurfaceMode === 'soft1'
    ? getThreeMfSmoothMesh(CONFIG.PHYSICAL_BLOCK_MM)
    : getThreeMfVoxelMesh(1);
  const modelXml = makeThreeMfXml(meshData);
  const contentTypes = `<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n</Types>`;
  const relationships = `<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n</Relationships>`;
  const archive = makeStoredZip({
    '[Content_Types].xml': contentTypes,
    '_rels/.rels': relationships,
    '3D/3dmodel.model': modelXml,
  });
  return new Blob([archive], { type: 'model/3mf' });
}

async function exportModel(format) {
  if(exportSurfaceMode==='soft1'&&realtimeSmoothTask)await realtimeSmoothTask;
  const normalizedFormat = String(format).toLowerCase();
  const exportFilename = makeDownloadFilename(normalizedFormat);

  if (normalizedFormat !== 'json' && model.getBlockCount() === 0 && !exactImportedStl) {
    throw new Error('ADD AT LEAST ONE BLOCK BEFORE EXPORTING 3D GEOMETRY');
  }

  if (normalizedFormat === 'json') {
    saveJsonModel();
    return 'EDITABLE JSON MODEL SAVED';
  }

  if (normalizedFormat === '3mf') {
    const blob = makeBambuThreeMfBlob();
    downloadBlob(blob, '3mf', { filename: exportFilename });
    const colorCount = new Set(model.getBlocks()
      .filter((block) => block.type === 'standard')
      .map((block) => normalizeStandardBlockColor(block.color))).size;
    return exportSurfaceMode === 'soft1'
      ? `3MF EXPORTED / BAMBU MULTICOLOR / ${String(colorCount).padStart(2, '0')} COLOR(S) / SMOOTH · ${String(smoothingStrength).padStart(2, '0')}`
      : `3MF EXPORTED / BAMBU MULTICOLOR / ${String(colorCount).padStart(2, '0')} COLOR(S) / BLOCKS`;
  }

  if (exactImportedStl && !isApproximateBlockPreview() && normalizedFormat === 'stl') {
    downloadBlob(new Blob([exactImportedStl.originalBuffer.slice(0)], { type: 'model/stl' }), 'stl', { filename: exportFilename });
    return 'STL SAVED / EXACT IMPORTED MESH PRESERVED';
  }

  if (exactImportedStl && !isApproximateBlockPreview() && normalizedFormat === 'obj') {
    const group = makeExactStlExportGroup();
    try {
      const obj = new OBJExporter().parse(group);
      downloadBlob(new Blob([obj], { type: 'text/plain' }), 'obj', { filename: exportFilename });
      return 'OBJ SAVED / EXACT STL SURFACE CONVERTED';
    } finally { disposeExportGroup(group); }
  }

  if (exactImportedStl && !isApproximateBlockPreview() && normalizedFormat === 'glb') {
    const group = makeExactStlExportGroup({ yUp: true, metres: true });
    try {
      const glb = await new Promise((resolve, reject) => {
        new GLTFExporter().parse(group, resolve, reject, { binary: true, onlyVisible: true });
      });
      downloadBlob(new Blob([glb], { type: 'model/gltf-binary' }), 'glb', { filename: exportFilename });
      return 'GLB SAVED / EXACT STL SURFACE CONVERTED';
    } finally { disposeExportGroup(group); }
  }

  if (normalizedFormat === 'stl') {
    const standardBlockCount = model.getBlocks().filter((block) => block.type !== 'support').length;
    if (standardBlockCount === 0) {
      throw new Error('NO STANDARD BLOCKS TO EXPORT / SUPPORT BLOCKS ARE OMITTED FROM STL');
    }

    const slicerGroup = exportSurfaceMode === 'voxel'
      ? makeSlicerExportGroup(1, { includeSupportFrames: false, respectColors: false })
      : makeSmoothExportGroup(CONFIG.PHYSICAL_BLOCK_MM);
    try {
      const binaryStl = new STLExporter().parse(slicerGroup, { binary: true });
      const restoredStl = embedEditableStateInStl(binaryStl, {
        gridWidth: model.gridWidth,
        gridDepth: model.gridDepth,
        blocks: cloneBlocks(),
        surfaceMode: exportSurfaceMode,
        smoothingStrength,
        smoothEdgeProfile,
      });
      // In complex cases editable state may exceed the space available in STL
      // normals. Keep printable geometry valid and clearly require .BIL then.
      const exported = restoredStl ?? makeStaticBinaryStl(binaryStl);
      await storeEditableStlExportSnapshot(exported.buffer);
      downloadBlob(new Blob([exported.buffer], { type: 'model/stl' }), 'stl', { filename: exportFilename });
      if (!restoredStl) return 'STL EXPORTED / SAVE .BIL FOR EXACT BLOCK RESTORATION';
      return restoredStl.colorsExact
        ? 'STL EXPORTED / BLOCK TYPES + COLORS RECOVERABLE'
        : 'STL EXPORTED / BLOCK TYPES RECOVERABLE / SAVE .BIL FOR EXACT COLORS';
    } finally {
      disposeExportGroup(slicerGroup);
    }
  }

  if (normalizedFormat === 'obj') {
    const slicerGroup = exportSurfaceMode === 'voxel'
      ? makeSlicerExportGroup(1)
      : makeSmoothExportGroup(CONFIG.PHYSICAL_BLOCK_MM);
    try {
      const obj = new OBJExporter().parse(slicerGroup);
      downloadBlob(new Blob([obj], { type: 'text/plain' }), 'obj', { filename: exportFilename });
      return exportSurfaceMode === 'voxel'
        ? 'OBJ SAVED / Z-UP / WORKSPACE BLOCKS'
        : `OBJ SAVED / SMOOTH · ${String(smoothingStrength).padStart(2, '0')} / STRAIGHT MEMBERS + SMOOTH JOINS`;
    } finally {
      disposeExportGroup(slicerGroup);
    }
  }

  if (normalizedFormat === 'glb') {
    // glTF uses metres (40 × 20 × 18.5 mm per workspace block).
    const group = exportSurfaceMode === 'voxel'
      ? makeGeometryExportGroup(0.001)
      : makeSmoothExportGroup(CONFIG.PHYSICAL_BLOCK_MM / 1000, { yUp: true });
    try {
      const glb = await new Promise((resolve, reject) => {
        new GLTFExporter().parse(
          group,
          resolve,
          reject,
          {
            binary: true,
            onlyVisible: true,
          },
        );
      });

      downloadBlob(new Blob([glb], { type: 'model/gltf-binary' }), 'glb', { filename: exportFilename });
      return exportSurfaceMode === 'voxel'
        ? 'GLB SAVED / MATERIALS + PHYSICAL SCALE'
        : `GLB SAVED / SMOOTH · ${String(smoothingStrength).padStart(2, '0')} / STRAIGHT MEMBERS + SMOOTH JOINS`;
    } finally {
      disposeExportGroup(group);
    }
  }

  throw new Error(`UNSUPPORTED EXPORT FORMAT: ${format}`);
}

// -----------------------------------------------------------------------------
// ORGANIC PRINT / REPRESENTATIVE LIVE JOIN PREVIEW
// -----------------------------------------------------------------------------
// This preview deliberately uses a small representative body-to-member junction
// instead of rebuilding the full current model on every slider tick. The result
// is immediate and makes the 01-05 local blend change legible without blocking
// the editor with a full implicit-surface export pass.
let smoothingPreviewRenderer = null;
let smoothingPreviewScene = null;
let smoothingPreviewCamera = null;
let smoothingPreviewMesh = null;
let smoothingPreviewControls = null;
let smoothingPreviewObserver = null;

function getOrganicStrengthLabel(strength) {
  return ['TIGHT', 'CLEAN', 'BALANCED', 'SOFT', 'ORGANIC'][THREE.MathUtils.clamp(strength, 1, 5) - 1];
}

function createOrganicJoinPreviewGeometry(strength) {
  const normalized = (THREE.MathUtils.clamp(strength, 1, 5) - 1) / 4;
  const bodyLeft = -1.55;
  const bodyRight = 0.42;
  const bodyHalfHeight = 1.08;
  const beamHalfWidth = 0.34;
  const beamEnd = 2.55;
  const blendLength = THREE.MathUtils.lerp(0.14, 0.78, normalized);
  const joinEnd = bodyRight + blendLength;
  const shoulderControl = bodyRight + blendLength * THREE.MathUtils.lerp(0.08, 0.4, normalized);

  const shape = new THREE.Shape();
  shape.moveTo(bodyLeft, -bodyHalfHeight);
  shape.lineTo(bodyRight, -bodyHalfHeight);
  shape.quadraticCurveTo(shoulderControl, -bodyHalfHeight, joinEnd, -beamHalfWidth);
  shape.lineTo(beamEnd, -beamHalfWidth);
  shape.lineTo(beamEnd, beamHalfWidth);
  shape.lineTo(joinEnd, beamHalfWidth);
  shape.quadraticCurveTo(shoulderControl, bodyHalfHeight, bodyRight, bodyHalfHeight);
  shape.lineTo(bodyLeft, bodyHalfHeight);
  shape.closePath();

  const geometry = new THREE.ExtrudeGeometry(shape, {
    depth: 0.82,
    steps: 1,
    bevelEnabled: false,
    curveSegments: 24,
  });
  geometry.center();
  geometry.computeVertexNormals();
  return geometry;
}

function resizeSmoothingPreview() {
  if (!smoothingPreviewRenderer || !smoothingPreviewMount || !smoothingPreviewCamera) return;
  const width = Math.max(1, Math.round(smoothingPreviewMount.clientWidth));
  const height = Math.max(1, Math.round(smoothingPreviewMount.clientHeight));
  if (width <= 1 || height <= 1) return;
  smoothingPreviewRenderer.setSize(width, height, false);
  smoothingPreviewCamera.aspect = width / height;
  smoothingPreviewCamera.updateProjectionMatrix();
  smoothingPreviewRenderer.render(smoothingPreviewScene, smoothingPreviewCamera);
}

function ensureSmoothingPreview() {
  if (smoothingPreviewRenderer || !smoothingPreviewMount) return;

  smoothingPreviewScene = new THREE.Scene();
  smoothingPreviewCamera = new THREE.PerspectiveCamera(30, 1, 0.1, 30);
  smoothingPreviewCamera.position.set(4.5, -5.1, 3.5);
  smoothingPreviewCamera.lookAt(0.35, 0, 0);

  smoothingPreviewRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  smoothingPreviewRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  smoothingPreviewRenderer.setClearColor(0x000000, 0);
  smoothingPreviewRenderer.outputColorSpace = THREE.SRGBColorSpace;
  smoothingPreviewMount.appendChild(smoothingPreviewRenderer.domElement);

  // Keep the preview genuinely inspectable: drag rotates, wheel/pinch zooms.
  // Pan stays disabled so the sample cannot be accidentally lost off-canvas.
  smoothingPreviewControls = new OrbitControls(smoothingPreviewCamera, smoothingPreviewRenderer.domElement);
  smoothingPreviewControls.enablePan = false;
  smoothingPreviewControls.enableDamping = false;
  smoothingPreviewControls.rotateSpeed = 0.7;
  smoothingPreviewControls.zoomSpeed = 0.85;
  smoothingPreviewControls.minDistance = 3.35;
  smoothingPreviewControls.maxDistance = 8.5;
  smoothingPreviewControls.minPolarAngle = 0.08;
  smoothingPreviewControls.maxPolarAngle = Math.PI - 0.08;
  smoothingPreviewControls.target.set(0.25, 0, 0);
  smoothingPreviewControls.update();
  smoothingPreviewControls.addEventListener('change', () => {
    if (smoothingPreviewRenderer && smoothingPreviewScene && smoothingPreviewCamera) {
      smoothingPreviewRenderer.render(smoothingPreviewScene, smoothingPreviewCamera);
    }
  });

  smoothingPreviewScene.add(new THREE.HemisphereLight(0xffffff, 0x8f8b82, 2.25));
  const key = new THREE.DirectionalLight(0xffffff, 3.2);
  key.position.set(4, -3, 6);
  smoothingPreviewScene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 1.35);
  fill.position.set(-4, 4, 2);
  smoothingPreviewScene.add(fill);

  smoothingPreviewMount.addEventListener('keydown', (event) => {
    if (!smoothingPreviewCamera || !smoothingPreviewControls) return;
    const key = event.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '_'].includes(key)) return;
    event.preventDefault();

    const offset = smoothingPreviewCamera.position.clone().sub(smoothingPreviewControls.target);
    const spherical = new THREE.Spherical().setFromVector3(offset);
    const rotateStep = THREE.MathUtils.degToRad(8);
    if (key === 'ArrowLeft') spherical.theta -= rotateStep;
    if (key === 'ArrowRight') spherical.theta += rotateStep;
    if (key === 'ArrowUp') spherical.phi = Math.max(0.08, spherical.phi - rotateStep);
    if (key === 'ArrowDown') spherical.phi = Math.min(Math.PI - 0.08, spherical.phi + rotateStep);
    if (key === '+' || key === '=') spherical.radius = Math.max(3.35, spherical.radius * 0.9);
    if (key === '-' || key === '_') spherical.radius = Math.min(8.5, spherical.radius * 1.1);

    smoothingPreviewCamera.position.copy(new THREE.Vector3().setFromSpherical(spherical).add(smoothingPreviewControls.target));
    smoothingPreviewCamera.lookAt(smoothingPreviewControls.target);
    smoothingPreviewControls.update();
  });

  if (typeof ResizeObserver !== 'undefined') {
    smoothingPreviewObserver = new ResizeObserver(() => resizeSmoothingPreview());
    smoothingPreviewObserver.observe(smoothingPreviewMount);
  }
}

function renderSmoothingPreview() {
  if (!smoothingPreviewMount || exportSurfaceMode !== 'soft1' || saveModal.hidden) return;
  ensureSmoothingPreview();
  if (!smoothingPreviewRenderer || !smoothingPreviewScene) return;

  if (smoothingPreviewMesh) {
    smoothingPreviewScene.remove(smoothingPreviewMesh);
    smoothingPreviewMesh.geometry.dispose();
    smoothingPreviewMesh.material.dispose();
  }

  const geometry = createOrganicJoinPreviewGeometry(smoothingStrength);
  const material = new THREE.MeshStandardMaterial({
    color: COLORS.accent,
    roughness: 0.58,
    metalness: 0,
  });
  smoothingPreviewMesh = new THREE.Mesh(geometry, material);
  smoothingPreviewMesh.rotation.x = -0.08;
  smoothingPreviewMesh.rotation.z = -0.08;
  smoothingPreviewScene.add(smoothingPreviewMesh);

  if (smoothingPreviewLabel) {
    smoothingPreviewLabel.textContent = `${String(smoothingStrength).padStart(2, '0')} / ${getOrganicStrengthLabel(smoothingStrength)}`;
  }
  resizeSmoothingPreview();
}

function updateSmoothEdgeProfileUi({ rebuild = true, persist = false } = {}) {
  for (const button of smoothEdgeProfileButtons) {
    const active = button.dataset.smoothEdgeProfile === smoothEdgeProfile;
    button.classList.toggle('is-active',active);
    button.setAttribute('aria-pressed',String(active));
  }
  if(smoothEdgeProfileHint) smoothEdgeProfileHint.textContent=smoothEdgeProfile==='rounded'
    ? 'Curved layer joins + rounded support rims. Exports use this geometry.'
    : 'Original smooth geometry. Sharp level changes are preserved.';
  if(persist){
    // Style changes are non-destructive but must survive refresh / Recent Models.
    rememberSurfaceView();
    const autosave=safeStorageRead(AUTOSAVE_STORAGE_KEY,null);
    if(autosave && String(autosave.modelId??'')===String(activeRecentModelId??''))
      safeStorageWrite(AUTOSAVE_STORAGE_KEY,{...autosave,smoothEdgeProfile});
    if(activeRecentModelId){
      const recents=readRecentModels(),index=recents.findIndex(e=>String(e.id)===String(activeRecentModelId));
      if(index>=0){recents[index]={...recents[index],smoothEdgeProfile};safeStorageWrite(RECENT_MODELS_STORAGE_KEY,recents);}
    }
  }
  if(rebuild){scheduleRealtimeOrganicSurface({immediate:true});if(!saveModal.hidden)updateExportSummary();}
}
function setSmoothEdgeProfile(next) {
  if(next!=='classic'&&next!=='rounded')return;
  if(smoothEdgeProfile===next)return;
  smoothEdgeProfile=next;
  updateSmoothEdgeProfileUi({persist:true});
  setFeedback(next==='rounded'?'ROUNDED SMOOTH':'CLASSIC SMOOTH',
    next==='rounded'?'Real 3D fillets soften step joints and interior corners; original openings remain protected.':'Original smooth silhouette is active.');
}

function updateSmoothingStrengthUi(nextValue = smoothingStrength) {
  smoothingStrength = THREE.MathUtils.clamp(Math.round(Number(nextValue) || 3), 1, 5);

  for (const slider of [smoothingStrengthSlider, realtimeSmoothingSlider]) {
    if (!slider) continue;
    slider.value = String(smoothingStrength);
    slider.classList.toggle('is-active', exportSurfaceMode === 'soft1');
    setRangeProgress(slider);
  }

  if (smoothingStrengthValue) smoothingStrengthValue.textContent = String(smoothingStrength).padStart(2, '0');
  if (realtimeSmoothingValue) realtimeSmoothingValue.textContent = String(smoothingStrength).padStart(2, '0');
  updateSmoothEdgeProfileUi({rebuild:false});
  renderSmoothingPreview();
  scheduleRealtimeOrganicSurface();
}

function updateOrganicEditingLocks() {
  const organicLocked = exportSurfaceMode === 'soft1';
  const layerLocked = activeLayerView !== null;
  const layerEditButton=document.querySelector('#editLayerToggle');
  if(layerEditButton){layerEditButton.hidden=IS_HARDWARE_BUILDER||!layerLocked;const hint=document.querySelector('#layerEditHint');if(hint)hint.hidden=IS_HARDWARE_BUILDER||!layerLocked;layerEditButton.disabled=!layerLocked||IS_HARDWARE_BUILDER||Boolean(exactImportedStl)||exportSurfaceMode==='soft1';layerEditButton.setAttribute('aria-pressed',String(layerEditEnabled));layerEditButton.textContent=`LAYER ${layerLocked?String(activeLayerView+1).padStart(2,'0'):''} / EDIT ${layerEditEnabled?'ON':'OFF'}`;}
  const sensorLocked = serialConnected || simulationActive;
  const meshLocked = Boolean(exactImportedStl);
  const editingLocked = organicLocked || (layerLocked && !layerEditEnabled) || sensorLocked || meshLocked;
  document.querySelector('#app')?.classList.toggle('simulation-editing-locked', sensorLocked);

  if (organicLocked || layerLocked || (!IS_HARDWARE_BUILDER && sensorLocked)) setBlockColorPopoverOpen(false);
  if ((layerLocked || sensorLocked) && gridSettingsIsOpen) setGridSettingsOpen(false);
  if (editingLocked && continuousBuildEnabled) setContinuousBuildEnabled(false);

  for (const button of toolButtons) {
    const allowedColorTrigger = IS_HARDWARE_BUILDER && button === standardToolButton;
    button.disabled = !allowedColorTrigger && editingLocked;
    button.setAttribute('aria-disabled', String(button.disabled));
    button.title = sensorLocked
      ? 'Use the Simulator / Hardware menu while sensor input is active'
      : meshLocked
      ? 'Original STL mesh has no editable block data. Load .BIL.'
      : layerLocked
      ? 'Return Layer View to ALL to edit blocks'
      : organicLocked
        ? 'Smooth view is inspection-only. Switch to Blocks to edit.'
        : '';
  }

  continuousToggle.disabled = editingLocked || layerLocked;

  // Smooth view cannot use Layer View at all. In Layer View itself, these
  // controls stay active so the child can inspect another layer or return ALL.
  layerSlider.disabled = organicLocked || meshLocked || (sensorLocked && !IS_HARDWARE_BUILDER);
  showAllLayersButton.disabled = organicLocked || meshLocked || (sensorLocked && !IS_HARDWARE_BUILDER);
  // A hardware session owns block placement, NOT the presentation of the live
  // model: Blocks, Smooth and its strength slider remain available on ESP32.
  for (const button of realtimeSurfaceButtons) button.disabled = sensorLocked && !IS_HARDWARE_BUILDER;
  if (realtimeSmoothingSlider) realtimeSmoothingSlider.disabled = sensorLocked && !IS_HARDWARE_BUILDER;

  // Layer View is a read-only inspection state. Prevent controls that alter
  // the current build, but keep Save / Export / camera navigation available.
  clearBuildButton.disabled = layerLocked || sensorLocked;
  loadBuildButton.disabled = layerLocked || sensorLocked;
  openRecentModelsButton.disabled = layerLocked || sensorLocked;
  if (openGridSettingsButton) {
    openGridSettingsButton.disabled = layerLocked || sensorLocked;
    openGridSettingsButton.setAttribute('aria-disabled', String(layerLocked || sensorLocked));
    openGridSettingsButton.title = sensorLocked ? 'Change dimensions in Hardware Settings while a session is active'
      : layerLocked ? 'Return Layer View to ALL to change build area size' : 'Grid settings';
  }

  document.querySelector('.tool-stack')?.classList.toggle('is-organic-locked', editingLocked);
  document.querySelector('.continuous-controls')?.classList.toggle('is-organic-locked', editingLocked);
  document.querySelector('.layer-controls')?.classList.toggle('is-organic-locked', organicLocked);
  document.querySelector('.stats-panel')?.classList.toggle('is-layer-locked', layerLocked);
  clearBuildButton.closest('.panel-actions')?.classList.toggle('is-layer-locked', layerLocked);
  loadBuildButton.closest('.project-file-actions')?.classList.toggle('is-layer-locked', layerLocked);
  document.querySelector('.autosave-controls')?.classList.toggle('is-layer-locked', layerLocked);

  if (freeMoveButton) {
    freeMoveButton.disabled = false;
    freeMoveButton.title = editingLocked
      ? sensorLocked ? 'Camera movement remains available while the ESP32 controls the model.' : layerLocked
        ? 'Layer View is inspection-only. Drag to orbit the model.'
        : 'Smooth view is inspection-only. Drag to orbit the model.'
      : 'Camera-only mode. Drag to orbit without placing or erasing blocks.';
  }
}

function setExportSurfaceMode(mode, { rebuild = true, remember = true } = {}) {
  if(!IS_HARDWARE_BUILDER&&getMissingLayerSupportCells().length){pulseLayerRepair();return;}
  const next = ['voxel', 'soft1'].includes(mode) ? mode : 'voxel';
  // The Hardware Builder can switch between Blocks and Smooth while live
  // sensor events continue to update the same underlying VoxelModel.
  if (!IS_HARDWARE_BUILDER && (serialConnected || simulationActive) && next !== exportSurfaceMode) {
    setFeedback('SENSOR INPUT ACTIVE', 'The current session controls the editable grid.', true);
    return;
  }
  const previous = exportSurfaceMode;

  if (next === 'soft1' && previous !== 'soft1') {
    freeMoveBeforeOrganic = selectedTool === 'free';
    if (continuousBuildEnabled) setContinuousBuildEnabled(false);
    if (activeLayerView !== null) setLayerView(0);
  }

  if(next==='soft1'&&colorTransferMode!=='off')setColorTransferMode('off',{announce:false});
  exportSurfaceMode = next;
  if (remember && previous !== next) rememberSurfaceView();

  for (const button of exportSurfaceButtons) {
    const active = button.dataset.exportSurface === next;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }
  for (const button of realtimeSurfaceButtons) {
    const active = button.dataset.liveSurface === next;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  }

  if (next === 'soft1') {
    selectTool('free', { announce: false });
  } else if (previous === 'soft1') {
    if (freeMoveBeforeOrganic) selectTool('free', { announce: false });
    else selectTool(lastBuildTool, { announce: false });
  }

  if (smoothingStrengthControl) smoothingStrengthControl.hidden = next !== 'soft1';
  // Keep the inspector's smoothing controls mounted during the closing phase.
  // Switching modes no longer causes the inspector to jump in height.
  if (realtimeSmoothingControls) {
    const controlsEl = realtimeSmoothingControls;
    window.clearTimeout(realtimeSmoothingCloseTimer);
    if (next === 'soft1') {
      controlsEl.hidden = false;
      controlsEl.setAttribute('aria-hidden', 'false');
      window.requestAnimationFrame(() => controlsEl.classList.add('is-revealed'));
    } else {
      controlsEl.classList.remove('is-revealed');
      controlsEl.setAttribute('aria-hidden', 'true');
      // Keep inputs out of keyboard navigation during the fade out.
      const slider = controlsEl.querySelector('input');
      if (slider) slider.blur();
      realtimeSmoothingCloseTimer = window.setTimeout(() => {
        if (!controlsEl.classList.contains('is-revealed')) controlsEl.hidden = true;
      }, 340);
    }
  }
  if (previous !== next) {
    // A brief translucent scene treatment connects the change of 3D surface
    // without ever intercepting pointer / camera interactions.
    const sceneEl = document.querySelector('.studio-scene');
    if (sceneEl && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      sceneEl.classList.remove('surface-changing');
      void sceneEl.offsetWidth;
      sceneEl.classList.add('surface-changing');
      window.clearTimeout(realtimeSurfaceTransitionTimer);
      realtimeSurfaceTransitionTimer = window.setTimeout(() => sceneEl.classList.remove('surface-changing'), 500);
    }
  }
  saveModal.classList.remove('has-organic-preview');

  if (exportModelViewValue) {
    exportModelViewValue.textContent = exactImportedStl
      ? (isImportedGridReferenceView() ? 'MESH / GRID' : 'ORIGINAL STL')
      : next === 'soft1' ? 'SMOOTH' : 'BLOCKS';
  }

  if (!saveModal.hidden) {updateExportSummary();updatePrintabilityReport();}
  if (exactImportedStl) {
    syncViewFromModel();
    if (previous !== next) setFeedback(
      isImportedGridReferenceView() ? 'MESH GRID / REFERENCE' : 'ORIGINAL STL',
      isImportedGridReferenceView() ? 'Original shape kept. Blocks not saved in STL.' : 'Original smooth mesh restored.',
    );
  }
  updateOrganicEditingLocks();
  updateSmoothingStrengthUi(smoothingStrength);
  applyRealtimeSurfaceVisibility();
  if (rebuild) scheduleRealtimeOrganicSurface({ immediate: next === 'soft1' });
  refreshMeasurementBounds();
}

function updatePrintabilityReport() {
  if (!printabilityStatus) return;
  const isMeshInspection = Boolean(exactImportedStl?.rawGeometry);
  const report = exactImportedStl?.rawGeometry
    ? analyzeTriangleGeometry(exactImportedStl.rawGeometry.getAttribute('position').array)
    : analyzeBlockPrintability(model.getBlocks(), exportSurfaceMode);
  // Keep the user's expanded/collapsed preference when a report is refreshed.
  const previousDetails = printabilityStatus.querySelector('details');
  const showDetails = previousDetails ? previousDetails.open : false;
  const warningCount = report.issues.filter(issue => issue.severity === 'warning').length;
  const errorCount = report.issues.filter(issue => issue.severity === 'error').length;
  const noteCount = report.issues.filter(issue => issue.severity === 'info').length;
  const attentionCount = warningCount + errorCount;
  const statusText = report.status === 'ready' ? 'NO BASIC ISSUES' : report.status === 'invalid' ? 'NOT PRINTABLE' : 'REVIEW BEFORE PRINTING';
  const sourceValue = isMeshInspection
    ? (Math.floor(Number(exactImportedStl?.rawGeometry?.getAttribute('position').count || 0) / 3)).toLocaleString()
    : String(report.standardCount);
  const sourceLabel = isMeshInspection ? 'TRIANGLES' : 'STANDARD BLOCKS';
  printabilityStatus.dataset.status = report.status;
  printabilityStatus.innerHTML = `<details class="printability-report__details" ${showDetails ? 'open' : ''}>
    <summary class="printability-report__compact-summary">
      <span class="printability-report__compact-title">PRINTABILITY <i>CHECK</i></span>
      <span class="printability-report__compact-status" role="status">${statusText}<small>${attentionCount} ALERT${attentionCount === 1 ? '' : 'S'}</small></span>
      <span class="printability-report__chevron" aria-hidden="true"></span>
    </summary>
    <div class="printability-report__body">
    <div class="printability-report__compact-toolbar"><span>${sourceValue} ${sourceLabel} / ${warningCount + errorCount} WARNINGS / ${noteCount} NOTES</span><button type="button" class="printability-refresh" data-preflight-action="refresh" aria-label="Run printability check again">RECHECK ↻</button></div>
    <div class="printability-report__findings">
      ${report.issues.map((issue, index)=>`<article class="printability-report__issue is-${issue.severity}">
        <span class="printability-report__issue-number">${String(index+1).padStart(2,'0')}</span>
        <div class="printability-report__issue-body"><div class="printability-report__issue-top"><b>${escapeHtml(issue.title)}</b><span class="printability-report__severity">${issue.severity === 'info' ? 'NOTE' : issue.severity === 'error' ? 'ERROR' : 'REVIEW'}</span></div><p>${escapeHtml(issue.detail)}</p>${["OVERHANGS TO REVIEW","SEPARATE PARTS","TEMPORARY SUPPORTS"].includes(issue.title) && !isMeshInspection ? `<button type="button" data-studio-warning="${escapeHtml(issue.title)}">SHOW IN MODEL ↗</button>` : ""}</div>
      </article>`).join('')}
    </div>
  <div class="printability-report__footnote"><span aria-hidden="true">↗</span><p>Advisory only. Check the sliced model in Bambu Studio before printing.</p></div>
    </div>
  </details>`;
}

const printabilityMotion = new WeakMap();

printabilityStatus?.addEventListener('click', (event) => {
  const warningButton = event.target.closest('[data-studio-warning]');
  if (warningButton) { closeSaveModal(); studioTools.showIssue(warningButton.dataset.studioWarning); return; }
  const summary = event.target.closest('summary.printability-report__compact-summary');
  if (summary) {
    event.preventDefault();
    const details = summary.parentElement;
    const body = details.querySelector('.printability-report__body');
    if (!body) return;
    const previous = printabilityMotion.get(details);
    const expand = !(previous ? previous.expand : details.open);
    const fromHeight = details.open ? body.getBoundingClientRect().height : 0;
    const fromOpacity = details.open ? Number(getComputedStyle(body).opacity) : 0;
    previous?.animation.cancel();
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      details.open = expand;
      body.style.overflow = '';
      printabilityMotion.delete(details);
      return;
    }
    details.open = true;
    void body.offsetHeight; // Commit native details visibility before starting motion.
    body.style.overflow = 'hidden';
    const animation = body.animate([
      { height: `${fromHeight}px`, opacity: fromOpacity },
      { height: `${expand ? body.scrollHeight : 0}px`, opacity: expand ? 1 : 0 },
    ], { duration: 420, easing: 'cubic-bezier(.22,.75,.25,1)', fill: 'both' });
    const motion = { expand, animation };
    printabilityMotion.set(details, motion);
    animation.onfinish = () => {
      if (printabilityMotion.get(details) !== motion) return;
      details.open = expand;
      animation.cancel();
      body.style.overflow = '';
      printabilityMotion.delete(details);
    };
    return;
  }
  if (event.target.closest('[data-preflight-action="refresh"]')) updatePrintabilityReport();
});

let exportCloseTimer=null;
function updateExportSummary(){
 const name=document.querySelector('#exportProjectName'),filename=document.querySelector('#exportFilenamePreview'),counts=document.querySelector('#exportIncludedBlocks');
 if(name)name.textContent=getCurrentModelName();
 if(filename)filename.textContent=makeDownloadFilename('stl').replace(/\.stl$/i,'')+' · .STL / .GLB / .OBJ / .3MF';
 if(counts){const blocks=model.getBlocks(),support=blocks.filter(b=>b.type==='support').length;counts.textContent=exactImportedStl?'Imported mesh geometry · original source retained':`${blocks.length-support} Standard included · ${support} Support excluded`;}
}

function openSaveModal(sourceElement = exportBuildButton) {
  window.clearTimeout(exportCloseTimer);
  updateExportSummary();
  saveModal.hidden = false;
  prepareModalSourceMorph(saveModal, sourceElement);
  document.body.classList.add('modal-open');
  controls.enabled = false;

  if (exportModelViewValue) {
    exportModelViewValue.textContent = exactImportedStl
      ? (isImportedGridReferenceView() ? 'MESH / GRID' : 'ORIGINAL STL')
      : exportSurfaceMode === 'soft1' ? 'SMOOTH' : 'BLOCKS';
  }

  updatePrintabilityReport();

  // Measure the compact dialog once per opening; disclosures scroll inside it.
  const exportPanel = saveModal.querySelector('.save-modal__panel');
  const exportScroll = saveModal.querySelector('.save-modal__scroll');
  const exportDetails = printabilityStatus?.querySelector('details');
  const wasExpanded = Boolean(exportDetails?.open);
  if (exportDetails) exportDetails.open = false;
  if (exportPanel) {
    exportPanel.style.height = '';
    const compactHeight = exportPanel.offsetHeight;
    exportPanel.style.height = `${compactHeight}px`;
  }
  if (exportDetails) exportDetails.open = wasExpanded;
  if (exportScroll) exportScroll.scrollTop = 0;

  // Prevent accidental geometry exports from an empty build while still
  // allowing an empty JSON state to be saved if needed.
  for (const button of exportFormatButtons) {
    const format = button.dataset.exportFormat;
    const is3D = format !== 'json';
    button.disabled = exactImportedStl && !isApproximateBlockPreview()
      ? ['json', '3mf'].includes(format)
      : (is3D && model.getBlockCount() === 0);
  }

  requestAnimationFrame(() => {
    saveModal.classList.add('is-open');
    exportFormatButtons.find((button) => !button.disabled)?.focus();
  });
}

function closeSaveModal() {
  prepareModalSourceMorph(saveModal, exportBuildButton);
  saveModal.classList.remove('is-open');
  document.body.classList.remove('modal-open');
  controls.enabled = true;
  window.clearTimeout(exportCloseTimer);
  exportCloseTimer=window.setTimeout(() => {
    saveModal.hidden = true;
  }, 560);
}

function openLoadModal(sourceElement = loadBuildButton) {
  if (serialConnected || simulationActive) {
    setFeedback('SENSOR INPUT ACTIVE', 'Exit the sensor session before loading another model.', true);
    return;
  }
  if (activeLayerView !== null) {
    setFeedback('LAYER VIEW ONLY', 'Return to ALL layers before loading another project.', true);
    return;
  }
  loadModal.hidden = false;
  prepareModalSourceMorph(loadModal, sourceElement);
  document.body.classList.add('modal-open');
  controls.enabled = false;

  // Keep the hidden input ready to accept every format until the user
  // deliberately chooses one of the format cards below.
  loadBuildInput.accept = '.bil,.json,.stl,.glb,.obj';

  requestAnimationFrame(() => {
    loadModal.classList.add('is-open');
    loadFormatButtons[0]?.focus();
  });
}

function closeLoadModal() {
  prepareModalSourceMorph(loadModal, loadBuildButton);
  loadModal.classList.remove('is-open');
  document.body.classList.remove('modal-open');
  controls.enabled = true;
  window.setTimeout(() => {
    loadModal.hidden = true;
  }, 560);
}

function chooseLoadFormat(format = '') {
  const normalized = String(format).toLowerCase();
  const supported = ['bil', 'json', 'stl', 'glb', 'obj'];
  loadBuildInput.accept = supported.includes(normalized)
    ? `.${normalized}`
    : '.bil,.json,.stl,.glb,.obj';
  loadBuildInput.value = '';
  // Invoke directly from the user's click/keyboard gesture. Avoid a hidden
  // input in the scrolling Workbench: Safari can refuse that picker location.
  try {
    if (typeof loadBuildInput.showPicker === 'function') loadBuildInput.showPicker();
    else loadBuildInput.click();
  } catch {
    // Older Safari versions implement only the click-based file picker.
    loadBuildInput.click();
  }
}

function isSupportedLoadFile(file) {
  const extension = file?.name?.split('.').pop()?.toLowerCase();
  return ['bil', 'json', 'stl', 'glb', 'obj'].includes(extension);
}

function extractLegacyBlockArray(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return null;

  const candidates = [
    data.blocks,
    data.voxels,
    data.cells,
    data.model?.blocks,
    data.model?.voxels,
    data.state?.blocks,
    data.state?.voxels,
    data.snapshot?.blocks,
    data.data?.blocks,
  ];

  return candidates.find(Array.isArray) ?? null;
}

function getLegacyGridSize(data, blocks = []) {
  if (!data || typeof data !== 'object') {
    return clampGridSize(getRequiredGridSize(blocks));
  }

  const candidates = [
    data?.workspace?.gridSize,
    data?.simulator?.gridSize,
    data?.gridSize,
    data?.settings?.gridSize,
    data?.state?.gridSize,
    data?.model?.gridSize,
    typeof data?.grid === 'number' ? data.grid : null,
    data?.grid?.size,
  ];
  const explicit = candidates.map(Number).find(Number.isFinite);
  // Files old enough to omit grid size came from the original fixed 16×16
  // simulator, so preserve that historical base instead of shrinking to the
  // smallest footprint that happens to contain the blocks.
  return clampGridSize(explicit ?? CONFIG.GRID_SIZE);
}

function normalizeLoadedModel(data) {
  // Backward compatibility: every historical Build It Live JSON variant that
  // contains a block array is accepted, even if it predates the format/version
  // wrapper or used `voxels`, `cells`, `model.blocks`, etc.
  const blocks = extractLegacyBlockArray(data);
  if (!blocks) {
    if (!data || typeof data !== 'object') throw new Error('INVALID MODEL FILE');
    throw new Error('MODEL FILE HAS NO BLOCK ARRAY');
  }

  // Future explicit versions are rejected only when they use our canonical
  // format. Missing/older wrappers are treated as legacy files and migrated.
  if (
    data && !Array.isArray(data) &&
    data.format === MODEL_FILE_FORMAT &&
    Number.isFinite(Number(data.version)) &&
    Number(data.version) > MODEL_FILE_VERSION
  ) {
    throw new Error(`UNSUPPORTED FILE VERSION ${data.version}`);
  }

  return blocks;
}

function parseBlockName(name = '') {
  const text = String(name).trim();
  const match = text.match(/(?:^|\b)(standard(?:cube)?|support(?:cube)?)[_\- ]+(\d+)[_\- ]+(\d+)[_\- ]+(\d+)/i);
  if (!match) return null;

  return {
    type: match[1].toLowerCase().startsWith('support') ? 'support' : 'standard',
    x: Number(match[2]),
    y: Number(match[3]),
    z: Number(match[4]),
  };
}

function normalizeLegacyBlockType(value) {
  if (typeof value === 'number') {
    if (value === 2) return 'support';
    if (value === 1 || value === 0) return 'standard';
  }

  const text = String(value ?? '').trim().toLowerCase().replace(/[ _-]+/g, '');
  if (['support', 'supportcube', 'frame', 'supportframe', 'scaffold'].includes(text)) return 'support';
  if (['standard', 'standardcube', 'cube', 'block', 'solid', 'normal', 'voxel'].includes(text)) return 'standard';
  return null;
}

function normalizeImportedBlock(block) {
  if (!block || typeof block !== 'object') return null;

  const type = normalizeLegacyBlockType(
    block.type ?? block.blockType ?? block.kind ?? block.material ?? block.block ?? block.value,
  );
  const position = block.position ?? block.pos ?? block.coords ?? block.coordinate ?? block.gridPosition ?? {};
  const x = Number(block.x ?? block.gridX ?? block.ix ?? position.x ?? position[0]);
  const y = Number(block.y ?? block.gridY ?? block.iy ?? position.y ?? position[1]);
  const z = Number(block.z ?? block.gridZ ?? block.iz ?? position.z ?? position[2]);

  if (!type) return null;
  if (![x, y, z].every(Number.isFinite)) return null;

  const color = type === 'standard' ? normalizeStandardBlockColor(block.color, null) : null;
  return {
    type,
    x: Math.round(x),
    y: Math.round(y),
    z: Math.round(z),
    ...(color ? { color } : {}),
  };
}

function dedupeImportedBlocks(blocks = []) {
  const byCell = new Map();

  for (const rawBlock of blocks) {
    const block = normalizeImportedBlock(rawBlock);
    if (!block) continue;

    const key = `${block.x},${block.y},${block.z}`;
    const previous = byCell.get(key);

    // If duplicate semantic metadata targets the same cell, a solid Standard
    // Cube wins over Support metadata.
    if (!previous || block.type === 'standard') {
      byCell.set(key, block);
    }
  }

  return [...byCell.values()].sort((a, b) => a.z - b.z || a.y - b.y || a.x - b.x);
}

async function loadBilProject(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || data.format !== PROJECT_FILE_FORMAT) {
    throw new Error('NOT A BUILD IT LIVE .BIL PROJECT');
  }
  if (Number.isFinite(Number(data.version)) && Number(data.version) > PROJECT_FILE_VERSION) {
    throw new Error(`UNSUPPORTED PROJECT VERSION ${data.version}`);
  }

  const blocks = dedupeImportedBlocks(extractLegacyBlockArray(data) ?? []);
  const cameraPosition = Array.isArray(data?.camera?.position) && data.camera.position.length >= 3
    ? data.camera.position.slice(0, 3).map(Number)
    : null;
  const cameraTarget = Array.isArray(data?.camera?.target) && data.camera.target.length >= 3
    ? data.camera.target.slice(0, 3).map(Number)
    : null;

  return {
    blocks,
    gridSize: getLegacyGridSize(data, blocks),
    gridWidth: data?.workspace?.gridWidth,
    gridDepth: data?.workspace?.gridDepth,
    projectName: typeof data?.project?.name === 'string' ? data.project.name.trim().slice(0, 72) : '',
    exactState: true,
    note: 'NATIVE .BIL PROJECT RESTORED / EDITABLE STATE PRESERVED',
    projectState: {
      surfaceMode: ['voxel', 'soft1'].includes(data?.render?.surfaceMode) ? data.render.surfaceMode : 'voxel',
      smoothingStrength: THREE.MathUtils.clamp(Math.round(Number(data?.render?.smoothingStrength) || 3), 1, 5),
      smoothEdgeProfile: data?.render?.smoothEdgeProfile === 'rounded' ? 'rounded' : 'classic',
      layerView: THREE.MathUtils.clamp(Math.round(Number(data?.render?.layerView) || 0), 0, CONFIG.MAX_HEIGHT),
      cameraPosition: cameraPosition?.every(Number.isFinite) ? cameraPosition : null,
      cameraTarget: cameraTarget?.every(Number.isFinite) ? cameraTarget : null,
      selectedBlockColor: normalizeStandardBlockColor(data?.workspace?.selectedBlockColor),
    },
  };
}

async function loadJsonBlocks(file) {
  const text = await file.text();
  const data = JSON.parse(text);
  const blocks = dedupeImportedBlocks(normalizeLoadedModel(data));
  if (blocks.length === 0 && extractLegacyBlockArray(data)?.length) {
    throw new Error('LEGACY MODEL BLOCK DATA COULD NOT BE MIGRATED');
  }
  const isCanonical = !Array.isArray(data) && data?.format === MODEL_FILE_FORMAT;
  return {
    blocks,
    gridSize: getLegacyGridSize(data, blocks),
    note: isCanonical ? 'EDITABLE JSON STATE RESTORED' : 'LEGACY JSON MODEL MIGRATED + RESTORED',
    exactState: true,
  };
}

async function loadGlbBlocks(file) {
  const buffer = await file.arrayBuffer();
  const gltf = await new Promise((resolve, reject) => {
    new GLTFLoader().parse(buffer, '', resolve, reject);
  });

  const blocks = [];
  let embeddedGridSize = null;
  let hasEmbeddedState = false;
  gltf.scene.updateMatrixWorld(true);

  gltf.scene.traverse((object) => {
    if (Array.isArray(object.userData?.digitalTwinBlocks)) {
      blocks.push(...object.userData.digitalTwinBlocks);
      hasEmbeddedState = true;
      embeddedGridSize = embeddedGridSize ?? (Number(object.userData.digitalTwinGridSize) || null);
    }

    const userBlock = normalizeImportedBlock(object.userData);
    if (userBlock) {
      blocks.push(userBlock);
      return;
    }

    const namedBlock = parseBlockName(object.name);
    if (namedBlock) blocks.push(namedBlock);
  });

  const result = dedupeImportedBlocks(blocks);
  if (result.length === 0) {
    throw new Error('NO DIGITAL TWIN BLOCK DATA FOUND IN GLB');
  }

  return {
    blocks: result,
    gridSize: clampGridSize(embeddedGridSize ?? getRequiredGridSize(result)),
    note: 'GLB BLOCK TYPES + GRID COORDINATES RESTORED',
    // Named/userData block coordinates in historical GLB exports are already
    // authored Digital Twin state, so restore them losslessly as well.
    exactState: true,
  };
}

function parseObjGridSize(text) {
  const match = String(text).match(/^#\s*GRID_SIZE\s+(\d+)\s*$/im);
  return match ? clampGridSize(Number(match[1])) : null;
}

function parseObjMetadata(text) {
  const blocks = [];

  for (const line of text.split(/\r?\n/)) {
    const match = line.match(
      /^#\s*DIGITAL_TWIN_BLOCK\s+(standard|support)\s+(-?\d+)\s+(-?\d+)\s+(-?\d+)\s*$/i,
    );

    if (!match) continue;
    blocks.push({
      type: match[1].toLowerCase(),
      x: Number(match[2]),
      y: Number(match[3]),
      z: Number(match[4]),
    });
  }

  return dedupeImportedBlocks(blocks);
}


function collectNamedBlocksFromObject(root) {
  const blocks = [];
  root?.traverse?.((object) => {
    const named = parseBlockName(object?.name);
    if (named) blocks.push(named);
    const userBlock = normalizeImportedBlock(object?.userData);
    if (userBlock) blocks.push(userBlock);
  });
  return dedupeImportedBlocks(blocks);
}
function inferBlocksFromObjGeometry(root, scale = CONFIG.PHYSICAL_BLOCK_MM) {
  const blocks = [];
  const box = new THREE.Box3();
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();

  root.updateMatrixWorld(true);

  root.traverse((object) => {
    const namedBlock = parseBlockName(object.name);
    if (namedBlock) {
      blocks.push(namedBlock);
      return;
    }

    if (!object.isMesh || !object.geometry) return;

    box.setFromObject(object);
    if (box.isEmpty()) return;

    box.getCenter(center);
    box.getSize(size);

    const x = Math.floor(center.x / scale);
    const y = Math.floor(center.y / scale);
    const z = Math.floor(center.z / scale);

    // Full-size 40×20×18.5 geometry is a Standard Block. Narrow beams / braces
    // are the legacy Support Block frame export.
    const isFullCube =
      size.x >= scale * 0.82 &&
      size.y >= scale * 0.82 &&
      size.z >= scale * 0.82;

    blocks.push({ x, y, z, type: isFullCube ? 'standard' : 'support' });
  });

  return dedupeImportedBlocks(blocks);
}

async function loadObjBlocks(file) {
  const text = await file.text();

  // New OBJ exports contain non-destructive comment metadata, ignored by 3D
  // software but used here to recover the exact editable Digital Twin state.
  const metadataBlocks = parseObjMetadata(text);
  if (metadataBlocks.length > 0) {
    return {
      blocks: metadataBlocks,
      gridSize: parseObjGridSize(text) ?? getRequiredGridSize(metadataBlocks),
      note: 'OBJ DIGITAL TWIN METADATA RESTORED',
      exactState: true,
    };
  }

  // Historical OBJ exports predate comment metadata but Three.js OBJExporter
  // preserved each authored block name (standard_x_y_z / support_x_y_z).
  // Those names are lossless and safe to restore; no geometry guessing needed.
  const root = new OBJLoader().parse(text);
  const namedBlocks = collectNamedBlocksFromObject(root);
  if (namedBlocks.length > 0) {
    return {
      blocks: namedBlocks,
      gridSize: CONFIG.GRID_SIZE,
      note: 'LEGACY OBJ BLOCK NAMES RESTORED EXACTLY',
      exactState: true,
    };
  }

  // Do not infer editable cubes from arbitrary OBJ geometry. Organic/straight
  // export geometry can cross authored empty cells just like STL, so geometric
  // reconstruction can create phantom blocks. Exact metadata is required.
  throw new Error('THIS LEGACY OBJ HAS GEOMETRY ONLY / EXACT BLOCK DATA IS NOT PRESENT. No cubes were guessed or added.');
}

function inferStandardBlocksFromStlGeometry(geometry, scale = CONFIG.PHYSICAL_BLOCK_MM) {
  const position = geometry.getAttribute('position');
  if (!position || position.count < 3) return [];

  const occupied = new Set();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const centroid = new THREE.Vector3();
  const epsilon = scale * 1e-4;

  const component = (vector, axis) => {
    if (axis === 0) return vector.x;
    if (axis === 1) return vector.y;
    return vector.z;
  };

  for (let index = 0; index + 2 < position.count; index += 3) {
    a.fromBufferAttribute(position, index);
    b.fromBufferAttribute(position, index + 1);
    c.fromBufferAttribute(position, index + 2);

    ab.subVectors(b, a);
    ac.subVectors(c, a);
    normal.crossVectors(ab, ac);
    if (normal.lengthSq() < 1e-12) continue;
    normal.normalize();

    const absoluteNormal = [Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z)];
    const axis = absoluteNormal.indexOf(Math.max(...absoluteNormal));

    centroid.copy(a).add(b).add(c).multiplyScalar(1 / 3);
    const coords = [centroid.x, centroid.y, centroid.z];
    const cell = coords.map((value) => Math.floor((value + epsilon) / scale));

    const planeCoordinate =
      (component(a, axis) + component(b, axis) + component(c, axis)) / 3;
    const planeIndex = Math.round(planeCoordinate / scale);
    const normalDirection = component(normal, axis);
    cell[axis] = normalDirection > 0 ? planeIndex - 1 : planeIndex;

    const [x, y, z] = cell;
    if (
      x >= 0 && x < CONFIG.GRID_SIZE &&
      y >= 0 && y < CONFIG.GRID_SIZE &&
      z >= 0 && z < CONFIG.MAX_HEIGHT
    ) {
      occupied.add(`${x},${y},${z}`);
    }
  }

  return [...occupied].map((key) => {
    const [x, y, z] = key.split(',').map(Number);
    return { x, y, z, type: 'standard' };
  });
}


function isClearlyLegacyVoxelStl(geometry, scale = CONFIG.PHYSICAL_BLOCK_MM) {
  const position = geometry.getAttribute('position');
  if (!position || position.count < 3 || position.count % 3 !== 0) return false;

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const ab = new THREE.Vector3();
  const ac = new THREE.Vector3();
  const normal = new THREE.Vector3();
  const planeTolerance = Math.max(0.015, scale * 0.0025);
  const axisTolerance = 0.9995;

  const nearGridPlane = (value) => {
    const snapped = Math.round(value / scale) * scale;
    return Math.abs(value - snapped) <= planeTolerance;
  };

  let nonDegenerateTriangles = 0;
  for (let index = 0; index + 2 < position.count; index += 3) {
    a.fromBufferAttribute(position, index);
    b.fromBufferAttribute(position, index + 1);
    c.fromBufferAttribute(position, index + 2);

    // Historical voxel STL exports were boxes placed exactly on 15 mm planes.
    // Requiring every vertex to stay on those planes prevents Organic Print
    // diagonals/chamfers from being mistaken for authored voxel cells.
    if (![a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z].every(nearGridPlane)) {
      return false;
    }

    ab.subVectors(b, a);
    ac.subVectors(c, a);
    normal.crossVectors(ab, ac);
    if (normal.lengthSq() < 1e-12) continue;
    nonDegenerateTriangles += 1;
    normal.normalize();

    const dominant = Math.max(Math.abs(normal.x), Math.abs(normal.y), Math.abs(normal.z));
    if (dominant < axisTolerance) return false;
  }

  return nonDegenerateTriangles > 0;
}

function restoreMissingSupportsForLegacyStl(standardBlocks) {
  const byCell = new Map();
  for (const block of standardBlocks) {
    byCell.set(`${block.x},${block.y},${block.z}`, { ...block, type: 'standard' });
  }

  let reconstructedSupports = 0;
  for (const block of standardBlocks) {
    for (let z = 0; z < block.z; z += 1) {
      const key = `${block.x},${block.y},${z}`;
      if (byCell.has(key)) continue;
      byCell.set(key, { x: block.x, y: block.y, z, type: 'support' });
      reconstructedSupports += 1;
    }
  }

  return {
    blocks: dedupeImportedBlocks([...byCell.values()]),
    reconstructedSupports,
  };
}


async function loadStlBlocks(file) {
  // Read once so the same bytes can be used for Digital Twin metadata recovery
  // and, when necessary, editable geometric reconstruction.
  const buffer = await file.arrayBuffer();
  const stlHeader = new TextDecoder().decode(new Uint8Array(buffer, 0, Math.min(80, buffer.byteLength))).replace(/\0/g, '').trim();
  const isStaticBuilderExport = stlHeader.startsWith('BUILD IT LIVE / STATIC STL EXPORT');
  // A byte-identical local export may also contain camera / selection state;
  // use that first. Otherwise BIL5 metadata carries precise editable cells
  // with their Standard/Support semantics in the original STL itself.
  const ownExport = await getEditableStlExportSnapshot(buffer);
  if (ownExport) {
    return {
      blocks: dedupeImportedBlocks(ownExport.blocks),
      gridSize: ownExport.gridSize,
      gridWidth: ownExport.gridWidth,
      gridDepth: ownExport.gridDepth,
      projectState: ownExport.projectState,
      exactState: true,
      note: 'EXACT MODEL RESTORED',
    };
  }

  const portableState = readEditableStateFromStl(buffer);
  if (portableState && portableState.blocks.length > 0) {
    return {
      blocks: dedupeImportedBlocks(portableState.blocks),
      gridSize: Math.max(portableState.gridWidth, portableState.gridDepth),
      gridWidth: portableState.gridWidth,
      gridDepth: portableState.gridDepth,
      exactState: true,
      projectState: {
        surfaceMode: portableState.surfaceMode,
        smoothingStrength: portableState.smoothingStrength,
        smoothEdgeProfile: portableState.smoothEdgeProfile === 'rounded' ? 'rounded' : 'classic',
        layerView: 0,
      },
      note: portableState.colorsExact
        ? 'EXACT STANDARD / SUPPORT BLOCKS AND COLORS RESTORED'
        : 'EXACT STANDARD / SUPPORT BLOCKS RESTORED / COLORS DEFAULTED',
    };
  }

  // Legacy Build It Live STL generations may still carry recoverable editable
  // state. Those readers remain only for backwards compatibility; new exports
  // are deliberately static and the native editable workflow is .BIL.
  const embeddedBinary = extractVoxelStateFromBinaryStl(buffer);
  const embeddedLegacy = decodeCompactStlMetadataFromBuffer(buffer);
  const exportId = extractStlExportId(buffer);
  const registered = isStaticBuilderExport
    ? null // A modern static export must never borrow an unrelated local snapshot.
    : embeddedBinary ?? embeddedLegacy ?? recoverRegisteredStlState(file, exportId);
  if (registered?.blocks?.length) {
    return {
      blocks: dedupeImportedBlocks(registered.blocks),
      gridSize: registered.gridSize,
      exactState: true,
      note: embeddedBinary
        ? 'BUILD IT LIVE STL STATE RESTORED EXACTLY / NO GEOMETRY-TO-VOXEL GUESSING'
        : embeddedLegacy
          ? 'LEGACY STL DIGITAL TWIN STATE RESTORED EXACTLY / STANDARD + SUPPORT PRESERVED'
          : exportId
            ? 'STL EXPORT ID MATCHED / STANDARD + SUPPORT RESTORED EXACTLY'
            : 'STL LOCAL EXPORT STATE RESTORED EXACTLY / STANDARD + SUPPORT PRESERVED',
    };
  }

  let geometry;
  try {
    geometry = new STLLoader().parse(buffer);
  } catch {
    throw new Error('INVALID OR DAMAGED STL / COULD NOT READ TRIANGLE GEOMETRY');
  }
  const positions = geometry.getAttribute('position');
  geometry.computeBoundingBox();
  const box = geometry.boundingBox;
  if (!positions || positions.count < 3 || !box || box.isEmpty() ||
    ![box.min.x, box.min.y, box.min.z, box.max.x, box.max.y, box.max.z].every(Number.isFinite)) {
    geometry.dispose();
    throw new Error('NO VALID TRIANGLE GEOMETRY FOUND IN STL');
  }

  // Rescue STL files made by older versions using the closest local Recent /
  // Autosave snapshot before attempting geometric reconstruction.
  const legacyRecovered = isStaticBuilderExport ? null : recoverLegacyStlStateFromRecents(file, geometry);
  if (legacyRecovered?.blocks?.length) {
    geometry.dispose();
    return {
      blocks: dedupeImportedBlocks(legacyRecovered.blocks),
      gridSize: legacyRecovered.gridSize,
      exactState: true,
      note: 'LEGACY STL MATCHED TO LOCAL EDITABLE STATE / STANDARD + SUPPORT PRESERVED',
    };
  }

  // Safe backwards compatibility for the original Build It Live STL exporter:
  // those files contain only axis-aligned Standard cubes on exact 15 mm planes.
  // This path is deliberately gated by strict geometry checks, so Organic Print
  // beams/chamfers never enter the voxel reconstruction that caused phantom cubes.
  if (!isStaticBuilderExport && isClearlyLegacyVoxelStl(geometry)) {
    const standardBlocks = inferStandardBlocksFromStlGeometry(geometry);
    if (standardBlocks.length > 0) {
      const restored = restoreMissingSupportsForLegacyStl(standardBlocks);
      geometry.dispose();
      return {
        blocks: restored.blocks,
        gridSize: CONFIG.GRID_SIZE,
        exactState: true,
        note: restored.reconstructedSupports > 0
          ? `LEGACY VOXEL STL RESTORED / ${restored.reconstructedSupports} SUPPORT BLOCK(S) RECOVERED`
          : 'LEGACY VOXEL STL RESTORED EXACTLY',
      };
    }
  }

  // No recoverable original model data: keep the mesh losslessly. Sampling
  // it into cuboids can distort roofs, windows and thin features and cannot
  // distinguish Standard/Support cells. BLOCKS shows a render-only grid instead.
  const layout = getStlPreviewLayout({ min: box.min, max: box.max }, CONFIG.PHYSICAL_BLOCK_MM);
  return {
    exactStl: { buffer, geometry, gridSize: CONFIG.GRID_SIZE },
    gridSize: Math.max(layout.gridWidth, Math.ceil(layout.gridDepth / 2)),
    gridWidth: layout.gridWidth,
    gridDepth: layout.gridDepth,
    note: 'ORIGINAL STL GEOMETRY PRESERVED / NO EDITABLE BLOCK TYPES IN FILE',
  };
}


async function decodeModelFile(file) {
  const extension = file.name.split('.').pop()?.toLowerCase();

  if (extension === 'bil') return loadBilProject(file);
  if (extension === 'json') return loadJsonBlocks(file);
  if (extension === 'glb') return loadGlbBlocks(file);
  if (extension === 'obj') return loadObjBlocks(file);
  if (extension === 'stl') return loadStlBlocks(file);

  throw new Error('SUPPORTED PROJECT / LEGACY FORMATS: BIL / JSON / STL / GLB / OBJ');
}

async function loadModelFromFile(file) {
  if (!file) return;
  if (serialConnected || simulationActive) {
    setFeedback('SENSOR INPUT ACTIVE', 'Exit the sensor session before replacing the build.', true);
    return;
  }

  try {
    systemStatus.textContent = `LOADING ${file.name.split('.').pop()?.toUpperCase() ?? 'MODEL'}`;

    const imported = await decodeModelFile(file);
    // An imported file is a separate model, not an edit of the currently active
    // autosave entry. Its first autosave receives a fresh Recent Models ID.
    setActiveRecentModel(null);
    importedProjectName = imported.projectName || file.name.replace(/\.[^.]+$/, '').trim() || null;

    if (imported.exactStl) {
      clearExactStlMode();
      setActiveGridSize(imported.gridSize ?? CONFIG.GRID_SIZE, { preserveBlocks: false, silent: true, autosave: false });
      restoreRectangularDimensions(imported.gridWidth, imported.gridDepth);
      model.replaceExact([]);
      resetHistoryToCurrent();
      activateExactStlMode(imported.exactStl);
      const meshSessionId = globalThis.crypto?.randomUUID?.() ?? `mesh-${Date.now()}`;
      exactImportedStl.sessionId = meshSessionId;
      // Cache raw STL bytes (not an approximated block reconstruction) so a
      // Guide/Brick Maker visit does not discard the original mesh.
      const meshStored = await saveImportedMeshSession({
        buffer: exactImportedStl.originalBuffer,
        id: meshSessionId,
        gridSize: imported.gridSize ?? CONFIG.GRID_SIZE,
        gridWidth: model.gridWidth,
        gridDepth: model.gridDepth,
      });
      if (meshStored) safeStorageWrite(ACTIVE_WORKSPACE_KIND_KEY, 'mesh');
      else safeStorageRemove(ACTIVE_WORKSPACE_KIND_KEY);
      setExportSurfaceMode('soft1', { rebuild: false, remember: false });
      syncViewFromModel();
      ghost.visible = false;
      hoveredCandidate = null;
      // Fit camera around the imported mesh rather than the previous build.
      const bounds = imported.exactStl.geometry.boundingBox;
      const preview = getStlPreviewLayout({ min: bounds.min, max: bounds.max }, CONFIG.PHYSICAL_BLOCK_MM);
      const focusHeight = preview.size.height / 2;
      const cameraRange = Math.max(17, Math.min(38, preview.maxWorldDimension * 2.3 + 11));
      controls.target.set(0, focusHeight, 0);
      camera.position.set(cameraRange * .56, focusHeight + cameraRange * .54, cameraRange * .64);
      controls.update();
      systemStatus.textContent = 'STL MESH LOADED';
      setFeedback('ORIGINAL MESH PRESERVED', 'Exact shape loaded. Original blocks unavailable.');
      return;
    }

    clearExactStlMode();
    markEditableWorkspaceActive();
    setActiveGridSize(imported.gridSize ?? getRequiredGridSize(imported.blocks), { preserveBlocks: false, silent: true, autosave: false });
    restoreRectangularDimensions(imported.gridWidth, imported.gridDepth);
    const rejected = imported.exactState
      ? model.replaceExact(imported.blocks)
      : model.replaceFromFrame(imported.blocks);
    resetHistoryToCurrent();

    syncViewFromModel();
    ghost.visible = false;
    hoveredCandidate = null;

    if (imported.projectState) {
      if (imported.projectState.selectedBlockColor) {
        selectedBlockColor = normalizeStandardBlockColor(imported.projectState.selectedBlockColor);
        updateBlockColorUi();
      }
      smoothingStrength = imported.projectState.smoothingStrength;
      smoothEdgeProfile = imported.projectState.smoothEdgeProfile === 'rounded' ? 'rounded' : 'classic';
      setExportSurfaceMode(imported.projectState.surfaceMode, { rebuild: false, remember: false });
      updateSmoothingStrengthUi(smoothingStrength);
      setLayerView(imported.projectState.layerView || 0);
      if (imported.projectState.cameraPosition) camera.position.fromArray(imported.projectState.cameraPosition);
      if (imported.projectState.cameraTarget) controls.target.fromArray(imported.projectState.cameraTarget);
      controls.update();
      scheduleRealtimeOrganicSurface({ immediate: true });
    }

    // One imported project = one new editable Recent Model, immediately.
    // This also works when Autosave is off, and keeps the filename/name.
    window.clearTimeout(autosaveTimer);
    autosaveTimer = null;
    persistCurrentModel({ force: true, addRecent: true, includeEmpty: true });

    if (imported.approximateState) {
      systemStatus.textContent = 'APPROXIMATE STL MODEL';
      setFeedback('BLOCKS APPROXIMATED', `${model.getBlockCount()} blocks estimated. Support types may differ.`);
    } else if (rejected.length > 0) {
      systemStatus.textContent = `MODEL LOADED / ${rejected.length} REJECTED`;
      setFeedback(
        'MODEL PARTLY LOADED',
        `${model.getBlockCount()} loaded · ${rejected.length} rejected.`,
        true,
      );
    } else {
      systemStatus.textContent = 'MODEL LOADED';
      setFeedback(
        'MODEL RESTORED',
        `${model.getBlockCount()} blocks. ${imported.note ?? ''}`.trim(),
      );
    }
  } catch (error) {
    console.error(error);
    systemStatus.textContent = 'LOAD FAILED';
    setFeedback(
      'COULD NOT LOAD MODEL',
      error instanceof Error ? error.message : 'INVALID MODEL FILE',
      true,
    );
  } finally {
    // Reset so the same file can be selected twice in a row.
    loadBuildInput.value = '';
  }
}

saveBuildButton.addEventListener('click', () => {
  try {
    const filename = saveNativeProject();
    systemStatus.textContent = 'PROJECT SAVED';
    setFeedback('PROJECT SAVED', `${filename} · editable blocks preserved.`);
  } catch (error) {
    console.error(error);
    systemStatus.textContent = 'PROJECT SAVE FAILED';
    setFeedback('COULD NOT SAVE PROJECT', error instanceof Error ? error.message : 'PROJECT SAVE FAILED', true);
  }
});

exportBuildButton?.addEventListener('click', () => openSaveModal(exportBuildButton));

closeSaveModalButton.addEventListener('click', closeSaveModal);
saveModalBackdrop.addEventListener('click', closeSaveModal);

smoothEdgeProfileButtons.forEach(button=>button.addEventListener('click',()=>setSmoothEdgeProfile(button.dataset.smoothEdgeProfile)));
if (smoothingStrengthSlider) {
  smoothingStrengthSlider.addEventListener('input', () => updateSmoothingStrengthUi(smoothingStrengthSlider.value));
}
document.querySelector('#smoothOriginalOutline')?.addEventListener('click',()=>{smoothOriginalOutline=!smoothOriginalOutline;refreshSmoothOutline();});
if (realtimeSmoothingSlider) {
  realtimeSmoothingSlider.addEventListener('input', () => updateSmoothingStrengthUi(realtimeSmoothingSlider.value));
}

exportSurfaceButtons.forEach((button) => {
  button.addEventListener('click', () => setExportSurfaceMode(button.dataset.exportSurface));
});
realtimeSurfaceButtons.forEach((button) => {
  button.addEventListener('click', () => setExportSurfaceMode(button.dataset.liveSurface));
});
setExportSurfaceMode(exportSurfaceMode, { rebuild: false, remember: false });

exportFormatButtons.forEach((button) => {
  button.addEventListener('click', async () => {
    const format = button.dataset.exportFormat;
    const previousText = button.querySelector('.format-action')?.textContent;

    try {
      button.disabled = true;
      button.classList.add('is-exporting');
      const action = button.querySelector('.format-action');
      if (action) action.textContent = 'EXPORTING…';

      systemStatus.textContent = `EXPORTING ${format.toUpperCase()}`;
      const message = await exportModel(format);
      systemStatus.textContent = message;
      setFeedback('MODEL EXPORTED', message);
      closeSaveModal();
    } catch (error) {
      console.error(error);
      systemStatus.textContent = 'EXPORT FAILED';
      setFeedback(
        'EXPORT FAILED',
        error instanceof Error ? error.message : 'COULD NOT EXPORT MODEL',
        true,
      );
    } finally {
      button.classList.remove('is-exporting');
      const action = button.querySelector('.format-action');
      if (action && previousText) action.textContent = previousText;
      button.disabled = false;
    }
  });
});

loadBuildButton.addEventListener('click', () => openLoadModal(loadBuildButton));

closeLoadModalButton.addEventListener('click', closeLoadModal);
loadModalBackdrop.addEventListener('click', closeLoadModal);

loadFormatButtons.forEach((button) => {
  button.addEventListener('click', () => {
    chooseLoadFormat(button.dataset.loadFormat);
  });
});

loadBuildInput.addEventListener('change', () => {
  const file = loadBuildInput.files?.[0];
  if (!file) return;
  closeLoadModal();
  loadModelFromFile(file);
});

// Drag-and-drop import: useful during repeated UX testing when models are
// frequently saved and reopened from the desktop.
['dragenter', 'dragover'].forEach((eventName) => {
  loadDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    loadDropZone.classList.add('is-dragging');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  loadDropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    loadDropZone.classList.remove('is-dragging');
  });
});

loadDropZone.addEventListener('drop', (event) => {
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;

  if (!isSupportedLoadFile(file)) {
    systemStatus.textContent = 'LOAD FAILED';
    setFeedback('COULD NOT LOAD PROJECT', 'SUPPORTED PROJECT / LEGACY FORMATS: BIL / JSON / STL / GLB / OBJ', true);
    return;
  }

  closeLoadModal();
  loadModelFromFile(file);
});

loadDropZone.addEventListener('click', () => chooseLoadFormat());
loadDropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    chooseLoadFormat();
  }
});

// Hardware-only workbench tools receive truthful telemetry from the existing
// firmware protocol. An unreported cell is UNOBSERVED, never assumed faulty.
const hardwareChannelEvents = new Map();
const hardwareEventLog = [];
let hardwareLatestReading = null;
let hardwareEventNumber = 0;
function getHardwareMonitorState() {
  return {
    connected: serialConnected || simulationActive,
    width: HARDWARE_CONFIG.boardWidth,
    depth: HARDWARE_CONFIG.boardDepth,
    blocks: model.getBlocks().map(({ x, y, z, type }) => ({ x, y, z, type })),
    readings: [...hardwareChannelEvents.values()],
    history: [...hardwareEventLog],
    lastReading: hardwareLatestReading,
    profiles: {
      standard: HARDWARE_CONFIG.standardResistance,
      support: HARDWARE_CONFIG.supportResistance,
    },
  };
}
function broadcastHardwareMonitorState() {
  if (!IS_HARDWARE_BUILDER) return;
  window.dispatchEvent(new CustomEvent('buildit:hardware-state', { detail: getHardwareMonitorState() }));
}
function recordHardwareReading(payload, rejected = []) {
  if (!IS_HARDWARE_BUILDER || payload?.ch === undefined || payload?.uS === undefined) return;
  const channel = Number(payload.ch);
  const conductance = Number(payload.uS);
  if (!Number.isInteger(channel) || channel < 0 || channel >= HARDWARE_CONFIG.boardWidth * HARDWARE_CONFIG.boardDepth ||
      !Number.isFinite(conductance) || conductance <= 0) return;
  hardwareEventNumber += 1;
  const action = String(payload.action || '').toLowerCase();
  const reading = {
    sequence: hardwareEventNumber,
    channel,
    action,
    z: Number(payload.z) || 0,
    conductance,
    resistance: 1000 / conductance,
    accepted: rejected.length === 0,
    timestamp: Date.now(),
  };
  hardwareChannelEvents.set(channel, reading);
  hardwareEventLog.push(reading);
  if (hardwareEventLog.length > 100) hardwareEventLog.shift();
  hardwareLatestReading = reading;
}
function updateHardwareProfileFromReading(type, resistance) {
  if (!IS_HARDWARE_BUILDER || !['standard', 'support'].includes(type)) return false;
  const kOhms = Number(resistance);
  if (!Number.isFinite(kOhms) || kOhms < 0.1 || kOhms > 10000) return false;
  const candidate = {
    ...HARDWARE_CONFIG,
    [type === 'standard' ? 'standardResistance' : 'supportResistance']: Number(kOhms.toFixed(3)),
  };
  const others = [candidate.standardResistance, candidate.supportResistance,
    ...candidate.extras.map(entry => Number(entry.resistance))];
  if (others.some((value) => !Number.isFinite(value) || value <= 0)) return false;
  for (let i = 0; i < others.length; i++) {
    for (let j = i + 1; j < others.length; j++) {
      if (Math.abs(others[i] - others[j]) / Math.min(others[i], others[j]) < 0.12) return false;
    }
  }
  // Updating the live resistance matcher does not reconfigure appearance or grid.
  HARDWARE_CONFIG = structuredClone(candidate);
  rebuildHardwareProfiles();
  if (hardwareStandardOhms) hardwareStandardOhms.value = String(candidate.standardResistance);
  if (hardwareSupportOhms) hardwareSupportOhms.value = String(candidate.supportResistance);
  setFeedback('PROFILE CALIBRATED', `${type.toUpperCase()} profile set to ${kOhms.toFixed(2)} kΩ. Physical input stays connected.`);
  broadcastHardwareMonitorState();
  return true;
}
function captureHardwareModelImage() {
  if (!IS_HARDWARE_BUILDER) throw new Error('Capture is only available in Hardware Builder.');
  // Render explicitly then read pixels in the same synchronous call. WebGL's
  // default drawing buffer may be cleared between animation frames.
  syncMainViewport();
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL('image/png');
}

// -----------------------------------------------------------------------------
// 11. ESP32 WEB SERIAL CONNECTION
// -----------------------------------------------------------------------------
// Protocol: newline-delimited JSON (NDJSON). Each line may be either:
//   [{"x":0,"y":0,"z":0,"type":"standard"}, ...]     // full frame
//   {"blocks":[...]}                                      // full frame
//   {"action":"place","x":0,"y":0,"z":0,"type":"support"}
//   {"action":"remove","x":0,"y":0,"z":0}
//   {"action":"clear"}
// Hardware state intentionally does not create Undo entries. On disconnect,
// the current physical state becomes the new digital-history baseline.
function setSerialStatus(label, state = 'offline') {
  if (IS_HARDWARE_BUILDER) {
    const status = document.querySelector('#hardwareInputMetric');
    if (status) status.textContent = label;
  }
  serialStatus.classList.toggle('is-connected', state === 'connected');
  serialStatus.classList.toggle('is-error', state === 'error');
  serialStatus.innerHTML = `<i></i> ${label}`;
}

function updateSerialControls() {
  const supported = 'serial' in navigator && window.isSecureContext;
  const active = serialConnected || simulationActive;
  connectSerialButton.disabled = !supported || active || serialSetupPending;
  simulateHardwareButton.disabled = true;
  disconnectSerialButton.disabled = !active;
  disconnectSerialButton.textContent = 'DISCONNECT';
  // Keep DISCONNECT text-only, but preserve the original boxed EXIT DEMO button.
  disconnectSerialButton.classList.remove('is-exit-demo');
  serialBaud.disabled = active || serialSetupPending;
  // Hidden must win over CSS flex styling.
  hardwareMenuButton.hidden = !active;
  // The virtual sensor board must be discoverable after SIMULATE starts.
  hardwareMenuButton.textContent = 'HARDWARE MENU';
  hardwareMenuButton.title = 'Edit connected hardware settings';
  if (gridSizeSlider) gridSizeSlider.disabled = active || serialSetupPending;

  if (simulationActive) {
    setSerialStatus('SIMULATION', 'connected');
  } else if (serialConnected) {
    setSerialStatus('CONNECTED', 'connected');
  } else if (serialSetupPending) {
    setSerialStatus('CONFIGURING', 'connected');
  } else if (!supported) {
    setSerialStatus('UNAVAILABLE', 'offline');
    connectSerialButton.title = 'Web Serial requires Chrome or Edge on localhost or HTTPS.';
  } else {
    setSerialStatus('OFFLINE', 'offline');
  }
  updateHistoryControls();
  updateOrganicEditingLocks();
  broadcastHardwareMonitorState();
}

function resetHardwareWorkspace(width, depth) {
  // Refresh the *app state*, never reload the browser page: that would drop Web Serial.
  if (exactImportedStl) clearExactStlMode();
  if (activeLayerView !== null) setLayerView(0);
  model.clear();
  model.setGridDimensions(width, depth);
  updateGridSceneGeometry();
  updateGridUi();
  hoveredCandidate = null;
  ghost.visible = false;
  setActiveRecentModel(null);
  resetHistoryToCurrent();
  syncViewFromModel();
  camera.position.copy(defaultCameraPosition);
  controls.target.set(0, 2.2, 0);
  controls.update();
  systemStatus.textContent = 'HARDWARE PLATE REFRESHED';
}

function applyHardwareConfiguration(configuration, { reset = false } = {}) {
  const dimensionsChanged = HARDWARE_CONFIG.boardWidth !== configuration.boardWidth ||
    HARDWARE_CONFIG.boardDepth !== configuration.boardDepth ||
    model.gridWidth !== configuration.digitalWidth || model.gridDepth !== configuration.digitalDepth;
  HARDWARE_CONFIG = structuredClone(configuration);
  if (reset || dimensionsChanged) { hardwareChannelEvents.clear(); hardwareEventLog.length = 0; hardwareLatestReading = null; }
  if (IS_HARDWARE_BUILDER) {
    const physicalGrid = document.querySelector('#physicalGridMetric');
    if (physicalGrid) physicalGrid.textContent = `${configuration.boardWidth}×${configuration.boardDepth}`;
    selectedBlockColor = configuration.standardColor;
    updateBlockColorUi();
  }
  rebuildHardwareProfiles();
  // Changing coordinate mapping invalidates existing channel positions.
  if (reset || dimensionsChanged) resetHardwareWorkspace(configuration.digitalWidth, configuration.digitalDepth);
  else {
    updateGridUi();
    syncViewFromModel();
  }
  if (simulationActive) {
    simulationSelectedChannel = Math.min(simulationSelectedChannel, configuration.boardWidth * configuration.boardDepth - 1);
    renderSimulationControls();
  }
  broadcastHardwareMonitorState();
  return dimensionsChanged;
}

function normalizeHardwareType(value) {
  return value === 'support' || value === 2 || value === '2' ? 'support' : 'standard';
}

function normalizeHardwareBlock(block) {
  if (!block || typeof block !== 'object') return null;

  const x = Number(block.x);
  const y = Number(block.y);
  const z = Number(block.z);

  if (![x, y, z].every(Number.isInteger)) return null;

  return {
    x,
    y,
    z,
    type: normalizeHardwareType(block.type),
  };
}

function applyHardwareFrame(blocks, label = 'ESP32 FRAME') {
  if (exactImportedStl) clearExactStlMode();
  if (!Array.isArray(blocks)) {
    throw new Error('HARDWARE FRAME MUST CONTAIN A BLOCK ARRAY');
  }

  const normalized = [];
  const malformed = [];

  blocks.forEach((block) => {
    const parsed = normalizeHardwareBlock(block);
    if (parsed) normalized.push(parsed);
    else malformed.push({ ...block, reason: 'INVALID BLOCK COORDINATES' });
  });

  // A sensor frame describes positions/types, not appearance. Preserve any colors
  // chosen in Hardware Builder for surviving blocks; newly detected blocks use
  // the current Standard resistance-profile display color.
  const previousColors = new Map(model.getBlocks().filter((b) => b.type === 'standard')
    .map((b) => [modelBlockKey(b.x, b.y, b.z), b.color || HARDWARE_CONFIG.standardColor]));
  const coloredFrame = IS_HARDWARE_BUILDER ? normalized.map((b) => ({
    ...b,
    ...(b.type === 'standard' ? { color: previousColors.get(modelBlockKey(b.x, b.y, b.z)) || HARDWARE_CONFIG.standardColor } : {}),
  })) : normalized;
  const rejectedByPhysics = model.replaceFromFrame(coloredFrame);
  const rejected = [...malformed, ...rejectedByPhysics];

  syncViewFromModel();
  ghost.visible = false;
  hoveredCandidate = null;
  scheduleAutosave();

  systemStatus.textContent = rejected.length
    ? `${label} / ${rejected.length} REJECTED`
    : `${label} RECEIVED`;

  setFeedback(
    'ESP32 FRAME',
    rejected.length
      ? `${model.getBlockCount()} block(s) accepted; ${rejected.length} invalid reading(s) rejected.`
      : `${model.getBlockCount()} block(s) synchronized from the physical interface.`,
    rejected.length > 0,
  );

  broadcastHardwareMonitorState();
  return rejected;
}

function applyHardwareEvent(payload) {
  if (payload && payload.ch !== undefined && payload.uS !== undefined) {
    if (exactImportedStl) clearExactStlMode();
    const ch = Number(payload.ch);
    const z = Number(payload.z);
    const boardWidth = HARDWARE_CONFIG.boardWidth;
    const boardDepth = HARDWARE_CONFIG.boardDepth;
    if (!Number.isInteger(ch) || ch < 0 || ch >= boardWidth * boardDepth ||
        !Number.isInteger(z) || z < 0 || z >= CONFIG.MAX_HEIGHT) {
      return [{ reason: 'INVALID SENSOR CHANNEL OR HEIGHT', ch, z }];
    }

    // Center the physical plate inside either square or rectangular digital grid.
    const { x, y } = sensorChannelToCell(ch, boardWidth, model.gridWidth, model.gridDepth, boardDepth);

    if (payload.action === 'add') {
      const profile = matchResistanceProfile(payload.uS);
      if (!profile) {
        const resistance = Number(payload.uS) > 0 ? (1000 / Number(payload.uS)).toFixed(2) : 'unknown';
        setFeedback('UNKNOWN SENSOR RESISTANCE', `${resistance} kΩ does not match a cube profile (±25%).`, true);
        systemStatus.textContent = 'SENSOR VALUE UNMATCHED';
        return [{ x, y, z, reason: 'UNRECOGNIZED_RESISTANCE' }];
      }
      const result = placeStudioBlock(x, y, z, profile.type, profile.color);
      syncViewFromModel();
      if (result.valid) scheduleAutosave();
      systemStatus.textContent = result.valid ? 'HARDWARE CUBE PLACED' : result.reason;
      setFeedback(result.valid ? 'HARDWARE UPDATE' : 'READING REJECTED',
        result.valid ? `${profile.type === 'support' ? 'Support' : 'Standard'} cube / ${profile.resistance} kΩ at [${x}, ${y}, ${z}].` : result.reason,
        !result.valid);
      return result.valid ? [] : [{ x, y, z, reason: result.reason }];
    }
    if (payload.action === 'remove') {
      const result = model.removeBlockAndApplyGravity(x, y, z);
      syncViewFromModel();
      if (result.removed) scheduleAutosave();
      systemStatus.textContent = result.reason;
      setFeedback('HARDWARE UPDATE', result.reason, !result.removed);
      return result.removed ? [] : [{ x, y, z, reason: result.reason }];
    }
  }

  if (Array.isArray(payload)) {
    return applyHardwareFrame(payload);
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error('SERIAL MESSAGE MUST BE JSON');
  }

  if (Array.isArray(payload.blocks)) {
    return applyHardwareFrame(payload.blocks);
  }

  if (Array.isArray(payload.frame)) {
    return applyHardwareFrame(payload.frame);
  }

  const action = String(payload.action ?? '').toLowerCase();

  if (action === 'clear') {
    if (exactImportedStl) clearExactStlMode();
    model.clear();
    syncViewFromModel();
    scheduleAutosave({ addRecent: false });
    ghost.visible = false;
    systemStatus.textContent = 'ESP32 BUILD CLEARED';
    setFeedback('HARDWARE UPDATE', 'Physical model reported an empty grid.');
    return [];
  }

  if (action === 'place' || (!action && 'x' in payload && 'y' in payload && 'z' in payload)) {
    if (exactImportedStl) clearExactStlMode();
    const block = normalizeHardwareBlock(payload);
    if (!block) throw new Error('INVALID ESP32 PLACE EVENT');

    const blockColor = block.type === 'standard' ? HARDWARE_CONFIG.standardColor : null;
    const result = placeStudioBlock(block.x, block.y, block.z, block.type, blockColor);
    syncViewFromModel();
    if (result.valid) scheduleAutosave();
    systemStatus.textContent = result.valid ? 'ESP32 BLOCK PLACED' : result.reason;
    setFeedback(
      result.valid ? 'HARDWARE UPDATE' : 'HARDWARE READING REJECTED',
      result.valid ? `Placed [${block.x}, ${block.y}, ${block.z}] from ESP32.` : result.reason,
      !result.valid,
    );
    return result.valid ? [] : [{ ...block, reason: result.reason }];
  }

  if (action === 'remove' || action === 'erase') {
    if (exactImportedStl) clearExactStlMode();
    const block = normalizeHardwareBlock({ ...payload, type: 'standard' });
    if (!block) throw new Error('INVALID ESP32 REMOVE EVENT');

    const result = model.removeBlockAndApplyGravity(block.x, block.y, block.z);
    syncViewFromModel();
    if (result.removed) scheduleAutosave();
    systemStatus.textContent = result.reason;
    setFeedback('HARDWARE UPDATE', result.reason, !result.removed);
    return result.removed ? [] : [{ ...block, reason: result.reason }];
  }

  throw new Error('UNKNOWN ESP32 MESSAGE FORMAT');
}

function processSerialLine(line) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('//')) return;

  // Hunt for the start of the JSON object, ignoring any preceding noise
  const jsonObjectStart = trimmed.indexOf('{');
  const jsonArrayStart = trimmed.indexOf('[');
  const jsonStart = jsonObjectStart === -1 ? jsonArrayStart : (jsonArrayStart === -1 ? jsonObjectStart : Math.min(jsonObjectStart, jsonArrayStart));
  if (jsonStart === -1) return; // No JSON found on this line

  const cleanJson = trimmed.slice(jsonStart);

  try {
    const payload = JSON.parse(cleanJson);
    const rejected = applyHardwareEvent(payload);
    recordHardwareReading(payload, rejected);
    broadcastHardwareMonitorState();
  } catch (error) {
    console.warn('Serial message rejected:', cleanJson, error);
    systemStatus.textContent = 'SERIAL MESSAGE REJECTED';
    setFeedback(
      'SERIAL DATA ERROR',
      error instanceof Error ? error.message : 'INVALID SERIAL DATA',
      true,
    );
  }
}

async function readSerialLoop() {
  const decoder = new TextDecoder();

  try {
    if (!serialPort?.readable) throw new Error('SERIAL PORT IS NOT READABLE');
    serialReader = serialPort.readable.getReader();

    while (serialKeepReading) {
      const { value, done } = await serialReader.read();
      if (done) break;
      if (!value) continue;

      serialBuffer += decoder.decode(value, { stream: true });

      let newlineIndex = serialBuffer.indexOf('\n');
      while (newlineIndex >= 0) {
        const line = serialBuffer.slice(0, newlineIndex);
        serialBuffer = serialBuffer.slice(newlineIndex + 1);
        processSerialLine(line);
        newlineIndex = serialBuffer.indexOf('\n');
      }
    }
  } catch (error) {
    if (serialKeepReading) {
      console.error('Serial read error:', error);
      serialKeepReading = false;
      serialConnected = false;
      setSerialStatus('CONNECTION LOST', 'error');
      setFeedback(
        'ESP32 DISCONNECTED',
        error instanceof Error ? error.message : 'SERIAL CONNECTION LOST',
        true,
      );
    }
  } finally {
    if (serialReader) {
      try { serialReader.releaseLock(); } catch { /* already released */ }
      serialReader = null;
    }

    // If the cable/board vanished unexpectedly, close any remaining port handle
    // and rebase Undo/Redo on the last physical state we successfully received.
    if (!serialConnected && serialPort) {
      try { await serialPort.close(); } catch { /* port may already be gone */ }
      serialPort = null;
      resetHistoryToCurrent();
    }

    updateSerialControls();
  }
}

// --- Hardware settings / configurable physical profiles / simulation ---
function showHardwareSetupError(message) {
  hardwareSetupError.textContent = message;
  hardwareSetupError.hidden = !message;
}

// Hardware dimensions are derived exclusively from the sensor plate. The
// independent digital size slider remains a Digital Builder feature only.


function updateHardwareDefaultColor() {
  const hex = hardwareDefaultColor.value.toUpperCase();
  hardwareDefaultHex.textContent = hex;
  hardwareDefaultSwatch.style.background = hex;
}
hardwareDefaultColor.addEventListener('input', updateHardwareDefaultColor);

// Reuse the same black, animated Custom Color editor as the main Build Kit.
// Each profile gets its own editor/draft; edits are committed only on USE COLOR.
const HARDWARE_COLOR_PALETTE = ['#e93222', '#ff7a30', '#f2c94c', '#27ae60', '#2f80ed', '#9b51e0', '#ff6fae', '#f4f1e8', '#171717'];
let nextHardwareColorEditorId = 0;
let activeHardwareColorEditor = null;
function makeHardwareColorPalette(input, target, onChange) {
  const palette = document.createElement('div');
  palette.className = 'hardware-color-palette';
  palette.setAttribute('role', 'group');
  palette.setAttribute('aria-label', 'Cube color presets and custom color');
  const presets = [];
  const changeColor = (hex) => {
    input.value = hex;
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  for (const hex of HARDWARE_COLOR_PALETTE) {
    const choice = document.createElement('button');
    choice.type = 'button';
    choice.className = 'hardware-color-preset';
    choice.style.background = hex;
    choice.title = `Use ${hex}`;
    choice.setAttribute('aria-label', `Use ${hex}`);
    choice.addEventListener('click', () => { changeColor(hex); closeEditor(); });
    presets.push(choice);
    palette.appendChild(choice);
  }
  const id = `hardwareCustomColor${++nextHardwareColorEditorId}`;
  const customButton = document.createElement('button');
  customButton.type = 'button';
  customButton.className = 'hardware-color-custom';
  customButton.setAttribute('aria-expanded', 'false');
  customButton.setAttribute('aria-controls', id);
  customButton.setAttribute('aria-label', 'Open custom color editor');
  customButton.innerHTML = '<span class="block-color-custom__label">CUSTOM</span>';
  palette.appendChild(customButton);

  const editor = document.createElement('div');
  editor.className = 'custom-color-panel hardware-custom-color-panel';
  editor.id = id;
  editor.hidden = true;
  editor.innerHTML = `
    <div class="custom-color-panel__head">
      <div><span>ANY COLOR</span><strong>COLOR MIXER</strong></div>
      <button class="custom-color-close" type="button" aria-label="Close custom color editor">×</button>
    </div>
    <div class="custom-color-preview-row">
      <span class="custom-color-preview" aria-hidden="true"></span>
      <label class="custom-color-hex-wrap"><span>HEX</span>
        <input class="custom-color-hex" type="text" maxlength="7" spellcheck="false" aria-label="Custom color hex value" />
      </label>
    </div>
    <div class="custom-color-controls">
      <label class="custom-color-control custom-color-control--hue"><span>HUE</span><input class="hardware-color-hue" type="range" min="0" max="360" aria-label="Hue" /></label>
      <label class="custom-color-control custom-color-control--sat"><span>COLOR</span><input class="hardware-color-sat" type="range" min="0" max="100" aria-label="Color intensity" /></label>
      <label class="custom-color-control custom-color-control--light"><span>LIGHT</span><input class="hardware-color-light" type="range" min="8" max="92" aria-label="Lightness" /></label>
    </div>
    <button class="custom-color-apply" type="button">USE COLOR</button>`;
  const hexInput = editor.querySelector('.custom-color-hex');
  const preview = editor.querySelector('.custom-color-preview');
  const hue = editor.querySelector('.hardware-color-hue');
  const sat = editor.querySelector('.hardware-color-sat');
  const light = editor.querySelector('.hardware-color-light');
  let closeTimer = null;
  let draft = input.value;
  const updatePreview = (hex) => {
    draft = hex.toLowerCase();
    hexInput.value = hex.toUpperCase();
    preview.style.background = hex;
    editor.style.setProperty('--custom-color', hex);
    editor.style.setProperty('--custom-hue-color', hslToHex(hue.value, 100, 50));
    hexInput.removeAttribute('aria-invalid');
  };
  const setFromHex = (hex) => {
    const hsl = hexToHsl(hex);
    hue.value = String(hsl.h);
    sat.value = String(hsl.s);
    light.value = String(Math.max(8, Math.min(92, hsl.l)));
    updatePreview(hex);
  };
  const closeEditor = () => {
    customButton.setAttribute('aria-expanded', 'false');
    customButton.classList.remove('is-active');
    editor.classList.remove('is-open');
    if (activeHardwareColorEditor === closeEditor) activeHardwareColorEditor = null;
    window.clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => {
      if (!editor.classList.contains('is-open')) editor.hidden = true;
    }, 580);
  };
  customButton.addEventListener('click', () => {
    if (customButton.getAttribute('aria-expanded') === 'true') { closeEditor(); return; }
    if (activeHardwareColorEditor) activeHardwareColorEditor();
    activeHardwareColorEditor = closeEditor;
    setFromHex(input.value);
    window.clearTimeout(closeTimer);
    editor.hidden = false;
    customButton.setAttribute('aria-expanded', 'true');
    customButton.classList.add('is-active');
    requestAnimationFrame(() => editor.classList.add('is-open'));
  });
  editor.querySelector('.custom-color-close').addEventListener('click', () => { closeEditor(); customButton.focus(); });
  [hue, sat, light].forEach((slider) => slider.addEventListener('input', () => {
    updatePreview(hslToHex(hue.value, sat.value, light.value));
  }));
  const readHex = () => {
    const value = hexInput.value.trim();
    if (!/^#[0-9a-f]{6}$/i.test(value)) {
      hexInput.setAttribute('aria-invalid', 'true');
      return false;
    }
    setFromHex(value);
    return true;
  };
  hexInput.addEventListener('change', readHex);
  editor.querySelector('.custom-color-apply').addEventListener('click', () => {
    if (hexInput.value.toLowerCase() !== draft && !readHex()) { hexInput.focus(); return; }
    changeColor(draft);
    closeEditor();
    customButton.focus();
  });
  editor.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') { event.stopPropagation(); closeEditor(); customButton.focus(); }
  });
  const syncActive = () => {
    presets.forEach((button, i) => {
      const active = HARDWARE_COLOR_PALETTE[i] === input.value.toLowerCase();
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    const isCustom = !HARDWARE_COLOR_PALETTE.includes(input.value.toLowerCase());
    customButton.classList.toggle('has-custom-color', isCustom);
    customButton.style.setProperty('--selected-hardware-color', input.value);
    onChange?.();
  };
  input.addEventListener('input', syncActive);
  target.append(palette, editor);
  syncActive();
}
makeHardwareColorPalette(hardwareDefaultColor, document.getElementById('hardwareDefaultPaletteSlot'), updateHardwareDefaultColor);

function addHardwareProfileRow(profile = null) {
  if (hardwareExtraProfiles.children.length >= 8) {
    showHardwareSetupError('Up to 8 additional standard cube profiles are supported.');
    return;
  }
  const index = hardwareExtraProfiles.children.length + 1;
  const value = Number(profile?.resistance) > 0 ? Number(profile.resistance) : 15;
  const color = /^#[0-9a-f]{6}$/i.test(profile?.color ?? '') ? profile.color : '#348dc1';
  const row = document.createElement('div');
  row.className = 'hardware-extra-profile';
  row.innerHTML = `
    <div class="hardware-extra-profile__heading"><span><i class="hardware-setup-field__swatch"></i> STANDARD BLOCK / ${String(index).padStart(2, '0')}</span><button type="button" class="hardware-extra-profile__remove" aria-label="Remove standard cube profile">×</button></div>
    <div class="hardware-extra-profile__inputs"><label><span>RESISTANCE</span><input class="hardware-extra-profile__resistance" type="number" min="0.1" max="10000" step="any" value="${value}" required /> kΩ</label>
    <label><span>CUBE COLOR</span><input class="hardware-extra-profile__color" type="color" value="${color}" aria-label="Extra standard cube color" hidden /></label></div>`;
  const swatch = row.querySelector('.hardware-setup-field__swatch');
  row.querySelector('.hardware-extra-profile__color').addEventListener('input', (event) => { swatch.style.background = event.target.value; });
  swatch.style.background = color;
  makeHardwareColorPalette(row.querySelector('.hardware-extra-profile__color'), row, () => { swatch.style.background = row.querySelector('.hardware-extra-profile__color').value; });
  row.querySelector('.hardware-extra-profile__remove').addEventListener('click', () => {
    const openEditor = row.querySelector('.hardware-custom-color-panel.is-open');
    if (openEditor) openEditor.querySelector('.custom-color-close').click();
    row.remove();
    [...hardwareExtraProfiles.children].forEach((el, i) => {
      el.querySelector('.hardware-extra-profile__heading span').lastChild.textContent = ` STANDARD BLOCK / ${String(i + 1).padStart(2, '0')}`;
    });
    showHardwareSetupError('');
  });
  hardwareExtraProfiles.appendChild(row);
}
hardwareAddProfile.addEventListener('click', () => { showHardwareSetupError(''); addHardwareProfileRow(); });

function populateHardwareForm() {
  hardwareBoardWidth.value = String(HARDWARE_CONFIG.boardWidth);
  hardwareBoardDepth.value = String(HARDWARE_CONFIG.boardDepth);
  hardwareStandardOhms.value = String(HARDWARE_CONFIG.standardResistance);
  hardwareSupportOhms.value = String(HARDWARE_CONFIG.supportResistance);
  hardwareDefaultColor.value = HARDWARE_CONFIG.standardColor;
  updateHardwareDefaultColor();
  hardwareExtraProfiles.replaceChildren();
  for (const extra of HARDWARE_CONFIG.extras) addHardwareProfileRow(extra);
}

function readHardwareForm() {
  const boardWidth = Number(hardwareBoardWidth.value);
  const boardDepth = Number(hardwareBoardDepth.value);
  // Derive the displayed digital model directly from the physical sensor cells.
  const { width: digitalWidth, depth: digitalDepth } = hardwareDigitalDimensions(boardWidth, boardDepth);
  const standardResistance = Number(hardwareStandardOhms.value);
  const supportResistance = Number(hardwareSupportOhms.value);
  const extras = [...hardwareExtraProfiles.querySelectorAll('.hardware-extra-profile')].map((row) => ({
    resistance: Number(row.querySelector('.hardware-extra-profile__resistance').value),
    color: row.querySelector('.hardware-extra-profile__color').value,
  }));
  validateGridMapping(boardWidth, digitalWidth, digitalDepth, CONFIG.GRID_SIZE, boardDepth);
  if (boardWidth > CONFIG.WORKSPACE_COLUMNS || boardDepth > CONFIG.WORKSPACE_ROWS) {
    throw new Error('Sensor board exceeds the supported workspace dimensions.');
  }
  if (![standardResistance, supportResistance, ...extras.map((value) => value.resistance)]
    .every((value) => Number.isFinite(value) && value >= 0.1 && value <= 10000)) {
    throw new Error('Enter valid resistance readings greater than 0 (in kΩ).');
  }
  const profileValues = [standardResistance, supportResistance, ...extras.map((value) => value.resistance)];
  for (let i = 0; i < profileValues.length; i += 1) {
    for (let j = i + 1; j < profileValues.length; j += 1) {
      const ratio = Math.abs(profileValues[i] - profileValues[j]) / Math.min(profileValues[i], profileValues[j]);
      if (ratio < 0.12) throw new Error('Cube resistance values are too similar to distinguish reliably. Use a separation of at least 12%.');
    }
  }
  return {
    boardWidth, boardDepth, digitalWidth, digitalDepth,
    standardResistance, supportResistance,
    standardColor: hardwareDefaultColor.value,
    extras,
  };
}

function selectHardwareTab(which) {
  // Never expose simulator controls until an actual simulation session is running.
  const simulator = which === 'simulator' && simulationActive;
  // Keep the segmented thumb and content transition in sync, just like the
  // BLOCKS / SMOOTH control deck. Skip entrance motion when opening the dialog.
  const changed = hardwareSettingsTab.classList.contains('is-active') === simulator;
  hardwareModeTabs.classList.toggle('is-simulator', simulator);
  hardwareSetupForm.hidden = simulator;
  hardwareSimulationPanel.hidden = !simulator;
  hardwareSettingsTab.classList.toggle('is-active', !simulator);
  hardwareSettingsTab.setAttribute('aria-pressed', String(!simulator));
  hardwareSimulatorTab.classList.toggle('is-active', simulator);
  hardwareSimulatorTab.setAttribute('aria-pressed', String(simulator));
  // Make it unmistakable that this is the actual V4 virtual-sensor simulator.
  const dialogTitle = hardwareSetupModal.querySelector('#hardwareSetupTitle');
  const dialogLabel = hardwareSetupModal.querySelector('.hardware-setup-modal__header .panel-label');
  const dialogDescription = hardwareSetupModal.querySelector('#hardwareSetupDescription');
  if (dialogTitle) dialogTitle.innerHTML = simulator ? 'SIMULATOR <span>MODE</span>' : 'HARDWARE <span>MODE</span>';
  if (dialogLabel) dialogLabel.textContent = simulator ? 'SIMULATION / VIRTUAL SENSOR GRID' : 'SETUP / 01 — PHYSICAL INTERFACE';
  if (dialogDescription) dialogDescription.textContent = simulator
    ? 'Test physical cell readings and cube resistance profiles without an ESP32.'
    : 'Set your physical board size and block resistance profiles. The digital grid matches the sensor board automatically.';
  if (simulator) {
    renderSimulationControls();
    syncSimulatorPreflight();
  }
  // Changing tabs must not reopen halfway down the previous form.
  hardwareSetupModal.querySelector('.hardware-setup-modal__scroll')?.scrollTo({ top: 0 });
  if (changed && hardwareSetupModal.classList.contains('is-open') &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const incoming = simulator ? hardwareSimulationPanel : hardwareSetupForm;
    incoming.getAnimations().forEach((animation) => animation.cancel());
    incoming.animate([
      { opacity: 0.15, transform: 'translateY(8px)' },
      { opacity: 1, transform: 'translateY(0)' },
    ], { duration: 420, easing: 'cubic-bezier(.2,.85,.2,1)' });
  }
}
hardwareSettingsTab.addEventListener('click', () => selectHardwareTab('settings'));
hardwareSimulatorTab.addEventListener('click', () => selectHardwareTab('simulator'));

function requestHardwareConfiguration({ editing = false, target = 'esp', source = null } = {}) {
  window.clearTimeout(hardwareSetupCloseTimer);
  hardwareSetupMode = editing ? 'edit' : 'start';
  hardwareConnectionTarget = target;
  populateHardwareForm();
  showHardwareSetupError('');
  // One setup view before a session. Show both tabs only in a running demo;
  // a physical ESP32 session continues to use the settings form alone.
  hardwareModeTabs.hidden = true;
  hardwareSimulatorTab.hidden = true;
  hardwareModalStatus.lastChild.textContent = editing
    ? (simulationActive ? ' DEMO RUNNING' : ' ESP32 CONNECTED')
    : (target === 'simulation' ? ' VIRTUAL BOARD / OFFLINE' : ' PORT OPEN / SETUP REQUIRED');
  hardwareSubmitLabel.textContent = editing ? 'SAVE SETTINGS' : (target === 'simulation' ? 'START SIMULATION' : 'START HARDWARE MODE');
  hardwareSetupModal.classList.toggle('is-simulation-start', !editing && target === 'simulation');
  hardwareSetupModal.classList.toggle('is-settings-editing', editing);
  hardwareSetupFootnote.textContent = editing
    ? 'Changing the physical grid size resets the digital build; resistance and color edits keep existing cubes.'
    : 'Starting a new session refreshes the workspace and clears the digital plate.';
  selectHardwareTab('settings');
  hardwareSetupModal.hidden = false;
  prepareModalSourceMorph(hardwareSetupModal, source ?? (editing ? hardwareMenuButton : target === 'simulation' ? simulateHardwareButton : connectSerialButton));
  document.body.classList.add('modal-open');
  controls.enabled = false;
  requestAnimationFrame(() => {
    hardwareSetupModal.classList.add('is-open');
    (hardwareSetupForm.hidden ? hardwareSimulatorTab : hardwareBoardWidth).focus({ preventScroll: true });
  });
  return new Promise((resolve) => { resolveHardwareSetup = resolve; });
}

function finishHardwareSetup(configuration = null) {
  if (!resolveHardwareSetup) return;
  const resolve = resolveHardwareSetup;
  resolveHardwareSetup = null;
  hardwareSetupModal.classList.remove('is-open');
  document.body.classList.remove('modal-open');
  controls.enabled = true;
  hardwareSetupCloseTimer = window.setTimeout(() => { hardwareSetupModal.hidden = true; }, 510);
  resolve(configuration);
}

hardwareSetupForm.addEventListener('submit', (event) => {
  event.preventDefault();
  if (!resolveHardwareSetup || !hardwareSetupForm.reportValidity()) return;
  try {
    const config = readHardwareForm();
    showHardwareSetupError('');
    finishHardwareSetup(config);
  } catch (error) {
    showHardwareSetupError(error.message);
  }
});
[closeHardwareSetupButton, hardwareSetupBackdrop, cancelHardwareSetupButton].forEach((button) => {
  button.addEventListener('click', () => finishHardwareSetup());
});
hardwareSetupModal.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    event.preventDefault();
    event.stopPropagation();
    finishHardwareSetup();
  }
  if (event.key === 'Tab') {
    const focusable = [...hardwareSetupModal.querySelectorAll('button:not(:disabled):not([hidden]), input:not(:disabled):not([hidden]), select:not(:disabled):not([hidden])')]
      .filter((element) => element.getClientRects().length);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

async function connectSerial() {
  if (!IS_HARDWARE_BUILDER) return;
  if (!('serial' in navigator) || !window.isSecureContext) {
    setFeedback('WEB SERIAL UNAVAILABLE', 'Connect using Chrome or Edge from localhost or HTTPS.', true);
    return;
  }
  if (serialConnected || simulationActive || serialSetupPending) return;
  try {
    serialPort = await navigator.serial.requestPort();
    if (!serialPort) return;
    await serialPort.open({ baudRate: Number(serialBaud.value) || 115200 });
    serialSetupPending = true;
    updateSerialControls();
    const config = await requestHardwareConfiguration({ target: 'esp' });
    serialSetupPending = false;
    if (!config) {
      await serialPort.close();
      serialPort = null;
      updateSerialControls();
      setFeedback('HARDWARE SETUP CANCELED', 'The serial port has been closed.');
      return;
    }
    // Keep the live physical sensor model visible in Blocks / ALL view.
    if (exportSurfaceMode !== 'voxel') setExportSurfaceMode('voxel');
    // All new connections start clean. Reloading the page would close Web Serial.
    applyHardwareConfiguration(config, { reset: true });
    serialConnected = true;
    serialKeepReading = true;
    serialBuffer = '';
    updateSerialControls();
    systemStatus.textContent = 'ESP32 CONNECTED / PLATE CLEARED';
    setFeedback('HARDWARE MODE', `${config.boardWidth}×${config.boardDepth} physical board mapped directly to the digital workspace.`);
    serialReadTask = readSerialLoop();
  } catch (error) {
    console.error(error);
    if (resolveHardwareSetup) finishHardwareSetup();
    serialSetupPending = false;
    if (serialPort) { try { await serialPort.close(); } catch { /* port already closed */ } }
    serialPort = null;
    serialConnected = false;
    serialKeepReading = false;
    setSerialStatus('CONNECT FAILED', 'error');
    setFeedback('ESP32 CONNECTION FAILED', error instanceof Error ? error.message : 'COULD NOT OPEN SERIAL PORT', true);
    updateSerialControls();
  }
}

async function startSimulation() {
  if (HARDWARE_ONLY_EDITION) return;
  if (serialConnected || simulationActive || serialSetupPending) return;
  serialSetupPending = true;
  updateSerialControls();
  const config = await requestHardwareConfiguration({ target: 'simulation' });
  serialSetupPending = false;
  if (!config) { updateSerialControls(); return; }
  // Keep the incoming sensor state visible in Blocks / ALL view.
  if (exportSurfaceMode !== 'voxel') setExportSurfaceMode('voxel');
  applyHardwareConfiguration(config, { reset: true });
  simulationActive = true;
  simulationSelectedChannel = 0;
  updateSerialControls();
  renderSimulationControls();
  systemStatus.textContent = 'SIMULATOR CONNECTED / PLATE CLEARED';
  setFeedback('SIMULATION MODE', 'Virtual ESP32 active. Select a sensor cell, then place or remove cubes in the Simulator menu.');
  // Starting simulation previously closed its setup form and left the actual
  // simulator tab hidden behind HARDWARE MENU. Open it straight away.
  void editHardwareSettings({ initialTab: 'simulator' });
}

async function editHardwareSettings({ initialTab = 'settings' } = {}) {
  if (!(serialConnected || simulationActive) || resolveHardwareSetup) return;
  const pending = requestHardwareConfiguration({ editing: true, target: simulationActive ? 'simulation' : 'esp', source: hardwareMenuButton });
  if (initialTab === 'simulator' && simulationActive) selectHardwareTab('simulator');
  const updated = await pending;
  if (!updated) return;
  const cleared = applyHardwareConfiguration(updated);
  setFeedback('HARDWARE SETTINGS SAVED', cleared
    ? 'Board dimensions changed, so the digital plate was reset.'
    : 'Resistance profiles and colors updated. New readings use these settings.');
}

function syncSimulatorPreflight() {
  const preflight = document.querySelector('#hardwareSimulatorPreflight');
  const start = document.querySelector('#hardwareSimulatorStart');
  const note = document.querySelector('#hardwareSimulatorPreviewText');
  if (!preflight || !start || !note) return;
  preflight.hidden = simulationActive;
  const canStart = !simulationActive && hardwareSetupMode === 'start' && hardwareConnectionTarget === 'simulation';
  start.hidden = !canStart;
  note.textContent = simulationActive
    ? 'VIRTUAL SENSOR GRID ONLINE'
    : canStart
      ? 'PREVIEW / REVIEW YOUR SETTINGS OR START THE VIRTUAL BOARD'
      : 'PREVIEW ONLY / START A SIMULATION FROM THE ESP32 CONTROLS';
  [hardwareSimProfile, hardwareSimResistance, hardwareSimAdd, hardwareSimRemove, hardwareSimClear].forEach((control) => {
    control.disabled = !simulationActive;
  });
}

document.querySelector('#hardwareSimulatorStart')?.addEventListener('click', () => {
  if (!resolveHardwareSetup || hardwareConnectionTarget !== 'simulation' || hardwareSetupMode !== 'start') return;
  if (!hardwareSetupForm.reportValidity()) {
    selectHardwareTab('settings');
    hardwareSetupForm.querySelector(':invalid')?.focus();
    return;
  }
  try {
    finishHardwareSetup(readHardwareForm());
  } catch (error) {
    showHardwareSetupError(error instanceof Error ? error.message : 'Please check your grid settings.');
    selectHardwareTab('settings');
  }
});

function renderSimulationControls() {
  // Before a session starts, show a read-only sensor-board preview so the
  // Simulator tab is useful and discoverable from the very first opening.
  const width = simulationActive ? HARDWARE_CONFIG.boardWidth : Math.max(1, Math.min(8, Number(hardwareBoardWidth.value) || HARDWARE_CONFIG.boardWidth));
  const depth = simulationActive ? HARDWARE_CONFIG.boardDepth : Math.max(1, Math.min(8, Number(hardwareBoardDepth.value) || HARDWARE_CONFIG.boardDepth));
  simulationSelectedChannel = Math.min(simulationSelectedChannel, width * depth - 1);
  hardwareSimCells.style.setProperty('--board-width', String(width));
  hardwareSimCells.replaceChildren();
  for (let channel = 0; channel < width * depth; channel += 1) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(channel + 1).padStart(2, '0');
    button.className = channel === simulationSelectedChannel ? 'is-active' : '';
    button.setAttribute('aria-label', `Physical cell ${channel + 1}`);
    button.addEventListener('click', () => {
      simulationSelectedChannel = channel;
      renderSimulationControls();
    });
    hardwareSimCells.appendChild(button);
  }
  const previousSelection = Number(hardwareSimProfile.value);
  hardwareSimProfile.replaceChildren();
  const previewProfiles = simulationActive ? BLOCK_PROFILES : [
    { type: 'standard', resistance: Number(hardwareStandardOhms.value) || 10 },
    { type: 'support', resistance: Number(hardwareSupportOhms.value) || 5.1 },
    ...[...hardwareExtraProfiles.querySelectorAll('.hardware-extra-profile__resistance')].map((input) => ({
      type: 'standard', resistance: Number(input.value) || 10,
    })),
  ];
  previewProfiles.forEach((profile, index) => {
    const option = document.createElement('option');
    option.value = String(index);
    option.textContent = `${profile.type === 'support' ? 'SUPPORT' : 'STANDARD'} / ${profile.resistance} kΩ${index > 1 ? ' / CUSTOM' : ''}`;
    hardwareSimProfile.appendChild(option);
  });
  hardwareSimProfile.value = Number.isInteger(previousSelection) && previousSelection >= 0 && previousSelection < previewProfiles.length ? String(previousSelection) : '0';
  hardwareSimResistance.value = String(previewProfiles[Number(hardwareSimProfile.value)].resistance);
  const coords = simulationActive ? simulationCellCoordinates(simulationSelectedChannel) : {
    x: simulationSelectedChannel % width,
    y: Math.floor(simulationSelectedChannel / width),
  };
  const height = simulationActive ? getSimulationColumnHeight(coords.x, coords.y) : 0;
  hardwareSimFeedback.textContent = simulationActive
    ? `CELL ${simulationSelectedChannel + 1} / [${coords.x}, ${coords.y}] — ${height} CUBE${height === 1 ? '' : 'S'}`
    : `PREVIEW / ${width} × ${depth} SENSOR GRID — START SIMULATION TO PLACE CUBES`;
}
function simulationCellCoordinates(ch) {
  return sensorChannelToCell(ch, HARDWARE_CONFIG.boardWidth, model.gridWidth, model.gridDepth, HARDWARE_CONFIG.boardDepth);
}
function getSimulationColumnHeight(x, y) {
  let height = 0;
  while (height < CONFIG.MAX_HEIGHT && model.has(x, y, height)) height += 1;
  return height;
}
hardwareSimProfile.addEventListener('change', () => {
  const profile = BLOCK_PROFILES[Number(hardwareSimProfile.value)];
  if (profile) hardwareSimResistance.value = String(profile.resistance);
});
function runSimulationAction(action) {
  if (!simulationActive) return;
  const { x, y } = simulationCellCoordinates(simulationSelectedChannel);
  const height = getSimulationColumnHeight(x, y);
  if (action === 'add' && height >= CONFIG.MAX_HEIGHT) {
    hardwareSimFeedback.textContent = `MAX HEIGHT ${CONFIG.MAX_HEIGHT} REACHED`;
    return;
  }
  if (action === 'remove' && height === 0) {
    hardwareSimFeedback.textContent = 'CELL IS EMPTY';
    return;
  }
  const measured = Number(hardwareSimResistance.value);
  if (!Number.isFinite(measured) || measured <= 0) {
    hardwareSimFeedback.textContent = 'ENTER A POSITIVE RESISTANCE VALUE';
    return;
  }
  const rejected = applyHardwareEvent({
    ch: simulationSelectedChannel, action, z: action === 'add' ? height : height - 1,
    uS: 1000 / measured,
  });
  renderSimulationControls();
  hardwareSimResistance.value = String(measured);
  if (rejected.length) hardwareSimFeedback.textContent = rejected[0].reason ?? 'SENSOR READING REJECTED';
}
hardwareSimAdd.addEventListener('click', () => runSimulationAction('add'));
hardwareSimRemove.addEventListener('click', () => runSimulationAction('remove'));
hardwareSimClear.addEventListener('click', () => {
  if (!simulationActive) return;
  applyHardwareEvent({ action: 'clear' });
  renderSimulationControls();
  hardwareSimFeedback.textContent = 'DIGITAL PLATE CLEARED';
});

async function disconnectSerial({ silent = false } = {}) {
  const wasSimulation = simulationActive;
  simulationActive = false;
  serialKeepReading = false;
  if (serialReader) { try { await serialReader.cancel(); } catch { /* port may already be gone */ } }
  if (serialReadTask) { try { await serialReadTask; } catch { /* handled by read loop */ } serialReadTask = null; }
  if (serialPort) { try { await serialPort.close(); } catch { /* already disconnected */ } }
  serialPort = null;
  serialReader = null;
  serialConnected = false;
  serialBuffer = '';
  resetHistoryToCurrent();
  updateSerialControls();
  if (!silent) {
    systemStatus.textContent = wasSimulation ? 'SIMULATION ENDED' : 'ESP32 DISCONNECTED';
    setFeedback(IS_HARDWARE_BUILDER ? 'ESP32 DISCONNECTED' : 'DIGITAL MODE', IS_HARDWARE_BUILDER ? 'Sensor input stopped. Your last physical model remains available to save or export.' : 'Hardware input stopped. Digital editing and Undo / Redo are active again.');
  }
}

connectSerialButton.addEventListener('click', connectSerial);
simulateHardwareButton.addEventListener('click', startSimulation);
hardwareMenuButton.addEventListener('click', () => {
  void editHardwareSettings({ initialTab: simulationActive ? 'simulator' : 'settings' });
});
disconnectSerialButton.addEventListener('click', () => disconnectSerial());

autosaveToggle.addEventListener('click', () => setAutosaveEnabled(!autosaveEnabled));

openRecentModelsButton.addEventListener('click', () => openRecentModal(openRecentModelsButton));
closeRecentModalButton.addEventListener('click', closeRecentModal);
recentModalBackdrop.addEventListener('click', closeRecentModal);
clearRecentModelsButton.addEventListener('click', async () => {
  if (!(await requestProjectAction({title:'CLEAR ALL RECENTS?', description:'Remove every saved project and checkpoint from this builder’s library.', confirmLabel:'CLEAR LIBRARY', eyebrow:'PROJECT LIBRARY / DELETE', danger:true, warning:'This permanently deletes this builder’s local projects. Backup your library first.'}))) return;
  clearedRecentsDuringHydration = true;
  recentModelsMemory = [];
  safeStorageRemove(RECENT_MODELS_STORAGE_KEY);
  void eraseAllRecentModels(BUILDER_MODE);
  setActiveRecentModel(null);
  renderRecentModels();
  setAutosaveUi('saved', 'Recent models cleared');
  if (libraryStatus) libraryStatus.textContent = 'LIBRARY CLEARED / THIS BUILDER';
});

backupLibraryButton?.addEventListener('click', async () => {
  try {
    backupLibraryButton.disabled = true;
    // Flush pending updates and include synchronous local cache if necessary.
    await archiveRecentModels(BUILDER_MODE, readRecentModels());
    const entries = await listEntireProjectLibrary();
    if (!entries.length) throw new Error('Save a project first. Your library is empty.');
    const backup = buildLibraryBackup(entries);
    downloadBlob(backup, 'zip', {filename:`build-it-live-library-${new Date().toISOString().slice(0,10)}.zip`});
    if (libraryStatus) libraryStatus.textContent = `BACKUP READY / ${entries.length} PROJECTS`;
  } catch (error) { if (libraryStatus) libraryStatus.textContent = error instanceof Error ? error.message : 'Backup failed'; }
  finally {backupLibraryButton.disabled = false;}
});
restoreLibraryButton?.addEventListener('click', () => restoreLibraryInput?.click());
restoreLibraryInput?.addEventListener('change', async () => {
  const file = restoreLibraryInput.files?.[0];
  restoreLibraryInput.value = '';
  if (!file) return;
  try {
    const entries = await readStoredZipManifest(await file.arrayBuffer());
    if (!(await requestProjectAction({title:'RESTORE PROJECT LIBRARY?', description:`Import ${entries.length} saved project(s). Existing projects will be kept and duplicates skipped.`, confirmLabel:'RESTORE PROJECTS', eyebrow:'PROJECT LIBRARY / IMPORT'}))) return;
    const result = await importProjectLibrary(entries);
    await hydrateRecentLibrary();
    if (libraryStatus) libraryStatus.textContent = `${result.added} IMPORTED / ${result.skipped} ALREADY SAVED`;
  } catch (error) { if (libraryStatus) libraryStatus.textContent = error instanceof Error ? error.message : 'Cannot read backup'; }
});

window.addEventListener('keydown', (event) => {
  if (document.querySelector('#projectActionDialog')?.open) return;
  if((event.ctrlKey||event.metaKey)&&['z','y'].includes(event.key.toLowerCase())&&event.target?.closest?.('input,textarea,select,[contenteditable="true"]'))return;
  if (!hardwareSetupModal.hidden) return;
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault();
    try {
      const filename = saveNativeProject();
      systemStatus.textContent = 'PROJECT SAVED';
      setFeedback('PROJECT SAVED', `${filename} is an editable Build It Live project.`);
    } catch (error) {
      setFeedback('COULD NOT SAVE PROJECT', error instanceof Error ? error.message : 'PROJECT SAVE FAILED', true);
    }
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z') {
    event.preventDefault();
    if (event.shiftKey) redoBuild();
    else undoBuild();
  }

  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'y') {
    event.preventDefault();
    redoBuild();
  }

  if (event.key === 'Escape' && !saveModal.hidden) {
    closeSaveModal();
  }

  if (event.key === 'Escape' && !loadModal.hidden) {
    closeLoadModal();
  }

  if (event.key === 'Escape' && !recentModal.hidden) {
    closeRecentModal();
  }
});

// -----------------------------------------------------------------------------
// 11. FUTURE ESP32 / SERIAL ADAPTER HOOK
// -----------------------------------------------------------------------------
// This public adapter makes the separation visible while prototyping.
// Later your serial parser can call:
//   window.digitalTwin.applyHardwareFrame([...blocksFromESP32])
// without touching any Three.js placement code.
function getMissingLayerSupportCells(){
 const heights=new Map();for(const b of model.getBlocks()){const key=`${b.x},${b.y}`;heights.set(key,Math.max(heights.get(key)??-1,b.z));}
 const missing=[];for(const [key,height]of heights){const [x,y]=key.split(',').map(Number);for(let z=0;z<height;z++)if(!model.has(x,y,z))missing.push({x,y,z});}return missing.sort((a,b)=>a.z-b.z||a.x-b.x||a.y-b.y);
}
function pulseLayerRepair(){repairBlinkUntil=performance.now()+2200;const notice=document.querySelector('#layerRepairNotice');notice?.classList.remove('repair-attention');if(notice){void notice.offsetWidth;notice.classList.add('repair-attention');}announceLayerRepair();}
function refreshLayerRepairNotice(){const missing=IS_HARDWARE_BUILDER||exactImportedStl?[]:getMissingLayerSupportCells(),notice=document.querySelector('#layerRepairNotice'),text=document.querySelector('#layerRepairText');if(notice)notice.hidden=!missing.length;if(text&&missing.length){const first=missing[0];text.textContent=`LAYER ${String(first.z+1).padStart(2,'0')} / CELL [${first.x}, ${first.y}] · ${missing.length} replacement${missing.length===1?'':'s'} needed. Place Standard or Support in the outlined cell. Blocks above remain fixed; other actions unlock after replacement.`;}layerRepairMarkers.traverse(m=>{m.geometry?.dispose();m.material?.dispose();});layerRepairMarkers.clear();
 for(const cell of missing){const marker=new THREE.Mesh(new THREE.BoxGeometry(CONFIG.CELL_WIDTH*.97,CONFIG.CELL_HEIGHT*.97,CONFIG.CELL_DEPTH*.97),new THREE.MeshBasicMaterial({color:0xff321c,transparent:true,opacity:.22,depthTest:false,depthWrite:false}));marker.position.copy(modelToWorld(cell.x,cell.y,cell.z));marker.userData.repairCell=cell;marker.renderOrder=100;const edge=new THREE.LineSegments(new THREE.EdgesGeometry(marker.geometry),new THREE.LineBasicMaterial({color:0xff321c,depthTest:false}));edge.renderOrder=101;marker.add(edge);layerRepairMarkers.add(marker);}return missing;}
function announceLayerRepair(){const missing=refreshLayerRepairNotice();if(missing.length){const first=missing[0];setFeedback('REPLACEMENT BLOCK REQUIRED',`Place a block at [${first.x}, ${first.y}, ${first.z}] on layer ${first.z+1}; it supports blocks above.`,true);}return missing;}
function editSelectedLayerCell(action,x,y,type='standard'){
 if(!layerEditEnabled||activeLayerView===null||IS_HARDWARE_BUILDER||serialConnected||simulationActive||exactImportedStl||exportSurfaceMode==='soft1')return {valid:false,reason:'Enable Digital Layer Editing first.'};
 const pending=getMissingLayerSupportCells();if(pending.length&&(action!=='place'||!pending.some(c=>c.x===x&&c.y===y&&c.z===activeLayerView))){pulseLayerRepair();return {valid:false,reason:'Replace the highlighted supporting cell before another edit.'};}
 let result;if(action==='remove'){
  if(!model.has(x,y,activeLayerView))return {valid:false,reason:'No block in this cell.'};
  model.replaceExact(model.getBlocks().filter(b=>!(b.x===x&&b.y===y&&b.z===activeLayerView)));
  result={valid:true,reason:'Layer cell cleared. Other blocks kept at their coordinates.'};
 }else result=placeStudioBlock(x,y,activeLayerView,type,type==='standard'?selectedBlockColor:null);
 if(result.valid){recordHistory();syncViewFromModel();}setFeedback(result.valid?'LAYER UPDATED':'PLACEMENT BLOCKED',result.reason,!result.valid);announceLayerRepair();return result;
}
function setLayerEditing(enabled){if(!enabled&&!IS_HARDWARE_BUILDER&&getMissingLayerSupportCells().length){pulseLayerRepair();return layerEditEnabled;}layerEditEnabled=Boolean(enabled)&&activeLayerView!==null&&!IS_HARDWARE_BUILDER&&!serialConnected&&!simulationActive&&!exactImportedStl&&exportSurfaceMode!=='soft1';updateOrganicEditingLocks();setFeedback(layerEditEnabled?'LAYER EDITING ON':'LAYER EDITING OFF',layerEditEnabled?`Editing layer ${activeLayerView+1}. Hidden upper blocks are protected.`:'Layer view is inspection-only.');announceLayerRepair();return layerEditEnabled;}
document.querySelector('#repairLayerSupport')?.addEventListener('click',()=>{const first=getMissingLayerSupportCells()[0];if(first){setLayerView(first.z+1);setLayerEditing(true);pulseLayerRepair();}});
document.querySelector('#editLayerToggle')?.addEventListener('click',()=>setLayerEditing(!layerEditEnabled));
function blockDuringLayerRepair(event){
 if(IS_HARDWARE_BUILDER||!getMissingLayerSupportCells().length)return;
 const target=event.target;if(target===renderer.domElement||target.closest?.('#repairLayerSupport,[data-tool="standard"],[data-tool="support"],.studio-mobile-switch,.rail-collapse,.studio-canvas-toggle'))return;
 if(event.type==='keydown'&&['1','2','Tab','Shift','Alt','Control'].includes(event.key))return;
 const actionable=event.type==='keydown'||target.closest?.('button,a,input,select,[role="button"]');if(actionable){event.preventDefault();event.stopImmediatePropagation();pulseLayerRepair();}
}
for(const type of ['pointerdown','click','input','change','keydown'])document.addEventListener(type,blockDuringLayerRepair,true);
window.digitalTwin = {
  getSmoothPreviewInfo:()=>realtimeOrganicObject?{quality:'export',...realtimeOrganicObject.children[0].geometry.userData,vertices:realtimeOrganicObject.children[0].geometry.getAttribute('position').count}:null,
  setLayerEditing, editLayerCell:editSelectedLayerCell, getMissingLayerSupports:getMissingLayerSupportCells,
  getHardwareMonitorState: () => IS_HARDWARE_BUILDER ? getHardwareMonitorState() : null,
  setCalibratedProfile: (type, kOhms) => updateHardwareProfileFromReading(type, kOhms),
  captureHardwareModelImage: () => captureHardwareModelImage(),
  getState: () => model.toJSON(),
  getProjectDocument: () => makeProjectDocument(),
  getLegacySaveDocument: () => makeModelDocument(),
  saveProject: () => saveNativeProject(),
  exportModel: (format = 'stl') => exportModel(format),
  openExportPanel: () => openSaveModal(),
  openLoadProjectPanel: () => openLoadModal(),
  applyHardwareFrame: (blocks) => IS_HARDWARE_BUILDER ? applyHardwareFrame(blocks, 'HARDWARE FRAME') : [],
  connectSerial: () => connectSerial(),
  disconnectSerial: () => disconnectSerial(),
  setLayerView: (layer = 0) => setLayerView(layer),
  setGridSize: (size) => setActiveGridSize(size),
  setExportSurface: (mode) => setExportSurfaceMode(mode),
  undo: () => undoBuild(),
  redo: () => redoBuild(),
  autosaveNow: () => persistCurrentModel({ force: true }),
  setAutosaveEnabled: (enabled) => setAutosaveEnabled(enabled),
  openRecentModels: () => openRecentModal(),
  config: { ...CONFIG },
};

window.dispatchEvent(new Event('buildit:engine-ready'));

// -----------------------------------------------------------------------------
// 12. RESIZE + RENDER LOOP
// -----------------------------------------------------------------------------
// Synchronise camera projection and WebGL drawing-buffer dimensions in the SAME
// animation frame. The old implementation changed camera.aspect during the
// CSS rail transition but waited 115ms to resize the drawing buffer, then
// called setSize() with its default updateStyle=true. That fixed the canvas
// to a pixel width and made the model appear to snap/recenter.
//
// Reading the *current* viewport size every render frame follows the grid's
// 390ms easing curve exactly, without changing camera position, user orbit,
// model state, or scroll position. Avoid reallocation when dimensions match.
let lastViewportWidth = 0;
let lastViewportHeight = 0;
let lastViewportCenterShift = Number.NaN;
const sceneToolsRail = document.querySelector<HTMLElement>('.studio-sidebar--tools');
const sceneInspectorRail = document.querySelector<HTMLElement>('.studio-sidebar--inspector');
const desktopSceneQuery = window.matchMedia('(min-width: 861px)');

function syncMainViewport() {
  // The WebGL canvas now extends underneath both translucent side rails.
  // Offset the camera's projected center into the usable middle region so
  // panels never obscure the model and it tracks their animated widths.
  const w = Math.max(1, viewport.clientWidth);
  const h = Math.max(1, viewport.clientHeight);
  const leftWidth = desktopSceneQuery.matches ? (sceneToolsRail?.getBoundingClientRect().width ?? 0) : 0;
  const rightWidth = desktopSceneQuery.matches ? (sceneInspectorRail?.getBoundingClientRect().width ?? 0) : 0;
  const centerShift = (leftWidth - rightWidth) / 2;
  const changedSize = w !== lastViewportWidth || h !== lastViewportHeight;
  if (!changedSize && Math.abs(centerShift - lastViewportCenterShift) < 0.05) return;

  lastViewportWidth = w;
  lastViewportHeight = h;
  lastViewportCenterShift = centerShift;
  // View offset moves the projected model without modifying the orbit target
  // or camera position. Mouse picking continues to use the entire canvas.
  camera.setViewOffset(w, h, -centerShift, 0, w, h);
  if (changedSize) {
    // false keeps dimensions under CSS control and avoids a last-frame jump.
    renderer.setSize(w, h, false);
  }
}

window.addEventListener('resize', syncMainViewport, { passive: true });
syncMainViewport();
function refreshMeasurementBounds(){
 if(!modelDimensionsVisible)return;
 if(exactImportedStl)measurementBox=new THREE.Box3().setFromObject(exactStlGroup);
 else if(exportSurfaceMode==='soft1'&&realtimeOrganicObject)measurementBox=new THREE.Box3().setFromObject(realtimeOrganicObject);
 else {measurementBox=new THREE.Box3();for(const b of model.getBlocks()){const c=modelToWorld(b.x,b.y,b.z),half=new THREE.Vector3(CONFIG.CELL_WIDTH/2,CONFIG.CELL_HEIGHT/2,CONFIG.CELL_DEPTH/2);measurementBox.expandByPoint(c.clone().sub(half));measurementBox.expandByPoint(c.clone().add(half));}}
 drawModelMeasurements();
}
function positionModelMeasurementsCard(hud){
 if(hud.hidden)return;const button=document.querySelector('#modelDimensionsToggle'),scene=document.querySelector('.studio-scene');if(!button||!scene)return;const anchor=button.getBoundingClientRect(),area=scene.getBoundingClientRect();hud.style.top=`${anchor.bottom-area.top+22}px`;hud.style.left=`${Math.max(12,anchor.right-area.left-hud.offsetWidth)}px`;
}
function drawModelMeasurements(){
 const svg=document.querySelector('#modelMeasurementsSvg'),hud=document.querySelector('#modelMeasurementsCard');if(!svg||!hud)return;
 const visible=modelDimensionsVisible&&measurementBox&&!measurementBox.isEmpty();svg.style.display=visible?'block':'none';svg.setAttribute('aria-hidden',String(!visible));hud.hidden=!modelDimensionsVisible&&!measurementCardClosing;if(!visible){svg.innerHTML='';if(modelDimensionsVisible)document.querySelector('#modelDimensionsValues').textContent='No model to measure';positionModelMeasurementsCard(hud);return;}
 const size=measurementBox.getSize(new THREE.Vector3()),dimensions=[size.x,size.z,size.y],units=measurementUnit==='mm'?dimensions.map(v=>v*CONFIG.PHYSICAL_BLOCK_MM):dimensions.map((v,i)=>v/[CONFIG.CELL_WIDTH,CONFIG.CELL_DEPTH,CONFIG.CELL_HEIGHT][i]);
 const labels=units.map((v,i)=>`${['W','D','H'][i]} ${Number(v.toFixed(measurementUnit==='mm'?1:2))} ${measurementUnit==='mm'?'mm':'cells'}`);
 document.querySelector('#modelDimensionsValues').textContent=labels.join(' · ');positionModelMeasurementsCard(hud);
 const {min,max}=measurementBox,pad=CONFIG.CELL_DEPTH*.4,w=renderer.domElement.clientWidth,h=renderer.domElement.clientHeight;if(!w||!h)return;svg.setAttribute('viewBox',`0 0 ${w} ${h}`);
 const project=v=>{const q=new THREE.Vector3(...v).project(camera);return {x:(q.x+1)*w/2,y:(1-q.y)*h/2,z:q.z};};
 const lines=[[[min.x,min.y,max.z+pad],[max.x,min.y,max.z+pad]],[[min.x-pad,min.y,min.z],[min.x-pad,min.y,max.z]],[[max.x+pad,min.y,min.z],[max.x+pad,max.y,min.z]]];
 svg.innerHTML=lines.map(([a,b],i)=>{const p=project(a),q=project(b);if(p.z< -1||p.z>1||q.z< -1||q.z>1)return '';return `<line x1="${p.x}" y1="${p.y}" x2="${q.x}" y2="${q.y}"/><text x="${(p.x+q.x)/2+(i===2?16:0)}" y="${(p.y+q.y)/2+(i===0?18:-10)}" text-anchor="middle">${labels[i]}</text>`;}).join('');
}
document.querySelector('#modelDimensionsToggle')?.addEventListener('click',()=>{
 const hud=document.querySelector('#modelMeasurementsCard'),generation=++measurementCardGeneration;
 const previous=measurementCardAnimation?getComputedStyle(hud):null;
 const from=previous?{opacity:previous.opacity,transform:previous.transform}:null;
 measurementCardAnimation?.cancel();measurementCardAnimation=null;
 modelDimensionsVisible=!modelDimensionsVisible;
 const reduced=matchMedia('(prefers-reduced-motion:reduce)').matches;
 measurementCardClosing=!modelDimensionsVisible&&!reduced;
 document.querySelector('#modelDimensionsToggle').setAttribute('aria-pressed',String(modelDimensionsVisible));
 hud.inert=!modelDimensionsVisible;
 refreshMeasurementBounds();drawModelMeasurements();
 if(reduced)return;
 const hidden={opacity:0,transform:'translateY(-6px) scale(.98)'},shown={opacity:1,transform:'translateY(0) scale(1)'};
 const animation=hud.animate([from||(modelDimensionsVisible?hidden:shown),modelDimensionsVisible?shown:hidden],{duration:modelDimensionsVisible?220:160,easing:'cubic-bezier(.22,.78,.2,1)',fill:'both'});
 measurementCardAnimation=animation;
 animation.onfinish=()=>{if(generation!==measurementCardGeneration)return;measurementCardClosing=false;hud.hidden=!modelDimensionsVisible;animation.cancel();measurementCardAnimation=null;};
});
document.querySelector('#measurementUnits')?.addEventListener('click',()=>{measurementUnit=measurementUnit==='mm'?'cells':'mm';document.querySelector('#measurementUnits').textContent=measurementUnit==='mm'?'MM / switch to cells':'CELLS / switch to mm';drawModelMeasurements();});

function animate() {
  const blink=performance.now()<repairBlinkUntil;layerRepairMarkers.children.forEach(m=>{m.material.opacity=blink?.13+.45*(.5+.5*Math.sin(performance.now()/95)):.22;});
  syncMainViewport();
  controls.update();
  renderer.render(scene, camera);
  drawModelMeasurements();
}
renderer.setAnimationLoop(animate);

// Full-page navigation must not discard the pending block snapshot. This also
// preserves the current mode even when a user switches pages immediately.
window.addEventListener('pagehide', () => {
  if (autosaveTimer !== null && autosaveEnabled && !exactImportedStl) {
    window.clearTimeout(autosaveTimer);
    autosaveTimer = null;
    persistCurrentModel();
  }
});


// Studio tools share the model, but previews never write to it.
let studioMirror = 'off';
function studioLockReason() {
 if (IS_HARDWARE_BUILDER || serialConnected || simulationActive) return 'Physical input controls this model. Editing tools are available in Digital Builder.';
 if (exactImportedStl) return 'Editing tools require a block model.';
 if (activeLayerView !== null || exportSurfaceMode === 'soft1') return 'Switch to Blocks and ALL layers before editing.';
 return '';
}
function placeStudioBlock(x,y,z,type,color) {
 if (studioMirror === 'off' || IS_HARDWARE_BUILDER) return model.placeBlock(x,y,z,type,color);
 const points=[[x,y,z]];
 if(studioMirror.includes('x'))points.push([model.gridWidth-1-x,y,z]);
 if(studioMirror.includes('y'))points.push([x,model.gridDepth-1-y,z]);
 if(studioMirror==='xy')points.push([model.gridWidth-1-x,model.gridDepth-1-y,z]);
 const unique=[...new Map(points.map(p=>[p.join(','),p])).values()];
 for(const p of unique){const result=model.validatePlacement(...p);if(!result.valid)return result;}
 for(const p of unique)model.placeBlock(...p,type,color);
 return {valid:true,reason:'MIRRORED BLOCKS PLACED'};
}
const studioPreview = new THREE.Group();scene.add(studioPreview);
const studioHighlights = new THREE.Group();scene.add(studioHighlights);
const warningHighlightBar=document.createElement('div');warningHighlightBar.className='warning-highlight-bar';warningHighlightBar.hidden=true;warningHighlightBar.innerHTML='<span></span><button type="button" id="clearWarningHighlight">CLEAR HIGHLIGHT ×</button>';document.querySelector('.studio-scene').append(warningHighlightBar);
warningHighlightBar.querySelector('button').addEventListener('click',()=>{highlightStudioBlocks([]);setFeedback('HIGHLIGHT CLEARED','Printability outlines hidden.');});
window.addEventListener('keydown',event=>{if(event.key==='Escape'&&!warningHighlightBar.hidden)highlightStudioBlocks([]);});
let previewVisibility=null;
function clearStudioGroup(group){for(const child of group.children){if(child.userData.studioDisposable){child.geometry.dispose();child.material.dispose();}}group.clear();}
function highlightStudioBlocks(blocks){warningHighlightBar.hidden=true;clearStudioGroup(studioHighlights);for(const b of blocks){const line=new THREE.LineSegments(new THREE.EdgesGeometry(blockGeometry),new THREE.LineBasicMaterial({color:0xe93222,depthTest:false}));line.position.copy(modelToWorld(b.x,b.y,b.z));line.scale.setScalar(1.025);line.renderOrder=100;line.userData.studioDisposable=true;studioHighlights.add(line);}}
function previewStudioBlocks(blocks){clearStudioGroup(studioPreview);if(blocks===null){if(previewVisibility){[blocksGroup,realtimeOrganicGroup,exactStlGroup].forEach((g,i)=>g.visible=previewVisibility[i]);previewVisibility=null;}return;}
 if(!previewVisibility)previewVisibility=[blocksGroup.visible,realtimeOrganicGroup.visible,exactStlGroup.visible];[blocksGroup,realtimeOrganicGroup,exactStlGroup].forEach(g=>g.visible=false);
 for(const b of blocks){const mesh=new THREE.Mesh(blockGeometry,b.type==='support'?supportMaterial:getStandardBlockMaterial(b.color));mesh.position.copy(modelToWorld(b.x,b.y,b.z));studioPreview.add(mesh);}}
function commitStudioBlocks(blocks,settle=false){const reason=studioLockReason();if(reason)throw Error(reason);if(!blocks.every(b=>[b.x,b.y,b.z].every(Number.isInteger)))throw Error('Use whole grid steps.');
 if(settle){const columns=new Map();for(const b of blocks){const k=`${b.x},${b.y}`;if(!columns.has(k))columns.set(k,[]);columns.get(k).push(b);}blocks=[...columns.values()].flatMap(column=>column.sort((a,b)=>a.z-b.z).map((b,z)=>({...b,z})));}
 const test=new VoxelModel({gridSize:model.gridSize,maxHeight:CONFIG.MAX_HEIGHT});test.setGridDimensions(model.gridWidth,model.gridDepth);
 for(const b of [...blocks].sort((a,b)=>a.z-b.z)){const result=test.placeBlock(b.x,b.y,b.z,b.type,b.color);if(!result.valid)throw Error(result.reason+' at '+[b.x,b.y,b.z].join(', '));}
 model.replaceExact(blocks);recordHistory();syncViewFromModel();setFeedback('BUILD UPDATED','Transform applied. Undo is available.');}
let studioSelectCallback=null;
renderer.domElement.addEventListener('click',event=>{if(event.shiftKey){event.preventDefault();event.stopImmediatePropagation();}},true);
renderer.domElement.addEventListener('pointerdown',event=>{if(!event.shiftKey||studioLockReason())return;event.preventDefault();event.stopImmediatePropagation();const hit=getClosestInteractiveIntersection(event);if(hit?.object.userData.kind==='block')studioSelectCallback?.(hit.object.userData);},true);
let presentationCamera=null;
function studioCameraState(){return {position:camera.position.clone(),target:controls.target.clone(),autoRotate:controls.autoRotate,far:camera.far,zoom:camera.zoom};}
function restoreStudioCamera(state){camera.position.copy(state.position);controls.target.copy(state.target);controls.autoRotate=state.autoRotate;camera.far=state.far??camera.far;camera.zoom=state.zoom??camera.zoom;camera.updateProjectionMatrix();controls.update();}
// Fit the entire visible model for every GIF frame: independent of the user's
// zoom and the narrower landscape aspect used by Capture.
function fitStudioGifCamera(dimensions){
 const bounds=new THREE.Box3();
 const fullBlocks=model.getBlocks();
 const half=new THREE.Vector3(CONFIG.CELL_WIDTH/2,CONFIG.CELL_HEIGHT/2,CONFIG.CELL_DEPTH/2);
 for(const block of fullBlocks){const point=modelToWorld(block.x,block.y,block.z);bounds.expandByPoint(point.clone().sub(half));bounds.expandByPoint(point.clone().add(half));}
 if(exactImportedStl){const importedMesh=scene.getObjectByName('exact_stl_mesh');if(importedMesh)bounds.union(new THREE.Box3().setFromObject(importedMesh));}
 const center=bounds.isEmpty()?controls.target.clone():bounds.getCenter(new THREE.Vector3());
 const radius=bounds.isEmpty()?2:Math.max(bounds.getBoundingSphere(new THREE.Sphere()).radius,0.8);
 const aspect=dimensions[0]/dimensions[1],vertical=THREE.MathUtils.degToRad(camera.fov),horizontal=2*Math.atan(Math.tan(vertical/2)*aspect);
 // A bounding sphere conservatively encloses all azimuths at this elevation.
 const distance=radius/Math.sin(Math.min(vertical,horizontal)/2)*1.26;
 const offset=camera.position.clone().sub(controls.target);
 if(offset.lengthSq()<0.0001)offset.set(1,0.8,1.2);
 controls.autoRotate=false;controls.target.copy(center);camera.zoom=1;
 camera.far=Math.max(camera.far,distance+radius*3+10);camera.updateProjectionMatrix();
 camera.position.copy(center).add(offset.normalize().multiplyScalar(distance));camera.lookAt(center);
 return {position:camera.position.clone(),target:center.clone(),autoRotate:false};
}
const studioCameraMemory=new WeakMap();
function renderStudioComparison(canvas,blocks,grid,options={}){
 const previewRenderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false});previewRenderer.setPixelRatio(Math.min(devicePixelRatio,2));previewRenderer.setClearColor(document.documentElement.dataset.theme === 'dark' ? 0x191b20 : 0xefede7);previewRenderer.outputColorSpace=THREE.SRGBColorSpace;
 const previewScene=new THREE.Scene(),group=new THREE.Group();previewScene.add(group);
 previewScene.add(new THREE.HemisphereLight(0xffffff,0x77736b,2.5));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(-8,16,10);previewScene.add(light);
 for(const b of blocks){const diffColor=options.diffColors?.[`${b.x},${b.y},${b.z}`],baseMaterial=b.type==='support'?supportMaterial:getStandardBlockMaterial(b.color),material=diffColor===undefined?baseMaterial:baseMaterial.clone();if(diffColor!==undefined)material.color.set(diffColor);const mesh=new THREE.Mesh(blockGeometry,material);mesh.userData.studioDiff=diffColor!==undefined;mesh.position.set((b.x-(grid.x-1)/2)*CONFIG.CELL_WIDTH,b.z*CONFIG.CELL_HEIGHT+CONFIG.CELL_HEIGHT/2,((grid.y-1)/2-b.y)*CONFIG.CELL_DEPTH);mesh.userData.studioBlock=b;group.add(mesh);
 const edges=new THREE.LineSegments(new THREE.EdgesGeometry(blockGeometry),new THREE.LineBasicMaterial({color:diffColor!==undefined?diffColor:options.issueKeys?.includes(`${b.x},${b.y},${b.z}`)?0xd87700:options.selectedKeys?.includes(`${b.x},${b.y},${b.z}`)?0x245bca:b.type==='support'?0x111111:0x252525,depthTest:diffColor===undefined&&!options.issueKeys?.includes(`${b.x},${b.y},${b.z}`)&&!options.selectedKeys?.includes(`${b.x},${b.y},${b.z}`),transparent:true,opacity:diffColor!==undefined||options.issueKeys?.includes(`${b.x},${b.y},${b.z}`)||options.selectedKeys?.includes(`${b.x},${b.y},${b.z}`)?1:b.type==='support'?.8:.16}));mesh.add(edges);}
 for(const b of options.proposed||[]){if(![b.x,b.y,b.z].every(Number.isFinite))continue;const mat=new THREE.MeshStandardMaterial({color:options.valid||options.issueKeys?.length&&!options.issueKeys.includes(`${b.x},${b.y},${b.z}`)?0x268b65:0xff321c,transparent:true,opacity:.3,depthWrite:false});const ghostMesh=new THREE.Mesh(blockGeometry,mat);ghostMesh.userData.studioGhost=true;ghostMesh.position.set((b.x-(grid.x-1)/2)*CONFIG.CELL_WIDTH,b.z*CONFIG.CELL_HEIGHT+CONFIG.CELL_HEIGHT/2,((grid.y-1)/2-b.y)*CONFIG.CELL_DEPTH);const outline=new THREE.LineSegments(new THREE.EdgesGeometry(blockGeometry),new THREE.LineBasicMaterial({color:mat.color,depthTest:false}));outline.renderOrder=25;ghostMesh.add(outline);group.add(ghostMesh);}
 canvas.dataset.differenceBlockCount=String(group.children.filter(mesh=>mesh.userData.studioDiff).length);
 const visibleKeys=options.visibleKeys?new Set(options.visibleKeys):null;for(const mesh of group.children){if(mesh.userData.studioBlock){const b=mesh.userData.studioBlock;mesh.visible=!visibleKeys||visibleKeys.has(`${b.x},${b.y},${b.z}`);}}canvas.dataset.visibleBlockCount=String(group.children.filter(mesh=>mesh.userData.studioBlock&&mesh.visible).length);
 const box=new THREE.Box3().setFromObject(group),center=blocks.length?box.getCenter(new THREE.Vector3()):new THREE.Vector3(),size=blocks.length?box.getSize(new THREE.Vector3()):new THREE.Vector3(2,1,1);
 const camera=new THREE.PerspectiveCamera(35,1,.01,1000),orbit=new OrbitControls(camera,canvas);const remembered=options.preserveView?studioCameraMemory.get(canvas):null;if(remembered){camera.position.copy(remembered.position);camera.zoom=remembered.zoom;orbit.target.copy(remembered.target);}else orbit.target.copy(center);orbit.enableDamping=false;const render=()=>{previewRenderer.render(previewScene,camera);if(options.directionGizmo){const inverse=camera.quaternion.clone().invert(),origin=[50,42];options.directionGizmo.innerHTML=[['X+',new THREE.Vector3(1,0,0)],['Y+',new THREE.Vector3(0,0,-1)],['Z+',new THREE.Vector3(0,1,0)]].map(([label,direction])=>{const d=direction.applyQuaternion(inverse),x=origin[0]+d.x*32,y=origin[1]-d.y*32;return `<line x1="${origin[0]}" y1="${origin[1]}" x2="${x}" y2="${y}"/><circle cx="${x}" cy="${y}" r="3"/><text x="${x+(label==='Y+'?-10:label==='Z+'?8:4)}" y="${y+(d.y>0?-9:15)}" text-anchor="middle">${label}</text>`;}).join('')+'<text x="8" y="101" text-anchor="start" class="gizmo-caption">X RIGHT / Y BACK / Z UP</text><text x="8" y="113" text-anchor="start" class="gizmo-caption">POSITIVE GRID DIRECTIONS</text>';}};
 function resize(){const w=Math.max(1,canvas.clientWidth),h=Math.max(1,canvas.clientHeight);previewRenderer.setSize(w,h,false);camera.aspect=w/h;const radius=Math.max(options.sharedRadius||size.length()/2,1);const fov=THREE.MathUtils.degToRad(35),distance=radius/Math.sin(Math.min(fov,2*Math.atan(Math.tan(fov/2)*camera.aspect))/2)*1.2;if(!canvas.dataset.fitted){camera.position.copy(center).add(new THREE.Vector3(1.2,.9,1.5).normalize().multiplyScalar(distance));canvas.dataset.fitted='true';}camera.updateProjectionMatrix();orbit.update();render();}
 let pointerStart=null;const down=e=>pointerStart=[e.clientX,e.clientY];const pick=e=>{if(!options.onPick||!pointerStart||Math.hypot(e.clientX-pointerStart[0],e.clientY-pointerStart[1])>5)return;const rect=canvas.getBoundingClientRect(),ray=new THREE.Raycaster();ray.setFromCamera(new THREE.Vector2((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1),camera);const hit=ray.intersectObjects(group.children.filter(m=>m.userData.studioBlock&&m.visible),false)[0];if(hit)options.onPick(hit.object.userData.studioBlock);};canvas.addEventListener('pointerdown',down);canvas.addEventListener('click',pick);
 let applyingLink=false;
 const applyLink=view=>{if(!view)return;applyingLink=true;camera.position.copy(center).add(new THREE.Vector3(...view.position));orbit.target.copy(center).add(new THREE.Vector3(...view.target));camera.zoom=view.zoom;camera.updateProjectionMatrix();orbit.update();render();applyingLink=false;canvas.dataset.linkedCamera=JSON.stringify(view);};
 const publishLink=()=>{render();if(!options.cameraLink||applyingLink)return;const bus=options.cameraLink,view={position:camera.position.clone().sub(center).toArray(),target:orbit.target.clone().sub(center).toArray(),zoom:camera.zoom};bus.state=view;canvas.dataset.linkedCamera=JSON.stringify(view);if(bus.enabled)for(const listener of bus.listeners)if(listener!==applyLink)listener(view);};
 if(options.cameraLink)options.cameraLink.listeners.add(applyLink);
 delete canvas.dataset.fitted;if(remembered)canvas.dataset.fitted='true';resize();if(options.cameraLink?.state&&options.cameraLink.enabled)applyLink(options.cameraLink.state);else publishLink();orbit.addEventListener('change',publishLink);const observer=new ResizeObserver(resize);observer.observe(canvas);return ()=>{if(options.preserveView)studioCameraMemory.set(canvas,{position:camera.position.clone(),target:orbit.target.clone(),zoom:camera.zoom});observer.disconnect();canvas.removeEventListener('pointerdown',down);canvas.removeEventListener('click',pick);options.cameraLink?.listeners.delete(applyLink);orbit.dispose();group.traverse(obj=>{if(obj.isLineSegments){obj.geometry.dispose();obj.material.dispose();}if(obj.userData.studioGhost||obj.userData.studioDiff)obj.material.dispose();});previewRenderer.dispose();delete canvas.dataset.fitted;};
}
let studioCaptureRenderer=null;
window.addEventListener('pagehide',()=>{studioCaptureRenderer?.dispose();studioCaptureRenderer=null;});
function captureStudioImage(background,dimensions){return new Promise((resolve,reject)=>{
 const bg=scene.background,objects=[gridHelper,baseMesh,studioHighlights,ghost],visibility=objects.map(o=>o.visible);
 try{if(!studioCaptureRenderer){studioCaptureRenderer=new THREE.WebGLRenderer({antialias:true,alpha:true});studioCaptureRenderer.outputColorSpace=renderer.outputColorSpace;studioCaptureRenderer.toneMapping=renderer.toneMapping;studioCaptureRenderer.toneMappingExposure=renderer.toneMappingExposure;studioCaptureRenderer.shadowMap.enabled=renderer.shadowMap.enabled;studioCaptureRenderer.shadowMap.type=renderer.shadowMap.type;}
 const width=dimensions?.[0]||renderer.domElement.width,height=dimensions?.[1]||renderer.domElement.height;studioCaptureRenderer.setSize(width,height,false);studioCaptureRenderer.setClearColor(0x000000,0);const view=camera.clone();view.clearViewOffset();view.aspect=width/height;view.updateProjectionMatrix();scene.background=background==='transparent'?null:new THREE.Color(background);objects.forEach(o=>o.visible=false);studioCaptureRenderer.render(scene,view);const canvas=document.createElement('canvas');canvas.width=width;canvas.height=height;canvas.getContext('2d').drawImage(studioCaptureRenderer.domElement,0,0);canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Image capture failed.')),'image/png');}
 catch(error){reject(error);}finally{scene.background=bg;objects.forEach((o,i)=>o.visible=visibility[i]);}
});}
// Render the complete model independently of the workspace camera and layer cutoff.
async function captureAssemblyModel(){
 const offscreen=new THREE.WebGLRenderer({antialias:true,alpha:true});
 offscreen.setSize(1569,720);offscreen.setClearColor(0x000000,0);offscreen.outputColorSpace=renderer.outputColorSpace;offscreen.toneMapping=renderer.toneMapping;offscreen.toneMappingExposure=renderer.toneMappingExposure;
 const capturedScene=new THREE.Scene(),group=new THREE.Group();capturedScene.add(group);
 scene.children.filter(object=>object.isLight).forEach(light=>capturedScene.add(light.clone()));
 let smooth=null;
 try{
  const blocks=model.getBlocks();
  if(exportSurfaceMode==='soft1'&&blocks.some(b=>b.type==='standard')){smooth=makeSmoothExportGroup(1,{yUp:true,quality:'export'});group.add(smooth);}
  for(const b of blocks){if(smooth&&b.type!=='support')continue;const mesh=new THREE.Mesh(blockGeometry,b.type==='support'?supportMaterial:getStandardBlockMaterial(b.color));mesh.position.copy(modelToWorld(b.x,b.y,b.z));if(b.type==='support'){const edges=new THREE.LineSegments(blockEdgesGeometry,supportEdgeMaterial);edges.scale.setScalar(1.004);edges.renderOrder=15;mesh.add(edges);}group.add(mesh);}
  const bounds=new THREE.Box3().setFromObject(group),center=bounds.isEmpty()?new THREE.Vector3():bounds.getCenter(new THREE.Vector3());
  const view=new THREE.OrthographicCamera(-1,1,1,-1,.01,10000);view.position.copy(center).add(new THREE.Vector3(1.2,.9,1.5).normalize().multiplyScalar(500));view.lookAt(center);view.updateMatrixWorld();
  const projected=new THREE.Box3();if(!bounds.isEmpty())for(const x of [bounds.min.x,bounds.max.x])for(const y of [bounds.min.y,bounds.max.y])for(const z of [bounds.min.z,bounds.max.z])projected.expandByPoint(new THREE.Vector3(x,y,z).applyMatrix4(view.matrixWorldInverse));
  const size=projected.isEmpty()?new THREE.Vector3(2,1,1):projected.getSize(new THREE.Vector3()),middle=projected.isEmpty()?new THREE.Vector3():projected.getCenter(new THREE.Vector3()),aspect=1569/720,half=Math.max(size.y/2,size.x/(2*aspect),.5)*1.12;
  view.left=middle.x-half*aspect;view.right=middle.x+half*aspect;view.top=middle.y+half;view.bottom=middle.y-half;view.updateProjectionMatrix();offscreen.render(capturedScene,view);
  const copy=document.createElement('canvas');copy.width=1569;copy.height=720;copy.getContext('2d').drawImage(offscreen.domElement,0,0);
  return await new Promise((resolve,reject)=>copy.toBlob(blob=>blob?resolve(blob):reject(Error('Model image could not be captured.')),'image/png'));
 }finally{if(smooth)disposeExportGroup(smooth);offscreen.dispose();offscreen.forceContextLoss();}
}
const studioTools=installStudioTools({
 captureAssemblyModel,
 projectId:()=>String(activeRecentModelId||importedProjectName||getCurrentModelName()),
 pdfTheme:()=>{const root=getComputedStyle(document.documentElement),title=getComputedStyle(document.querySelector('#saveModalTitle')),accent=getComputedStyle(document.querySelector('#saveModalTitle span')),body=getComputedStyle(document.querySelector('.save-modal__intro'));return {cardRadius:parseFloat(root.getPropertyValue('--studio-radius-card'))||8,display:title.fontFamily,ui:body.fontFamily,italic:accent.fontFamily,paper:root.getPropertyValue('--paper').trim(),card:root.getPropertyValue('--studio-card').trim(),edge:root.getPropertyValue('--studio-edge').trim(),ink:root.getPropertyValue('--ink').trim(),accent:root.getPropertyValue('--accent').trim()};},modelName:getCurrentModelName,validate:blocks=>{try{const test=new VoxelModel({gridSize:model.gridSize,maxHeight:CONFIG.MAX_HEIGHT});test.setGridDimensions(model.gridWidth,model.gridDepth);for(const b of [...blocks].sort((a,b)=>a.z-b.z)){if(![b.x,b.y,b.z].every(Number.isInteger))return {valid:false,reason:'Use whole grid steps.',issueCells:[b]};const result=test.placeBlock(b.x,b.y,b.z,b.type,b.color);if(!result.valid)return {...result,reason:result.reason+` / cell [${b.x}, ${b.y}, ${b.z}]`,issueCells:[b]};}return {valid:true,reason:'Placement valid'};}catch(error){return {valid:false,reason:error.message};}},rotatePresentation:rotate=>{controls.autoRotate=rotate;controls.autoRotateSpeed=.65;},renderComparison:renderStudioComparison,blocks:()=>cloneBlocks(),recents:()=>readRecentModels(),
 dimensions:()=>({x:model.gridWidth,y:model.gridDepth,z:CONFIG.MAX_HEIGHT}),
 physicalUnitMm:CONFIG.PHYSICAL_BLOCK_MM,
 physicalDimensions:blocks=>{if(!blocks.length)return [0,0,0];return ['x','y','z'].map((a,i)=>(Math.max(...blocks.map(b=>b[a]))-Math.min(...blocks.map(b=>b[a]))+1)*[CONFIG.CELL_WIDTH,CONFIG.CELL_DEPTH,CONFIG.CELL_HEIGHT][i]*CONFIG.PHYSICAL_BLOCK_MM);},
 lockReason:studioLockReason,isMesh:()=>Boolean(exactImportedStl),commit:commitStudioBlocks,highlight:highlightStudioBlocks,preview:previewStudioBlocks,
 mirror:value=>studioMirror=value,onSelect:callback=>studioSelectCallback=callback,
 hardware:()=>IS_HARDWARE_BUILDER?getHardwareMonitorState():null,
 presentation:(enabled,rotate)=>{if(enabled){presentationCamera=studioCameraState();const visibleGroup=exactImportedStl?exactStlGroup:exportSurfaceMode==='soft1'?realtimeOrganicGroup:blocksGroup;const bounds=new THREE.Box3().setFromObject(visibleGroup);if(!bounds.isEmpty()){const center=bounds.getCenter(new THREE.Vector3()),radius=Math.max(bounds.getSize(new THREE.Vector3()).length()/2,1);controls.target.copy(center);camera.position.copy(center).add(new THREE.Vector3(1.2,.9,1.5).normalize().multiplyScalar(radius/Math.sin(THREE.MathUtils.degToRad(camera.fov)/2)*1.25));}controls.autoRotate=rotate&&!matchMedia('(prefers-reduced-motion: reduce)').matches;controls.autoRotateSpeed=.65;}else if(presentationCamera){restoreStudioCamera(presentationCamera);presentationCamera=null;}},
 cameraState:studioCameraState,restoreCamera:restoreStudioCamera,fitGifCamera:fitStudioGifCamera,surfaceMode:()=>exportSurfaceMode,orbitFrame:(state,angle)=>{controls.autoRotate=false;const offset=state.position.clone().sub(state.target);offset.applyAxisAngle(new THREE.Vector3(0,1,0),angle);camera.position.copy(state.target).add(offset);camera.lookAt(state.target);},
 capture:captureStudioImage,
 warning:title=>{const blocks=cloneBlocks(),standard=blocks.filter(b=>b.type==='standard'),keys=new Set(standard.map(b=>`${b.x},${b.y},${b.z}`));let affected=[];
 if(title==='OVERHANGS TO REVIEW')affected=standard.filter(b=>b.z>0&&!keys.has(`${b.x},${b.y},${b.z-1}`));
 if(title==='TEMPORARY SUPPORTS')affected=blocks.filter(b=>b.type==='support');
 if(title==='SEPARATE PARTS'){const seen=new Set(),components=[];for(const b of standard){const k=`${b.x},${b.y},${b.z}`;if(seen.has(k))continue;const part=[b];seen.add(k);for(let i=0;i<part.length;i++){const p=part[i];for(const [dx,dy,dz]of [[1,0,0],[-1,0,0],[0,1,0],[0,-1,0],[0,0,1],[0,0,-1]]){const n=standard.find(v=>v.x===p.x+dx&&v.y===p.y+dy&&v.z===p.z+dz);if(n&&!seen.has(`${n.x},${n.y},${n.z}`)){seen.add(`${n.x},${n.y},${n.z}`);part.push(n);}}}components.push(part);}components.sort((a,b)=>b.length-a.length);affected=components.slice(1).flat();}
 setExportSurfaceMode('voxel');setLayerView(0);highlightStudioBlocks(affected);if(affected.length){warningHighlightBar.querySelector('span').textContent=`${title} / ${affected.length} BLOCKS`;warningHighlightBar.hidden=false;}setFeedback(title,`${affected.length} block(s) outlined in red. Open Studio Tools to clear the highlight.`);}
});
window.studioToolsApi={commit:commitStudioBlocks,mirror:value=>studioMirror=value,preview:previewStudioBlocks,selection:highlightStudioBlocks};

initializeAutosavePreference();
initializeActiveRecentModel();
void hydrateRecentLibrary();
if (!IS_HARDWARE_BUILDER && safeStorageRead(ACTIVE_WORKSPACE_KIND_KEY, 'blocks') === 'mesh') {
  void restoreLastImportedMesh();
} else {
  restoreLatestAutosave();
}
if (IS_HARDWARE_BUILDER) {
  setFeedback('AWAITING HARDWARE', 'Connect an ESP32 using the top bar. The physical sensor board controls brick placement.');
}
resetHistoryToCurrent();
renderRecentModels();
updateSerialControls();
updateHistoryControls();
syncViewFromModel();
if (!HARDWARE_ONLY_EDITION && (document.documentElement.dataset.simulator === 'true' || new URLSearchParams(window.location.search).has('simulator'))) {
  requestAnimationFrame(() => { void startSimulation(); });
}
