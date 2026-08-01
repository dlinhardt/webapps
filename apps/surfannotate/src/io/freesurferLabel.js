// FreeSurfer .label writer and reader.
//
// Format (utils/label.cpp, LabelWrite):
//   line 1   #!ascii label <name> , from subject <subject> vox2ras=TkReg
//   line 2   <count>
//   line 3+  <vertexIndex>  <x>  <y>  <z> <stat>
//
// Column 0 is the only column FreeSurfer's surface tools read; the coordinates
// are informational. They must nonetheless be tkreg/surface RAS — the raw
// coordinates from lh.white or lh.pial. If the user drew on lh.inflated, write
// the white-surface coordinates, which is exactly what freeview does.
//
// FreeSurfer reuses this same format for control points, so a .label file
// doubles as the landmark export for the point-selection workflow.

/**
 * @param {Int32Array|number[]} vertexIndices
 * @param {Float32Array} anatomicalVertices 3*V xyz in tkreg RAS (white/pial)
 * @param {object} [options]
 * @param {string} [options.name] label name recorded in the header
 * @param {string} [options.subject] subject id recorded in the header
 * @param {Float32Array|number[]} [options.stat] per-entry scalar, default 0
 * @returns {string}
 */
export function writeFreeSurferLabel(vertexIndices, anatomicalVertices, options = {}) {
  const { name = 'roi', subject = '', stat = null } = options;
  const count = vertexIndices.length;

  const lines = new Array(count + 2);
  // The header is delimited by a comma and one line, so a name containing
  // either would not survive a round-trip through readFreeSurferLabel.
  lines[0] = `#!ascii label ${sanitizeHeaderField(name)} , ` +
    `from subject ${sanitizeHeaderField(subject)} vox2ras=TkReg`;
  lines[1] = String(count);

  for (let i = 0; i < count; i++) {
    const v = vertexIndices[i];
    const x = anatomicalVertices[3 * v].toFixed(3);
    const y = anatomicalVertices[3 * v + 1].toFixed(3);
    const z = anatomicalVertices[3 * v + 2].toFixed(3);
    const s = (stat ? stat[i] : 0).toFixed(10);
    lines[i + 2] = `${v}  ${x}  ${y}  ${z} ${s}`;
  }
  return lines.join('\n') + '\n';
}

/**
 * Strip the characters that would break the single-line, comma-delimited
 * header, collapsing the whitespace they leave behind. The reader splits on
 * runs of whitespace, so doubled spaces are harmless there — but they show up
 * verbatim in every tool that prints the label name.
 */
export function sanitizeHeaderField(value) {
  return String(value).replace(/[,\r\n]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parse a .label file. Tolerant of extra whitespace and of the trailing blank
 * line every writer emits.
 *
 * @param {string} text
 * @returns {{vertices: Int32Array, coords: Float32Array, stat: Float32Array, name: string}}
 */
export function readFreeSurferLabel(text) {
  const lines = text.split('\n');
  if (!lines.length || !lines[0].startsWith('#!ascii label')) {
    throw new Error('not a FreeSurfer .label file (missing "#!ascii label" header)');
  }
  const nameMatch = /^#!ascii label\s+(.*?)\s*,\s*from subject/.exec(lines[0]);
  const name = nameMatch ? nameMatch[1] : '';

  const declared = Number.parseInt(lines[1], 10);
  if (!Number.isFinite(declared) || declared < 0) {
    throw new Error('.label line 2 must be the entry count');
  }

  const vertices = new Int32Array(declared);
  const coords = new Float32Array(declared * 3);
  const stat = new Float32Array(declared);

  let written = 0;
  for (let i = 2; i < lines.length && written < declared; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 5) throw new Error(`.label line ${i + 1} has ${parts.length} columns, expected 5`);
    vertices[written] = Number.parseInt(parts[0], 10);
    coords[3 * written] = Number.parseFloat(parts[1]);
    coords[3 * written + 1] = Number.parseFloat(parts[2]);
    coords[3 * written + 2] = Number.parseFloat(parts[3]);
    stat[written] = Number.parseFloat(parts[4]);
    written++;
  }
  if (written !== declared) {
    throw new Error(`.label declares ${declared} entries but contains ${written}`);
  }
  return { vertices, coords, stat, name };
}

/**
 * Expand a .label into one value per vertex, for display as an overlay.
 *
 * A .label is a sparse list — only the vertices in the region appear — so it
 * has to be scattered into a dense array before it can be shown. FreeSurfer's
 * fifth column is a per-vertex statistic, which is what people put a p-value or
 * an eccentricity in; when it is all zeros, as it is for a plain region, the
 * label is shown as a binary mask instead of a field of zeros.
 *
 * @param {string} text
 * @param {number} vertexCount vertices in the surface it is being shown on
 * @returns {{values: Float32Array, count: number, name: string, hasStat: boolean}}
 */
export function labelToValues(text, vertexCount) {
  const { vertices, stat, name } = readFreeSurferLabel(text);
  const values = new Float32Array(vertexCount);

  let hasStat = false;
  for (let i = 0; i < stat.length; i++) {
    if (stat[i] !== 0) { hasStat = true; break; }
  }

  for (let i = 0; i < vertices.length; i++) {
    const vertex = vertices[i];
    if (vertex < 0 || vertex >= vertexCount) {
      throw new Error(
        `.label refers to vertex ${vertex}, but the surface has ${vertexCount} — ` +
        'it belongs to a different mesh'
      );
    }
    values[vertex] = hasStat ? stat[i] : 1;
  }
  return { values, count: vertices.length, name, hasStat };
}
