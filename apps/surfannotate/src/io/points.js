// Point/landmark export for the vertex-selection workflow.
//
// No standard format exists for "a named list of cortical vertices", so this
// defines a small self-describing one and ships a CSV sibling for R/Python.
// Both carry a mesh fingerprint: loading a point set onto a different surface
// silently produces nonsense, which is exactly what Workbench's
// SurfaceNumberOfVertices attribute exists to prevent.
//
// FreeSurfer's own control-point files are .label files, so the .label writer
// also serves this workflow for round-tripping into freeview.

export const POINTS_FORMAT = 'surf-roi-points/1';

/**
 * @typedef {object} SurfacePoint
 * @property {number} vertex
 * @property {string} [name]
 * @property {string} [color] CSS hex
 */

/**
 * @typedef {object} MeshIdentity
 * @property {string} [structure]   e.g. "CortexLeft"
 * @property {number} numVertices
 * @property {number} numTriangles
 * @property {string} [sourceFile]
 * @property {string} [triangleHash] "sha256:..." from hashTriangles()
 */

/**
 * @param {SurfacePoint[]} points
 * @param {Float32Array} vertices 3*V xyz in the space named by coordinateSpace
 * @param {MeshIdentity} mesh
 * @param {object} [options]
 * @param {string} [options.coordinateSpace] default 'tkreg-ras-white'
 * @param {string} [options.created] ISO timestamp; supplied by the caller so
 *   the writer stays deterministic and testable
 * @returns {string}
 */
export function writePointsJson(points, vertices, mesh, options = {}) {
  const { coordinateSpace = 'tkreg-ras-white', created = null } = options;

  const document = {
    format: POINTS_FORMAT,
    ...(created ? { created } : {}),
    mesh,
    coordinateSpace,
    points: points.map((point) => {
      const v = point.vertex;
      const entry = {
        vertex: v,
        ...(point.name ? { name: point.name } : {}),
        xyz: [
          round3(vertices[3 * v]),
          round3(vertices[3 * v + 1]),
          round3(vertices[3 * v + 2])
        ]
      };
      if (point.color) entry.color = point.color;
      return entry;
    })
  };
  return JSON.stringify(document, null, 2) + '\n';
}

/**
 * @param {SurfacePoint[]} points
 * @param {Float32Array} vertices
 * @returns {string}
 */
export function writePointsCsv(points, vertices) {
  const rows = ['vertex,name,x,y,z'];
  for (const point of points) {
    const v = point.vertex;
    rows.push([
      v,
      csvEscape(point.name || ''),
      round3(vertices[3 * v]),
      round3(vertices[3 * v + 1]),
      round3(vertices[3 * v + 2])
    ].join(','));
  }
  return rows.join('\n') + '\n';
}

/**
 * @param {string} text
 * @returns {{format: string, mesh: MeshIdentity, points: SurfacePoint[]}}
 */
export function readPointsJson(text) {
  const parsed = JSON.parse(text);
  if (parsed.format !== POINTS_FORMAT) {
    throw new Error(`unsupported point file format "${parsed.format}"`);
  }
  if (!Array.isArray(parsed.points)) throw new Error('point file has no points array');
  return parsed;
}

/**
 * Fingerprint the mesh topology so a point set can refuse to load onto a
 * different surface. Topology, not geometry — this is deliberately stable
 * across white/pial/inflated, which all share a triangle list.
 *
 * @param {Uint32Array} triangles
 * @returns {Promise<string>} "sha256:<hex>"
 */
export async function hashTriangles(triangles) {
  const bytes = new Uint8Array(triangles.buffer, triangles.byteOffset, triangles.byteLength);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
  return `sha256:${hex}`;
}

/**
 * @param {MeshIdentity} expected
 * @param {MeshIdentity} actual
 * @returns {{ok: boolean, reason: string|null}}
 */
export function checkMeshIdentity(expected, actual) {
  if (expected.numVertices !== actual.numVertices) {
    return {
      ok: false,
      reason: `vertex count differs (file ${expected.numVertices}, surface ${actual.numVertices})`
    };
  }
  if (expected.triangleHash && actual.triangleHash && expected.triangleHash !== actual.triangleHash) {
    return { ok: false, reason: 'the file was made on a surface with different topology' };
  }
  return { ok: true, reason: null };
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function csvEscape(value) {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
