import '@neurodesk/webapp-components/styles/base.css';
import './styles.css';

import { mountImagingWorkspace } from '@neurodesk/webapp-components/core/mount-imaging-workspace';
import { Niivue } from '@niivue/niivue';
import { registerExtraColormaps } from './niivue/colormaps.js';

import { buildAdjacency, findBoundaryVertices, isIsolated } from './surface/adjacency.js';
import { excludeVertices, unionMasks } from './surface/exclude.js';
import {
  resolveParcellation, anchorVertex, AREA_ERRORS
} from './surface/parcellation.js';
import { SurfacePathfinder } from './surface/pathfinder.js';
import { buildVertexIndex } from './surface/vertexLookup.js';
import {
  RoiSession, MODE_ROI, MODE_POINTS, SESSION_ERRORS, CLOSURE_EDGE
} from './surface/roiSession.js';
import { FILL_ERRORS, maskToIndices } from './surface/fill.js';
import { hatchMask, FILL_STYLES } from './surface/hatch.js';
import {
  loadMeshFromFile, loadOverlay, getGeometry, pickWorldMm, resolveVertex,
  attachLabelLayer, commitLayer, setOverlayDisplay, makeLabelLut, attachValueLayer
} from './niivue/meshAdapter.js';

import { writeFreeSurferLabel, labelToValues } from './io/freesurferLabel.js';
import { writeGiftiLabel, maskToLabelArray } from './io/gifti.js';
import { writePointsJson, hashTriangles } from './io/points.js';
import {
  exportStem as buildExportStem, hasAnatomicalCoordinates, surfaceKind
} from './io/naming.js';
import { classifyFile, SNIFF_BYTES, SURFACE, OVERLAY, UNKNOWN } from './io/classify.js';

// Label keys painted into the ROI layer.
const LABEL_NONE = 0;
const LABEL_BOUNDARY = 1;
const LABEL_REGION = 2;
const LABEL_POINT = 3;
const LABEL_CLICK = 4;

const LABEL_TABLE = [
  { key: LABEL_NONE, name: 'unlabelled', rgba: [0, 0, 0, 0] },
  { key: LABEL_BOUNDARY, name: 'boundary', rgba: [1, 0.85, 0.1, 1] },
  { key: LABEL_REGION, name: 'roi', rgba: [0.9, 0.2, 0.2, 0.55] },
  { key: LABEL_POINT, name: 'landmark', rgba: [0.2, 0.85, 0.9, 1] },
  { key: LABEL_CLICK, name: 'border point', rgba: [1, 0.55, 0.1, 1] }
];

// Completed ROIs are painted from a palette, starting well clear of the keys
// above so the two sets never collide.
const LABEL_SAVED_BASE = 16;
const SAVED_ROI_COLORS = [
  [0.30, 0.69, 0.31], [0.13, 0.59, 0.95], [1.00, 0.60, 0.00], [0.61, 0.35, 0.71],
  [0.00, 0.74, 0.83], [0.91, 0.12, 0.39], [0.55, 0.76, 0.29], [0.80, 0.52, 0.25]
];

const el = (id) => document.getElementById(id);

/** Input types where a keystroke edits text rather than driving the viewer. */
const TEXT_INPUT_TYPES = new Set([
  'text', 'search', 'url', 'tel', 'email', 'password', 'number'
]);

/**
 * True when a key event belongs to a field the user is typing into. Sliders,
 * checkboxes and buttons deliberately do not count: focus stays on the ROI
 * opacity slider after you drag it, and the undo shortcut should still work
 * there.
 */
function isTextEntry(target) {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return true;
  return target.tagName === 'INPUT' && TEXT_INPUT_TYPES.has(target.type);
}

const ui = {
  surfaceInput: el('surfaceInput'),
  surfaceList: el('surfaceList'),
  overlayInput: el('overlayInput'),
  overlayList: el('overlayList'),
  overlaySelectedHint: el('overlaySelectedHint'),
  overlayOpacity: el('overlayOpacity'),
  overlayColormap: el('overlayColormap'),
  overlayMin: el('overlayMin'),
  overlayMax: el('overlayMax'),
  overlayRangeReset: el('overlayRangeReset'),
  modeRoi: el('modeRoi'),
  modePoints: el('modePoints'),
  roiControls: el('roiControls'),
  pointControls: el('pointControls'),
  undoPoint: el('undoPoint'),
  closePath: el('closePath'),
  closeOnEdge: el('closeOnEdge'),
  edgeRow: el('edgeRow'),
  edgeHint: el('edgeHint'),
  fillRegion: el('fillRegion'),
  flipRegion: el('flipRegion'),
  clearRoi: el('clearRoi'),
  includeBoundary: el('includeBoundary'),
  fillStyle: el('fillStyle'),
  roiOpacity: el('roiOpacity'),
  roiOpacityValue: el('roiOpacityValue'),
  undoPointSelection: el('undoPointSelection'),
  clearPoints: el('clearPoints'),
  pointList: el('pointList'),
  saveRoi: el('saveRoi'),
  roiList: el('roiList'),
  roiName: el('roiName'),
  exportLabel: el('exportLabel'),
  exportGifti: el('exportGifti'),
  exportPoints: el('exportPoints'),
  exportHint: el('exportHint'),
  statusText: el('statusText'),
  vertexReadout: el('vertexReadout'),
  dropHint: el('dropHint'),
  viewer: el('viewer'),
  canvas: el('gl')
};

mountImagingWorkspace({
  root: el('app'),
  controls: el('controls'),
  viewer: el('viewer'),
  status: el('status'),
  title: 'SurfAnnotate',
  subtitle: 'Surface ROIs and vertex selection',
  // Hidden in styles.css — the shell has no option to omit it. Kept as a
  // sensible value rather than removed, so unhiding is a one-line change.
  mark: 'S'
});

const state = {
  nv: null,

  // Every loaded surface, and which one is shown. Exactly one is visible at a
  // time: cortical surfaces occlude each other, and more importantly the depth
  // picker returns a position rather than an identity, so a click over two
  // overlapping meshes could not be attributed to either.
  surfaces: [],
  activeId: null,
  nextId: 1,

  // ROI work is keyed by topology, not by file. Surfaces that share a vertex
  // indexing — one subject's white, pial, inflated and sphere — share a
  // session, so a border drawn on the inflated surface is still there after
  // switching to the folded one. See RoiSession.rebind.
  sessions: new Map(),

  // Completed ROIs, each tied to a topology like the sessions. Ticking one as an
  // edge cuts it out of the working graph — see bindSession.
  // Areas are *definitions* — border points, how they were closed, which side
  // was taken. The masks on them are derived by resolveParcellation and are
  // rewritten on every recompute, so the list order is what decides who owns a
  // vertex when two areas would claim it.
  rois: [],
  selectedRoiId: null,
  // The area lifted out of the list by the pencil. It lives here, not in
  // `rois`, until it is saved again — see restoreEdited.
  editing: null,
  // While an area is being edited, its position in the list. Areas before it
  // constrain the drawing; areas after it are re-derived when it is saved.
  // -1 means a new area, which goes on the end.
  editIndex: -1,
  // The colour of the area being edited, so re-saving it does not recolour it.
  editColor: null,
  parcellationVersion: 0,
  excluded: null,
  boundKey: '',

  // Mirrors of the active surface. The rest of the app reads these rather than
  // reaching into the list, which keeps this change off every call site.
  mesh: null,
  geometry: null,
  graph: null,
  finder: null,
  index: null,
  session: null,
  labelValues: null,
  layerIndex: -1,
  meshIdentity: null,
  sourceName: '',
  hasOpenBoundary: false,
  overlayLayer: null,
  overlayAutoRange: null,

  pressOrigin: null,
  hoverPending: false,
  pickMemo: { x: -1, y: -1, mm: null },
  awaitingSeed: false,
  roiOpacity: 0.55
};

/** Completed ROIs of the shown surface's topology, in the order they were saved. */
function savedRois() {
  const entry = activeSurface();
  if (!entry) return [];
  return state.rois.filter((roi) => roi.topologyKey === entry.topologyKey);
}

/**
 * The vertices cut out of the working surface: every completed ROI ticked as an
 * edge, merged. Null when there are none, so the untouched graph is used.
 */
function exclusionMask() {
  const entry = activeSurface();
  if (!entry) return null;
  const areas = savedRois();
  // Every area above this one in the list is already resolved and owns its
  // vertices, so the area being drawn sees the surface they have left. That is
  // the whole of the parcellation rule: order decides ownership.
  const upto = state.editIndex >= 0 ? state.editIndex : areas.length;
  const masks = areas.slice(0, upto).map((area) => area.mask).filter(Boolean);
  if (!masks.length) return null;
  return unionMasks(entry.geometry.vertexCount, masks);
}

/**
 * Point the session at the active surface, with completed ROIs cut out of it.
 *
 * Everything the drawing tools do runs on the graph handed to the session, so
 * cutting the graph here is the whole of the "use a finished area as an edge"
 * feature: paths will not route through it, fills cannot cross it, and its rim
 * is reported as an edge for `closeOnEdge` to anchor to.
 */
function bindSession(entry, session) {
  // Rebinding discards the traced border and the fill, so do it only when the
  // surface or the set of edge ROIs actually changed — otherwise re-activating
  // the surface already shown would throw away work in progress.
  const key = `${entry.id}|${state.editIndex}|${state.parcellationVersion}`;
  if (state.boundKey === key && session.graph === state.graph) return;
  state.boundKey = key;

  const excluded = exclusionMask();
  const base = entry.openEdge;
  if (!excluded) {
    session.rebind(entry.graph, entry.finder, entry.geometry.positions, { openEdge: base });
    state.graph = entry.graph;
    state.finder = entry.finder;
    state.excluded = null;
    return;
  }
  const cut = excludeVertices(entry.graph, excluded, base);
  const finder = new SurfacePathfinder(cut.graph, entry.geometry.positions);
  session.rebind(cut.graph, finder, entry.geometry.positions, { openEdge: cut.openEdge });
  state.graph = cut.graph;
  state.finder = finder;
  state.excluded = excluded;
}

/** Re-cut the surface after the parcellation changed, then redraw. */
function applyExclusion() {
  const entry = activeSurface();
  if (!entry || !state.session) return;
  bindSession(entry, state.session);
  repaint();
}

/**
 * Re-derive every area's region from its border points, in list order.
 *
 * This is what makes the areas a parcellation rather than a pile of masks:
 * each is resolved on the surface the ones above it have left, so they cannot
 * overlap, and editing one re-derives everything below it. Move V1's border and
 * V2 follows, because V2 was always defined as "my line, and whatever lies
 * between it and the area above me".
 */
function recomputeParcellation() {
  const entry = activeSurface();
  if (!entry) return;
  const areas = savedRois();
  // One uninterruptible task, ~13 ms per area on a 150k-vertex surface. Past a
  // handful of areas that is long enough to look like a hang, and the status
  // line would otherwise still be showing whatever it said before.
  if (areas.length > 3) {
    setStatus(`Re-resolving ${areas.length} areas…`);
  }
  const { areas: resolved } = resolveParcellation({
    graph: entry.graph,
    positions: entry.geometry.positions,
    openEdge: entry.openEdge
  }, areas);

  resolved.forEach((result, index) => {
    areas[index].mask = result.mask;
    areas[index].chain = result.chain;
    areas[index].error = result.error;
  });
  state.parcellationVersion++;

  if (state.session) bindSession(entry, state.session);
  renderLayerLists();
  repaint();
  return resolved.filter((area) => area.error);
}

/**
 * Put a reopened area back where it came from.
 *
 * Reopening lifts an area off the list and into the working session, so until it
 * is saved the list is not the whole truth. Anything that walks away from the
 * edit — opening another area, switching surface, clearing — has to put it back,
 * or the only copy goes with the session.
 *
 * @returns {object|null} the area that was restored
 */
function restoreEdited() {
  const area = state.editing;
  if (!area) return null;
  const at = state.editIndex >= 0 ? state.editIndex : savedRois().length;
  const areas = savedRois();
  const anchor = areas[at];
  const position = anchor ? state.rois.indexOf(anchor) : state.rois.length;
  state.rois.splice(position, 0, area);
  state.editing = null;
  state.editIndex = -1;
  state.editColor = null;
  return area;
}

/** The first palette colour no area is using, so neighbours stay distinct. */
function nextColorIndex() {
  const used = new Set(savedRois().map((area) => area.colorIndex));
  for (let i = 0; i < SAVED_ROI_COLORS.length; i++) {
    if (!used.has(i)) return i;
  }
  return savedRois().length % SAVED_ROI_COLORS.length;
}

/** One sentence naming any areas the last change left unresolvable. */
function unresolvedNote(failed) {
  if (!failed || !failed.length) return '';
  const names = failed.map((area) => area.name).join(', ');
  return ` ${names} could not be resolved: ${AREA_ERRORS[failed[0].error] || failed[0].error}`;
}

/**
 * Move the filled region out of the working session and into the area list.
 *
 * The region itself is not what is stored — the border points are, along with
 * how they were closed and a vertex deep inside the region. The mask is derived
 * from those every time the list changes.
 */
function saveRoi() {
  const entry = activeSurface();
  const session = state.session;
  if (!entry || !session?.filled) {
    setStatus('Fill a region before saving it.');
    return;
  }
  const name = roiName();
  const area = {
    id: state.nextId++,
    name,
    topologyKey: entry.topologyKey,
    clicks: Array.from(session.clicks),
    closure: session.closure,
    regionIndex: session.regionIndex,
    includeBoundary: ui.includeBoundary.checked,
    // A vertex deep inside the region, so it can be recognised again after a
    // neighbouring border moves. The size ordering alone is not enough.
    anchor: anchorVertex(state.graph, session.filled, session.chain),
    visible: true,
    colorIndex: state.editColor ?? nextColorIndex(),
    mask: null,
    chain: new Int32Array(0),
    error: null
  };

  const areas = savedRois();
  const at = state.editIndex >= 0 ? Math.min(state.editIndex, areas.length) : areas.length;
  const anchorArea = areas[at];
  const position = anchorArea ? state.rois.indexOf(anchorArea) : state.rois.length;
  state.rois.splice(position, 0, area);

  // Deliberately NOT selected. Selecting it would point the export buttons at
  // this area while the name field goes on naming the next one, so the next
  // export writes these vertices under that name — wrong data under a plausible
  // filename, with a status line confirming it.
  state.selectedRoiId = null;
  state.editIndex = -1;
  state.editColor = null;
  state.editing = null;
  session.clearRoi();

  const failed = recomputeParcellation();
  const size = area.mask ? countMask(area.mask) : 0;
  setStatus(`Saved ${name} — ${size.toLocaleString()} vertices.` + unresolvedNote(failed));
}

/**
 * Put an area back on the drawing board.
 *
 * Reopening is un-saving, and it keeps the area's position: the areas above it
 * still constrain the border, exactly as when it was drawn, and the areas below
 * it are re-derived when it is saved again. That is also why no neighbour has to
 * be released by hand — an area is never blocked by one that came after it.
 */
function reopenRoi(id) {
  const entry = activeSurface();
  const area = state.rois.find((candidate) => candidate.id === id);
  if (!entry || !area || area.topologyKey !== entry.topologyKey) return;

  // Anything already being edited goes back on the list first: the area is held
  // only by the session while it is open, so reopening a second one, switching
  // surfaces, or clearing would otherwise drop it for good.
  restoreEdited();
  state.editIndex = savedRois().indexOf(area);
  state.editColor = area.colorIndex;
  state.editing = area;
  state.rois.splice(state.rois.indexOf(area), 1);
  if (state.selectedRoiId === id) state.selectedRoiId = null;
  recomputeParcellation();

  const session = state.session;
  session.clearRoi();
  for (const vertex of area.clicks) session.addClick(vertex);
  ui.roiName.value = area.name;
  ui.includeBoundary.checked = Boolean(area.includeBoundary);

  const closed = area.closure === CLOSURE_EDGE ? session.closeOnEdge() : session.closePath();
  let filled = { ok: false };
  if (closed.ok) {
    filled = area.closure === CLOSURE_EDGE
      ? session.fill({
        region: area.regionIndex,
        preferVertex: area.anchor,
        includeBoundary: area.includeBoundary
      })
      : session.fill({ seed: area.anchor ?? -1, includeBoundary: area.includeBoundary });
  }

  renderLayerLists();
  showExportName();
  repaint();
  setStatus(filled.ok
    ? `Reopened ${area.name} — ${session.clicks.length} border points restored. ` +
      'Adjust it and save again; the areas below it will follow.'
    : `Reopened ${area.name} — ${session.clicks.length} border points restored, but the ` +
      'border could not be retraced on the surface as it is now. Close it again.');
}

function removeRoi(id) {
  const position = state.rois.findIndex((roi) => roi.id === id);
  if (position < 0) return;
  const [area] = state.rois.splice(position, 1);
  if (state.selectedRoiId === id) state.selectedRoiId = null;
  const failed = recomputeParcellation();
  setStatus(`Removed ${area.name}.` + unresolvedNote(failed));
}

/**
 * Move an area up or down the list, which changes who owns the overlap.
 *
 * Order is meaning here, not presentation: an area drawn later can be squeezed
 * out entirely by one above it, and promoting it takes those vertices back.
 */
function moveRoi(id, delta) {
  const areas = savedRois();
  const from = areas.findIndex((area) => area.id === id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= areas.length) return;

  const moving = state.rois.indexOf(areas[from]);
  const target = state.rois.indexOf(areas[to]);
  const [area] = state.rois.splice(moving, 1);
  state.rois.splice(target, 0, area);

  const failed = recomputeParcellation();
  setStatus(`${area.name} is now ${to + 1} of ${areas.length}.` + unresolvedNote(failed));
}

function setRoiVisible(id, visible) {
  const roi = state.rois.find((candidate) => candidate.id === id);
  if (!roi) return;
  roi.visible = visible;
  repaint();
}

/** Select the area the export buttons act on. */
function selectRoi(id) {
  state.selectedRoiId = state.selectedRoiId === id ? null : id;
  const roi = state.rois.find((candidate) => candidate.id === id);
  if (roi && state.selectedRoiId === id) {
    ui.roiName.value = roi.name;
    showExportName();
    setStatus(`${roi.name} selected — the export buttons will write it.`);
  } else {
    setStatus('Export will write the region being drawn.');
  }
  renderLayerLists();
  repaint();
}

/** The area the export buttons target, or null for the working region. */
function selectedRoi() {
  if (state.selectedRoiId === null) return null;
  const area = savedRois().find((roi) => roi.id === state.selectedRoiId) || null;
  return area && area.mask ? area : null;
}

function countMask(mask) {
  let n = 0;
  for (let v = 0; v < mask.length; v++) if (mask[v]) n++;
  return n;
}

/** The surface currently shown, or null when nothing is loaded. */
function activeSurface() {
  return state.surfaces.find((entry) => entry.id === state.activeId) || null;
}

/** The overlay whose colour map and range the controls are editing. */
function activeOverlay() {
  const entry = activeSurface();
  if (!entry) return null;
  return entry.overlays.find((overlay) => overlay.id === entry.activeOverlayId) || null;
}

/**
 * Loads run one at a time.
 *
 * A file input fires `change` as soon as the files are set, not when our async
 * handler finishes, so picking two files in quick succession — or picking one
 * while a drop is still parsing — starts two `loadSurface` calls at once. They
 * then interleave on `state.surfaces` and on the active-surface mirrors, and the
 * app ends up showing one surface while the tools point at another.
 */
let loadQueue = Promise.resolve();
function enqueueLoad(task) {
  loadQueue = loadQueue.then(task, task);
  return loadQueue;
}

function setStatus(text) {
  ui.statusText.textContent = text;
}

async function init() {
  state.nv = new Niivue({
    isAntiAlias: false,
    backColor: [0.09, 0.1, 0.12, 1],
    show3Dcrosshair: false,
    // NiiVue installs its own drop handler on the canvas and routes the file to
    // its volume loader. Turning this off is necessary but NOT sufficient — see
    // the capture-phase listeners below.
    dragAndDropEnabled: false,
    // NiiVue paints "loading ..." over an empty canvas by default, which reads
    // as a stuck spinner when the app is simply waiting for a file.
    loadingText: ''
  });
  await state.nv.attachToCanvas(ui.canvas);
  registerExtraColormaps(state.nv);
  state.nv.setSliceType(state.nv.sliceTypeRender);

  ui.surfaceInput.addEventListener('change', (event) => {
    const files = Array.from(event.target.files || []);
    // Clear it now, not after loading: picking the same file twice in a row
    // fires no change event otherwise, and clearing later would wipe the files
    // a second pick had already put there.
    event.target.value = '';
    enqueueLoad(async () => {
      for (const file of files) await loadSurface(file);
    });
  });
  ui.overlayInput.addEventListener('change', (event) => {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    enqueueLoad(async () => {
      for (const file of files) await addOverlay(file);
    });
  });

  // These MUST be capture-phase. NiiVue's own drop listener lives on the canvas
  // and calls stopPropagation()/preventDefault() before it consults
  // opts.dragAndDropEnabled, so with a bubble-phase listener on the viewer the
  // event never reaches us however that option is set. Capture runs root->target,
  // so we see the event first and stop it there.
  const CAPTURE = { capture: true };
  const stop = (event) => { event.preventDefault(); event.stopPropagation(); };

  ui.viewer.addEventListener('dragenter', (event) => {
    stop(event);
    ui.viewer.classList.add('dragging');
  }, CAPTURE);
  ui.viewer.addEventListener('dragover', (event) => {
    stop(event);
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    ui.viewer.classList.add('dragging');
  }, CAPTURE);
  ui.viewer.addEventListener('dragleave', (event) => {
    // dragleave also fires when crossing into a child element, so only clear the
    // highlight when the pointer has actually left the viewer.
    if (event.relatedTarget && ui.viewer.contains(event.relatedTarget)) return;
    ui.viewer.classList.remove('dragging');
  }, CAPTURE);
  ui.viewer.addEventListener('drop', (event) => {
    stop(event);
    ui.viewer.classList.remove('dragging');
    const files = event.dataTransfer?.files;
    if (!files?.length) {
      setStatus('That drop contained no file. Try dragging the file itself, not a shortcut.');
      return;
    }
    enqueueLoad(() => handleDroppedFiles(Array.from(files)));
  }, CAPTURE);

  // The browser's default is to navigate away when a file is dropped anywhere
  // else on the page, which silently discards the user's work.
  for (const type of ['dragover', 'drop']) {
    window.addEventListener(type, (event) => {
      if (!ui.viewer.contains(event.target)) event.preventDefault();
    });
  }

  // Placing a point on pointerdown would fire on every rotate, because
  // orbiting the surface starts with a press on the canvas. Commit on
  // pointerup instead, and only when the pointer barely moved.
  ui.canvas.addEventListener('pointerdown', onPointerDown);
  ui.canvas.addEventListener('pointerup', onPointerUp);
  ui.canvas.addEventListener('pointermove', onCanvasHover);

  ui.modeRoi.addEventListener('click', () => setMode(MODE_ROI));
  ui.modePoints.addEventListener('click', () => setMode(MODE_POINTS));

  ui.undoPoint.addEventListener('click', () => {
    state.session.undoClick();
    state.awaitingSeed = false;
    repaint();
  });
  ui.closePath.addEventListener('click', () => {
    const session = state.session;
    if (session.clicks.length < 3) {
      setStatus('Place at least three border points before closing the ROI.');
      return;
    }
    setStatus('Tracing the border…');
    const result = session.closePath();
    setStatus(result.ok
      ? `ROI closed — ${result.chainLength.toLocaleString()} boundary vertices. ` +
        'Now fill the region.'
      : 'Could not join every border point across the surface. Try placing points ' +
        'closer together, or on the same connected surface.');
    repaint();
  });
  ui.closeOnEdge.addEventListener('click', () => {
    const session = state.session;
    setStatus('Tracing the border to the surface edge…');
    const result = session.closeOnEdge();
    if (!result.ok) {
      setStatus(FILL_ERRORS[result.error] || SESSION_ERRORS[result.error] || result.error);
      repaint();
      return;
    }
    setStatus(`Border closed against the surface edge — ` +
      `${result.chainLength.toLocaleString()} boundary vertices, ` +
      `${result.regions} regions. Now fill the region.`);
    repaint();
  });
  ui.fillRegion.addEventListener('click', () => runFill());
  ui.flipRegion.addEventListener('click', () => {
    const session = state.session;
    const result = session.nextRegion({ includeBoundary: ui.includeBoundary.checked });
    if (!result) return;
    setStatus(`Region ${session.regionIndex + 1} of ${session.regionOrder.length} — ` +
      `${result.count.toLocaleString()} vertices.`);
    repaint();
  });
  ui.clearRoi.addEventListener('click', () => {
    const restored = restoreEdited();
    state.session.clearRoi();
    state.awaitingSeed = false;
    if (restored) recomputeParcellation();
    setStatus(restored
      ? `Cleared. ${restored.name} went back on the list unchanged.`
      : 'Boundary cleared.');
    repaint();
  });
  ui.undoPointSelection.addEventListener('click', () => {
    state.session.undoPoint();
    repaint();
  });
  ui.clearPoints.addEventListener('click', () => {
    state.session.clearPoints();
    repaint();
  });

  const applyOverlayDisplay = () => {
    const overlay = activeOverlay();
    if (!overlay) return;
    overlay.opacity = Number(ui.overlayOpacity.value);
    setOverlayDisplay(state.nv, state.mesh, overlay.layer, {
      colormap: ui.overlayColormap.value,
      opacity: overlay.visible ? overlay.opacity : 0
    });
  };
  ui.overlayOpacity.addEventListener('input', applyOverlayDisplay);
  ui.overlayColormap.addEventListener('change', applyOverlayDisplay);

  const applyOverlayRange = () => {
    const layer = state.overlayLayer;
    if (!layer) return;
    const low = Number(ui.overlayMin.value);
    const high = Number(ui.overlayMax.value);
    if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) {
      setStatus('Colour range needs a maximum greater than the minimum.');
      return;
    }
    layer.cal_min = low;
    layer.cal_max = high;
    commitLayer(state.nv, state.mesh);
    setStatus(`Colour range set to ${low} – ${high}.`);
  };
  ui.overlayMin.addEventListener('change', applyOverlayRange);
  ui.overlayMax.addEventListener('change', applyOverlayRange);
  ui.overlayRangeReset.addEventListener('click', () => {
    const layer = state.overlayLayer;
    if (!layer || !state.overlayAutoRange) return;
    layer.cal_min = state.overlayAutoRange.low;
    layer.cal_max = state.overlayAutoRange.high;
    showOverlayRange(layer);
    commitLayer(state.nv, state.mesh);
    setStatus('Colour range reset to the data\'s 2nd–98th percentile.');
  });

  ui.fillStyle.addEventListener('change', () => repaint());
  ui.roiOpacity.addEventListener('input', () => {
    state.roiOpacity = Number(ui.roiOpacity.value);
    ui.roiOpacityValue.textContent = state.roiOpacity.toFixed(2);
    repaint();
  });

  ui.roiName.addEventListener('input', showExportName);

  ui.saveRoi.addEventListener('click', saveRoi);
  ui.exportLabel.addEventListener('click', exportFreeSurferLabel);
  ui.exportGifti.addEventListener('click', exportGiftiLabel);
  ui.exportPoints.addEventListener('click', exportPoints);

  document.addEventListener('keydown', (event) => {
    // Backspace and Delete are the undo shortcut for the viewer, but they are
    // also how you edit text. Without this guard the shortcut swallows every
    // keystroke aimed at the ROI name or the colour-range fields, and those
    // boxes can only be cleared by selecting all and overtyping.
    if (isTextEntry(event.target)) return;

    if (event.key === 'Escape' && state.awaitingSeed) {
      state.awaitingSeed = false;
      setStatus('Cancelled.');
    }
    if ((event.key === 'Backspace' || event.key === 'Delete') && state.session) {
      event.preventDefault();
      if (state.session.mode === MODE_ROI) state.session.undoClick();
      else state.session.undoPoint();
      repaint();
    }
  });

  bindStartPage();
  bindCitations();
  setStatus('Load a surface to begin.');
}

/**
 * Wire the Cite button, and add a second one to the app's own header.
 *
 * The shared shell builds its navigation with only the catalog link and takes no
 * list of extra items, so the button is appended after mounting rather than
 * passed in — the alternative is a change to the component and every app with it.
 */
function bindCitations() {
  const dialog = el('citationsDialog');
  if (!dialog) return;

  const navigation = document.querySelector('.nd-imaging-navigation');
  if (navigation) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'nd-header-link';
    button.title = 'How to cite';
    button.textContent = 'Cite';
    button.setAttribute('data-cite-open', '');
    navigation.prepend(button);
  }

  for (const trigger of document.querySelectorAll('[data-cite-open]')) {
    trigger.addEventListener('click', () => dialog.showModal());
  }
  el('closeCitations')?.addEventListener('click', () => dialog.close());
  // A modal dialog fills the viewport with its backdrop, so a click that lands
  // on the dialog element itself is a click outside the panel.
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
}

/**
 * The start page is a section over the app, so entering is just hiding it.
 * NiiVue sized its canvas at attach time behind the overlay, so nothing needs
 * re-laying out — but a redraw costs nothing and covers a resize during reading.
 */
function bindStartPage() {
  const startPage = el('startPage');
  const enter = el('enterAppButton');
  if (!startPage || !enter) return;
  enter.addEventListener('click', () => {
    startPage.hidden = true;
    ui.surfaceInput.focus();
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('resize'));
      state.nv?.drawScene();
    });
  });
}

/**
 * Route each dropped file to the surface list or the overlay list.
 *
 * The old rule was positional — first drop is the surface, everything after is
 * an overlay — which cannot express "add a second surface". So each file is
 * classified from its own magic number and name instead. Files that cannot be
 * identified fall back to the positional rule, which is right often enough and
 * is what the user was already used to.
 */
async function handleDroppedFiles(files) {
  for (const file of files) {
    let kind = UNKNOWN;
    try {
      const head = await file.slice(0, SNIFF_BYTES).arrayBuffer();
      kind = classifyFile(file.name, head);
    } catch (error) {
      console.error('surfannotate: could not read the head of the dropped file', error);
    }
    if (kind === UNKNOWN) kind = activeSurface() ? OVERLAY : SURFACE;

    if (kind === SURFACE) await loadSurface(file);
    else if (activeSurface()) await addOverlay(file);
    else setStatus(`${file.name} looks like an overlay — load a surface first.`);
  }
}

async function loadSurface(file) {
  setStatus(`Loading ${file.name}…`);
  try {
    const mesh = await loadMeshFromFile(state.nv, file);
    const geometry = getGeometry(mesh);

    setStatus(`Indexing ${geometry.vertexCount.toLocaleString()} vertices…`);
    // Yield so the status paints before the synchronous build.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const graph = buildAdjacency(geometry.positions, geometry.triangles);
    const finder = new SurfacePathfinder(graph, geometry.positions);
    const index = buildVertexIndex(geometry.positions);

    const openBoundary = findBoundaryVertices(geometry.triangles, geometry.vertexCount);
    let openCount = 0;
    for (let v = 0; v < openBoundary.length; v++) if (openBoundary[v]) openCount++;

    const triangleHash = await hashTriangles(geometry.triangles);
    const entry = {
      id: state.nextId++,
      name: file.name,
      mesh,
      geometry,
      graph,
      finder,
      index,
      openEdge: openCount > 0 ? openBoundary : null,
      // What the loader added to every vertex, so exports can take it back off.
      translation: mesh.surfannotateTranslation || [0, 0, 0],
      // A label records coordinates as well as vertex indices, and they only
      // mean anything if this surface sits in the subject's anatomy.
      anatomical: hasAnatomicalCoordinates(file.name, isPlanar(geometry.positions)),
      labelValues: new Float32Array(geometry.vertexCount),
      layerIndex: -1,
      overlays: [],
      activeOverlayId: null,
      identity: {
        numVertices: geometry.vertexCount,
        numTriangles: geometry.triangles.length / 3,
        sourceFile: file.name,
        triangleHash
      },
      // Two surfaces are interchangeable for ROI purposes exactly when they
      // have the same vertices in the same order joined the same way.
      topologyKey: `${geometry.vertexCount}:${triangleHash}`
    };

    entry.layerIndex = attachLabelLayer(mesh, entry.labelValues, currentLabelTable());
    state.surfaces.push(entry);
    activateSurface(entry.id);

    const note = openCount > 0
      ? ' This surface is cut, so you can close an ROI against its edge.'
      : '';
    const shared = state.sessions.get(entry.topologyKey);
    const carried = shared && shared.clicks.length
      ? ` Border points carried over from ${state.surfaces.filter(
        (s) => s.topologyKey === entry.topologyKey).length - 1} matching surface(s).`
      : '';
    setStatus(`${file.name}: ${geometry.vertexCount.toLocaleString()} vertices, ` +
      `${(geometry.triangles.length / 3).toLocaleString()} faces.${note}${carried}`);
  } catch (error) {
    // Surface it in the UI *and* the console — a parse failure deep inside
    // NiiVue is otherwise silent and looks like "nothing happened".
    console.error('surfannotate: failed to load surface', error);
    setStatus(
      `Could not read ${file.name} as a surface mesh: ${error.message}. ` +
      'Supported: FreeSurfer (lh.pial, lh.white, lh.inflated), GIfTI .surf.gii, ' +
      '.mz3, .obj, .stl, .ply, .vtk, .srf, .off.'
    );
    renderLayerLists();
  }
}

/**
 * Show one surface and hide the rest, then point every mirror in `state` at it.
 *
 * The ROI session follows the *topology*, not the file: switching between two
 * surfaces of the same subject keeps the border points, while switching to an
 * unrelated mesh gets a fresh session and leaves the first one intact to come
 * back to.
 */
function activateSurface(id, { announce = false } = {}) {
  const entry = state.surfaces.find((surface) => surface.id === id);
  if (!entry) return;
  // Before the active topology changes, or savedRois() would put it back on the
  // wrong surface's list.
  restoreEdited();

  state.activeId = id;
  for (const surface of state.surfaces) {
    surface.mesh.visible = surface.id === id;
  }

  let session = state.sessions.get(entry.topologyKey);
  if (!session) {
    session = new RoiSession(entry.graph, entry.finder, entry.geometry.positions, {
      openEdge: entry.openEdge
    });
    state.sessions.set(entry.topologyKey, session);
  }
  state.session = session;
  state.editIndex = -1;
  bindSession(entry, session);

  state.mesh = entry.mesh;
  state.geometry = entry.geometry;
  state.graph = entry.graph;
  state.finder = entry.finder;
  state.index = entry.index;
  state.session = session;
  state.labelValues = entry.labelValues;
  state.layerIndex = entry.layerIndex;
  state.meshIdentity = entry.identity;
  state.sourceName = entry.name;
  state.hasOpenBoundary = Boolean(entry.openEdge);
  state.awaitingSeed = false;

  const overlay = activeOverlay();
  state.overlayLayer = overlay ? overlay.layer : null;
  state.overlayAutoRange = overlay ? overlay.autoRange : null;

  ui.dropHint.hidden = true;
  ui.overlayInput.disabled = false;
  ui.overlayOpacity.disabled = false;
  showExportName();
  showCoordinateSource();
  syncOverlayControls();
  commitLayer(state.nv, entry.mesh);
  recomputeParcellation();

  if (announce) {
    const carried = session.clicks.length
      ? ` ${session.clicks.length} border point(s) carried over.`
      : '';
    setStatus(`Showing ${entry.name} — ` +
      `${entry.geometry.vertexCount.toLocaleString()} vertices.${carried}`);
  }
}

function removeSurface(id) {
  const position = state.surfaces.findIndex((entry) => entry.id === id);
  if (position < 0) return;
  restoreEdited();
  const [entry] = state.surfaces.splice(position, 1);
  state.nv.removeMesh(entry.mesh);

  // Drop the shared session only once the last surface using that topology has
  // gone, or switching away and back would silently lose the border points.
  const stillUsed = state.surfaces.some((s) => s.topologyKey === entry.topologyKey);
  if (!stillUsed) state.sessions.delete(entry.topologyKey);

  if (state.activeId !== id) {
    renderLayerLists();
    return;
  }
  const next = state.surfaces[position] || state.surfaces[position - 1];
  if (next) {
    activateSurface(next.id);
    setStatus(`Removed ${entry.name}. Showing ${next.name}.`);
    return;
  }

  // Nothing left.
  state.activeId = null;
  for (const key of ['mesh', 'geometry', 'graph', 'finder', 'index', 'session',
    'labelValues', 'meshIdentity', 'overlayLayer', 'overlayAutoRange']) {
    state[key] = null;
  }
  state.layerIndex = -1;
  state.sourceName = '';
  state.hasOpenBoundary = false;
  ui.dropHint.hidden = false;
  ui.overlayInput.disabled = true;
  showExportName();
  showCoordinateSource();
  syncOverlayControls();
  renderLayerLists();
  // repaint() cannot do this: it returns early without a session, so every
  // control would keep the enabled state it had and then dereference null.
  resetControls();
  setStatus(`Removed ${entry.name}. Load a surface to begin.`);
}

async function addOverlay(file) {
  const entry = activeSurface();
  if (!entry) return;
  setStatus(`Loading overlay ${file.name}…`);
  try {
    const display = {
      opacity: Number(ui.overlayOpacity.value),
      colormap: ui.overlayColormap.value
    };
    // NiiVue cannot read a FreeSurfer .label, so we expand it ourselves. It is
    // also sparse — a list of the vertices in the region — where every format
    // NiiVue does read is one value per vertex.
    const layer = await isFreeSurferLabel(file)
      ? attachValueLayer(state.nv, entry.mesh,
        labelToValues(await file.text(), entry.geometry.vertexCount).values,
        { ...display, name: file.name })
      : await loadOverlay(state.nv, entry.mesh, file, display);
    // readLayer appends, so the ROI layer is no longer last. Re-attach it on top.
    reattachRoiLayer();

    const overlay = {
      id: state.nextId++,
      name: file.name,
      layer,
      visible: true,
      opacity: Number(ui.overlayOpacity.value),
      autoRange: { low: layer.cal_min, high: layer.cal_max }
    };
    entry.overlays.push(overlay);
    entry.activeOverlayId = overlay.id;
    state.overlayLayer = layer;
    state.overlayAutoRange = overlay.autoRange;

    syncOverlayControls();
    setStatus(
      `Overlay ${file.name} loaded — display window ` +
      `${layer.cal_min.toFixed(3)} to ${layer.cal_max.toFixed(3)}.`
    );
    repaint();
  } catch (error) {
    console.error('surfannotate: failed to load overlay', error);
    setStatus(`Could not load overlay ${file.name}: ${error.message}`);
  }
}

/** True for a FreeSurfer .label, by extension or by its fixed first line. */
async function isFreeSurferLabel(file) {
  if (/\.label$/i.test(file.name)) return true;
  try {
    const head = await file.slice(0, 32).text();
    return head.startsWith('#!ascii label');
  } catch {
    return false;
  }
}

/** Make one of the active surface's overlays the one the controls edit. */
function selectOverlay(id) {
  const entry = activeSurface();
  if (!entry) return;
  entry.activeOverlayId = id;
  const overlay = activeOverlay();
  state.overlayLayer = overlay ? overlay.layer : null;
  state.overlayAutoRange = overlay ? overlay.autoRange : null;
  syncOverlayControls();
  repaint();
}

/**
 * Show or hide one overlay.
 *
 * NiiVue mesh layers have no visibility flag, so this rides on opacity — which
 * means the user's chosen opacity has to be remembered separately, or hiding
 * and re-showing a layer would silently reset it to opaque.
 */
function setOverlayVisible(id, visible) {
  const entry = activeSurface();
  const overlay = entry?.overlays.find((candidate) => candidate.id === id);
  if (!overlay) return;
  overlay.visible = visible;
  setOverlayDisplay(state.nv, entry.mesh, overlay.layer, {
    opacity: visible ? overlay.opacity : 0
  });
  renderLayerLists();
  repaint();
}

function removeOverlay(id) {
  const entry = activeSurface();
  if (!entry) return;
  const position = entry.overlays.findIndex((overlay) => overlay.id === id);
  if (position < 0) return;
  const [overlay] = entry.overlays.splice(position, 1);

  const layerIndex = entry.mesh.layers.indexOf(overlay.layer);
  if (layerIndex >= 0) entry.mesh.layers.splice(layerIndex, 1);
  reattachRoiLayer();

  if (entry.activeOverlayId === id) {
    const next = entry.overlays[position] || entry.overlays[position - 1];
    entry.activeOverlayId = next ? next.id : null;
  }
  const active = activeOverlay();
  state.overlayLayer = active ? active.layer : null;
  state.overlayAutoRange = active ? active.autoRange : null;

  syncOverlayControls();
  commitLayer(state.nv, entry.mesh);
  repaint();
  setStatus(`Removed overlay ${overlay.name}.`);
}

/** Enable, disable and fill the overlay controls for whatever is selected. */
function syncOverlayControls() {
  const overlay = activeOverlay();
  const controls = [ui.overlayColormap, ui.overlayMin, ui.overlayMax, ui.overlayRangeReset];
  for (const control of controls) control.disabled = !overlay;
  ui.overlayOpacity.disabled = !overlay;

  ui.overlaySelectedHint.hidden = !overlay;
  if (overlay) {
    ui.overlaySelectedHint.textContent = `Editing ${overlay.name}.`;
    ui.overlayColormap.value = overlay.layer.colormap || 'gray';
    ui.overlayOpacity.value = String(overlay.opacity);
    showOverlayRange(overlay.layer);
  } else {
    // Blank rather than leave another surface's numbers sitting in the boxes,
    // where they read as this surface's settings.
    ui.overlayMin.value = '';
    ui.overlayMax.value = '';
  }
  renderLayerLists();
}

/** Keep the ROI layer above any overlay so the boundary stays visible. */
function reattachRoiLayer() {
  const entry = activeSurface();
  if (!entry) return;
  const existing = entry.mesh.layers.findIndex((layer) => layer.name === 'surfannotate-roi');
  if (existing >= 0) entry.mesh.layers.splice(existing, 1);
  entry.layerIndex = attachLabelLayer(entry.mesh, entry.labelValues, currentLabelTable());
  state.layerIndex = entry.layerIndex;
}

// -- the layer lists ------------------------------------------------------

/** A compact icon button for the layer rows. */
function iconButton(glyph, title, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'layer-icon';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.textContent = glyph;
  button.addEventListener('click', onClick);
  return button;
}

function makeRemoveButton(title, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'layer-remove';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.textContent = '×';
  button.addEventListener('click', onClick);
  return button;
}

/**
 * Rebuild both lists from state.
 *
 * These lists, not the file inputs, are the record of what is loaded. A native
 * `<input type="file">` shows only the last file picked through it and shows
 * nothing at all for a drag-and-drop, which is why dropping a surface used to
 * look like nothing had happened.
 */
function renderLayerLists() {
  ui.surfaceList.innerHTML = '';
  for (const entry of state.surfaces) {
    const item = document.createElement('li');
    if (entry.id === state.activeId) item.classList.add('selected');

    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'activeSurface';
    radio.checked = entry.id === state.activeId;
    radio.id = `surface-${entry.id}`;
    radio.addEventListener('change', () => activateSurface(entry.id, { announce: true }));

    const name = document.createElement('label');
    name.className = 'layer-name';
    name.htmlFor = radio.id;
    name.textContent = entry.name;
    name.title = entry.name;

    const meta = document.createElement('span');
    meta.className = 'layer-meta';
    meta.textContent = `${Math.round(entry.geometry.vertexCount / 1000)}k`;
    meta.title = `${entry.geometry.vertexCount.toLocaleString()} vertices`;

    item.append(radio, name, meta,
      makeRemoveButton(`Remove ${entry.name}`, () => removeSurface(entry.id)));
    ui.surfaceList.appendChild(item);
  }

  ui.roiList.innerHTML = '';
  const areas = savedRois();
  areas.forEach((roi, index) => {
    const item = document.createElement('li');
    if (roi.id === state.selectedRoiId) item.classList.add('selected');
    if (roi.error) item.classList.add('unresolved');

    const show = document.createElement('input');
    show.type = 'checkbox';
    show.checked = roi.visible;
    show.title = `Show ${roi.name} on the surface`;
    show.setAttribute('aria-label', `Show ${roi.name}`);
    show.addEventListener('change', () => setRoiVisible(roi.id, show.checked));

    const order = document.createElement('span');
    order.className = 'layer-meta';
    order.textContent = `${index + 1}.`;

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'layer-name';
    name.textContent = roi.name;
    name.title = roi.error
      ? `${roi.name}: ${AREA_ERRORS[roi.error] || roi.error}`
      : `Export ${roi.name} instead of the region being drawn`;
    name.addEventListener('click', () => selectRoi(roi.id));

    const up = iconButton('\u25b2', `Move ${roi.name} up`, () => moveRoi(roi.id, -1));
    up.disabled = index === 0;
    const down = iconButton('\u25bc', `Move ${roi.name} down`, () => moveRoi(roi.id, 1));
    down.disabled = index === areas.length - 1;
    const reopen = iconButton('\u270e', `Reopen ${roi.name} to adjust its border`,
      () => reopenRoi(roi.id));
    reopen.classList.add('layer-edit');

    item.append(show, order, name, up, down, reopen,
      makeRemoveButton(`Remove ${roi.name}`, () => removeRoi(roi.id)));
    ui.roiList.appendChild(item);
  });

  ui.overlayList.innerHTML = '';
  const entry = activeSurface();
  for (const overlay of entry ? entry.overlays : []) {
    const item = document.createElement('li');
    if (overlay.id === entry.activeOverlayId) item.classList.add('selected');

    const check = document.createElement('input');
    check.type = 'checkbox';
    check.checked = overlay.visible;
    check.title = 'Show this overlay';
    check.setAttribute('aria-label', `Show ${overlay.name}`);
    check.addEventListener('change', () => setOverlayVisible(overlay.id, check.checked));

    const name = document.createElement('button');
    name.type = 'button';
    name.className = 'layer-name';
    name.textContent = overlay.name;
    name.title = `Edit the colour map and range of ${overlay.name}`;
    name.addEventListener('click', () => selectOverlay(overlay.id));

    item.append(check, name,
      makeRemoveButton(`Remove ${overlay.name}`, () => removeOverlay(overlay.id)));
    ui.overlayList.appendChild(item);
  }
}

/** Show a sensible number of decimals for whatever the overlay's units are. */
function showOverlayRange(layer) {
  const span = Math.abs(layer.cal_max - layer.cal_min);
  const decimals = span >= 100 ? 1 : span >= 1 ? 3 : 5;
  ui.overlayMin.value = Number(layer.cal_min.toFixed(decimals));
  ui.overlayMax.value = Number(layer.cal_max.toFixed(decimals));
  ui.overlayMin.step = String(Number((span / 100).toFixed(decimals)) || 'any');
  ui.overlayMax.step = ui.overlayMin.step;
}

/**
 * True when the geometry has no thickness — a flattened patch, whatever it is
 * called. Cheaper and more reliable than trusting the filename.
 */
function isPlanar(positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let v = 0; v < positions.length; v += 3) {
    if (positions[v] < minX) minX = positions[v];
    if (positions[v] > maxX) maxX = positions[v];
    if (positions[v + 1] < minY) minY = positions[v + 1];
    if (positions[v + 1] > maxY) maxY = positions[v + 1];
    if (positions[v + 2] < minZ) minZ = positions[v + 2];
    if (positions[v + 2] > maxZ) maxZ = positions[v + 2];
  }
  const spans = [maxX - minX, maxY - minY, maxZ - minZ];
  const largest = Math.max(...spans);
  return largest > 0 && spans.some((span) => span < largest * 1e-4);
}

/**
 * Say where the exported coordinates come from, and warn when they are not
 * anatomical.
 *
 * A label's vertex indices are right whatever surface it was drawn on, and that
 * is all freeview and mris_anatomical_stats read. The x/y/z are only meaningful
 * on a surface that sits in the subject's anatomy, and nothing in the file says
 * which — so it has to be said here, before the file is written.
 */
function showCoordinateSource() {
  const entry = activeSurface();
  if (!entry) {
    ui.exportHint.textContent = "Coordinates are written in the loaded surface's space.";
    ui.exportHint.classList.remove('warn');
    return;
  }
  if (entry.anatomical) {
    ui.exportHint.textContent =
      `Coordinates come from ${entry.name}, in tkreg (surface) RAS.`;
    ui.exportHint.classList.remove('warn');
    return;
  }
  // Same vertex indexing means the same ROI, so a loaded anatomical surface is
  // one click away rather than a reload.
  const better = state.surfaces.find((other) => other.anatomical
    && other.topologyKey === entry.topologyKey);
  const kind = surfaceKind(entry.name);
  ui.exportHint.textContent =
    `${entry.name} is ${kind === 'unknown' ? 'flattened' : kind}, so its x/y/z are not `
    + 'anatomical. The vertex indices are still correct — which is all freeview and '
    + 'mris_anatomical_stats read — but the coordinates are not. '
    + (better
      ? `Switch to ${better.name} before exporting if they matter.`
      : 'Load lh.white or lh.pial and switch to it if they matter.');
  ui.exportHint.classList.add('warn');
}

/** Live preview of the file name the export buttons will produce. */
function showExportName() {
  el('exportNameHint').textContent = state.mesh
    ? `Files will be named ${exportStem()}.\u2026`
    : 'Used in the file name and inside the file.';
}

function setMode(mode) {
  if (!state.session) return;
  // A pending "click inside the region you want" would otherwise swallow the
  // first click in the new mode, which lands as a fill instead of a landmark.
  state.awaitingSeed = false;
  state.session.setMode(mode);
  const isRoi = mode === MODE_ROI;
  ui.modeRoi.classList.toggle('active', isRoi);
  ui.modePoints.classList.toggle('active', !isRoi);
  ui.modeRoi.setAttribute('aria-checked', String(isRoi));
  ui.modePoints.setAttribute('aria-checked', String(!isRoi));
  ui.roiControls.hidden = !isRoi;
  ui.pointControls.hidden = isRoi;
  setStatus(isRoi ? 'Click along the ROI border.' : 'Click to place landmarks.');
  repaint();
}

function vertexAt(event) {
  if (!state.mesh) return -1;
  const rect = ui.canvas.getBoundingClientRect();
  const mm = pickWorldMm(
    state.nv, event.clientX - rect.left, event.clientY - rect.top, state.pickMemo
  );
  return resolveVertex(state.index, mm);
}

/**
 * Paint a vertex and its 1-ring. A single vertex is roughly one pixel on a
 * 160k-vertex hemisphere, which is too small to aim at or to see.
 */
function markVertexAndRing(vertex, label) {
  state.labelValues[vertex] = label;
  const { adjOffset, adjNeighbor } = state.graph;
  for (let e = adjOffset[vertex]; e < adjOffset[vertex + 1]; e++) {
    state.labelValues[adjNeighbor[e]] = label;
  }
}

/** A press that moves more than this many CSS pixels is a rotate, not a click. */
const CLICK_SLOP_PX = 5;

function onPointerDown(event) {
  if (event.button !== 0) return;
  state.pressOrigin = { x: event.clientX, y: event.clientY, time: performance.now() };
}

function onPointerUp(event) {
  const press = state.pressOrigin;
  state.pressOrigin = null;
  if (!press || event.button !== 0) return;

  const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
  if (moved > CLICK_SLOP_PX) return; // the user was rotating the surface
  onCanvasClick(event);
}

function onCanvasClick(event) {
  if (!state.session) return;
  const vertex = vertexAt(event);
  if (vertex < 0) return; // the ray missed the surface

  // A vertex owned by an area above this one in the list is cut out of the
  // graph, so no path can reach it. Say whose it is, rather than accept the
  // click and fail at "Close ROI" with an unexplained gap.
  if (state.excluded && isIsolated(state.graph, vertex)) {
    const owner = savedRois().find((roi) => roi.mask && roi.mask[vertex]);
    setStatus(owner
      ? `That point belongs to ${owner.name}. Move it below ${owner.name} in the ` +
        'list, or reopen that area, to draw here.'
      : 'That point belongs to an area above this one in the list.');
    return;
  }

  if (state.awaitingSeed) {
    state.awaitingSeed = false;
    runFill(vertex);
    return;
  }

  if (state.session.mode === MODE_ROI) {
    state.session.addClick(vertex);
    setStatus(`${state.session.clicks.length} point(s) on the border.`);
  } else {
    const result = state.session.togglePoint(vertex);
    setStatus(result.added
      ? `Landmark at vertex ${vertex}.`
      : `Removed the landmark at vertex ${vertex}.`);
  }
  repaint();
}

function onCanvasHover(event) {
  if (!state.mesh || event.buttons !== 0) return;
  // Read-out only. An earlier version traced a live path from the last click to
  // the cursor; it made the surface busy, and every hover moved NiiVue's
  // crosshair, which is the same state the click picker reads - so the next
  // click was frequently mistaken for a miss and dropped.
  // A depth pick is two full-scene renders and a synchronous gl.readPixels. Run
  // one per animation frame at most, and never while one is in flight: without
  // this, every mouse move over the canvas costs a pick, which on a software
  // renderer — a Neurodesk container or VDI session, not just CI — is half a
  // second each and the app appears frozen whenever the pointer is over it.
  if (state.hoverPending) return;
  state.hoverPending = true;
  requestAnimationFrame(() => {
    state.hoverPending = false;
    if (!state.session) return;
    const vertex = vertexAt(event);
    ui.vertexReadout.textContent = vertex >= 0 ? `vertex ${vertex}` : '';
  });
}

function runFill(seed = -1) {
  const session = state.session;
  if (!session.closed) {
    setStatus(SESSION_ERRORS.NOT_CLOSED);
    return;
  }
  // A *loop* on a surface with an open edge is not necessarily split in two, so
  // automatic interior detection is not safe there. An edge closure is different:
  // closeOnEdge has already proved the border separates the surface, and the
  // candidate regions are enumerated rather than guessed at.
  const needsSeed = state.hasOpenBoundary && seed < 0 && session.closure !== CLOSURE_EDGE;
  if (needsSeed) {
    state.awaitingSeed = true;
    setStatus('This surface has an open edge — click inside the region you want.');
    return;
  }

  const result = session.fill({
    seed,
    includeBoundary: ui.includeBoundary.checked
  });

  if (!result.ok) {
    const message = FILL_ERRORS[result.error] || SESSION_ERRORS[result.error] || result.error;
    setStatus(message);
    if (result.error === 'AMBIGUOUS_REGION' || result.error === 'FILL_ESCAPED') {
      state.awaitingSeed = true;
    }
    repaint();
    return;
  }

  const pieces = result.components > 1
    ? ` in ${result.components} separate pieces — the boundary probably crosses itself`
    : '';
  const otherSide = session.regionOrder.length > 1
    ? ' If that is the wrong side of the border, take the other side.'
    : '';
  setStatus(`Filled ${result.count.toLocaleString()} vertices${pieces}.${otherSide}`);
  repaint();
}

/**
 * Rebuild the label array from session state and push it to the GPU.
 * `previewPath` is the not-yet-committed segment under the cursor.
 */
function paintLabels() {
  const session = state.session;
  if (!session || !state.mesh) return;

  state.labelValues.fill(LABEL_NONE);

  // Completed ROIs sit underneath whatever is being drawn now.
  savedRois().forEach((roi, index) => {
    if (!roi.visible || !roi.mask) return;
    const key = LABEL_SAVED_BASE + index;
    for (let v = 0; v < state.labelValues.length; v++) {
      if (roi.mask[v]) state.labelValues[v] = key;
    }
  });

  // Fill style is purely visual — the region itself is unchanged, so exports
  // are identical whichever style is showing.
  const style = ui.fillStyle.value;
  if (session.filled && style !== FILL_STYLES.OUTLINE) {
    const ink = style === FILL_STYLES.HATCHED
      ? hatchMask(state.geometry.positions, session.filled)
      : session.filled;
    for (let v = 0; v < state.labelValues.length; v++) {
      if (ink[v]) state.labelValues[v] = LABEL_REGION;
    }
  }

  // The traced boundary and the landmarks sit on top of everything else.
  for (const v of session.chain) state.labelValues[v] = LABEL_BOUNDARY;
  // Border markers are drawn with their 1-ring so they are big enough to see,
  // which makes them wider than the vertices actually in the ROI. Once the
  // region is filled that would misrepresent its extent, so hide them. Undoing
  // a point clears the fill, and they come back.
  if (!session.filled) {
    for (const v of session.clicks) markVertexAndRing(v, LABEL_CLICK);
  }
  for (const point of session.points) markVertexAndRing(point.vertex, LABEL_POINT);

  const roiLayer = state.mesh.layers.find((layer) => layer.name === 'surfannotate-roi');
  if (roiLayer) roiLayer.colormapLabel = makeLabelLut(currentLabelTable());

  commitLayer(state.nv, state.mesh);
}

/** The palette with the region's alpha taken from the opacity slider. */
function currentLabelTable() {
  const base = LABEL_TABLE.map((entry) => entry.key === LABEL_REGION
    ? { ...entry, rgba: [entry.rgba[0], entry.rgba[1], entry.rgba[2], state.roiOpacity] }
    : entry);
  const saved = savedRois().map((roi, index) => {
    const [r, g, b] = SAVED_ROI_COLORS[roi.colorIndex];
    return {
      key: LABEL_SAVED_BASE + index,
      name: roi.name,
      rgba: [r, g, b, state.roiOpacity]
    };
  });
  return base.concat(saved);
}

function repaint() {
  if (!state.session) return;
  paintLabels();
  syncControls();
}

/** Put every drawing control back to how it starts, with nothing loaded. */
function resetControls() {
  for (const control of [ui.undoPoint, ui.closePath, ui.closeOnEdge, ui.fillRegion,
    ui.clearRoi, ui.undoPointSelection, ui.clearPoints, ui.saveRoi,
    ui.exportLabel, ui.exportGifti, ui.exportPoints]) {
    control.disabled = true;
  }
  ui.flipRegion.hidden = true;
  ui.edgeRow.hidden = true;
  ui.edgeHint.hidden = true;
  ui.pointList.innerHTML = '';
  ui.roiList.innerHTML = '';
}

function syncControls() {
  const session = state.session;
  const hasClicks = session.clicks.length > 0;
  const hasRegion = Boolean(session.filled);
  const hasPoints = session.points.length > 0;

  ui.undoPoint.disabled = !hasClicks;
  ui.closePath.disabled = session.clicks.length < 3;
  // A cut surface only: the edge is what closes the region, so a closed surface
  // has nothing to offer here. Two points are enough, unlike a loop.
  ui.edgeRow.hidden = !session.hasOpenEdge;
  ui.edgeHint.hidden = !session.hasOpenEdge;
  ui.closeOnEdge.disabled = session.clicks.length < 2;
  ui.fillRegion.disabled = !session.closed;
  ui.flipRegion.hidden = !(hasRegion && session.regionOrder.length > 1);
  ui.clearRoi.disabled = !hasClicks;
  ui.undoPointSelection.disabled = !hasPoints;
  ui.clearPoints.disabled = !hasPoints;

  ui.saveRoi.disabled = !hasRegion;
  const exportable = hasRegion || session.chain.length > 0 || Boolean(selectedRoi());
  ui.exportLabel.disabled = !exportable;
  ui.exportGifti.disabled = !exportable;
  ui.exportPoints.disabled = !hasPoints;

  ui.pointList.innerHTML = '';
  for (const point of session.points) {
    const item = document.createElement('li');
    item.textContent = `${point.name} — vertex ${point.vertex}`;
    ui.pointList.appendChild(item);
  }
}

// -- export ---------------------------------------------------------------

function download(filename, text, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function baseName() {
  return (state.sourceName || 'surface').replace(/\.[^.]+$/, '');
}

/** The user's ROI name, or a sensible default if they cleared the field. */
function roiName() {
  return ui.roiName.value.trim() || 'roi';
}

/**
 * `lh.V1` — the hemisphere, not the source surface. An ROI drawn on
 * lh.sphere.reg applies to lh.white and lh.pial too, so carrying the whole
 * source filename into the name would be misleading as well as unwieldy.
 */
function exportStem() {
  return buildExportStem(roiName(), {
    anatomicalStructure: state.mesh?.anatomicalStructurePrimary || '',
    filename: state.sourceName || ''
  });
}

function exportFreeSurferLabel() {
  const indices = exportIndices();
  const text = writeFreeSurferLabel(indices, state.geometry.positions, {
    name: roiName(),
    subject: baseName(),
    offset: activeSurface()?.translation
  });
  const filename = `${exportStem()}.label`;
  download(filename, text);
  setStatus(`Exported ${indices.length.toLocaleString()} vertices as ${filename}.`);
}

async function exportGiftiLabel() {
  const name = roiName();
  const filename = `${exportStem()}.label.gii`;
  const xml = await writeGiftiLabel(maskToLabelArray(maskFromSession(), LABEL_REGION), [
    { key: LABEL_NONE, name: '???', rgba: [0, 0, 0, 0] },
    { key: LABEL_REGION, name, rgba: [0.9, 0.2, 0.2, 1] }
  ], { arrayName: name });

  download(filename, xml, 'application/xml');
  setStatus(`Exported ${filename}.`);
}

/**
 * The vertices every export writes. Both formats go through this, so a selected
 * completed ROI is honoured identically by each — the .label export used to read
 * the session directly and would write an empty file after a save cleared it.
 */
function exportIndices() {
  return maskToIndices(maskFromSession());
}

function maskFromSession() {
  const chosen = selectedRoi();
  if (chosen) return chosen.mask;
  const session = state.session;
  if (session.filled) return session.filled;
  const mask = new Uint8Array(state.geometry.vertexCount);
  for (const v of session.chain) mask[v] = 1;
  return mask;
}

function exportPoints() {
  const text = writePointsJson(
    state.session.points, state.geometry.positions, state.meshIdentity,
    { created: new Date().toISOString(), offset: activeSurface()?.translation }
  );
  const filename = `${exportStem()}.points.json`;
  download(filename, text, 'application/json');
  setStatus(`Exported ${state.session.points.length} landmark(s) as ${filename}.`);
}

init().catch((error) => setStatus(`Startup failed: ${error.message}`));

// Exposed for the e2e smoke test, which drives the pipeline without a mouse.
// The serialisers are re-exported here because the production build bundles the
// modules, so the test cannot import them by path.
window.__surfannotate = state;
window.__surfannotateIo = {
  writeFreeSurferLabel, writeGiftiLabel, maskToLabelArray, writePointsJson
};
// The same actions the buttons invoke, so a test can drive the real code path
// (including the repaint and control-state sync) without synthesising a click
// that has to land on a specific vertex in the 3D view.
window.__surfannotateUi = {
  repaint, runFill, setMode, loadSurface, addOverlay,
  activateSurface, removeSurface, selectOverlay, setOverlayVisible, removeOverlay,
  activeSurface, activeOverlay, handleDroppedFiles,
  saveRoi, removeRoi, reopenRoi, moveRoi, setRoiVisible, selectRoi, savedRois,
  exclusionMask, recomputeParcellation
};
