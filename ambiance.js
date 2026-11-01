/* Camions SDC — ambiance : fonds d'écran qui changent, effets de saison (feuilles, neige, pétales…)
   et événements (Bonne année, Noël…). Tout se règle dans reglages.fonds et reglages.ambiance. */
(function () {
  'use strict';
  var V = '69';
  var NB_INT = 9;
  var DEF_EVTS = [
    { id: 'an', emo: '🎊', nom: 'Bonne année', du: '01-01', au: '01-31', msg: 'Bonne année {annee} 🎊', effet: 'poussieres', extras: [] },
    { id: 'hiver', emo: '❄️', nom: 'Hiver', du: '02-01', au: '03-19', msg: '', effet: 'neige', extras: [] },
    { id: 'printemps', emo: '🌸', nom: 'Printemps', du: '03-20', au: '06-20', msg: '', effet: 'petales', extras: [] },
    { id: 'ete', emo: '✨', nom: 'Été', du: '06-21', au: '09-21', msg: '', effet: 'poussieres', extras: [] },
    { id: 'automne', emo: '🍂', nom: 'Automne', du: '09-22', au: '11-30', msg: '', effet: 'feuilles', extras: [] },
    { id: 'noel', emo: '🎄', nom: 'Noël', du: '12-01', au: '12-31', msg: 'Joyeuses fêtes 🎄', effet: 'neige', extras: [] }
  ];
  var PERIODES = { '30m': 1800e3, '1h': 3600e3, '2h': 7200e3, '4h': 14400e3 };
  function copie(x) { return JSON.parse(JSON.stringify(x)); }
  function defFonds() { var l = []; for (var i = 1; i <= NB_INT; i++) l.push({ id: 'f' + i }); return { liste: l, flou: 0, voile: 25, freq: '2h', ordre: 'hasard', fixe: null, ancre: null }; }
  function defAmb() { return { mode: 'auto', force: { effet: 'neige', extras: [] }, quantite: 2, msgAuto: true, evts: copie(DEF_EVTS) }; }
  // Réglages complets (avec les valeurs par défaut), sans modifier ceux de l'appli
  function cfg(r) {
    r = r || {};
    var f = Object.assign(defFonds(), r.fonds || {}), a = Object.assign(defAmb(), r.ambiance || {});
    if (!Array.isArray(f.liste)) f.liste = defFonds().liste;
    if (!Array.isArray(a.evts)) a.evts = copie(DEF_EVTS);
    return { fonds: f, ambiance: a };
  }
  // S'assure que reglages.fonds / reglages.ambiance existent (pour les modifier)
  function preparer(r) { var c = cfg(r); r.fonds = c.fonds; r.ambiance = c.ambiance; return r; }

  // ---------- Calendrier ----------
  function md(d) { return ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }
  function dedans(e, m) { return e.du <= e.au ? (m >= e.du && m <= e.au) : (m >= e.du || m <= e.au); }
  function duree(e) { var a = +e.du.slice(0, 2) * 31 + +e.du.slice(3), b = +e.au.slice(0, 2) * 31 + +e.au.slice(3); return b >= a ? b - a : b + 372 - a; }
  function evenement(r, d) {
    var a = cfg(r).ambiance, m = md(d || new Date()), best = null;
    a.evts.forEach(function (e) { if (e && e.du && e.au && dedans(e, m) && (!best || duree(e) <= duree(best))) best = e; }); // la période la plus courte gagne
    return best;
  }
  function message(r, d) {
    d = d || new Date();
    var e = evenement(r, d);
    return e && e.msg ? String(e.msg).replace(/\{annee\}/g, d.getFullYear()) : null;
  }
  function effetActuel(r) {
    var a = cfg(r).ambiance;
    if (a.mode === 'aucun') return { effet: 'aucun', extras: [] };
    if (a.mode === 'force') return { effet: a.force.effet || 'aucun', extras: a.force.extras || [] };
    var e = evenement(r);
    return e ? { effet: e.effet || 'aucun', extras: e.extras || [] } : { effet: 'aucun', extras: [] };
  }

  // ---------- Fonds d'écran ----------
  function hash(n) { n = (n ^ 61) ^ (n >>> 16); n = n + (n << 3); n = n ^ (n >>> 4); n = Math.imul(n, 0x27d4eb2d); return (n ^ (n >>> 15)) >>> 0; }
  var tirageOuverture = Math.random();
  function visibles(r) {
    var f = cfg(r).fonds, e = evenement(r), l = f.liste.filter(function (x) { return x && !x.masque; });
    if (e && Array.isArray(e.fonds) && e.fonds.length) { var s = l.filter(function (x) { return e.fonds.indexOf(x.id) >= 0; }); if (s.length) l = s; }
    return l;
  }
  // Image du moment : la même sur tous les téléphones (calculée avec l'heure)
  function imageActuelle(r, maint) {
    var f = cfg(r).fonds, l = visibles(r), n = l.length, t = maint || Date.now();
    if (!n) return { item: null, index: -1, prochaine: 0, n: 0 };
    var ids = l.map(function (x) { return x.id; });
    if (f.freq === 'fixe') { var i0 = Math.max(0, ids.indexOf(f.fixe)); return { item: l[i0], index: i0, prochaine: 0, n: n }; }
    if (f.freq === 'ouv') { var i1 = Math.floor(tirageOuverture * n); return { item: l[i1], index: i1, prochaine: 0, n: n }; }
    var P = PERIODES[f.freq] || PERIODES['2h'], an = f.ancre && ids.indexOf(f.ancre.id) >= 0 ? f.ancre : null, idx, proch;
    if (an && t >= an.t) {
      var k = Math.floor((t - an.t) / P); proch = an.t + (k + 1) * P;
      if (f.ordre === 'ordre' || k === 0) idx = (ids.indexOf(an.id) + (f.ordre === 'ordre' ? k : 0)) % n;
      else { idx = hash(Math.floor(t / P)) % n; }
    } else {
      var slot = Math.floor(t / P); proch = (slot + 1) * P;
      if (f.ordre === 'ordre') idx = slot % n;
      else { idx = hash(slot) % n; if (n > 1 && idx === hash(slot - 1) % n) idx = (idx + 1) % n; }
    }
    return { item: l[idx], index: idx, prochaine: proch, n: n };
  }
  var CEXT = 'csdc-fonds-ext', memo = {}, chargeur = null;
  function cleExt(id) { return location.origin + '/__fond-ext/' + encodeURIComponent(id); }
  function versBlobUrl(dataUrl) { return fetch(dataUrl).then(function (r) { return r.blob(); }); }
  function garderExt(id, dataUrl) {
    return versBlobUrl(dataUrl).then(function (b) {
      memo[id] = URL.createObjectURL(b);
      if (!window.caches) return memo[id];
      return caches.open(CEXT).then(function (c) { return c.put(cleExt(id), new Response(b, { headers: { 'Content-Type': b.type || 'image/jpeg' } })); }).then(function () { return memo[id]; }, function () { return memo[id]; });
    });
  }
  function urlDe(item) {
    if (!item) return Promise.resolve(null);
    if (!item.ext) return Promise.resolve('fond-' + item.id.slice(1) + '.jpg?v=' + V);
    if (memo[item.id]) return Promise.resolve(memo[item.id]);
    var lu = window.caches ? caches.open(CEXT).then(function (c) { return c.match(cleExt(item.id)); }).catch(function () { return null; }) : Promise.resolve(null);
    return lu.then(function (rep) {
      if (rep) return rep.blob().then(function (b) { memo[item.id] = URL.createObjectURL(b); return memo[item.id]; });
      if (!chargeur) return null;
      return chargeur(item.id).then(function (d) { return d ? garderExt(item.id, d) : null; });
    }).catch(function () { return null; });
  }
  function miniDe(item) { return item.ext ? (item.th || '') : 'mini-' + item.id.slice(1) + '.jpg?v=' + V; }

  var calques = null, actif = 0, urlAff = null, minFond = null, imgAff = null;
  function majFond(r) {
    if (!calques) { var z = document.getElementById('fondForet'); if (!z) return; calques = z.querySelectorAll('.ff-img'); }
    var f = cfg(r).fonds, im = imageActuelle(r), px = Math.round(f.flou * 1.6 * 10) / 10;
    var root = document.documentElement.style;
    root.setProperty('--fond-flou', px + 'px');
    root.setProperty('--fond-voile', String(Math.max(0, Math.min(90, f.voile)) / 100));
    var essai = im.item;
    urlDe(essai).then(function (u) {
      if (!u) { var de = visibles(r).filter(function (x) { return !x.ext; })[0]; return urlDe(de || { id: 'f1' }); }
      return u;
    }).then(function (u) {
      if (!u || u === urlAff) return;
      var img = new Image();
      img.onload = img.onerror = function () {
        var suivant = calques[1 - actif];
        suivant.style.backgroundImage = 'url("' + u + '")';
        suivant.classList.add('on'); calques[actif].classList.remove('on');
        actif = 1 - actif; urlAff = u; if (img.naturalWidth) imgAff = img;
      };
      img.src = u;
    });
    clearTimeout(minFond);
    if (im.prochaine) minFond = setTimeout(function () { majFond(r); }, Math.max(1000, Math.min(im.prochaine - Date.now() + 500, 3600e3)));
  }

  // ---------- Décor : sapins enneigés (derrière le contenu) ----------
  function sapin(x, w, h, c, neige) {
    var s = '', cxs = x + w / 2, i;
    s += '<rect x="' + (cxs - w * 0.05) + '" y="' + (120 - h * 0.1) + '" width="' + (w * 0.1) + '" height="' + (h * 0.1) + '" fill="#3a2a1c"/>';
    for (i = 0; i < 4; i++) {
      var t = i / 3, top = 120 - h + t * h * 0.55, bas = top + h * 0.38, demi = w / 2 * (0.35 + t * 0.65);
      s += '<path d="M' + cxs + ' ' + top + ' L' + (cxs - demi) + ' ' + bas + ' Q' + cxs + ' ' + (bas - h * 0.05) + ' ' + (cxs + demi) + ' ' + bas + 'Z" fill="' + c + '"/>';
      if (neige) s += '<path d="M' + cxs + ' ' + top + ' L' + (cxs - demi * 0.62) + ' ' + (top + h * 0.17) + ' Q' + (cxs - demi * 0.2) + ' ' + (top + h * 0.12) + ' ' + cxs + ' ' + (top + h * 0.2) + ' Q' + (cxs + demi * 0.25) + ' ' + (top + h * 0.13) + ' ' + (cxs + demi * 0.66) + ' ' + (top + h * 0.16) + 'Z" fill="#fff" opacity="' + (0.92 - t * 0.15) + '"/>';
    }
    return s;
  }
  function decor(extras) {
    var z = document.getElementById('decorZone'); if (!z) return;
    z.innerHTML = ''; z.dataset.k = ''; return; // sapins retirés (v53)
    if (z.dataset.k === 'sapins') return;
    var loin = '', pres = '', i;
    for (i = 0; i < 9; i++) loin += sapin(i * 44 - 14 + (i % 2) * 9, 46, 54 + (i * 37 % 23), '#5d7468', true);
    for (i = 0; i < 6; i++) pres += sapin(i * 72 - 20 + (i % 2) * 14, 70, 82 + (i * 29 % 30), '#20382c', true);
    z.innerHTML = '<svg viewBox="0 0 360 120" preserveAspectRatio="xMidYMax slice"><g opacity=".55" style="filter:blur(1px)">' + loin + '</g>' + pres +
      '<path d="M0 116 Q90 108 180 114 T360 112 V120 H0Z" fill="#f4f7f8"/></svg>';
    z.dataset.k = 'sapins';
  }

  // ---------- Feuilles (sprites) ----------
  function feuilles(on, q) {
    var z = document.getElementById('feuillesZone'); if (!z) return;
    if (!on) { z.innerHTML = ''; return; }
    var n = Math.round(11 * q), h = '';
    for (var i = 0; i < n; i++) {
      var prof = Math.random(), taille = Math.round(16 + prof * 26), d = (14 - prof * 5 + Math.random() * 6).toFixed(1);
      var flou = prof > 0.86 ? 2.2 : (prof < 0.2 ? 0.8 : 0);
      h += '<i class="fe' + (i >= n / 2 ? ' fe-plus' : '') + '" style="left:' + (Math.random() * 96).toFixed(1) + '%;--d:' + d + 's;--r:' + (-Math.random() * d).toFixed(1) + 's;--b:' + (2 + Math.random() * 3).toFixed(1) + 's;--x:' + Math.round(20 + Math.random() * 50) + 'px">' +
        '<i style="width:' + taille + 'px;height:' + taille + 'px;background-size:' + taille * 10 + 'px ' + taille + 'px;background-position:' + (-(i % 10) * taille) + 'px 0;filter:blur(' + flou + 'px) drop-shadow(0 ' + Math.round(2 + prof * 5) + 'px ' + Math.round(3 + prof * 6) + 'px rgba(40,20,0,.22))"></i></i>';
    }
    z.innerHTML = h;
  }

  // ---------- Particules dessinées (neige, pétales, poussières, confettis, étoiles, feux d'artifice) ----------
  var cv = null, cx = null, W = 0, H = 0, dpr = 1, parts = [], etoiles = [], feux = [], raf = 0, tPrec = 0, conf = null, prochainFeu = 0;
  var COUL_CONF = ['#E8B931', '#D9534F', '#3B9C6E', '#4A8FE0', '#E07BB5', '#F4F1EA', '#F08C3A'];
  function sprite(r, stops) {
    var c = document.createElement('canvas'), s = Math.ceil(r * 2); c.width = c.height = s;
    var g = c.getContext('2d'), gr = g.createRadialGradient(r, r, 0, r, r, r);
    stops.forEach(function (x) { gr.addColorStop(x[0], x[1]); });
    g.fillStyle = gr; g.fillRect(0, 0, s, s); return c;
  }
  var SP = null;
  function sprites() {
    if (SP) return SP;
    SP = {
      flocon: sprite(32, [[0, 'rgba(255,255,255,1)'], [0.45, 'rgba(255,255,255,.95)'], [0.7, 'rgba(225,232,238,.55)'], [0.85, 'rgba(170,182,195,.18)'], [1, 'rgba(255,255,255,0)']]),
      floconFlou: sprite(32, [[0, 'rgba(255,255,255,.75)'], [0.5, 'rgba(255,255,255,.35)'], [1, 'rgba(255,255,255,0)']]),
      or: sprite(16, [[0, 'rgba(255,246,210,1)'], [0.25, 'rgba(255,214,120,.85)'], [0.6, 'rgba(240,180,60,.25)'], [1, 'rgba(240,180,60,0)']]),
      feu: sprite(8, [[0, 'rgba(255,255,255,1)'], [0.4, 'rgba(255,255,255,.6)'], [1, 'rgba(255,255,255,0)']])
    };
    return SP;
  }
  function taille() {
    dpr = Math.min(2, window.devicePixelRatio || 1); W = window.innerWidth; H = window.innerHeight;
    if (cv) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); cx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  }
  function nouvelle(type, debut) {
    var z = Math.random(), p = { z: z, x: Math.random() * W, y: debut ? Math.random() * H : -30 - Math.random() * 40, ph: Math.random() * 6.28, rot: Math.random() * 6.28 };
    if (type === 'neige') { p.r = 0.9 + z * z * 4.6; p.vy = 22 + z * 70; p.am = 8 + z * 26; p.f = 0.4 + Math.random() * 0.8; p.a = 0.55 + z * 0.45; p.flou = z > 0.9; if (p.flou) p.r *= 1.9; }
    if (type === 'petales') { p.r = 6 + z * 8; p.vy = 26 + z * 34; p.am = 26 + z * 40; p.f = 0.5 + Math.random() * 0.6; p.vr = (Math.random() - 0.5) * 2.4; p.vf = 1.2 + Math.random() * 2; p.c = Math.random() < 0.5 ? ['#FBD3DE', '#F2A2B8'] : ['#FFE4EC', '#F7B7C8']; }
    if (type === 'poussieres') { p.r = 2 + z * 4.5; p.vy = -4 - Math.random() * 10; p.vx = (Math.random() - 0.5) * 14; p.f = 0.6 + Math.random() * 1.6; p.a = 0.35 + z * 0.55; if (!debut) p.y = H + 20; }
    if (type === 'confettis') { p.w = 6 + z * 6; p.h = 3 + z * 3; p.vy = 55 + z * 80; p.am = 14 + z * 24; p.f = 0.8 + Math.random() * 1.2; p.vr = (Math.random() - 0.5) * 6; p.vf = 4 + Math.random() * 6; p.c = COUL_CONF[Math.floor(Math.random() * COUL_CONF.length)]; }
    return p;
  }
  function boucle(t) {
    raf = requestAnimationFrame(boucle);
    var dt = Math.min(0.05, (t - (tPrec || t)) / 1000); tPrec = t;
    if (!cx || !conf) return;
    cx.clearRect(0, 0, W, H);
    var s = sprites(), type = conf.effet, acc = document.body.dataset.vue === 'accueil', i, p;
    // étoiles dorées qui scintillent
    if (etoiles.length) {
      cx.globalCompositeOperation = 'lighter';
      etoiles.forEach(function (e) { var a = 0.25 + 0.75 * Math.pow(Math.max(0, Math.sin(t / 1000 * e.f + e.ph)), 3); cx.globalAlpha = a * (acc ? 1 : 0.5); var r = e.r * (0.8 + a * 0.4); cx.drawImage(s.or, e.x - r * 2, e.y - r * 2, r * 4, r * 4); });
      cx.globalCompositeOperation = 'source-over'; cx.globalAlpha = 1;
    }
    for (i = 0; i < parts.length; i++) {
      p = parts[i];
      if (!acc && i % 2) continue; // moins chargé sur les autres pages
      if (type === 'poussieres') {
        p.x += (p.vx + Math.sin(t / 1000 * p.f + p.ph) * 8) * dt; p.y += p.vy * dt;
        if (p.y < -20 || p.x < -20 || p.x > W + 20) parts[i] = nouvelle(type, false);
        cx.globalCompositeOperation = 'lighter'; cx.globalAlpha = p.a * (0.5 + 0.5 * Math.sin(t / 700 * p.f + p.ph));
        cx.drawImage(s.or, p.x - p.r * 2, p.y - p.r * 2, p.r * 4, p.r * 4);
        cx.globalCompositeOperation = 'source-over'; continue;
      }
      p.y += p.vy * dt;
      var x = p.x + Math.sin(t / 1000 * p.f + p.ph) * p.am;
      if (p.y > H + 30) { parts[i] = nouvelle(type, false); continue; }
      if (type === 'neige') {
        cx.globalAlpha = p.a; var im = p.flou ? s.floconFlou : s.flocon;
        cx.drawImage(im, x - p.r, p.y - p.r, p.r * 2, p.r * 2);
      } else if (type === 'petales') {
        p.rot += p.vr * dt; var fl = Math.cos(t / 1000 * p.vf + p.ph);
        cx.save(); cx.translate(x, p.y); cx.rotate(p.rot); cx.scale(1, 0.35 + 0.65 * Math.abs(fl)); cx.globalAlpha = 0.92;
        var g = cx.createLinearGradient(0, -p.r, 0, p.r); g.addColorStop(0, fl > 0 ? p.c[0] : p.c[1]); g.addColorStop(1, fl > 0 ? p.c[1] : p.c[0]);
        cx.fillStyle = g; cx.beginPath(); cx.moveTo(0, -p.r);
        cx.bezierCurveTo(p.r * 0.9, -p.r * 0.6, p.r * 0.75, p.r * 0.7, 0, p.r); cx.bezierCurveTo(-p.r * 0.75, p.r * 0.7, -p.r * 0.9, -p.r * 0.6, 0, -p.r);
        cx.fill(); cx.restore();
      } else if (type === 'confettis') {
        p.rot += p.vr * dt; var fc = Math.cos(t / 1000 * p.vf + p.ph);
        cx.save(); cx.translate(x, p.y); cx.rotate(p.rot); cx.scale(1, fc); cx.globalAlpha = 0.95;
        cx.fillStyle = p.c; cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        if (Math.abs(fc) < 0.4) { cx.fillStyle = 'rgba(255,255,255,.35)'; cx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); }
        cx.restore();
      }
    }
    cx.globalAlpha = 1;
    // feux d'artifice (sur l'accueil)
    if (conf.feux && acc) {
      if (t > prochainFeu) {
        prochainFeu = t + 2200 + Math.random() * 2600;
        var fx = W * (0.15 + Math.random() * 0.7), fy = H * (0.12 + Math.random() * 0.25), col = COUL_CONF[Math.floor(Math.random() * 6)], n = 46;
        for (i = 0; i < n; i++) { var an = (i / n) * 6.283 + Math.random() * 0.1, v = 70 + Math.random() * 90; feux.push({ x: fx, y: fy, vx: Math.cos(an) * v, vy: Math.sin(an) * v, v: 1, c: col }); }
      }
      cx.globalCompositeOperation = 'lighter';
      feux = feux.filter(function (f) {
        f.vy += 60 * dt; f.vx *= 0.985; f.vy *= 0.985; f.x += f.vx * dt; f.y += f.vy * dt; f.v -= dt / 1.6;
        if (f.v <= 0) return false;
        cx.globalAlpha = f.v; cx.fillStyle = f.c; cx.beginPath(); cx.arc(f.x, f.y, 1.6, 0, 6.283); cx.fill();
        cx.drawImage(s.feu, f.x - 4, f.y - 4, 8, 8); return true;
      });
      cx.globalCompositeOperation = 'source-over'; cx.globalAlpha = 1;
    }
  }
  function arreter() { if (raf) cancelAnimationFrame(raf); raf = 0; tPrec = 0; if (cx) cx.clearRect(0, 0, W, H); }
  function particules(effet, extras, q) {
    var dessin = ['neige', 'petales', 'poussieres', 'confettis'].indexOf(effet) >= 0, et = extras.indexOf('etoiles') >= 0, fe = extras.indexOf('feux') >= 0;
    if (!dessin && !et && !fe) { conf = null; arreter(); if (cv) cv.style.display = 'none'; return; }
    if (!cv) {
      cv = document.createElement('canvas'); cv.id = 'effetZone'; cv.setAttribute('aria-hidden', 'true');
      document.body.appendChild(cv); cx = cv.getContext('2d'); taille();
      window.addEventListener('resize', taille);
      document.addEventListener('visibilitychange', function () { if (document.hidden) arreter(); else if (conf && !raf) raf = requestAnimationFrame(boucle); });
    }
    cv.style.display = '';
    var base = { neige: 90, petales: 24, poussieres: 46, confettis: 70 }[effet] || 0;
    parts = []; for (var i = 0; i < Math.round(base * q); i++) parts.push(nouvelle(effet, true));
    etoiles = []; if (et) for (i = 0; i < Math.round(22 * q); i++) etoiles.push({ x: Math.random() * W, y: Math.random() * H * 0.45, r: 2 + Math.random() * 3, f: 0.6 + Math.random() * 1.4, ph: Math.random() * 6.28 });
    feux = []; prochainFeu = 0;
    conf = { effet: dessin ? effet : 'aucun', feux: fe };
    if (!raf && !document.hidden) raf = requestAnimationFrame(boucle);
  }

  var cleEffet = '';
  function appliquer(r, forcer) {
    majFond(r);
    var a = cfg(r).ambiance, e = effetActuel(r), q = [0.55, 1, 1.7][Math.max(0, Math.min(2, (a.quantite || 2) - 1))];
    var calme = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (calme) e = { effet: 'aucun', extras: e.extras.filter(function (x) { return x === 'sapins'; }) };
    var k = e.effet + '|' + e.extras.slice().sort().join(',') + '|' + q;
    decor(e.extras);
    if (k === cleEffet && !forcer) return;
    cleEffet = k;
    feuilles(e.effet === 'feuilles', q);
    particules(e.effet, e.extras, q);
  }

  window.Ambiance = {
    cfg: cfg, preparer: preparer, defEvts: function () { return copie(DEF_EVTS); }, defFonds: defFonds, NB_INT: NB_INT,
    evenement: evenement, message: message, effetActuel: effetActuel, imageActuelle: imageActuelle, visibles: visibles,
    appliquer: appliquer, majFond: majFond, imageAffichee: function () { return imgAff; }, urlDe: urlDe, miniDe: miniDe, garderExt: garderExt,
    chargeur: function (fn) { chargeur = fn; }
  };
})();
