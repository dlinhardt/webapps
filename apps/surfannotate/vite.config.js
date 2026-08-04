import { defineConfig } from 'vite';

// The composite site serves each app from its own path; standalone builds and
// `vite preview` use the same relative default the other Vite apps here use.
export default defineConfig({
  base: process.env.WEBAPPS_BASE_PATH || '/surfannotate/',
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 2048 // NiiVue is a single large chunk by design
  },
  worker: { format: 'es' },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless'
    }
  },
  // vite preview does not read public/_headers, and the e2e smoke test checks
  // the same origin isolation the dev server provides.
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless'
    }
  }
});
