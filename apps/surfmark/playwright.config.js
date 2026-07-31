import { defineConfig, devices } from '@playwright/test';

const PORT = 4322;
const HOST = '127.0.0.1';

// On a machine with http_proxy set, both Playwright's readiness probe and
// Chromium itself would try to reach the local preview server through the
// proxy, which answers 503. Exempt loopback before anything else runs.
const NO_PROXY = [process.env.NO_PROXY, process.env.no_proxy, HOST, 'localhost']
  .filter(Boolean).join(',');
process.env.NO_PROXY = NO_PROXY;
process.env.no_proxy = NO_PROXY;

// SwiftShader via ANGLE is what NiiVue's own e2e suite uses, and what makes
// WebGL2 available in headless Chromium on a machine with no GPU.
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? 'line' : 'list',
  use: {
    baseURL: `http://${HOST}:${PORT}/surfmark/`,
    viewport: { width: 1280, height: 800 }
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        headless: true,
        launchOptions: {
          args: [
            '--use-gl=angle',
            '--use-angle=swiftshader',
            '--enable-unsafe-swiftshader',
            '--window-size=1280,800',
            '--no-proxy-server'
          ]
        }
      }
    }
  ],
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort --host ${HOST}`,
    url: `http://${HOST}:${PORT}/surfmark/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000
  }
});
