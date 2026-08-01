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
