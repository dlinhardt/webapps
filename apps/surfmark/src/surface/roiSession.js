// Drawing state for one loaded surface.
//
// The clicked vertices are the only authoritative state. The densified boundary
// chain and the filled mask are always derived, never edited in place. freeview
// does the opposite — its "make path" step overwrites the click list with the
// densified path — which is exactly what makes undo impossible there.
//
// Recomputing from scratch is affordable because segments are memoised: undoing
// one click invalidates one segment, not the whole boundary.

import { buildChain, validateChain } from './pathfinder.js';
import { fillClosedRegion, maskToIndices } from './fill.js';

export const MODE_ROI = 'roi';
export const MODE_POINTS = 'points';

export class RoiSession {
  /**
   * @param {import('./adjacency.js').SurfaceGraph} graph
   * @param {import('./pathfinder.js').SurfacePathfinder} finder
   * @param {Float32Array} vertices geometry used for interior detection
   */
  constructor(graph, finder, vertices) {
    this.graph = graph;
    this.finder = finder;
    this.vertices = vertices;

    this.mode = MODE_ROI;
    this.clicks = [];
    this.closed = false;
    this.chain = new Int32Array(0);
    this.gaps = [];
    this.filled = null;
    this.fillError = null;
    this.components = 0;
    this.points = [];

    this._segmentCache = new Map();
  }

  setMode(mode) {
    if (mode !== MODE_ROI && mode !== MODE_POINTS) throw new Error(`unknown mode "${mode}"`);
    this.mode = mode;
  }

  // -- ROI boundary -------------------------------------------------------

  /**
   * Record a border point. Deliberately does NOT trace anything — the clicks
   * stand alone as markers until the user closes the ROI. Tracing as you go
   * means a path redrawn on every click, and a live preview that fights the
   * next click for the picker.
   *
   * @returns {boolean} true when the click changed anything
   */
  addClick(vertex) {
    if (vertex < 0 || vertex >= this.graph.V) return false;
    if (this.clicks.length && this.clicks[this.clicks.length - 1] === vertex) return false;
    this.clicks.push(vertex);
    this._reopen();
    return true;
  }

  undoClick() {
    if (!this.clicks.length) return false;
    this.clicks.pop();
    this._reopen();
    return true;
  }

  /**
   * Trace the shortest surface path through every click in order, join the last
   * back to the first, and validate the result. This is the only place a chain
   * is built.
   *
   * @returns {{ok: boolean, gaps: Array<[number, number]>, chainLength: number}}
   */
  closePath() {
    if (this.clicks.length < 3) {
      return { ok: false, gaps: [], chainLength: 0 };
    }
    this.closed = true;
    this._recompute();
    const validation = validateChain(this.graph, this.chain);
    const ok = this.gaps.length === 0 && validation.ok;
    if (!ok) this.closed = false;
    return { ok, gaps: this.gaps, chainLength: this.chain.length };
  }

  /** Editing the clicks invalidates any traced boundary and fill. */
  _reopen() {
    this.closed = false;
    this.chain = new Int32Array(0);
    this.gaps = [];
    this.filled = null;
    this.fillError = null;
    this.components = 0;
  }

  clearRoi() {
    this.clicks = [];
    this.closed = false;
    this.chain = new Int32Array(0);
    this.gaps = [];
    this.filled = null;
    this.fillError = null;
    this.components = 0;
    this._segmentCache.clear();
  }

  /** The boundary as a mask, for rendering and for the fill barrier. */
  boundaryMask() {
    const mask = new Uint8Array(this.graph.V);
    for (const v of this.chain) mask[v] = 1;
    return mask;
  }

  /**
   * @param {object} [options]
   * @param {number} [options.seed] interior vertex; omit for automatic detection
   * @param {boolean} [options.includeBoundary]
   * @returns {{ok: boolean, error: string|null, count: number, components: number}}
   */
  fill(options = {}) {
    if (!this.closed) {
      this.fillError = 'NOT_CLOSED';
      return { ok: false, error: 'NOT_CLOSED', count: 0, components: 0 };
    }
    const validation = validateChain(this.graph, this.chain);
    if (!validation.ok) {
      this.fillError = 'BROKEN_BOUNDARY';
      return { ok: false, error: 'BROKEN_BOUNDARY', count: 0, components: 0 };
    }

    const result = fillClosedRegion(this.graph, this.boundaryMask(), {
      seed: options.seed ?? -1,
      vertices: this.vertices,
      includeBoundary: options.includeBoundary ?? false
    });

    this.filled = result.inside;
    this.fillError = result.error;
    this.components = result.components;
    return {
      ok: result.error === null,
      error: result.error,
      count: result.count,
      components: result.components
    };
  }

  /** Vertices in the filled region, or the boundary when nothing is filled. */
  regionIndices() {
    if (this.filled) return maskToIndices(this.filled);
    return Int32Array.from(this.chain);
  }

  // -- Point selection ----------------------------------------------------

  /** Toggle: clicking an existing landmark removes it. */
  togglePoint(vertex, name = '') {
    const existing = this.points.findIndex((point) => point.vertex === vertex);
    if (existing >= 0) {
      this.points.splice(existing, 1);
      return { added: false, vertex };
    }
    this.points.push({ vertex, name: name || `p${this.points.length + 1}` });
    return { added: true, vertex };
  }

  undoPoint() {
    return this.points.pop() || null;
  }

  clearPoints() {
    this.points = [];
  }

  // -- internals ----------------------------------------------------------

  _recompute() {
    const result = buildChain(this.finder, this.clicks, {
      closed: this.closed,
      cache: this._segmentCache
    });
    this.chain = result.chain;
    this.gaps = result.gaps;
  }
}

/** Messages for the states the session can report. */
export const SESSION_ERRORS = Object.freeze({
  NOT_CLOSED: 'Close the ROI before filling.',
  BROKEN_BOUNDARY: 'The boundary has a gap — part of it could not be joined across the surface.'
});
