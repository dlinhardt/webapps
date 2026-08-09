// Real browser smoke test. Proves the deployed contract that Node tests cannot:
// cross-origin isolation, worker loading, and app boot. Runs against `vite preview`
// (see playwright.config.js) so it exercises the built, header-served output.
import { test, expect } from "@playwright/test";

test("app boots", async ({ page }) => {
  await page.goto("/?source=custom");
  await expect(page.locator(".nd-imaging-workspace")).toBeVisible();
  await expect(page.locator("#nv-canvas")).toBeVisible();
  await expect(page.locator("#source")).toHaveValue("custom");
  await expect(page.getByRole("button", { name: "Apply" })).toBeDisabled();
  const topBar = page.locator(".nd-app-bar:visible");
  await expect(topBar).toHaveCount(1);
  await expect(topBar.locator(".nd-app-bar__identity")).toContainText("ZARRo");
  await expect(topBar.locator(".nd-app-bar__version")).toHaveText(/^v\d+\.\d+/);
  for (const name of ["About", "Cite", "Privacy", "More Apps", "GitHub"]) {
    await expect(topBar.getByRole(name === "More Apps" || name === "GitHub" ? "link" : "button", { name })).toBeVisible();
  }
  await expect(topBar.locator("[data-neurodesk-theme-toggle]")).toBeVisible();
  await expect(page.getByText("Export area", { exact: true })).toHaveCount(0);
  await expect(page.locator("#exportMode")).toHaveCount(0);
  await expect(page.getByText("Browser streamed", { exact: true })).toHaveCount(0);
  await expect(page.locator(".viewer-badge")).toHaveCount(0);
  await expect(page.getByText("Only visible chunks are fetched from the source.")).toHaveCount(0);
  await expect(page.getByText("Volume data stays in this browser tab.")).toHaveCount(0);
  await expect(page.getByText("Chunk spacing", { exact: true })).toHaveCount(0);
  await expect(page.locator("#status")).toBeHidden();
});

test("page is cross-origin isolated (COOP/COEP active)", async ({ page }) => {
  await page.goto("/?source=custom");
  // Threaded ONNX Runtime needs this; asserts _headers (or the COI service worker) worked.
  const isolated = await page.evaluate(() => self.crossOriginIsolated === true);
  expect(isolated).toBe(true);
});

test("a web worker loads and responds", async ({ page }) => {
  await page.goto("/?source=custom");
  const ok = await page.evaluate(async () => {
    // Inline classic worker — mirrors the apps' importScripts worker style.
    const src = "self.onmessage = () => self.postMessage('pong');";
    const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
    const w = new Worker(url);
    return await new Promise((resolve) => {
      w.onmessage = (e) => resolve(e.data === "pong");
      w.onerror = () => resolve(false);
      w.postMessage("ping");
    });
  });
  expect(ok).toBe(true);
});

test("translated OME-Zarr URLs load as one composite volume", async ({ page }) => {
  let leftChunkRequests = 0;
  let rightChunkRequests = 0;
  const group = JSON.stringify({ zarr_format: 2 });
  const array = JSON.stringify({
    zarr_format: 2,
    shape: [4, 4, 4],
    chunks: [4, 4, 4],
    dtype: "|u1",
    compressor: null,
    fill_value: 0,
    order: "C",
    filters: null,
  });
  await page.route("**/test-mosaic/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const isRight = path.includes("/right/");
    if (path.endsWith("/.zgroup")) {
      await route.fulfill({ contentType: "application/json", body: group });
    } else if (path.endsWith("/.zattrs")) {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          multiscales: [{
            axes: [
              { name: "z", unit: "millimeter" },
              { name: "y", unit: "millimeter" },
              { name: "x", unit: "millimeter" },
            ],
            datasets: [{
              path: "0",
              coordinateTransformations: [
                { type: "scale", scale: [1, 1, 1] },
                { type: "translation", translation: [0, 0, isRight ? 4 : 0] },
              ],
            }],
          }],
        }),
      });
    } else if (path.endsWith("/0/.zarray")) {
      await route.fulfill({ contentType: "application/json", body: array });
    } else if (path.endsWith("/0/.zattrs")) {
      await route.fulfill({ contentType: "application/json", body: "{}" });
    } else if (path.endsWith("/0/0.0.0")) {
      if (isRight) rightChunkRequests++;
      else leftChunkRequests++;
      await route.fulfill({
        contentType: "application/octet-stream",
        body: Buffer.alloc(64, isRight ? 180 : 60),
      });
    } else {
      await route.fulfill({ status: 404, body: "not found" });
    }
  });

  await page.goto("/?source=custom");
  await page.getByLabel("OME-Zarr store URL 1").fill("http://localhost:4173/test-mosaic/left");
  await page.getByRole("button", { name: "Add another URL" }).click();
  await page.getByLabel("OME-Zarr store URL 2").fill("http://localhost:4173/test-mosaic/right");
  await page.getByRole("button", { name: "Load volume" }).click();

  await expect(page.locator("#activeLevel")).toHaveText(/L0 · 2 translated stores/);
  await expect(page.locator("#fallback")).toHaveAttribute("aria-hidden", "true");
  await expect(page).toHaveURL(/url=.*test-mosaic%2Fleft.*url=.*test-mosaic%2Fright/);
  await expect(page.locator("#downloadNifti")).toBeEnabled();
  await expect.poll(() => leftChunkRequests).toBeGreaterThan(0);
  await expect.poll(() => rightChunkRequests).toBeGreaterThan(0);
});
