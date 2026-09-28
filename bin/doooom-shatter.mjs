#!/usr/bin/env node
/**
 * Doooom Shatter on the command line: vector in, vector out, no Illustrator.
 *
 * The fracture engine is plain JavaScript and the SVG writer only does string work, so the whole
 * effect runs anywhere Node does - a CI job, a container, a cloud worker. Illustrator is one front
 * end for it, not the thing itself.
 *
 *   doooom-shatter shatter logo.svg -o shattered.svg --preset doooom --seed 1995
 *   doooom-shatter raster shattered.svg -o shattered.png --width 3047 --trim
 *   doooom-shatter presets
 *
 * `raster` uses resvg, which ships prebuilt binaries and needs no system libraries and no headless
 * browser. It is an optional dependency: shattering works without it.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { shatterSvg } from '../mcp/src/svg.js';

const require = createRequire(import.meta.url);
const core = require('../core/fracture.js');

const NUMERIC = new Set(Object.keys(core.DEFAULTS).filter((k) => typeof core.DEFAULTS[k] === 'number'));

function parseArgs(argv) {
  const out = { _: [], set: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--set') { const [k, v] = String(argv[++i]).split('='); out.set[k] = v; }
    else if (a.startsWith('--')) {
      const [k, inline] = a.slice(2).split('=');
      const next = inline !== undefined ? inline : (argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[++i] : true);
      out[k] = next;
    } else if (a === '-o') out.o = argv[++i];
    else out._.push(a);
  }
  return out;
}

function settingsFrom(a) {
  const S = Object.assign({}, core.DEFAULTS);
  if (a.preset && !core.applyPreset(S, String(a.preset)))
    throw new Error(`unknown preset "${a.preset}" - try: ${Object.keys(core.PRESETS).join(', ')}`);
  for (const [k, v] of Object.entries(a.set)) {
    if (!(k in core.DEFAULTS)) throw new Error(`unknown setting "${k}"`);
    S[k] = NUMERIC.has(k) ? Number(v) : (v === 'true' ? true : v === 'false' ? false : v);
  }
  if (a.seed !== undefined) S.seed = Number(a.seed);
  return S;
}

async function cmdShatter(a) {
  const input = a._[1];
  if (!input) throw new Error('usage: doooom-shatter shatter <in.svg> [-o out.svg] [--preset name] [--seed n] [--set key=value]');
  const svg = await readFile(input, 'utf8');
  const r = shatterSvg(svg, settingsFrom(a), { background: a.background || null });
  const out = a.o || input.replace(/\.svg$/i, '') + '.shattered.svg';
  await writeFile(out, r.svg, 'utf8');
  console.error(`${out}: ${r.shards} shards, seed ${r.settings.seed}`);
}

async function cmdRaster(a) {
  const input = a._[1];
  if (!input) throw new Error('usage: doooom-shatter raster <in.svg> [-o out.png] [--width N] [--trim]');
  let Resvg;
  try { ({ Resvg } = await import('@resvg/resvg-js')); }
  catch { throw new Error('raster needs @resvg/resvg-js: npm install @resvg/resvg-js'); }
  const width = Number(a.width) || 2048;
  const png = new Resvg(await readFile(input, 'utf8'), {
    fitTo: { mode: 'width', value: width },
    background: a.background || 'rgba(0,0,0,0)',
  }).render();
  let buf = png.asPng();
  if (a.trim) {
    // Illustrator exports an artboard, which is usually much larger than the art. Trim to the ink
    // so the raster has the same extents the artwork does.
    const { width: w, height: h, pixels } = png;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (pixels[(y * w + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (x1 >= x0) {
      const sharp = await import('sharp').catch(() => null);
      if (!sharp) console.error('note: --trim needs sharp for the crop; wrote untrimmed');
      else buf = await sharp.default(buf).extract({ left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 }).png().toBuffer();
    }
  }
  const out = a.o || input.replace(/\.svg$/i, '') + '.png';
  await writeFile(out, buf);
  console.error(`${out}: ${png.width}x${png.height} rendered${a.trim ? ', trimmed' : ''}`);
}

const a = parseArgs(process.argv.slice(2));
const cmd = a._[0];
try {
  if (cmd === 'shatter') await cmdShatter(a);
  else if (cmd === 'raster') await cmdRaster(a);
  else if (cmd === 'presets') console.log(Object.keys(core.PRESETS).join('\n'));
  else { console.error('commands: shatter, raster, presets'); process.exit(2); }
} catch (e) { console.error('error:', e.message); process.exit(1); }
