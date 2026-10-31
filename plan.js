/* Camions SDC — calculs de volume et plan de chargement équilibré.
   Fonctionne dans le navigateur (window.Plan) et dans Node (module.exports). */
(function (root) {
  'use strict';

  // Rangées pour N étages (3 d'habitude, 4 quand le camion est surtout en 18 × 100) :
  // 0..N-1 = gauche (conducteur) étages 1..N, N..2N-1 = droite (passager) étages 1..N,
  // 2N = centre du dernier étage (colis posé à cheval sur les deux piles, au milieu)
  function disposition(N) {
    var rows = [], f;
    for (f = 1; f <= N; f++) rows.push('G' + f);
    for (f = 1; f <= N; f++) rows.push('D' + f);
    rows.push('C' + N);
    return { N: N, NR: 2 * N + 1, C: 2 * N, ROWS: rows };
  }
  var L3 = disposition(3), L4 = disposition(4);
  var ROWS = L3.ROWS;
  function etageDe(r, L) { return r === L.C ? L.N - 1 : r % L.N; }
  var DEFAUT = { m3Min: 39, m3Max: 41, e1Min: 12, e1Max: 13, ecartMax: 1, seuil4: 0.7 };
  // 18 × 100 : petits colis, les seuls qui peuvent monter au 4e étage
  // Petites sections (planches fines) : toujours au-dessus des grosses pour ne pas les écraser
  // Classes d'épaisseur, de la plus épaisse à la plus fine : 0 = grosses sections, puis 40, 38… 15.
  // De chaque côté, jamais un colis d'une classe plus épaisse posé au-dessus d'une classe plus fine.
  var FINES = [40, 38, 32, 27, 25, 20, 18, 15], NK = FINES.length + 1;
  function classeEp(c) { return FINES.indexOf(Math.min(c.ep, c.la)) + 1; } // 0 si grosse section
  function estFine(c) { return classeEp(c) > 0; }
  function estPetit(c) { return (c.ep === 18 && c.la === 100) || (c.ep === 100 && c.la === 18); }
  // 4 étages quand au moins 70 % des colis (en nombre) sont des 18 × 100
  function nbEtages(lignes, cfg) {
    cfg = cfg || DEFAUT;
    if (cfg.etages === 3 || cfg.etages === 4) return cfg.etages;
    var cs = colisDe(lignes).filter(function (c) { return c.cm > 0 && c.vol > 0; });
    if (!cs.length) return 3;
    var p = cs.filter(estPetit).length;
    return p / cs.length >= (cfg.seuil4 != null ? cfg.seuil4 : 0.7) - 1e-9 ? 4 : 3;
  }
  function dispoDe(lignes, cfg) { return nbEtages(lignes, cfg) === 4 ? L4 : L3; }

  function num(v) {
    if (typeof v === 'number') return v;
    if (v == null) return NaN;
    var s = String(v).trim().replace(/\s/g, '').replace(',', '.');
    if (s === '' || !/^-?\d*\.?\d*$/.test(s)) return NaN;
    return parseFloat(s);
  }

  function volLigne(l) { // un seul colis
    return (num(l.ep) * num(l.la) * num(l.pi) * num(l.lo)) / 1e6;
  }
  function volTotalLigne(l) { return volLigne(l) * (num(l.nb) || 1); }
  function totalM3(lignes) {
    var t = 0;
    for (var i = 0; i < lignes.length; i++) t += volTotalLigne(lignes[i]);
    return t;
  }

  function etat(total, cfg) {
    cfg = cfg || DEFAUT;
    var e = 1e-9;
    total = Math.round(total * 100) / 100; // comme affiché (2 décimales)
    if (total < cfg.m3Min - e) return { code: 'peu', manque: cfg.m3Min - total };
    if (total > cfg.m3Max + e) return { code: 'trop', depasse: total - cfg.m3Max };
    return { code: 'ok' };
  }

  // Sections connues : quantité de pièces par paquet, longueurs proposées (lg)
  var SECTIONS_TXT = '75x225=40 75x200=40 75x175=48 75x150=56 75x100=88 75x110=80 75x250=32 ' +
    '63x175=54 63x150=63 63x200=45 63x225=45 63x250=36 63x76=117 65x160=30 ' +
    '50x50=252 50x100=132 50x125=108 50x150=84 50x200=60 50x175=72 50x225=60 ' +
    '45x95=132 45x120=108 45x145=84 45x195=60 45x220=60 45x300=48 ' +
    '38x60=221 38x100=143 38x110=130 38x125=117 38x150=91 38x175=78 38x200=65 38x225=65 ' +
    '32x153=98 30x40=576 38x38=379 40x40=379 27x27=840 27x38=576 27x40=576 25x40=576 25x38=576 ' +
    '20x38=720 20x40=720 18x38=720 18x40=720 ' +
    '51x128=108 51x108=132 51x153=84 51x208=60 51x228=60 51x308=36 ' +
    '27x100=220 27x125=180 27x150=150 27x200=100 27x250=80 27x300=60 27x75=260 25x150=140 25x200=100 27x1000=20 27x1100=20 ' +
    '15x200=180:2/3 15x150=252:3/4 18x100=250:2/2.4/3 18x150=189:3/4 18x200=135:3/4/5 18x1000=30:2/2.5/3 18x1100=30:2/2.5/3 ' +
    '100x100=66 100x150=42 100x200=30 100x225=30 100x300=18 100x250=24 100x240=24 ' +
    '150x150=28 145x145=28 153x153=28 200x200=15 195x195=15 37x177=102:3/4 46x200=65:3/4';
  var SECTIONS = SECTIONS_TXT.split(' ').map(function (t) {
    var m = t.match(/^(\d+)x(\d+)=(\d+)(?::(.+))?$/);
    var o = { ep: +m[1], la: +m[2], pi: +m[3] };
    if (m[4]) o.lg = m[4].split('/').map(Number);
    return o;
  });
  function trouverSection(liste, ep, la) { // reconnaît aussi la section à l'envers (225 × 75)
    ep = num(ep); la = num(la);
    if (!(ep > 0 && la > 0)) return null;
    return (liste || SECTIONS).filter(function (s) { return (s.ep === ep && s.la === la) || (s.ep === la && s.la === ep); })[0] || null;
  }
  // Longueur prise en compte dans le plan : 18 × 100 en 2,40 m compte 2,50 m (le volume reste en 2,40 m)
  function lgPlan(l) {
    var ep = num(l.ep), la = num(l.la), lo = num(l.lo);
    if (((ep === 18 && la === 100) || (ep === 100 && la === 18)) && Math.abs(lo - 2.4) < 1e-9) return 2.5;
    return lo;
  }

  // Une ligne avec nb colis -> nb colis séparés (id "ligneId#k")
  function colisDe(lignes) {
    var out = [];
    lignes.forEach(function (l) {
      var n = Math.max(1, Math.round(num(l.nb) || 1));
      for (var k = 0; k < n; k++) {
        out.push({
          id: l.id + '#' + k, ligneId: l.id,
          ep: num(l.ep), la: num(l.la), pi: num(l.pi), lo: num(l.lo),
          cm: Math.round(lgPlan(l) * 100), vol: volLigne(l), aire: num(l.ep) * num(l.la)
        });
        var o = out[out.length - 1]; o.k = classeEp(o); o.fine = o.k > 0;
      }
    });
    return out;
  }

  function rng(seed) { // mulberry32
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Coût d'un plan (longueurs en cm, volumes en m³, nombre de colis par rangée)
  var DUR = 1000, ECART_LG = 75; // cm : écart de longueur gauche/droite toléré par étage
  // Plus grand écart de longueur gauche/droite d'un étage (cm) ; droite plus longue = très mauvais
  function etagesListe(v) { var t = [], n = (v && v.N) || 3; for (var f = 1; f <= n; f++) t.push(f); return t; }
  function ecartLg(v) {
    var m = 0;
    etagesListe(v).forEach(function (f) { var d = v.rows['G' + f].len - v.rows['D' + f].len; m = Math.max(m, d < 0 ? 1000 - d : d); });
    return m;
  }
  // Nombre de paires « colis plus épais posé au-dessus d'un plus fin » (par côté ; le centre compte des deux côtés)
  // h[r][k] : nombre de colis de classe k dans la rangée r
  function paireEcrase(h, L) {
    var N = L.N, C = L.C, p = 0, k;
    for (var s = 0; s < 2; s++) {
      var b = s * N, dessous = zeros(NK); // colis des étages inférieurs, par classe
      for (var g = 0; g < N; g++) {
        if (g > 0) {
          var plusFin = 0; // colis du dessous plus fins que la classe k
          for (k = NK - 1; k >= 0; k--) {
            var n = h[b + g][k] + (g === N - 1 ? h[C][k] : 0);
            if (n) p += n * plusFin;
            plusFin += dessous[k];
          }
        }
        for (k = 0; k < NK; k++) dessous[k] += h[b + g][k];
      }
    }
    return p;
  }
  var ECRASE = 700; // coût d'un gros colis sur des fines : obligatoire, sauf si les longueurs l'empêchent
  function cout(len, vol, cnt, pref, cfg, h) {
    var L = cfg._L || L3, N = L.N, C = L.C;
    var c = h ? ECRASE * paireEcrase(h, L) : 0, mn = Math.round(cfg.e1Min * 100), mx = Math.round(cfg.e1Max * 100), f;
    for (var s = 0; s < 2; s++) {
      var b = s * N, l1 = len[b];
      // règles de longueur : priorité absolue (une infraction coûte plus que tout le reste)
      if (l1 < mn) { var d0 = mn - l1; c += DUR + 50 * d0 + d0 * d0 / 10; }
      if (l1 > mx) { var d1 = l1 - mx; c += DUR + 50 * d1 + d1 * d1 / 10; }
      for (f = 1; f < N; f++) {
        if (len[b + f] > len[b + f - 1]) { var dd = len[b + f] - len[b + f - 1]; c += cfg.relax ? 40 + 3 * dd : DUR + 50 * dd + dd * dd / 10; }
        if (cfg.relax && len[b + f] > mx) { var dx = len[b + f] - mx; c += DUR + 50 * dx + dx * dx / 10; }
      }
      // étages 1 et 2 au plus près de la longueur choisie (13 m, 12 m…), le 3e prend le reste
      var g1 = Math.max(0, mx - l1), g2 = Math.max(0, mx - len[b + 1]);
      c += 3 * (g1 + g2) + (g1 * g1 + g2 * g2) / 120;
    }
    // dernier étage : paires gauche/droite puis le centre ; le tout doit tenir sur l'étage du dessous
    var E = Math.max(len[N - 1], len[2 * N - 1]) + len[C], sup = Math.min(len[N - 2], len[2 * N - 2]);
    if (E > sup) { var de = E - sup; c += cfg.relax ? 40 + 3 * de : DUR + 50 * de + de * de / 10; }
    if (cfg.relax && E > mx) { var ex = E - mx; c += DUR + 50 * ex + ex * ex / 10; }
    if (cnt[C] > 1) c += DUR * 2 * (cnt[C] - 1); // un seul colis au milieu (à cheval)
    c += 4 * cnt[C] + 0.05 * Math.abs(len[N - 1] - len[2 * N - 1]);
    // équilibre : le centre pèse à moitié de chaque côté ; l'écart doit être au dernier étage
    var D = 0;
    for (f = 0; f < N; f++) {
      var dv = vol[f] - vol[f + N]; D += dv;
      if (f < N - 1) c += 30 * Math.abs(dv);
      else c += dv < 0 ? -40 * dv : 6 * dv;
    }
    c += D < 0 ? -80 * D : 2 * D;
    if (Math.abs(D) > cfg.ecartMax) c += 400 * (Math.abs(D) - cfg.ecartMax);
    // longueurs gauche/droite à chaque étage : pareil si possible, sinon la gauche plus longue de 75 cm au plus
    for (f = 0; f < N; f++) {
      var dl = len[f] - len[f + N];
      if (dl < 0) c += 600 + 30 * -dl;
      else if (dl > ECART_LG) c += 600 + 30 * (dl - ECART_LG);
      c += 3 * Math.abs(dl);
    }
    c += pref * 1e-7; // préférence : grosses sections en bas
    return c;
  }

  function zeros(n) { var t = []; for (var i = 0; i < n; i++) t.push(0); return t; }
  // interdit[i][r] : le colis i ne peut pas aller dans la rangée r (gros colis au 4e étage)
  function interdits(colis, L) {
    return colis.map(function (c) {
      var t = []; for (var r = 0; r < L.NR; r++) t.push(L.N === 4 && etageDe(r, L) === 3 && !estPetit(c));
      return t;
    });
  }
  function agreger(colis, aff, L) {
    var len = zeros(L.NR), vol = zeros(L.NR), cnt = zeros(L.NR), h = [], pref = 0;
    for (var q = 0; q < L.NR; q++) h.push(zeros(NK));
    for (var i = 0; i < colis.length; i++) {
      var r = aff[i];
      len[r] += colis[i].cm; vol[r] += colis[i].vol; cnt[r]++; pref += colis[i].aire * etageDe(r, L);
      h[r][colis[i].k]++;
    }
    return { len: len, vol: vol, cnt: cnt, pref: pref, h: h };
  }

  // Placement de départ glouton : étage 1 alterné jusqu'à ~milieu de la plage, puis 2, puis 3
  function depart(colis, cfg, r, L, INT) {
    var ordre = colis.map(function (_, i) { return i; });
    if (r) {
      for (var i = ordre.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = ordre[i]; ordre[i] = ordre[j]; ordre[j] = t; }
    } else {
      ordre.sort(function (a, b) { return (colis[a].k - colis[b].k) || colis[b].aire - colis[a].aire || colis[b].cm - colis[a].cm; });
    }
    var cible = Math.round((cfg.e1Min + cfg.e1Max) * 50);
    var N = L.N, len = zeros(L.NR), aff = new Array(colis.length);
    ordre.forEach(function (i) {
      var c = colis[i], best = -1, bestScore = Infinity;
      for (var f = 0; f < N; f++) {
        for (var s = 0; s < 2; s++) {
          var k = s * N + f, cap = f === 0 ? cible : len[k - 1];
          if (INT[i][k]) continue;
          var after = len[k] + c.cm;
          if (after <= cap || (f === 0 && len[k] < Math.round(cfg.e1Min * 100))) {
            var sc = f * 1e6 + len[k];
            if (sc < bestScore) { bestScore = sc; best = k; }
          }
        }
        if (best >= 0) break;
      }
      if (best < 0) {
        var h = N - 1; while (h > 0 && INT[i][h]) h--;
        best = len[h] <= len[h + N] ? h : h + N;
      }
      aff[i] = best; len[best] += c.cm;
    });
    return aff;
  }

  // Construction « comme le chargeur » : on remplit étage par étage, du bas vers le haut,
  // en prenant d'abord les sections les plus épaisses, gauche puis droite à la même longueur si possible.
  function sacADos(cand, colis, cible) { // meilleure somme de longueurs <= cible, en préférant les colis épais
    var U = 5, T = Math.max(0, Math.floor(cible / U)), n = cand.length;
    var sc = new Float64Array(T + 1).fill(-1), pris = []; sc[0] = 0;
    for (var a = 0; a < n; a++) {
      var c = colis[cand[a]], w = Math.round(c.cm / U), v = (NK - c.k) * 10 + c.vol * 0.01, tab = new Uint8Array(T + 1);
      for (var t = T; t >= w; t--) if (sc[t - w] >= 0 && sc[t - w] + v > sc[t]) { sc[t] = sc[t - w] + v; tab[t] = 1; }
      pris.push(tab);
    }
    var tBest = T; while (tBest > 0 && sc[tBest] < 0) tBest--;
    var res = [], t2 = tBest;
    for (var b = n - 1; b >= 0 && t2 > 0; b--) if (pris[b][t2]) { res.push(cand[b]); t2 -= Math.round(colis[cand[b]].cm / U); }
    return res;
  }
  function construire(colis, cfg, L, INT, r) {
    var N = L.N, aff = new Array(colis.length), reste = colis.map(function (_, i) { return i; });
    var mx = Math.round(cfg.e1Max * 100), len = zeros(L.NR);
    function remplir(row, cible) {
      // on n'utilise une classe plus fine que si les plus épaisses ne suffisent pas à remplir
      var classes = []; reste.forEach(function (i) { if (classes.indexOf(colis[i].k) < 0) classes.push(colis[i].k); });
      classes.sort(function (a, b) { return a - b; });
      var choix = [];
      for (var q = 0; q < classes.length; q++) {
        var cand = reste.filter(function (i) { return colis[i].k <= classes[q] && !INT[i][row]; });
        if (r) cand.sort(function () { return r() - 0.5; });
        choix = sacADos(cand, colis, cible);
        var lg = choix.reduce(function (a, i) { return a + colis[i].cm; }, 0);
        if (lg >= cible - 25) break;
      }
      choix.forEach(function (i) { aff[i] = row; len[row] += colis[i].cm; });
      reste = reste.filter(function (i) { return choix.indexOf(i) < 0; });
    }
    for (var f = 0; f < N - 1; f++) {
      var cG = f === 0 ? mx : Math.min(len[f - 1], len[N + f - 1]);
      remplir(f, cG);
      remplir(N + f, Math.min(len[f], f === 0 ? mx : len[N + f - 1]));
    }
    // dernier étage : en alternance, le plus court d'abord (l'optimisation place le centre)
    reste.sort(function (a, b) { return colis[a].k - colis[b].k || colis[b].cm - colis[a].cm; });
    reste.forEach(function (i) {
      var g = N - 1, d = 2 * N - 1, row = len[g] <= len[d] ? g : d;
      if (INT[i][row]) { row = N - 2; while (row > 0 && INT[i][row]) row--; if (len[row] > len[row + N]) row += N; }
      aff[i] = row; len[row] += colis[i].cm;
    });
    return aff;
  }

  function optimiser(colis, cfg, aff, r, iters, biais, INT, t0) {
    var n = colis.length, L = cfg._L, NR = L.NR;
    var a = agreger(colis, aff, L), len = a.len, vol = a.vol, cnt = a.cnt, pref = a.pref, h = a.h;
    function mv(k, c, sg) { len[k] += sg * c.cm; vol[k] += sg * c.vol; cnt[k] += sg; h[k][c.k] += sg; }
    var bs = 0, B = biais || null;
    if (B) for (var q = 0; q < n; q++) bs += B[q][aff[q]];
    var cur = cout(len, vol, cnt, pref, cfg, h) + bs, best = cur, bestAff = aff.slice();
    var T0 = t0 || 150, T1 = 0.01;
    for (var it = 0; it < iters; it++) {
      var T = T0 * Math.pow(T1 / T0, it / iters);
      var i = Math.floor(r() * n), ri = aff[i], ci = colis[i];
      if (r() < 0.5 || n < 2) {
        var to = Math.floor(r() * (NR - 1)); if (to >= ri) to++;
        if (INT[i][to]) continue;
        mv(ri, ci, -1); mv(to, ci, 1);
        var p2 = pref + ci.aire * (etageDe(to, L) - etageDe(ri, L));
        var b2 = B ? bs + B[i][to] - B[i][ri] : 0;
        var c2 = cout(len, vol, cnt, p2, cfg, h) + b2;
        if (c2 <= cur || r() < Math.exp((cur - c2) / T)) { aff[i] = to; cur = c2; pref = p2; bs = b2; }
        else { mv(to, ci, -1); mv(ri, ci, 1); }
      } else {
        var j = Math.floor(r() * n), rj = aff[j];
        if (rj === ri || INT[i][rj] || INT[j][ri]) continue;
        var cj = colis[j];
        mv(ri, ci, -1); mv(rj, cj, -1); mv(ri, cj, 1); mv(rj, ci, 1);
        var p3 = pref + (ci.aire - cj.aire) * (etageDe(rj, L) - etageDe(ri, L));
        var b3 = B ? bs + B[i][rj] - B[i][ri] + B[j][ri] - B[j][rj] : 0;
        var c3 = cout(len, vol, cnt, p3, cfg, h) + b3;
        if (c3 <= cur || r() < Math.exp((cur - c3) / T)) { aff[i] = rj; aff[j] = ri; cur = c3; pref = p3; bs = b3; }
        else { mv(ri, cj, -1); mv(rj, ci, -1); mv(ri, ci, 1); mv(rj, cj, 1); }
      }
      if (cur < best - 1e-12) { best = cur; bestAff = aff.slice(); }
    }
    return { aff: bestAff, cout: best };
  }

  // Calcule un plan. Renvoie { plan: {colisId: 'G1'...}, verif }
  function proposer(lignes, cfg, rapide, graine, varier) {
    cfg = Object.assign({}, DEFAUT, cfg || {});
    var L = cfg._L = dispoDe(lignes, cfg), NR = L.NR;
    var colis = colisDe(lignes).filter(function (c) { return c.cm > 0 && c.vol > 0; });
    var INT = interdits(colis, L);
    var plan = {};
    if (!colis.length) return { plan: plan, verif: verifier(lignes, plan, cfg) };
    var r = rng(colis.length * 7919 + 17 + (graine || 0) * 104729);
    var iters = Math.min(120000, 4000 + colis.length * 3000);
    if (rapide) iters = Math.round(iters / 3);
    var biais = null;
    if (varier) { biais = colis.map(function () { var t = []; for (var q = 0; q < NR; q++) t.push(r() * varier); return t; }); }
    var essais = [depart(colis, cfg, varier ? r : null, L, INT)];
    for (var e = 0; e < (rapide ? 1 : 5); e++) essais.push(depart(colis, cfg, r, L, INT));
    var best = null;
    essais.forEach(function (aff) {
      var res = optimiser(colis, cfg, aff, r, iters, biais, INT);
      if (!best || res.cout < best.cout) best = res;
    });
    // départ « chargeur » (sections épaisses en bas), affiné doucement pour ne pas le casser
    for (var e2 = 0; e2 < (rapide ? 1 : 3); e2++) {
      var res2 = optimiser(colis, cfg, construire(colis, cfg, L, INT, e2 || graine ? r : null), r, iters, biais, INT, 8);
      if (res2.cout < best.cout) best = res2;
    }
    // finition : descente stricte depuis le meilleur
    var fin = optimiser(colis, cfg, best.aff.slice(), r, iters, biais, INT);
    if (fin.cout < best.cout) best = fin;
    colis.forEach(function (c, i) { plan[c.id] = L.ROWS[best.aff[i]]; });
    return { plan: plan, verif: verifier(lignes, plan, cfg) };
  }

  // Plan sûr : si le premier calcul laisse une erreur de rangement, on recommence avec d'autres essais
  function noteVerif(v) {
    var e = v.erreurs.filter(function (m) { return !/^(Pas assez de colis|Trop de colis|Un seul colis)/.test(m); }).length;
    var lg = ecartLg(v); // écart de longueur gauche/droite : 0 visé, 75 cm toléré
    return e * 1000 + (v.ecrase || 0) * 300 + (v.ecart < -0.005 ? 100 + -v.ecart * 10 : 0) + Math.abs(v.ecart) + (lg > ECART_LG ? 200 + Math.min(lg - ECART_LG, 700) : 0) + lg * 0.01 + (v.manque || 0) * 0.6;
  }
  // Le meilleur plan trouvé en ~2 s au plus : on s'arrête dès qu'un plan est parfait (règles + équilibre + longueurs égales)
  function meilleur(lignes, cfg, essaisMax, budgetMs) {
    var best = null, n = essaisMax || 12, t0 = Date.now(), em = (Object.assign({}, DEFAUT, cfg || {})).ecartMax;
    for (var g = 0; g < n; g++) {
      var res = proposer(lignes, cfg, false, g), v = res.verif, note = noteVerif(v);
      if (!best || note < best.note) best = { plan: res.plan, verif: v, note: note };
      var bon = note < 1000 && !v.ecrase && v.ecart >= -0.005 && v.ecart <= em + 0.005;
      if (bon && ecartLg(v) === 0 && (v.manque || 0) <= 20) break;
      if (g >= 1 && Date.now() - t0 > (budgetMs || 2000)) break;
    }
    return best;
  }

  // Signature d'un plan (contenu de chaque rangée) pour savoir si deux plans sont différents
  function signature(lignes, plan) {
    var rows = {};
    colisDe(lignes).forEach(function (c) { var k = plan[c.id] || '-'; (rows[k] = rows[k] || []).push(c.lo + 'x' + c.ep + 'x' + c.la); });
    return Object.keys(rows).sort().map(function (k) { return k + ':' + rows[k].sort().join(','); }).join('|');
  }
  // Un autre bon plan, différent de l'actuel (et des précédents déjà vus)
  function autre(lignes, cfg, dejaVus, graine, refVerif) {
    cfg = Object.assign({}, DEFAUT, cfg || {});
    var vus = {}; (dejaVus || []).forEach(function (x) { vus[x] = 1; });
    var ref = refVerif ? { verif: refVerif } : meilleur(lignes, cfg), refOk = noteVerif(ref.verif) < 1000;
    var refTient = tient(ref.verif, cfg);
    var seuil = Math.max(cfg.ecartMax, deseq(ref.verif)) + 0.005, seuilLg = Math.max(ECART_LG, ecartLg(ref.verif));
    var g0 = graine || 1, t0 = Date.now();
    for (var g = g0; g < g0 + 30 && Date.now() - t0 < 2500; g++) {
      var res = proposer(lignes, cfg, false, 1000 + g, 4 + (g % 4) * 3), v = res.verif;
      if (refOk && noteVerif(v) >= 1000) continue;
      if ((v.ecrase || 0) > (ref.verif.ecrase || 0)) continue;
      if (deseq(v) > seuil) continue;
      if (ecartLg(v) > seuilLg) continue;
      if ((v.manque || 0) > (ref.verif.manque || 0) + 40) continue;
      if (refTient && !tient(v, cfg)) continue; // jamais un plan qui dépasse
      var sig = signature(lignes, res.plan);
      if (vus[sig]) continue;
      return { plan: res.plan, verif: v, signature: sig, graine: g + 1, note: noteVerif(v) };
    }
    return null;
  }

  function deseq(v) {
    var m = 0;
    etagesListe(v).forEach(function (f) { m = Math.max(m, Math.abs(v.rows['G' + f].vol - v.rows['D' + f].vol)); });
    m = Math.max(m, Math.abs(v.ecart));
    if (v.ecart < -0.005) m += 100;
    return m;
  }

  function f2(x) { return (Math.round(x * 100) / 100).toFixed(2).replace('.', ','); }
  var COTE = ['gauche', 'droite'];

  // Vérifie un plan (calculé ou modifié à la main). Messages en français.
  // ordre (facultatif) : liste d'ids qui fixe l'ordre des colis dans chaque rangée (cabine → arrière)
  // plan[id] === 'X' : colis mis de côté par l'utilisateur
  function verifier(lignes, plan, cfg, ordre, decal) {
    cfg = Object.assign({}, DEFAUT, cfg || {});
    var L = dispoDe(lignes, cfg), N = L.N, RW = L.ROWS, CK = 'C' + N, TOP = 'G' + N, TOPD = 'D' + N;
    var colis = colisDe(lignes);
    var rows = {}; RW.forEach(function (k) { rows[k] = { colis: [], len: 0, vol: 0 }; });
    var nonPlaces = [], cote = [];
    colis.forEach(function (c) {
      var k = plan && plan[c.id];
      if (k && rows[k]) { rows[k].colis.push(c); rows[k].len += c.cm; rows[k].vol += c.vol; }
      else if (k === 'X') cote.push(c);
      else nonPlaces.push(c);
    });
    if (ordre && ordre.length) {
      var pos = {}; ordre.forEach(function (id, i) { pos[id] = i; });
      var rang = function (c, i) { return pos[c.id] !== undefined ? pos[c.id] : 1e6 + i; };
      RW.forEach(function (k) {
        var l = rows[k].colis.map(function (c, i) { return [rang(c, i), c]; });
        l.sort(function (a, b) { return a[0] - b[0]; });
        rows[k].colis = l.map(function (x) { return x[1]; });
      });
      cote = cote.map(function (c, i) { return [rang(c, i), c]; }).sort(function (a, b) { return a[0] - b[0]; }).map(function (x) { return x[1]; });
    }
    RW.forEach(function (k) { rows[k].m = rows[k].len / 100; rows[k].alerte = false; rows[k].ext = rows[k].len; });
    // dernier étage : espaces laissés à la main entre les colis (decal[id] = vide devant ce colis, en cm)
    if (decal) RW.forEach(function (k) { if (k.charAt(0) !== 'C') rows[k].colis.forEach(function (c) { rows[k].ext += Math.max(0, +decal[c.id] || 0); }); });
    var erreurs = [], avis = [];
    var mn = Math.round(cfg.e1Min * 100), mx = Math.round(cfg.e1Max * 100);
    var manque = 0; ['G', 'D'].forEach(function (p) { manque += Math.max(0, mx - rows[p + '1'].len) + Math.max(0, mx - rows[p + '2'].len); });
    if (nonPlaces.length) erreurs.push(nonPlaces.length + (nonPlaces.length > 1 ? ' colis non placés.' : ' colis non placé.'));
    if (cote.length) erreurs.push(cote.length + ' colis de côté : remets-' + (cote.length > 1 ? 'les' : 'le') + ' dans le camion.');
    if (rows[CK].colis.length > 1) { rows[CK].alerte = true; erreurs.push('Un seul colis au milieu : il est à cheval sur les 2 côtés.'); }
    [0, 1].forEach(function (s) {
      var p = s === 0 ? 'G' : 'D', r1 = rows[p + '1'], r2 = rows[p + '2'];
      if (r1.len < mn || r1.ext > mx) {
        if (r1.ext > mx) r1.alerte = true; // trop court : pas grave si tout est chargé
        erreurs.push('Étage 1 ' + COTE[s] + ' : ' + f2(r1.ext / 100) + ' m, il faut entre ' + f2(cfg.e1Min) + ' et ' + f2(cfg.e1Max) + ' m.');
      }
      if (r2.ext > r1.ext && !cfg.relax) { r2.alerte = true; erreurs.push('Étage 2 ' + COTE[s] + ' : ' + f2(r2.ext / 100) + ' m, plus long que l\'étage 1 (' + f2(r1.ext / 100) + ' m).'); }
      else if (r2.ext > mx) { r2.alerte = true; erreurs.push('Étage 2 ' + COTE[s] + ' : ' + f2(r2.ext / 100) + ' m, plus de ' + f2(cfg.e1Max) + ' m.'); }
      else if (r2.ext > r1.ext) {
        if (cfg.relax) avis.push('Étage 2 ' + COTE[s] + ' plus long que l\'étage 1 : seule solution pour tout charger.');
        else { r2.alerte = true; erreurs.push('Étage 2 ' + COTE[s] + ' : ' + f2(r2.ext / 100) + ' m, plus long que l\'étage 1 (' + f2(r1.ext / 100) + ' m).'); }
      }
      for (var f = 3; f <= N; f++) {
        var ra = rows[p + f], rb = rows[p + (f - 1)];
        if (ra.ext > rb.ext && !cfg.relax) { ra.alerte = true; erreurs.push('Étage ' + f + ' ' + COTE[s] + ' : ' + f2(ra.ext / 100) + ' m, plus long que l\'étage ' + (f - 1) + ' (' + f2(rb.ext / 100) + ' m).'); }
        else if (ra.ext > mx) { ra.alerte = true; erreurs.push('Étage ' + f + ' ' + COTE[s] + ' : ' + f2(ra.ext / 100) + ' m, plus de ' + f2(cfg.e1Max) + ' m.'); }
        else if (ra.ext > rb.ext) {
          if (cfg.relax) avis.push('Étage ' + f + ' ' + COTE[s] + ' plus long que l\'étage ' + (f - 1) + ' : seule solution pour tout charger.');
          else { ra.alerte = true; erreurs.push('Étage ' + f + ' ' + COTE[s] + ' : ' + f2(ra.ext / 100) + ' m, plus long que l\'étage ' + (f - 1) + ' (' + f2(rb.ext / 100) + ' m).'); }
        }
      }
    });
    // dernier étage avec le centre : doit tenir sur les deux piles de l'étage du dessous
    var E3 = Math.max(rows[TOP].ext, rows[TOPD].ext) + rows[CK].len, sup3 = Math.min(rows['G' + (N - 1)].len, rows['D' + (N - 1)].len);
    if (rows[CK].colis.length && cfg.relax && E3 > mx) { rows[CK].alerte = true; erreurs.push('Étage ' + N + ' : ' + f2(E3 / 100) + ' m avec le colis du centre, plus de ' + f2(cfg.e1Max) + ' m.'); }
    else if (rows[CK].colis.length && E3 > sup3 && cfg.relax) avis.push('Étage ' + N + ' plus long que l\'étage ' + (N - 1) + ' avec le colis du centre : seule solution pour tout charger.');
    else if (rows[CK].colis.length && E3 > sup3) { rows[CK].alerte = rows[TOP].alerte = rows[TOPD].alerte = true; erreurs.push('Étage ' + N + ' : ' + f2(E3 / 100) + ' m avec le colis du centre, plus long que l\'étage ' + (N - 1) + ' (' + f2(sup3 / 100) + ' m).'); }
    if (N === 4) {
      var gros = [TOP, TOPD, CK].reduce(function (a, k) { return a + rows[k].colis.filter(function (c) { return !estPetit(c); }).length; }, 0);
      if (gros) { [TOP, TOPD, CK].forEach(function (k) { if (rows[k].colis.some(function (c) { return !estPetit(c); })) rows[k].alerte = true; }); erreurs.push('Étage 4 : seuls les 18×100 peuvent monter au 4e étage (' + gros + ' colis à descendre).'); }
    }
    // colis plus épais posés au-dessus de plus fins
    var hR = RW.map(function (k) { var t = zeros(NK); rows[k].colis.forEach(function (c) { t[c.k]++; }); return t; });
    var ecrase = paireEcrase(hR, L);
    if (ecrase) {
      [0, 1].forEach(function (s) {
        var p = s === 0 ? 'G' : 'D', plusFine = -1; // classe la plus fine déjà posée dessous
        for (var f = 1; f <= N; f++) {
          var ks = f === N ? [p + f, CK] : [p + f];
          ks.forEach(function (k) { if (rows[k].colis.some(function (c) { return c.k < plusFine; })) rows[k].alerte = true; });
          rows[p + f].colis.forEach(function (c) { plusFine = Math.max(plusFine, c.k); });
        }
      });
      avis.push('Impossible de mettre toutes les sections fines au-dessus des plus épaisses avec ces colis (' + ecrase + ' cas). Plan fait au mieux.');
    }
    var volG = rows[CK].vol / 2, volD = rows[CK].vol / 2;
    for (var e0 = 1; e0 <= N; e0++) { volG += rows['G' + e0].vol; volD += rows['D' + e0].vol; }
    var ecart = volG - volD, tol = 0.005;
    if (ecart < -tol) avis.push('Côté passager (droite) plus chargé de ' + f2(-ecart) + ' m³ : le côté conducteur doit être le plus lourd.');
    else if (ecart > cfg.ecartMax + tol) avis.push('Écart gauche/droite de ' + f2(ecart) + ' m³ (max conseillé ' + f2(cfg.ecartMax) + ' m³).');
    etagesListe({ N: N - 1 }).forEach(function (f) {
      var d = rows['G' + f].vol - rows['D' + f].vol;
      if (Math.abs(d) > cfg.ecartMax + tol) avis.push('Étage ' + f + ' déséquilibré de ' + f2(Math.abs(d)) + ' m³ (plus lourd à ' + (d > 0 ? 'gauche' : 'droite') + '). L\'écart devrait être à l\'étage ' + N + '.');
    });
    etagesListe({ N: N }).forEach(function (f) {
      var dl = rows['G' + f].len - rows['D' + f].len;
      if (dl < 0) avis.push('Étage ' + f + ' : la droite est plus longue que la gauche de ' + Math.round(-dl) + ' cm (la gauche doit être la plus longue).');
      else if (dl > ECART_LG) avis.push('Étage ' + f + ' : ' + Math.round(dl) + ' cm d\'écart de longueur entre gauche et droite (75 cm au plus).');
    });
    var d3 = rows[TOP].vol - rows[TOPD].vol;
    if (Math.abs(d3) > cfg.ecartMax + tol) avis.push('Étage ' + N + ' déséquilibré de ' + f2(Math.abs(d3)) + ' m³ (plus lourd à ' + (d3 > 0 ? 'gauche' : 'droite') + ').');
    if (d3 < -tol && ecart >= -tol) avis.push('Étage ' + N + ' : la droite est plus chargée que la gauche de ' + f2(-d3) + ' m³.');

    // Conseils quand c'est impossible
    var totCm = colis.reduce(function (a, c) { return a + c.cm; }, 0);
    if (colis.length && totCm < 2 * mn) erreurs.push('Pas assez de colis pour faire ' + f2(cfg.e1Min) + ' m à l\'étage 1 des deux côtés : il manque ' + f2((2 * mn - totCm) / 100) + ' m de longueur.');
    if (totCm > 2 * N * mx) erreurs.push('Trop de colis : ' + f2(totCm / 100) + ' m bout à bout, le camion en prend au plus ' + f2(2 * N * cfg.e1Max) + ' m.');
    if (colis.length === 1) erreurs.push('Un seul colis : impossible de remplir l\'étage 1 des deux côtés.');

    var total = volG + volD + nonPlaces.concat(cote).reduce(function (a, c) { return a + c.vol; }, 0);
    var et = etat(total, cfg);
    if (et.code === 'peu') avis.push('Volume : ' + f2(total) + ' m³, il manque ' + f2(et.manque) + ' m³ pour atteindre ' + f2(cfg.m3Min) + ' m³.');
    if (et.code === 'trop') avis.push('Volume : ' + f2(total) + ' m³, limite dépassée de ' + f2(et.depasse) + ' m³.');

    // doublons
    function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
    erreurs = uniq(erreurs); avis = uniq(avis);
    return {
      N: N, ROWS: RW, ecrase: ecrase, rows: rows, nonPlaces: nonPlaces, cote: cote, erreurs: erreurs, avis: avis,
      volG: volG, volD: volD, ecart: ecart, manque: manque, total: total, etat: et, e3: E3 / 100, sup3: sup3 / 100,
      ok: erreurs.length === 0, parfait: erreurs.length === 0 && avis.length === 0
    };
  }

  // Double remorque : répartit les colis entre les 2 remorques (selon leur longueur), puis un plan par remorque.
  // Renvoie [{ lignes, plan, verif, note }, { … }] ; les lignes gardent leur id (nb réparti).
  function lignesDe(lignes, compte) {
    var out = [];
    lignes.forEach(function (l) { var n = compte[l.id] || 0; if (n > 0) { var x = Object.assign({}, l); x.nb = n; out.push(x); } });
    return out;
  }
  // Tout doit rentrer : aucun étage plus long que la longueur choisie, ni plus long que celui du dessous
  function tient(v, cfg) {
    var mx = Math.round(cfg.e1Max * 100), ok = true;
    v.ROWS.forEach(function (k) { if (k.charAt(0) !== 'C' && v.rows[k].ext > mx) ok = false; });
    if (!cfg.relax) ['G', 'D'].forEach(function (s) { for (var f = 2; f <= v.N; f++) if (v.rows[s + f].ext > v.rows[s + (f - 1)].ext) ok = false; });
    if (v.rows['C' + v.N].colis.length && v.e3 > (cfg.relax ? mx / 100 : v.sup3) + 1e-9) ok = false;
    return ok && !v.nonPlaces.length;
  }
  // Meilleur plan où tout rentre ; sinon, le plus petit colis (m³) est mis de côté ('X'), et on recommence
  function meilleurTient(lignes, cfg, budget, relaxOk) {
    cfg = Object.assign({}, DEFAUT, cfg || {});
    var res = meilleur(lignes, cfg, 12, budget || 2000), cote = [], cur = lignes;
    if (relaxOk && (!tient(res.verif, cfg) || res.verif.ecrase)) {
      // double : un étage du haut plus long est permis si c'est la seule façon de tout charger (ou de garder les fines en haut)
      var cr = Object.assign({}, cfg, { relax: true }); delete cr._L;
      var rr = meilleur(lignes, cr, 12, budget || 2000);
      if (tient(rr.verif, cr) && (!tient(res.verif, cfg) || (rr.verif.ecrase || 0) < res.verif.ecrase)) { rr.relax = true; return rr; }
      if (!tient(res.verif, cfg)) { cfg = cr; res = rr; }
    }
    for (var n = 0; n < 6 && !tient(res.verif, cfg); n++) {
      var cs = colisDe(cur).filter(function (c) { return c.cm > 0 && c.vol > 0; });
      if (cs.length < 3) break;
      cs.sort(function (a, b) { return a.vol - b.vol || a.cm - b.cm; });
      var pc = cs[0];
      cur = cur.map(function (l) { if (l.id !== pc.ligneId) return l; var x = Object.assign({}, l); x.nb = (x.nb || 1) - 1; return x; }).filter(function (l) { return (l.nb || 1) > 0 && l.nb !== 0; });
      cote.push(pc.ligneId);
      res = meilleur(cur, cfg, 12, 1200);
    }
    if (!cote.length) { if (cfg.relax) res.relax = true; return res; }
    // les colis de côté prennent les derniers numéros de leur ligne : les autres gardent leur id
    var plan = Object.assign({}, res.plan), restant = {};
    cur.forEach(function (l) { restant[l.id] = l.nb || 1; });
    lignes.forEach(function (l) { for (var k = restant[l.id] || 0; k < (l.nb || 1); k++) plan[l.id + '#' + k] = 'X'; });
    return { plan: plan, verif: verifier(lignes, plan, cfg), note: res.note, cote: cote.length, relax: !!cfg.relax };
  }
  function partager(lignes, lgs, cfg, graine) {
    cfg = Object.assign({}, DEFAUT, cfg || {});
    var colis = colisDe(lignes).filter(function (c) { return c.cm > 0 && c.vol > 0; });
    var r = rng(colis.length * 31 + 7 + (graine || 0) * 7919), ecartE = cfg.e1Max - cfg.e1Min;
    function cfgR(i) { var x = Object.assign({}, cfg); x.e1Max = lgs[i]; x.e1Min = Math.max(1, lgs[i] - ecartE); x.m3Min = 0; x.m3Max = 1e6; delete x._L; return x; }
    function essai(bruit) {
      var fill = [0, 0], compte = [{}, {}];
      var ord = colis.slice().sort(function (a, b) { return (a.k - b.k) || (b.cm - a.cm) || (bruit ? r() - 0.5 : 0); });
      ord.forEach(function (c) {
        var q0 = (fill[0] + c.cm) / lgs[0], q1 = (fill[1] + c.cm) / lgs[1];
        if (bruit) { q0 *= 1 + (r() - 0.5) * bruit; q1 *= 1 + (r() - 0.5) * bruit; }
        var t = q0 <= q1 ? 0 : 1; fill[t] += c.cm; compte[t][c.ligneId] = (compte[t][c.ligneId] || 0) + 1;
      });
      return [lignesDe(lignes, compte[0]), lignesDe(lignes, compte[1])];
    }
    var best = null, t0 = Date.now();
    for (var e = 0; e < 8 && (e < 2 || Date.now() - t0 < 1500); e++) {
      var parts = essai(e === 0 && !graine ? 0 : 0.25), note = 0;
      parts.forEach(function (lg, i) { if (lg.length) note += noteVerif(proposer(lg, cfgR(i), true, e).verif); });
      if (!best || note < best.note) best = { parts: parts, note: note };
    }
    function finir(parts) {
      return parts.map(function (lg, i) {
        if (!lg.length) return { lignes: [], plan: {}, verif: null, note: 0, cfg: cfgR(i), cote: 0 };
        var m = meilleur(lg, cfgR(i), 12, 1500);
        return { lignes: lg, plan: m.plan, verif: m.verif, note: m.note, cfg: cfgR(i), cote: 0, ok: tient(m.verif, cfgR(i)) };
      });
    }
    var res = finir(best.parts);
    // pas tout rentré : on essaie d'autres répartitions entre les 2 remorques
    for (var e2 = 1; e2 <= 4 && res.some(function (x) { return x.lignes.length && !x.ok; }) && Date.now() - t0 < 9000; e2++) {
      var pt = essai(0.3 + e2 * 0.15), r2 = finir(pt);
      if (r2.filter(function (x) { return x.lignes.length && !x.ok; }).length < res.filter(function (x) { return x.lignes.length && !x.ok; }).length) res = r2;
    }
    // toujours pas : le plus petit colis de côté dans la remorque concernée
    return res.map(function (x, i) {
      if (!x.lignes.length || (x.ok && !x.verif.ecrase)) return x;
      var m = meilleurTient(x.lignes, cfgR(i), 1200, true);
      return { lignes: x.lignes, plan: m.plan, verif: m.verif, note: m.note, cfg: m.relax ? Object.assign(cfgR(i), { relax: true }) : cfgR(i), cote: m.cote || 0, relax: !!m.relax };
    });
  }

  var Plan = { partager: partager, tient: tient, meilleurTient: meilleurTient, estFine: estFine, nbEtages: nbEtages, estPetit: estPetit, SECTIONS: SECTIONS, trouverSection: trouverSection, lgPlan: lgPlan, ROWS: ROWS, DEFAUT: DEFAUT, num: num, volLigne: volLigne, volTotalLigne: volTotalLigne, totalM3: totalM3, etat: etat, colisDe: colisDe, proposer: proposer, meilleur: meilleur, noteVerif: noteVerif, deseq: deseq, ecartLg: ecartLg, ECART_LG: ECART_LG, autre: autre, signature: signature, verifier: verifier, f2: f2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = Plan;
  else root.Plan = Plan;
})(typeof window !== 'undefined' ? window : this);
