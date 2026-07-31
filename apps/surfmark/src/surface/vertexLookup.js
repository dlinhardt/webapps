// Nearest-vertex lookup over a uniform spatial grid.
//
// NiiVue provides NVMesh.indexNearestXYZmm(), but it is a linear scan over
// every vertex — about 3 ms on a 163k-vertex pial surface. That is fine for a
// single click and far too slow for hover preview or drag painting, both of
// which want to run every frame.
//
// A uniform grid is the right structure here: cortical vertices are near-evenly
// spaced, so buckets stay balanced and there is no tree to rebalance. Build is
// a single pass; queries touch a 3x3x3 neighbourhood and widen only if empty.

/**
 * @typedef {object} VertexIndex
 * @property {(x: number, y: number, z: number) => {vertex: number, distance: number}} nearest
 * @property {number} cellSize
 */

/**
 * @param {Float32Array} vertices 3*V xyz
 * @param {object} [options]
 * @param {number} [options.targetPerCell] average occupancy, default 2
 * @returns {VertexIndex}
 */
export function buildVertexIndex(vertices, options = {}) {
  const { targetPerCell = 2 } = options;
  const V = vertices.length / 3;
  if (V === 0) throw new Error('cannot index an empty mesh');

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let v = 0; v < V; v++) {
    const x = vertices[3 * v];
    const y = vertices[3 * v + 1];
    const z = vertices[3 * v + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }

  const spanX = Math.max(maxX - minX, 1e-6);
  const spanY = Math.max(maxY - minY, 1e-6);
  const spanZ = Math.max(maxZ - minZ, 1e-6);

  // Choose a cell size that puts roughly `targetPerCell` vertices in each cell.
  const volume = spanX * spanY * spanZ;
  const cellSize = Math.max(Math.cbrt((volume * targetPerCell) / V), 1e-6);

  const nx = Math.max(1, Math.ceil(spanX / cellSize));
  const ny = Math.max(1, Math.ceil(spanY / cellSize));
  const nz = Math.max(1, Math.ceil(spanZ / cellSize));
  const cellCount = nx * ny * nz;

  const cellOf = (x, y, z) => {
    const ix = clamp(Math.floor((x - minX) / cellSize), 0, nx - 1);
    const iy = clamp(Math.floor((y - minY) / cellSize), 0, ny - 1);
    const iz = clamp(Math.floor((z - minZ) / cellSize), 0, nz - 1);
    return { ix, iy, iz };
  };

  // Counting sort vertices into cells (CSR again).
  const counts = new Uint32Array(cellCount + 1);
  for (let v = 0; v < V; v++) {
    const { ix, iy, iz } = cellOf(vertices[3 * v], vertices[3 * v + 1], vertices[3 * v + 2]);
    counts[ix + nx * (iy + ny * iz) + 1]++;
  }
  for (let c = 0; c < cellCount; c++) counts[c + 1] += counts[c];

  const cursor = counts.slice(0, cellCount);
  const items = new Uint32Array(V);
  for (let v = 0; v < V; v++) {
    const { ix, iy, iz } = cellOf(vertices[3 * v], vertices[3 * v + 1], vertices[3 * v + 2]);
    items[cursor[ix + nx * (iy + ny * iz)]++] = v;
  }

  const maxRing = Math.max(nx, ny, nz);

  function nearest(x, y, z) {
    const { ix, iy, iz } = cellOf(x, y, z);
    let best = -1;
    let bestSquared = Infinity;

    for (let ring = 0; ring <= maxRing; ring++) {
      // Once a candidate is closer than the ring's guaranteed minimum distance,
      // no wider ring can improve on it.
      if (best >= 0 && Math.sqrt(bestSquared) <= (ring - 1) * cellSize) break;

      const x0 = Math.max(0, ix - ring), x1 = Math.min(nx - 1, ix + ring);
      const y0 = Math.max(0, iy - ring), y1 = Math.min(ny - 1, iy + ring);
      const z0 = Math.max(0, iz - ring), z1 = Math.min(nz - 1, iz + ring);

      for (let cz = z0; cz <= z1; cz++) {
        for (let cy = y0; cy <= y1; cy++) {
          for (let cx = x0; cx <= x1; cx++) {
            // Only the shell of the ring is new.
            const onShell = ring === 0 ||
              cx === ix - ring || cx === ix + ring ||
              cy === iy - ring || cy === iy + ring ||
              cz === iz - ring || cz === iz + ring;
            if (!onShell) continue;

            const cell = cx + nx * (cy + ny * cz);
            for (let i = counts[cell]; i < counts[cell + 1]; i++) {
              const v = items[i];
              const dx = vertices[3 * v] - x;
              const dy = vertices[3 * v + 1] - y;
              const dz = vertices[3 * v + 2] - z;
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 < bestSquared) { bestSquared = d2; best = v; }
            }
          }
        }
      }
      if (x0 === 0 && y0 === 0 && z0 === 0 && x1 === nx - 1 && y1 === ny - 1 && z1 === nz - 1) break;
    }
    return { vertex: best, distance: Math.sqrt(bestSquared) };
  }

  return { nearest, cellSize };
}

function clamp(value, low, high) {
  return value < low ? low : value > high ? high : value;
}
