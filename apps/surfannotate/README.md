# SurfAnnotate

Cortical surface viewer with manual ROI delineation and vertex selection. Everything
runs in the browser — no surface, overlay or label ever leaves your machine.

## What it does

**Visualisation.** Load a FreeSurfer surface (`lh.pial`, `lh.white`, `lh.inflated`, …),
a GIfTI `.surf.gii`, `.mz3`, or any other mesh NiiVue reads, then add a per-vertex
overlay: curvature, thickness, `.annot`, `.label.gii`, `.shape.gii`, `.mgz`, or CIFTI
`.dscalar.nii`. Colour map, opacity and display window are adjustable, including
`gist_rainbow`, which NiiVue does not ship.

**Closed ROIs.** Click border points around a region — nothing is traced while you
click, so you can rotate freely. Press *Close ROI* to join the points with shortest
paths along the surface and close the loop, then *Fill region*. Points are joined **in
the order placed**, not by proximity.

**ROIs against the edge of a flat patch.** On a cut surface — an unfolded flat patch,
or any mesh with an open edge — an area often runs right up to the cut, so its border
is partly your line and partly the edge of the patch itself. *Close on surface edge*
draws only the part that crosses the patch: both ends of your line are extended to the
nearest edge vertex, and the edge closes the region. Two points are enough. The smaller
of the two sides is filled, and *Other side* swaps.

Nothing is traced *along* the edge, because nothing needs to be. Flood fill walks the
mesh's 1-ring graph and no edge of that graph crosses the cut, so the cut is already an
impassable barrier. A border reaching it at both ends therefore separates the patch on
its own — and that separation is verified by counting connected components, not assumed.
A line running between *two different* cuts (the outer rim and the rim of a hole) does
not separate an annulus, and is refused rather than silently filled.

**Several surfaces and overlays at once.** Load as many surfaces as you like — by
picker or by dropping them on the viewer — and switch between them from the list. One
is shown at a time, because overlapping cortical surfaces occlude each other and a
click over two of them could not be attributed to either. Overlays belong to the
surface they were loaded onto, and each has its own visibility, colour map and range.

ROIs follow the *vertex indexing*, not the file. Surfaces sharing one — a subject's
`white`, `pial`, `inflated` and `sphere` — share the border points, so you can place
them on the inflated surface and see them on the folded one. The traced border and the
fill are rebuilt on the new surface rather than carried across, because the shortest
path between two vertices genuinely runs differently over different geometry. Surfaces
with unrelated topology keep separate, independent ROIs.

Dropped files are identified by their magic number and name rather than by drop order,
so a surface and an overlay can be dropped in any sequence.

**Areas drawn in sequence.** Save a filled region to the completed list, and it can
then be ticked as an **edge**: the ROI is cut out of the surface graph, so its border
behaves exactly like the cut edge of a flat patch. Draw V1, tick it, and V2 needs only
the clicks along its own outer border — the V1/V2 boundary is inherited exactly rather
than re-clicked, so the two areas share a boundary instead of leaving a sliver of
unassigned cortex between them. No fill can cross an ROI marked as an edge.

This works on closed surfaces too. `lh.pial` has no edge to begin with, but once V1 is
cut out it is a sphere with a hole in it, and every edge closure applies.

Completed ROIs are listed with their own colour, a visibility tick and a remove button.
Clicking a name makes the export buttons write it instead of the region being drawn, and
the pencil reopens it: the ROI leaves the list, its border points go back on the canvas,
and the border is retraced the way it was closed, so it can be adjusted and saved again.
Reopening recomputes the border from the points rather than restoring the saved trace,
because the points are the authoritative state and the surface may have changed since —
another ROI may have become an edge, and the border should respect it. Any neighbour
whose region covers part of the border is unticked as an edge first, and named in the
status line: adjacent areas share a boundary, and the vertices one was drawn along
usually belong to the other.

**Vertex selection.** Point-and-click landmarks, exported as a vertex list.

## Exports

| Format | Use |
| --- | --- |
| FreeSurfer `.label` | The universal FreeSurfer exchange format; opens in freeview. Also FreeSurfer's own control-point format, so it doubles as a landmark file. |
| GIfTI `.label.gii` | Opens in Connectome Workbench, FSL, nibabel, NiiVue. Carries the ROI name and colour. |
| Points JSON | Landmarks plus a mesh fingerprint, so a point set cannot be loaded onto the wrong surface. |

Files are named `<hemisphere>.<roi>`, e.g. `lh.V1.label` — not after the specific
surface they were drawn on. An ROI traced on `lh.sphere.reg` applies equally to
`lh.white` and `lh.pial`, which share a vertex indexing. The hemisphere comes from
GIfTI's `AnatomicalStructurePrimary` when present, otherwise from the filename
(FreeSurfer `lh.`/`rh.`, BIDS `hemi-L`, or HCP `.L.`); when it cannot be determined
the file is just `<roi>.label`.

CIFTI `.dlabel.nii` is deliberately not supported: it is only meaningful relative to a
specific grayordinate space, which a native-space surface is not. Export `.label.gii`
and run `wb_command -cifti-create-label`, which is what the HCP pipelines do.

## Development

```bash
pnpm --filter surfannotate dev            # vite dev server
pnpm --filter surfannotate test           # node --test, no browser needed
pnpm --filter surfannotate lint           # syntax check
pnpm --filter surfannotate build          # production bundle

node scripts/fetch-fixtures.mjs       # download the e2e surfaces (once)
pnpm --filter surfannotate test:e2e       # Playwright, headless WebGL2 via SwiftShader
```

Fixtures (`lh.pial`, `lh.curv`, from NiiVue's BSD-2 demo assets) are downloaded on
demand into `test/fixtures/`, which is gitignored — they are far too large to commit
and would breach the artifact budget if they reached `dist/`.

## Licence

MIT. Uses [NiiVue](https://github.com/niivue/niivue) (BSD-2-Clause) for rendering and
mesh parsing.
