/* Camions SDC — vue 3D du camion chargé (même style que le plan : bois, Stabilo, remorque grise) */
(function () {
  'use strict';
  var LARG = 1.5, H = 1.25, PLAT = 1.15, YD = 1.58;
  var VUES = { '3d': [-0.5, 0.28], cote: [0, 0.04], dessus: [0, 1.45], arriere: [-1.5708 + 0.45, 0.3] };

  function monter(boite, M, fixe) { // fixe : {w, h, echelle, vue} → image seule (pour la fiche)
    // M : { rems:[{ L, N, colis:[{x0,x1,y0,y1,e,lo,sec,id,s}], libres:[{x0,x1,e,s}], etages:{G:[m...],D:[...]}, deux }], T:{...}, fmt, sombre }
    var T = M.T, sombre = M.sombre;
    if (!M._pret) M.rems.forEach(function (r) { // placement réel : côté, étage → position dans l'espace
      r.colis.forEach(function (b) {
        b.z0 = PLAT + b.e * H; b.z1 = b.z0 + H - 0.03; // chaque colis repose sur ceux du dessous
        if (b.s === 'G') { b.y0 = 0.03; b.y1 = 0.03 + LARG; } else if (b.s === 'D') { b.y0 = YD; b.y1 = YD + LARG; } else { var mid = (0.03 + YD + LARG) / 2; b.y0 = mid - LARG / 2; b.y1 = mid + LARG / 2; b.mil = true; } // milieu : même sens que les autres, posé à cheval entre gauche et droite
        b.x0 += 0.04; b.x1 -= 0.04;
      });
    });
    M._pret = true;
    if (!fixe) boite.innerHTML = '<div class="v3-scene"><canvas></canvas><div class="v3-aide">' + T.tour + '</div></div>' +
      '<div class="v3-seg"><button type="button" data-v="3d" class="actif">3D</button><button type="button" data-v="cote">' + T.vc + '</button><button type="button" data-v="dessus">' + T.vd + '</button><button type="button" data-v="arriere">' + T.va + '</button></div>';
    var cv = fixe ? document.createElement('canvas') : boite.querySelector('canvas'), x = cv.getContext('2d'), dpr = fixe ? fixe.echelle : Math.min(2, window.devicePixelRatio || 1);
    var W = 0, Hc = 0, yaw = VUES['3d'][0], pitch = VUES['3d'][1], cible = null, k = 1, cx0 = 0, cy0 = 0;
    var ox = [], tot = 0;
    M.rems.forEach(function (r, i) { ox.push(tot); tot += r.L + (i < M.rems.length - 1 ? 1.0 : 0); });
    var Nmax = Math.max.apply(null, M.rems.map(function (r) { return r.N; }));
    var CTR = [tot / 2, YD - 0.02, PLAT + Nmax * H / 2];
    function taille() { if (fixe) { W = cv.width = fixe.w; Hc = cv.height = fixe.h; return; } var w = cv.clientWidth || 360; W = Math.round(w * dpr); Hc = Math.round(w * 0.86 * dpr); cv.width = W; cv.height = Hc; }
    function brut(p) {
      var X = p[0] - CTR[0], Y = p[1] - CTR[1], Z = p[2] - CTR[2];
      var c = Math.cos(yaw), s = Math.sin(yaw), xr = X * c - Y * s, yr = X * s + Y * c, cp = Math.cos(pitch), sp = Math.sin(pitch);
      return [xr, -(Z * cp + yr * sp), yr * cp - Z * sp];
    }
    function cadrer() { // le camion remplit toujours le cadre
      var a = [1e9, 1e9, -1e9, -1e9];
      [0, tot].forEach(function (xx) { [0, YD + LARG].forEach(function (yy) { [0, PLAT + Nmax * H + 0.3].forEach(function (zz) { var q = brut([xx, yy, zz]); a[0] = Math.min(a[0], q[0]); a[1] = Math.min(a[1], q[1]); a[2] = Math.max(a[2], q[0]); a[3] = Math.max(a[3], q[1]); }); }); });
      var mg = 14 * dpr, mgG = (pitch < 1 ? 96 : 14) * dpr, mgB = 34 * dpr;
      k = Math.min((W - mg - mgG) / (a[2] - a[0]), (Hc - mg - mgB - 24 * dpr) / (a[3] - a[1]));
      cx0 = mgG + ((W - mg - mgG) - (a[2] - a[0]) * k) / 2 - a[0] * k;
      cy0 = mg + 24 * dpr + ((Hc - mg - mgB - 24 * dpr) - (a[3] - a[1]) * k) / 2 - a[1] * k;
    }
    function proj(p) { var q = brut(p); return [cx0 + q[0] * k, cy0 + q[1] * k, q[2]]; }
    function nd(n) { return (n[0] * Math.sin(yaw) + n[1] * Math.cos(yaw)) * Math.cos(pitch) - n[2] * Math.sin(pitch); }
    function hash(t) { var h = 0; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return Math.abs(h); }
    function repere(o, pu, pv, lu, lv) { var a = proj(o), b = proj(pu), c = proj(pv); x.setTransform((b[0] - a[0]) / lu, (b[1] - a[1]) / lu, (c[0] - a[0]) / lv, (c[1] - a[1]) / lv, a[0], a[1]); }
    function rr(a, b, w, h, r) { r = Math.max(0, Math.min(r, w / 2, h / 2)); x.beginPath(); x.moveTo(a + r, b); x.arcTo(a + w, b, a + w, b + h, r); x.arcTo(a + w, b + h, a, b + h, r); x.arcTo(a, b + h, a, b, r); x.arcTo(a, b, a + w, b, r); x.closePath(); }
    function texBois(w, h, b, clair, lab) {
      x.save(); rr(0, 0, w, h, clair ? 10 : 14); x.clip();
      var g = x.createLinearGradient(0, 0, 0, h); g.addColorStop(0, clair ? '#F6E6C0' : '#F0DCAE'); g.addColorStop(1, clair ? '#E9CF9C' : '#DDBD85'); x.fillStyle = g; x.fillRect(0, 0, w, h);
      x.strokeStyle = 'rgba(160,122,69,.28)'; x.lineWidth = 1.2; var sd = hash(b.id) % 97;
      for (var i = 0; i < 4; i++) { var ly = h * (0.16 + i * 0.22) + (sd % 7); x.beginPath(); x.moveTo(0, ly); x.bezierCurveTo(w * 0.3, ly - 4, w * 0.6, ly + 5, w, ly - 1); x.stroke(); }
      x.beginPath(); x.ellipse(w * (0.3 + (sd % 40) / 100), h * 0.5, 14, 4.5, 0, 0, 6.3); x.stroke();
      x.fillStyle = 'rgba(160,110,50,.25)'; x.fillRect(w - 9, 0, 9, h);
      if (lab && b.mil) { x.font = '800 20px Barlow, sans-serif'; var tMil = T.mil || 'MILIEU', bw = x.measureText(tMil).width + 18; x.fillStyle = '#3B5A34'; rr(14, 12, bw, 30, 8); x.fill(); x.fillStyle = '#E6F0DA'; x.fillText(tMil, 23, 34); }
      if (lab) {
        x.strokeStyle = 'rgba(110,80,40,.45)'; x.lineWidth = 1.6; if (w > 120) { x.beginPath(); x.moveTo(w - 58, h - 14); x.lineTo(w - 22, h - 14); x.stroke(); }
        x.fillStyle = '#3D2B12'; x.font = '700 34px Barlow, system-ui, sans-serif'; x.fillText(lab[0], 14, h / 2 + 2);
        x.fillStyle = '#6E5434'; x.font = '500 22px Barlow, system-ui, sans-serif'; x.fillText(lab[1], 14, h / 2 + 30);
      }
      x.restore();
      x.strokeStyle = b.mil ? 'rgba(59,90,52,.7)' : 'rgba(120,85,40,.3)'; x.lineWidth = b.mil ? 3 : 1; rr(0, 0, w, h, clair ? 10 : 14); x.stroke();
    }
    function texBout(w, h) {
      var g = x.createLinearGradient(0, 0, w, h); g.addColorStop(0, '#D9B77D'); g.addColorStop(1, '#C19A5F'); x.fillStyle = g; rr(0, 0, w, h, 6); x.fill();
      var nc = Math.max(3, Math.round(w / 25)), nl = 7; x.strokeStyle = 'rgba(110,75,35,.45)'; x.lineWidth = 1.3;
      for (var i = 1; i < nc; i++) { x.beginPath(); x.moveTo(w * i / nc, 2); x.lineTo(w * i / nc, h - 2); x.stroke(); }
      for (var j = 1; j < nl; j++) { x.beginPath(); x.moveTo(2, h * j / nl); x.lineTo(w - 2, h * j / nl); x.stroke(); }
      x.strokeStyle = 'rgba(150,105,55,.35)'; for (i = 0; i < nc; i++) for (j = 0; j < nl; j++) { x.beginPath(); x.arc(w * (i + 0.5) / nc, h * (j + 1.1) / nl, w / nc * 0.35, 3.5, 5.9); x.stroke(); }
    }
    function colis(b) {
      var lu = (b.x1 - b.x0) * 100, lh = (b.z1 - b.z0) * 100, ly = (b.y1 - b.y0) * 100, lab = [b.lot, b.sec];
      var F = [
        [[0, -1, 0], function () { repere([b.x0, b.y0, b.z1], [b.x1, b.y0, b.z1], [b.x0, b.y0, b.z0], lu, lh); texBois(lu, lh, b, false, lab); }],
        [[0, 1, 0], function () { repere([b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1], [b.x1, b.y1, b.z0], lu, lh); texBois(lu, lh, b, false, lab); }],
        [[0, 0, 1], function () { repere([b.x0, b.y1, b.z1], [b.x1, b.y1, b.z1], [b.x0, b.y0, b.z1], lu, ly); texBois(lu, ly, b, true, null); if (!b.mil) { x.fillStyle = b.s === 'G' ? 'rgba(56,170,255,.85)' : 'rgba(255,92,170,.85)'; x.fillRect(0, b.s === 'G' ? ly - 7 : 0, lu, 7); x.fillStyle = 'rgba(70,45,15,.55)'; x.fillRect(0, b.s === 'G' ? 0 : ly - 5, lu, 5); } }],
        [[1, 0, 0], function () { repere([b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1], [b.x1, b.y0, b.z0], ly, lh); texBout(ly, lh); }],
        [[-1, 0, 0], function () { repere([b.x0, b.y1, b.z1], [b.x0, b.y0, b.z1], [b.x0, b.y1, b.z0], ly, lh); texBout(ly, lh); }]];
      F.forEach(function (f) { if (nd(f[0]) < -1e-6) { x.save(); f[1](); x.restore(); } });
      x.setTransform(1, 0, 0, 1, 0, 0);
    }
    var GRIS = sombre ? '#8A958F' : '#5C6661', GRIS2 = sombre ? '#6F7A74' : '#4A524E';
    function plaque(b) {
      [[0, -1, 0, [b.x0, b.y0, b.z1], [b.x1, b.y0, b.z1], [b.x0, b.y0, b.z0], b.x1 - b.x0, b.z1 - b.z0], [0, 1, 0, [b.x1, b.y1, b.z1], [b.x0, b.y1, b.z1], [b.x1, b.y1, b.z0], b.x1 - b.x0, b.z1 - b.z0], [0, 0, 1, [b.x0, b.y1, b.z1], [b.x1, b.y1, b.z1], [b.x0, b.y0, b.z1], b.x1 - b.x0, b.y1 - b.y0], [1, 0, 0, [b.x1, b.y0, b.z1], [b.x1, b.y1, b.z1], [b.x1, b.y0, b.z0], b.y1 - b.y0, b.z1 - b.z0], [-1, 0, 0, [b.x0, b.y1, b.z1], [b.x0, b.y0, b.z1], [b.x0, b.y1, b.z0], b.y1 - b.y0, b.z1 - b.z0]].forEach(function (f) {
        if (nd([f[0], f[1], f[2]]) >= -1e-6) return; x.save(); repere(f[3], f[4], f[5], f[6] * 100, f[7] * 100); x.fillStyle = f[2] ? GRIS : GRIS2; x.fillRect(0, 0, f[6] * 100, f[7] * 100); x.restore();
      });
      x.setTransform(1, 0, 0, 1, 0, 0);
    }
    function roue(xc, y) { // comme sur le plan : disque foncé, jante claire, moyeu
      if (nd(y < 1 ? [0, -1, 0] : [0, 1, 0]) >= 0) return;
      var r = 0.4, zc = 0.66; x.save(); repere([xc - r, y, zc + r], [xc + r, y, zc + r], [xc - r, y, zc - r], 100, 100);
      x.fillStyle = '#3D4541'; x.beginPath(); x.arc(50, 50, 50, 0, 6.3); x.fill(); x.fillStyle = '#C3CBC6'; x.beginPath(); x.arc(50, 50, 28, 0, 6.3); x.fill(); x.fillStyle = '#3D4541'; x.beginPath(); x.arc(50, 50, 11, 0, 6.3); x.fill();
      x.restore(); x.setTransform(1, 0, 0, 1, 0, 0);
    }
    function stabilo(t, p, coul, px) {
      px = (px || 28) * dpr; x.font = '700 ' + px + 'px "Barlow Condensed", Barlow, sans-serif'; var w = x.measureText(t).width;
      x.save(); x.translate(p[0] - w / 2 - 6, p[1] - px * 0.56); x.transform(1, -0.02, -0.1, 1, 0, 0);
      var g = x.createLinearGradient(0, 0, w + 16, 0); g.addColorStop(0, coul.replace('A', '.55')); g.addColorStop(.12, coul.replace('A', '.9')); g.addColorStop(.88, coul.replace('A', '.85')); g.addColorStop(1, coul.replace('A', '.45'));
      x.fillStyle = g; rr(0, 0, w + 16, px * 0.66, 5); x.fill(); x.restore(); x.fillStyle = '#16221A'; x.textAlign = 'left'; x.fillText(t, p[0] - w / 2 + 2, p[1]);
    }
    function dessiner() {
      x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, W, Hc); cadrer();
      x.save(); repere([-0.6, YD + LARG + 0.6, 0], [tot + 0.6, YD + LARG + 0.6, 0], [-0.6, -0.6, 0], 100, 100);
      var g = x.createRadialGradient(50, 50, 5, 50, 50, 62); g.addColorStop(0, sombre ? 'rgba(0,0,0,.45)' : 'rgba(20,40,30,.3)'); g.addColorStop(1, 'rgba(20,40,30,0)'); x.fillStyle = g; x.fillRect(-10, -10, 120, 120); x.restore(); x.setTransform(1, 0, 0, 1, 0, 0);
      var dos = nd([0, 1, 0]) < 0, yL = YD + LARG, ordreRems = M.rems.map(function (r, i) { return i; });
      if (nd([1, 0, 0]) > 0) ordreRems.reverse(); // la remorque la plus loin d'abord
      ordreRems.forEach(function (i) {
        var r = M.rems[i], o = ox[i], rl = r.deux ? [o + r.L * 0.84, o + r.L * 0.84 - 0.9, o + r.L * 0.12, o + r.L * 0.12 + 0.9] : [o + r.L * 0.84 - 1.8, o + r.L * 0.84 - 0.9, o + r.L * 0.84];
        rl.forEach(function (rx) { roue(rx, dos ? 0 : yL); });
        plaque({ x0: o, x1: o + r.L, y0: 0, y1: yL, z0: 1.0, z1: 1.13 });
        if (!r.deux) plaque({ x0: o + r.L * 0.14, x1: o + r.L * 0.14 + 0.5, y0: 0.3, y1: yL - 0.3, z0: 0.84, z1: 1.0 });
        rl.forEach(function (rx) { roue(rx, dos ? yL : 0); });
        // étagères translucides (comme les lignes du plan)
        if (nd([0, 0, 1]) < 0) ['G', 'D'].forEach(function (s) { for (var e = 0; e < r.N; e++) { var y0 = s === 'G' ? 0.03 : YD, z = PLAT + e * H - 0.03; x.save(); repere([o + 0.02, y0 + LARG, z], [o + r.L - 0.02, y0 + LARG, z], [o + 0.02, y0, z], 1000, LARG * 100); x.fillStyle = sombre ? 'rgba(255,255,255,.07)' : 'rgba(255,255,255,.55)'; rr(0, 0, 1000, LARG * 100, 14); x.fill(); x.restore(); x.setTransform(1, 0, 0, 1, 0, 0); } });
        var obj = r.colis.map(function (b) { return { b: b, d: proj([(b.x0 + b.x1) / 2 + o, (b.y0 + b.y1) / 2, (b.z0 + b.z1) / 2])[2] }; });
        obj.push({ paroi: 1, d: proj([o - 0.06, YD, PLAT + r.N * H / 2])[2] });
        var murDevant = nd([-1, 0, 0]) < 0; // on voit la paroi de face : elle passe devant
        obj.forEach(function (q) { q.e = q.paroi ? (murDevant ? 99 : -1) : q.b.e; });
        obj.sort(function (a, b) { return a.e - b.e || b.d - a.d; }); // étage par étage (du bas vers le haut), puis du fond vers l'avant
        obj.forEach(function (q) {
          if (q.paroi) plaque({ x0: o - 0.15, x1: o, y0: 0, y1: yL, z0: 1.13, z1: PLAT + r.N * H + 0.25 });
          else { var b = q.b; if (b.mil && nd([0, 0, 1]) < 0) { x.save(); repere([o + b.x0 - 0.1, b.y1 + 0.1, b.z0 + 0.001], [o + b.x1 + 0.1, b.y1 + 0.1, b.z0 + 0.001], [o + b.x0 - 0.1, b.y0 - 0.1, b.z0 + 0.001], 100, 100); var gs = x.createRadialGradient(50, 50, 10, 50, 50, 70); gs.addColorStop(0, 'rgba(60,40,15,.35)'); gs.addColorStop(1, 'rgba(60,40,15,0)'); x.fillStyle = gs; x.fillRect(0, 0, 100, 100); x.restore(); x.setTransform(1, 0, 0, 1, 0, 0); } var bb = { x0: b.x0 + o, x1: b.x1 + o, y0: b.y0, y1: b.y1, z0: b.z0, z1: b.z1, id: b.id, lot: b.lot, sec: b.sec, s: b.s, mil: b.mil }; colis(bb); }
        });
        // place libre en pointillés
        r.libres.forEach(function (l) {
          var si = l.s === 'D', y = si ? YD + LARG : 0.03, z0 = PLAT + l.e * H + 0.06, z1 = PLAT + (l.e + 1) * H - 0.18, lw = (l.x1 - l.x0 - 0.12) * 100;
          if (nd(si ? [0, 1, 0] : [0, -1, 0]) >= 0 || lw < 20) return;
          x.save(); if (si) repere([o + l.x1 - 0.06, y, z1], [o + l.x0 + 0.06, y, z1], [o + l.x1 - 0.06, y, z0], lw, (z1 - z0) * 100); else repere([o + l.x0 + 0.06, y, z1], [o + l.x1 - 0.06, y, z1], [o + l.x0 + 0.06, y, z0], lw, (z1 - z0) * 100);
          x.setLineDash([12, 9]); x.strokeStyle = sombre ? 'rgba(200,215,205,.6)' : 'rgba(94,110,100,.75)'; x.lineWidth = 3; x.fillStyle = 'rgba(59,90,52,.06)'; rr(0, 0, lw, (z1 - z0) * 100, 12); x.fill(); x.stroke(); x.restore(); x.setTransform(1, 0, 0, 1, 0, 0);
          if (pitch < 1) { var pc = proj([o + (l.x0 + l.x1) / 2, y, (z0 + z1) / 2]); x.fillStyle = sombre ? '#9CCB8A' : '#2F6B3A'; x.font = '700 ' + (15 * dpr) + 'px Barlow, sans-serif'; x.textAlign = 'center'; x.fillText(M.fmt(l.x1 - l.x0) + ' m ' + T.lib, pc[0], pc[1] + 5 * dpr); x.textAlign = 'left'; }
        });
        // étages à l'avant : É1 · 13 m
        if (pitch < 1 && i === 0) {
          var s = nd([0, -1, 0]) < 0 ? 'G' : 'D';
          r.etages[s].forEach(function (m, e) {
            var p = proj([o - 0.35, s === 'G' ? -0.6 : yL + 0.6, PLAT + e * H + H * 0.45]); p[0] -= 10 * dpr; if (p[0] < 30 * dpr) return;
            x.textAlign = 'right'; x.font = '600 ' + (14 * dpr) + 'px Barlow, sans-serif'; var tm = M.fmt(m) + ' m', wm = x.measureText(tm).width;
            x.fillStyle = sombre ? '#EEF3EC' : '#16221A'; x.fillText(tm, p[0], p[1] + 5 * dpr);
            x.fillStyle = sombre ? '#A3B2A8' : '#5E6E64'; x.font = '500 ' + (12 * dpr) + 'px Barlow, sans-serif'; x.fillText(T.et + (e + 1) + ' ', p[0] - wm, p[1] + 5 * dpr); x.textAlign = 'left';
          });
        }
      });
      var zt = PLAT + Nmax * H + 0.35, pg = proj([tot * 0.5, -0.05, zt]), pd = proj([tot * 0.5, yL + 0.05, zt]);
      if (nd([1, 0, 0]) < 0.95) stabilo(T.arr, proj([tot - 1.2, YD, 0.2]), 'rgba(150,160,155,A)', 16);
    }
    if (fixe) { taille(); yaw = VUES[fixe.vue][0]; pitch = VUES[fixe.vue][1]; dessiner(); return cv; }
    var vivant = true, sale = true;
    function boucle() {
      if (!cv.isConnected) { vivant = false; return; }
      if (cible) { yaw += (cible[0] - yaw) * 0.16; pitch += (cible[1] - pitch) * 0.16; sale = true; if (Math.abs(cible[0] - yaw) + Math.abs(cible[1] - pitch) < 0.002) { yaw = cible[0]; pitch = cible[1]; cible = null; } }
      if (sale) { dessiner(); sale = false; }
      requestAnimationFrame(boucle);
    }
    boite.querySelectorAll('.v3-seg button').forEach(function (b) {
      b.onclick = function () { boite.querySelectorAll('.v3-seg button').forEach(function (z) { z.classList.toggle('actif', z === b); }); cible = VUES[b.dataset.v]; };
    });
    var drag = null;
    cv.addEventListener('pointerdown', function (e) { drag = [e.clientX, e.clientY, yaw, pitch]; try { cv.setPointerCapture(e.pointerId); } catch (er) {} cible = null; });
    cv.addEventListener('pointermove', function (e) { if (!drag) return; yaw = drag[2] + (e.clientX - drag[0]) * 0.008; pitch = Math.max(0, Math.min(1.5, drag[3] + (e.clientY - drag[1]) * 0.006)); sale = true; });
    ['pointerup', 'pointercancel'].forEach(function (n) { cv.addEventListener(n, function () { drag = null; }); });
    window.addEventListener('resize', function () { if (vivant) { taille(); sale = true; } });
    taille();
    (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve()).then(function () { sale = true; });
    boucle();
    return { vue: function (v) { yaw = VUES[v][0]; pitch = VUES[v][1]; cible = null; sale = true; boite.querySelectorAll('.v3-seg button').forEach(function (z) { z.classList.toggle('actif', z.dataset.v === v); }); } };
  }
  window.Vue3D = { monter: monter, image: function (M, vue, w, h, echelle) { return monter(null, M, { vue: vue, w: w, h: h, echelle: echelle || 2 }); } };
})();
