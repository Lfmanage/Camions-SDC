/* Camions SDC — calculs de volume et plan de chargement équilibré.
   Fonctionne dans le navigateur (window.Plan) et dans Node (module.exports). */
(function (root) {
  'use strict';

  // 6 rangées : index 0..2 = gauche (conducteur) étages 1..3, 3..5 = droite (passager) étages 1..3
  var ROWS = ['G1', 'G2', 'G3', 'D1', 'D2', 'D3'];
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

  // Une ligne avec nb colis -> nb colis séparés (id "ligneId#k")
  function colisDe(lignes) {
    var out = [];
    lignes.forEach(function (l) {
      var n = Math.max(1, Math.round(num(l.nb) || 1));
      for (var k = 0; k < n; k++) {
        out.push({
          id: l.id + '#' + k, ligneId: l.id,
          ep: num(l.ep), la: num(l.la), pi: num(l.pi), lo: num(l.lo),
          cm: Math.round(num(l.lo) * 100), vol: volLigne(l), aire: num(l.ep) * num(l.la)
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

  // Coût d'un plan à partir des totaux des 6 rangées (longueurs en cm, volumes en m³)
  function cout(len, vol, pref, cfg) {
    var c = 0, mn = Math.round(cfg.e1Min * 100), mx = Math.round(cfg.e1Max * 100);
    for (var s = 0; s < 2; s++) {
      var b = s * 3, l1 = len[b], l2 = len[b + 1], l3 = len[b + 2];
      if (l1 < mn) { var d0 = mn - l1; c += 10 * d0 + d0 * d0 / 40 + 100; }
      if (l1 > mx) { var d1 = l1 - mx; c += 10 * d1 + d1 * d1 / 40 + 100; }
      if (l2 > l1) { var d2 = l2 - l1; c += 10 * d2 + d2 * d2 / 40 + 100; }
      if (l3 > l2) { var d3 = l3 - l2; c += 10 * d3 + d3 * d3 / 40 + 100; }
      if (l2 > mx) c += 10 * (l2 - mx);
      if (l3 > mx) c += 10 * (l3 - mx);
    }
    var d1 = vol[0] - vol[3], d2 = vol[1] - vol[4], d3 = vol[2] - vol[5], D = d1 + d2 + d3;
    c += 10 * (Math.abs(d1) + Math.abs(d2));
    c += d3 < 0 ? -40 * d3 : 6 * d3;
    c += D < 0 ? -80 * D : 2 * D;
    // longueurs semblables à gauche et à droite, étage par étage (camion visuellement équilibré)
    c += 0.02 * (Math.abs(len[0] - len[3]) + Math.abs(len[1] - len[4]) + Math.abs(len[2] - len[5]));
    c += pref * 1e-7; // préférence : grosses sections en bas
    return c;
  }

  function agreger(colis, aff) {
    var len = [0, 0, 0, 0, 0, 0], vol = [0, 0, 0, 0, 0, 0], pref = 0;
    for (var i = 0; i < colis.length; i++) {
      var r = aff[i];
      len[r] += colis[i].cm; vol[r] += colis[i].vol; pref += colis[i].aire * (r % 3);
    }
    return { len: len, vol: vol, pref: pref };
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
    var len = [0, 0, 0, 0, 0, 0], aff = new Array(colis.length);
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

  function optimiser(colis, cfg, aff, r, iters) {
    var n = colis.length;
    var a = agreger(colis, aff), len = a.len, vol = a.vol, pref = a.pref;
    var cur = cout(len, vol, pref, cfg), best = cur, bestAff = aff.slice();
    var T0 = 30, T1 = 0.01;
    for (var it = 0; it < iters; it++) {
      var T = T0 * Math.pow(T1 / T0, it / iters);
      var i = Math.floor(r() * n), ri = aff[i], ci = colis[i];
      if (r() < 0.5 || n < 2) {
        var to = Math.floor(r() * 5); if (to >= ri) to++;
        len[ri] -= ci.cm; vol[ri] -= ci.vol; len[to] += ci.cm; vol[to] += ci.vol;
        var p2 = pref + ci.aire * ((to % 3) - (ri % 3));
        var c2 = cout(len, vol, p2, cfg);
        if (c2 <= cur || r() < Math.exp((cur - c2) / T)) { aff[i] = to; cur = c2; pref = p2; }
        else { len[to] -= ci.cm; vol[to] -= ci.vol; len[ri] += ci.cm; vol[ri] += ci.vol; }
      } else {
        var j = Math.floor(r() * n), rj = aff[j];
        if (rj === ri) continue;
        var cj = colis[j];
        len[ri] += cj.cm - ci.cm; vol[ri] += cj.vol - ci.vol;
        len[rj] += ci.cm - cj.cm; vol[rj] += ci.vol - cj.vol;
        var p3 = pref + (ci.aire - cj.aire) * ((rj % 3) - (ri % 3));
        var c3 = cout(len, vol, p3, cfg);
        if (c3 <= cur || r() < Math.exp((cur - c3) / T)) { aff[i] = rj; aff[j] = ri; cur = c3; pref = p3; }
        else { len[ri] -= cj.cm - ci.cm; vol[ri] -= cj.vol - ci.vol; len[rj] -= ci.cm - cj.cm; vol[rj] -= ci.vol - cj.vol; }
      }
      if (cur < best - 1e-12) { best = cur; bestAff = aff.slice(); }
    }
    return { aff: bestAff, cout: best };
  }

  // Calcule un plan. Renvoie { plan: {colisId: 'G1'...}, verif }
  function proposer(lignes, cfg, rapide, graine) {
    cfg = Object.assign({}, DEFAUT, cfg || {});
    var colis = colisDe(lignes).filter(function (c) { return c.cm > 0 && c.vol > 0; });
    var plan = {};
    if (!colis.length) return { plan: plan, verif: verifier(lignes, plan, cfg) };
    var r = rng(colis.length * 7919 + 17 + (graine || 0) * 104729);
    var iters = Math.min(120000, 4000 + colis.length * 3000);
    if (rapide) iters = Math.round(iters / 3);
    var essais = [depart(colis, cfg, null)];
    for (var e = 0; e < (rapide ? 1 : 5); e++) essais.push(depart(colis, cfg, r));
    var best = null;
    essais.forEach(function (aff) {
      var res = optimiser(colis, cfg, aff, r, iters);
      if (!best || res.cout < best.cout) best = res;
    });
    // finition : descente stricte depuis le meilleur
    var fin = optimiser(colis, cfg, best.aff.slice(), r, iters);
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
    var volG = rows.G1.vol + rows.G2.vol + rows.G3.vol, volD = rows.D1.vol + rows.D2.vol + rows.D3.vol;
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
      volG: volG, volD: volD, ecart: ecart, total: total, etat: et,
      ok: erreurs.length === 0, parfait: erreurs.length === 0 && avis.length === 0
    };
  }

  var Plan = { ROWS: ROWS, DEFAUT: DEFAUT, num: num, volLigne: volLigne, volTotalLigne: volTotalLigne, totalM3: totalM3, etat: etat, colisDe: colisDe, proposer: proposer, meilleur: meilleur, noteVerif: noteVerif, deseq: deseq, verifier: verifier, f2: f2 };
  if (typeof module !== 'undefined' && module.exports) module.exports = Plan;
  else root.Plan = Plan;
})(typeof window !== 'undefined' ? window : this);
