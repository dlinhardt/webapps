# ZARRo

ZARRo streams multiscale microscopy and medical-imaging volumes from
public object storage directly into NiiVue. The browser fetches only the Zarr
chunks needed for the current field of view; it does not download or upload the
complete dataset.

## Features

- A verified public DANDI SPIM dataset is ready to explore on first load.
- Custom OME-Zarr v2 and v3 stores can be opened from `https://`, `http://`, or
  `s3://` store-root URLs when the host permits browser CORS requests.
- Multiple stores can be added to one viewer. ZARRo composes them on a shared
  voxel grid using their OME-NGFF translation coordinates and preserves the
  resulting physical world origin in the rendered volume and NIfTI export.
- Zoom selections are applied explicitly, avoiding expensive pyramid replanning
  while the slider is still moving; pan retains coarser context automatically.
- Multiplanar, single-slice, and cropped 3D rendering layouts are available.
- Windowing, colour maps, physical scale bars, crosshairs, and distance
  measurements are handled in the browser.
- The current field of view can be exported as NIfTI.

## Development

From the repository root:

```bash
pnpm install
pnpm --filter omezarr-viewer dev
pnpm --filter omezarr-viewer test
pnpm --filter omezarr-viewer build
```

The app uses the shared `@neurodesk/webapp-components` imaging workspace and
theme tokens. OME-Zarr metadata, chunk selection, caching, and export logic stay
app-owned because they are specific to cloud-native multiscale volumes.

## Data flow

`zarrita.FetchStore` reads OME-NGFF metadata and fetches native Zarr chunks.
NiiVue's chunked-volume API requests visible viewer bricks and uploads completed
bricks to the GPU under bounded cache and residency budgets. Spatial Z/Y/X axes
are mapped to viewer X/Y/Z, and source units are converted to millimetres.

The built-in example is the public DANDI store
`e8633ce6-0922-4de1-a453-8ffbed48f1d2`, starting at pyramid level 4 with an
intensity window of 0–6500.
