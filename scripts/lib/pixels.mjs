// Pixel measurements on decoded PNGs, shared by the world-pack browser verification. They read what is actually
// drawn, not what is resolved. A throwaway page of the same browser does the decoding.

export function createPixels(browser) {
  let calc = null;
  const page = async () => (calc ??= await browser.newPage());

  /** Share of pixels that differ (per-channel tolerance), over the whole image or a box. With `empty`, the ratio is the share of the resident's own pixels. */
  const measure = async (a, b, { box = null, tolerance = 24, empty = null } = {}) => {
    const p = await page();
    return p.evaluate(async ([x, y, tol, area, bg]) => {
      const load = (b64) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0); resolve(g.getImageData(0, 0, img.width, img.height)); };
        img.onerror = reject;
        img.src = `data:image/png;base64,${b64}`;
      });
      const A = await load(x), B = await load(y), E = bg ? await load(bg) : null;
      if (A.width !== B.width || A.height !== B.height) return { ratio: 1, sameSize: false, changed: 0, sprite: 0 };
      const [x0, y0, w, h] = area ?? [0, 0, A.width, A.height];
      const far = (P, Q, k) => Math.abs(P.data[k] - Q.data[k]) > tol || Math.abs(P.data[k + 1] - Q.data[k + 1]) > tol || Math.abs(P.data[k + 2] - Q.data[k + 2]) > tol;
      let n = 0, sprite = 0;
      for (let j = Math.max(0, y0); j < Math.min(A.height, y0 + h); j++) for (let i = Math.max(0, x0); i < Math.min(A.width, x0 + w); i++) {
        const k = (j * A.width + i) * 4;
        if (far(A, B, k)) n += 1;
        if (E && (far(A, E, k) || far(B, E, k))) sprite += 1;
      }
      return { ratio: E ? n / Math.max(1, sprite) : n / (w * h), changed: n, sprite, sameSize: true };
    }, [a.toString('base64'), b.toString('base64'), tolerance, box, empty ? empty.toString('base64') : null]);
  };

  /** Colour statistics of one PNG: mean colour, and the number of pixels near target colours or hues. */
  const stats = async (png, { near = [], hues = [], box = null } = {}) => {
    const p = await page();
    return p.evaluate(async ([b64, targets, area, hueTargets]) => {
      const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = `data:image/png;base64,${b64}`; });
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d'); g.drawImage(img, 0, 0);
      const [x0, y0, w, h] = area ?? [0, 0, img.width, img.height];
      const d = g.getImageData(Math.max(0, x0), Math.max(0, y0), Math.min(w, img.width - Math.max(0, x0)), Math.min(h, img.height - Math.max(0, y0))).data;
      let r = 0, gr = 0, b = 0;
      const hits = targets.map(() => 0), hueHits = hueTargets.map(() => 0);
      const hueOf = (R, G, B) => { const mx = Math.max(R, G, B), mn = Math.min(R, G, B), cc = mx - mn; if (cc === 0) return [0, 0]; const hh = mx === R ? ((G - B) / cc + 6) % 6 : mx === G ? (B - R) / cc + 2 : (R - G) / cc + 4; return [hh * 60, cc / mx]; };
      for (let i = 0; i < d.length; i += 4) {
        r += d[i]; gr += d[i + 1]; b += d[i + 2];
        targets.forEach(([tr, tg, tb, dist], k) => { if (Math.hypot(d[i] - tr, d[i + 1] - tg, d[i + 2] - tb) <= dist) hits[k] += 1; });
        if (hueTargets.length) {
          const [hh, ss] = hueOf(d[i], d[i + 1], d[i + 2]);
          hueTargets.forEach(([th, tol, minSat, minVal = 0], k) => { const dh = Math.min(Math.abs(hh - th), 360 - Math.abs(hh - th)); if (dh <= tol && ss >= minSat && Math.max(d[i], d[i + 1], d[i + 2]) >= minVal) hueHits[k] += 1; });
        }
      }
      const n = d.length / 4;
      return { mean: [r / n, gr / n, b / n].map((v) => +v.toFixed(1)), hits, hueHits };
    }, [png.toString('base64'), near, box, hues]);
  };

  /**
   * How much of an indicator survives a layer drawn near it. The mask is every pixel inside `boxes` that the
   * indicator itself changes strongly (`withIt` vs `without`, both with the layer off); `held` is the same scene
   * with the layer on. Returns the mask size and the share of mask pixels in `held` that no longer match
   * `withIt`: zero when the indicator is drawn on top of the layer, large when the layer paints over it.
   */
  const overlay = async (withIt, without, held, boxes, { strong = 110, tolerance = 24 } = {}) => {
    const p = await page();
    return p.evaluate(async ([a, b, c, areas, strongDiff, tol]) => {
      const load = (b64) => new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => { const cv = document.createElement('canvas'); cv.width = img.width; cv.height = img.height; const g = cv.getContext('2d'); g.drawImage(img, 0, 0); resolve(g.getImageData(0, 0, img.width, img.height)); };
        img.onerror = reject; img.src = `data:image/png;base64,${b64}`;
      });
      const [W, N, H] = [await load(a), await load(b), await load(c)];
      let mask = 0, covered = 0;
      for (const [x0, y0, w, h] of areas) {
        for (let j = Math.max(0, y0); j < Math.min(W.height, y0 + h); j++) for (let i = Math.max(0, x0); i < Math.min(W.width, x0 + w); i++) {
          const k = (j * W.width + i) * 4;
          const dWN = Math.max(Math.abs(W.data[k] - N.data[k]), Math.abs(W.data[k + 1] - N.data[k + 1]), Math.abs(W.data[k + 2] - N.data[k + 2]));
          if (dWN < strongDiff) continue;
          mask += 1;
          const dWH = Math.max(Math.abs(W.data[k] - H.data[k]), Math.abs(W.data[k + 1] - H.data[k + 1]), Math.abs(W.data[k + 2] - H.data[k + 2]));
          if (dWH > tol) covered += 1;
        }
      }
      return { mask, covered, share: covered / Math.max(1, mask) };
    }, [withIt.toString('base64'), without.toString('base64'), held.toString('base64'), boxes, strong, tolerance]);
  };

  return { measure, stats, overlay, close: async () => { if (calc) await calc.close(); } };
}
