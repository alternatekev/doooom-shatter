/*
    DOOOOM SHATTER  —  a 2026 recreation of MetaTools' KPT Vector Effects "ShatterBox" (1995)
    for Adobe Illustrator 2025 / 2026 (ExtendScript, ES3).

    >>> GENERATED FILE. Edit illustrator/DoooomShatter.template.jsx and core/fracture.js, then `npm run build`. <<<

    Install:  drop dist/DoooomShatter.jsx into  <Illustrator>/Presets/<lang>/Scripts/  and restart,
              or File > Scripts > Other Script...  (or drag the file onto a document tab).
    Use:      select artwork (paths, groups, text, gradients, meshes, images), run File > Scripts > DoooomShatter.
              Select a previous result to RE-SHATTER it non-destructively.
    Headless: define a global `DOOOOM_SETTINGS` object (or `DOOOOM_PRESET` name) before this script runs and the
              dialog is skipped — this is how the MCP server drives Illustrator. The script evaluates to a
              status string ("OK ..." / "ERR ...").

    MIT License.
*/

#target illustrator

var __doooomResult = (function () {

    // Headless hooks (set by the MCP bridge; undefined when run from File > Scripts)
    var HEADLESS_SETTINGS = (typeof DOOOOM_SETTINGS !== "undefined") ? DOOOOM_SETTINGS : null;
    var HEADLESS_PRESET = (typeof DOOOOM_PRESET !== "undefined") ? DOOOOM_PRESET : null;
    var headless = !!(HEADLESS_SETTINGS || HEADLESS_PRESET);
    function fail(msg) { if (!headless) alert("Doooom Shatter: " + msg); return "ERR " + msg; }

    // =====================================================================================
    // ==== core/fracture.js (inlined by scripts/build.js) ====
    /*
     * Doooom Shatter — core fracture + explode engine.
     * Pure geometry. Must stay ES3 (ExtendScript): no let/const, arrows, JSON, Array extras.
     * This file is inlined verbatim into dist/DoooomShatter.jsx by scripts/build.js and
     * required by the MCP server. Local space: bbox [0,W]x[0,H], y grows DOWN.
     */

    // Park–Miller minimal-standard PRNG (no Math.imul in ExtendScript).
    function Rng(seed) {
        this.s = (seed % 2147483646);
        if (this.s <= 0) this.s += 2147483646;
    }
    Rng.prototype.next = function () {          // (0,1)
        this.s = (this.s * 16807) % 2147483647;
        return (this.s - 1) / 2147483646;
    };
    Rng.prototype.range = function (a, b) { return a + (b - a) * this.next(); };
    Rng.prototype.sign = function () { return this.next() < 0.5 ? -1 : 1; };

    function polyArea(p) {
        var a = 0, n = p.length, i, j;
        for (i = 0, j = n - 1; i < n; j = i++) a += (p[j][0] * p[i][1]) - (p[i][0] * p[j][1]);
        return a / 2;
    }

    function polyCentroid(p) {
        var n = p.length, i, j, cx = 0, cy = 0, f, a = 0;
        for (i = 0, j = n - 1; i < n; j = i++) {
            f = p[j][0] * p[i][1] - p[i][0] * p[j][1];
            cx += (p[j][0] + p[i][0]) * f;
            cy += (p[j][1] + p[i][1]) * f;
            a += f;
        }
        if (Math.abs(a) < 1e-9) {               // degenerate: average the points
            cx = 0; cy = 0;
            for (i = 0; i < n; i++) { cx += p[i][0]; cy += p[i][1]; }
            return [cx / n, cy / n];
        }
        a *= 3;
        return [cx / a, cy / a];
    }

    // Sutherland–Hodgman clip of polygon p to axis-aligned rect [x0,y0,x1,y1]
    function clipToRect(p, x0, y0, x1, y1) {
        var edges = [
            function (q) { return q[0] >= x0; }, function (q) { return q[0] <= x1; },
            function (q) { return q[1] >= y0; }, function (q) { return q[1] <= y1; }
        ];
        var consts = [x0, x1, y0, y1], axes = [0, 0, 1, 1];
        var out = p, e, i, inp, cur, prev, cin, pin, t, n;
        for (e = 0; e < 4; e++) {
            inp = out; out = [];
            n = inp.length;
            if (n === 0) break;
            prev = inp[n - 1]; pin = edges[e](prev);
            for (i = 0; i < n; i++) {
                cur = inp[i]; cin = edges[e](cur);
                if (cin !== pin) {
                    if (axes[e] === 0) {
                        t = (consts[e] - prev[0]) / (cur[0] - prev[0]);
                        out.push([consts[e], prev[1] + t * (cur[1] - prev[1])]);
                    } else {
                        t = (consts[e] - prev[1]) / (cur[1] - prev[1]);
                        out.push([prev[0] + t * (cur[0] - prev[0]), consts[e]]);
                    }
                }
                if (cin) out.push(cur);
                prev = cur; pin = cin;
            }
        }
        return out;
    }

    // Split convex polygon by line through point o with direction d. Returns [polyA, polyB].
    function splitConvex(p, o, d) {
        var nx = -d[1], ny = d[0], n = p.length, i, a = [], b = [], s, sPrev, prev, cur, t, ip;
        var side = [];
        for (i = 0; i < n; i++) side.push((p[i][0] - o[0]) * nx + (p[i][1] - o[1]) * ny);
        for (i = 0; i < n; i++) {
            prev = p[(i + n - 1) % n]; cur = p[i];
            sPrev = side[(i + n - 1) % n]; s = side[i];
            if ((sPrev < 0 && s > 0) || (sPrev > 0 && s < 0)) {
                t = sPrev / (sPrev - s);
                ip = [prev[0] + t * (cur[0] - prev[0]), prev[1] + t * (cur[1] - prev[1])];
                a.push(ip); b.push(ip);
            }
            if (s >= 0) a.push(cur);
            if (s <= 0) b.push(cur);
        }
        return [a, b];
    }

    function insetPoly(p, c, k) {   // scale toward centroid by factor (1-k)
        var out = [], i;
        for (i = 0; i < p.length; i++) out.push([c[0] + (p[i][0] - c[0]) * (1 - k), c[1] + (p[i][1] - c[1]) * (1 - k)]);
        return out;
    }

    function sortNumeric(arr) { arr.sort(function (a, b) { return a - b; }); return arr; }

    // ---- Pattern A: radial impact fracture (glass pane) ----
    // Local space: bbox is [0,W]x[0,H], y grows downward. impact = [ix,iy].
    function radialFracture(W, H, impact, shards, jitter, frag, rng) {
        var rays = Math.max(3, Math.round(Math.sqrt(shards) * 1.5));
        var rings = Math.max(1, Math.round(shards / rays));
        var corners = [[0, 0], [W, 0], [W, H], [0, H]], Rmax = 0, i, k, d;
        for (i = 0; i < 4; i++) {
            d = Math.sqrt(Math.pow(corners[i][0] - impact[0], 2) + Math.pow(corners[i][1] - impact[1], 2));
            if (d > Rmax) Rmax = d;
        }
        Rmax *= 1.08;
        var angles = [], step = Math.PI * 2 / rays;
        for (i = 0; i < rays; i++) angles.push(i * step + rng.range(-0.5, 0.5) * step * jitter);
        sortNumeric(angles);

        var radii = [], r, base;
        for (i = 0; i < rays; i++) {
            radii.push([]);
            for (k = 0; k < rings; k++) {
                base = Rmax * Math.pow((k + 1) / rings, 1.45);
                r = (k === rings - 1) ? Rmax : base * (1 + rng.range(-0.5, 0.5) * jitter * 0.9);
                radii[i].push(Math.max(r, 1e-3));
            }
            sortNumeric(radii[i]);
        }
        function P(i, k) {
            var ii = i % rays;
            if (k < 0) return [impact[0], impact[1]];
            return [impact[0] + Math.cos(angles[ii]) * radii[ii][k], impact[1] + Math.sin(angles[ii]) * radii[ii][k]];
        }
        var polys = [], q, t1, t2;
        for (i = 0; i < rays; i++) {
            for (k = 0; k < rings; k++) {
                if (k === 0) q = [P(i, -1), P(i, 0), P(i + 1, 0)];
                else q = [P(i, k - 1), P(i, k), P(i + 1, k), P(i + 1, k - 1)];
                if (q.length === 4 && rng.next() < frag) {
                    if (rng.next() < 0.5) { t1 = [q[0], q[1], q[2]]; t2 = [q[0], q[2], q[3]]; }
                    else { t1 = [q[0], q[1], q[3]]; t2 = [q[1], q[2], q[3]]; }
                    polys.push(t1); polys.push(t2);
                } else polys.push(q);
            }
        }
        return polys;
    }

    // ---- Pattern B: classic random slices (the 1995 look) ----
    function sliceFracture(W, H, shards, jitter, rng) {
        var polys = [[[0, 0], [W, 0], [W, H], [0, H]]], guard = 0, i, best, bestA, a, p, c, o, ang, d, parts;
        while (polys.length < shards && guard++ < shards * 4) {
            // pick a polygon, biased to larger areas
            best = -1; bestA = -1;
            for (i = 0; i < polys.length; i++) {
                a = Math.abs(polyArea(polys[i])) * (0.55 + 0.9 * rng.next());
                if (a > bestA) { bestA = a; best = i; }
            }
            p = polys[best];
            c = polyCentroid(p);
            o = [c[0] + rng.range(-0.35, 0.35) * jitter * W / Math.sqrt(polys.length),
                 c[1] + rng.range(-0.35, 0.35) * jitter * H / Math.sqrt(polys.length)];
            ang = rng.next() * Math.PI;
            d = [Math.cos(ang), Math.sin(ang)];
            parts = splitConvex(p, o, d);
            if (parts[0].length >= 3 && parts[1].length >= 3 &&
                Math.abs(polyArea(parts[0])) > 1e-6 && Math.abs(polyArea(parts[1])) > 1e-6) {
                polys.splice(best, 1);
                polys.push(parts[0]); polys.push(parts[1]);
            }
        }
        return polys;
    }

    // Build the full shard list with physics applied. Returns array of shard descriptors:
    // { poly:[[x,y]...] (local, inset), c:[cx,cy], dx, dy, rot(deg), scale, opacity(0..1), light(-1..1) }
    function buildShards(W, H, S) {
        var rng = new Rng(S.seed);
        var impact = [W * (0.5 + S.impactX / 200), H * (0.5 + S.impactY / 200)];
        if (S.impactRandom) impact = [rng.range(0.1, 0.9) * W, rng.range(0.1, 0.9) * H];
        var raw = (S.pattern === 1)
            ? sliceFracture(W, H, S.shards, S.jitter / 100, rng)
            : radialFracture(W, H, impact, S.shards, S.jitter / 100, S.frag / 100, rng);

        var Rmax = 0, corners = [[0, 0], [W, 0], [W, H], [0, H]], i, d;
        for (i = 0; i < 4; i++) {
            d = Math.sqrt(Math.pow(corners[i][0] - impact[0], 2) + Math.pow(corners[i][1] - impact[1], 2));
            if (d > Rmax) Rmax = d;
        }
        var minArea = W * H * 0.00002;
        var out = [], p, c, area, r, dir, near, speed, t = S.time / 100, F = S.force / 100, z, sc, op, spin, gx, gy, mag;
        var diag = Math.sqrt(W * W + H * H);
        for (i = 0; i < raw.length; i++) {
            p = clipToRect(raw[i], 0, 0, W, H);
            if (p.length < 3) continue;
            area = Math.abs(polyArea(p));
            if (area < minArea) continue;
            c = polyCentroid(p);
            if (S.gap > 0) p = insetPoly(p, c, S.gap / 100);

            // --- explode physics ---
            r = Math.sqrt(Math.pow(c[0] - impact[0], 2) + Math.pow(c[1] - impact[1], 2));
            dir = r > 1e-6 ? [(c[0] - impact[0]) / r, (c[1] - impact[1]) / r] : [rng.range(-1, 1), rng.range(-1, 1)];
            near = 1 - Math.min(1, r / Rmax);                     // 1 at impact, 0 at far edge
            speed = F * diag * (0.15 + 0.85 * Math.pow(near, 0.7)) * (1 + rng.range(-0.5, 0.5) * S.random / 100);
            z = rng.range(-1, 1);                                 // pseudo depth velocity
            gx = 0; gy = (S.gravity / 100) * diag * 0.9 * t * t;  // +y is DOWN in local space
            mag = speed * t;
            sc = Math.max(0.05, 1 + z * (S.depth / 100) * t * (0.3 + near));
            op = 1 - (S.fade / 100) * t * Math.min(1, (r + mag) / (Rmax + diag * F));
            spin = (S.spin / 100) * 180 * t * rng.range(-1, 1) * (0.4 + near);
            out.push({
                poly: p, c: c,
                dx: dir[0] * mag + gx, dy: dir[1] * mag + gy,
                rot: spin, scale: sc, opacity: Math.max(0, Math.min(1, op)),
                light: Math.sin(Math.atan2(dir[1], dir[0]) + 0.8) * 0.6 + z * 0.4,
                near: near
            });
        }
        return { shards: out, impact: impact, W: W, H: H };
    }

    function transformPoly(sh) {   // for preview: apply scale + rot about centroid, then translate
        var out = [], i, a = sh.rot * Math.PI / 180, ca = Math.cos(a), sa = Math.sin(a), x, y;
        for (i = 0; i < sh.poly.length; i++) {
            x = (sh.poly[i][0] - sh.c[0]) * sh.scale; y = (sh.poly[i][1] - sh.c[1]) * sh.scale;
            out.push([sh.c[0] + x * ca - y * sa + sh.dx, sh.c[1] + x * sa + y * ca + sh.dy]);
        }
        return out;
    }

    function encodeSettings(S) {
        var k, parts = [];
        for (k in S) if (S.hasOwnProperty(k)) parts.push(k + ":" + (typeof S[k] === "string" ? '"' + S[k] + '"' : S[k]));
        return "DoooomShatter:{" + parts.join(",") + "}";
    }
    function decodeSettings(str) {
        var i;
        if (!str) return null;
        i = str.indexOf("DoooomShatter:") === 0 ? 14 : (str.indexOf("ShatterBox:") === 0 ? 11 : -1);   // accepts legacy notes
        if (i < 0) return null;
        try { return eval("(" + str.substring(i) + ")"); } catch (e) { return null; }
    }

    var DEFAULTS = {
        pattern: 0,        // 0 radial impact, 1 classic slices
        shards: 60, jitter: 55, frag: 35, gap: 1.5,
        impactX: 0, impactY: 0, impactRandom: false,
        force: 25, time: 40, spin: 30, gravity: 10, random: 40, depth: 25, fade: 20,
        tint: 35, edge: 60, edgeWidth: 0.5,
        cut: 0,            // 0 clip masks (any art), 1 pathfinder true cut (paths only)
        keepOriginal: true,
        seed: 1
    };

    // Named looks. Values override DEFAULTS; seed is left to the caller.
    var PRESETS = {
        "cracked-pane":  { pattern: 0, shards: 90,  jitter: 60, frag: 30, gap: 0.8, force: 0,  time: 0,  spin: 0,  gravity: 0,  depth: 0,  fade: 0,  tint: 30, edge: 70 },
        "glass-impact":  { pattern: 0, shards: 120, jitter: 55, frag: 45, gap: 1.5, force: 35, time: 45, spin: 35, gravity: 15, depth: 30, fade: 25, tint: 40, edge: 60 },
        "doooom":        { pattern: 0, shards: 220, jitter: 85, frag: 80, gap: 2.5, force: 80, time: 75, spin: 70, gravity: 35, random: 70, depth: 55, fade: 45, tint: 50, edge: 40 },
        "kpt-1995":      { pattern: 1, shards: 40,  jitter: 70, gap: 0,   force: 20, time: 50, spin: 15, gravity: 0,  depth: 0,  fade: 0,  tint: 0,  edge: 0 },
        "confetti":      { pattern: 1, shards: 160, jitter: 90, gap: 6,   force: 60, time: 60, spin: 90, gravity: 60, random: 80, depth: 40, fade: 10, tint: 20, edge: 0 },
        "frozen-cracks": { pattern: 0, shards: 60,  jitter: 40, frag: 20, gap: 0.4, force: 6,  time: 20, spin: 4,  gravity: 0,  depth: 0,  fade: 0,  tint: 25, edge: 90, edgeWidth: 0.75 }
    };

    function applyPreset(S, name) {
        var p = PRESETS[name], k;
        if (!p) return false;
        for (k in p) if (p.hasOwnProperty(k)) S[k] = p[k];
        return true;
    }

    // Node/CommonJS export (no-op inside ExtendScript, where `module` is undefined).
    if (typeof module !== "undefined" && module.exports) {
        module.exports = {
            Rng: Rng, polyArea: polyArea, polyCentroid: polyCentroid, clipToRect: clipToRect,
            splitConvex: splitConvex, insetPoly: insetPoly, radialFracture: radialFracture,
            sliceFracture: sliceFracture, buildShards: buildShards, transformPoly: transformPoly,
            encodeSettings: encodeSettings, applyPreset: applyPreset, decodeSettings: decodeSettings, DEFAULTS: DEFAULTS, PRESETS: PRESETS
        };
    }

    // =====================================================================================

    // ---------------------------------------------------------------- Illustrator plumbing
    if (app.documents.length === 0) return fail("open a document and select some artwork first.");
    var doc = app.activeDocument;
    var sel = doc.selection;
    if (!sel || sel.length === 0) return fail("select the artwork you want to shatter.");

    // Re-shatter detection: a single group carrying our note
    var existing = null, loaded = null;
    if (sel.length === 1 && sel[0].typename === "GroupItem" && sel[0].note) {
        loaded = decodeSettings(sel[0].note);
        if (loaded) existing = sel[0];
    }
    var S = {}, k;
    for (k in DEFAULTS) if (DEFAULTS.hasOwnProperty(k)) S[k] = DEFAULTS[k];
    S.seed = Math.floor(Math.random() * 2147483646) + 1;
    if (loaded) { for (k in loaded) if (loaded.hasOwnProperty(k) && S.hasOwnProperty(k)) S[k] = loaded[k]; }
    if (HEADLESS_PRESET) { if (!applyPreset(S, String(HEADLESS_PRESET))) return fail("unknown preset '" + HEADLESS_PRESET + "'"); }
    if (HEADLESS_SETTINGS) { for (k in HEADLESS_SETTINGS) if (HEADLESS_SETTINGS.hasOwnProperty(k) && S.hasOwnProperty(k)) S[k] = HEADLESS_SETTINGS[k]; }

    // Source bounds
    var srcForBounds = existing ? findChild(existing, "Doooom Source") : null;
    var pvBounds = existing ? boundsOfHidden(srcForBounds) : unionBounds(sel);
    var pvW = pvBounds[2] - pvBounds[0], pvH = pvBounds[1] - pvBounds[3];
    if (pvW < 0.01 || pvH < 0.01) return fail("the selection has no area.");

    // ---------------------------------------------------------------- Dialog
    if (!headless) {
        var dlg = new Window("dialog", existing ? "Doooom Shatter  —  Re-shatter" : "Doooom Shatter");
        dlg.orientation = "row"; dlg.alignChildren = ["fill", "top"]; dlg.spacing = 12; dlg.margins = 14;
        var left = dlg.add("group"); left.orientation = "column"; left.alignChildren = ["fill", "top"]; left.spacing = 8;
        var right = dlg.add("group"); right.orientation = "column"; right.alignChildren = ["fill", "top"]; right.spacing = 8;

        var ctl = {};
        function fmt(v, d) { return d ? (Math.round(v * 10) / 10).toString() : Math.round(v).toString(); }
        function sliderRow(parent, key, label, min, max, decimals) {
            var g = parent.add("group"); g.orientation = "row"; g.alignChildren = ["left", "center"]; g.spacing = 6;
            var st = g.add("statictext", undefined, label); st.preferredSize = [86, -1];
            var sl = g.add("slider", undefined, S[key], min, max); sl.preferredSize = [150, -1];
            var et = g.add("edittext", undefined, fmt(S[key], decimals)); et.characters = 5;
            sl.onChanging = function () { S[key] = decimals ? Math.round(sl.value * 10) / 10 : Math.round(sl.value); et.text = fmt(S[key], decimals); repaint(); };
            et.onChange = function () {
                var v = parseFloat(et.text); if (isNaN(v)) v = S[key];
                v = Math.max(min, Math.min(max, v)); S[key] = v; sl.value = v; et.text = fmt(v, decimals); repaint();
            };
            ctl[key] = { sl: sl, et: et, dec: decimals };
            return g;
        }
        function syncAll() {
            for (var key in ctl) if (ctl.hasOwnProperty(key)) { ctl[key].sl.value = S[key]; ctl[key].et.text = fmt(S[key], ctl[key].dec); }
            ddPat.selection = S.pattern; ddCut.selection = S.cut; cbKeep.value = S.keepOriginal; cbRandImp.value = S.impactRandom;
            fragRow.enabled = (S.pattern === 0); etSeed.text = String(S.seed);
        }

        // Presets
        var gPre = left.add("group"); gPre.alignChildren = ["left", "center"];
        gPre.add("statictext", undefined, "Preset").preferredSize = [86, -1];
        var presetNames = ["— custom —"], pn;
        for (pn in PRESETS) if (PRESETS.hasOwnProperty(pn)) presetNames.push(pn);
        var ddPre = gPre.add("dropdownlist", undefined, presetNames); ddPre.selection = 0; ddPre.preferredSize = [212, -1];
        ddPre.onChange = function () { if (ddPre.selection.index > 0) { applyPreset(S, ddPre.selection.text); syncAll(); repaint(); } };

        // Fracture panel
        var pF = left.add("panel", undefined, "Fracture"); pF.orientation = "column"; pF.alignChildren = ["fill", "top"]; pF.margins = [10, 14, 10, 10];
        var gPat = pF.add("group"); gPat.add("statictext", undefined, "Pattern").preferredSize = [86, -1];
        var ddPat = gPat.add("dropdownlist", undefined, ["Radial impact (glass pane)", "Classic slices (KPT 1995)"]);
        ddPat.selection = S.pattern; ddPat.preferredSize = [212, -1];
        ddPat.onChange = function () { S.pattern = ddPat.selection.index; fragRow.enabled = (S.pattern === 0); repaint(); };
        sliderRow(pF, "shards", "Shards", 3, 400);
        sliderRow(pF, "jitter", "Irregularity", 0, 100);
        var fragRow = sliderRow(pF, "frag", "Fragmentation", 0, 100); fragRow.enabled = (S.pattern === 0);
        sliderRow(pF, "gap", "Crack gap %", 0, 20, true);
        sliderRow(pF, "impactX", "Impact X", -100, 100);
        sliderRow(pF, "impactY", "Impact Y", -100, 100);
        var gSeed = pF.add("group"); gSeed.alignChildren = ["left", "center"];
        gSeed.add("statictext", undefined, "Seed").preferredSize = [86, -1];
        var etSeed = gSeed.add("edittext", undefined, String(S.seed)); etSeed.characters = 11;
        etSeed.onChange = function () { var v = parseInt(etSeed.text, 10); if (!isNaN(v) && v > 0) { S.seed = v; repaint(); } else etSeed.text = String(S.seed); };
        var btnDice = gSeed.add("button", undefined, "Randomize"); btnDice.onClick = function () { S.seed = Math.floor(Math.random() * 2147483646) + 1; etSeed.text = String(S.seed); repaint(); };
        var cbRandImp = gSeed.add("checkbox", undefined, "Random impact"); cbRandImp.value = S.impactRandom;
        cbRandImp.onClick = function () { S.impactRandom = cbRandImp.value; repaint(); };

        // Explode panel
        var pE = left.add("panel", undefined, "Explode"); pE.orientation = "column"; pE.alignChildren = ["fill", "top"]; pE.margins = [10, 14, 10, 10];
        sliderRow(pE, "force", "Force", 0, 100);
        sliderRow(pE, "time", "Time", 0, 100);
        sliderRow(pE, "spin", "Spin", 0, 100);
        sliderRow(pE, "gravity", "Gravity", 0, 100);
        sliderRow(pE, "random", "Randomness", 0, 100);
        sliderRow(pE, "depth", "Depth scale", 0, 100);
        sliderRow(pE, "fade", "Distance fade", 0, 100);

        // Glass panel
        var pG = right.add("panel", undefined, "Glass"); pG.orientation = "column"; pG.alignChildren = ["fill", "top"]; pG.margins = [10, 14, 10, 10];
        sliderRow(pG, "tint", "Facet tint", 0, 100);
        sliderRow(pG, "edge", "Edge highlight", 0, 100);
        sliderRow(pG, "edgeWidth", "Edge width pt", 0, 4, true);

        // Preview
        var pP = right.add("panel", undefined, "Preview"); pP.alignChildren = ["fill", "fill"]; pP.margins = [8, 14, 8, 8];
        var pv = pP.add("group"); pv.preferredSize = [340, 260];
        var info = right.add("statictext", undefined, "", { multiline: true }); info.preferredSize = [356, 34];

        // Output panel
        var pO = right.add("panel", undefined, "Output"); pO.orientation = "column"; pO.alignChildren = ["left", "top"]; pO.margins = [10, 14, 10, 10];
        var gCut = pO.add("group"); gCut.add("statictext", undefined, "Cut method").preferredSize = [86, -1];
        var ddCut = gCut.add("dropdownlist", undefined, ["Clipping masks (any art, safe)", "Pathfinder true cut (paths only, slow)"]);
        ddCut.selection = S.cut; ddCut.preferredSize = [240, -1]; ddCut.onChange = function () { S.cut = ddCut.selection.index; };
        var cbKeep = pO.add("checkbox", undefined, "Keep original inside group (hidden) for re-shatter"); cbKeep.value = S.keepOriginal;
        cbKeep.onClick = function () { S.keepOriginal = cbKeep.value; };

        var gBtn = right.add("group"); gBtn.alignment = "right";
        var btnReset = gBtn.add("button", undefined, "Defaults");
        gBtn.add("button", undefined, "Cancel", { name: "cancel" });
        gBtn.add("button", undefined, existing ? "Re-shatter" : "Shatter", { name: "ok" });
        btnReset.onClick = function () { var seed = S.seed; for (k in DEFAULTS) if (DEFAULTS.hasOwnProperty(k)) S[k] = DEFAULTS[k]; S.seed = seed; ddPre.selection = 0; syncAll(); repaint(); };

        pv.onDraw = function () {
            try {
                var g = this.graphics, w = this.size[0], h = this.size[1];
                g.newPath(); g.rectPath(0, 0, w, h); g.fillPath(g.newBrush(g.BrushType.SOLID_COLOR, [0.12, 0.12, 0.13, 1]));
                var b = buildShards(pvW, pvH, S);
                var pad = 1 + 0.9 * (S.force / 100) * (S.time / 100);
                var sc = Math.min(w / (pvW * pad * 1.15), h / (pvH * pad * 1.15));
                var ox = (w - pvW * sc) / 2, oy = (h - pvH * sc) / 2;
                g.newPath(); g.rectPath(ox, oy, pvW * sc, pvH * sc);
                g.strokePath(g.newPen(g.PenType.SOLID_COLOR, [0.35, 0.35, 0.38, 1], 1));
                var pen = g.newPen(g.PenType.SOLID_COLOR, [0.02, 0.02, 0.03, 1], 1);
                var i, j, sh, q, L, br;
                for (i = 0; i < b.shards.length; i++) {
                    sh = b.shards[i]; q = transformPoly(sh);
                    L = 0.5 + 0.28 * sh.light;
                    br = g.newBrush(g.BrushType.SOLID_COLOR, [0.35 * L + 0.15, 0.55 * L + 0.25, 0.75 * L + 0.25, sh.opacity]);
                    g.newPath(); g.moveTo(ox + q[0][0] * sc, oy + q[0][1] * sc);
                    for (j = 1; j < q.length; j++) g.lineTo(ox + q[j][0] * sc, oy + q[j][1] * sc);
                    g.closePath(); g.fillPath(br); g.strokePath(pen);
                }
                g.newPath(); g.ellipsePath(ox + b.impact[0] * sc - 3, oy + b.impact[1] * sc - 3, 6, 6);
                g.strokePath(g.newPen(g.PenType.SOLID_COLOR, [1, 0.6, 0.2, 1], 1.5));
                info.text = b.shards.length + " shards  •  seed " + S.seed + (b.shards.length > 250 ? "   (large count: expect a wait)" : "");
            } catch (e) { /* preview is best-effort */ }
        };
        function repaint() { try { pv.notify("onDraw"); } catch (e) { } }
        dlg.onShow = function () { repaint(); };
        if (dlg.show() !== 1) return "CANCELLED";
    }

    // ---------------------------------------------------------------- Do it
    var build = buildShards(pvW, pvH, S);
    if (build.shards.length === 0) return fail("nothing to shatter with these settings.");

    var isRGB = (doc.documentColorSpace === DocumentColorSpace.RGB);
    function white() { var c; if (isRGB) { c = new RGBColor(); c.red = 255; c.green = 255; c.blue = 255; } else { c = new CMYKColor(); c.cyan = 0; c.magenta = 0; c.yellow = 0; c.black = 0; } return c; }
    function black() { var c; if (isRGB) { c = new RGBColor(); c.red = 0; c.green = 0; c.blue = 0; } else { c = new CMYKColor(); c.cyan = 0; c.magenta = 0; c.yellow = 0; c.black = 100; } return c; }

    var outer, srcGroup, art, bounds;
    if (existing) {
        outer = existing;
        srcGroup = findChild(outer, "Doooom Source");
        var oldShards = findChild(outer, "Doooom Shards");
        if (!srcGroup || srcGroup.pageItems.length === 0) return fail("this group has no stored original to re-shatter.");
        art = srcGroup.pageItems[0];
        art.hidden = false; srcGroup.hidden = false;
        bounds = art.geometricBounds;
        if (oldShards) oldShards.remove();
    } else {
        var top = sel[0];
        var container = top.parent;
        outer = container.groupItems.add();
        outer.move(top, ElementPlacement.PLACEBEFORE);
        outer.name = "Doooom Shatter";
        srcGroup = outer.groupItems.add(); srcGroup.name = "Doooom Source";
        if (sel.length === 1) {
            art = sel[0]; art.move(srcGroup, ElementPlacement.PLACEATEND);
        } else {
            art = srcGroup.groupItems.add();
            for (var s = sel.length - 1; s >= 0; s--) sel[s].move(art, ElementPlacement.PLACEATBEGINNING);
        }
        bounds = art.geometricBounds;
    }
    var left0 = bounds[0], top0 = bounds[1];

    var shardsGroup = outer.groupItems.add(); shardsGroup.name = "Doooom Shards";
    shardsGroup.move(outer, ElementPlacement.PLACEATBEGINNING);

    // local (x right, y down) -> document (x right, y up)
    function toDoc(p) { var out = [], i; for (i = 0; i < p.length; i++) out.push([left0 + p[i][0], top0 - p[i][1]]); return out; }

    var usePathfinder = (S.cut === 1) && (art.typename === "PathItem" || art.typename === "CompoundPathItem");
    var i, sh, shardG, clipG, dup, clipPath, pts, tintPath, edgePath, failures = 0;

    for (i = 0; i < build.shards.length; i++) {
        sh = build.shards[i];
        pts = toDoc(sh.poly);
        shardG = shardsGroup.groupItems.add(); shardG.name = "Shard " + (i + 1);

        var cutOK = false;
        if (usePathfinder) {
            try {
                dup = art.duplicate(shardG, ElementPlacement.PLACEATEND);
                clipPath = shardG.pathItems.add(); clipPath.setEntirePath(pts); clipPath.closed = true;
                clipPath.filled = true; clipPath.fillColor = black(); clipPath.stroked = false;
                doc.selection = null; dup.selected = true; clipPath.selected = true;
                app.executeMenuCommand("Live Pathfinder Intersect");
                app.executeMenuCommand("expandStyle");
                cutOK = (shardG.pageItems.length > 0);
            } catch (e) { cutOK = false; }
            if (!cutOK) { failures++; while (shardG.pageItems.length) shardG.pageItems[0].remove(); }
        }
        if (!cutOK) {
            clipG = shardG.groupItems.add();
            dup = art.duplicate(clipG, ElementPlacement.PLACEATEND);
            dup.hidden = false;
            clipPath = clipG.pathItems.add(); clipPath.setEntirePath(pts); clipPath.closed = true;
            clipPath.filled = false; clipPath.stroked = false;
            clipPath.zOrder(ZOrderMethod.BRINGTOFRONT);
            clipPath.clipping = true;
            clipG.clipped = true;
        }

        if (S.tint > 0) {
            tintPath = shardG.pathItems.add(); tintPath.setEntirePath(pts); tintPath.closed = true; tintPath.stroked = false; tintPath.filled = true;
            if (sh.light >= 0) { tintPath.fillColor = white(); tintPath.blendingMode = BlendModes.SCREEN; }
            else { tintPath.fillColor = black(); tintPath.blendingMode = BlendModes.MULTIPLY; }
            tintPath.opacity = Math.min(100, Math.abs(sh.light) * S.tint * 0.9 + S.tint * 0.08);
            tintPath.zOrder(ZOrderMethod.BRINGTOFRONT);
        }
        if (S.edge > 0 && S.edgeWidth > 0) {
            edgePath = shardG.pathItems.add(); edgePath.setEntirePath(pts); edgePath.closed = true; edgePath.filled = false;
            edgePath.stroked = true; edgePath.strokeColor = white(); edgePath.strokeWidth = S.edgeWidth;
            edgePath.blendingMode = BlendModes.SCREEN; edgePath.opacity = S.edge;
            edgePath.strokeJoin = StrokeJoin.MITERENDJOIN; edgePath.zOrder(ZOrderMethod.BRINGTOFRONT);
        }

        // Physics (doc y is up: flip dy, negate rotation)
        if (Math.abs(sh.scale - 1) > 0.001) shardG.resize(sh.scale * 100, sh.scale * 100, true, true, true, true, sh.scale * 100, Transformation.CENTER);
        if (Math.abs(sh.rot) > 0.01) shardG.rotate(-sh.rot, true, true, true, true, Transformation.CENTER);
        if (Math.abs(sh.dx) > 0.001 || Math.abs(sh.dy) > 0.001) shardG.translate(sh.dx, -sh.dy, true, true, true, true);
        if (sh.opacity < 0.999) shardG.opacity = Math.round(sh.opacity * 100);
    }

    if (S.keepOriginal) {
        art.hidden = true; srcGroup.hidden = true;
        srcGroup.move(outer, ElementPlacement.PLACEATEND);
    } else {
        srcGroup.remove();
    }
    outer.note = encodeSettings(S);
    doc.selection = null; outer.selected = true;
    app.redraw();
    if (failures > 0 && !headless) alert("Doooom Shatter: Pathfinder cut failed on " + failures + " shard(s); those fell back to clipping masks.");
    return "OK " + build.shards.length + " shards, seed " + S.seed + (failures ? ", " + failures + " pathfinder fallbacks" : "");

    // ---------------------------------------------------------------- helpers
    function findChild(group, name) {
        for (var i = 0; i < group.groupItems.length; i++) if (group.groupItems[i].name === name) return group.groupItems[i];
        return null;
    }
    function unionBounds(items) {
        var b = items[0].geometricBounds.slice(0), i, gb;
        for (i = 1; i < items.length; i++) {
            gb = items[i].geometricBounds;
            if (gb[0] < b[0]) b[0] = gb[0]; if (gb[1] > b[1]) b[1] = gb[1];
            if (gb[2] > b[2]) b[2] = gb[2]; if (gb[3] < b[3]) b[3] = gb[3];
        }
        return b;
    }
    function boundsOfHidden(srcG) {
        if (!srcG || srcG.pageItems.length === 0) return [0, 100, 100, 0];
        var it = srcG.pageItems[0], wasHidden = it.hidden, gWas = srcG.hidden, b;
        srcG.hidden = false; it.hidden = false;
        b = it.geometricBounds;
        it.hidden = wasHidden; srcG.hidden = gWas;
        return b;
    }
})();
__doooomResult;
