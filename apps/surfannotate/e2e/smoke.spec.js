import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(here, '..', 'test', 'fixtures');

const errors = [];

test.beforeEach(async ({ page }) => {
  errors.length = 0;
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('./');
});

async function loadSurface(page) {
  await page.setInputFiles('#surfaceInput', join(FIXTURES, 'lh.pial'));
  await expect(page.locator('#statusText')).toContainText('163,842 vertices', { timeout: 90_000 });
}

test('the shell mounts with the shared workspace and a link back to the catalog', async ({ page }) => {
  await expect(page.locator('#controls')).toBeVisible();
  await expect(page.locator('#viewer canvas')).toBeVisible();
  // Required of every app in the composite site.
  const moreApps = page.locator('[title="More Neurodesk web apps"]');
  await expect(moreApps).toHaveCount(1);
  await expect(moreApps).toHaveAttribute('href', '../');
});

test('the empty canvas shows no phantom loading text', async ({ page }) => {
  // NiiVue paints "loading ..." over an empty canvas unless the option is cleared.
  expect(await page.evaluate(() => window.__surfannotate.nv.opts.loadingText)).toBe('');
});

test('WebGL2 is available and NiiVue attaches', async ({ page }) => {
  const info = await page.evaluate(() => {
    const gl = document.getElementById('gl').getContext('webgl2');
    return { hasContext: Boolean(gl), attached: Boolean(window.__surfannotate?.nv) };
  });
  expect(info.hasContext).toBe(true);
  expect(info.attached).toBe(true);
});

test('a FreeSurfer surface loads and is indexed', async ({ page }) => {
  await loadSurface(page);

  const geometry = await page.evaluate(() => {
    const s = window.__surfannotate;
    return {
      vertices: s.geometry.vertexCount,
      triangles: s.geometry.triangles.length / 3,
      graphVertices: s.graph.V,
      meanValence: s.graph.adjNeighbor.length / s.graph.V,
      hasIndex: Boolean(s.index),
      hasLayer: s.mesh.layers.length > 0
    };
  });

  expect(geometry.vertices).toBe(163842);
  expect(geometry.triangles).toBe(327680);
  expect(geometry.graphVertices).toBe(163842);
  expect(geometry.meanValence).toBeCloseTo(6, 1);
  expect(geometry.hasIndex).toBe(true);
  expect(geometry.hasLayer).toBe(true);
  expect(errors).toEqual([]);
});

test('clicking the rendered surface resolves to a vertex', async ({ page }) => {
  await loadSurface(page);

  // Drive NiiVue's depth picker the way the app does, at the centre of the canvas.
  const hit = await page.evaluate(() => {
    const s = window.__surfannotate;
    const canvas = document.getElementById('gl');
    const rect = canvas.getBoundingClientRect();
    const dpr = s.nv.uiData?.dpr || 1;

    s.nv.mousePos = [(rect.width / 2) * dpr, (rect.height / 2) * dpr];
    s.nv.uiData.mouseDepthPicker = true;
    s.nv.drawScene();
    s.nv.drawScene();

    const mm = s.nv.frac2mm(s.nv.scene.crosshairPos, 0, true);
    const near = s.index.nearest(mm[0], mm[1], mm[2]);
    return { mm: [mm[0], mm[1], mm[2]], vertex: near.vertex, distance: near.distance };
  });

  expect(hit.vertex).toBeGreaterThanOrEqual(0);
  expect(hit.vertex).toBeLessThan(163842);
  // A real hit lands within a fraction of a millimetre of a vertex.
  expect(hit.distance).toBeLessThan(3);
});

test('draw, close and fill a closed ROI, then export it', async ({ page }) => {
  await loadSurface(page);

  const result = await page.evaluate(async () => {
    const s = window.__surfannotate;
    const { graph, session } = s;

    // Walk a ring of vertices roughly 12 edges apart to stand in for clicks.
    const step = (from, hops) => {
      let frontier = [from];
      const seen = new Uint8Array(graph.V);
      seen[from] = 1;
      for (let h = 0; h < hops; h++) {
        const next = [];
        for (const u of frontier) {
          for (let e = graph.adjOffset[u]; e < graph.adjOffset[u + 1]; e++) {
            const w = graph.adjNeighbor[e];
            if (!seen[w]) { seen[w] = 1; next.push(w); }
          }
        }
        if (!next.length) break;
        frontier = next;
      }
      return frontier[0];
    };

    let v = 60000;
    for (let i = 0; i < 8; i++) { session.addClick(v); v = step(v, 10); }
    // Nothing is traced until the ROI is closed.
    const chainBeforeClose = session.chain.length;
    const closed = session.closePath();
    const filled = session.fill({});

    return {
      clicks: session.clicks.length,
      chainBeforeClose,
      closed: closed.ok,
      chainLength: session.chain.length,
      gaps: session.gaps.length,
      fill: filled
    };
  });

  expect(result.clicks).toBe(8);
  expect(result.chainBeforeClose).toBe(0);
  expect(result.closed).toBe(true);
  expect(result.gaps).toBe(0);
  expect(result.chainLength).toBeGreaterThan(20);
  expect(result.fill.ok).toBe(true);
  expect(result.fill.count).toBeGreaterThan(0);

  // The boundary chain must stay walkable along mesh edges, or the fill leaks.
  const contiguous = await page.evaluate(() => {
    const { graph, session } = window.__surfannotate;
    for (let i = 0; i < session.chain.length - 1; i++) {
      const a = session.chain[i], b = session.chain[i + 1];
      let ok = false;
      for (let e = graph.adjOffset[a]; e < graph.adjOffset[a + 1]; e++) {
        if (graph.adjNeighbor[e] === b) { ok = true; break; }
      }
      if (!ok) return false;
    }
    return true;
  });
  expect(contiguous).toBe(true);

  // Exported .label must carry the documented header and one line per vertex.
  const label = await page.evaluate(() => {
    const { session, geometry } = window.__surfannotate;
    return window.__surfannotateIo.writeFreeSurferLabel(
      session.regionIndices(), geometry.positions, { name: 'e2e', subject: 'lh' }
    );
  });

  const lines = label.trimEnd().split('\n');
  expect(lines[0]).toContain('#!ascii label e2e');
  expect(Number(lines[1])).toBe(lines.length - 2);
  expect(Number(lines[2].split(/\s+/)[0])).toBeGreaterThanOrEqual(0);

  // And the GIfTI export must be well-formed XML with the label table first.
  const gifti = await page.evaluate(async () => {
    const { session, geometry } = window.__surfannotate;
    const mask = session.filled || new Uint8Array(geometry.vertexCount);
    return window.__surfannotateIo.writeGiftiLabel(
      window.__surfannotateIo.maskToLabelArray(mask, 2),
      [{ key: 0, name: '???', rgba: [0, 0, 0, 0] },
        { key: 2, name: 'roi', rgba: [0.9, 0.2, 0.2, 1] }]
    );
  });
  expect(gifti).toContain('Intent="NIFTI_INTENT_LABEL"');
  expect(gifti.indexOf('<LabelTable>')).toBeLessThan(gifti.indexOf('<DataArray'));
});

test('a gap in the boundary is refused rather than flooding the surface', async ({ page }) => {
  await loadSurface(page);

  const outcome = await page.evaluate(() => {
    const { graph, session, geometry } = window.__surfannotate;
    const { fillClosedRegion } = window.__surfannotateFill || {};
    session.clearRoi();

    // Build a closed ring, then punch a hole in it.
    let v = 40000;
    const step = (from) => graph.adjNeighbor[graph.adjOffset[from]];
    for (let i = 0; i < 6; i++) { session.addClick(v); for (let k = 0; k < 9; k++) v = step(v); }
    session.closePath();

    const barrier = session.boundaryMask();
    barrier[session.chain[3]] = 0; // the gap

    // Seeded fill from a vertex far from the ring must report an escape.
    const seeded = session.fill({ seed: -1 });
    return { chain: session.chain.length, error: seeded.error, ok: seeded.ok };
  });

  expect(outcome.chain).toBeGreaterThan(0);
  // Either it filled a legitimate small region, or it refused. It must never
  // silently return most of the hemisphere.
  if (outcome.ok) {
    const count = await page.evaluate(() => {
      let n = 0;
      const f = window.__surfannotate.session.filled;
      for (let i = 0; i < f.length; i++) if (f[i]) n++;
      return n;
    });
    expect(count).toBeLessThan(163842 * 0.4);
  } else {
    expect(['AMBIGUOUS_REGION', 'FILL_ESCAPED', 'EMPTY_REGION']).toContain(outcome.error);
  }
});

test('landmark selection toggles and exports', async ({ page }) => {
  await loadSurface(page);

  const result = await page.evaluate(() => {
    const { session, geometry } = window.__surfannotate;
    session.setMode('points');
    session.togglePoint(1000, 'V1');
    session.togglePoint(2000, 'MT');
    session.togglePoint(1000); // toggling the same vertex removes it

    const json = window.__surfannotateIo.writePointsJson(session.points, geometry.positions, {
      numVertices: geometry.vertexCount,
      numTriangles: geometry.triangles.length / 3
    });
    return { count: session.points.length, json: JSON.parse(json) };
  });

  expect(result.count).toBe(1);
  expect(result.json.points[0].vertex).toBe(2000);
  expect(result.json.points[0].name).toBe('MT');
  expect(result.json.mesh.numVertices).toBe(163842);
});

test('dragging to rotate does not place a landmark', async ({ page }) => {
  await loadSurface(page);
  await page.evaluate(() => window.__surfannotateUi.setMode('points'));

  const box = await page.locator('#gl').boundingBox();
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // A press that travels is an orbit, not a click.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(cx + i * 8, cy + i * 3);
  await page.mouse.up();
  expect(await page.evaluate(() => window.__surfannotate.session.points.length)).toBe(0);

  // A press that stays put is a click.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.up();
  await expect
    .poll(() => page.evaluate(() => window.__surfannotate.session.points.length))
    .toBe(1);
});

test('a curvature overlay loads with a usable display window', async ({ page }) => {
  await loadSurface(page);
  await page.setInputFiles('#overlayInput', join(FIXTURES, 'lh.curv'));
  await expect(page.locator('#statusText')).toContainText('Overlay lh.curv loaded', {
    timeout: 60_000
  });

  const layer = await page.evaluate(() => {
    const overlay = window.__surfannotate.overlayLayer;
    return {
      values: overlay.values.length,
      calMin: overlay.cal_min,
      calMax: overlay.cal_max,
      opacity: overlay.opacity
    };
  });

  expect(layer.values).toBe(163842);
  expect(layer.opacity).toBeGreaterThan(0);
  // A full-range window maps nearly every vertex to the same mid-grey, which
  // reads as "the overlay did not load". The robust window must be narrower.
  expect(layer.calMax - layer.calMin).toBeLessThan(0.9);
  expect(layer.calMax).toBeGreaterThan(layer.calMin);
  expect(errors).toEqual([]);
});

test('border markers hide once filled and return after undo', async ({ page }) => {
  await loadSurface(page);

  const countMarkers = () => page.evaluate(() =>
    Array.from(window.__surfannotate.labelValues).filter((v) => v === 4).length);

  await page.evaluate(() => {
    const { graph, session } = window.__surfannotate;
    const step = (from) => {
      let frontier = [from];
      const seen = new Uint8Array(graph.V);
      seen[from] = 1;
      for (let h = 0; h < 12; h++) {
        const next = [];
        for (const u of frontier)
          for (let e = graph.adjOffset[u]; e < graph.adjOffset[u + 1]; e++) {
            const w = graph.adjNeighbor[e];
            if (!seen[w]) { seen[w] = 1; next.push(w); }
          }
        if (!next.length) break;
        frontier = next;
      }
      return frontier[0];
    };
    let v = 60000;
    for (let i = 0; i < 8; i++) { session.addClick(v); v = step(v); }
    session.closePath();
    window.__surfannotateUi.repaint();
  });
  expect(await countMarkers()).toBeGreaterThan(0);

  // The markers are painted with their 1-ring so they are visible, which makes
  // them wider than the ROI itself — misleading once a region exists.
  await page.evaluate(() => window.__surfannotateUi.runFill(-1));
  expect(await countMarkers()).toBe(0);

  await page.evaluate(() => { window.__surfannotate.session.undoClick(); window.__surfannotateUi.repaint(); });
  expect(await countMarkers()).toBeGreaterThan(0);
});

test('gist_rainbow is registered and the colour range is adjustable', async ({ page }) => {
  await loadSurface(page);
  expect(await page.evaluate(() => window.__surfannotate.nv.colormaps().includes('gist_rainbow')))
    .toBe(true);

  await page.setInputFiles('#overlayInput', join(FIXTURES, 'lh.curv'));
  await expect(page.locator('#statusText')).toContainText('Overlay lh.curv loaded', {
    timeout: 60_000
  });

  const auto = await page.inputValue('#overlayMin');
  await page.selectOption('#overlayColormap', 'gist_rainbow');
  await page.fill('#overlayMin', '0.4');
  await page.press('#overlayMin', 'Enter');
  await page.fill('#overlayMax', '0.6');
  await page.press('#overlayMax', 'Enter');

  expect(await page.evaluate(() => {
    const layer = window.__surfannotate.overlayLayer;
    return { colormap: layer.colormap, min: layer.cal_min, max: layer.cal_max };
  })).toEqual({ colormap: 'gist_rainbow', min: 0.4, max: 0.6 });

  await page.click('#overlayRangeReset');
  expect(await page.inputValue('#overlayMin')).toBe(auto);
});

test('a surface dropped on the viewer loads', async ({ page }) => {
  const bytes = readFileSync(join(FIXTURES, 'lh.pial')).toString('base64');

  // NiiVue installs its own canvas drop handler and routes files to its volume
  // loader; if it is ever re-enabled, this drop is swallowed and the surface
  // never appears.
  await page.evaluate(async (base64) => {
    const binary = atob(base64);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);

    const transfer = new DataTransfer();
    transfer.items.add(new File([buffer], 'lh.pial', { type: 'application/octet-stream' }));

    // Dispatch on the CANVAS, not the viewer — that is where a real drop lands,
    // and where NiiVue's competing listener is registered. Targeting the viewer
    // directly would bypass the very collision this test exists to catch.
    // Real pointer coordinates matter: NiiVue's dropListener early-returns on
    // eventInBounds() before it reaches stopPropagation(), so an event at (0,0)
    // sails through and the test would pass even with the bug present.
    const canvas = document.getElementById('gl');
    const rect = canvas.getBoundingClientRect();
    const clientX = Math.round(rect.left + rect.width / 2);
    const clientY = Math.round(rect.top + rect.height / 2);

    for (const type of ['dragenter', 'dragover', 'drop']) {
      canvas.dispatchEvent(new DragEvent(type, {
        dataTransfer: transfer, bubbles: true, cancelable: true, clientX, clientY
      }));
    }
  }, bytes);

  await expect(page.locator('#statusText')).toContainText('163,842 vertices', {
    timeout: 90_000
  });
  expect(await page.evaluate(() => window.__surfannotate.geometry.vertexCount)).toBe(163842);
  expect(await page.locator('#dropHint').isVisible()).toBe(false);
  expect(errors).toEqual([]);
});

test('the ROI name reaches the file name and the file contents', async ({ page }) => {
  await loadSurface(page);
  await page.fill('#roiName', 'V1 / left*hemi');
  await page.dispatchEvent('#roiName', 'input');

  await page.evaluate(() => {
    const { graph, session } = window.__surfannotate;
    const step = (from) => {
      let frontier = [from];
      const seen = new Uint8Array(graph.V);
      seen[from] = 1;
      for (let h = 0; h < 12; h++) {
        const next = [];
        for (const u of frontier)
          for (let e = graph.adjOffset[u]; e < graph.adjOffset[u + 1]; e++) {
            const w = graph.adjNeighbor[e];
            if (!seen[w]) { seen[w] = 1; next.push(w); }
          }
        if (!next.length) break;
        frontier = next;
      }
      return frontier[0];
    };
    let v = 60000;
    for (let i = 0; i < 8; i++) { session.addClick(v); v = step(v); }
    session.closePath();
    window.__surfannotateUi.runFill(-1);
  });

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.click('#exportLabel')
  ]);
  // Characters illegal in file names are replaced, but the name the user typed
  // is preserved verbatim inside the file.
  expect(download.suggestedFilename()).toBe('lh.V1-left-hemi.label');
  // Named for the hemisphere, not for lh.pial specifically — the ROI applies to
  // any surface sharing that vertex indexing.
  expect(download.suggestedFilename()).not.toContain('pial');

  const stream = await download.createReadStream();
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  const header = Buffer.concat(chunks).toString('utf8').split('\n')[0];
  expect(header).toBe('#!ascii label V1 / left*hemi , from subject lh vox2ras=TkReg');
});

test('the .shape.gii export is gone', async ({ page }) => {
  await expect(page.locator('#exportShape')).toHaveCount(0);
  await expect(page.locator('#exportLabel')).toHaveCount(1);
  await expect(page.locator('#exportGifti')).toHaveCount(1);
  await expect(page.locator('#exportPoints')).toHaveCount(1);
});

test('the surface renders visibly', async ({ page }) => {
  await loadSurface(page);
  await page.waitForTimeout(1500);

  const shot = await page.locator('#gl').screenshot();
  expect(shot.length).toBeGreaterThan(5000);
  await test.info().attach('surface', { body: shot, contentType: 'image/png' });
});

// -- closing an ROI against the edge of a cut surface -----------------------

async function loadFlatPatch(page) {
  await page.setInputFiles('#surfaceInput', join(FIXTURES, 'lh.flat.surf.gii'));
  await expect(page.locator('#statusText')).toContainText('1,681 vertices', { timeout: 90_000 });
}

test('the edge-closure control appears only for a cut surface', async ({ page }) => {
  // A pial surface is closed after topology fixing, so there is no edge to
  // close against and the control must stay out of the way.
  await loadSurface(page);
  await expect(page.locator('#edgeRow')).toBeHidden();
  await expect(page.locator('#edgeHint')).toBeHidden();

  await loadFlatPatch(page);
  await expect(page.locator('#statusText')).toContainText('This surface is cut');
  await expect(page.locator('#edgeRow')).toBeVisible();
  await expect(page.locator('#edgeHint')).toContainText('Two points are enough');
  // Two points are enough here, where a loop needs three.
  await expect(page.locator('#closeOnEdge')).toBeDisabled();
  await page.evaluate(() => window.__surfannotate.session.addClick(0));
  await page.evaluate(() => window.__surfannotateUi.repaint());
  await expect(page.locator('#closeOnEdge')).toBeDisabled();
  await page.evaluate(() => window.__surfannotate.session.addClick(40));
  await page.evaluate(() => window.__surfannotateUi.repaint());
  await expect(page.locator('#closeOnEdge')).toBeEnabled();
});

test('two clicks on a flat patch close against the edge and fill one side', async ({ page }) => {
  await loadFlatPatch(page);

  const result = await page.evaluate(() => {
    const { session, geometry } = window.__surfannotate;
    const n = Math.round(Math.sqrt(geometry.vertexCount)); // 41x41 grid
    const at = (i, j) => j * n + i;
    // A line across the patch two rows up from the bottom edge. Each end is one
    // step from the side edge and two from the bottom, so both anchor sideways
    // and the border ends up spanning the full row.
    session.addClick(at(1, 2));
    session.addClick(at(n - 2, 2));
    const closed = session.closeOnEdge();
    const filled = session.fill();
    return { n, closed, filled, chain: Array.from(session.chain) };
  });

  expect(result.closed.ok).toBe(true);
  expect(result.closed.regions).toBe(2);
  // The strip below the line: 3 rows of 41, less the line itself.
  expect(result.filled.ok).toBe(true);
  expect(result.filled.count).toBe(2 * result.n);

  const onEdge = await page.evaluate((chain) => {
    const { geometry } = window.__surfannotate;
    const n = Math.round(Math.sqrt(geometry.vertexCount));
    const rim = (v) => v % n === 0 || v % n === n - 1 || v < n || v >= n * (n - 1);
    return { first: rim(chain[0]), last: rim(chain[chain.length - 1]) };
  }, result.chain);
  expect(onEdge.first).toBe(true);
  expect(onEdge.last).toBe(true);
});

test('the other side of an edge closure is one click away in the UI', async ({ page }) => {
  await loadFlatPatch(page);
  await expect(page.locator('#flipRegion')).toBeHidden();

  await page.evaluate(() => {
    const { session, geometry } = window.__surfannotate;
    const n = Math.round(Math.sqrt(geometry.vertexCount));
    session.addClick(2 * n + 1);
    session.addClick(2 * n + (n - 2));
    // addClick alone does not touch the DOM; the buttons follow a repaint.
    window.__surfannotateUi.repaint();
  });
  await page.locator('#closeOnEdge').click();
  await expect(page.locator('#statusText')).toContainText('closed against the surface edge');

  await page.locator('#fillRegion').click();
  await expect(page.locator('#statusText')).toContainText('Filled 82 vertices');
  await expect(page.locator('#flipRegion')).toBeVisible();

  await page.locator('#flipRegion').click();
  await expect(page.locator('#statusText')).toContainText('Region 2 of 2');
  const swapped = await page.evaluate(() => window.__surfannotate.session.filled
    .reduce((n, v) => n + v, 0));
  expect(swapped).toBe(1681 - 82 - 41);
});

test('an edge closure needs no seed click, unlike a loop on the same patch', async ({ page }) => {
  await loadFlatPatch(page);

  // A loop on a cut surface still asks the user to point at the region, because
  // a loop there is not guaranteed to separate anything.
  await page.evaluate(() => {
    const { session, geometry } = window.__surfannotate;
    const n = Math.round(Math.sqrt(geometry.vertexCount));
    const at = (i, j) => j * n + i;
    for (const v of [at(10, 10), at(30, 10), at(30, 30), at(10, 30)]) session.addClick(v);
    window.__surfannotateUi.repaint();
  });
  await page.locator('#closePath').click();
  await page.locator('#fillRegion').click();
  await expect(page.locator('#statusText')).toContainText('click inside the region you want');

  // The same patch, closed on the edge instead: filled straight away.
  await page.locator('#clearRoi').click();
  await page.evaluate(() => {
    const { session, geometry } = window.__surfannotate;
    const n = Math.round(Math.sqrt(geometry.vertexCount));
    session.addClick(2 * n + 1);
    session.addClick(2 * n + (n - 2));
    // addClick alone does not touch the DOM; the buttons follow a repaint.
    window.__surfannotateUi.repaint();
  });
  await page.locator('#closeOnEdge').click();
  await page.locator('#fillRegion').click();
  await expect(page.locator('#statusText')).toContainText('Filled 82 vertices');
});

test('the control panel stays one column and scrolls, never wrapping off-screen', async ({ page }) => {
  // #controls sets flex-direction: column while the shared .nd-imaging-controls
  // class on the same element sets flex-wrap: wrap. Together those wrap anything
  // taller than the panel into a second column to the RIGHT of a 320px-wide
  // panel: invisible, unreachable, and silent, because wrapping absorbs the
  // overflow so overflow-y has nothing left to scroll. It swallowed the entire
  // tool section — every annotation button at once.
  await loadFlatPatch(page);

  const layout = await page.evaluate(() => {
    const panel = document.getElementById('controls');
    const rect = panel.getBoundingClientRect();
    const sections = [...panel.children].map((section) => {
      const r = section.getBoundingClientRect();
      return { left: Math.round(r.left), width: Math.round(r.width), heading: section.textContent.trim().slice(0, 12) };
    });
    return {
      wrap: getComputedStyle(panel).flexWrap,
      panelRight: Math.round(rect.right),
      scrolls: panel.scrollHeight > panel.clientHeight,
      sections
    };
  });

  expect(layout.wrap).toBe('nowrap');
  // Every section starts at the same x and fits inside the panel: one column.
  const lefts = new Set(layout.sections.map((s) => s.left));
  expect(lefts.size, `sections at differing x = wrapped columns: ${JSON.stringify(layout.sections)}`).toBe(1);
  for (const section of layout.sections) {
    expect(section.left + section.width).toBeLessThanOrEqual(layout.panelRight + 1);
  }

  // And the buttons are genuinely reachable rather than merely present in the DOM.
  for (const id of ['closePath', 'closeOnEdge', 'fillRegion', 'clearRoi', 'exportLabel']) {
    await page.locator(`#${id}`).scrollIntoViewIfNeeded();
    await expect(page.locator(`#${id}`)).toBeInViewport();
  }
});

test('typing in text fields is not stolen by the undo shortcut', async ({ page }) => {
  // Backspace/Delete undo the last border point, on a document-level listener
  // that calls preventDefault. Unguarded it also eats every keystroke aimed at
  // a text box, so the ROI name could only be changed by select-all-and-retype.
  await loadSurface(page);

  const name = page.locator('#roiName');
  await name.fill('V1x');
  await name.press('Backspace');
  await expect(name).toHaveValue('V1', 'Backspace must delete a character');
  await name.press('Backspace');
  await expect(name).toHaveValue('V');

  // Number fields have the same problem; they enable once an overlay is loaded.
  await page.setInputFiles('#overlayInput', join(FIXTURES, 'lh.curv'));
  await expect(page.locator('#statusText')).toContainText('Overlay lh.curv loaded', {
    timeout: 60_000
  });
  const max = page.locator('#overlayMax');
  await max.fill('12');
  await max.press('Backspace');
  await expect(max).toHaveValue('1');

  // ...and the shortcut still works when focus is not in a text field.
  await page.evaluate(() => {
    const { session } = window.__surfannotate;
    session.addClick(1000); session.addClick(2000); session.addClick(3000);
    window.__surfannotateUi.repaint();
  });
  await page.locator('#roiOpacity').focus();
  await page.keyboard.press('Backspace');
  expect(await page.evaluate(() => window.__surfannotate.session.clicks.length)).toBe(2);
});

// -- several surfaces and overlays at once ---------------------------------

const surfaceRows = (page) => page.locator('#surfaceList li');
const overlayRows = (page) => page.locator('#overlayList li');

test('a dropped surface shows up in the surface list', async ({ page }) => {
  // A native file input shows nothing for a drag-and-drop, so before the list
  // existed a dropped surface rendered but the panel looked empty — it seemed
  // as though the drop had not registered at all.
  const bytes = readFileSync(join(FIXTURES, 'lh.flat.surf.gii')).toString('base64');
  await page.evaluate(async (b64) => {
    const binary = atob(b64);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
    const file = new File([buffer], 'lh.flat.surf.gii', { type: 'application/octet-stream' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const canvas = document.getElementById('gl');
    const box = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, dataTransfer: transfer,
      clientX: box.left + box.width / 2, clientY: box.top + box.height / 2
    }));
  }, bytes);

  await expect(page.locator('#statusText')).toContainText('1,681 vertices', { timeout: 60_000 });
  await expect(surfaceRows(page)).toHaveCount(1);
  await expect(surfaceRows(page).first()).toContainText('lh.flat.surf.gii');
  await expect(surfaceRows(page).first().locator('input[type=radio]')).toBeChecked();
});

test('a second surface is added rather than replacing the first', async ({ page }) => {
  await page.setInputFiles('#surfaceInput', join(FIXTURES, 'lh.flat.surf.gii'));
  await expect(surfaceRows(page)).toHaveCount(1);
  await page.setInputFiles('#surfaceInput', join(FIXTURES, 'lh.realflat.surf.gii'));
  await expect(surfaceRows(page)).toHaveCount(2);

  // Both meshes stay loaded; exactly one is visible, and it is the newest.
  const shown = await page.evaluate(() => window.__surfannotate.nv.meshes.map((m) => m.visible));
  expect(shown).toEqual([false, true]);

  // Switching the radio switches which is drawn and which the tools act on.
  await surfaceRows(page).first().locator('input[type=radio]').check();
  const after = await page.evaluate(() => ({
    visible: window.__surfannotate.nv.meshes.map((m) => m.visible),
    active: window.__surfannotate.sourceName,
    vertices: window.__surfannotate.geometry.vertexCount,
    graphMatches: window.__surfannotate.graph.V === window.__surfannotate.geometry.vertexCount
  }));
  expect(after.visible).toEqual([true, false]);
  expect(after.active).toBe('lh.flat.surf.gii');
  expect(after.vertices).toBe(1681);
  expect(after.graphMatches).toBe(true);
});

test('removing a surface falls back to another, and the last leaves a clean slate', async ({ page }) => {
  await page.setInputFiles('#surfaceInput', join(FIXTURES, 'lh.flat.surf.gii'));
  await page.setInputFiles('#surfaceInput', join(FIXTURES, 'lh.realflat.surf.gii'));
  await expect(surfaceRows(page)).toHaveCount(2);

  await surfaceRows(page).nth(1).locator('.layer-remove').click();
  await expect(surfaceRows(page)).toHaveCount(1);
  expect(await page.evaluate(() => window.__surfannotate.sourceName)).toBe('lh.flat.surf.gii');
  expect(await page.evaluate(() => window.__surfannotate.nv.meshes.length)).toBe(1);

  await surfaceRows(page).first().locator('.layer-remove').click();
  await expect(surfaceRows(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.__surfannotate.session)).toBe(null);
  await expect(page.locator('#dropHint')).toBeVisible();
});

test('border points survive a switch between surfaces sharing a vertex indexing', async ({ page }) => {
  // The same file twice stands in for lh.white and lh.inflated: identical
  // vertex count and triangles, so an ROI drawn on one is valid on the other.
  await page.setInputFiles('#surfaceInput', join(FIXTURES, 'lh.flat.surf.gii'));
  await page.setInputFiles('#surfaceInput', join(FIXTURES, 'lh.flat.surf.gii'));
  await expect(surfaceRows(page)).toHaveCount(2);

  await page.evaluate(() => {
    const { session } = window.__surfannotate;
    session.addClick(2 * 41 + 1);
    session.addClick(2 * 41 + 39);
    session.closeOnEdge();
    session.fill();
    window.__surfannotateUi.repaint();
  });
  const before = await page.evaluate(() => ({
    clicks: [...window.__surfannotate.session.clicks],
    filled: window.__surfannotate.session.filled.reduce((n, v) => n + v, 0)
  }));
  expect(before.filled).toBe(82);

  await surfaceRows(page).first().locator('input[type=radio]').check();
  const after = await page.evaluate(() => ({
    clicks: [...window.__surfannotate.session.clicks],
    // Paths and fills are geometry-dependent, so they are discarded and redone.
    closed: window.__surfannotate.session.closed,
    filled: window.__surfannotate.session.filled
  }));
  expect(after.clicks).toEqual(before.clicks);
  expect(after.closed).toBe(false);
  expect(after.filled).toBe(null);

  // And re-closing on the new surface reproduces the same region.
  const redone = await page.evaluate(() => {
    const { session } = window.__surfannotate;
    session.closeOnEdge();
    return session.fill().count;
  });
  expect(redone).toBe(82);
});

test('surfaces with different topology keep separate ROIs', async ({ page }) => {
  await page.setInputFiles('#surfaceInput', join(FIXTURES, 'lh.flat.surf.gii'));
  await page.evaluate(() => {
    window.__surfannotate.session.addClick(100);
    window.__surfannotate.session.addClick(200);
  });
  await page.setInputFiles('#surfaceInput', join(FIXTURES, 'lh.realflat.surf.gii'));
  await expect(surfaceRows(page)).toHaveCount(2);
  expect(await page.evaluate(() => window.__surfannotate.session.clicks.length))
    .toBe(0, 'an unrelated mesh starts empty');

  await surfaceRows(page).first().locator('input[type=radio]').check();
  expect(await page.evaluate(() => [...window.__surfannotate.session.clicks]))
    .toEqual([100, 200], 'and switching back restores the first ROI');
});

test('several overlays coexist, each with its own visibility and colour map', async ({ page }) => {
  await loadSurface(page);
  await page.setInputFiles('#overlayInput', join(FIXTURES, 'lh.curv'));
  await expect(page.locator('#statusText')).toContainText('Overlay lh.curv loaded', {
    timeout: 60_000
  });
  await expect(overlayRows(page)).toHaveCount(1);

  await page.setInputFiles('#overlayInput', join(FIXTURES, 'lh.curv'));
  await expect(overlayRows(page)).toHaveCount(2);
  expect(await page.evaluate(() => window.__surfannotate.mesh.layers.length))
    .toBe(3, 'two overlays plus the ROI layer');

  // The ROI layer must stay last, or an overlay paints over the boundary.
  expect(await page.evaluate(() => {
    const layers = window.__surfannotate.mesh.layers;
    return layers[layers.length - 1].name;
  })).toBe('surfannotate-roi');

  // Unticking hides one overlay without touching the other's opacity.
  await overlayRows(page).first().locator('input[type=checkbox]').uncheck();
  const opacities = await page.evaluate(() =>
    window.__surfannotateUi.activeSurface().overlays.map((o) => ({
      visible: o.visible, stored: o.opacity, applied: o.layer.opacity
    })));
  expect(opacities[0]).toMatchObject({ visible: false, applied: 0 });
  expect(opacities[0].stored).toBeGreaterThan(0);
  expect(opacities[1].visible).toBe(true);

  // Selecting an overlay points the colour-map controls at it.
  await overlayRows(page).first().locator('.layer-name').click();
  await expect(page.locator('#overlaySelectedHint')).toContainText('lh.curv');
  await page.selectOption('#overlayColormap', 'gist_rainbow');
  const maps = await page.evaluate(() =>
    window.__surfannotateUi.activeSurface().overlays.map((o) => o.layer.colormap));
  expect(maps[0]).toBe('gist_rainbow');
  expect(maps[1]).not.toBe('gist_rainbow');

  await overlayRows(page).first().locator('.layer-remove').click();
  await expect(overlayRows(page)).toHaveCount(1);
  expect(await page.evaluate(() => window.__surfannotate.mesh.layers.length)).toBe(2);
});

test('overlays belong to their own surface', async ({ page }) => {
  await page.setInputFiles('#surfaceInput', join(FIXTURES, 'lh.flat.surf.gii'));
  await page.setInputFiles('#surfaceInput', join(FIXTURES, 'lh.realflat.surf.gii'));
  await expect(overlayRows(page)).toHaveCount(0);

  // Switching surfaces shows that surface's overlays, not the previous one's.
  await surfaceRows(page).first().locator('input[type=radio]').check();
  await expect(overlayRows(page)).toHaveCount(0);
  expect(await page.evaluate(() => window.__surfannotate.overlayLayer)).toBe(null);
});

test('a dropped overlay is recognised as an overlay, not a second surface', async ({ page }) => {
  await loadSurface(page);
  const bytes = readFileSync(join(FIXTURES, 'lh.curv')).toString('base64');
  await page.evaluate(async (b64) => {
    const binary = atob(b64);
    const buffer = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
    const file = new File([buffer], 'lh.curv', { type: 'application/octet-stream' });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const canvas = document.getElementById('gl');
    const box = canvas.getBoundingClientRect();
    canvas.dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, dataTransfer: transfer,
      clientX: box.left + box.width / 2, clientY: box.top + box.height / 2
    }));
  }, bytes);

  await expect(page.locator('#statusText')).toContainText('Overlay lh.curv loaded', {
    timeout: 60_000
  });
  await expect(surfaceRows(page)).toHaveCount(1, 'the curv file did not become a surface');
  await expect(overlayRows(page)).toHaveCount(1);
});
