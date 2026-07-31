# SurfMark

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

**Vertex selection.** Point-and-click landmarks, exported as a vertex list.

## Exports

| Format | Use |
| --- | --- |
| FreeSurfer `.label` | The universal FreeSurfer exchange format; opens in freeview. Also FreeSurfer's own control-point format, so it doubles as a landmark file. |
| GIfTI `.label.gii` | Opens in Connectome Workbench, FSL, nibabel, NiiVue. Carries the ROI name and colour. |
| GIfTI `.shape.gii` | The region as a Float32 0/1 metric. |
| Points JSON | Landmarks plus a mesh fingerprint, so a point set cannot be loaded onto the wrong surface. |

CIFTI `.dlabel.nii` is deliberately not supported: it is only meaningful relative to a
specific grayordinate space, which a native-space surface is not. Export `.label.gii`
and run `wb_command -cifti-create-label`, which is what the HCP pipelines do.

## Development

```bash
pnpm --filter surfmark dev            # vite dev server
pnpm --filter surfmark test           # node --test, no browser needed
pnpm --filter surfmark lint           # syntax check
pnpm --filter surfmark build          # production bundle

node scripts/fetch-fixtures.mjs       # download the e2e surfaces (once)
pnpm --filter surfmark test:e2e       # Playwright, headless WebGL2 via SwiftShader
```

Fixtures (`lh.pial`, `lh.curv`, from NiiVue's BSD-2 demo assets) are downloaded on
demand into `test/fixtures/`, which is gitignored — they are far too large to commit
and would breach the artifact budget if they reached `dist/`.

## Licence

MIT. Uses [NiiVue](https://github.com/niivue/niivue) (BSD-2-Clause) for rendering and
mesh parsing.
