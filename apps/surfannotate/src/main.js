import '@neurodesk/webapp-components/styles/base.css';
import './styles.css';

import { mountImagingWorkspace } from '@neurodesk/webapp-components/core/mount-imaging-workspace';
import { Niivue } from '@niivue/niivue';
import { registerExtraColormaps } from './niivue/colormaps.js';

import { buildAdjacency, findBoundaryVertices } from './surface/adjacency.js';
import { SurfacePathfinder } from './surface/pathfinder.js';
import { buildVertexIndex } from './surface/vertexLookup.js';
import {
  RoiSession, MODE_ROI, MODE_POINTS, SESSION_ERRORS, CLOSURE_EDGE
} from './surface/roiSession.js';
import { FILL_ERRORS } from './surface/fill.js';
import { hatchMask, FILL_STYLES } from './surface/hatch.js';
import {
  loadMeshFromFile, loadOverlay, getGeometry, pickWorldMm, resolveVertex,
  attachLabelLayer, commitLayer, setOverlayDisplay, makeLabelLut
} from './niivue/meshAdapter.js';

import { writeFreeSurferLabel } from './io/freesurferLabel.js';
import { writeGiftiLabel, maskToLabelArray } from './io/gifti.js';
import { writePointsJson, hashTriangles } from './io/points.js';
import { exportStem as buildExportStem } from './io/naming.js';

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

const el = (id) => document.getElementById(id);

const ui = {
  surfaceInput: el('surfaceInput'),
  overlayInput: el('overlayInput'),
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
  roiName: el('roiName'),
  exportLabel: el('exportLabel'),
  exportGifti: el('exportGifti'),
  exportPoints: el('exportPoints'),
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
  mark: 'S' // a 30x30 badge — one glyph, not a tagline
});

const state = {
  nv: null,
  mesh: null,
  geometry: null,
  graph: null,
  finder: null,
  index: null,
  session: null,
  labelValues: null,
  layerIndex: -1,
  overlayLayer: null,
  overlayAutoRange: null,
  pressOrigin: null,
  pickMemo: { x: -1, y: -1, mm: null },
  meshIdentity: null,
  awaitingSeed: false,
  roiOpacity: 0.55,
  sourceName: ''
};

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
    const file = event.target.files?.[0];
    if (file) loadSurface(file);
  });
  ui.overlayInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (file) addOverlay(file);
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
    handleDroppedFiles(Array.from(files));
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
    state.session.clearRoi();
    state.awaitingSeed = false;
    setStatus('Boundary cleared.');
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
    if (!state.overlayLayer) return;
    setOverlayDisplay(state.nv, state.mesh, state.overlayLayer, {
      colormap: ui.overlayColormap.value,
      opacity: Number(ui.overlayOpacity.value)
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

  ui.exportLabel.addEventListener('click', exportFreeSurferLabel);
  ui.exportGifti.addEventListener('click', exportGiftiLabel);
  ui.exportPoints.addEventListener('click', exportPoints);

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
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

  setStatus('Load a surface to begin.');
}

/**
 * A drop with no surface loaded is a surface; afterwards it is an overlay.
 * Dropping two files at once loads the first as the surface and the second as
 * its overlay, which is the common "lh.pial + lh.curv" case.
 */
async function handleDroppedFiles(files) {
  if (!state.mesh) {
    await loadSurface(files[0]);
    if (files.length > 1 && state.mesh) await addOverlay(files[1]);
    return;
  }
  await addOverlay(files[0]);
}

async function loadSurface(file) {
  setStatus(`Loading ${file.name}…`);
  try {
    // Replace any previous surface rather than stacking meshes.
    for (const existing of [...state.nv.meshes]) state.nv.removeMesh(existing);

    const mesh = await loadMeshFromFile(state.nv, file);
    const geometry = getGeometry(mesh);

    setStatus(`Indexing ${geometry.vertexCount.toLocaleString()} vertices…`);
    // Yield so the status paints before the synchronous build.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const graph = buildAdjacency(geometry.positions, geometry.triangles);
    const finder = new SurfacePathfinder(graph, geometry.positions);
    const index = buildVertexIndex(geometry.positions);

    state.mesh = mesh;
    state.geometry = geometry;
    state.graph = graph;
    state.finder = finder;
    state.index = index;
    const openBoundary = findBoundaryVertices(geometry.triangles, geometry.vertexCount);
    let openCount = 0;
    for (let v = 0; v < openBoundary.length; v++) if (openBoundary[v]) openCount++;
    state.hasOpenBoundary = openCount > 0;

    state.session = new RoiSession(graph, finder, geometry.positions, {
      openEdge: state.hasOpenBoundary ? openBoundary : null
    });
    state.labelValues = new Float32Array(geometry.vertexCount);
    state.layerIndex = attachLabelLayer(mesh, state.labelValues, currentLabelTable());
    state.sourceName = file.name;

    state.meshIdentity = {
      numVertices: geometry.vertexCount,
      numTriangles: geometry.triangles.length / 3,
      sourceFile: file.name,
      triangleHash: await hashTriangles(geometry.triangles)
    };

    commitLayer(state.nv, mesh);
    ui.dropHint.hidden = true;
    showExportName();
    ui.overlayInput.disabled = false;
    ui.overlayOpacity.disabled = false;
    state.overlayLayer = null;

    const note = state.hasOpenBoundary
      ? ' This surface is cut, so you can close an ROI against its edge.'
      : '';
    setStatus(`${file.name}: ${geometry.vertexCount.toLocaleString()} vertices, ` +
      `${(geometry.triangles.length / 3).toLocaleString()} faces.${note}`);
    repaint();
  } catch (error) {
    // Surface it in the UI *and* the console — a parse failure deep inside
    // NiiVue is otherwise silent and looks like "nothing happened".
    console.error('surfannotate: failed to load surface', error);
    setStatus(
      `Could not read ${file.name} as a surface mesh: ${error.message}. ` +
      'Supported: FreeSurfer (lh.pial, lh.white, lh.inflated), GIfTI .surf.gii, ' +
      '.mz3, .obj, .stl, .ply, .vtk, .srf, .off.'
    );
    ui.dropHint.hidden = false;
  }
}

async function addOverlay(file) {
  if (!state.mesh) return;
  setStatus(`Loading overlay ${file.name}…`);
  try {
    state.overlayLayer = await loadOverlay(state.nv, state.mesh, file, {
      opacity: Number(ui.overlayOpacity.value),
      colormap: ui.overlayColormap.value
    });
    // readLayer appends, so the ROI layer is no longer last. Re-attach it on top.
    reattachRoiLayer();
    state.overlayAutoRange = {
      low: state.overlayLayer.cal_min,
      high: state.overlayLayer.cal_max
    };
    ui.overlayColormap.disabled = false;
    for (const control of [ui.overlayMin, ui.overlayMax, ui.overlayRangeReset]) {
      control.disabled = false;
    }
    showOverlayRange(state.overlayLayer);
    setStatus(
      `Overlay ${file.name} loaded — display window ` +
      `${state.overlayLayer.cal_min.toFixed(3)} to ${state.overlayLayer.cal_max.toFixed(3)}.`
    );
    repaint();
  } catch (error) {
    console.error('surfannotate: failed to load overlay', error);
    setStatus(`Could not load overlay ${file.name}: ${error.message}`);
  }
}

/** Keep the ROI layer above any overlay so the boundary stays visible. */
function reattachRoiLayer() {
  const mesh = state.mesh;
  const existing = mesh.layers.findIndex((layer) => layer.name === 'surfannotate-roi');
  if (existing >= 0) mesh.layers.splice(existing, 1);
  state.layerIndex = attachLabelLayer(mesh, state.labelValues, currentLabelTable());
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

/** Live preview of the file name the export buttons will produce. */
function showExportName() {
  el('exportNameHint').textContent = state.mesh
    ? `Files will be named ${exportStem()}.\u2026`
    : 'Used in the file name and inside the file.';
}

function setMode(mode) {
  if (!state.session) return;
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
  const vertex = vertexAt(event);
  ui.vertexReadout.textContent = vertex >= 0 ? `vertex ${vertex}` : '';
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
  return LABEL_TABLE.map((entry) => entry.key === LABEL_REGION
    ? { ...entry, rgba: [entry.rgba[0], entry.rgba[1], entry.rgba[2], state.roiOpacity] }
    : entry);
}

function repaint() {
  if (!state.session) return;
  paintLabels();
  syncControls();
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

  const exportable = hasRegion || session.chain.length > 0;
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
  const indices = state.session.regionIndices();
  const text = writeFreeSurferLabel(indices, state.geometry.positions, {
    name: roiName(),
    subject: baseName()
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

function maskFromSession() {
  const session = state.session;
  if (session.filled) return session.filled;
  const mask = new Uint8Array(state.geometry.vertexCount);
  for (const v of session.chain) mask[v] = 1;
  return mask;
}

function exportPoints() {
  const text = writePointsJson(
    state.session.points, state.geometry.positions, state.meshIdentity,
    { created: new Date().toISOString() }
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
window.__surfannotateUi = { repaint, runFill, setMode, loadSurface, addOverlay };
