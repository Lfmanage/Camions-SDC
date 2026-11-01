/* Camions SDC — petit générateur de QR code (mode octets, correction M), sans internet */
(function () {
  'use strict';
  var ECC = [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28];
  var BLOCS = [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49];

  function modulesBruts(v) {
    var r = (16 * v + 128) * v + 64;
    if (v >= 2) { var na = Math.floor(v / 7) + 2; r -= (25 * na - 10) * na - 55; if (v >= 7) r -= 36; }
    return r;
  }
  function capacite(v) { return Math.floor(modulesBruts(v) / 8) - ECC[v] * BLOCS[v]; }
  function posAlign(v) {
    if (v === 1) return [];
    var n = Math.floor(v / 7) + 2, taille = v * 4 + 17;
    var pas = v === 32 ? 26 : Math.ceil((v * 4 + 4) / (n * 2 - 2)) * 2, res = [6];
    for (var p = taille - 7; res.length < n; p -= pas) res.splice(1, 0, p);
    return res;
  }
  // ---- Reed-Solomon sur GF(256) ----
  function mul(x, y) { var z = 0; for (var i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11D); z ^= ((y >>> i) & 1) * x; } return z & 0xFF; }
  function diviseur(deg) {
    var r = []; for (var i = 0; i < deg - 1; i++) r.push(0); r.push(1);
    var root = 1;
    for (var k = 0; k < deg; k++) {
      for (var j = 0; j < r.length; j++) { r[j] = mul(r[j], root); if (j + 1 < r.length) r[j] ^= r[j + 1]; }
      root = mul(root, 0x02);
    }
    return r;
  }
  function reste(data, div) {
    var r = div.map(function () { return 0; });
    data.forEach(function (b) {
      var f = b ^ r.shift(); r.push(0);
      div.forEach(function (c, i) { r[i] ^= mul(c, f); });
    });
    return r;
  }

  function creer(texte) {
    var octets = Array.prototype.slice.call(new TextEncoder().encode(texte));
    var v = 1;
    for (; v <= 40; v++) { var bitsLong = v <= 9 ? 8 : 16; if (4 + bitsLong + octets.length * 8 <= capacite(v) * 8) break; }
    if (v > 40) throw new Error('trop long');
    var taille = v * 4 + 17, cap = capacite(v);
    // ---- bits de données ----
    var bits = [];
    function ajout(val, n) { for (var i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1); }
    ajout(4, 4); ajout(octets.length, v <= 9 ? 8 : 16);
    octets.forEach(function (b) { ajout(b, 8); });
    ajout(0, Math.min(4, cap * 8 - bits.length));
    ajout(0, (8 - bits.length % 8) % 8);
    for (var pad = 0xEC; bits.length < cap * 8; pad ^= 0xEC ^ 0x11) ajout(pad, 8);
    var data = []; for (var i = 0; i < bits.length; i += 8) { var x = 0; for (var j = 0; j < 8; j++) x = (x << 1) | bits[i + j]; data.push(x); }
    // ---- blocs + correction ----
    var nb = BLOCS[v], le = ECC[v], brut = Math.floor(modulesBruts(v) / 8), courts = nb - brut % nb, lCourt = Math.floor(brut / nb);
    var div = diviseur(le), blocs = [], k = 0;
    for (i = 0; i < nb; i++) {
      var d = data.slice(k, k + lCourt - le + (i < courts ? 0 : 1)); k += d.length;
      var e = reste(d, div); if (i < courts) d.push(0);
      blocs.push(d.concat(e));
    }
    var mots = [];
    for (i = 0; i < blocs[0].length; i++) blocs.forEach(function (b, j) { if (i !== lCourt - le || j >= courts) mots.push(b[i]); });
    // ---- grille ----
    var M = [], F = [];
    for (i = 0; i < taille; i++) { M.push(new Array(taille).fill(false)); F.push(new Array(taille).fill(false)); }
    function fix(x, y, n) { M[y][x] = n; F[y][x] = true; }
    for (i = 0; i < taille; i++) { fix(6, i, i % 2 === 0); fix(i, 6, i % 2 === 0); }
    [[3, 3], [taille - 4, 3], [3, taille - 4]].forEach(function (p) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var xx = p[0] + dx, yy = p[1] + dy, dist = Math.max(Math.abs(dx), Math.abs(dy));
        if (xx >= 0 && xx < taille && yy >= 0 && yy < taille) fix(xx, yy, dist !== 2 && dist !== 4);
      }
    });
    var al = posAlign(v), na = al.length;
    for (i = 0; i < na; i++) for (j = 0; j < na; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === na - 1) || (i === na - 1 && j === 0)) continue;
      for (var dy2 = -2; dy2 <= 2; dy2++) for (var dx2 = -2; dx2 <= 2; dx2++) fix(al[i] + dx2, al[j] + dy2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
    }
    function format(masque) {
      var dd = (0 << 3) | masque, r = dd; // niveau M = 0
      for (var q = 0; q < 10; q++) r = (r << 1) ^ ((r >>> 9) * 0x537);
      var b = ((dd << 10) | r) ^ 0x5412, bit = function (n) { return ((b >>> n) & 1) !== 0; };
      for (var q2 = 0; q2 <= 5; q2++) fix(8, q2, bit(q2));
      fix(8, 7, bit(6)); fix(8, 8, bit(7)); fix(7, 8, bit(8));
      for (q2 = 9; q2 < 15; q2++) fix(14 - q2, 8, bit(q2));
      for (q2 = 0; q2 < 8; q2++) fix(taille - 1 - q2, 8, bit(q2));
      for (q2 = 8; q2 < 15; q2++) fix(8, taille - 15 + q2, bit(q2));
      fix(8, taille - 8, true);
    }
    format(0);
    if (v >= 7) {
      var rv = v; for (i = 0; i < 12; i++) rv = (rv << 1) ^ ((rv >>> 11) * 0x1F25);
      var bv = (v << 12) | rv;
      for (i = 0; i < 18; i++) { var bt = ((bv >>> i) & 1) !== 0, a = taille - 11 + i % 3, b2 = Math.floor(i / 3); fix(a, b2, bt); fix(b2, a, bt); }
    }
    // ---- placement en zigzag ----
    var n = 0;
    for (var droite = taille - 1; droite >= 1; droite -= 2) {
      if (droite === 6) droite = 5;
      for (var vert = 0; vert < taille; vert++) for (j = 0; j < 2; j++) {
        var xx2 = droite - j, haut = ((droite + 1) & 2) === 0, yy2 = haut ? taille - 1 - vert : vert;
        if (!F[yy2][xx2] && n < mots.length * 8) { M[yy2][xx2] = ((mots[n >>> 3] >>> (7 - (n & 7))) & 1) !== 0; n++; }
      }
    }
    // ---- masque : on garde celui qui pénalise le moins ----
    function inverse(m) {
      for (var y = 0; y < taille; y++) for (var x = 0; x < taille; x++) {
        if (F[y][x]) continue;
        var c;
        switch (m) {
          case 0: c = (x + y) % 2 === 0; break; case 1: c = y % 2 === 0; break; case 2: c = x % 3 === 0; break;
          case 3: c = (x + y) % 3 === 0; break; case 4: c = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break;
          case 5: c = x * y % 2 + x * y % 3 === 0; break; case 6: c = (x * y % 2 + x * y % 3) % 2 === 0; break;
          default: c = ((x + y) % 2 + x * y % 3) % 2 === 0;
        }
        if (c) M[y][x] = !M[y][x];
      }
    }
    function penalite() {
      var p = 0, noirs = 0, y, x;
      for (y = 0; y < taille; y++) {
        var cx = null, lx = 0, cy = null, ly = 0;
        for (x = 0; x < taille; x++) {
          if (M[y][x] === cx) { lx++; if (lx === 5) p += 3; else if (lx > 5) p++; } else { cx = M[y][x]; lx = 1; }
          if (M[x][y] === cy) { ly++; if (ly === 5) p += 3; else if (ly > 5) p++; } else { cy = M[x][y]; ly = 1; }
          if (M[y][x]) noirs++;
          if (x < taille - 1 && y < taille - 1) { var c0 = M[y][x]; if (c0 === M[y][x + 1] && c0 === M[y + 1][x] && c0 === M[y + 1][x + 1]) p += 3; }
        }
      }
      var tot = taille * taille; p += Math.max(0, Math.ceil(Math.abs(noirs * 20 - tot * 10) / tot) - 1) * 10;
      return p;
    }
    var meilleur = 0, pMin = Infinity;
    for (var m = 0; m < 8; m++) { inverse(m); format(m); var pp = penalite(); if (pp < pMin) { pMin = pp; meilleur = m; } inverse(m); }
    inverse(meilleur); format(meilleur);
    return { taille: taille, version: v, noir: function (x, y) { return M[y][x]; } };
  }

  // dessine le QR dans un canvas (marge blanche de 4 modules)
  function canvas(texte, px, coul) {
    var q = creer(texte), tot = q.taille + 8, k = Math.max(2, Math.floor((px || 600) / tot));
    var cv = document.createElement('canvas'); cv.width = cv.height = tot * k;
    var x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, cv.width, cv.height); x.fillStyle = coul || '#000';
    for (var yy = 0; yy < q.taille; yy++) for (var xx = 0; xx < q.taille; xx++) if (q.noir(xx, yy)) x.fillRect((xx + 4) * k, (yy + 4) * k, k, k);
    cv.qrVersion = q.version;
    return cv;
  }
  window.QR = { creer: creer, canvas: canvas };
})();
