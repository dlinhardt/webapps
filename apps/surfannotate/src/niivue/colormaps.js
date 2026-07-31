// Colour maps NiiVue 0.69 does not ship, registered at startup.
//
// NiiVue's ColorMap is a set of control points: I holds positions on 0..255 and
// R/G/B/A the channel values there; it interpolates between them.

/**
 * matplotlib's gist_rainbow. Control points transcribed from
 * `_gist_rainbow_data` in matplotlib/_cm.py, with positions scaled to 0..255.
 *
 * Unlike `jet` it starts and ends on magenta rather than dark blue/red, so the
 * two ends of the scale stay distinguishable — which is why it is a common
 * choice for cortical parcellation and retinotopy overlays.
 */
export const GIST_RAINBOW = {
  I: [0, 8, 55, 102, 149, 196, 243, 255],
  R: [255, 255, 255, 0, 0, 0, 255, 255],
  G: [0, 0, 255, 255, 255, 0, 0, 0],
  B: [41, 0, 0, 0, 255, 255, 255, 191],
  A: [255, 255, 255, 255, 255, 255, 255, 255]
};

export const EXTRA_COLORMAPS = Object.freeze({
  gist_rainbow: GIST_RAINBOW
});

/**
 * Register every extra colour map on a NiiVue instance. Safe to call more than
 * once — addColormap overwrites by key.
 * @param {import('@niivue/niivue').Niivue} nv
 * @returns {string[]} the keys registered
 */
export function registerExtraColormaps(nv) {
  const registered = [];
  for (const [key, cmap] of Object.entries(EXTRA_COLORMAPS)) {
    try {
      nv.addColormap(key, cmap);
      registered.push(key);
    } catch (error) {
      console.warn(`surfannotate: could not register colormap "${key}"`, error);
    }
  }
  return registered;
}
