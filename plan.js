/* Camions SDC — calculs de volume et plan de chargement équilibré.
   Fonctionne dans le navigateur (window.Plan) et dans Node (module.exports). */
(function (root) {
  'use strict';

  // 7 rangées : 0..2 = gauche (conducteur) étages 1..3, 3..5 = droite (passager) étages 1..3,
  // 6 = centre de l'étage 3 (colis posé à cheval sur les deux piles, au milieu)
  var ROWS = ['G1', 'G2', 'G3', 'D1', 'D2', 'D3', 'C3'];
  var NR = 7;
  function etageDe(r) { return r === 6 ? 2 : r % 3; }
  var DEFAUT = { m3Min: 39, m3Max: 41, e1Min: 12, e1Max: 13, ecartMax: 1 };

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
    '27x100=220 27x125=180 27x150=150 27x200=100 27x250=80 27x300=60 27x75=260 25x150=140 27x1000=20 27x1100=20 ' +
    '18x100=250:2/2.4/3 18x150=189:3/4 18x200=135:3/4/5 18x1000=30:2/2.5/3 18x1100=30:2/2.5/3 ' +
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
  var DUR = 1000;
  function cout(len, vol, cnt, pref, cfg) {
    var c = 0, mn = Math.round(cfg.e1Min * 100), mx = Math.round(cfg.e1Max * 100);
    for (var s = 0; s < 2; s++) {
      var b = s * 3, l1 = len[b], l2 = len[b + 1], l3 = len[b + 2];
      // règles de longueur : priorité absolue (une infraction coûte plus que tout le reste)
      if (l1 < mn) { var d0 = mn - l1; c += DUR + 50 * d0 + d0 * d0 / 10; }
      if (l1 > mx) { var d1 = l1 - mx; c += DUR + 50 * d1 + d1 * d1 / 10; }
      if (l2 > l1) { var d2 = l2 - l1; c += DUR + 50 * d2 + d2 * d2 / 10; }
      if (l3 > l2) { var d3 = l3 - l2; c += DUR + 50 * d3 + d3 * d3 / 10; }
      // étage 2 le plus plein possible (aussi long que l'étage 1)
      var g = Math.max(0, l1 - l2); c += g + g * g / 300;
    }
    // étage 3 : paires gauche/droite puis le centre ; le tout doit tenir sur l'étage 2
    var E = Math.max(len[2], len[5]) + len[6], sup = Math.min(len[1], len[4]);
    if (E > sup) { var de = E - sup; c += DUR + 50 * de + de * de / 10; }
    if (cnt[6] > 1) c += 300 * (cnt[6] - 1);
    c += 4 * cnt[6] + 0.05 * Math.abs(len[2] - len[5]);
    // équilibre : le centre pèse à moitié de chaque côté
    var d1v = vol[0] - vol[3], d2v = vol[1] - vol[4], d3v = vol[2] - vol[5], D = d1v + d2v + d3v;
    c += 30 * (Math.abs(d1v) + Math.abs(d2v));
    c += d3v < 0 ? -40 * d3v : 6 * d3v;
    c += D < 0 ? -80 * D : 2 * D;
    if (Math.abs(D) > cfg.ecartMax) c += 400 * (Math.abs(D) - cfg.ecartMax);
    c += 0.02 * (Math.abs(len[0] - len[3]) + Math.abs(len[1] - len[4]));
    c += pref * 1e-7; // préférence : grosses sections en bas
    return c;
  }

  function agreger(colis, aff) {
    var len = [0, 0, 0, 0, 0, 0, 0], vol = [0, 0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0, 0], pref = 0;
    for (var i = 0; i < colis.length; i++) {
      var r = aff[i];
      len[r] += colis[i].cm; vol[r] += colis[i].vol; cnt[r]++; pref += colis[i].aire * etageDe(r);
    }
    return { len: len, vol: vol, cnt: cnt, pref: pref };
  }

  // Placement de départ glouton : étage 1 alterné jusqu'à ~milieu de la plage, puis 2, puis 3
  function depart(colis, cfg, r) {
    var ordre = colis.map(function (_, i) { return i; });
    if (r) {
      for (var i = ordre.length - 1; i > 0; i--) { var j = Math.floor(r() * (i + 1)); var t = ordre[i]; ordre[i] = ordre[j]; ordre[j] = t; }
    } else {
      ordre.sort(function (a, b) { return colis[b].aire - colis[a].aire || colis[b].cm - colis[a].cm; });
    }
    var cible = Math.round((cfg.e1Min + cfg.e1Max) * 50);
    var len = [0, 0, 0, 0, 0, 0, 0], aff = new Array(colis.length);
    ordre.forEach(function (i) {
      var c = colis[i], best = -1, bestScore = Infinity;
      for (var f = 0; f < 3; f++) {
        for (var s = 0; s < 2; s++) {
          var k = s * 3 + f, cap = f === 0 ? cible : len[k - 1];
          var after = len[k] + c.cm;
          if (after <= cap || (f === 0 && len[k] < Math.round(cfg.e1Min * 100))) {
            var sc = f * 1e6 + len[k];
            if (sc < bestScore) { bestScore = sc; best = k; }
          }
        }
        if (best >= 0) break;
      }
      if (best < 0) best = len[2] <= len[5] ? 2 : 5;
      aff[i] = best; len[best] += c.cm;
    });
    return aff;
  }

  function optimiser(colis, cfg, aff, r, iters, biais) {
    var n = colis.length;
    var a = agreger(colis, aff), len = a.len, vol = a.vol, cnt = a.cnt, pref = a.pref;
    var bs = 0, B = biais || null;
    if (B) for (var q = 0; q < n; q++) bs += B[q][aff[q]];
    var cur = cout(len, vol, cnt, pref, cfg) + bs, best = cur, bestAff = aff.slice();
    var T0 = 150, T1 = 0.01;
    for (var it = 0; it < iters; it++) {
      var T = T0 * Math.pow(T1 / T0, it / iters);
      var i = Math.floor(r() * n), ri = aff[i], ci = colis[i];
      if (r() < 0.5 || n < 2) {
        var to = Math.floor(r() * (NR - 1)); if (to >= ri) to++;
        len[ri] -= ci.cm; vol[ri] -= ci.vol; cnt[ri]--; len[to] += ci.cm; vol[to] += ci.vol; cnt[to]++;
        var p2 = pref + ci.aire * (etageDe(to) - etageDe(ri));
        var b2 = B ? bs + B[i][to] - B[i][ri] : 0;
        var c2 = cout(len, vol, cnt, p2, cfg) + b2;
        if (c2 <= cur || r() < Math.exp((cur - c2) / T)) { aff[i] = to; cur = c2; pref = p2; bs = b2; }
        else { len[to] -= ci.cm; vol[to] -= ci.vol; cnt[to]--; len[ri] += ci.cm; vol[ri] += ci.vol; cnt[ri]++; }
      } else {
        var j = Math.floor(r() * n), rj = aff[j];
        if (rj === ri) continue;
        var cj = colis[j];
        len[ri] += cj.cm - ci.cm; vol[ri] += cj.vol - ci.vol;
        len[rj] += ci.cm - cj.cm; vol[rj] += ci.vol - cj.vol;
        var p3 = pref + (ci.aire - cj.aire) * (etageDe(rj) - etageDe(ri));
        var b3 = B ? bs + B[i][rj] - B[i][ri] + B[j][ri] - B[j][rj] : 0;
        var c3 = cout(len, vol, cnt, p3, cfg) + b3;
        if (c3 <= cur || r() < Math.exp((cur - c3) / T)) { aff[i] = rj; aff[j] = ri; cur = c3; pref = p3; bs = b3; }
        else { len[ri] -= cj.cm - ci.cm; vol[ri] -= cj.vol - ci.vol; len[rj] -= ci.cm - cj.cm; vol[rj] -= ci.vol - cj.vol; }
      }
      if (cur < best - 1e-12) { best = cur; bestAff = aff.slice(); }
    }
    return { aff: bestAff, cout: best };
  }

  // Calcule un plan. Renvoie { plan: {colisId: 'G1'...}, verif }
  function proposer(lignes, cfg, rapide, graine, varier) {
    cfg = Object.assign({}, DEFAUT, cfg || {});
    var colis = colisDe(lignes).filter(function (c) { return c.cm > 0 && c.vol > 0; });
    var plan = {};
    if (!colis.length) return { plan: plan, verif: verifier(lignes, plan, cfg) };
    var r = rng(colis.length * 7919 + 17 + (graine || 0) * 104729);
    var iters = Math.min(120000, 4000 + colis.length * 3000);
    if (rapide) iters = Math.round(iters / 3);
    var biais = null;
    if (varier) { biais = colis.map(function () { var t = []; for (var q = 0; q < NR; q++) t.push(r() * varier); return t; }); }
    var essais = [depart(colis, cfg, varier ? r : null)];
    for (var e = 0; e < (rapide ? 1 : 5); e++) essais.push(depart(colis, cfg, r));
    var best = null;
    essais.forEach(function (aff) {
      var res = optimiser(colis, cfg, aff, r, iters, biais);
      if (!best || res.cout < best.cout) best = res;
    });
    // finition : descente stricte depuis le meilleur
    var fin = optimiser(colis, cfg, best.aff.slice(), r, iters, biais);
    if (fin.cout < best.cout) best = fin;
    colis.forEach(function (c, i) { plan[c.id] = ROWS[best.aff[i]]; });
    return { plan: plan, verif: verifier(lignes, plan, cfg) };
  }

  // Plan sûr : si le premier calcul laisse une erreur de rangement, on recommence avec d'autres essais
  function noteVerif(v) {
    var e = v.erreurs.filter(function (m) { return !/^(Pas assez de colis|Trop de colis|Un seul colis)/.test(m); }).length;
    return e * 1000 + (v.ecart < -0.005 ? 100 + -v.ecart * 10 : 0) + Math.abs(v.ecart);
  }
  function meilleur(lignes, cfg, essaisMax) {
    var best = null, n = essaisMax || 8;
    for (var g = 0; g < n; g++) {
      var res = proposer(lignes, cfg, false, g), note = noteVerif(res.verif);
      if (!best || note < best.note) best = { plan: res.plan, verif: res.verif, note: note };
      if (note < 1000 && res.verif.ecart >= -0.005 && res.verif.ecart <= (Object.assign({}, DEFAUT, cfg || {})).ecartMax + 0.005) break;
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
  function autre(lignes, cfg, dejaVus, graine) {
    cfg = Object.assign({}, DEFAUT, cfg || {});
    var vus = {}; (dejaVus || []).forEach(function (x) { vus[x] = 1; });
    var ref = meilleur(lignes, cfg), refOk = noteVerif(ref.verif) < 1000;
    var seuil = Math.max(cfg.ecartMax, deseq(ref.verif)) + 0.005;
    var g0 = graine || 1, t0 = Date.now();
    for (var g = g0; g < g0 + 30 && Date.now() - t0 < 2500; g++) {
      var res = proposer(lignes, cfg, false, 1000 + g, 4 + (g % 4) * 3), v = res.verif;
      if (refOk && noteVerif(v) >= 1000) continue;
      if (deseq(v) > seuil) continue;
      var sig = signature(lignes, res.plan);
      if (vus[sig]) continue;
      return { plan: res.plan, verif: v, signature: sig, graine: g + 1 };
    }
    return null;
  }

  function deseq(v) {
    var m = 0;
    [1, 2, 3].forEach(function (f) { m = Math.max(m, Math.abs(v.rows['G' + f].vol - v.rows['D' + f].vol)); });
    m = Math.max(m, Math.abs(v.ecart));
    if (v.ecart < -0.005) m += 100;
    return m;
  }

  function f2(x) { return (Math.round(x * 100) / 100).toFixed(2).replace('.', ','); }
  var COTE = ['gauche', 'droite'];

  // Vérifie un plan (calculé ou modifié à la main). Messages en français.
  function verifier(lignes, plan, cfg) {
    cfg = Object.assign({}, DEFAUT, cfg || {});
    var colis = colisDe(lignes);
    var rows = {}; ROWS.forEach(function (k) { rows[k] = { colis: [], len: 0, vol: 0 }; });
    var nonPlaces = [];
    colis.forEach(function (c) {
      var k = plan && plan[c.id];
      if (k && rows[k]) { rows[k].colis.push(c); rows[k].len += c.cm; rows[k].vol += c.vol; }
      else nonPlaces.push(c);
    });
    ROWS.forEach(function (k) { rows[k].m = rows[k].len / 100; rows[k].alerte = false; });
    var erreurs = [], avis = [];
    var mn = Math.round(cfg.e1Min * 100), mx = Math.round(cfg.e1Max * 100);
    if (nonPlaces.length) erreurs.push(nonPlaces.length + (nonPlaces.length > 1 ? ' colis non placés.' : ' colis non placé.'));
    [0, 1].forEach(function (s) {
      var p = s === 0 ? 'G' : 'D', r1 = rows[p + '1'], r2 = rows[p + '2'], r3 = rows[p + '3'];
      if (r1.len < mn || r1.len > mx) {
        r1.alerte = true;
        erreurs.push('Étage 1 ' + COTE[s] + ' : ' + f2(r1.m) + ' m, il faut entre ' + f2(cfg.e1Min) + ' et ' + f2(cfg.e1Max) + ' m.');
      }
      if (r2.len > r1.len) { r2.alerte = true; erreurs.push('Étage 2 ' + COTE[s] + ' : ' + f2(r2.m) + ' m, plus long que l\'étage 1 (' + f2(r1.m) + ' m).'); }
      else if (r2.len > mx) { r2.alerte = true; erreurs.push('Étage 2 ' + COTE[s] + ' : ' + f2(r2.m) + ' m, plus de ' + f2(cfg.e1Max) + ' m.'); }
      if (r3.len > r2.len) { r3.alerte = true; erreurs.push('Étage 3 ' + COTE[s] + ' : ' + f2(r3.m) + ' m, plus long que l\'étage 2 (' + f2(r2.m) + ' m).'); }
    });
    // étage 3 avec le centre : doit tenir sur les deux piles de l'étage 2
    var E3 = Math.max(rows.G3.len, rows.D3.len) + rows.C3.len, sup3 = Math.min(rows.G2.len, rows.D2.len);
    if (rows.C3.colis.length && E3 > sup3) { rows.C3.alerte = rows.G3.alerte = rows.D3.alerte = true; erreurs.push('Étage 3 : ' + f2(E3 / 100) + ' m avec le colis du centre, plus long que l\'étage 2 (' + f2(sup3 / 100) + ' m).'); }
    var volG = rows.G1.vol + rows.G2.vol + rows.G3.vol + rows.C3.vol / 2, volD = rows.D1.vol + rows.D2.vol + rows.D3.vol + rows.C3.vol / 2;
    var ecart = volG - volD, tol = 0.005;
    if (ecart < -tol) avis.push('Côté passager (droite) plus chargé de ' + f2(-ecart) + ' m³ : le côté conducteur doit être le plus lourd.');
    else if (ecart > cfg.ecartMax + tol) avis.push('Écart gauche/droite de ' + f2(ecart) + ' m³ (max conseillé ' + f2(cfg.ecartMax) + ' m³).');
    [1, 2].forEach(function (f) {
      var d = rows['G' + f].vol - rows['D' + f].vol;
      if (Math.abs(d) > cfg.ecartMax + tol) avis.push('Étage ' + f + ' déséquilibré de ' + f2(Math.abs(d)) + ' m³ (plus lourd à ' + (d > 0 ? 'gauche' : 'droite') + '). L\'écart devrait être à l\'étage 3.');
    });
    var d3 = rows.G3.vol - rows.D3.vol;
    if (Math.abs(d3) > cfg.ecartMax + tol) avis.push('Étage 3 déséquilibré de ' + f2(Math.abs(d3)) + ' m³ (plus lourd à ' + (d3 > 0 ? 'gauche' : 'droite') + ').');
    if (d3 < -tol && ecart >= -tol) avis.push('Étage 3 : la droite est plus chargée que la gauche de ' + f2(-d3) + ' m³.');

    // Conseils quand c'est impossible
    var totCm = colis.reduce(function (a, c) { return a + c.cm; }, 0);
    if (colis.length && totCm < 2 * mn) erreurs.push('Pas assez de colis pour faire ' + f2(cfg.e1Min) + ' m à l\'étage 1 des deux côtés : il manque ' + f2((2 * mn - totCm) / 100) + ' m de longueur.');
    if (totCm > 6 * mx) erreurs.push('Trop de colis : ' + f2(totCm / 100) + ' m bout à bout, le camion en prend au plus ' + f2(6 * cfg.e1Max) + ' m.');
    if (colis.length === 1) erreurs.push('Un seul colis : impossible de remplir l\'étage 1 des deux côtés.');

    var total = volG + volD + nonPlaces.reduce(function (a, c) { return a + c.vol; }, 0);
    var et = etat(total, cfg);
    if (et.code === 'peu') avis.push('Volume : ' + f2(total) + ' m³, il manque ' + f2(et.manque) + ' m³ pour atteindre ' + f2(cfg.m3Min) + ' m³.');
    if (et.code === 'trop') avis.push('Volume : ' + f2(total) + ' m³, limite dépassée de ' + f2(et.depasse) + ' m³.');

    // doublons
    function uniq(a) { return a.filter(function (x, i) { return a.indexOf(x) === i; }); }
    erreurs = uniq(erreurs); avis = uniq(avis);
    return {
      rows: rows, nonPlaces: nonPlaces, erreurs: erreurs, avis: avis,
      volG: volG, volD: volD, ecart: ecart, total: total, etat: et, e3: E3 / 100, sup3: sup3 / 100,
      ok: erreurs.length === 0, parfait: erreurs.length === 0 && avis.length === 0
    };
  }

  var Plan = { SECTIONS: SECTIONS, trouverSection: trouverSection, lgPlan: lgPlan, ROWS: ROWS, DEFAUT: DEFAUT, num: num, volLigne: volLigne, volTotalLigne: volTotalLigne, totalM3: totalM3, etat: etat, colisDe: colisDe, proposer: proposer, meilleur: meilleur, noteVerif: noteVerif, deseq: deseq, autre: autre, signature: signature, verifier: verifier, f2: f2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = Plan;
  else root.Plan = Plan;
})(typeof window !== 'undefined' ? window : this);
