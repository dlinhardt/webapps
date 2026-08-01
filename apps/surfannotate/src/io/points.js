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
  const { coordinateSpace = 'tkreg-ras-white', created = null, offset = null } = options;
  // Same reason as the .label writer: the document names a coordinate space, so
  // the numbers have to be in it. See io/geometryOffset.js.
  const [dx, dy, dz] = offset || [0, 0, 0];

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
          round3(vertices[3 * v] - dx),
          round3(vertices[3 * v + 1] - dy),
          round3(vertices[3 * v + 2] - dz)
        ]
      };
      if (point.color) entry.color = point.color;
      return entry;
    })
  };
  return JSON.stringify(document, null, 2) + '\n';
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

function round3(value) {
  return Math.round(value * 1000) / 1000;
}
