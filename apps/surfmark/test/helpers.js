// A flat NxN triangulated grid. Small, exactly predictable, and it exercises
// the same code paths as a cortical surface: shared edges, a boundary, and
// loops that separate the mesh into two pieces.

/**
 * Vertex (i, j) is index j*N + i, positioned at (i, j, 0).
 * @param {number} n vertices per side
 */
export function makeGrid(n) {
  const vertices = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const v = j * n + i;
      vertices[3 * v] = i;
      vertices[3 * v + 1] = j;
      vertices[3 * v + 2] = 0;
    }
  }

  const cells = (n - 1) * (n - 1);
  const triangles = new Uint32Array(cells * 6);
  let t = 0;
  for (let j = 0; j < n - 1; j++) {
    for (let i = 0; i < n - 1; i++) {
      const v = j * n + i;
      triangles[t++] = v;         triangles[t++] = v + 1;     triangles[t++] = v + n;
      triangles[t++] = v + 1;     triangles[t++] = v + n + 1; triangles[t++] = v + n;
    }
  }
  return { vertices, triangles, n, V: n * n };
}

/** Index of grid vertex (i, j). */
export const at = (n, i, j) => j * n + i;

/**
 * Clicks tracing the perimeter of the square [a..b] x [a..b], as four corners.
 * Consecutive corners are joined by axis-aligned runs, so the densified chain
 * stays on grid edges.
 */
export function squareCorners(n, a, b) {
  return [at(n, a, a), at(n, b, a), at(n, b, b), at(n, a, b)];
}

/** The full perimeter vertex set of that square, as a barrier mask. */
export function squareBarrier(n, a, b) {
  const barrier = new Uint8Array(n * n);
  for (let i = a; i <= b; i++) {
    barrier[at(n, i, a)] = 1;
    barrier[at(n, i, b)] = 1;
  }
  for (let j = a; j <= b; j++) {
    barrier[at(n, a, j)] = 1;
    barrier[at(n, b, j)] = 1;
  }
  return barrier;
}

/** Count set entries in a mask. */
export function countMask(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
  return n;
}
