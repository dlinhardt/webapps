# SurfAnnotate — agent notes

## Architecture

```
src/
  main.js                   UI wiring, interaction, export. The only DOM-aware file.
  surface/                  Pure geometry and algorithms — no DOM, no NiiVue, all unit-tested
    adjacency.js            CSR 1-ring vertex graph from (vertices, triangles)
    pathfinder.js           A* shortest path along mesh edges; chain building and validation
    edgeAnchor.js           Distance-to-cut field; extends a border out to an open edge
    fill.js                 Flood fill inside a closed boundary, seeded or automatic
    roiSession.js           Drawing state: clicks, trace, fill, landmarks
    vertexLookup.js         Uniform-grid nearest-vertex search
    hatch.js                Stripe and halo masks for fill rendering
  niivue/                   Every NiiVue call lives here
    meshAdapter.js          Loading, picking, layers, overlays
    colormaps.js            Colour maps NiiVue does not ship
  io/                       File writers/readers, pure and unit-tested
    freesurferLabel.js, gifti.js, points.js, naming.js, classify.js
```

The split matters: `surface/` and `io/` run under plain `node --test` with no browser,
which is why the algorithm suite is fast and deterministic. Only `main.js` and
`niivue/` need a WebGL context.

## Key conventions

- **All NiiVue access goes through `src/niivue/meshAdapter.js`.** 1.0.0-rc.x is a
  ground-up rewrite (`pts`/`tris` → `positions`/`indices`, camelCase layer fields, no
  `indexNearestXYZmm`), so keeping the surface area in one file makes that migration a
  single-file change. Pin stays at **0.69.0** — npm `latest`, and byte-identical mesh
  code to the 0.68.x the rest of this monorepo uses.
- **`state.surfaces` is the list; `state.mesh`/`graph`/`session`/... are mirrors of
  whichever entry is active.** Mirroring keeps the multi-surface change off every call
  site, but it means `activateSurface` is the single place that may write them.
- **Exactly one surface is visible at a time.** Not a UI preference: the depth picker
  returns a position, never an identity, so a click over two overlapping meshes could
  not be attributed to either. Multiple simultaneous surfaces would silently break
  vertex picking.
- **ROI sessions are keyed by topology (`vertexCount:triangleHash`), not by file.** One
  subject's white/pial/inflated share a session so border points survive a switch;
  `RoiSession.rebind` moves it and deliberately discards the traced chain and fill,
  which are geometry-dependent. Deleting a surface only drops the session once the last
  surface with that topology is gone.
- **The clicked vertices are the only authoritative ROI state.** The traced chain and
  the filled mask are always derived and are discarded whenever the clicks change.
  freeview does the opposite and that is what makes its undo impossible.
- **Flood fill must only ever walk the 1-ring graph.** Augmenting it (unfolded 2-ring
  edges, k-ring neighbourhoods) adds edges that cross faces, so the fill hops the
  barrier and swallows the hemisphere. Validate the chain before filling.
- **Exports are named `<hemisphere>.<roi>`, never after the source surface.** See
  `io/naming.js`. An ROI drawn on `lh.sphere.reg` is valid on any surface sharing that
  vertex indexing, so `lh.sphere.reg.surf.V1.label` would misrepresent it.
  `writeGiftiShape` in `io/gifti.js` is currently unused — the `.shape.gii` button was
  removed — but is kept and tested because it is a general format writer.
- **Never trust a fill that covers more than 40% of the surface** — that is a gap in
  the boundary, not a large ROI. Refuse and tell the user. The one exception is an
  edge closure (`closure === 'edge'`): there the barrier has already been *proved* to
  separate the graph by counting components, so a leak is not possible and the guard
  would only block a border that legitimately halves a patch.
- **A closed border is not the only way to enclose a region.** On a cut surface the open
  edge is itself an impassable barrier to a 1-ring flood fill, so a border running from
  the cut to the cut encloses a region with no loop at all. That is what `closeOnEdge`
  builds, and it is why flat patches do not need dozens of clicks along the rim.
  It does *not* follow that any edge-to-edge line separates the surface — one joining
  two distinct cuts turns an annulus into a disk without dividing it — so the component
  count is checked, never assumed.
- **`#controls` must stay `flex-wrap: nowrap`.** The shared `.nd-imaging-controls` class
  sits on the same element and sets `flex-wrap: wrap` for its own row layout. With the
  column direction `styles.css` applies, anything taller than the panel wraps into a
  second column to the *right* of a 320px panel — invisible and unreachable, and silent,
  because wrapping absorbs the overflow so `overflow-y` never scrolls. Growing the tool
  section by ~120px made every annotation button vanish the moment a cut surface was
  loaded. Covered by an e2e test that asserts one column.
- **Toggling `[hidden]` needs `display: none !important`** (in `styles.css`). Any author
  `display` rule outranks the UA stylesheet's `[hidden]`, so an element with both stays
  stubbornly visible. This shipped once as a drop hint permanently covering the canvas.

## NiiVue 0.69 traps, all found the hard way

- `NVMesh.loadLayer` is **static**; calling it on an instance throws silently. Use
  `NVMeshLoaders.readLayer(...)` and push the result onto `mesh.layers`.
- Overlays default to the **full data range**, and `readCURV` min-max normalises *and
  inverts* FreeSurfer curvature. Values cluster mid-range, so a 0–1 window renders flat
  grey and looks like a failed load. We set a 2nd–98th percentile window.
- **There is no vertex picking.** `onLocationChange` gives mm only; the picking shader
  packs depth, not identity. `indexNearestXYZmm` is a ~3 ms linear scan — 163x slower
  than the uniform grid in `vertexLookup.js`.
- **There is no "the ray missed" signal.** `depthPicker` early-returns and leaves the
  crosshair untouched, so an unchanged crosshair is ambiguous. `pickWorldMm` disambiguates
  on screen position.
- **`dragAndDropEnabled: false` is not enough.** `dropListener` calls
  `stopPropagation()`/`preventDefault()` *before* consulting that flag, so drop handlers
  must be **capture-phase** on an ancestor to see the event at all.
- `opts.loadingText` defaults to `"loading ..."` and is painted over an empty canvas.
- Geometry is `mesh.pts` / `mesh.tris`. **`mesh.vertexCount` is `pts.length`**, i.e.
  three times the vertex count.
- Avoid the `Uint8Array` packed-RGBA layer path — it renders nothing in 0.69.0. Use
  `Float32Array` values plus `colormapLabel`.
- `mesh.updateMesh(gl)` costs ~24 ms on a 163k-vertex mesh because it regenerates
  normals for unchanged geometry. Fine per interaction, too slow per frame.

## Test surface

| Command | Covers |
| --- | --- |
| `pnpm --filter surfannotate test` | `surface/` and `io/` — adjacency, A*, chain validation, fill (including escape and figure-eight cases), hatching, vertex lookup vs brute force, ROI session contract, every file writer |
| `pnpm --filter surfannotate test:e2e` | Real Chromium with SwiftShader: shell mount, WebGL2, surface load and index, picking, draw→close→fill→export, drag-and-drop, click-vs-drag, overlay window, marker lifecycle, colour map and range, ROI naming, edge closure on a flat patch |

`test/fixtures/lh.flat.surf.gii` is a synthetic flat patch — a disk with one open edge,
like `mris_flatten` output but a few kB. Regenerate with
`node test/fixtures/make-flat-patch.mjs`. Its faces are wound to point along -x on
purpose: a sheet is one-sided, NiiVue does not cull back faces but does shade them by
the flipped normal, so from the wrong side the patch renders near-black on a dark
background and looks like a failed load. -x is where the default render view looks from.
| `pnpm --filter surfannotate lint` | `node --check` over every JS file |

**When adding an e2e test, verify it fails without the fix.** Two drag-and-drop tests
here passed against broken code — one dispatched events on the wrong element, and the
other used a synthetic `DragEvent` whose `clientX/Y` of 0 made NiiVue's `eventInBounds`
bail before the `stopPropagation` that caused the bug.
