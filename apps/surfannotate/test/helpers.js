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

/**
 * The same grid with a square hole punched through it, so the patch is an
 * annulus rather than a disk. A line from the outer edge to the rim of the hole
 * does *not* separate an annulus — you can still walk round the other side —
 * which is the case edge closure has to detect and refuse.
 *
 * @param {number} n vertices per side
 * @param {number} a low corner of the removed cell block
 * @param {number} b high corner, exclusive of the last cell's far vertices
 */
export function makeGridWithHole(n, a, b) {
  const grid = makeGrid(n);
  const kept = [];
  for (let f = 0; f < grid.triangles.length / 3; f++) {
    // Cells run two triangles each, in row-major order over (n-1)^2 cells.
    const cell = Math.floor(f / 2);
    const i = cell % (n - 1);
    const j = Math.floor(cell / (n - 1));
    if (i >= a && i < b && j >= a && j < b) continue;
    kept.push(grid.triangles[3 * f], grid.triangles[3 * f + 1], grid.triangles[3 * f + 2]);
  }
  return { ...grid, triangles: Uint32Array.from(kept) };
}

/** A closed surface — no open edge anywhere. */
export function makeTetrahedron() {
  const vertices = Float32Array.from([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1]);
  const triangles = Uint32Array.from([0, 2, 1, 0, 1, 3, 0, 3, 2, 1, 2, 3]);
  return { vertices, triangles, V: 4 };
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
