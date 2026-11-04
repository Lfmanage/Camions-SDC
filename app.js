/* Camions SDC — application */
(function () {
  'use strict';
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (e) { document.addEventListener(e, function (x) { x.preventDefault(); }, { passive: false }); });
  document.addEventListener('touchmove', function (x) { if (x.touches && x.touches.length > 1) x.preventDefault(); }, { passive: false });
  var dtap = 0; document.addEventListener('touchend', function (x) { var n = Date.now(); if (n - dtap < 350 && !/INPUT|TEXTAREA|SELECT/.test((x.target.tagName || '')) && !(x.target.closest && x.target.closest('button,a,label,[data-t]'))) x.preventDefault(); dtap = n; }, { passive: false });
  var P = window.Plan;
  var VERSION_APP = '83';
  var CLE = 'csdc.donnees';
  var REG_DEF = { m3Min: 39, m3Max: 41, e1Min: 12, e1Max: 13, ecartMax: 1, longueurs: [3, 4, 5.5], theme: 'auto', couleurs: {} };
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) { return Array.prototype.slice.call((el || document).querySelectorAll(s)); };
  var f2 = P.f2;
  function f3(x) { return (Math.round(x * 1000) / 1000).toFixed(3).replace('.', ','); }
  function fm(x) { return String(Math.round(x * 100) / 100).replace('.', ','); }             // 4 / 5,5
  function fLong(x) { return (Math.round(x * 100) / 100).toFixed(2).replace('.', ','); }     // 4,00
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function maintenant() { return new Date().toISOString(); }
  function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }
  function petitId() { return Math.random().toString(36).slice(2, 8); }

  // ---------- Données ----------
  function copieSections() { return P.SECTIONS.map(function (x) { var o = { ep: x.ep, la: x.la, pi: x.pi }; if (x.lg) o.lg = x.lg.slice(); return o; }); }
  function charger() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem(CLE)); } catch (e) { d = null; }
    d = d || {};
    d.camions = d.camions || {};
    d.reglages = Object.assign({}, REG_DEF, d.reglages || {});
    d.reglages.couleurs = d.reglages.couleurs || {};
    if (!Array.isArray(d.reglages.sections)) d.reglages.sections = copieSections();
    // nouvelles sections ajoutées une seule fois (on ne remet pas une section supprimée à la main)
    d.reglages.ajouts = d.reglages.ajouts || [];
    ['15x200', '15x150', '25x200'].forEach(function (cle) {
      if (d.reglages.ajouts.indexOf(cle) >= 0) return;
      var m = cle.split('x').map(Number), sc = P.trouverSection(null, m[0], m[1]);
      if (sc && !P.trouverSection(d.reglages.sections, m[0], m[1])) { var o = { ep: sc.ep, la: sc.la, pi: sc.pi }; if (sc.lg) o.lg = sc.lg.slice(); d.reglages.sections.push(o); }
      d.reglages.ajouts.push(cle);
    });
    d.clients = d.clients || [];
    // ménage : un camion supprimé et déjà envoyé (ou qui n'a jamais quitté ce téléphone) est effacé pour de bon
    var horsEquipe = true; try { horsEquipe = !(JSON.parse(localStorage.getItem('csdc.equipe') || '{}') || {}).equipe; } catch (e) {}
    Object.keys(d.camions).forEach(function (k) {
      var c = d.camions[k];
      if (c.supprime && (!c._sale || horsEquipe)) { delete d.camions[k]; return; }
      if (c.statut === 'termine' && c.plansVus) delete c.plansVus; // les anciens « Autre plan » ne servent plus (le plan de départ reste)
    });
    if (d.courant && !d.camions[d.courant]) d.courant = null;
    d.sync = d.sync || {};
    return d;
  }
  var MODE_FICHE = /^#f=/.test(location.hash || '');
  var db = charger();
  function sauver(sansSynchro) {
    if (MODE_FICHE) return;
    try { localStorage.setItem(CLE, JSON.stringify(db)); }
    catch (e) { toast('Mémoire du téléphone pleine : exporte une sauvegarde.'); }
    if (!sansSynchro && window.Sync && Sync.actif()) Sync.bientot();
  }
  function reg() { return db.reglages; }
  var TOL_EXACT = 0.25;
  // Réglages appliqués à un camion : longueur de chargement et volume choisis à l'étape 1
  function cfgC(c) {
    var r = Object.assign({}, db.reglages);
    if (c && c.lgMax) { r.e1Max = c.lgMax; r.e1Min = Math.max(1, c.lgMax - (db.reglages.e1Max - db.reglages.e1Min)); }
    if (c && c.double && c.double.lg) { r.e1Max = c.double.lg[0] + c.double.lg[1]; r.e1Min = Math.max(1, r.e1Max - (db.reglages.e1Max - db.reglages.e1Min)); }
    if (c && c.parentId) { var pp = db.camions[c.parentId], rp = pp ? cfgC(pp) : r; r.m3Min = 0; r.m3Max = 1e6; r.cible = rp.cible; if (c.relax) r.relax = true; return r; }
    if (c && c.volMode === 'exact' && c.volExact > 0) { r.m3Min = c.volExact - TOL_EXACT; r.m3Max = c.volExact + TOL_EXACT; r.cible = c.volExact; }
    else r.cible = r.m3Max;
    return r;
  }

  function nouveauCamion(base) {
    var c = { id: uid(), client: '', reference: '', cree_le: maintenant(), termine_le: null, statut: 'en_cours', lignes: [], plan: null, planManuel: false, total_m3: 0, etat: 'peu', maj_le: maintenant(), supprime: false };
    if (base) Object.assign(c, base);
    if (enEquipe()) { c.auteur = Sync.moi().uid; c.auteur_prenom = Sync.moi().prenom; } else { delete c.auteur; delete c.auteur_prenom; }
    db.camions[c.id] = c; db.courant = c.id;
    return c;
  }
  var edition = null; // camion de l'historique ouvert dans le plan
  // Double remorque : dans le plan, le camion « courant » est la remorque affichée
  function courant() {
    var c = courantBase();
    if (c.double && (vueActive === 'plan' || vueActive === 'ajout')) { var s = remDe(c); if (s) return s; }
    return c;
  }
  function remDe(p) {
    if (!p.double || !p.double.r) return null;
    var s = p.double.r[p.double.actif || 0]; if (!s) return null;
    if (p.auteur) { s.auteur = p.auteur; s.auteur_prenom = p.auteur_prenom; } else { delete s.auteur; delete s.auteur_prenom; }
    s.parentId = p.id; s.client = p.client; s.reference = p.reference; s.termine_le = p.termine_le; s.maj_le = p.maj_le; s.statut = p.statut; return s;
  }
  function sigLignes(l) { return l.map(function (x) { return x.id + ':' + (x.nb || 1) + ':' + x.ep + 'x' + x.la + 'x' + x.lo + 'x' + x.pi; }).sort().join('|'); }
  function unionLignes(p) {
    var m = {}, out = [];
    p.double.r.forEach(function (s) { s.lignes.forEach(function (l) { if (m[l.id]) m[l.id].nb = (m[l.id].nb || 1) + (l.nb || 1); else { m[l.id] = Object.assign({}, l, { nb: l.nb || 1 }); out.push(m[l.id]); } }); });
    var pos = {}; p.lignes.forEach(function (l, i) { pos[l.id] = i; });
    out.sort(function (a, b) { return (pos[a.id] != null ? pos[a.id] : 1e6) - (pos[b.id] != null ? pos[b.id] : 1e6); });
    return out;
  }
  function besoinSplit(p) { return p.double && p.lignes.length && (!p.double.r || p.double.sig !== sigLignes(p.lignes) || p.double.algo !== 2); }
  function splitDouble(p) {
    var res = P.partager(p.lignes, p.double.lg, Object.assign({}, db.reglages), p.double.graine || 0);
    p.double.r = res.map(function (x, i) {
      return { id: p.id + '~' + i, parentId: p.id, rem: i, lgMax: p.double.lg[i], lignes: x.lignes, plan: x.plan, ordre: null, decal: null,
        planDepart: { plan: JSON.parse(JSON.stringify(x.plan)), note: x.note }, planCalcule: true, planManuel: false, planVariante: false, plansVus: null, graineAutre: 1,
        total_m3: Math.round(P.totalM3(x.lignes) * 1000) / 1000, relax: !!x.relax };
    });
    p.double.actif = 0; p.double.sig = sigLignes(p.lignes); p.double.algo = 2;
  }
  function courantBase() {
    if (edition && db.camions[edition] && !db.camions[edition].supprime) return db.camions[edition];
    var c = db.camions[db.courant];
    if (!c || c.supprime || c.statut !== 'en_cours' || !estAMoi(c)) { c = nouveauCamion(); sauver(true); }
    return c;
  }
  // Les colis ont changé : le plan sera recalculé (le meilleur possible) à l'ouverture du plan
  function majPlan(c) {
    c.plan = null; c.planDepart = null; c.planCalcule = false; c.ordre = null; c.decal = null;
    c.planManuel = false; c.planVariante = false; c.plansVus = null; c.graineAutre = 1;
  }
  // Cherche le meilleur plan (jusqu'à ~2 s) ; il devient le « plan de départ »
  function calculerPlan(c) {
    if (c.double) { if (besoinSplit(c)) splitDouble(c); return; }
    if (!c.lignes.length) { majPlan(c); return; }
    var cf = cfgC(c); delete cf.relax;
    var res = P.meilleurTient(c.lignes, cf, undefined, !!c.parentId);
    if (c.parentId) c.relax = !!res.relax;
    c.tientEssaye = sigLignes(c.lignes);
    c.plan = res.plan; c.decal = null; c.planDepart = { plan: JSON.parse(JSON.stringify(res.plan)), note: res.note };
    c.planCalcule = true; c.ordre = null; c.planManuel = false; c.planVariante = false; c.plansVus = null; c.graineAutre = 1;
  }
  function assurerPlan(c) { if (c.double) { if (besoinSplit(c)) { splitDouble(c); if (estAMoi(c)) toucher(c); } return; } if (c.lignes.length && (!c.plan || !Object.keys(c.plan).length)) { calculerPlan(c); if (estAMoi(c)) toucher(c); } }
  function toucher(c) {
    if (c.parentId) { // remorque d'un double : on met à jour le camion entier
      c.total_m3 = Math.round(P.totalM3(c.lignes) * 1000) / 1000;
      var p = db.camions[c.parentId];
      if (p && p.double && p.double.r) { p.lignes = unionLignes(p); p.double.sig = sigLignes(p.lignes); c = p; }
      else { sauver(); return; }
    }
    c.total_m3 = Math.round(P.totalM3(c.lignes) * 1000) / 1000;
    c.etat = P.etat(c.total_m3, cfgC(c)).code;
    c.maj_le = maintenant();
    if (estAMoi(c) || Sync.moi().admin) c._sale = true; // le camion d'un collègue ne part jamais vers l'équipe depuis ici
    sauver();
  }
  // ---------- Équipe : à qui est ce camion ----------
  function enEquipe() { return window.Sync && Sync.rejoint(); }
  function estAMoi(c) { return !c || !c.auteur || !enEquipe() || c.auteur === Sync.moi().uid; }
  function effacerPlusTard(c) { // sans équipe : rien à prévenir, le camion est effacé dès que « Annuler » a disparu
    setTimeout(function () { var l = db.camions[c.id]; if (l && l.supprime && !(window.Sync && Sync.actif() && Sync.rejoint())) { delete db.camions[c.id]; if (db.courant === c.id) db.courant = null; sauver(true); } }, 8000);
  }
  function peutSupprimer(c) { return estAMoi(c) || (enEquipe() && Sync.moi().admin); }
  function prenomDe(c) { return Sync.nom(c.auteur_prenom) || (estAMoi(c) ? (Sync.moi().prenom || 'Moi') : '?'); }
  // ---------- Clients : jamais en double ----------
  var MOTS_VIDES = ['SARL', 'SAS', 'SASU', 'SA', 'EURL', 'ETS', 'ETABLISSEMENTS', 'ETABLISSEMENT', 'STE', 'SOCIETE', 'GROUPE', 'ET', 'DE', 'DU', 'DES', 'LA', 'LE', 'LES', 'D', 'L', 'AU', 'AUX', 'CIE'];
  function cliNorm(x) { return String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim(); }
  function cliMots(x) { return cliNorm(x).split(' ').filter(function (w) { return w && MOTS_VIDES.indexOf(w) < 0; }); }
  function cliProches(a, b) {
    var na = cliNorm(a), nb = cliNorm(b); if (!na || !nb) return false;
    if (na.replace(/ /g, '') === nb.replace(/ /g, '')) return true;
    var ma = cliMots(a), mb = cliMots(b); if (!ma.length || !mb.length) return false;
    var court = ma.length <= mb.length ? ma : mb, long = court === ma ? mb : ma;
    if (court.every(function (w) { return long.indexOf(w) >= 0; }) && court.some(function (w) { return w.length >= 3; })) return true; // « FOURNEL » ⊂ « FOURNEL INDUSTRIEL »
    if (ma[0] === mb[0] && ma[0].length >= 4) return true;
    function sigle(m) { return m.length >= 2 ? m.map(function (w) { return w.charAt(0); }).join('') : ''; }
    var ca = ma.join(''), cb = mb.join('');
    return (sigle(ma) && sigle(ma) === cb) || (sigle(mb) && sigle(mb) === ca); // « MATERIAUX BOIS AQUITAINE » = « MBA »
  }
  function nbCamionsClient(n) { var k = 0; Object.keys(db.camions).forEach(function (i) { var c = db.camions[i]; if (!c.supprime && c.client === n) k++; }); return k; }
  function clientProche(n) {
    if (!n) return null;
    var l = tousClients().filter(function (x) { return x !== n && cliProches(x, n); });
    l.sort(function (a, b) { return nbCamionsClient(b) - nbCamionsClient(a); });
    return l[0] || null;
  }
  // avant d'aller plus loin : « Tu veux dire FOURNEL ? »
  function verifierClient(c, suite) {
    c.client = String(c.client || '').trim().replace(/\s+/g, ' ').toUpperCase();
    var p = clientProche(c.client);
    if (!p) { suite(); return; }
    if (cliNorm(p).replace(/ /g, '') === cliNorm(c.client).replace(/ /g, '')) { c.client = p; toucher(c); suite(); return; } // même nom, écrit autrement
    var tape = c.client; c.client = ''; // le camion ne compte pas comme un nouveau client pendant la question
    demander({ titre: 'Tu veux dire ' + p + ' ?', texte: '« ' + tape + ' » ressemble à « ' + p + ' », déjà dans tes clients.', oui: 'Oui, ' + p, non: 'Non, nouveau client' })
      .then(function (oui) { c.client = oui ? p : tape; if ($('#client') && document.activeElement !== $('#client')) $('#client').value = c.client; toucher(c); setTimeout(suite, 120); });
  }
  function tousClients() {
    var s = {};
    db.clients.forEach(function (x) { if (x) s[x] = 1; });
    Object.keys(db.camions).forEach(function (k) { var c = db.camions[k]; if (c.client && !c.supprime) s[c.client] = 1; });
    return Object.keys(s).sort();
  }

  // ---------- Petits outils d'interface ----------
  var toastMin = null;
  function toast(msg, action, label) {
    var t = $('#toast');
    t.innerHTML = '<span>' + esc(msg) + '</span>' + (action ? '<button type="button">' + esc(label || 'Annuler') + '</button>' : '');
    t.hidden = false;
    if (action) $('button', t).onclick = function () { t.hidden = true; action(); };
    clearTimeout(toastMin);
    toastMin = setTimeout(function () { t.hidden = true; }, action ? 6000 : 2600);
  }
  function ouvrirFeuille(html) {
    var f = $('#feuille');
    f.classList.remove('feuille-partage'); f.innerHTML = '<div class="poignee"></div>' + html;
    f.hidden = false; $('#feuilleFond').hidden = false;
    f.scrollTop = 0;
    if (!(history.state && history.state.f)) history.pushState({ f: 1, v: vueActive, d: profondeur() + 1 }, '');
    return f;
  }
  function fermerFeuille(parRetour) {
    if ($('#feuille').hidden) return;
    if (verrouEquipe && !Sync.rejoint()) { if (parRetour === true) history.pushState({ f: 1, v: vueActive, d: profondeur() }, ''); return; }
    $('#feuille').hidden = true; $('#feuilleFond').hidden = true; $('#feuille').innerHTML = ''; $('#feuille').onclick = null;
    if (parRetour !== true && history.state && history.state.f) history.back();
  }
  // Navigation : chaque écran se met dans l'historique, le bouton ‹ Retour (et celui du téléphone) revient en arrière
  var retourDebut = false;
  function profondeur() { return (history.state && history.state.d) || 0; }
  function aller(v) { history.pushState({ v: v, d: profondeur() + 1 }, ''); montrer(v); }
  function retour() { if (profondeur() > 0) history.back(); }
  function revenirAuDebut(v) { // après « Terminer » : on repart d'un historique propre
    var d = profondeur();
    if (d > 0) { retourDebut = v; history.go(-d); } else { history.replaceState({ v: v, d: 0 }, ''); montrer(v); }
  }
  window.addEventListener('popstate', function () {
    if (!$('#feuille').hidden) { fermerFeuille(true); majRetour(); return; }
    if (retourDebut) { var v0 = retourDebut; retourDebut = false; history.replaceState({ v: v0, d: 0 }, ''); montrer(v0); return; }
    selection = null;
    montrer((history.state && history.state.v) || 'client');
    if (apresRetour) { var fn = apresRetour; apresRetour = null; fn(); }
  });
  var apresRetour = null; // action à faire une fois la feuille fermée (retour arrière fini)
  document.addEventListener('click', function (e) { if (e.target.closest('[data-retour]')) retour(); });
  // Glisser depuis le bord gauche vers la droite = retour (comme sur iPhone), dans toutes les rubriques
  (function () {
    var g = null, BORD = 26;
    function vueEl() { return $('.vue.active'); }
    document.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1) return;
      var t = e.touches[0];
      if (t.clientX > BORD || verrouEquipe) return;
      if ($('#feuille').hidden ? profondeur() <= 0 : false) return;
      if (/iphone|ipad|ipod/i.test(navigator.userAgent) && !estInstalle()) return; // Safari a déjà son geste
      g = { x: t.clientX, y: t.clientY, dx: 0, ok: false };
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (!g) return;
      var t = e.touches[0]; g.dx = t.clientX - g.x;
      var dy = Math.abs(t.clientY - g.y);
      if (!g.ok) { if (dy > 24 && dy > g.dx) { g = null; return; } if (g.dx > 12) g.ok = true; else return; }
      var el = $('#feuille').hidden ? vueEl() : $('#feuille');
      if (el) { el.style.transition = 'none'; el.style.transform = 'translateX(' + Math.max(0, g.dx * 0.5) + 'px)'; el.style.opacity = String(Math.max(0.55, 1 - g.dx / 700)); }
    }, { passive: true });
    function fin(annule) {
      if (!g) return;
      var go = g.ok && !annule && g.dx > 80; g = null;
      [vueEl(), $('#feuille')].forEach(function (el) { if (el) { el.style.transition = 'transform .18s, opacity .18s'; el.style.transform = ''; el.style.opacity = ''; } });
      if (go) { if (!$('#feuille').hidden) fermerFeuille(); else retour(); }
    }
    document.addEventListener('touchend', function () { fin(false); });
    document.addEventListener('touchcancel', function () { fin(true); });
  })();
  function majRetour() { var ok = profondeur() > 0; $$('[data-retour]').forEach(function (b) { b.style.visibility = ok ? 'visible' : 'hidden'; }); }
  $('#feuilleFond').addEventListener('click', function () { if (!$('#feuilleFond').onclick) fermerFeuille(); });
  // Glisser une fenêtre vers le bas pour la fermer (comme sur iPhone)
  (function () {
    var f = $('#feuille'), fond = $('#feuilleFond'), g = null;
    function fermerParGeste() { if (fond.onclick) fond.onclick(); else fermerFeuille(); }
    f.addEventListener('touchstart', function (e) {
      if (e.touches.length !== 1 || f.classList.contains('feuille-3d')) { g = null; return; }
      var t = e.target;
      if (t.closest && t.closest('canvas, input[type=range], textarea, select, .v3-scene, .langues, [data-noglisse]')) { g = null; return; }
      g = { y0: e.touches[0].clientY, x0: e.touches[0].clientX, t0: Date.now(), dy: 0, actif: false, haut: f.scrollTop <= 0 };
    }, { passive: true });
    f.addEventListener('touchmove', function (e) {
      if (!g) return;
      var dy = e.touches[0].clientY - g.y0, dx = e.touches[0].clientX - g.x0;
      if (!g.actif) {
        if (f.scrollTop > 0) { g.y0 = e.touches[0].clientY; g.haut = false; return; } // la fenêtre défile d'abord jusqu'en haut
        if (dy > 8 && Math.abs(dy) > Math.abs(dx) * 1.3) { g.actif = true; g.y0 = e.touches[0].clientY - 1; g.t0 = Date.now(); f.style.transition = 'none'; f.style.animation = 'none'; }
        else return;
      }
      e.preventDefault();
      g.dy = Math.max(0, e.touches[0].clientY - g.y0);
      f.style.transform = 'translateY(' + g.dy + 'px)';
      fond.style.opacity = String(Math.max(0.2, 1 - g.dy / (f.offsetHeight || 600)));
    }, { passive: false });
    function fin() {
      if (!g || !g.actif) { g = null; return; }
      var v = g.dy / Math.max(1, Date.now() - g.t0), h = f.offsetHeight || 600, ferme = g.dy > Math.min(h * 0.22, 160) || (v > 0.45 && g.dy > 40);
      f.style.transition = 'transform .22s ease-out'; fond.style.transition = 'opacity .22s ease-out';
      if (ferme) {
        f.style.transform = 'translateY(' + (h + 40) + 'px)'; fond.style.opacity = '0';
        setTimeout(function () { fermerParGeste(); f.style.transition = f.style.transform = f.style.animation = ''; fond.style.transition = fond.style.opacity = ''; }, 220);
      } else {
        f.style.transform = ''; fond.style.opacity = '';
        setTimeout(function () { f.style.transition = ''; fond.style.transition = ''; f.style.animation = ''; }, 240);
      }
      g = null;
    }
    f.addEventListener('touchend', fin); f.addEventListener('touchcancel', fin);
  })();
  function demander(o) {
    return new Promise(function (ok) {
      var f = ouvrirFeuille('<div class="dialogue"><h2>' + esc(o.titre) + '</h2>' + (o.html || '<p>' + esc(o.texte || '') + '</p>') +
        '<div class="grille-btns"><button class="btn sec" data-r="0" type="button">' + esc(o.non || 'Annuler') + '</button>' +
        '<button class="btn ' + (o.danger ? 'danger' : '') + '" data-r="1" type="button">' + esc(o.oui || 'OK') + '</button></div></div>');
      $$('[data-r]', f).forEach(function (b) { b.onclick = function () { $('#feuilleFond').onclick = null; fermerFeuille(); ok(b.dataset.r === '1'); }; });
      $('#feuilleFond').onclick = function () { $('#feuilleFond').onclick = null; fermerFeuille(); ok(false); };
    });
  }

  function demanderTexte(titre, val, aide, maj) {
    return new Promise(function (ok) {
      var f = ouvrirFeuille('<h2>' + esc(titre) + '</h2>' + (aide ? '<p class="petit-txt">' + esc(aide) + '</p>' : '') +
        '<label class="champ"><input id="dtVal"' + (maj ? ' class="maj" autocapitalize="characters"' : '') + ' value="' + esc(val || '') + '" autocomplete="off" spellcheck="false"></label>' +
        '<div class="grille-btns"><button class="btn sec" data-r="0" type="button">Annuler</button><button class="btn" data-r="1" type="button">Valider</button></div>');
      setTimeout(function () { var e = $('#dtVal'); if (e) e.focus(); }, 80);
      $$('[data-r]', f).forEach(function (b) { b.onclick = function () { var v = $('#dtVal').value.trim(); $('#feuilleFond').onclick = null; fermerFeuille(); ok(b.dataset.r === '1' ? v : null); }; });
      $('#feuilleFond').onclick = function () { $('#feuilleFond').onclick = null; fermerFeuille(); ok(null); };
    });
  }
  // ---------- Navigation ----------
  var vueActive = 'accueil';
  var ONGLET = { accueil: 'accueil', client: 'accueil', camion: 'accueil', plan: 'accueil', ajout: 'accueil', calcul: 'calcul', historique: 'historique', reglages: 'reglages', stats: 'stats', equipe: 'equipe', profil: 'equipe', fonds: 'reglages', ambiance: 'reglages' };
  function montrer(v) {
    vueActive = v; document.body.dataset.vue = v;
    if (v !== 'plan' && v !== 'ajout') edition = null;
    if (apercu && v !== 'plan') { finApercu(courant(), false); }
    $$('.vue').forEach(function (s) { s.classList.toggle('active', s.id === 'v-' + v); });
    $$('.onglet').forEach(function (b) { b.classList.toggle('actif', b.dataset.vue === ((v === 'plan' || v === 'ajout') && edition ? 'historique' : ONGLET[v])); });
    window.scrollTo(0, 0);
    if (v === 'accueil') rendreAccueil();
    if (v === 'calcul') { prepCalc(); rendreCalc(); }
    if (v === 'client') rendreClient();
    if (v === 'camion') rendreCamion();
    if (v === 'plan') { rendrePlanVue(); requestAnimationFrame(ajusterPlan); }
    if (v === 'historique') rendreHisto();
    if (v === 'stats') rendreStats();
    if (v === 'reglages') rendreReglages();
    if (v === 'ajout') rendreAjout();
    if (v === 'equipe') rendreEquipe();
    if (v === 'profil') rendreProfil();
    if (v === 'fonds') rendreFonds();
    if (v === 'ambiance') rendreAmbiance();
    majRetour();
  }
  $$('.onglet').forEach(function (b) { b.addEventListener('click', function () {
    selection = null;
    var cible = b.dataset.vue;
    if (cible === vueActive) return;
    if (cible === 'accueil') { revenirAuDebut('accueil'); return; }
    aller(cible);
  }); });

  // ---------- Écran Camion ----------
  var nb = 1, editId = null, piAuto = false, sautAuto = false;
  var champs = ['#fEp', '#fLa', '#fPi', '#fLo'];

  function messageEtat(total, c) {
    var e = P.etat(total, cfgC(c || courant()));
    if (e.code === 'peu') return 'Il manque ' + f2(e.manque) + ' m³';
    if (e.code === 'trop') return '⚠ Dépassé de ' + f2(e.depasse) + ' m³';
    return 'Camion OK ✓';
  }

  function rendreCompteur(c) {
    var r = cfgC(c), tot = c.total_m3, e = P.etat(tot, r);
    var reste = Math.round((r.cible - tot) * 100) / 100;
    $('#msgEtat').textContent = reste < 0 ? 'Dépassé de ' + f2(-reste) + ' m³' : (e.code === 'ok' ? 'OK ✓ · reste ' + f2(reste) + ' m³' : 'Reste ' + f2(reste) + ' m³');
    $('#total').textContent = f2(tot);
    $('#totMax').textContent = fm(r.cible);
    var pct = Math.max(0, Math.min(100, tot / r.cible * 100));
    $('#barreVal').style.width = pct.toFixed(1) + '%';
    var nbc = c.lignes.reduce(function (a, l) { return a + (l.nb || 1); }, 0);
    $('#cptInfo').textContent = Math.round(tot / r.cible * 100) + ' % · ' + nbc + ' colis';
    var cpt = $('#compteur');
    var avant = cpt.dataset.etat;
    cpt.classList.remove('peu', 'ok', 'trop'); cpt.classList.add(e.code);
    if (avant && avant !== 'ok' && e.code === 'ok' && cpt.dataset.camion === c.id) pluieFeuilles();
    cpt.dataset.etat = e.code; cpt.dataset.camion = c.id;
  }

  function pluieFeuilles() {
    var z = $('#pluie'); if (!z || (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches)) return;
    var cols = ['#6FAE74', '#8CC08F', '#C9A257', '#E3A94F', '#4F8F5B'];
    var html = '';
    for (var i = 0; i < 14; i++) {
      html += '<i style="left:' + (4 + Math.random() * 92).toFixed(1) + '%;animation-delay:' + (Math.random() * .7).toFixed(2) + 's;--dx:' + Math.round(Math.random() * 60 - 30) + 'px;--r:' + Math.round(Math.random() * 540 - 270) + 'deg;--c:' + cols[i % cols.length] + ';transform:scale(' + (.7 + Math.random() * .6).toFixed(2) + ')"></i>';
    }
    z.innerHTML = html;
    setTimeout(function () { z.innerHTML = ''; }, 3600);
  }

  // Compteur − n + d'une ligne : à 1 colis, le − devient × (supprimer la ligne)
  function compteurHtml(n) {
    return '<span class="cnt"><button type="button" data-act="' + (n > 1 ? 'moins' : 'del') + '" class="' + (n > 1 ? '' : 'sup') + '" aria-label="' + (n > 1 ? 'Un colis de moins' : 'Supprimer la ligne') + '">' + (n > 1 ? '−' : '×') + '</button><b>' + n + '</b><button type="button" data-act="plus" aria-label="Un colis de plus">+</button></span>';
  }
  // Ajoute ou retire un colis d'une ligne ; à 0 la ligne disparaît (avec Annuler). Renvoie false si rien n'a changé.
  function changerNb(c, id, d, rendre) {
    var idx = c.lignes.findIndex(function (x) { return x.id === id; }); if (idx < 0) return;
    var l = c.lignes[idx], n = (l.nb || 1) + d;
    if (n > 99) return;
    if (n < 1) {
      c.lignes.splice(idx, 1);
      if (editId === id) viderForm();
      majPlan(c); toucher(c); rendre();
      toast('Ligne supprimée', function () { c.lignes.splice(idx, 0, l); majPlan(c); toucher(c); rendre(); }, 'Annuler');
      return;
    }
    l.nb = n; majPlan(c); toucher(c); rendre();
  }

  function rendreListe(c) {
    var el = $('#liste');
    if (!c.lignes.length) {
      el.innerHTML = '<div class="vide-bois"><svg viewBox="0 0 92 50" aria-hidden="true"><g stroke="#7A4E27" stroke-width="1.2"><rect x="10" y="30" width="44" height="16" rx="8" fill="#C99A5C"/><rect x="38" y="30" width="44" height="16" rx="8" fill="#B88A4E"/><rect x="24" y="15" width="44" height="16" rx="8" fill="#D2A666"/></g><g fill="#E9C68B" stroke="#9A6634" stroke-width=".9"><circle cx="18" cy="38" r="7"/><circle cx="46" cy="38" r="7"/><circle cx="32" cy="23" r="7"/></g><g fill="none" stroke="#B57E43" stroke-width=".7"><circle cx="18" cy="38" r="3.6"/><circle cx="46" cy="38" r="3.6"/><circle cx="32" cy="23" r="3.6"/></g><path d="M70 12c6-6 15-5 18 1-6 6-14 5-18-1z" fill="#6FAE74"/><path d="M60 6c3-4 9-3 11 1-4 4-9 3-11-1z" fill="#C9A257"/></svg>Le camion est vide.<br>Saisis épaisseur, largeur, pièces et longueur.</div>';
      return;
    }
    var h = '';
    for (var i = c.lignes.length - 1; i >= 0; i--) {
      var l = c.lignes[i], n = l.nb || 1;
      h += '<div class="lig' + (l.id === editId ? ' edite' : '') + '" data-id="' + esc(l.id) + '">' +
        '<span class="n">' + (i + 1) + '</span>' +
        '<button class="txt" type="button" data-act="edit"><div class="sec">' + fm(l.ep) + ' × ' + fm(l.la) + '</div>' +
        '<div class="det">' + fm(l.pi) + ' p · ' + fLong(l.lo) + ' m</div></button>' +
        compteurHtml(n) + '<span class="vol">' + f3(P.volTotalLigne(l)) + '</span></div>';
    }
    el.innerHTML = h;
  }

  // Passage automatique : la valeur tapée est complète si elle est dans la liste et qu'aucune autre ne commence pareil
  function estComplet(t, candidats) {
    t = String(t || '').trim().replace(',', '.');
    if (!t || candidats.indexOf(t) < 0) return false;
    return !candidats.some(function (x) { return x !== t && x.indexOf(t) === 0; });
  }
  function epComplete(t) {
    var c = []; reg().sections.forEach(function (s) { var k = String(s.ep); if (c.indexOf(k) < 0) c.push(k); });
    return estComplet(t, c);
  }
  function laComplete(ep, t) {
    ep = P.num(ep); var c = [];
    reg().sections.forEach(function (s) {
      var k = s.ep === ep ? String(s.la) : (s.la === ep ? String(s.ep) : null);
      if (k && c.indexOf(k) < 0) c.push(k);
    });
    return estComplet(t, c);
  }

  // Section connue : quantité remplie toute seule + longueurs proposées
  function majSection() {
    var s = P.trouverSection(reg().sections, $('#fEp').value, $('#fLa').value), pi = $('#fPi');
    if (s) { if (pi.value === '' || piAuto) { pi.value = s.pi; piAuto = true; pi.classList.remove('erreur'); } }
    else if (piAuto) { pi.value = ''; piAuto = false; }
    pi.classList.toggle('auto', piAuto);
    majLongueurs(s);
  }
  function majLongueurs(s) {
    if (s === undefined) s = P.trouverSection(reg().sections, $('#fEp').value, $('#fLa').value);
    var z = $('#loRapides'), lo = P.num($('#fLo').value);
    if (!s || !s.lg || !s.lg.length) { z.hidden = true; z.innerHTML = ''; return; }
    z.hidden = false;
    z.innerHTML = s.lg.map(function (x) { return '<button type="button" data-lo="' + x + '" class="' + (Math.abs(lo - x) < 1e-9 ? 'actif' : '') + '">' + fm(x) + ' m</button>'; }).join('');
  }
  $('#loRapides').addEventListener('click', function (e) {
    var b = e.target.closest('[data-lo]'); if (!b) return;
    $('#fLo').value = fm(+b.dataset.lo); $('#fLo').classList.remove('erreur');
    majLongueurs(); rendreApercu();
  });

  function rendreApercu() {
    var v = champs.map(function (sel) { return P.num($(sel).value); });
    var ok = v.every(function (x) { return isFinite(x) && x > 0; });
    var el = $('#apercu');
    if (!ok) { el.innerHTML = 'Ce colis : <b>—</b>'; el.classList.remove('plein'); return; }
    var vol = v[0] * v[1] * v[2] * v[3] / 1e6;
    el.innerHTML = nb > 1 ? nb + ' colis : <b>' + f3(vol * nb) + '</b> m³ <small>(' + f3(vol) + ' chacun)</small>' : 'Ce colis : <b>' + f3(vol) + '</b> m³';
    el.classList.add('plein');
  }

  function rendreCamion() {
    var c = courant();
    if (document.activeElement !== $('#client')) $('#client').value = c.client || '';
    if (document.activeElement !== $('#reference')) $('#reference').value = c.reference || '';
    $('#listeClients').innerHTML = tousClients().map(function (x) { return '<option value="' + esc(x) + '">'; }).join('');
    var rc = cfgC(c);
    $('#cfgResume').textContent = (c.double ? 'Double ' + fm(c.double.lg[0]) + ' + ' + fm(c.double.lg[1]) : fm(rc.e1Max)) + ' m · ' + (c.volMode === 'exact' && c.volExact ? fm(c.volExact) + ' m³ exact' : fm(rc.m3Min) + '–' + fm(rc.m3Max) + ' m³');
    $('#titreColis').textContent = c.client ? c.client + (c.reference ? ' · ' + c.reference : '') : (c.reference ? 'Commande ' + c.reference : 'Colis');
    rendreCompteur(c);
    rendreListe(c);
    rendreApercu();
    $('#nbVal').textContent = nb;
    $('#btnAjouter').textContent = editId ? 'Enregistrer' : 'Ajouter';
    $('#btnAnnulerEdit').hidden = !editId;
    $('#formLigne').classList.toggle('edition', !!editId);
  }

  function viderForm() {
    champs.forEach(function (s) { $(s).value = ''; $(s).classList.remove('erreur'); });
    nb = 1; editId = null; piAuto = false; $('#fPi').classList.remove('auto'); majLongueurs(null);
  }

  function ajouter() {
    var c = courant();
    var vals = champs.map(function (s) { return P.num($(s).value); });
    var bad = false;
    champs.forEach(function (s, i) {
      var okv = isFinite(vals[i]) && vals[i] > 0 && (i !== 2 || Math.round(vals[i]) === vals[i]);
      $(s).classList.toggle('erreur', !okv);
      if (!okv && !bad) { bad = true; $(s).focus(); }
    });
    if (bad) { toast('Remplis épaisseur, largeur, pièces et longueur.'); return; }
    var l = { ep: vals[0], la: vals[1], pi: vals[2], lo: vals[3], nb: nb };
    if (editId) {
      var ex = c.lignes.filter(function (x) { return x.id === editId; })[0];
      if (ex) Object.assign(ex, l);
      toast('Ligne modifiée');
    } else {
      l.id = petitId();
      c.lignes.push(l);
    }
    majPlan(c); toucher(c);
    viderForm();
    rendreCamion();
    $('#fEp').focus();
  }

  $('#formLigne').addEventListener('submit', function (e) { e.preventDefault(); ajouter(); });
  champs.forEach(function (s, i) {
    $(s).addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (sautAuto && !$(s).value) { sautAuto = false; return; } // Entrée juste après un passage automatique : on reste
      sautAuto = false;
      if (i === 1 && piAuto) $('#fLo').focus(); // quantité déjà remplie : on passe à la longueur
      else if (i < champs.length - 1) $(champs[i + 1]).focus(); else ajouter();
    });
    $(s).addEventListener('input', function () {
      $(s).classList.remove('erreur');
      if (i < 2) majSection();
      else if (i === 2) { piAuto = false; $('#fPi').classList.remove('auto'); }
      else majLongueurs();
      rendreApercu();
      sautAuto = false;
      if (i === 0 && epComplete($(s).value)) { $('#fLa').focus(); sautAuto = true; }
      if (i === 1 && laComplete($('#fEp').value, $(s).value)) { $(piAuto ? '#fLo' : '#fPi').focus(); sautAuto = true; }
    });
  });
  $('#client').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#reference').focus(); } });
  $('#reference').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#btnEtape2').click(); } });
  $('#client').addEventListener('input', function () {
    var el = $('#client'), p = el.selectionStart, up = el.value.toUpperCase();
    if (up !== el.value) { el.value = up; try { el.setSelectionRange(p, p); } catch (e) {} }
    var c = courant(); c.client = up.trim(); toucher(c);
  });
  $('#reference').addEventListener('input', function () { var c = courant(); c.reference = $('#reference').value.trim(); toucher(c); });

  $('#nbMoins').addEventListener('click', function () { nb = Math.max(1, nb - 1); $('#nbVal').textContent = nb; rendreApercu(); });
  $('#nbPlus').addEventListener('click', function () { nb = Math.min(99, nb + 1); $('#nbVal').textContent = nb; rendreApercu(); });
  $('#btnMeme').addEventListener('click', function () {
    var c = courant();
    if (!c.lignes.length) { toast('Aucune ligne à dupliquer.'); return; }
    var d = c.lignes[c.lignes.length - 1];
    // on pré-remplit seulement épaisseur, largeur et pièces : la longueur et le nombre se tapent ensuite
    viderForm(); $('#fEp').value = fm(d.ep); $('#fLa').value = fm(d.la); majSection(); $('#fPi').value = d.pi; piAuto = true; $('#fPi').classList.add('auto');
    nb = 1; $('#nbVal').textContent = '1'; rendreApercu(); $('#fLo').focus();
  });
  $('#btnAnnulerEdit').addEventListener('click', function () { viderForm(); rendreCamion(); });

  $('#liste').addEventListener('click', function (e) {
    var b = e.target.closest('[data-act]'); if (!b) return;
    var id = b.closest('.lig').dataset.id, c = courant();
    var idx = c.lignes.findIndex(function (x) { return x.id === id; });
    if (idx < 0) return;
    var l = c.lignes[idx];
    if (b.dataset.act === 'edit') {
      editId = id;
      $('#fEp').value = fm(l.ep); $('#fLa').value = fm(l.la); $('#fPi').value = fm(l.pi); $('#fLo').value = fLong(l.lo);
      nb = l.nb || 1; piAuto = false; $('#fPi').classList.remove('auto'); majLongueurs();
      rendreCamion();
    } else changerNb(c, id, b.dataset.act === 'plus' ? 1 : (b.dataset.act === 'moins' ? -1 : -99), function () { rendreCamion(); });
  });

  // ---------- Accueil ----------
  // Message selon le jour et l'heure : journée, soirée, nuit, week-end
  function salutation(d) {
    var h = d.getHours(), j = d.getDay(), we = j === 6 || j === 0 || (j === 5 && h >= 18), nuit = h >= 22 || h < 6, soir = h >= 18 && h < 22;
    if (j === 0 && h >= 18) return nuit ? 'Bonne nuit, bonne semaine' : 'Bonne soirée, bonne semaine';
    if (nuit) return 'Bonne nuit';
    if (soir) return we ? 'Bonne soirée, bon week-end' : 'Bonne soirée';
    return we ? 'Bon week-end' : 'Bonne journée au chantier';
  }
  function rendreAccueil() {
    var d = new Date(), txt = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#accDate').textContent = txt.charAt(0).toUpperCase() + txt.slice(1);
    var h = d.getHours();
    var prn = enEquipe() && Sync.moi().prenom ? String(Sync.moi().prenom).trim().toLowerCase().replace(/(^|[\s-])\S/g, function (x) { return x.toUpperCase(); }) : '';
    $('.acc-titre').textContent = (h >= 6 && h < 18 ? 'Bonjour' : 'Bonsoir') + (prn ? ' ' + prn : '');  // « Bonjour Doudou » : le prénom de la personne connectée
    majInstaller();
    var auj = jourCle(d.toISOString()), tous = Object.keys(db.camions).map(function (k) { return db.camions[k]; }).filter(function (c) { return !c.supprime; });
    var jour = tous.filter(function (c) { return c.statut === 'termine' && jourCle(c.termine_le) === auj && compte(c); });
    var m3 = somV(jour);
    var aVal = tous.filter(function (c) { return c.statut === 'en_cours' && c.lignes.length && coursVivant(c); });
    $('#accStats').innerHTML = '<div class="stat-bande"><button type="button" class="sb-c sb-vol" data-camions="1"><small>Aujourd\'hui</small><b>' + f2(m3) + ' m³</b></button><i class="sb-sep"></i>' +
      '<button type="button" class="sb-c" data-liste="val"><small>Validés ›</small><b class="sb-ok">' + jour.length + '</b></button><i class="sb-sep"></i>' +
      '<button type="button" class="sb-c" data-liste="av"><small>À valider ›</small><b class="sb-av">' + aVal.length + '</b></button></div>';
    $('#accNbJour').textContent = 'Tous les camions';
    var mEv = Ambiance.message(reg(), d);
    $('#accSous').textContent = mEv || (Ambiance.cfg(reg()).ambiance.msgAuto === false ? '' : salutation(d));
    var cours = tous.filter(function (c) { return c.statut === 'en_cours' && c.lignes.length && estAMoi(c); }).sort(function (a, b) { return b.maj_le < a.maj_le ? -1 : 1; });
    $('#accEnCours').innerHTML = cours.length ? '<p class="titre-sec cours-t"><span>À valider</span><small>' + cours.length + '</small></p><div class="carte liste-cours">' + cours.map(function (c) {
      return glisse(c.id, '<button type="button" class="en-cours-l" data-reprendre="' + esc(c.id) + '"><span><b>' + esc(c.client || 'Sans client') + '</b><small>' + (c.reference ? 'Réf. ' + esc(c.reference) + ' · ' : '') + f2(c.total_m3) + ' m³</small></span><span class="go">Reprendre</span></button>');
    }).join('') + '<p class="astuce-in">← Glisse pour supprimer · Glisse pour ouvrir →</p></div>' : '';
  }
  // ---------- Installer l'appli (Android : vraie installation ; iPhone : explication) ----------
  var invite = null;
  function estInstalle() { return (window.matchMedia && matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true; }
  function estIOS() { return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1); }
  function majInstaller() { $('#btnInstaller').hidden = true; } // plus affiché (inutile)
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); invite = e; majInstaller(); });
  window.addEventListener('appinstalled', function () { invite = null; $('#btnInstaller').hidden = true; toast('Appli installée'); });
  $('#btnInstaller').addEventListener('click', function () {
    if (invite) {
      invite.prompt();
      (invite.userChoice || Promise.resolve({})).then(function (r) { if (r.outcome === 'accepted') $('#btnInstaller').hidden = true; });
      invite = null; return;
    }
    var f = ouvrirFeuille('<h2>Installer sur l\'iPhone</h2><ol class="etapes-ios">' +
      '<li>Touche le bouton <b>Partager</b> <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M8 8l4-4 4 4M6 11v8.5h12V11"/></svg> en bas de Safari.</li>' +
      '<li>Choisis <b>Sur l\'écran d\'accueil</b>.</li><li>Touche <b>Ajouter</b>.</li></ol>' +
      '<button class="btn" type="button" data-ok="1">Compris</button>');
    $('[data-ok]', f).onclick = function () { fermerFeuille(); };
  });

  $('#btnCommencer').addEventListener('click', function () {
    var c = courant();
    if (c.lignes.length || c.client || c.reference) { c = nouveauCamion(); sauver(true); }
    delete c.double;
    viderForm(); aller('client');
    setTimeout(function () { $('#client').focus(); }, 120);
  });
  // Double remorque : même chose qu'un camion, avec 2 longueurs
  $('#btnDouble').addEventListener('click', function () {
    var c = courant();
    if (c.lignes.length || c.client || c.reference) { c = nouveauCamion(); }
    var dl = reg().dernDouble || [7.5, 7.5];
    c.double = { lg: [dl[0], dl[1]], r: null, actif: 0 }; c.lgMax = null; sauver(true);
    viderForm(); aller('client');
    setTimeout(function () { $('#client').focus(); }, 120);
  });
  var LG_DBL = [5, 5.5, 6, 6.5, 7, 7.5, 8];
  function rendreCfgDouble(c) {
    var z = $('#cfgDouble'); z.hidden = !c.double; $('#cfgSimple').hidden = !!c.double;
    $('#titreClient').textContent = c.double ? 'Double remorque' : 'Nouveau camion';
    if (!c.double) { z.innerHTML = ''; return; }
    if (z.contains(document.activeElement)) return;
    z.innerHTML = [0, 1].map(function (i) {
      var v = c.double.lg[i];
      return '<div class="cfg-ligne"><span class="cfg-t">Remorque ' + (i + 1) + (i ? ' (arrière)' : ' (avant)') + '</span><small>' + fm(v) + ' m</small></div>' +
        '<div class="lg-dbl" data-i="' + i + '">' + LG_DBL.map(function (x) { return '<button type="button" data-l="' + x + '"' + (Math.abs(x - v) < 1e-9 ? ' class="actif"' : '') + '>' + fm(x) + '</button>'; }).join('') +
        '<label class="lg-champ petit"><input inputmode="decimal" autocomplete="off" placeholder="Autre" value="' + (LG_DBL.some(function (x) { return Math.abs(x - v) < 1e-9; }) ? '' : fm(v)) + '"><i>m</i></label></div>';
    }).join('');
  }
  function majLgDouble(i, v) {
    var c = courant(); if (!c.double || !(v >= 3 && v <= 12)) return false;
    c.double.lg[i] = v; c.double.r = null; reg().dernDouble = c.double.lg.slice(); sauver(true); toucher(c); return true;
  }
  $('#cfgDouble').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-l]'); if (!b) return;
    if (majLgDouble(+b.closest('[data-i]').dataset.i, +b.dataset.l)) rendreCfgDouble(courant());
  });
  $('#cfgDouble').addEventListener('change', function (e) {
    var inp = e.target.closest('input'); if (!inp) return;
    var v = P.num(inp.value);
    if (!majLgDouble(+inp.closest('[data-i]').dataset.i, v)) { toast('Longueur entre 3 et 12 m.'); }
    inp.blur(); rendreCfgDouble(courant());
  });
  $('#v-accueil').addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]'); if (g) { aller(g.dataset.go); return; }
    if (e.target.closest('[data-camions]')) { derniersCamions(); return; }
    var li = e.target.closest('[data-liste]'); if (li) { listeJour(li.dataset.liste); return; }
    var r = e.target.closest('[data-reprendre]');
    if (r) { db.courant = r.dataset.reprendre; sauver(true); viderForm(); aller('camion'); }
  });

  // ---------- Calcul m³ ----------
  var calc = { ep: '', la: '', pi: '', lo: '', actif: 'ep' };
  // Calcul m³ : on ne montre que les paquets du calcul en cours. Si un camion déjà rempli est
  // encore ouvert, on démarre un nouveau calcul vide ; l'ancien reste dans l'historique (non terminés).
  var calcCamId = null;
  function prepCalc() {
    var c = courant();
    if (c.id !== calcCamId && c.lignes.length) { c = nouveauCamion(); sauver(true); }
    if (!c.lignes.length && c.double) { delete c.double; sauver(true); } // un calcul démarre toujours en standard
    calcCamId = c.id;
  }
  var ORDRE = ['ep', 'la', 'pi', 'lo'];
  function calcVol() {
    var v = ORDRE.map(function (k) { return P.num(calc[k]); });
    return v.every(function (x) { return isFinite(x) && x > 0; }) ? v[0] * v[1] * v[2] * v[3] / 1e6 : null;
  }
  function rendreCalc() {
    $$('#v-calcul .fd').forEach(function (b) {
      var k = b.dataset.k, val = calc[k];
      b.classList.toggle('on', calc.actif === k);
      var sp = $('b span', b); sp.textContent = val || (calc.actif === k ? '' : '—'); sp.classList.toggle('vide', !val);
    });
    var vol = calcVol(), pret = vol != null && calc.actif === 'lo';
    $('#calcVol').textContent = vol == null ? '0,000' : f3(vol);
    $('#calcVol').parentNode.classList.toggle('vide', vol == null);
    var sv = $('#paveSuiv'); sv.classList.toggle('pret', pret);
    sv.innerHTML = pret ? 'Ajouter<small>et suivant</small>' : 'Suivant';
    var cc = courant(), sig = cc.id + '|' + cc.lignes.map(function (l) { return l.id + ':' + (l.nb || 1); }).join(',') + '|' + cc.total_m3 + '|' + cfgC(cc).cible + '|' + !!$('#calcSuivi').children.length;
    if (sig !== sigSuivi) { sigSuivi = sig; rendreSuivi(); } // la liste n'est refaite que si les paquets changent (plus de saut en tapant)
  }
  var sigSuivi = '';
  // Suivi du camion en cours dans le calcul m³ : total après chaque paquet
  function rendreSuivi() {
    var c = courant(), r = cfgC(c), tot = c.total_m3 || 0, e = P.etat(tot, r);
    var nbp = c.lignes.reduce(function (a, l) { return a + (l.nb || 1); }, 0);
    var reste = Math.round((r.cible - tot) * 100) / 100, pct = Math.max(0, Math.min(100, tot / r.cible * 100));
    var txt = nbp + ' paquet' + (nbp > 1 ? 's' : '') + ', ' + (reste < 0 ? 'dépassé de ' + f2(-reste) + ' m³' : (e.code === 'ok' ? 'camion bon, reste ' : 'reste ') + f2(reste) + ' m³');
    var n = c.lignes.length;
    var liste = c.lignes.slice().reverse().map(function (l, j) {
      var nb = l.nb || 1;
      return '<div class="' + (j === 0 ? 'dernier' : '') + '" data-id="' + esc(l.id) + '"><span class="n">' + (n - j) + '</span><em>' + fm(l.ep) + ' × ' + fm(l.la) + ' <span>' + fLong(l.lo) + ' m</span></em>' + compteurHtml(nb) + '<i>' + f3(P.volTotalLigne(l)) + '</i></div>';
    }).join('');
    $('#calcSuivi').className = 'suivi ' + e.code;
    $('#calcSuivi').innerHTML =
      '<div class="sv-h"><div><b>' + f3(tot) + '<small>m³</small></b><p>' + txt + '</p></div><button type="button" class="btn sec petit" data-voirplan="1">Voir le plan</button></div>' +
      '<div class="cpt-barre"><i style="width:' + pct.toFixed(1) + '%"></i></div>' +
      (liste ? '<div class="sv-liste">' + liste + '</div>' : '<p class="sv-vide">Tape un paquet puis « Ajouter » : le total du camion se met à jour ici.</p>');
  }

  $$('#v-calcul .fd').forEach(function (b) { b.addEventListener('click', function () { calc.actif = b.dataset.k; rendreCalc(); }); });
  $('#pave').addEventListener('click', function (e) {
    var t = e.target.closest('[data-t]'); if (!t) return;
    var k = calc.actif, val = calc[k], key = t.dataset.t;
    if (key === 'del') calc[k] = val.slice(0, -1);
    else if (key === 'next') {
      if (k === 'lo' && calcVol() != null) { ajouterCalc(); return; }
      if (!(calc.saut && !val)) calc.actif = (k === 'la' && calc.piAuto) ? 'lo' : ORDRE[(ORDRE.indexOf(k) + 1) % 4];
    }
    else if (key === ',') { if (k !== 'pi' && val.indexOf(',') < 0) calc[k] = (val || '0') + ','; }
    else if (val.replace(',', '').length < 6) calc[k] = (val === '0' ? '' : val) + key;
    calc.saut = false; // « Suivant » juste après un passage automatique ne saute pas une case vide
    if (k === 'pi' && key !== 'next') calc.piAuto = false;
    if (k === 'ep' || k === 'la') {
      var sc = P.trouverSection(reg().sections, calc.ep, calc.la);
      if (sc && (!calc.pi || calc.piAuto)) { calc.pi = String(sc.pi); calc.piAuto = true; }
      else if (!sc && calc.piAuto) { calc.pi = ''; calc.piAuto = false; }
      if (/\d/.test(key)) {
        if (k === 'ep' && epComplete(calc.ep)) { calc.actif = 'la'; calc.saut = true; }
        if (k === 'la' && laComplete(calc.ep, calc.la)) { calc.actif = calc.piAuto ? 'lo' : 'pi'; calc.saut = true; }
      }
    }
    rendreCalc();
  });
  $('#calcEffacer').addEventListener('click', function () { calc = { ep: '', la: '', pi: '', lo: '', actif: 'ep' }; rendreCalc(); });
  function ajouterCalc() {
    var c = courant();
    c.lignes.push({ id: petitId(), ep: P.num(calc.ep), la: P.num(calc.la), pi: P.num(calc.pi), lo: P.num(calc.lo), nb: 1 });
    majPlan(c); toucher(c);
    calc = { ep: '', la: '', pi: '', lo: '', actif: 'ep' }; rendreCalc();
    var l = $('.sv-liste', $('#calcSuivi')); if (l) l.scrollTop = 0;
    toast('Paquet ajouté · total ' + f2(c.total_m3) + ' m³');
  }
  // Calcul m³ → « Voir le plan » : type de camion, longueur(s), client et n° de commande
  function ouvrirVoirPlan(c) {
    var r = reg(), dbl = !!c.double, lg = c.lgMax || r.e1Max, dl = (c.double && c.double.lg) || r.dernDouble || [7.5, 7.5];
    var nbp = c.lignes.reduce(function (a, l) { return a + (l.nb || 1); }, 0);
    function puces(attr, l, v) { return '<div class="lg-dbl" ' + attr + '>' + l.map(function (x) { return '<button type="button" data-l="' + x + '"' + (Math.abs(x - v) < 1e-9 ? ' class="actif"' : '') + '>' + fm(x) + '</button>'; }).join('') + '</div>'; }
    function corps() {
      return (dbl ? '<p class="adm-lab"><span>Remorque 1 (avant)</span></p>' + puces('data-r="0"', LG_DBL, dl[0]) + '<p class="adm-lab"><span>Remorque 2 (arrière)</span></p>' + puces('data-r="1"', LG_DBL, dl[1])
        : '<p class="adm-lab"><span>Longueur de chargement</span></p>' + puces('data-r="s"', [12, 12.5, 13, 13.6], lg));
    }
    var f = ouvrirFeuille('<div class="dialogue vp"><h2>Voir le plan</h2><p class="petit-txt" style="margin-top:-6px">' + f2(c.total_m3) + ' m³ · ' + nbp + ' paquet' + (nbp > 1 ? 's' : '') + '</p>' +
      '<p class="adm-lab"><span>Type de camion</span></p><div class="seg seg2" id="vpType"><button type="button" data-t="s" class="' + (dbl ? '' : 'actif') + '">Standard</button><button type="button" data-t="d" class="' + (dbl ? 'actif' : '') + '">⇄ Double remorque</button></div>' +
      '<div id="vpLg">' + corps() + '</div>' +
      '<label class="champ"><span>Client</span><input id="vpCli" list="listeClients" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ex. MBA" value="' + esc(c.client || '') + '"></label>' +
      '<label class="champ"><span>N° de commande</span><input id="vpRef" inputmode="numeric" autocomplete="off" placeholder="ex. 34208" value="' + esc(c.reference || '') + '"></label>' +
      '<button class="btn gros" id="vpOk" type="button" style="width:100%;margin-top:6px">Voir le plan →</button></div>');
    $('#listeClients').innerHTML = tousClients().map(function (x) { return '<option value="' + esc(x) + '">'; }).join('');
    setTimeout(function () { var i = $('#vpCli'); if (i && !i.value) i.focus(); }, 120);
    f.onclick = function (e) {
      var t = e.target.closest('#vpType button'), b = e.target.closest('#vpLg button[data-l]');
      if (t) { dbl = t.dataset.t === 'd'; $$('#vpType button').forEach(function (x) { x.classList.toggle('actif', x === t); }); $('#vpLg').innerHTML = corps(); return; }
      if (b) { var z = b.parentNode.dataset.r, v = +b.dataset.l; if (z === 's') lg = v; else dl[+z] = v; $$('button', b.parentNode).forEach(function (x) { x.classList.toggle('actif', x === b); }); return; }
      if (e.target.closest('#vpOk')) {
        c.client = $('#vpCli').value.trim().toUpperCase(); c.reference = $('#vpRef').value.trim();
        if (dbl) { c.double = { lg: [dl[0], dl[1]], r: null, actif: 0 }; c.lgMax = null; reg().dernDouble = dl.slice(); }
        else { delete c.double; c.lgMax = lg === r.e1Max ? null : lg; }
        majPlan(c); toucher(c); fermerFeuille();
        setTimeout(function () { verifierClient(c, function () { aller('plan'); }); }, 260);
      }
    };
    $('#vpRef').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#vpOk').click(); });
    $('#vpCli').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('#vpRef').focus(); });
    $('#vpCli').addEventListener('input', function () { var el = this, p = el.selectionStart; el.value = el.value.toUpperCase(); try { el.setSelectionRange(p, p); } catch (er) {} });
  }
  $('#calcSuivi').addEventListener('click', function (e) {
    var c = courant();
    if (e.target.closest('[data-voirplan]')) { if (!c.lignes.length) { toast('Ajoute d\'abord un paquet.'); return; } ouvrirVoirPlan(c); return; }
    var x = e.target.closest('[data-act]'); if (!x) return;
    changerNb(c, x.closest('[data-id]').dataset.id, x.dataset.act === 'plus' ? 1 : (x.dataset.act === 'moins' ? -1 : -99), rendreSuivi);
  });

  // ---------- Étape 1 : client ----------
  function rendreClient() {
    var c = courant(), r = reg();
    if (document.activeElement !== $('#lgMax')) $('#lgMax').value = fm(c.lgMax || r.e1Max);
    $('#lgDefaut').textContent = 'Par défaut ' + fm(r.e1Max) + ' m';
    var mode = c.volMode === 'exact' ? 'exact' : 'plage';
    $$('#segVol button').forEach(function (b) { b.classList.toggle('actif', b.dataset.m === mode); });
    $('#segVol [data-m="plage"]').textContent = 'Entre ' + fm(r.m3Min) + ' et ' + fm(r.m3Max) + ' m³';
    $('#volExactZone').hidden = mode !== 'exact';
    rendreCfgDouble(c);
    if (document.activeElement !== $('#volExact')) $('#volExact').value = c.volExact ? fm(c.volExact) : '';
    if (document.activeElement !== $('#client')) $('#client').value = c.client || '';
    if (document.activeElement !== $('#reference')) $('#reference').value = c.reference || '';
    $('#listeClients').innerHTML = tousClients().map(function (x) { return '<option value="' + esc(x) + '">'; }).join('');
  }
  function majCfgCamion() {
    var c = courant(), r = reg();
    var lg = P.num($('#lgMax').value);
    c.lgMax = isFinite(lg) && lg >= 4 && lg <= 20 ? lg : null;
    if (c.lgMax === r.e1Max) c.lgMax = null;
    var ve = P.num($('#volExact').value);
    c.volExact = isFinite(ve) && ve > 0 && ve < 100 ? ve : null;
    if (c.lignes.length) majPlan(c);
    toucher(c);
  }
  $('#lgMax').addEventListener('change', function () { majCfgCamion(); rendreClient(); });
  $('#volExact').addEventListener('input', function () { $('#volExact').classList.remove('erreur'); majCfgCamion(); });
  $$('#lgRapides button').forEach(function (b) { b.addEventListener('click', function () { $('#lgMax').value = b.dataset.l; majCfgCamion(); rendreClient(); }); });
  $$('#segVol button').forEach(function (b) { b.addEventListener('click', function () {
    var c = courant(); c.volMode = b.dataset.m; majCfgCamion(); rendreClient();
    if (b.dataset.m === 'exact') setTimeout(function () { $('#volExact').focus(); }, 50);
  }); });
  $('#btnEtape2').addEventListener('click', function () {
    var c = courant();
    majCfgCamion();
    if (c.volMode === 'exact' && !c.volExact) { $('#volExact').classList.add('erreur'); $('#volExact').focus(); toast('Indique le volume exact, ou choisis « Entre 39 et 41 ».'); return; }
    $('#volExact').classList.remove('erreur');
    verifierClient(c, function () { aller('camion'); setTimeout(function () { $('#fEp').focus(); }, 80); });
  });

  // Un autre bon plan, calculé instantanément sur le téléphone
  // Double : appui long sur « Autre plan » → refaire cette remorque ou les 2
  var appuiLong = null, longFait = false;
  $('#btnAutre').addEventListener('pointerdown', function () {
    longFait = false; clearTimeout(appuiLong);
    var b = courantBase(); if (!b.double || !estAMoi(b)) return;
    appuiLong = setTimeout(function () {
      longFait = true; var a = b.double.actif || 0;
      var f = ouvrirFeuille('<div class="dialogue"><h2>Autre plan</h2>' +
        '<button type="button" class="opt-part" data-ap="1"><span class="op-ic">↻</span><span><b>Refaire la remorque ' + (a + 1) + '</b><small>La remorque ' + (2 - a) + ' ne bouge pas</small></span></button>' +
        '<button type="button" class="opt-part" data-ap="2"><span class="op-ic">⇄</span><span><b>Refaire les 2 remorques</b><small>Tous les colis sont redistribués</small></span></button>' +
        '<button type="button" class="btn sec" data-ap="0" style="width:100%;margin-top:8px">Annuler</button></div>');
      f.onclick = function (e) {
        var x = e.target.closest('[data-ap]'); if (!x) return; var q = x.dataset.ap; fermerFeuille();
        if (q === '1') setTimeout(function () { longFait = false; $('#btnAutre').click(); }, 80);
        if (q === '2') { b.double.graine = (b.double.graine || 0) + 1; b.double.r = null; selection = null; toucher(b); setTimeout(rendrePlanVue, 80); }
      };
    }, 550);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (ev) { $('#btnAutre').addEventListener(ev, function () { clearTimeout(appuiLong); }); });
  $('#btnAutre').addEventListener('contextmenu', function (e) { if (courantBase().double) e.preventDefault(); });
  $('#btnAutre').addEventListener('click', function (e) {
    if (longFait) { longFait = false; e.preventDefault(); return; }
    if (!estAMoi(courant())) return;
    if (apercu) { finApercu(courant(), false); rendrePlanVue(); }
    var c = courant(), b = $('#btnAutre');
    if (!c.lignes.length || b.disabled) return;
    b.disabled = true; b.classList.add('calcul'); b.innerHTML = '<span class="spin"></span>Calcul…';
    setTimeout(function () {
      if (!c.plansVus) c.plansVus = [P.signature(c.lignes, c.plan || {})];
      var refV = c.planDepart ? vplan(c, c.planDepart.plan) : null;
      var res = P.autre(c.lignes, cfgC(c), c.plansVus, c.graineAutre || 1, refV);
      if (!res && c.plansVus.length > 1) { // on a fait le tour : on recommence la série
        c.plansVus = [P.signature(c.lignes, c.plan || {})];
        res = P.autre(c.lignes, cfgC(c), c.plansVus, (c.graineAutre || 1) + 50, refV);
      }
      b.disabled = false; b.classList.remove('calcul'); b.innerHTML = 'Autre plan';
      if (!res) {
        var base = courantBase();
        if (base.double && base.double.r) { // double : on réorganise les 2 remorques avec tous les colis
          var actifAvant = base.double.actif || 0;
          base.double.graine = (base.double.graine || 0) + 1; base.double.r = null; selection = null; selRem = null;
          $('#planZone').innerHTML = '<div class="calcul-plan"><span class="spin"></span>Réorganisation des 2 remorques…</div>';
          setTimeout(function () { splitDouble(base); base.double.actif = actifAvant; toucher(base); rendrePlanVue(); toast('Les 2 remorques ont été réorganisées'); }, 40);
          return;
        }
        // camion normal : le meilleur plan où tout rentre (tous les colis, même ceux de côté)
        var mt = P.meilleurTient(c.lignes, cfgC(c));
        if (P.signature(c.lignes, mt.plan) === P.signature(c.lignes, c.plan || {})) { toast('C\'est le seul bon plan avec ces colis.'); return; }
        res = { plan: mt.plan, note: mt.note, signature: P.signature(c.lignes, mt.plan), graine: (c.graineAutre || 1) + 1 };
      }
      c.plan = res.plan; c.ordre = null; c.decal = null; c.planManuel = false; c.planVariante = true; c.graineAutre = res.graine;
      var mieux = c.planDepart && res.note < c.planDepart.note - 0.01;
      if (mieux) c.planDepart = { plan: JSON.parse(JSON.stringify(res.plan)), note: res.note };
      c.plansVus.push(res.signature); selection = null; toucher(c);
      rendrePlanVue(); window.scrollTo({ top: 0, behavior: 'smooth' });
      toast(mieux ? 'Meilleur plan trouvé : c\'est le nouveau plan de départ' : 'Nouveau plan · ' + (c.plansVus.length) + 'e proposition');
    }, 30);
  });

  // Longueur du camion changée depuis le plan : nouveau plan avec cette longueur (ce camion seulement)
  $('#btnLongueur').addEventListener('click', function () {
    var c = courant(); if (!estAMoi(c) || c.double) return;
    var lg0 = cfgC(c).e1Max;
    var f = ouvrirFeuille('<div class="dialogue"><h2>Longueur du camion</h2>' +
      '<label class="lg-champ"><input id="lgPlan" inputmode="decimal" autocomplete="off" value="' + fm(lg0) + '"><i>m</i></label>' +
      '<div class="lg-rapides" id="lgPlanRap" style="grid-template-columns:repeat(5,1fr);margin:10px 0"><button type="button" data-l="12">12</button><button type="button" data-l="12,5">12,5</button><button type="button" data-l="13">13</button><button type="button" data-l="13,5">13,5</button><button type="button" data-l="13,6">13,6</button></div>' +
      '<p class="sous">Écris la longueur que tu veux (entre 4 et 20 m). Ce camion seulement.' + (c.planManuel ? ' Tes déplacements à la main seront remplacés.' : '') + '</p>' +
      '<button type="button" class="btn gros" id="lgPlanOk" style="width:100%">Recalculer les plans</button>' +
      '<button type="button" class="btn sec" id="lgPlanNon" style="width:100%;margin-top:8px">Annuler</button></div>');
    var inp = $('#lgPlan', f);
    $$('#lgPlanRap button', f).forEach(function (b) { b.onclick = function () { inp.value = b.dataset.l; }; });
    $('#lgPlanNon', f).onclick = function () { fermerFeuille(); };
    function valider() {
      var lg = P.num(inp.value);
      if (!(isFinite(lg) && lg >= 4 && lg <= 20)) { inp.classList.add('erreur'); toast('Longueur entre 4 et 20 m.'); return; }
      fermerFeuille();
      setTimeout(function () {
        c.lgMax = lg === reg().e1Max ? null : lg;
        if (Math.abs(lg - lg0) < 1e-9) return;
        selection = null;
        $('#planZone').innerHTML = '<div class="calcul-plan"><span class="spin"></span>Calcul du plan en ' + fm(lg) + ' m…</div>';
        setTimeout(function () { calculerPlan(c); toucher(c); if (vueActive === 'plan') { rendrePlanVue(); window.scrollTo({ top: 0, behavior: 'smooth' }); } toast('Plan refait pour ' + fm(lg) + ' m'); }, 40);
      }, 80);
    }
    $('#lgPlanOk', f).onclick = valider;
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); valider(); } });
    inp.addEventListener('input', function () { inp.classList.remove('erreur'); });
    setTimeout(function () { inp.focus(); inp.select(); }, 150);
  });

  // Enlève des colis du camion (ceux de côté, ou un colis choisi), sans toucher au reste du plan
  function supprimerColis(c, enlever) {
    var plan = c.plan || {}, nouveauPlan = {}, nouvelOrdre = [], ren = {}, dec = c.decal || {}, nouveauDec = {};
    c.lignes = c.lignes.filter(function (l) {
      var n = l.nb || 1, k2 = 0;
      for (var k = 0; k < n; k++) {
        var id = l.id + '#' + k;
        if (enlever(id, plan[id])) continue;
        ren[id] = l.id + '#' + k2; if (plan[id]) nouveauPlan[ren[id]] = plan[id]; if (dec[id] != null) nouveauDec[ren[id]] = dec[id]; k2++;
      }
      l.nb = k2; return k2 > 0;
    });
    (c.ordre || []).forEach(function (id) { if (ren[id]) nouvelOrdre.push(ren[id]); });
    c.plan = nouveauPlan; c.ordre = nouvelOrdre; c.decal = c.decal ? nouveauDec : null; c.planManuel = true; selection = null;
    toucher(c);
  }
  function supprimerCote(c) { supprimerColis(c, function (id, k) { return k === 'X'; }); }
  function photoCamion(c) { return JSON.stringify({ l: c.lignes, p: c.plan, o: c.ordre, d: c.decal || null, m: c.planManuel }); }
  function remettrePhoto(c, ph) { var o = JSON.parse(ph); c.lignes = o.l; c.plan = o.p; c.ordre = o.o; c.decal = o.d; c.planManuel = o.m; selection = null; toucher(c); }

  $('#btnVider').addEventListener('click', function () {
    if (!estAMoi(courant())) return;
    if (apercu) { finApercu(courant(), false); rendrePlanVue(); }
    var c = courant(); if (!c.lignes.length) return;
    var avant = { plan: c.plan, ordre: c.ordre, man: c.planManuel };
    fixerOrdre(c);
    var plan = {}; P.colisDe(c.lignes).forEach(function (k) { plan[k.id] = 'X'; });
    c.plan = plan; c.planManuel = true; selection = null; toucher(c); rendrePlanVue();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Tous les colis sont de côté', function () { c.plan = avant.plan; c.ordre = avant.ordre; c.planManuel = avant.man; toucher(c); rendrePlanVue(); }, 'Annuler');
  });

  // Avant de valider : on liste ce qui ne va pas ; l'utilisateur corrige ou valide quand même
  function problemesCamion(c) {
    var r = cfgC(c), v = vplan(c), out = [];
    if (v.cote.length) out.push(['⚠', v.cote.length + ' colis oublié' + (v.cote.length > 1 ? 's' : '') + ' de côté', v.cote.map(libColis).join(', ') + ' · ' + (v.cote.length > 1 ? 'ils seront retirés' : 'il sera retiré') + ' du camion']);
    alertesCourtes(c, v).forEach(function (t) {
      if (t === 'Pas équilibré') out.push(['⚠', 'Pas équilibré', 'conducteur ' + f2(v.volG) + ' m³ / passager ' + f2(v.volD) + ' m³' + (v.ecart < -0.005 ? ' (le passager est plus lourd)' : ' (écart ' + f2(Math.abs(v.ecart)) + ')')]);
      else out.push(['⚠', t, '']);
    });
    var e = P.etat(c.total_m3, r);
    if (e.code !== 'ok') out.push(['⚠', 'Volume ' + f2(c.total_m3) + ' m³', 'hors limites ' + fm(r.m3Min) + '–' + fm(r.m3Max) + ' m³']);
    return out;
  }
  function enregistrerCamion(c) {
    if (c.double && c.double.r) { c.double.r.forEach(function (s) { if (vplan(s).cote.length) supprimerCote(s); }); c.double.actif = 0; }
    else if (vplan(c).cote.length) supprimerCote(c);
    if (edition) { // camion de l'historique : on enregistre et on revient
      toucher(c); sauver(true); selection = null; edition = null;
      retour(); toast('Plan enregistré ✔'); return;
    }
    c.statut = 'termine'; c.termine_le = maintenant(); delete c.plansVus;
    if (c.client && db.clients.indexOf(c.client) < 0) db.clients.push(c.client);
    toucher(c);
    viderForm(); nouveauCamion(); sauver(true);
    selection = null;
    setTimeout(function () { revenirAuDebut('accueil'); }, 150);
    toast('Camion enregistré ✔');
  }
  $('#btnTerminer').addEventListener('click', function () {
    if (!estAMoi(courant())) return;
    if (apercu) { finApercu(courant(), false); rendrePlanVue(); }
    var base = courantBase(), c = courant(), pb;
    if (base.double) {
      if (!base.double.r) return;
      if (!(base.double.actif || 0)) { changerRem(1); return; } // page 1 : « 2ème plan → »
      c = base; pb = [];
      base.double.r.forEach(function (s, i) { problemesCamion(s).forEach(function (x) { pb.push([x[0], 'Remorque ' + (i + 1) + ' : ' + x[1], x[2]]); }); });
      var ev = P.etat(base.total_m3, cfgC(base)), rv = cfgC(base);
      if (ev.code !== 'ok') pb.push(['⚠', 'Volume ' + f2(base.total_m3) + ' m³', 'hors limites ' + fm(rv.m3Min) + '–' + fm(rv.m3Max) + ' m³']);
    } else {
      if (!c.lignes.length) { toast('Aucun colis à enregistrer.'); return; }
      assurerPlan(c);
      pb = problemesCamion(c);
    }
    if (!c.lignes.length) { toast('Aucun colis à enregistrer.'); return; }
    if (!pb.length) { enregistrerCamion(c); return; }
    var f = ouvrirFeuille('<div class="dialogue verif-fin"><h2>Vérifie avant de valider</h2>' +
      pb.map(function (p) { return '<div class="avert"><span>' + p[0] + '</span><span><b>' + esc(p[1]) + '</b>' + (p[2] ? ' · ' + esc(p[2]) : '') + '</span></div>'; }).join('') +
      '<div class="grille-btns"><button class="btn sec" data-r="0" type="button">Corriger</button><button class="btn" data-r="1" type="button">Valider quand même</button></div></div>');
    $$('[data-r]', f).forEach(function (b) { b.onclick = function () { var ok = b.dataset.r === '1'; $('#feuilleFond').onclick = null; if (ok) { if (history.state && history.state.f) apresRetour = function () { enregistrerCamion(c); }; else setTimeout(function () { enregistrerCamion(c); }, 60); } fermerFeuille(); }; });
    $('#feuilleFond').onclick = function () { $('#feuilleFond').onclick = null; fermerFeuille(); };
  });

  $('#btnPlan').addEventListener('click', function () {
    var c = courant();
    if (!c.lignes.length) { toast('Ajoute d\'abord des colis.'); return; }
    aller('plan');
  });

  // ---------- Plan de chargement ----------
  var selection = null;
  var NOMS = { G: 'Côté conducteur', D: 'Côté passager' };
  // ---------- Plan : barres modernes, sens de chargement réel ----------
  function libColis(k) { return fm(k.lo) + ' m · ' + fm(k.ep) + '×' + fm(k.la); }

  function statutPlan(v, r) {
    var totCm = 0;
    Object.keys(v.rows).forEach(function (k) { totCm += v.rows[k].len; });
    v.nonPlaces.forEach(function (k) { totCm += k.cm; });
    var N = v.N || 3, maxCm = 2 * N * Math.round(r.e1Max * 100);
    if (totCm > maxCm) return { cls: 'e', etq: '⚠ Trop long', court: fm((totCm - maxCm) / 100) + ' m de colis en trop : retire des colis.', detail: 'Les colis font ' + fm(totCm / 100) + ' m bout à bout : ' + fm((totCm - maxCm) / 100) + ' m de trop pour ' + N + ' étages de ' + fm(r.e1Max) + ' m. Retire des colis.' };
    if (v.etat.code === 'peu') return { cls: 'a', etq: 'Il manque ' + f2(v.etat.manque) + ' m³' };
    var e1Long = ['G', 'D'].some(function (s2) { return v.rows[s2 + '1'].len > Math.round(r.e1Max * 100); });
    var lg = v.erreurs.filter(function (m) { return /^Étage/.test(m) && (e1Long || !/il faut entre/.test(m)); });
    if (lg.length) return { cls: 'e', etq: '⚠ À revoir', detail: lg[0] };
    if (v.etat.code === 'trop') return { cls: 'e', etq: 'Dépassé ' + f2(v.etat.depasse) + ' m³' };
    if (v.ecrase) return { cls: 'a', etq: '≈ Fait au mieux', court: 'Étages en rouge : épaisseurs mélangées.', detail: 'Avec ces colis, impossible de mettre toutes les sections fines au-dessus des plus épaisses : les étages en rouge ont un colis posé sur plus fin que lui.' };
    if (P.deseq(v) > r.ecartMax + 0.005) {
      var dq = P.deseq(v); if (dq >= 100) dq -= 100; // +100 = le passager est plus lourd (pénalité interne, pas un écart)
      if (v.ecart < -0.005) return { cls: 'a', etq: '≈ Équilibré au mieux', court: 'Côté passager plus chargé de ' + f2(-v.ecart) + ' m³.', detail: 'Avec ces colis, le côté passager est plus chargé de ' + f2(-v.ecart) + ' m³ : le plus proche possible.' };
      return { cls: 'a', etq: '≈ Équilibré au mieux', court: 'Écart de ' + f2(dq) + ' m³, le plus faible possible.', detail: 'Avec ces colis, écart de ' + f2(dq) + ' m³ entre gauche et droite : le plus faible possible.' };
    }
    var lgM = v.avis.filter(function (m) { return /cm/.test(m); });
    if (lgM.length) return { cls: 'a', etq: '≈ Équilibré au mieux', court: 'Longueurs gauche/droite : le plus proche possible.', detail: lgM[0].replace(/\.$/, '') + ' : le plus petit écart possible avec ces colis.' };
    if (v.avis.some(function (m) { return /seule solution/.test(m); })) return { cls: 'a', etq: '≈ Fait au mieux', court: 'Un étage du haut est plus long : seule solution pour tout charger.', detail: 'Pour tout faire rentrer (ou garder les sections fines en haut), un étage du haut est plus long que celui du dessous. Il ne dépasse jamais la remorque.' };
    return { cls: 'o', etq: '✓ Équilibré' };
  }

  function vplan(c, plan) { return P.verifier(c.lignes, plan || c.plan || {}, cfgC(c), c.ordre, c.decal); }
  // Dernier étage : vide (cm) devant chaque colis. Réglé à la main en glissant ; sinon centré comme avant.
  function gapsRow(c, v, k) {
    var cs = v.rows[k].colis, d = c.decal || {};
    if (!cs.length) return [];
    if (cs.some(function (x) { return d[x.id] != null; })) return cs.map(function (x) { return Math.max(0, +d[x.id] || 0); });
    return cs.map(function () { return 0; }); // plan proposé : colis collés à la cabine, aucun vide
  }
  // Petits messages rouges (courts) : ce qui ne va pas dans le plan
  function alertesCourtes(c, v) {
    var r = cfgC(c), mx = Math.round(r.e1Max * 100), N = v.N, out = [];
    function aj(t) { if (out.indexOf(t) < 0) out.push(t); }
    ['G', 'D'].forEach(function (s) {
      for (var f = 1; f <= N; f++) {
        var ro = v.rows[s + f], ext = f === N ? ro.ext + v.rows['C' + N].ext : ro.ext;
        if (ext > mx) aj('Dépasse ' + fm(r.e1Max) + ' m');
        if (f > 1) {
          var dessous = v.rows[s + (f - 1)].ext;
          if (!r.relax && ext > dessous && ro.colis.length + (f === N ? v.rows['C' + N].colis.length : 0)) aj('É' + f + ' plus long que É' + (f - 1));
        }
      }
    });
    if (P.deseq(v) > r.ecartMax + 0.005) aj('Pas équilibré');
    return out;
  }
  function alerterApres(c, avant, okMsg) {
    var v = vplan(c), apres = alertesCourtes(c, v).filter(function (t) { return avant.indexOf(t) < 0; });
    if (apres.length) toastRouge('⚠ ' + apres.join(' · '), 2600);
    else if (okMsg) toast(okMsg);
  }
  // ordre d'affichage complet (cabine → arrière) tiré du plan actuel
  function fixerOrdre(c) {
    var v = vplan(c), o = [];
    v.ROWS.forEach(function (k) { v.rows[k].colis.forEach(function (x) { o.push(x.id); }); });
    v.cote.forEach(function (x) { o.push(x.id); });
    c.ordre = o; return v;
  }
  // Dessin de la remorque sous le plan : châssis acier, garde-boue et roues (3 essieux à l'arrière ; 2ème remorque : 2 devant + 2 derrière)
  var ROUE = '<svg class="roue" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11.5" fill="var(--pn)"/><circle cx="12" cy="12" r="6.5" fill="var(--ja)"/><circle cx="12" cy="12" r="2.4" fill="var(--pn)"/></svg>';
  function roues(n, cl) { var t = ''; for (var i = 0; i < n; i++) t += ROUE; return '<span class="ch-roues ' + cl + '">' + t + '</span>'; }
  function remorqueHtml(c) {
    var deux = c.parentId && c.rem === 1;
    return '<div class="rang rang-ch" aria-hidden="true"><span></span><div class="chassis"><i class="ch-sol"></i>' +
      (deux ? roues(2, 'avant') : '<i class="ch-cr"></i>') + roues(deux ? 2 : 3, 'ar') + '</div></div>';
  }
  function hashBois(t) { var h = 0; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return h; }
  function htmlPlan(c, opts) {
    var r = cfgC(c), v = vplan(c), st = statutPlan(v, r);
    var maxLen = r.e1Max * 100;
    v.ROWS.forEach(function (k) { maxLen = Math.max(maxLen, v.rows[k].len); });
    var N = v.N, ETG = []; for (var e0 = N; e0 >= 1; e0--) ETG.push(e0);
    var edit = !opts.lecture, selCote = edit && selection && v.cote.some(function (k) { return k.id === selection; });
    var place = edit ? 36 : 0; // place toujours gardée pour le bouton « + » en bout d'étage : les colis ne changent jamais de taille quand on en touche un
    planGeo = { maxLen: maxLen, place: place };
    function w(cm) { return 'width:calc((100% - ' + (4 + place) + 'px) * ' + (cm / maxLen).toFixed(4) + ' - 2px)'; }
    var glisse = edit && !apercu;
    function chip(k, centre, libre, gl) {
      return '<button type="button" title="' + esc(libColis(k)) + '" data-bois="' + (Math.abs(hashBois(k.id)) % 6) + '" class="chip' + (centre ? ' centre' : '') + (gl && glisse ? ' gl' : '') + (selection === k.id && edit ? ' sel' : '') + (apercu && apercu.bouges.indexOf(k.id) >= 0 ? ' bouge' : '') + '" data-c="' + esc(k.id) + '" style="' + (libre ? 'width:' + Math.max(48, Math.round(k.cm / maxLen * 300)) + 'px' : w(k.cm)) + '"' + (edit ? '' : ' disabled') + ' aria-label="' + esc(libColis(k) + (centre ? ', au centre' : '')) + '">' +
        '<b>' + fm(k.lo) + ' m</b><small>' + fm(k.ep) + '×' + fm(k.la) + '</small></button>';
    }
    function htmlVide(cm, attr) { return '<i class="vide" ' + attr + ' style="' + styleVide(cm) + '">' + txtVide(cm) + '</i>'; }
    var h = '<div class="sum ' + st.cls + '"><span class="sum-g"><span class="tot">' + f2(v.total) + '<small>' + (c.parentId ? ' m³ · remorque ' + (c.rem + 1) : '/ ' + fm(r.cible) + ' m³') + '</small></span><span class="etq">' + esc(st.etq) + '</span></span>' +
      '<span class="gd">Gauche <b>' + f2(v.volG) + '</b><br>Droite <b>' + f2(v.volD) + '</b></span></div>';
    if (st.detail) h += (st.court && !opts.lecture)
      ? '<p class="statut-detail"><span class="court">' + esc(st.court) + '</span> <button type="button" class="pourquoi" data-pourquoi="1">Pourquoi ?</button><span class="detail-long">' + esc(st.detail) + '</span></p>'
      : '<p class="statut-detail ouvert"><span class="detail-long">' + esc(st.detail) + '</span></p>';
    if (v.cote.length) {
      h += '<div class="tray"><div class="tray-chips">' + v.cote.map(function (k) { return chip(k, false, true); }).join('') + '</div>' +
        '<p><b>' + v.cote.length + ' colis de côté.</b> ' + (selCote ? 'Touche + au bout d\'un étage, ou un colis pour le poser devant.' : 'Touche-en un pour le reposer.') + '</p></div>';
    }
    ['G', 'D'].forEach(function (s) {
      h += '<section class="cote"><div class="cote-t"><span class="hl ' + (s === 'G' ? 'bleu' : 'rose') + '">' + NOMS[s] + '</span><small>' + f2(s === 'G' ? v.volG : v.volD) + ' m³</small></div><div class="rangs">';
      ETG.forEach(function (f) {
        var ro = v.rows[s + f], lgAff = ro.m;
        h += '<div class="rang' + (ro.alerte ? ' ko' : '') + '"><div class="tag">É' + f + '<b>@LG@</b>@LIB@</div><div class="trk"><i class="lim" style="left:calc(2px + (100% - ' + (4 + place) + 'px) * ' + (r.e1Max * 100 / maxLen).toFixed(4) + ')"></i>';
        if (f === N) {
          var c3 = v.rows['C' + N], maxPaire = Math.max(v.rows['G' + N].len, v.rows['D' + N].len);
          var E = maxPaire + c3.ext, sup = Math.min(v.rows['G' + (N - 1)].len, v.rows['D' + (N - 1)].len);
          var ggC = gapsRow(c, v, 'C' + N), aMainC = c3.colis.some(function (k) { return c.decal && c.decal[k.id] != null; });
          c3.colis.forEach(function (k, i) { if (aMainC) h += htmlVide(ggC[i], 'data-gap="' + esc(k.id) + '"'); h += chip(k, true, false, true); }); // colis du milieu, glissables
          var gg = gapsRow(c, v, s + f), fin = c3.ext;
          var aMain = ro.colis.some(function (k) { return c.decal && c.decal[k.id] != null; }); // vides seulement si l'utilisateur en a fait
          ro.colis.forEach(function (k, i) { if (aMain) h += htmlVide(gg[i], 'data-gap="' + esc(k.id) + '"'); fin += gg[i] + k.cm; h += chip(k, false, false, true); });
          if (ro.colis.length && aMain) h += htmlVide(Math.max(0, v.rows[s + (f - 1)].ext - fin), 'data-fin="' + s + f + '"');
          lgAff = E / 100;
        } else { // chaque étage se règle à la main en glissant
          var ggD = gapsRow(c, v, s + f), finD = 0, aMainD = ro.colis.some(function (k) { return c.decal && c.decal[k.id] != null; });
          ro.colis.forEach(function (k, i) { if (aMainD) h += htmlVide(ggD[i], 'data-gap="' + esc(k.id) + '"'); finD += ggD[i] + k.cm; h += chip(k, false, false, true); });
          lgAff = ro.ext / 100;
          if (ro.colis.length && aMainD) h += htmlVide(Math.max(0, (f > 1 ? Math.min(Math.round(r.e1Max * 100), v.rows[s + (f - 1)].ext) : Math.round(r.e1Max * 100)) - finD), 'data-fin="' + s + f + '"');
        }
        // place libre : É1 par rapport à la remorque, É2 par rapport à É1, É3 par rapport à É2
        var occ = ro.ext + (f === N ? v.rows['C' + N].ext : 0);
        var libre = (f > 1 ? Math.min(Math.round(r.e1Max * 100), v.rows[s + (f - 1)].ext) : Math.round(r.e1Max * 100)) - occ;
        var mainIci = ro.colis.some(function (k) { return c.decal && c.decal[k.id] != null; });
        if (!(edit && (selection || selEtr)) && libre >= 30 && !mainIci) {
          h += '<i class="libre-txt" style="left:calc(2px + (100% - ' + (4 + place) + 'px) * ' + (occ / maxLen).toFixed(4) + ');width:calc((100% - ' + (4 + place) + 'px) * ' + (libre / maxLen).toFixed(4) + ' - 2px)"></i>';
          h = h.replace('@LIB@', '<em class="tag-libre">' + fm(Math.round(libre) / 100) + ' m libre</em>');
        }
        h = h.replace('@LIB@', '');
        if (edit && (selection || selEtr)) {
          h += '<button type="button" class="poser" data-poser="' + s + f + '" aria-label="Poser ici">+' + (libre >= 50 ? '<small>' + fm(Math.round(libre) / 100) + ' m libre</small>' : '') + '</button>';
        }
        h = h.replace('@LG@', fm(Math.round(lgAff * 100) / 100) + ' m');
        h += '</div></div>';
      });
      h += remorqueHtml(c) + '<div class="sens"><span></span><span class="hl gris">Arrière</span></div></div></section>';
    });
    var legMil = v.rows['C' + N].colis.length ? '<span class="leg-mil"><span>MILIEU</span> = colis à cheval sur les 2 côtés</span>' : '';
    if (!edit && legMil) h += '<p class="aide-l">' + legMil + '</p>';
    if (edit) {
      var sel = selection && P.colisDe(c.lignes).filter(function (k) { return k.id === selection; })[0];
      var auMil = sel && (c.plan || {})[sel.id] === 'C' + N, dejaMil = v.rows['C' + N].colis.length > 0;
      if (apercu) h += '<div class="barre-sel bs1"><span class="bs-t" style="white-space:normal">' + (apercu.alerte ? '<b class="orange">⚠ ' + esc(apercu.alerte) + '</b><br>Dernier étage réorganisé.' : (apercu.bouges.length ? 'Dernier étage réorganisé : colis <b class="vert">BOUGÉ</b>.' : 'Colis au milieu.')) + '</span><button type="button" class="btn petit btn-valider" data-apok="1">Valider</button><button type="button" class="btn sec petit" data-apno="1">Annuler</button></div>';
      else if (sel && !selCote) h += '<div class="barre-sel bs1"><span class="bs-t"><b>' + esc(libColis(sel)) + '</b></span>' +
        (auMil ? '<button type="button" class="btn sec petit" data-decote="1">Sortir</button>'
               : '<button type="button" class="btn petit btn-mil" data-milieu="1">' + (dejaMil ? '+ Milieu' : 'Milieu') + '</button><button type="button" class="btn sec petit" data-decote="1">De côté</button>') +
        (c.parentId ? '<button type="button" class="btn sec petit bs-rem" data-verem="1">' + (c.rem ? '← Rem. 1' : '→ Rem. 2') + '</button>' : '') +
        '<button type="button" class="btn sec petit bs-sup" data-suppr="1">Supprimer</button>' +
        '<button type="button" class="x" data-annuler="1" aria-label="Annuler">×</button></div>';
      else if (sel) h += '<div class="barre-sel bs1"><span class="bs-t"><b>' + esc(libColis(sel)) + '</b> · touche + pour le poser</span><button type="button" class="btn sec petit bs-sup" data-suppr="1">Supprimer</button><button type="button" class="x" data-annuler="1" aria-label="Annuler">×</button></div>';
      else h += '<div class="aide-l">' + (legMil || '<span>' + (N === 4 ? '4 étages (surtout du 18×100). ' : '') + 'Touche un colis pour le déplacer. ' + (c.parentId ? 'Glisse-le pour le décaler.' : 'Glisse ceux du dernier étage.') + '</span>') + '<span class="leg-libre"><i></i>Place libre : jusqu\'au bout de l\'étage du dessous (É1 : jusqu\'au bout de la remorque)</span>' +
        ((c.planManuel || c.planVariante) ? '<button type="button" class="btn-lien recalc" data-recalc="1">Plan de départ</button>' : '') + '</div>';
      if (sel && (c.planManuel || c.planVariante)) h += '<button type="button" class="btn-lien recalc" data-recalc="1">Plan de départ</button>';
    }
    return h;
  }

  var planGeo = { maxLen: 1300, place: 0 };
  function styleVide(cm) { return cm > 0 ? 'width:calc((100% - ' + (4 + planGeo.place) + 'px) * ' + (cm / planGeo.maxLen).toFixed(4) + ' - 2px)' : 'width:0;margin-left:-2px'; }
  function txtVide(cm) { if (cm < 30) return ''; return fm(Math.round(cm) / 100) + ' m libre'; } // raccourci à l'affichage si la place manque
  var selRem = null, selEtr = false; // double : remorque où le colis choisi a été pris
  function rendrePlanVue() {
    var base = courantBase(), dbl = base.double;
    $('#v-plan h1').textContent = dbl ? 'Remorque ' + ((dbl.actif || 0) + 1) : 'Plan';
    $('#btnTerminer').textContent = dbl && !(dbl.actif || 0) ? '2ème plan →' : 'Terminer';
    $('#btnLongueur').hidden = !!dbl; if (!dbl) $('#btnLongueur').innerHTML = '<small>Longueur</small><b>' + fm(cfgC(base).e1Max) + ' m</b>';
    if (dbl && besoinSplit(base)) {
      $('#planZone').innerHTML = '<div class="calcul-plan"><span class="spin"></span>Calcul des 2 remorques…</div>';
      setTimeout(function () { splitDouble(base); toucher(base); selection = null; selRem = null; if (vueActive === 'plan') rendrePlanVue(); }, 40);
      return;
    }
    if (dbl && selection && selRem == null) selRem = dbl.actif || 0;
    if (!selection) selRem = null;
    selEtr = !!(dbl && selection && selRem !== (dbl.actif || 0));
    var c = courant(), ro = !estAMoi(c);
    document.body.classList.toggle('plan-ro', ro);
    $('#piedRo').hidden = !ro; $('#piedPlan').hidden = ro;
    if (ro) { assurerPlan(c); $('#planZone').innerHTML = '<p class="verrou">🔒 Plan de ' + esc(prenomDe(c)) + ' : lecture seule.</p>' + htmlPlan(c, { lecture: true }); ajusterPlan(); return; }
    // le plan doit toujours être bon : on le refait s'il est faux ou incomplet (sauf modification à la main)
    var v = vplan(c);
    var besoin = c.lignes.length && (v.nonPlaces.length || (!c.planManuel && c.tientEssaye !== sigLignes(c.lignes) && !P.tient(v, cfgC(c))) || (!c.planCalcule && !c.planManuel && (P.noteVerif(v) >= 1000 || (!c.planVariante && P.deseq(v) > reg().ecartMax + 0.005))));
    if (besoin) {
      $('#planZone').innerHTML = '<div class="calcul-plan"><span class="spin"></span>Calcul du meilleur plan…</div>';
      setTimeout(function () { calculerPlan(c); toucher(c); if (vueActive === 'plan') { $('#planZone').innerHTML = htmlPlan(c, {}); ajusterPlan(); } }, 40);
      return;
    }
    $('#planZone').innerHTML = htmlPlanVue(c, base);
    ajusterPlan();
  }
  // Plan affiché : pour un double, onglets des 2 remorques + total, et le colis pris dans l'autre remorque
  function htmlPlanVue(c, base) {
    if (!base.double) return htmlPlan(c, {});
    var dbl = base.double, a = dbl.actif || 0, sel = selection, h = '';
    h += '<div class="rem-tete"><div class="rem-onglets">' + [0, 1].map(function (i) { return '<button type="button" data-rem="' + i + '" class="' + (i === a ? 'on' : '') + '">Remorque ' + (i + 1) + '<small>' + fm(dbl.lg[i]) + ' m · ' + f2(dbl.r[i].total_m3 || 0) + ' m³</small></button>'; }).join('') + '</div>' +
      '<p class="rem-tot">Total 2 remorques <b>' + f2(base.total_m3) + ' m³</b> / ' + fm(cfgC(base).cible) + ' · glisse pour changer</p></div>';
    if (selEtr) {
      var o = dbl.r[selRem], k = o && P.colisDe(o.lignes).filter(function (x) { return x.id === sel; })[0];
      h += '<div class="barre-sel bs1 rem-etr"><span class="bs-t"><b>' + (k ? esc(libColis(k)) : 'Colis') + '</b> (remorque ' + (selRem + 1) + ') · touche un colis pour échanger, ou + pour le poser</span><button type="button" class="x" data-annuler="1" aria-label="Annuler">×</button></div>';
      selection = null;
    }
    h += htmlPlan(c, {});
    selection = sel;
    return h;
  }
  function changerRem(i) {
    var base = courantBase(); if (!base.double || !base.double.r) return;
    if (apercu) finApercu(courant(), false);
    base.double.actif = i; sauver(true);
    rendrePlanVue(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  // Colis d'une remorque à l'autre
  function infoColis(s, id) {
    var k = P.colisDe(s.lignes).filter(function (x) { return x.id === id; })[0]; if (!k) return null;
    if (!s.ordre) fixerOrdre(s);
    return { ligne: s.lignes.filter(function (l) { return l.id === k.ligneId; })[0], row: (s.plan || {})[id], pos: s.ordre.indexOf(id), k: k };
  }
  function poserDans(s, ligne, row, pos) {
    if (!s.ordre) fixerOrdre(s);
    var l = s.lignes.filter(function (x) { return x.id === ligne.id; })[0], nid;
    if (l) { nid = l.id + '#' + (l.nb || 1); l.nb = (l.nb || 1) + 1; }
    else { var x = Object.assign({}, ligne); x.nb = 1; s.lignes.push(x); nid = x.id + '#0'; }
    s.plan = Object.assign({}, s.plan || {}); s.plan[nid] = row;
    if (!(pos >= 0) || pos > s.ordre.length) pos = s.ordre.length;
    s.ordre.splice(pos, 0, nid); s.planManuel = true;
    return nid;
  }
  function deplacerVersAutre(base, from, id) {
    var A = base.double.r[from], B = base.double.r[1 - from], ia = infoColis(A, id); if (!ia) return;
    supprimerColis(A, function (x) { return x === id; });
    var nid = poserDans(B, ia.ligne, 'X', -1); toucher(B);
    base.double.actif = 1 - from; selection = nid; selRem = 1 - from;
    rendrePlanVue(); window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Colis passé en remorque ' + (2 - from) + ' : touche + pour le poser');
  }
  function echangerEntre(base, ra, ida, rb, idb) {
    var A = base.double.r[ra], B = base.double.r[rb], ia = infoColis(A, ida), ib = infoColis(B, idb);
    if (!ia || !ib) { selection = null; return; }
    supprimerColis(A, function (x) { return x === ida; }); supprimerColis(B, function (x) { return x === idb; });
    var pb = ib.row === 'X' ? -1 : ib.pos, pa = ia.row === 'X' ? -1 : ia.pos;
    poserDans(B, ia.ligne, ib.row, pb); poserDans(A, ib.ligne, ia.row, pa);
    if (A.decal) A.decal = null; if (B.decal) B.decal = null;
    toucher(A); toucher(B); selection = null; selRem = null;
    var msg = []; [A, B].forEach(function (s) { alertesCourtes(s, vplan(s)).forEach(function (t) { msg.push('Remorque ' + (s.rem + 1) + ' : ' + t); }); });
    if (msg.length) toastRouge(msg[0]); else toast('Colis échangés entre les 2 remorques ✔');
  }
  function poserVenantDe(base, from, id, row) {
    var A = base.double.r[from], B = courant(), ia = infoColis(A, id); if (!ia) return;
    supprimerColis(A, function (x) { return x === id; });
    var nid = poserDans(B, ia.ligne, 'X', -1); selRem = null;
    placer(B, nid, row);
  }
  // Le plan tient sur un écran : hauteur des étages calculée selon la place du téléphone, textes resserrés si besoin
  var RH_MAX = 48, RH_MIN = 30, RH_GRAND = 64;
  function raccourcirVides(zone) { // texte des places libres : toujours lisible, jamais coupé
    $$('i.vide', zone).forEach(function (el) {
      var plein = el.textContent; if (el.dataset.t && el.dataset.t.indexOf(plein) === 0 && plein.length < el.dataset.t.length) plein = el.dataset.t; el.dataset.t = plein; if (!plein) return;
      var m = plein.replace(' libre', ''), essais = [plein, m, m.replace(' m', ''), ''];
      for (var i = 0; i < essais.length; i++) { el.textContent = essais[i]; if (el.scrollWidth <= el.clientWidth + 1) break; }
    });
  }
  function ajusterPlan() {
    var z = $('#planZone'); if (!z || vueActive !== 'plan') return;
    requestAnimationFrame(function () { raccourcirVides(z); });
    var sm = $('.sum', z);
    if (sm && window.Vue3D && !$('.btn-3d', z)) {
      var b3 = document.createElement('button'); b3.type = 'button'; b3.className = 'btn-3d';
      b3.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"><path d="M12 2 3 7v10l9 5 9-5V7z"/><path d="M3 7l9 5 9-5M12 12v10"/></svg>Voir le camion en 3D';
      b3.onclick = function (e) { e.stopPropagation(); ouvrir3D(); };
      sm.appendChild(b3); // petit bouton 3D sur la ligne du volume : la page gagne de la place
    }
    var n = $$('.rang:not(.rang-ch)', z).length || 6;
    z.style.setProperty('--rh', RH_MAX + 'px');
    var trop = z.scrollHeight - z.clientHeight;
    if (trop > 0) z.style.setProperty('--rh', Math.max(RH_MIN, RH_MAX - Math.ceil(trop / n)) + 'px');
    else if (z.lastElementChild) { // grand écran : les étages s'agrandissent pour remplir la place
      var libre = z.clientHeight - (z.lastElementChild.getBoundingClientRect().bottom - z.getBoundingClientRect().top + z.scrollTop);
      if (libre > n) z.style.setProperty('--rh', Math.min(RH_GRAND, RH_MAX + Math.floor(libre / n)) + 'px');
    }
    $$('.chip', z).forEach(function (ch) {
      ch.classList.remove('serre', 'mini');
      if (ch.scrollWidth > ch.clientWidth + 1) {
        ch.classList.add('serre');                                          // texte resserré
        if (ch.scrollWidth > ch.clientWidth + 1) ch.classList.add('mini'); // encore plus petit, mais jamais caché
      }
    });
  }
  var minuterieAjust = null;
  window.addEventListener('resize', function () { clearTimeout(minuterieAjust); minuterieAjust = setTimeout(ajusterPlan, 120); });

  function echanger(c, a, b) {
    var plan = Object.assign({}, c.plan || {}), ra = plan[a], rb = plan[b];
    if (!ra || !rb) { selection = null; return toast('Échange impossible.'); }
    var avant = alertesCourtes(c, vplan(c));
    plan[a] = rb; plan[b] = ra;
    if (!c.ordre) fixerOrdre(c);
    var ia = c.ordre.indexOf(a), ib = c.ordre.indexOf(b); c.ordre[ia] = b; c.ordre[ib] = a; // chacun prend la place de l'autre
    if (c.decal) { var da = c.decal[a], dbb = c.decal[b]; delete c.decal[a]; delete c.decal[b]; if (dbb != null) c.decal[a] = dbb; if (da != null) c.decal[b] = da; }
    c.plan = plan; c.planManuel = true; selection = null; toucher(c);
    alerterApres(c, avant, 'Colis échangés');
  }
  // place le colis id dans la rangée k, juste avant le colis avant (ou au bout de la rangée)
  function placer(c, id, k, avant) {
    var v = c.ordre ? vplan(c) : fixerOrdre(c), al = alertesCourtes(c, v);
    if (c.decal) delete c.decal[id];
    c.plan = Object.assign({}, c.plan); c.plan[id] = k;
    var o = c.ordre.filter(function (x) { return x !== id; });
    if (avant) o.splice(o.indexOf(avant), 0, id);
    else {
      var der = v.rows[k].colis.filter(function (x) { return x.id !== id; }).pop();
      if (der) o.splice(o.indexOf(der.id) + 1, 0, id); else o.push(id);
    }
    c.ordre = o; c.planManuel = true; selection = null; toucher(c);
    alerterApres(c, al);
  }

  // Met le colis au milieu (à cheval sur les 2 côtés, au dernier étage, tout devant)
  // ---------- Colis au MILIEU : 1 seul, à cheval, tout devant ----------
  var apercu = null; // solution proposée, affichée en attendant « Valider » ou « Annuler »
  // Milieu : on réorganise seulement le dernier étage (conducteur + passager) autour du colis du milieu.
  // Seule règle stricte : le dernier étage ne doit pas être plus long que les étages 2 (en dessous).
  function noteMilieu(v) {
    var em = reg().ecartMax, d = P.deseq(v);
    return (d > em + 0.005 ? 500 * (d - em) : 0) + P.noteVerif(v);
  }
  function auMilieu(c, id) {
    if (!c.ordre) fixerOrdre(c);
    var v1 = vplan(c), N = v1.N, k = 'C' + N, plan0 = Object.assign({}, c.plan || {}), ordre = c.ordre.slice();
    var haut = Object.keys(plan0).filter(function (x) { return x !== id && (plan0[x] === 'G' + N || plan0[x] === 'D' + N); }); // les colis déjà au milieu y restent
    var base = Object.assign({}, plan0); base[id] = k;
    var errAvant = v1.erreurs.slice(), best = null, pire = null, nb = Math.min(haut.length, 14);
    for (var m = 0; m < (1 << nb); m++) {
      var q = Object.assign({}, base);
      haut.forEach(function (x, i) { q[x] = i < nb ? ((m >> i) & 1 ? 'D' + N : 'G' + N) : plan0[x]; });
      var v = P.verifier(c.lignes, q, cfgC(c), ordre);
      var nouv = v.erreurs.filter(function (e) { return errAvant.indexOf(e) < 0; });
      var bouges = haut.filter(function (x) { return q[x] !== plan0[x]; });
      var n = noteMilieu(v) + bouges.length * 0.01;
      if (nouv.length) { if (!pire || nouv.length < pire.nouv.length) pire = { nouv: nouv }; continue; }
      if (!best || n < best.n) best = { n: n, p: q, v: v, b: bouges };
    }
    selection = null;
    if (!best) { toastRouge('Impossible au milieu : ' + (pire ? pire.nouv[0].replace(/\.$/, '') + '.' : 'le plan ne serait plus bon.')); return; }
    var alerte = alerteMilieu(best.v);
    if (!best.b.length && !alerte) { appliquerMilieu(c, best.p, ordre, 'Colis mis au MILIEU, tout devant'); return; }
    apercu = { c: c, avant: { plan: c.plan, ordre: c.ordre, man: c.planManuel }, bouges: best.b, alerte: alerte };
    c.plan = best.p; c.ordre = ordre; c.planManuel = true;
  }
  function alerteMilieu(v) {
    var em = reg().ecartMax, d = Math.abs(v.ecart);
    if (v.ecart < -0.005) return 'côté passager plus lourd de ' + f2(-v.ecart) + ' m³';
    if (d > em + 0.005) return 'écart ' + f2(d) + ' m³ (max ' + f2(em) + ')';
    var lg = P.ecartLg(v); if (lg > P.ECART_LG) return f2(lg / 100) + ' m d\'écart de longueur gauche/droite';
    return '';
  }
  function appliquerMilieu(c, plan, ordre, msg) { c.decal = null; c.plan = plan; c.ordre = ordre; c.planManuel = true; toucher(c); toast(msg); }
  function raisonMilieu(v) {
    var e = v.erreurs[0];
    if (e) return e.replace(/\.$/, '') + '.';
    if (v.ecart < -0.005) return 'le côté passager deviendrait plus lourd que le côté conducteur.';
    if (P.deseq(v) > reg().ecartMax + 0.005) return 'le camion serait déséquilibré (' + f2(P.deseq(v)) + ' m³ d\'écart, max ' + f2(reg().ecartMax) + ').';
    if (P.ecartLg(v) > P.ECART_LG) return 'trop d\'écart de longueur entre gauche et droite.';
    return 'le plan ne serait plus bon.';
  }
  function toastRouge(msg, ms) { ms = ms || 4200; toast(msg); $('#toast').classList.add('rouge'); setTimeout(function () { $('#toast').classList.remove('rouge'); }, ms); clearTimeout(toastMin); toastMin = setTimeout(function () { $('#toast').hidden = true; }, ms); }
  function finApercu(c, garder) {
    if (!apercu) return;
    c = apercu.c;
    if (garder) { c.decal = null; toucher(c); toast('Colis mis au MILIEU ✔'); }
    else { c.plan = apercu.avant.plan; c.ordre = apercu.avant.ordre; c.planManuel = apercu.avant.man; }
    apercu = null;
  }
  $('#btnRecupPlan').addEventListener('click', function () { var c = courant(); if (!estAMoi(c)) copierCamion(c, true); });
  $('#planZone').addEventListener('click', function (e) {
    var c = courant();
    if (!estAMoi(c)) return; // camion d'un collègue : lecture seule
    if (glisseFini) { glisseFini = false; return; }
    if (e.target.closest('[data-annuler]')) { selection = null; rendrePlanVue(); return; }
    var base = courantBase(), dbl = base.double;
    if (dbl) {
      var tr = e.target.closest('[data-rem]'); if (tr) { changerRem(+tr.dataset.rem); return; }
      if (e.target.closest('[data-verem]') && selection && !apercu) { deplacerVersAutre(base, dbl.actif || 0, selection); return; }
      if (selEtr && selection && !apercu) { // colis choisi dans l'autre remorque
        var poE = e.target.closest('[data-poser]'), chE = e.target.closest('.chip');
        if (poE) { poserVenantDe(base, selRem, selection, poE.dataset.poser); rendrePlanVue(); return; }
        if (chE) { echangerEntre(base, selRem, selection, dbl.actif || 0, chE.dataset.c); rendrePlanVue(); return; }
        return;
      }
    }
    var selAvant = selection;
    if (e.target.closest('[data-suppr]') && selection && !apercu) {
      var idS = selection, kS = P.colisDe(c.lignes).filter(function (k) { return k.id === idS; })[0], ph = photoCamion(c);
      if (!c.ordre) fixerOrdre(c);
      supprimerColis(c, function (x) { return x === idS; });
      rendrePlanVue();
      toast('Colis supprimé' + (kS ? ' : ' + libColis(kS) : ''), function () { remettrePhoto(c, ph); rendrePlanVue(); }, 'Annuler');
      return;
    }
    var pq = e.target.closest('[data-pourquoi]');
    if (pq) { var sd = pq.closest('.statut-detail'); sd.classList.toggle('ouvert'); pq.textContent = sd.classList.contains('ouvert') ? 'Masquer' : 'Pourquoi ?'; ajusterPlan(); return; }
    if (e.target.closest('[data-recalc]')) {
      c.decal = null;
      if (c.planDepart) { c.plan = JSON.parse(JSON.stringify(c.planDepart.plan)); c.ordre = null; c.planManuel = false; c.planVariante = false; c.planCalcule = true; }
      else calculerPlan(c);
      toucher(c); selection = null; rendrePlanVue(); toast('Meilleur plan remis'); return;
    }
    if (apercu) {
      if (e.target.closest('[data-apok]')) { finApercu(c, true); rendrePlanVue(); }
      else if (e.target.closest('[data-apno]')) { finApercu(c, false); rendrePlanVue(); }
      return; // pendant l'aperçu, on ne touche à rien d'autre
    }
    if (e.target.closest('[data-milieu]') && selection) { auMilieu(c, selection); rendrePlanVue(); return; }
    if (e.target.closest('[data-decote]') && selection) {
      if (!c.ordre) fixerOrdre(c);
      c.plan = Object.assign({}, c.plan); c.plan[selection] = 'X'; if (c.decal) delete c.decal[selection]; c.planManuel = true; selection = null; toucher(c);
      rendrePlanVue(); return;
    }
    var po = e.target.closest('[data-poser]');
    if (po && selection) { placer(c, selection, po.dataset.poser); rendrePlanVue(); return; }
    var ch = e.target.closest('.chip'); if (!ch) return;
    var id = ch.dataset.c, plan = c.plan || {};
    if (!selection) selection = id;
    else if (selection === id) selection = null;
    else if (plan[id] === 'X') selection = id;                                  // on choisit un autre colis de côté
    else if (plan[selection] === 'X') placer(c, selection, plan[id], id);      // on pose devant ce colis
    else echanger(c, selection, id);
    if (dbl && selection && selection !== selAvant) selRem = dbl.actif || 0;
    rendrePlanVue();
  });
  // Double : glisser à gauche / à droite pour changer de remorque
  (function () {
    var t0 = null;
    $('#planZone').addEventListener('touchstart', function (e) {
      var b = courantBase(); t0 = null;
      if (!b.double || e.touches.length !== 1 || e.target.closest('.chip.gl')) return;
      var t = e.touches[0]; if (t.clientX < 30) return;
      t0 = { x: t.clientX, y: t.clientY };
    }, { passive: true });
    $('#planZone').addEventListener('touchend', function (e) {
      if (!t0 || gl) { t0 = null; return; }
      var t = e.changedTouches[0], dx = t.clientX - t0.x, dy = t.clientY - t0.y; t0 = null;
      if (Math.abs(dx) < 70 || Math.abs(dy) > 50) return;
      var b = courantBase(), a = b.double.actif || 0;
      if (dx < 0 && a === 0) changerRem(1); else if (dx > 0 && a === 1) changerRem(0);
    }, { passive: true });
  })();
  // ---------- Dernier étage : glisser un colis vers la cabine ou l'arrière (pas de 50 cm) ----------
  var gl = null, glisseFini = false;
  $('#planZone').addEventListener('pointerdown', function (e) {
    var ch = e.target.closest('.chip.gl'); if (!ch || apercu) return;
    var c = courant(); if (!estAMoi(c)) return;
    var v = vplan(c), id = ch.dataset.c, k = c.plan && c.plan[id]; if (!k || !v.rows[k]) return;
    var cs = v.rows[k].colis, i = cs.map(function (x) { return x.id; }).indexOf(id); if (i < 0) return;
    var trk = ch.parentNode, lu = (trk.clientWidth - 4 - planGeo.place) / planGeo.maxLen; // px par cm
    var fl = +k.slice(1), mxC = Math.round(cfgC(c).e1Max * 100);
    var mil = k.charAt(0) === 'C';
    var gaps = gapsRow(c, v, k), fin = (fl === v.N && !mil ? v.rows['C' + v.N].ext : 0) + cs.reduce(function (a2, x, j) { return a2 + x.cm + gaps[j]; }, 0);
    var finSup = mil ? Math.min(mxC, v.rows['G' + (fl - 1)].ext, v.rows['D' + (fl - 1)].ext) - Math.max(v.rows['G' + fl].ext, v.rows['D' + fl].ext)
      : (fl > 1 ? Math.min(mxC, v.rows[k.charAt(0) + (fl - 1)].ext) : mxC);
    var cote = null; // colis du MILIEU : les colis de gauche et de droite de cet étage ne doivent pas bouger
    if (mil) { cote = []; ['G', 'D'].forEach(function (s2) { var rr = v.rows[s2 + fl]; if (rr && rr.colis.length) cote.push({ id: rr.colis[0].id, g: gapsRow(c, v, s2 + fl)[0] || 0, k: s2 + fl, cs: rr.colis, gg: gapsRow(c, v, s2 + fl) }); }); }
    gl = { c: c, k: k, id: id, i: i, cs: cs, g0: gaps, fin0: fin, finSup: finSup, mil: mil, cote: cote, x0: e.clientX, y0: e.clientY, lu: lu, d: 0, actif: false, ch: ch, pid: e.pointerId, trk: trk };
  });
  window.addEventListener('pointermove', function (e) {
    if (!gl || e.pointerId !== gl.pid) return;
    var dx = e.clientX - gl.x0;
    if (!gl.actif) {
      var dyA = Math.abs(e.clientY - gl.y0);
      if (dyA >= 14 && dyA > Math.abs(dx) * 1.2) { gl = null; return; } // geste vertical : ce n'est pas un glissement
      if (Math.abs(dx) < 6 || Math.abs(dx) < dyA) return;
      gl.actif = true; gl.ch.classList.add('glisse'); try { gl.ch.setPointerCapture(gl.pid); } catch (er) {}
      if (!$('[data-gap]', gl.trk)) { // 1er glissement sur cet étage : on fait apparaître les vides
        var der = null;
        gl.cs.forEach(function (x, j) { var el = $('.chip.gl[data-c="' + cssEsc(x.id) + '"]', gl.trk); if (!el) return; var iv = document.createElement('i'); iv.className = 'vide'; iv.setAttribute('data-gap', x.id); iv.setAttribute('style', styleVide(gl.g0[j])); el.parentNode.insertBefore(iv, el); der = el; });
        if (der) { var fv = document.createElement('i'); fv.className = 'vide'; fv.setAttribute('data-fin', gl.k); var rs = Math.max(0, gl.finSup - gl.fin0); fv.setAttribute('style', styleVide(rs)); fv.textContent = txtVide(rs); der.parentNode.insertBefore(fv, der.nextSibling); }
      }
    }
    e.preventDefault();
    // le colis suit le doigt en continu ; il se cale au 50 cm le plus proche quand on lâche
    var dRaw = dx / gl.lu, r = nouveauxVides(gl, dRaw), rs = nouveauxVides(gl, Math.round(dRaw / 50) * 50);
    gl.d = rs.d; gl.gg = rs.gg;
    var trk = gl.trk;
    gl.cs.forEach(function (x, j) { var el = $('[data-gap="' + cssEsc(x.id) + '"]', trk); if (el) { el.setAttribute('style', styleVide(r.gg[j])); el.textContent = txtVide(rs.gg[j]); } });
    var fe = $('[data-fin]', trk);
    if (fe) { fe.setAttribute('style', styleVide(Math.max(0, gl.finSup - r.fin))); fe.textContent = txtVide(Math.max(0, gl.finSup - rs.fin)); }
    raccourcirVides(trk);
  }, { passive: false });
  // Vers l'arrière : le colis avance jusqu'au suivant, sans le pousser.
  // Vers la cabine : seul ce colis avance, les suivants ne bougent pas.
  function nouveauxVides(g, d) {
    var gg = g.g0.slice(), i = g.i, n = gg.length, lim = Math.max(planGeo.maxLen, g.fin0);
    if (d < 0) { d = Math.max(d, -gg[i]); gg[i] += d; if (i + 1 < n) gg[i + 1] -= d; }
    else if (d > 0) {
      // les colis de derrière ne bougent jamais : on s'arrête contre le suivant (ou au bout de la remorque pour le dernier)
      var libre = i + 1 < n ? gg[i + 1] : (g.mil && g.cote.length ? Math.min.apply(null, g.cote.map(function (x) { return x.g; })) : Math.max(0, lim - g.fin0));
      d = Math.min(d, libre); gg[i] += d; if (i + 1 < n) gg[i + 1] -= d;
    }
    var fin = g.fin0 + gg.reduce(function (s, x) { return s + x; }, 0) - g.g0.reduce(function (s, x) { return s + x; }, 0);
    return { d: d, gg: gg, fin: fin };
  }
  function finGlisse(e) {
    if (!gl || (e && e.pointerId !== gl.pid)) return;
    var g = gl; gl = null;
    if (!g.actif) return;
    glisseFini = true; setTimeout(function () { glisseFini = false; }, 400);
    g.ch.classList.remove('glisse');
    if (!g.d) { rendrePlanVue(); return; }
    var c = g.c, al = alertesCourtes(c, vplan(c)), dec = Object.assign({}, c.decal || {}), gg = g.gg || g.g0;
    g.cs.forEach(function (x, j) { dec[x.id] = gg[j]; });
    if (g.mil && g.cote) { // le milieu a grandi ou rétréci : les colis de côté gardent exactement leur place
      var delta = gg.reduce(function (s3, x) { return s3 + x; }, 0) - g.g0.reduce(function (s3, x) { return s3 + x; }, 0);
      if (delta) g.cote.forEach(function (x) { x.cs.forEach(function (k3, j3) { dec[k3.id] = x.gg[j3] || 0; }); dec[x.id] = Math.max(0, x.g - delta); });
    }
    if (!c.ordre) fixerOrdre(c);
    c.decal = dec; c.planManuel = true; selection = null; toucher(c);
    rendrePlanVue(); alerterApres(c, al);
  }
  window.addEventListener('pointerup', finGlisse);
  window.addEventListener('pointercancel', function (e) { if (gl && e.pointerId === gl.pid) { var g = gl; gl = null; if (g.actif) { g.ch.classList.remove('glisse'); rendrePlanVue(); } } });
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }
  // ---------- Ajouter un colis depuis le plan (page à part) ----------
  var ajout = { nb: 1 };
  $('#btnAjoutColis').addEventListener('click', function () {
    var c = courant(); if (!estAMoi(c)) return;
    if (apercu) { finApercu(c, false); }
    selection = null; ajout = { nb: 1 }; aller('ajout');
  });
  function rendreAjout() {
    var c = courant(), vus = {}, secs = [], lgs = [];
    c.lignes.forEach(function (l) {
      var k = l.ep + 'x' + l.la; if (!vus[k]) { vus[k] = 1; secs.push(l); }
      if (lgs.indexOf(l.lo) < 0) lgs.push(l.lo);
    });
    lgs.sort(function (x, y) { return x - y; });
    $('#ajoutZone').innerHTML = '<div class="carte ajout-carte">' +
      (secs.length ? '<p class="aj-t">Sections de ce camion</p><div class="aj-puces" id="ajSecs">' + secs.map(function (l) { return '<button type="button" data-ep="' + l.ep + '" data-la="' + l.la + '" data-pi="' + l.pi + '">' + fm(l.ep) + '×' + fm(l.la) + '</button>'; }).join('') + '</div>' : '') +
      '<div class="grille4">' +
      '<label class="champ"><span>Épaiss.</span><input id="aEp" inputmode="decimal" placeholder="mm" autocomplete="off"></label>' +
      '<label class="champ"><span>Largeur</span><input id="aLa" inputmode="decimal" placeholder="mm" autocomplete="off"></label>' +
      '<label class="champ"><span>Pièces</span><input id="aPi" inputmode="numeric" autocomplete="off"></label>' +
      '<label class="champ"><span>Long.</span><input id="aLo" inputmode="decimal" placeholder="m" autocomplete="off"></label></div>' +
      '<div class="aj-puces" id="ajLgs"></div>' +
      '<div class="apercu" id="ajApercu">Ce colis : <b>—</b></div>' +
      '<div class="ligne-btns"><div class="pas"><button type="button" id="ajMoins" aria-label="Moins">−</button><span><b id="ajNb">' + ajout.nb + '</b> colis</span><button type="button" id="ajPlus" aria-label="Plus">+</button></div>' +
      '<button type="button" class="btn" id="ajOk">Ajouter au plan</button></div>' +
      '<p class="petit-txt">Le colis arrive « de côté » : touche + dans le plan pour le poser où tu veux.</p></div>';
    function val(s) { return P.num($(s).value); }
    function lgsSection() {
      var sc = P.trouverSection(reg().sections, val('#aEp'), val('#aLa')), t = lgs.slice();
      if (sc && sc.lg) sc.lg.forEach(function (x) { if (t.indexOf(x) < 0) t.push(x); });
      (reg().longueurs || []).forEach(function (x) { if (t.indexOf(x) < 0) t.push(x); });
      t.sort(function (x, y) { return x - y; });
      $('#ajLgs').innerHTML = t.map(function (x) { return '<button type="button" data-lo="' + x + '"' + (Math.abs(val('#aLo') - x) < 1e-9 ? ' class="actif"' : '') + '>' + fLong(x) + ' m</button>'; }).join('');
    }
    function apercuAj() {
      var l = { ep: val('#aEp'), la: val('#aLa'), pi: val('#aPi'), lo: val('#aLo') }, vo = P.volLigne(l);
      $('#ajApercu').innerHTML = 'Ce colis : <b>' + (isFinite(vo) && vo > 0 ? f3(vo * ajout.nb) + ' m³' : '—') + '</b>';
    }
    function majSecAj() {
      var sc = P.trouverSection(reg().sections, val('#aEp'), val('#aLa'));
      if (sc && !$('#aPi').dataset.main) $('#aPi').value = sc.pi;
      lgsSection(); apercuAj();
    }
    ['#aEp', '#aLa'].forEach(function (s, i) { $(s).addEventListener('input', function () {
      $('#aPi').dataset.main = ''; majSecAj();
      // comme au début d'un chargement : on passe tout seul au champ suivant
      if (i === 0 && epComplete($(s).value)) $('#aLa').focus();
      if (i === 1 && laComplete($('#aEp').value, $(s).value)) $($('#aPi').value ? '#aLo' : '#aPi').focus();
    }); });
    ['#aEp', '#aLa', '#aPi', '#aLo'].forEach(function (s, i, t) { $(s).addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return; e.preventDefault();
      if (i === 1 && $('#aPi').value && !$('#aPi').dataset.main) $('#aLo').focus();
      else if (i < 3) $(t[i + 1]).focus(); else $('#ajOk').click();
    }); });
    $('#aPi').addEventListener('input', function () { this.dataset.main = '1'; apercuAj(); });
    $('#aLo').addEventListener('input', function () { lgsSection(); apercuAj(); });
    if ($('#ajSecs')) $('#ajSecs').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; $('#aEp').value = fm(+b.dataset.ep); $('#aLa').value = fm(+b.dataset.la); $('#aPi').value = b.dataset.pi; $('#aPi').dataset.main = ''; $$('#ajSecs button').forEach(function (x) { x.classList.toggle('actif', x === b); }); lgsSection(); apercuAj(); if (!$('#aLo').value) $('#aLo').focus(); };
    $('#ajLgs').onclick = function (e) { var b = e.target.closest('button'); if (!b) return; $('#aLo').value = fLong(+b.dataset.lo); lgsSection(); apercuAj(); };
    $('#ajMoins').onclick = function () { ajout.nb = Math.max(1, ajout.nb - 1); $('#ajNb').textContent = ajout.nb; apercuAj(); };
    $('#ajPlus').onclick = function () { ajout.nb = Math.min(20, ajout.nb + 1); $('#ajNb').textContent = ajout.nb; apercuAj(); };
    $('#ajOk').onclick = function () {
      var v = [val('#aEp'), val('#aLa'), val('#aPi'), val('#aLo')], bad = false;
      ['#aEp', '#aLa', '#aPi', '#aLo'].forEach(function (s, i) { var ok = isFinite(v[i]) && v[i] > 0 && (i !== 2 || Math.round(v[i]) === v[i]); $(s).classList.toggle('erreur', !ok); if (!ok && !bad) { bad = true; $(s).focus(); } });
      if (bad) { toast('Remplis épaisseur, largeur, pièces et longueur.'); return; }
      var c2 = courant(); assurerPlan(c2); if (!c2.ordre) fixerOrdre(c2);
      var l = { id: petitId(), ep: v[0], la: v[1], pi: v[2], lo: v[3], nb: ajout.nb };
      c2.lignes.push(l); c2.plan = Object.assign({}, c2.plan);
      for (var k = 0; k < ajout.nb; k++) { c2.plan[l.id + '#' + k] = 'X'; c2.ordre.push(l.id + '#' + k); }
      c2.planManuel = true; toucher(c2);
      var premier = l.id + '#0', n = ajout.nb;
      apresRetour = function () { selection = premier; rendrePlanVue(); toast(n > 1 ? n + ' colis ajoutés de côté : touche + pour les poser' : 'Colis ajouté de côté : touche + pour le poser'); };
      retour();
    };
    setTimeout(function () { if (vueActive === 'ajout' && !secs.length) $('#aEp').focus(); }, 120);
    lgsSection();
  }

  $('#btnPartager').addEventListener('click', function () { var c = courantBase(); if (!c.lignes.length) { toast('Aucun colis.'); return; } assurerPlan(c); choixPartage(c); });
  // ---------- Partager : fiche chauffeur (texte + image), image seule, texte copié ----------
  function texteChauffeur(c) {
    var v = vplan(c), d = new Date(c.termine_le || c.maj_le || Date.now());
    var dt = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
    var nb = c.lignes.reduce(function (a, l) { return a + (l.nb || 1); }, 0);
    var t = '🚛 ' + (c.client || 'Camion') + (c.reference ? ' · Réf. ' + c.reference : '') + '\n' +
      dt.charAt(0).toUpperCase() + dt.slice(1) + ' · ' + heure(d.toISOString()) + '\n' +
      'Total : ' + f2(v.total) + ' m³ · ' + nb + ' colis\n' +
      'Gauche ' + f2(v.volG) + ' · Droite ' + f2(v.volD) + '\n\n';
    c.lignes.forEach(function (l) { var n = l.nb || 1; t += '• ' + fm(l.ep) + '×' + fm(l.la) + ' · ' + fLong(l.lo) + ' m' + (n > 1 ? ' ×' + n : '') + ' — ' + f3(P.volTotalLigne(l)) + ' m³\n'; });
    return t + '\nSDC – Les Scieries du Centre';
  }
  // Fiche de chargement : en-tête, chiffres clés, tableau par section, puis le plan
  function ficheCanvas(c) { return ficheJolie(c, 'tout'); }
  function octets(dataUrl) { var bin = atob(dataUrl.split(',')[1]), arr = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i); return arr; }
  // PDF d'une page contenant l'image JPEG (pas de bibliothèque : le fichier est écrit à la main)
  function pdfDepuisJpeg(jpg, w, h) {
    var PW = 595.28, PH = Math.round(PW * h / w * 100) / 100, parts = [], pos = 0, offs = [];
    function add(t) { var b = typeof t === 'string' ? new TextEncoder().encode(t) : t; parts.push(b); pos += b.length; }
    function obj(n, corps, flux) { offs[n] = pos; add(n + ' 0 obj\n' + corps + (flux ? '\nstream\n' : '\nendobj\n')); if (flux) { add(flux); add('\nendstream\nendobj\n'); } }
    add('%PDF-1.4\n%\u00e2\u00e3\n');
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
    obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + PW + ' ' + PH + '] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>');
    var cs = 'q ' + PW + ' 0 0 ' + PH + ' 0 0 cm /Im0 Do Q';
    obj(4, '<< /Length ' + cs.length + ' >>', new TextEncoder().encode(cs));
    obj(5, '<< /Type /XObject /Subtype /Image /Width ' + w + ' /Height ' + h + ' /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ' + jpg.length + ' >>', jpg);
    var xref = pos, t = 'xref\n0 6\n0000000000 65535 f \n';
    for (var n = 1; n <= 5; n++) t += String(offs[n]).padStart(10, '0') + ' 00000 n \n';
    add(t + 'trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF');
    return new Blob(parts, { type: 'application/pdf' });
  }
  function nomFichier(c, ext) { return 'Fiche-' + ((c.client || 'camion').replace(/[^A-Z0-9]+/gi, '-')) + (c.reference ? '-' + c.reference : '') + '.' + ext; }
  function ligneCourte(c) { var nb = c.lignes.reduce(function (a, l) { return a + (l.nb || 1); }, 0); return '🚛 ' + (c.client || 'Camion') + (c.reference ? ' · Réf. ' + c.reference : '') + ' · ' + f2(c.total_m3) + ' m³ · ' + nb + ' colis'; }
  function envoyerFichier(fichier, texte, urlAff) {
    try {
      if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
        var data = { files: [fichier], text: texte }; if (!navigator.canShare(data)) data = { files: [fichier] };
        navigator.share(data).catch(function () {}); return;
      }
    } catch (e) {}
    var lien = URL.createObjectURL(fichier);
    var f = ouvrirFeuille('<h2>' + esc(fichier.name) + '</h2>' + (urlAff ? '<img src="' + urlAff + '" alt="Fiche" style="width:100%;border-radius:12px">' : '<p class="petit-txt">PDF prêt.</p>') +
      '<div class="grille-btns"><a class="btn sec" style="display:grid;place-items:center;text-decoration:none" download="' + esc(fichier.name) + '" href="' + lien + '">Télécharger</a><button class="btn" type="button" data-ok="1">Fermer</button></div>');
    $('[data-ok]', f).onclick = function () { fermerFeuille(); };
  }
  function envoyerFichiers(l, texte) {
    var fs = l.map(function (x) { return x.f; });
    try {
      if (navigator.canShare && navigator.canShare({ files: fs })) {
        var data = { files: fs }; // uniquement les fichiers : pas de petit texte en plus
        navigator.share(data).catch(function () {}); return;
      }
    } catch (e) {}
    var f = ouvrirFeuille('<h2>2 fichiers prêts</h2>' + l.map(function (x) {
      return (x.url ? '<img src="' + x.url + '" alt="" style="width:100%;border-radius:12px;margin-bottom:6px">' : '') +
        '<a class="btn sec" style="display:grid;place-items:center;text-decoration:none;margin-bottom:10px" download="' + esc(x.f.name) + '" href="' + URL.createObjectURL(x.f) + '">Télécharger ' + esc(x.f.name) + '</a>';
    }).join('') + '<button class="btn" type="button" data-ok="1">Fermer</button>');
    $('[data-ok]', f).onclick = function () { fermerFeuille(); };
  }
  function fichierPlan(c) {
    var url = imagePlan(c).toDataURL('image/png'), bin = atob(url.split(',')[1]), arr = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    var nom = 'plan-camion' + (c.client ? '-' + c.client.replace(/[^A-Z0-9]+/gi, '-') : '') + (c.reference ? '-' + c.reference : '') + '.png';
    return { url: url, fichier: new File([arr], nom, { type: 'image/png' }) };
  }
  function copier(t) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(t).then(function () { toast('Texte copié'); }, function () { toast('Copie impossible'); });
    var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); toast('Texte copié'); } catch (e) { toast('Copie impossible'); }
    ta.remove();
  }
  function choixPartage(c) {
    var langue = 'fr';
    var f = ouvrirFeuille('<div class="sec-tete"><h2>Partager le camion</h2><button class="lien" data-ferme="1" type="button">Fermer</button></div>' +
      '<button type="button" class="opt-part prio" data-p="qr"><span class="op-ic op-qr"></span><span><b>QR code pour le chauffeur</b><small>Il scanne, la fiche s\'ouvre sur son téléphone</small></span></button>' +
      '<button type="button" class="opt-part" data-p="fiche"><span class="op-ic">💬</span><span><b>Fiche en images</b><small>Détail des colis + plan + vue 3D, en A4</small></span></button>' +
      '<button type="button" class="opt-part" data-p="pdf"><span class="op-ic">📄</span><span><b>Fiche en PDF</b><small>Pratique pour imprimer</small></span></button>' +
      '<p class="reg-st lang-tit">Langue de la fiche</p>' + puceLangues(langue));
    f.classList.add('feuille-partage');
    try { var mq = QR.canvas('SDC', 120, '#3B5A34'); mq.className = 'mini-qr'; $('.op-qr', f).appendChild(mq); } catch (e) {}
    f.onclick = function (e) {
      var bl = e.target.closest('[data-lang]');
      if (bl) { langue = bl.dataset.lang; $$('[data-lang]', f).forEach(function (x) { x.classList.toggle('actif', x === bl); }); return; }
      if (e.target.closest('[data-ferme]')) { f.onclick = null; fermerFeuille(); return; }
      var b = e.target.closest('[data-p]'); if (!b) return;
      var p = b.dataset.p; f.onclick = null; fermerFeuille();
      if (p === 'qr') { setTimeout(function () { montrerQR(c, langue); }, 120); return; }
      envoyerFichiers(fichiersFiche(c, p === 'fiche' ? 'jpg' : 'pdf', langue), ligneCourte(c));
    };
  }
  // les fichiers de la fiche (détail des colis + plan, une page A4 par remorque)
  function fichiersFiche(c, format, langue) {
    var pages = c.double && c.double.r ? [['detail', 'Colis'], ['plan', 'Plan-R1', 0], ['plan', 'Plan-R2', 1]] : [['detail', 'Colis'], ['plan', 'Plan']];
    if (window.Vue3D) pages.push(['3d', 'Vue-3D']);
    return pages.map(function (m) {
      var fc = ficheJolie(c, m[0], m[2], langue), url = fc.toDataURL('image/jpeg', 0.95), jpg = octets(url), nom = nomFichier(c, 'x').replace(/^Fiche-/, m[1] + '-');
      return format === 'jpg' ? { f: new File([jpg], nom.replace(/\.x$/, '.jpg'), { type: 'image/jpeg' }), url: url } : { f: new File([pdfDepuisJpeg(jpg, fc.width, fc.height)], nom.replace(/\.x$/, '.pdf'), { type: 'application/pdf' }), url: null };
    });
  }


  // ---------- Fiche partagée : même rendu que l'appli (fond d'écran, remorque, bois, place libre) ----------
  var LOGO = new Image(); LOGO.src = 'logo-clair.png?v=83'; var LOGO_S = new Image(); LOGO_S.src = 'logo-sombre.png?v=83';
  function imagePlan(c, langue) { return ficheJolie(c, 'plan', null, langue); }
  function remDeN(p, i) { var a = p.double.actif; p.double.actif = i; var s = remDe(p); p.double.actif = a; return s; }
  var POIDS_TXT = '25 000 kg';
  // Langues de la fiche chauffeur (le français reste la langue par défaut)
  var LANGUES = {
    fr: { nom: 'Français', dr: '🇫🇷' },
    en: { fr: 'anglais', nom: 'English', dr: '🇬🇧', loc: 'en-GB', pc: 'LOADING PLAN', dc: 'PACK DETAILS', cli: 'Customer', cmd: 'Order no.', col: 'Packs', g: 'Left', d: 'Right', dbl: '2 trailers', rem: 'Trailer', dcT: 'Pack details', sec: 'Size', lgs: 'Lengths', tot: 'Total', vol: 'Volume', gd: 'Left · Right', G: 'Driver side', D: 'Passenger side', lib: 'free', arr: 'Rear', et: 'L', mil: 'CENTRE', pdf: 'Download PDF', aide: 'Long-press an image to save it.', lang: 'Language', vc: 'Side', vd: 'Top', va: 'Rear', tour: 'Swipe to rotate the truck', v3: 'View in 3D' },
    es: { fr: 'espagnol', nom: 'Español', dr: '🇪🇸', loc: 'es-ES', pc: 'PLAN DE CARGA', dc: 'DETALLE DE LOS PAQUETES', cli: 'Cliente', cmd: 'N.º de pedido', col: 'Paquetes', g: 'Izquierda', d: 'Derecha', dbl: '2 remolques', rem: 'Remolque', dcT: 'Detalle de los paquetes', sec: 'Sección', lgs: 'Longitudes', tot: 'Total', vol: 'Volumen', gd: 'Izquierda · Derecha', G: 'Lado del conductor', D: 'Lado del pasajero', lib: 'libre', arr: 'Trasera', et: 'N', mil: 'CENTRO', pdf: 'Descargar PDF', aide: 'Mantén pulsada una imagen para guardarla.', lang: 'Idioma', vc: 'Lado', vd: 'Arriba', va: 'Trasera', tour: 'Desliza para girar el camión', v3: 'Ver en 3D' },
    pt: { fr: 'portugais', nom: 'Português', dr: '🇵🇹', loc: 'pt-PT', pc: 'PLANO DE CARGA', dc: 'DETALHE DOS PACOTES', cli: 'Cliente', cmd: 'N.º de encomenda', col: 'Pacotes', g: 'Esquerda', d: 'Direita', dbl: '2 reboques', rem: 'Reboque', dcT: 'Detalhe dos pacotes', sec: 'Secção', lgs: 'Comprimentos', tot: 'Total', vol: 'Volume', gd: 'Esquerda · Direita', G: 'Lado do condutor', D: 'Lado do passageiro', lib: 'livre', arr: 'Traseira', et: 'N', mil: 'CENTRO', pdf: 'Descarregar PDF', aide: 'Mantenha premida uma imagem para a guardar.', lang: 'Idioma', vc: 'Lado', vd: 'Cima', va: 'Traseira', tour: 'Deslize para rodar o camião', v3: 'Ver em 3D' },
    pl: { fr: 'polonais', nom: 'Polski', dr: '🇵🇱', loc: 'pl-PL', pc: 'PLAN ZAŁADUNKU', dc: 'SZCZEGÓŁY PAKIETÓW', cli: 'Klient', cmd: 'Nr zamówienia', col: 'Pakiety', g: 'Lewa', d: 'Prawa', dbl: '2 przyczepy', rem: 'Przyczepa', dcT: 'Szczegóły pakietów', sec: 'Przekrój', lgs: 'Długości', tot: 'Razem', vol: 'Objętość', gd: 'Lewa · Prawa', G: 'Strona kierowcy', D: 'Strona pasażera', lib: 'wolne', arr: 'Tył', et: 'P', mil: 'ŚRODEK', pdf: 'Pobierz PDF', aide: 'Przytrzymaj obraz, aby go zapisać.', lang: 'Język', vc: 'Bok', vd: 'Z góry', va: 'Tył', tour: 'Przesuń palcem, aby obrócić', v3: 'Widok 3D' },
    lt: { fr: 'lituanien', nom: 'Lietuvių', dr: '🇱🇹', loc: 'lt-LT', pc: 'PAKROVIMO PLANAS', dc: 'PAKETŲ SĄRAŠAS', cli: 'Klientas', cmd: 'Užsakymo Nr.', col: 'Paketai', g: 'Kairė', d: 'Dešinė', dbl: '2 priekabos', rem: 'Priekaba', dcT: 'Paketų sąrašas', sec: 'Skerspjūvis', lgs: 'Ilgiai', tot: 'Iš viso', vol: 'Tūris', gd: 'Kairė · Dešinė', G: 'Vairuotojo pusė', D: 'Keleivio pusė', lib: 'laisva', arr: 'Galas', et: 'A', mil: 'VIDURYS', pdf: 'Atsisiųsti PDF', aide: 'Palaikykite paspaudę paveikslėlį, kad jį išsaugotumėte.', lang: 'Kalba', vc: 'Šonas', vd: 'Iš viršaus', va: 'Galas', tour: 'Braukite, kad pasuktumėte sunkvežimį', v3: '3D vaizdas' },
    ru: { fr: 'russe', nom: 'Русский', dr: '🇷🇺', loc: 'ru-RU', pc: 'ПЛАН ЗАГРУЗКИ', dc: 'СПИСОК ПАКЕТОВ', cli: 'Клиент', cmd: '№ заказа', col: 'Пакеты', g: 'Слева', d: 'Справа', dbl: '2 прицепа', rem: 'Прицеп', dcT: 'Список пакетов', sec: 'Сечение', lgs: 'Длины', tot: 'Итого', vol: 'Объём', gd: 'Слева · Справа', G: 'Сторона водителя', D: 'Сторона пассажира', lib: 'свободно', arr: 'Сзади', et: 'Я', mil: 'ЦЕНТР', pdf: 'Скачать PDF', aide: 'Нажмите и удерживайте изображение, чтобы сохранить его.', lang: 'Язык', vc: 'Сбоку', vd: 'Сверху', va: 'Сзади', tour: 'Проведите пальцем, чтобы повернуть грузовик', v3: 'Вид в 3D' },
    nl: { fr: 'néerlandais', nom: 'Nederlands', dr: '🇳🇱', loc: 'nl-NL', pc: 'LAADPLAN', dc: 'PAKKETOVERZICHT', cli: 'Klant', cmd: 'Ordernr.', col: 'Pakketten', g: 'Links', d: 'Rechts', dbl: '2 aanhangers', rem: 'Aanhanger', dcT: 'Pakketoverzicht', sec: 'Doorsnede', lgs: 'Lengtes', tot: 'Totaal', vol: 'Volume', gd: 'Links · Rechts', G: 'Bestuurderszijde', D: 'Passagierszijde', lib: 'vrij', arr: 'Achterkant', et: 'L', mil: 'MIDDEN', pdf: 'PDF downloaden', aide: 'Houd een afbeelding ingedrukt om deze op te slaan.', lang: 'Taal', vc: 'Zijkant', vd: 'Boven', va: 'Achterkant', tour: 'Veeg om de vrachtwagen te draaien', v3: 'Bekijk in 3D' }
  };
  var ORDRE_LANGUES = ['fr', 'en', 'es', 'pt', 'pl', 'lt', 'ru', 'nl'];
  function puceLangues(sel) {
    return '<div class="langues">' + ORDRE_LANGUES.map(function (k) { return '<button type="button" data-lang="' + k + '" class="' + (k === sel ? 'actif' : '') + '"><span class="drap">' + LANGUES[k].dr + '</span>' + LANGUES[k].nom + '</button>'; }).join('') + '</div>';
  }
  function ficheJolie(c, mode, seule, langue) {
    var L = langue && langue !== 'fr' ? LANGUES[langue] : null, T = function (k, fr) { return L && L[k] ? L[k] : fr; }, SEP = L ? ': ' : ' : '; // pas d'espace avant « : » hors français // seule : n° de remorque (double) pour une page A4 par remorque
    var avec3D = mode === '3d', avecDetail = mode !== 'plan' && !avec3D, avecPlan = mode !== 'detail' && !avec3D, HT = 280;
    assurerPlan(c);
    var W = 1240, A4H = Math.round(1240 * 297 / 210), pad = 48, larg = W - 2 * pad, S = 2.6; // S : échelle par rapport à l'écran du téléphone
    var SOMBRE = false; // fiches toujours en mode clair (meilleure qualité, même si l'appli est en sombre)
    var INK = SOMBRE ? '#EEF3EC' : '#16221A', MU = SOMBRE ? '#A3B2A8' : '#5E6E64', VERT = SOMBRE ? '#9CCB8A' : '#3B5A34', CARTE = SOMBRE ? 'rgba(24,32,27,.9)' : 'rgba(247,250,245,.92)';
    var F = function (w, px, cond) { return w + ' ' + px + 'px ' + (cond ? '"Barlow Condensed", ' : '') + 'Barlow, system-ui, sans-serif'; };
    var cv = document.createElement('canvas'), x = cv.getContext('2d');
    if (langue === 'en') { // en anglais : 42.19 et 25,000
      var enNb = function (t) { return String(t).replace(/(\d),(\d)/g, '$1.$2').replace(/(\d) (\d{3})(?!\d)/g, '$1,$2'); }, ft = x.fillText.bind(x), mt = x.measureText.bind(x);
      x.fillText = function (t, a, b) { return ft(enNb(t), a, b); }; x.measureText = function (t) { return mt(enNb(t)); };
    }
    function rond(a, b, w, h, rr) { rr = Math.max(0, Math.min(rr, h / 2, w / 2)); x.beginPath(); x.moveTo(a + rr, b); x.arcTo(a + w, b, a + w, b + h, rr); x.arcTo(a + w, b + h, a, b + h, rr); x.arcTo(a, b + h, a, b, rr); x.arcTo(a, b, a + w, b, rr); x.closePath(); }
    function carte(y, h) { x.save(); x.shadowColor = 'rgba(10,30,20,.14)'; x.shadowBlur = 24; x.shadowOffsetY = 6; x.fillStyle = CARTE; rond(pad, y, larg, h, 36); x.fill(); x.restore(); }
    function stabilo(t, xx, yy, coul, px) {
      x.font = F(700, px, true); var w = x.measureText(t).width;
      x.save(); x.translate(xx - 8, yy - px * 0.52); x.transform(1, -0.02, -0.1, 1, 0, 0);
      var g = x.createLinearGradient(0, 0, w + 22, 0); g.addColorStop(0, coul.replace('A', '.55')); g.addColorStop(0.12, coul.replace('A', '.9')); g.addColorStop(0.88, coul.replace('A', '.85')); g.addColorStop(1, coul.replace('A', '.45'));
      x.fillStyle = g; rond(0, 0, w + 22, px * 0.62, 8); x.fill(); x.restore();
      x.fillStyle = '#16221A'; x.fillText(t, xx + 2, yy);
    }
    // ---- mesures ----
    var base = c, rems = c.double && c.double.r ? [0, 1].map(function (i) { return remDeN(c, i); }) : [c];
    var grp = {}, ordre = [];
    base.lignes.forEach(function (l) {
      var k = fm(l.ep) + '×' + fm(l.la);
      if (!grp[k]) { grp[k] = { ep: l.ep, la: l.la, lgs: {}, n: 0, m: 0 }; ordre.push(k); }
      var g = grp[k], n = l.nb || 1; g.lgs[l.lo] = (g.lgs[l.lo] || 0) + n; g.n += n; g.m += P.volTotalLigne(l);
    });
    ordre.sort(function (a, b) { return grp[b].ep - grp[a].ep || grp[b].la - grp[a].la; });
    var nbTot = base.lignes.reduce(function (a, l) { return a + (l.nb || 1); }, 0);
    var colLg = pad + 240, colN = W - pad - 170, colM = W - pad - 30, lgMax = colN - 50 - colLg;
    x.font = F(500, 27);
    var tab = ordre.map(function (k) {
      var g = grp[k], lignes = [[]], l0 = 0;
      Object.keys(g.lgs).map(Number).sort(function (a, b) { return a - b; }).forEach(function (lo) {
        var t = fm(lo) + ' m' + (g.lgs[lo] > 1 ? ' ×' + g.lgs[lo] : ''), w = x.measureText(t).width + 26;
        if (l0 + w > lgMax && lignes[lignes.length - 1].length) { lignes.push([]); l0 = 0; }
        lignes[lignes.length - 1].push([t, w]); l0 += w + 10;
      });
      return { k: k, g: g, lignes: lignes, h: 30 + lignes.length * 50 };
    });
    var hTab = avecDetail ? 110 + tab.reduce(function (a, l) { return a + l.h; }, 0) + 76 + 40 : 0;
    var plansTous = rems.map(function (rc, i) { var v = vplan(rc); return { c: rc, v: v, r: cfgC(rc), i: i }; });
    var plans = seule != null && c.double ? plansTous.slice(seule, seule + 1) : plansTous;
    var hPied = 160, dispo = A4H - pad - HT - 30 - hPied - pad, nCotes = 2 * plans.length;
    var rowH = Math.max(80, Math.min(46 * S * 1.1, ((dispo - (c.double ? 80 * plans.length : 0)) / nCotes - 30 - 195) / plans[0].v.N - 12)), hCote = 60 + plans[0].v.N * (rowH + 12) + 135;
    var hPlans = !avecPlan ? 0 : plans.reduce(function (a, p) { return a + (c.double ? 80 : 0) + 2 * (hCote + 30); }, 0);
    var msgs = [];
    plans.forEach(function (p, i) {
      var e1Long = ['G', 'D'].some(function (s2) { return p.v.rows[s2 + '1'].ext > Math.round(p.r.e1Max * 100); });
      p.v.erreurs.concat(p.v.avis).forEach(function (m) {
        if (/il faut entre/.test(m) && !e1Long) return;
        if (/colis de côté/.test(m)) return;
        msgs.push((c.double ? 'Remorque ' + (i + 1) + ' : ' : '') + m);
      });
    });
    var et = P.etat(base.total_m3, cfgC(base)), rb = cfgC(base);
    if (c.double && et.code === 'trop') msgs.push('Volume : ' + f2(base.total_m3) + ' m³, limite dépassée de ' + f2(et.depasse) + ' m³.');
    x.font = F(500, 27);
    function couper(t, max) { var mots = t.split(' '), out = [], cur = ''; mots.forEach(function (w) { var e = cur ? cur + ' ' + w : w; if (x.measureText(e).width > max && cur) { out.push(cur); cur = w; } else cur = e; }); if (cur) out.push(cur); return out; }
    var lmsg = []; msgs.forEach(function (m) { couper('• ' + m, larg - 60).forEach(function (l) { lmsg.push(l); }); });
    lmsg = []; // pas de remarques sur la fiche (client / chauffeur)
    var natH = pad + HT + 30 + hTab + hPlans + hPied + pad, H = Math.max(A4H, natH), ext = H - natH;
    if (avecDetail && !avecPlan && ext > 0 && tab.length) { var plus = Math.min(110, Math.max(0, ext - 230) / tab.length); tab.forEach(function (l) { l.h += plus; }); hTab += plus * tab.length; }
    var Q = Math.min(2, Math.sqrt(16e6 / (W * H))); // haute définition (300 dpi en A4), sans dépasser la limite de l'iPhone
    cv.width = Math.round(W * Q); cv.height = Math.round(H * Q); x.scale(Q, Q);
    // ---- fond d'écran du moment ----
    x.fillStyle = SOMBRE ? '#121813' : '#DCE5DA'; x.fillRect(0, 0, W, H);
    var fd = Ambiance.cfg(reg()).fonds, im = Ambiance.imageAffichee();
    if (im && im.naturalWidth) {
      var k = Math.max(W / im.naturalWidth, H / im.naturalHeight), iw = im.naturalWidth * k, ih = im.naturalHeight * k;
      try { // flou fait à la main (marche aussi sur iPhone) : image réduite puis agrandie en douceur
        // flou maximum : image réduite à quelques pixels puis agrandie par étapes (dégradés très doux, aucun détail qui gêne)
        var t1 = document.createElement('canvas'); t1.width = 24; t1.height = Math.max(8, Math.round(24 * ih / iw));
        var g1 = t1.getContext('2d'); g1.imageSmoothingQuality = 'high'; g1.drawImage(im, 0, 0, t1.width, t1.height);
        var src = t1;
        while (src.width * 2 < iw * Q / 2) { var t2 = document.createElement('canvas'); t2.width = src.width * 2; t2.height = src.height * 2; var g2 = t2.getContext('2d'); g2.imageSmoothingEnabled = true; g2.imageSmoothingQuality = 'high'; g2.drawImage(src, 0, 0, t2.width, t2.height); src = t2; }
        x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
        x.drawImage(src, (W - iw) / 2, (H - ih) / 2, iw, ih);
      } catch (e) {}
    }
    x.fillStyle = SOMBRE ? 'rgba(10,14,11,' + Math.max(0.45, fd.voile / 100) + ')' : 'rgba(232,238,230,' + Math.max(0.15, fd.voile / 100) + ')'; x.fillRect(0, 0, W, H);
    // ---- en-tête ----
    var y = pad; carte(y, HT);
    var d = new Date(base.termine_le || base.maj_le || Date.now()), dt = d.toLocaleDateString(T('loc', 'fr-FR'), { weekday: 'long', day: 'numeric', month: 'long' });
    var vb = vplan(c.double ? remDeN(c, 0) : c), gT = c.double ? plansTous.reduce(function (a, p) { return a + p.v.volG; }, 0) : vb.volG, dT = c.double ? plansTous.reduce(function (a, p) { return a + p.v.volD; }, 0) : vb.volD;
    x.fillStyle = MU; x.font = F(600, 24); x.fillText(mode === 'detail' ? T('dc', 'DÉTAIL DES COLIS') : avec3D ? T('v3', 'VUE EN 3D').toUpperCase() : (mode === 'plan' ? T('pc', 'PLAN DE CHARGEMENT') : T('pc', 'FICHE DE CHARGEMENT')), pad + 36, y + 46);
    x.fillStyle = INK; x.font = F(700, 62, true); x.fillText(T('cli', 'Client') + SEP + (base.client || '—'), pad + 36, y + 110);
    x.font = F(600, 34); x.fillText(T('cmd', 'N° de commande') + SEP + (base.reference || '—'), pad + 36, y + 160);
    x.fillStyle = MU; x.font = F(500, 28); x.fillText(dt.charAt(0).toUpperCase() + dt.slice(1) + ' · ' + heure(d.toISOString()) + ' · ' + (L ? T('col') + SEP + nbTot : nbTot + ' colis'), pad + 36, y + 208);
    x.fillText((c.double ? T('dbl', 'Double remorque') + ' ' + fm(c.double.lg[0]) + ' + ' + fm(c.double.lg[1]) + ' m · ' : '') + T('g', 'Gauche') + ' ' + f2(gT) + ' · ' + T('d', 'Droite') + ' ' + f2(dT), pad + 36, y + 250);
    x.textAlign = 'right'; x.fillStyle = INK; x.font = F(700, 92, true); x.fillText(f2(base.total_m3), W - pad - 36, y + 112);
    x.fillStyle = MU; x.font = F(500, 30); x.fillText('m³', W - pad - 36, y + 150);
    x.font = F(700, 40, true); x.fillStyle = INK; var wp = x.measureText(POIDS_TXT).width;
    x.fillStyle = SOMBRE ? 'rgba(156,203,138,.16)' : 'rgba(59,90,52,.12)'; rond(W - pad - 36 - wp - 28, y + 182, wp + 28, 58, 29); x.fill();
    x.fillStyle = VERT; x.fillText(POIDS_TXT, W - pad - 50, y + 224); x.textAlign = 'left';
    y += HT + 30;
    // ---- détail des colis ----
    if (avecDetail) {
      carte(y, (avecPlan ? hTab : H - pad - hPied - y) - 40);
      x.fillStyle = INK; x.font = F(700, 46, true); x.fillText(T('dcT', 'Détail des colis'), pad + 36, y + 64);
      var yy = y + 102; x.fillStyle = MU; x.font = F(500, 24);
      x.fillText(T('sec', 'Section'), pad + 36, yy); x.fillText(T('lgs', 'Longueurs'), colLg, yy); x.textAlign = 'right'; x.fillText(T('col', 'Colis'), colN, yy); x.fillText('m³', colM, yy); x.textAlign = 'left';
      yy += 14;
      tab.forEach(function (l) {
        x.fillStyle = SOMBRE ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.07)'; x.fillRect(pad + 36, yy, larg - 72, 2);
        var mid = yy + l.h / 2 + 11;
        x.fillStyle = INK; x.font = F(700, 36); x.fillText(l.k, pad + 36, mid);
        var ly = yy + (l.h - l.lignes.length * 50) / 2 + 5;
        l.lignes.forEach(function (lg) { var lx = colLg; lg.forEach(function (pu) { x.fillStyle = '#EFE4CC'; rond(lx, ly, pu[1], 40, 10); x.fill(); x.fillStyle = '#3A2814'; x.font = F(500, 27); x.fillText(pu[0], lx + 13, ly + 29); lx += pu[1] + 10; }); ly += 50; });
        x.textAlign = 'right'; x.fillStyle = INK; x.font = F(500, 34); x.fillText(String(l.g.n), colN, mid); x.fillText(f2(l.g.m), colM, mid); x.textAlign = 'left';
        yy += l.h;
      });
      x.fillStyle = SOMBRE ? 'rgba(255,255,255,.2)' : 'rgba(0,0,0,.18)'; x.fillRect(pad + 36, yy, larg - 72, 3);
      x.fillStyle = INK; x.font = F(700, 38); x.fillText(T('tot', 'Total'), pad + 36, yy + 58);
      x.textAlign = 'right'; x.fillText(String(nbTot), colN, yy + 58); x.fillText(f2(base.total_m3), colM, yy + 58); x.textAlign = 'left';
      if (!avecPlan) { // récap en bas de la feuille
        var bas = H - pad - hPied - 40 - 36, tw3 = (larg - 72 - 40) / 3, th3 = 150, ty = bas - th3;
        [[T('col', 'Colis'), String(nbTot)], [T('vol', 'Volume'), f2(base.total_m3) + ' m³'], [T('gd', 'Gauche · Droite'), f2(gT) + ' · ' + f2(dT)]].forEach(function (t, i) {
          var tx3 = pad + 36 + i * (tw3 + 20);
          x.fillStyle = SOMBRE ? 'rgba(255,255,255,.06)' : 'rgba(59,90,52,.07)'; rond(tx3, ty, tw3, th3, 24); x.fill();
          x.fillStyle = MU; x.font = F(600, 26); x.fillText(t[0].toUpperCase(), tx3 + 28, ty + 50);
          x.fillStyle = INK; x.font = F(700, 54, true); x.fillText(t[1], tx3 + 28, ty + 115);
        });
      }
      y += hTab;
    }
    // ---- plans ----
    function bois(xx, yy, w, h, k, centre) {
      x.save(); rond(xx, yy, w, h, 14); x.clip();
      var g = x.createLinearGradient(0, yy, 0, yy + h); g.addColorStop(0, '#F0DCAE'); g.addColorStop(1, '#DDBD85'); x.fillStyle = g; x.fillRect(xx, yy, w, h);
      x.strokeStyle = 'rgba(160,122,69,.22)'; x.lineWidth = 2;
      var sd = Math.abs(hashBois(k.id)) % 97;
      for (var i = 0; i < 4; i++) { var ly = yy + h * (0.18 + i * 0.22) + (sd % 7); x.beginPath(); x.moveTo(xx, ly); x.bezierCurveTo(xx + w * 0.3, ly - 6, xx + w * 0.6, ly + 7, xx + w, ly - 2); x.stroke(); }
      x.beginPath(); x.ellipse(xx + w * (0.3 + (sd % 40) / 100), yy + h * 0.5, 22, 7, 0, 0, 6.29); x.stroke();
      if (centre) { x.strokeStyle = 'rgba(59,90,52,.28)'; x.lineWidth = 16; for (var t = -h; t < w; t += 34) { x.beginPath(); x.moveTo(xx + t, yy + h); x.lineTo(xx + t + h, yy); x.stroke(); } }
      x.fillStyle = 'rgba(160,110,50,.25)'; x.fillRect(xx + w - 12, yy, 12, h);
      x.restore();
      if (centre) { x.strokeStyle = VERT; x.lineWidth = 5; rond(xx + 2, yy + 2, w - 4, h - 4, 13); x.stroke(); x.font = F(800, 20); var tm = T('mil', 'MILIEU'), bw = x.measureText(tm).width + 18; x.fillStyle = VERT; rond(xx + w - bw - 10, yy + 8, bw, 30, 8); x.fill(); x.fillStyle = '#E6F0DA'; x.fillText(tm, xx + w - bw - 1, yy + 30); }
      x.save(); rond(xx, yy, w, h, 14); x.clip();
      x.fillStyle = '#3D2B12'; x.font = F(700, 34); x.fillText(fm(k.lo) + ' m', xx + 16, yy + h / 2 - 2);
      x.fillStyle = '#6E5434'; x.font = F(500, 24); x.fillText(fm(k.ep) + '×' + fm(k.la), xx + 16, yy + h / 2 + 30);
      x.restore();
    }
    function roue(cx0, cy0) { x.fillStyle = '#3D4541'; x.beginPath(); x.arc(cx0, cy0, 27, 0, 6.29); x.fill(); x.fillStyle = '#C3CBC6'; x.beginPath(); x.arc(cx0, cy0, 15, 0, 6.29); x.fill(); x.fillStyle = '#3D4541'; x.beginPath(); x.arc(cx0, cy0, 6, 0, 6.29); x.fill(); }
    if (avecPlan) plans.forEach(function (p, ip) {
      var v = p.v, r = p.r, rc = p.c, N = v.N, mx = Math.round(r.e1Max * 100), maxLen = mx;
      v.ROWS.forEach(function (k2) { maxLen = Math.max(maxLen, v.rows[k2].ext || v.rows[k2].len); });
      if (c.double) { var ir = p.i; var tr = T('rem', 'Remorque') + ' ' + (ir + 1) + ' · ' + fm(c.double.lg[ir]) + ' m · ' + f2(rc.total_m3) + ' m³'; x.font = F(700, 44, true); var wtr = x.measureText(tr).width; x.fillStyle = VERT; rond(pad, y + 6, wtr + 44, 62, 31); x.fill(); x.fillStyle = '#fff'; x.fillText(tr, pad + 22, y + 52); y += 80; }
      ['G', 'D'].forEach(function (s) {
        stabilo(T(s, NOMS[s]), pad + 10, y + 40, s === 'G' ? 'rgba(56,170,255,A)' : 'rgba(255,92,170,A)', 44);
        var tv = f2(s === 'G' ? v.volG : v.volD) + ' m³'; x.font = F(600, 32); var wv = x.measureText(tv).width;
        x.fillStyle = CARTE; rond(W - pad - wv - 30, y + 6, wv + 30, 50, 25); x.fill();
        x.textAlign = 'right'; x.fillStyle = INK; x.fillText(tv, W - pad - 15, y + 42); x.textAlign = 'left';
        y += 60; carte(y, hCote - 60);
        var tx = pad + 170, tw = W - pad - 30 - tx, ry = y + 26, lu = tw / maxLen;
        for (var f = N; f >= 1; f--) {
          var ro = v.rows[s + f], c3 = v.rows['C' + N], occ = ro.ext + (f === N ? c3.ext : 0);
          var libre = (f > 1 ? Math.min(mx, v.rows[s + (f - 1)].ext) : mx) - occ;
          x.fillStyle = SOMBRE ? 'rgba(255,255,255,.05)' : 'rgba(255,255,255,.55)'; rond(tx, ry, tw, rowH, 12); x.fill();
          x.fillStyle = MU; x.font = F(500, 26); x.fillText(T('et', 'É') + f, pad + 30, ry + 34);
          x.fillStyle = ro.alerte ? (SOMBRE ? '#FF8A7A' : '#C23A2B') : INK; x.font = F(600, 38); x.fillText(fm(Math.round(occ) / 100) + ' m', pad + 30, ry + 76);
          if (libre >= 30) { x.fillStyle = SOMBRE ? '#9CCB8A' : '#2F6B3A'; var tl = fm(Math.round(libre) / 100) + ' m ' + T('lib', 'libre'), pl = 25; x.font = F(700, pl); while (pl > 15 && x.measureText(tl).width > tx - pad - 40) { pl--; x.font = F(700, pl); } x.fillText(tl, pad + 30, ry + 108); }
          var xx = tx + 6, gg = gapsRow(rc, v, s + f);
          var ggc = gapsRow(rc, v, 'C' + N);
          if (f === N) c3.colis.forEach(function (k3, i5) { xx += (ggc[i5] || 0) * lu; var w = k3.cm * lu - 6; bois(xx, ry + 6, Math.max(w, 20), rowH - 12, k3, true); xx += w + 6; });
          ro.colis.forEach(function (k3, i3) { xx += (gg[i3] || 0) * lu; var w = k3.cm * lu - 6; bois(xx, ry + 6, Math.max(w, 20), rowH - 12, k3, false); xx += w + 6; });
          if (libre >= 30) { var lw2 = libre * lu - 10; if (lw2 > 16) { x.save(); x.setLineDash([12, 9]); x.strokeStyle = 'rgba(94,110,100,.6)'; x.lineWidth = 3; x.fillStyle = 'rgba(59,90,52,.06)'; rond(xx + 2, ry + 12, lw2, rowH - 24, 12); x.fill(); x.stroke(); x.restore(); } }
          ry += rowH + 12;
        }
        // remorque : paroi + plancher + roues
        x.fillStyle = SOMBRE ? '#8A958F' : '#5C6661'; x.fillRect(tx - 14, y + 20, 10, ry - y - 20 + 4); x.fillRect(tx - 14, ry, tw + 14, 18);
        x.fillRect(tx + tw * 0.14, ry + 18, 34, 12);
        var deux = rc.parentId && rc.rem === 1, wy = ry + 44;
        [0, 1, 2].slice(0, deux ? 2 : 3).forEach(function (i4) { roue(tx + tw * 0.76 - i4 * 62, wy); });
        if (deux) [0, 1].forEach(function (i4) { roue(tx + tw * 0.1 + i4 * 62, wy); });
        x.font = F(700, 32, true); var tAr = T('arr', 'Arrière'); stabilo(tAr, W - pad - 30 - x.measureText(tAr).width - 14, y + hCote - 60 - 22, 'rgba(150,160,155,A)', 32);
        y += hCote - 60 + 30;
      });
    });
    // ---- vue 3D : grande vue + côté + arrière ----
    if (avec3D && window.Vue3D) {
      var M3 = modele3D(c, langue); M3.sombre = false; var hDispo = H - pad - hPied - 20 - y, hG = Math.round((hDispo - 30) * 0.6), hP = hDispo - 30 - hG, lP = Math.round((larg - 20) / 2);
      carte(y, hG); x.drawImage(Vue3D.image(M3, '3d', Math.round((larg - 20) * Q), Math.round((hG - 20) * Q), 1.9 * Q), pad + 10, y + 10, larg - 20, hG - 20);
      y += hG + 30;
      var demi = function (xx) { x.save(); x.shadowColor = 'rgba(10,30,20,.14)'; x.shadowBlur = 24; x.shadowOffsetY = 6; x.fillStyle = CARTE; rond(xx, y, lP, hP, 36); x.fill(); x.restore(); };
      demi(pad); x.drawImage(Vue3D.image(M3, 'cote', Math.round((lP - 20) * Q), Math.round((hP - 20) * Q), 1.5 * Q), pad + 10, y + 10, lP - 20, hP - 20);
      demi(pad + lP + 20); x.drawImage(Vue3D.image(M3, 'arriere', Math.round((lP - 20) * Q), Math.round((hP - 20) * Q), 1.5 * Q), pad + lP + 30, y + 10, lP - 20, hP - 20);
    }
    // ---- remarques + logo ----
    y = H - pad - (hPied - 20); carte(y, hPied - 20);
    var py = y + 4;
    var LG = SOMBRE ? LOGO_S : LOGO;
    if (LG.complete && LG.naturalWidth) { var lh = 88, lw = LG.naturalWidth * lh / LG.naturalHeight; x.drawImage(LG, pad + 40, py + 24, lw, lh); }
    x.textAlign = 'right';
    x.fillStyle = INK; x.font = F(700, 38, true); x.fillText('Les Scieries du Centre', W - pad - 40, py + 50);
    x.fillStyle = MU; x.font = F(500, 26); x.fillText('32 avenue d\u2019Auvergne · 63800', W - pad - 40, py + 88);
    x.fillStyle = INK; x.font = F(600, 28); x.fillText('\u260E +33 4 73 84 65 13', W - pad - 40, py + 124);
    x.textAlign = 'left';
    return cv;
  }
  function partagerImage(c, langue) {
    if (!c.lignes.length) { toast('Aucun colis.'); return; }
    var cv = imagePlan(c, langue), url = cv.toDataURL('image/png');
    var nom = 'plan-camion' + (c.client ? '-' + c.client.replace(/[^A-Z0-9]+/gi, '-') : '') + (c.reference ? '-' + c.reference : '') + '.png';
    try {
      var bin = atob(url.split(',')[1]), arr = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      var fichier = new File([arr], nom, { type: 'image/png' });
      if (navigator.canShare && navigator.canShare({ files: [fichier] })) {
        navigator.share({ files: [fichier], title: 'Plan de chargement' }).catch(function () {});
        return;
      }
    } catch (e) { /* on montre l'image */ }
    var f = ouvrirFeuille('<h2>Plan de chargement</h2><img src="' + url + '" alt="Plan de chargement" style="width:100%;border-radius:14px">' +
      '<p class="petit-txt">Sur iPhone : appui long sur l\'image › Enregistrer.</p>' +
      '<div class="grille-btns"><a class="btn sec" style="display:grid;place-items:center;text-decoration:none" download="' + esc(nom) + '" href="' + url + '">Télécharger</a><button class="btn" type="button" id="fermerImg">Fermer</button></div>');
    $('#fermerImg', f).onclick = fermerFeuille;
  }
  function b64url(u8) { var s2 = ''; for (var i = 0; i < u8.length; i++) s2 += String.fromCharCode(u8[i]); return btoa(s2).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
  function deb64url(t) { var b = atob(t.replace(/-/g, '+').replace(/_/g, '/')), u = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return u; }
  function fluxVers(u8, Flux) { return new Response(new Blob([u8]).stream().pipeThrough(new Flux('deflate-raw'))).arrayBuffer().then(function (ab) { return new Uint8Array(ab); }); }
  function paquetPlan(o) { // lignes + plan rangé par ligne : bien plus court
    var p = {};
    o.lignes.forEach(function (l) { var t = []; for (var i = 0; i < (l.nb || 1); i++) t.push((o.plan || {})[l.id + '#' + i] || ''); p[l.id] = t.join(','); });
    var r = { l: o.lignes.map(function (l) { return [l.id, l.ep, l.la, l.pi, l.lo, l.nb || 1]; }), p: p };
    if (o.ordre) r.o = o.ordre; if (o.decal) r.d = o.decal; if (o.relax) r.x = 1; if (o.rem != null) r.n = o.rem;
    return r;
  }
  function depaquetPlan(r, cible) {
    cible.lignes = r.l.map(function (a) { return { id: a[0], ep: a[1], la: a[2], pi: a[3], lo: a[4], nb: a[5] }; });
    cible.plan = {};
    Object.keys(r.p || {}).forEach(function (id) { String(r.p[id]).split(',').forEach(function (v, i) { if (v) cible.plan[id + '#' + i] = v; }); });
    cible.ordre = r.o || null; cible.decal = r.d || null; if (r.x) cible.relax = true; if (r.n != null) cible.rem = r.n;
    cible.total_m3 = Math.round(P.totalM3(cible.lignes) * 1000) / 1000;
    return cible;
  }
  function lienFiche(c, langue) {
    var g = reg(), o = { v: 1, c: c.client || '', r: c.reference || '', t: c.termine_le || c.maj_le || maintenant(), lg: c.lgMax || null, s: [g.m3Min, g.m3Max, g.e1Min, g.e1Max, g.ecartMax], k: paquetPlan(c) };
    if (c.double && c.double.r) o.db = { lg: c.double.lg, r: c.double.r.map(paquetPlan) };
    var json = JSON.stringify(o), base = location.href.split('#')[0].replace(/index\.html$/, '');
    var fin = function (t) { return base + '#f=' + langue + '.' + t; };
    if (window.CompressionStream) return fluxVers(new TextEncoder().encode(json), CompressionStream).then(function (u) { return fin('z' + b64url(u)); }).catch(function () { return fin('j' + b64url(new TextEncoder().encode(json))); });
    return Promise.resolve(fin('j' + b64url(new TextEncoder().encode(json))));
  }
  function lireLien() {
    var m = /^#f=([a-z]{2})\.([zj])(.+)$/.exec(location.hash || ''); if (!m) return Promise.reject(new Error('lien'));
    var u = deb64url(m[3]);
    var pr = m[2] === 'z' ? fluxVers(u, DecompressionStream) : Promise.resolve(u);
    return pr.then(function (u2) {
      var o = JSON.parse(new TextDecoder().decode(u2));
      var c = depaquetPlan(o.k, { id: 'fiche-qr', client: o.c, reference: o.r, termine_le: o.t, maj_le: o.t, statut: 'termine', lgMax: o.lg || null });
      if (o.db) {
        c.double = { lg: o.db.lg, actif: 0, algo: 2, r: o.db.r.map(function (rr, i) { var s2 = depaquetPlan(rr, { id: 'fiche-qr-r' + i }); if (s2.rem == null) s2.rem = i; return s2; }) };
        c.double.sig = sigLignes(c.lignes);
      }
      return { c: c, lang: LANGUES[m[1]] ? m[1] : 'fr', s: o.s };
    });
  }
  // ---------- Vue 3D ----------
  function modele3D(c, langue) {
    var L = langue && langue !== 'fr' ? LANGUES[langue] : null, T = function (k, fr) { return L && L[k] ? L[k] : fr; };
    var en = langue === 'en', fmt = function (n) { var t = fm(Math.round(n * 100) / 100); return en ? t.replace(',', '.') : t; };
    var rems = c.double && c.double.r ? [0, 1].map(function (i) { return remDeN(c, i); }) : [c];
    var res = rems.map(function (rc) {
      var v = vplan(rc), r = cfgC(rc), N = v.N, mx = Math.round(r.e1Max * 100), maxLen = mx, colis = [], libres = [], etages = { G: [], D: [] };
      v.ROWS.forEach(function (k2) { maxLen = Math.max(maxLen, v.rows[k2].ext || v.rows[k2].len); });
      var c3 = v.rows['C' + N], ggc = gapsRow(rc, v, 'C' + N);
      function ajout(k3, x0, s, e) { colis.push({ x0: x0 / 100, x1: (x0 + k3.cm) / 100, s: s, e: e, id: String(k3.id), lot: fmt(k3.lo) + ' m', sec: fmt(k3.ep) + '×' + fmt(k3.la) }); }
      ['G', 'D'].forEach(function (s) {
        for (var f = 1; f <= N; f++) {
          var ro = v.rows[s + f], occ = ro.ext + (f === N ? c3.ext : 0), xx = 0, gg = gapsRow(rc, v, s + f);
          if (f === N) c3.colis.forEach(function (k3, i5) { xx += (ggc[i5] || 0); if (s === 'G') ajout(k3, xx, 'C', f - 1); xx += k3.cm; });
          ro.colis.forEach(function (k3, i3) { xx += (gg[i3] || 0); ajout(k3, xx, s, f - 1); xx += k3.cm; });
          var libre = (f > 1 ? Math.min(mx, v.rows[s + (f - 1)].ext) : mx) - occ;
          if (libre >= 30) libres.push({ x0: occ / 100, x1: (occ + libre) / 100, e: f - 1, s: s });
          etages[s].push(occ / 100);
        }
      });
      return { L: maxLen / 100, N: N, colis: colis, libres: libres, etages: etages, deux: !!(rc.parentId && rc.rem === 1) };
    });
    return { rems: res, fmt: fmt, sombre: document.documentElement.dataset.theme === 'sombre',
      T: { G: T('G', 'Côté conducteur'), D: T('D', 'Côté passager'), arr: T('arr', 'Arrière'), lib: T('lib', 'libre'), et: T('et', 'É'), mil: T('mil', 'MILIEU'), vc: T('vc', 'Côté'), vd: T('vd', 'Dessus'), va: T('va', 'Arrière'), tour: T('tour', 'Glisse pour tourner le camion') } };
  }
  function ouvrir3D() {
    var base = courantBase(); if (!base || !base.lignes.length) return;
    assurerPlan(base);
    var f = ouvrirFeuille('<div class="v3-tete"><button class="lien" data-ferme="1" type="button">‹ Plan</button><b>Vue 3D</b><span></span></div>' +
      '<div class="v3-carte"><div><b>' + esc(base.client || 'Camion') + (base.reference ? ' · ' + esc(base.reference) : '') + '</b><small>' +
      base.lignes.reduce(function (a, l) { return a + (l.nb || 1); }, 0) + ' colis' + (base.double ? ' · double remorque' : '') + '</small></div><div class="v3-m3">' + f2(base.total_m3) + '<small> m³</small></div></div><div class="v3-zone"></div>');
    f.classList.add('feuille-3d');
    $('[data-ferme]', f).onclick = function () { fermerFeuille(); };
    Vue3D.monter($('.v3-zone', f), modele3D(base, 'fr'));
  }
  function montrerQR(c, langue) {
    lienFiche(c, langue).then(function (url) {
      var cv; try { cv = QR.canvas(url, 900, '#16221A'); } catch (e) { toast('Camion trop grand pour un QR code.'); return; }
      var f = ouvrirFeuille('<div class="sec-tete"><h2>QR code chauffeur</h2><button class="lien" data-ok="1" type="button">Fermer</button></div>' +
        '<div class="qr-boite"></div>' +
        '<p class="qr-qui"><b>' + esc(c.client || 'Camion') + (c.reference ? ' · ' + esc(c.reference) : '') + '</b><br>' + LANGUES[langue].dr + ' ' + esc(langue === 'fr' ? 'Fiche en français' : 'Fiche en ' + LANGUES[langue].fr) + '</p>' +
        '<p class="petit-txt">Le chauffeur scanne avec l\'appareil photo de son téléphone. Il lui faut internet (4G). Si tu modifies le camion, refais un QR code.</p>');
      cv.className = 'qr-img'; $('.qr-boite', f).appendChild(cv);
      $('[data-ok]', f).onclick = fermerFeuille;
    });
  }
  // ---- page ouverte par le chauffeur (lien du QR code) ----
  function pageFiche() {
    document.body.classList.add('mode-fiche'); document.documentElement.classList.add('mode-fiche');
    var z = document.createElement('div'); z.id = 'ficheQR'; document.body.appendChild(z);
    z.innerHTML = '<p class="fq-att">…</p>';
    lireLien().then(function (res) {
      var c = res.c, langue = res.lang;
      if (res.s) { db.reglages.m3Min = res.s[0]; db.reglages.m3Max = res.s[1]; db.reglages.e1Min = res.s[2]; db.reglages.e1Max = res.s[3]; db.reglages.ecartMax = res.s[4]; }
      db.camions[c.id] = c;
      if (c.double) c.double.r.forEach(function (s2) { s2.parentId = c.id; });
      c.etat = P.etat(c.total_m3, cfgC(c)).code;
      function pret() { // fond d'écran, logo et polices chargés avant de dessiner
        var im = Ambiance.imageAffichee(), n = 0;
        return new Promise(function (ok) {
          (function att() { n++; var i2 = Ambiance.imageAffichee(); if ((!i2 || i2.complete) && LOGO.complete && LOGO_S.complete || n > 40) ok(); else setTimeout(att, 100); })();
        }).then(function () { return document.fonts && document.fonts.ready; });
      }
      function dessiner() {
        var L = LANGUES[langue], T = function (k, fr) { return langue !== 'fr' && L[k] ? L[k] : fr; };
        var pages = c.double ? [['detail'], ['plan', 0], ['plan', 1]] : [['detail'], ['plan']];
        z.innerHTML = '<div class="fq-tete"><img src="' + (document.documentElement.dataset.theme === 'sombre' ? 'logo-sombre.png' : 'logo-clair.png') + '" alt="SDC"><b>Les Scieries du Centre</b>' +
          '<select id="fqLang" aria-label="' + esc(T('lang', 'Langue')) + '">' + ORDRE_LANGUES.map(function (k) { return '<option value="' + k + '"' + (k === langue ? ' selected' : '') + '>' + LANGUES[k].dr + ' ' + LANGUES[k].nom + '</option>'; }).join('') + '</select></div>' +
          pages.map(function (m) { return '<img class="fq-img" alt="" src="' + ficheJolie(c, m[0], m[1], langue).toDataURL('image/jpeg', 0.9) + '">'; }).join('') +
          '<h3 class="fq-t3">' + esc(T('v3', 'Vue en 3D')) + '</h3><div class="fq-3d"></div>' +
          '<button class="btn" type="button" id="fqPdf">⬇ ' + esc(T('pdf', 'Télécharger en PDF')) + '</button>' +
          '<p class="petit-txt" style="text-align:center">' + esc(T('aide', 'Appui long sur une image pour l\'enregistrer.')) + '</p>';
        $('#fqLang').onchange = function () { langue = this.value; z.innerHTML = '<p class="fq-att">…</p>'; setTimeout(dessiner, 30); };
        $('#fqPdf').onclick = function () { envoyerFichiers(fichiersFiche(c, 'pdf', langue), ligneCourte(c)); };
        if (window.Vue3D) { try { Vue3D.monter($('.fq-3d'), modele3D(c, langue)); } catch (e) {} }
      }
      pret().then(dessiner);
    }).catch(function () { z.innerHTML = '<p class="fq-att">Lien invalide.</p>'; });
  }
  window.__lienFiche = lienFiche;
  window.__imagePlan = imagePlan; window.__fiche2 = ficheJolie; window.__fiche = function (c) { return ficheCanvas(c); }; window.__pdf = function (c) { var fc = ficheCanvas(c); return pdfDepuisJpeg(octets(fc.toDataURL('image/jpeg', 0.9)), fc.width, fc.height); }; // pour les tests

  // ---------- Historique ----------
  function jourCle(iso) { var d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function jourNom(cle) {
    var p = cle.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
    var auj = jourCle(new Date().toISOString()), hier = jourCle(new Date(Date.now() - 864e5).toISOString());
    var txt = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    var court = d.toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
    if (cle === auj) return 'Aujourd\'hui <small>' + court + '</small>';
    if (cle === hier) return 'Hier <small>' + court + '</small>';
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }
  function heure(iso) { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
  var LIB = { ok: 'Volume OK', peu: 'Volume trop bas', trop: 'Volume dépassé' };
  // Camion récupéré : la copie et l'original restent visibles, mais le volume ne compte qu'une fois
  function partageTag(c) {
    if (!compte(c)) return ' <i class="tag-p">copie de ' + esc(c.copieDe_prenom || '?') + '</i>';
    var cp = copieDeLui(c); return cp ? ' <i class="tag-p">⇄ partagé avec ' + esc(prenomDe(cp)) + '</i>' : '';
  }
  function compte(c) { var o = c.copieDe && db.camions[c.copieDe]; return !(o && !o.supprime); }
  function v2(c) { return Math.round((c.total_m3 || 0) * 100) / 100; } // volume tel qu'affiché
  function somV(l) { return Math.round(l.reduce(function (a, c) { return a + Math.round((c.total_m3 || 0) * 100); }, 0)) / 100; }
  function m3De(c) { return compte(c) ? v2(c) : 0; }
  function nbCompte(l) { return l.filter(compte).length; }
  function copieDeLui(c) { var r = null; Object.keys(db.camions).forEach(function (k) { var x = db.camions[k]; if (!x.supprime && x.copieDe === c.id) r = x; }); return r; }
  function ligneCam(c, enCours) {
    var qui = c.client || 'Sans client';
    return glisse(c.id, '<button class="cam" type="button" data-id="' + esc(c.id) + '"><span class="h">' + heure(enCours ? c.maj_le : c.termine_le) + '</span>' +
      '<span class="qui"><b>' + esc(qui) + (c.double ? ' <i class="tag-dbl">Double</i>' : '') + partageTag(c) + (enEquipe() && Sync.moi().admin && c.auteur === Sync.moi().uid ? ' <i class="lock-p">🔒 privé</i>' : '') + '</b><small>' + (enEquipe() ? '<i class="qui-p' + (estAMoi(c) ? ' moi' : '') + '">' + esc(prenomDe(c)) + '</i>' : '') + (c.reference ? 'Réf. ' + esc(c.reference) + ' · ' : '') + c.lignes.reduce(function (a, l) { return a + (l.nb || 1); }, 0) + ' colis</small>' + (c.repris_de ? '<small class="repris-l">↩ Récupéré de ' + esc(c.repris_de) + '</small>' : '') + '</span>' +
      (enCours ? '<span class="m3 cours" title="À valider"><i class="tag-av">À valider</i>' + f2(c.total_m3) + '</span></button>' :
      '<span class="m3 ' + (compte(c) ? c.etat : 'copie') + '" title="' + LIB[c.etat] + '">' + (compte(c) ? f2(c.total_m3) : '—') + '</span></button>'));
  }
  // ---------- Glisser une ligne : à gauche supprimer, à droite ouvrir ----------
  function glisse(id, html) {
    return '<div class="sw" data-sw="' + esc(id) + '"><div class="sw-fond"><span class="sw-o">Ouvrir</span><span class="sw-s">Supprimer</span></div>' + html + '</div>';
  }
  var SEUIL_GLISSE = 90, glisseListeFin = 0; // (nom à part : ne pas mélanger avec le glissement des colis du plan)
  function activerGlisser(zone, ouvrir, supprimer) {
    var g = null;
    zone.addEventListener('pointerdown', function (e) {
      var sw = e.target.closest('.sw'); if (!sw || (e.pointerType === 'mouse' && e.button !== 0)) return;
      g = { sw: sw, el: sw.lastElementChild, x: e.clientX, y: e.clientY, dx: 0, actif: false, id: e.pointerId };
    });
    zone.addEventListener('pointermove', function (e) {
      if (!g || e.pointerId !== g.id) return;
      var dx = e.clientX - g.x, dy = e.clientY - g.y;
      if (!g.actif) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { g = null; return; } // on fait défiler la page
        if (Math.abs(dx) < 10) return;
        g.actif = true; g.sw.classList.add('glisse');
        try { g.sw.setPointerCapture(e.pointerId); } catch (er) {}
      }
      g.dx = dx; e.preventDefault();
      g.el.style.transform = 'translateX(' + dx + 'px)';
      g.sw.classList.toggle('vers-g', dx < 0); g.sw.classList.toggle('vers-d', dx > 0);
      g.sw.classList.toggle('pret', Math.abs(dx) > SEUIL_GLISSE);
    });
    function fin() {
      if (!g) return;
      var o = g; g = null;
      if (!o.actif) return;
      glisseListeFin = Date.now();
      o.sw.classList.remove('glisse');
      var id = o.sw.dataset.sw;
      if (o.dx < -SEUIL_GLISSE) { o.el.style.transform = 'translateX(-110%)'; setTimeout(function () { supprimer(id); }, 180); }
      else if (o.dx > SEUIL_GLISSE) { o.el.style.transform = ''; o.sw.classList.remove('vers-d', 'pret'); ouvrir(id); }
      else { o.el.style.transform = ''; o.sw.classList.remove('vers-g', 'vers-d', 'pret'); }
    }
    zone.addEventListener('pointerup', fin); zone.addEventListener('pointercancel', fin);
    // un appui juste après un glissement ne doit pas ouvrir la ligne
    zone.addEventListener('click', function (e) { if (Date.now() - glisseListeFin < 350) { e.stopPropagation(); e.preventDefault(); } }, true);
  }
  function supprimerCamion(id, rendre) {
    var c = db.camions[id]; if (!c) return;
    if (!peutSupprimer(c)) { rendre(); toast('Camion de ' + prenomDe(c) + ' : seul ' + prenomDe(c) + ' peut le supprimer.'); return; }
    c.supprime = true; toucher(c); rendre(); effacerPlusTard(c);
    toast('Camion supprimé', function () { c.supprime = false; db.camions[c.id] = c; toucher(c); rendre(); }, 'Annuler');
  }
  function ouvrirCamion(id) {
    var c = db.camions[id]; if (!c) return;
    if (c.statut === 'en_cours' && estAMoi(c)) { db.courant = id; sauver(true); viderForm(); aller('camion'); }
    else detail(c);
  }
  var filtreQui = 'tous';
  function personnes() { // prénoms de l'équipe : seulement les membres actifs (un membre retiré n'apparaît plus)
    var l = [], vu = {}, moi = Sync.moi();
    Sync.membres().forEach(function (m) { if (m.actif && m.user_id !== moi.uid && !vu[m.user_id]) { vu[m.user_id] = 1; l.push({ uid: m.user_id, prenom: m.prenom }); } });
    return l;
  }
  // camion en cours d'un membre retiré : personne ne le finira, on ne le montre plus (ses camions terminés restent dans l'historique)
  function coursVivant(c) {
    if (!enEquipe() || estAMoi(c) || !c.auteur) return true;
    var ms = Sync.membres(); if (!ms.length) return true;
    return ms.some(function (m) { return m.user_id === c.auteur && m.actif !== false; });
  }
  function rendreHisto() {
    var q = ($('#recherche').value || '').trim().toUpperCase(), moi = Sync.moi().uid;
    var tous = Object.keys(db.camions).map(function (k) { return db.camions[k]; }).filter(function (c) {
      if (c.supprime) return false;
      if (enEquipe() && filtreQui !== 'tous' && (filtreQui === 'moi' ? !estAMoi(c) : c.auteur !== filtreQui)) return false;
      if (q && (c.client || '').toUpperCase().indexOf(q) < 0 && (c.reference || '').toUpperCase().indexOf(q) < 0) return false;
      return true;
    });
    var cours = tous.filter(function (c) { return c.statut === 'en_cours' && c.lignes.length && coursVivant(c); }).sort(function (a, b) { return b.maj_le < a.maj_le ? -1 : 1; });
    var fini = tous.filter(function (c) { return c.statut === 'termine'; }).sort(function (a, b) { return b.termine_le < a.termine_le ? -1 : 1; });
    var h = '';
    if (cours.length) h += '<div class="jour"><div class="jour-tete"><h2>À valider</h2><span>' + cours.length + '</span></div><div class="carte">' + cours.map(function (c) { return ligneCam(c, true); }).join('') + '</div></div>';
    if (cours.length || fini.length) h = '<p class="astuce">Glisse à gauche pour supprimer, à droite pour ouvrir.</p>' + h;
    if (enEquipe()) h = '<div class="seg seg-qui" id="segQui">' + [{ uid: 'tous', prenom: 'Tous' }, { uid: 'moi', prenom: 'Moi' }].concat(personnes()).map(function (x) {
      return '<button type="button" data-qui="' + esc(x.uid) + '" class="' + (filtreQui === x.uid ? 'actif' : '') + '">' + esc(x.prenom) + '</button>';
    }).join('') + '</div>' + h;
    var jours = {}, ordre = [];
    fini.forEach(function (c) { var k = jourCle(c.termine_le); if (!jours[k]) { jours[k] = []; ordre.push(k); } jours[k].push(c); });
    ordre.forEach(function (k) {
      var tot = jours[k].reduce(function (a, c) { return a + m3De(c); }, 0);
      h += '<div class="jour"><div class="jour-tete"><h2>' + jourNom(k) + '</h2><span>' + nbCompte(jours[k]) + ' validé' + (nbCompte(jours[k]) > 1 ? 's' : '') + ' · ' + f2(tot) + ' m³</span></div>' +
        '<div class="carte">' + jours[k].map(function (c) { return ligneCam(c, false); }).join('') + '</div></div>';
    });
    if (!h) h = '<div class="carte vide">' + (q ? 'Aucun camion trouvé.' : 'Aucun camion enregistré pour l\'instant.') + '</div>';
    else h += '<p class="legende"><i class="ok"></i>bon <i class="peu"></i>pas assez <i class="trop"></i>dépassé</p>';
    $('#histo').innerHTML = h;
  }
  $('#recherche').addEventListener('input', rendreHisto);
  // ---------- Statistiques ----------
  var ongletHisto = 'camions', periodeStats = 'semaine';
  var statsDans = [], statsCases = [];
  $('#stats').addEventListener('click', function (e) {
    var b = e.target.closest('[data-per]'); if (b) { periodeStats = b.dataset.per; rendreStats(); return; }
    var k = e.target.closest('[data-sk]'); if (k) { detailStats(k.dataset.sk, k.dataset.v); }
  });
  // Tout se touche dans les stats : on ouvre la liste des camions concernés
  function detailStats(sk, v) {
    var l = statsDans.slice(), titre = '', h = '', per = { jour: 'aujourd\'hui', semaine: 'cette semaine', mois: 'ce mois', annee: 'cette année' }[periodeStats];
    function tri(a) { return a.sort(function (x, y) { return y.termine_le < x.termine_le ? -1 : 1; }); }
    function bloc(t, a) { return a.length ? '<p class="reg-st">' + t + '</p><div class="carte">' + tri(a).map(function (c) { return ligneCam(c, false); }).join('') + '</div>' : ''; }
    function som(a) { return somV(a); }
    if (sk === 'vol' || sk === 'nb' || sk === 'moy') {
      titre = { vol: 'Volume', nb: 'Camions', moy: 'Moyenne' }[sk] + ' · ' + per;
      if (sk === 'moy') l.sort(function (a, b) { return b.total_m3 - a.total_m3; });
      h = '<p class="petit-txt">' + l.length + ' camion' + (l.length > 1 ? 's' : '') + ' · ' + f2(som(l)) + ' m³' + (l.length ? ' · moyenne ' + f2(som(l) / l.length) + ' m³' : '') + '</p>' +
        (sk === 'moy' ? '<div class="carte">' + l.map(function (c) { return ligneCam(c, false); }).join('') + '</div>' : bloc('Camions', l));
    } else if (sk === 'ok') {
      titre = 'Volume OK · ' + per;
      var g = { ok: [], peu: [], trop: [] }; l.forEach(function (c) { (g[c.etat] || g.ok).push(c); });
      h = '<div class="st-chips"><span class="ok">Bon · ' + g.ok.length + '</span><span class="peu">Pas assez · ' + g.peu.length + '</span><span class="trop">Dépassé · ' + g.trop.length + '</span></div>' +
        bloc('Bon (' + fm(reg().m3Min) + ' – ' + fm(reg().m3Max) + ' m³)', g.ok) + bloc('Pas assez', g.peu) + bloc('Dépassé', g.trop);
    } else if (sk === 'bar') {
      var cs = statsCases[+v]; l = cs ? cs.l : []; titre = cs ? cs.titre : '';
      var hs = l.map(function (c) { return heure(c.termine_le); }).sort();
      h = '<div class="eq-k st-mini"><div><small>Volume</small><b>' + f2(som(l)) + '</b></div><div><small>Camions</small><b>' + l.length + '</b></div>' + (hs.length && periodeStats !== 'annee' && periodeStats !== 'mois' ? '<div><small>1er · dernier</small><b>' + hs[0] + ' · ' + hs[hs.length - 1] + '</b></div>' : '') + '</div>' + bloc('Camions', l);
    } else if (sk === 'pers') {
      l = l.filter(function (c) { return prenomDe(c) === v; }); titre = v + ' · ' + per;
      h = '<p class="petit-txt">' + l.length + ' camion' + (l.length > 1 ? 's' : '') + ' · ' + f2(som(l)) + ' m³</p>' + bloc('Camions', l);
    } else if (sk === 'cli') {
      l = l.filter(function (c) { return (c.client || 'Sans client') === v; }); titre = v + ' · ' + per;
      h = '<p class="petit-txt">' + l.length + ' camion' + (l.length > 1 ? 's' : '') + ' · ' + f2(som(l)) + ' m³</p>' + bloc('Camions', l);
    }
    if (!l.length && sk !== 'ok') h += '<div class="carte vide">Aucun camion.</div>';
    var f = ouvrirFeuille('<div class="sec-tete"><h2>' + esc(titre) + '</h2><button class="lien" data-f="1" type="button">Fermer</button></div>' + h + '<p class="petit-txt">Touche un camion pour l\'ouvrir.</p>');
    f.onclick = function (e) {
      if (e.target.closest('[data-f]')) { fermerFeuille(); return; }
      var b = e.target.closest('.cam'); if (b) { f.onclick = null; detail(db.camions[b.dataset.id]); }
    };
  }
  function debutPeriode(per, d) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    if (per === 'semaine') x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    else if (per === 'mois') x.setDate(1);
    else if (per === 'annee') { x.setMonth(0); x.setDate(1); }
    return x;
  }
  function decaler(d, per, n) {
    var x = new Date(d);
    if (per === 'jour') x.setDate(x.getDate() + n);
    else if (per === 'semaine') x.setDate(x.getDate() + 7 * n);
    else if (per === 'mois') x.setMonth(x.getMonth() + n);
    else x.setFullYear(x.getFullYear() + n);
    return x;
  }
  function rendreStats() {
    var per = periodeStats, maint = new Date(), deb = debutPeriode(per, maint), fin = decaler(deb, per, 1), prevDeb = decaler(deb, per, -1);
    var finis = Object.keys(db.camions).map(function (k) { return db.camions[k]; }).filter(function (c) { return !c.supprime && c.statut === 'termine' && c.termine_le && compte(c); });
    var dans = finis.filter(function (c) { var t = new Date(c.termine_le); return t >= deb && t < fin; });
    var avant = finis.filter(function (c) { var t = new Date(c.termine_le); return t >= prevDeb && t < deb; });
    function som(l) { return somV(l); }
    var tot = som(dans), totAv = som(avant), evol = totAv > 0 ? Math.round((tot - totAv) / totAv * 100) : null, dn = dans.length - avant.length;
    var okP = dans.length ? Math.round(dans.filter(function (c) { return c.etat === 'ok'; }).length / dans.length * 100) : 0;
    // bâtons
    var cases = [], idx;
    if (per === 'jour') { for (var hh = 6; hh < 20; hh += 2) cases.push({ n: hh + 'h', v: 0 }); idx = function (t) { return Math.max(0, Math.min(cases.length - 1, Math.floor((t.getHours() - 6) / 2))); }; }
    else if (per === 'semaine') { ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach(function (n) { cases.push({ n: n, v: 0 }); }); idx = function (t) { return (t.getDay() + 6) % 7; }; }
    else if (per === 'mois') { for (var w = 0; w < 5; w++) cases.push({ n: 'S' + (w + 1), v: 0 }); idx = function (t) { return Math.min(4, Math.floor((t.getDate() - 1) / 7)); }; }
    else { 'JFMAMJJASOND'.split('').forEach(function (n) { cases.push({ n: n, v: 0 }); }); idx = function (t) { return t.getMonth(); }; }
    cases.forEach(function (x) { x.l = []; });
    dans.forEach(function (c) { var x = cases[idx(new Date(c.termine_le))]; x.v += c.total_m3; x.l.push(c); });
    statsDans = dans; statsCases = cases;
    cases.forEach(function (x, k) { // titre du détail quand on touche une barre
      if (per === 'semaine') { var dj = decaler(deb, 'jour', k); x.titre = dj.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' }); x.titre = x.titre.charAt(0).toUpperCase() + x.titre.slice(1); }
      else if (per === 'jour') x.titre = 'Entre ' + x.n + ' et ' + (parseInt(x.n, 10) + 2) + 'h';
      else if (per === 'mois') x.titre = 'Semaine ' + (k + 1) + ' du mois';
      else x.titre = new Date(deb.getFullYear(), k, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
    });
    var actuel = idx(maint), max = Math.max.apply(null, cases.map(function (x) { return x.v; }).concat([1]));
    function groupe(cle) {
      var g = {};
      dans.forEach(function (c) { var k = cle(c); (g[k] = g[k] || { m: 0, n: 0 }); g[k].m += v2(c); g[k].n++; });
      return Object.keys(g).map(function (k) { return { k: k, m: g[k].m, n: g[k].n }; }).sort(function (a, b) { return b.m - a.m; });
    }
    var gens = enEquipe() ? groupe(function (c) { return prenomDe(c); }) : [];
    var clients = groupe(function (c) { return c.client || 'Sans client'; }).slice(0, 5);
    var nomBar = { jour: 'm³ par heure', semaine: 'm³ par jour', mois: 'm³ par semaine', annee: 'm³ par mois' }[per];
    function lignesBarres(l, cl) {
      var mx = l.length ? l[0].m : 1;
      return l.map(function (x, i) { return '<div class="st-r" data-sk="' + (cl ? 'cli' : 'pers') + '" data-v="' + esc(x.k) + '"><b>' + (cl ? (i + 1) + '. ' : '') + esc(x.k) + '<em>' + x.n + ' camion' + (x.n > 1 ? 's' : '') + '</em></b><span>' + f2(x.m) + ' m³</span><small><i style="width:' + Math.round(x.m / mx * 100) + '%"></i></small></div>'; }).join('');
    }
    var h = '<div class="seg seg4" id="segPer">' + [['jour', 'Jour'], ['semaine', 'Semaine'], ['mois', 'Mois'], ['annee', 'Année']].map(function (p) { return '<button type="button" data-per="' + p[0] + '" class="' + (per === p[0] ? 'actif' : '') + '">' + p[1] + '</button>'; }).join('') + '</div>' +
      '<div class="kpi st-kpi">' +
      '<div data-sk="vol"><small>Volume</small><b>' + f2(tot) + '</b><em>m³</em>' + (evol !== null ? '<i class="' + (evol >= 0 ? 'plus' : 'moins') + '">' + (evol >= 0 ? '+' : '') + evol + ' %</i>' : '') + '</div>' +
      '<div data-sk="nb"><small>Camions</small><b>' + dans.length + '</b>' + (avant.length || dans.length ? '<i class="' + (dn >= 0 ? 'plus' : 'moins') + '">' + (dn >= 0 ? '+' : '') + dn + '</i>' : '') + '</div>' +
      '<div data-sk="moy"><small>Moyenne</small><b>' + (dans.length ? f2(tot / dans.length) : '–') + '</b><em>m³</em></div>' +
      '<div data-sk="ok"><small>Volume OK</small><b>' + (dans.length ? okP + ' %' : '–') + '</b></div></div>';
    if (!dans.length) h += '<div class="carte vide">Aucun camion terminé sur cette période.</div>';
    else {
      h += '<div class="carte st-tot"><small>' + nomBar + '</small><div class="st-ch' + (cases.length > 7 ? ' serre' : '') + '">' + cases.map(function (x, k) {
        return '<div class="' + (k === actuel ? 'auj' : '') + '" data-sk="bar" data-v="' + k + '"><b>' + (x.v ? Math.round(x.v) : '') + '</b><em style="height:' + Math.max(2, Math.round(x.v / max * 100)) + '%"></em><span>' + x.n + '</span></div>';
      }).join('') + '</div></div>';
      if (gens.length) h += '<div class="carte st-cl"><h3>Par personne</h3>' + lignesBarres(gens, false) + '</div>';
      h += '<div class="carte st-cl"><h3>Top clients</h3>' + lignesBarres(clients, true) + '</div>';
    }
    $('#stats').innerHTML = h;
  }
  activerGlisser($('#histo'), ouvrirCamion, function (id) { supprimerCamion(id, rendreHisto); });
  activerGlisser($('#accEnCours'), ouvrirCamion, function (id) { supprimerCamion(id, rendreAccueil); });
  $('#histo').addEventListener('click', function (e) {
    var f = e.target.closest('[data-qui]'); if (f) { filtreQui = f.dataset.qui; rendreHisto(); return; }
    var b = e.target.closest('.cam'); if (b) detail(db.camions[b.dataset.id]);
  });

  // Les 20 derniers camions terminés, par jour
  // Accueil / Équipe : on touche « Validés », « Volume » ou « À valider » → la liste du jour
  function listeJour(type) {
    var auj = jourCle(new Date().toISOString()), tous = Object.keys(db.camions).map(function (k) { return db.camions[k]; }).filter(function (c) { return !c.supprime; });
    var jour = tous.filter(function (c) { return c.statut === 'termine' && jourCle(c.termine_le) === auj && compte(c); }).sort(function (a, b) { return b.termine_le < a.termine_le ? -1 : 1; });
    var av = tous.filter(function (c) { return c.statut === 'en_cours' && c.lignes.length && coursVivant(c); }).sort(function (a, b) { return b.maj_le < a.maj_le ? -1 : 1; });
    var titre, h;
    if (type === 'av') {
      titre = 'À valider · ' + av.length + ' plan' + (av.length > 1 ? 's' : '');
      h = av.length ? '<div class="carte">' + av.map(function (c) { return ligneCam(c, true); }).join('') + '</div>' : '<div class="carte vide">Rien à valider.</div>';
    } else {
      titre = type === 'vol' ? 'Volume du jour' : 'Validés aujourd\'hui';
      h = '<p class="petit-txt">' + jour.length + ' validé' + (jour.length > 1 ? 's' : '') + ' · ' + f2(somV(jour)) + ' m³</p>' +
        (jour.length ? '<div class="carte">' + jour.map(function (c) { return ligneCam(c, false); }).join('') + '</div>' : '<div class="carte vide">Aucun plan validé aujourd\'hui.</div>');
    }
    var f = ouvrirFeuille('<div class="sec-tete"><h2>' + esc(titre) + '</h2><button class="lien" data-f="1" type="button">Fermer</button></div>' + h + '<p class="petit-txt">Touche un plan pour l\'ouvrir.</p>');
    f.onclick = function (e) {
      if (e.target.closest('[data-f]')) { fermerFeuille(); return; }
      var b = e.target.closest('.cam'); if (!b) return;
      var c = db.camions[b.dataset.id]; if (!c) return;
      f.onclick = null;
      if (c.statut === 'en_cours' && estAMoi(c)) { fermerFeuille(); setTimeout(function () { ouvrirCamion(c.id); }, 80); }
      else detail(c);
    };
  }
  function derniersCamions() {
    var fini = Object.keys(db.camions).map(function (k) { return db.camions[k]; }).filter(function (c) { return !c.supprime && c.statut === 'termine'; })
      .sort(function (a, b) { return b.termine_le < a.termine_le ? -1 : 1; }).slice(0, 20);
    var h = '', jours = {}, ordre = [];
    fini.forEach(function (c) { var k = jourCle(c.termine_le); if (!jours[k]) { jours[k] = []; ordre.push(k); } jours[k].push(c); });
    ordre.forEach(function (k) {
      var tot = jours[k].reduce(function (a, c) { return a + m3De(c); }, 0);
      h += '<div class="jour"><div class="jour-tete"><h2>' + jourNom(k) + '</h2><span>' + nbCompte(jours[k]) + ' validé' + (nbCompte(jours[k]) > 1 ? 's' : '') + ' · ' + f2(tot) + ' m³</span></div><div class="carte">' + jours[k].map(function (c) { return ligneCam(c, false); }).join('') + '</div></div>';
    });
    var f = ouvrirFeuille('<div class="sec-tete"><h2>Derniers camions</h2><button class="lien" data-f="1" type="button">Fermer</button></div>' +
      (h || '<div class="carte vide">Aucun camion terminé pour l\'instant.</div>') +
      (fini.length ? '<button class="btn sec" data-histo="1" type="button">Tout l\'historique</button>' : ''));
    f.onclick = function (e) {
      if (e.target.closest('[data-f]')) { fermerFeuille(); return; }
      if (e.target.closest('[data-histo]')) { fermerFeuille(); setTimeout(function () { aller('historique'); }, 80); return; }
      var b = e.target.closest('.cam'); if (b) { f.onclick = null; detail(db.camions[b.dataset.id]); }
    };
  }

  // Copie à mon nom (Dupliquer un de mes camions, ou Récupérer celui d'un collègue)
  function copierCamion(c, recup) {
    var copie = JSON.parse(JSON.stringify({ client: c.client, reference: c.reference, lignes: c.lignes, plan: c.plan, ordre: c.ordre || null, planManuel: !!c.planManuel, lgMax: c.lgMax || null, volMode: c.volMode || 'plage', volExact: c.volExact || null, double: c.double ? { lg: c.double.lg.slice(), r: null, actif: 0 } : null }));
    if (recup) { copie.copieDe = c.id; copie.copieDe_prenom = prenomDe(c); }
    var n = nouveauCamion(copie); toucher(n); edition = null;
    viderForm(); setTimeout(function () { aller('camion'); }, 60);
    toast(recup ? 'Copie à ton nom : elle est ouverte.' : 'Camion dupliqué : il est ouvert.');
  }
  function detail(c) {
    if (!c) return;
    assurerPlan(c);
    var enCours = c.statut === 'en_cours';
    var gr = {}, nbColis = 0;
    c.lignes.forEach(function (l) {
      var k = l.ep + 'x' + l.la, g = gr[k] || (gr[k] = { ep: l.ep, la: l.la, lg: [], v: 0 });
      if (g.lg.indexOf(l.lo) < 0) g.lg.push(l.lo);
      g.v += P.volTotalLigne(l); nbColis += (l.nb || 1);
    });
    var gl = Object.keys(gr).map(function (k) { return gr[k]; }).sort(function (a, b) { return b.ep - a.ep || b.la - a.la; });
    var lignes = gl.map(function (g) {
      return '<div class="pli-l"><b>' + fm(g.ep) + '×' + fm(g.la) + '</b><span class="pli-lg">' +
        g.lg.sort(function (a, b) { return a - b; }).map(function (lo) { return '<i>' + fLong(lo) + '</i>'; }).join('') +
        '</span><em>' + f3(g.v) + '</em></div>';
    }).join('');
    var date = enCours ? 'À valider · modifié à ' + heure(c.maj_le) : new Date(c.termine_le).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + heure(c.termine_le);
    var sel = selection, aMoi = estAMoi(c); selection = null;
    var f = ouvrirFeuille(
      '<h2>' + esc(c.client || 'Sans client') + (c.reference ? ' · Réf. ' + esc(c.reference) : '') + '</h2>' +
      '<p class="petit-txt" style="margin-top:-6px">' + date + ' · <b>' + f2(c.total_m3) + ' m³</b> ' + (enCours ? '' : '<span class="pastille ' + c.etat + '">' + LIB[c.etat] + '</span>') + '</p>' +
      (enEquipe() ? '<p class="charge-par">Chargé par <b>' + esc(prenomDe(c)) + '</b></p>' : '') +
      '<div class="grille-btns">' +
      (!aMoi ? '<button class="btn sec" data-a="image" type="button">Partager</button><button class="btn" data-a="recuperer" type="button">Récupérer</button>'
        : (enCours ? '<button class="btn" data-a="reprendre" type="button">Reprendre</button>' : '<button class="btn" data-a="dupliquer" type="button">Dupliquer</button>') +
          '<button class="btn sec" data-a="image" type="button">Partager</button>') + '</div>' +
      (!aMoi ? '<p class="verrou">🔒 Camion de ' + esc(prenomDe(c)) + ' : tu peux le voir et le partager, pas le modifier. « Récupérer » le passe à ton nom (il n\'y aura pas de copie).</p>' : '') +
      (c.repris_de ? '<p class="repris-l">↩ Récupéré de ' + esc(c.repris_de) + '</p>' : '') +
      (c.lignes.length ? '<div class="plan-histo">' + (c.double && c.double.r ? [0, 1].map(function (i) { return '<h3 class="rem-h">Remorque ' + (i + 1) + ' · ' + fm(c.double.lg[i]) + ' m</h3>' + htmlPlan(remDeN(c, i), { lecture: true }); }).join('') : htmlPlan(c, { lecture: true })) + '<button class="btn-lien plan-grand" data-a="plan" type="button">Ouvrir le plan en grand ›</button></div>' : '') +
      (c.lignes.length ? '<details class="pli carte"><summary><span>Colis</span><small>' + nbColis + ' colis · ' + gl.length + ' section' + (gl.length > 1 ? 's' : '') + '</small></summary>' + lignes + '</details>' : '<div class="carte"><div class="vide">Aucun colis</div></div>') +
      '<div class="grille-btns' + (peutSupprimer(c) ? '' : ' un') + '">' + (peutSupprimer(c) ? '<button class="btn danger" data-a="suppr" type="button">Supprimer</button>' : '') + '<button class="btn sec" data-a="fermer" type="button">Fermer</button></div>');
    selection = sel;
    $('#feuilleFond').onclick = null;
    $$('[data-a]', f).forEach(function (b) {
      b.onclick = function () {
        var a = b.dataset.a;
        if (a === 'fermer') fermerFeuille();
        if (a === 'plan') {
          selection = null;
          var ouvrirPlan = function () { if (enCours && aMoi) db.courant = c.id; else edition = c.id; aller('plan'); };
          if (history.state && history.state.f) { apresRetour = ouvrirPlan; fermerFeuille(); } else { fermerFeuille(); ouvrirPlan(); }
          if (!aMoi) toast('Plan de ' + prenomDe(c) + ' : lecture seule');
          else if (!enCours) toast('Plan de ' + (c.client || 'ce camion') + ' : tu peux le modifier');
        }
        if (a === 'image') { fermerFeuille(); setTimeout(function () { choixPartage(c); }, 260); }
        if (a === 'reprendre') { db.courant = c.id; sauver(true); fermerFeuille(); viderForm(); setTimeout(function () { aller('camion'); }, 60); }
        if (a === 'dupliquer') { fermerFeuille(); copierCamion(c, false); }
        if (a === 'recuperer') {
          if (!navigator.onLine) { toast('Il faut du réseau pour récupérer un camion.'); return; }
          b.disabled = true;
          Sync.recuperer(c.id).then(function (n) {
            fermerFeuille(); toast('Camion récupéré : il est à ton nom.');
            if (n.statut === 'en_cours') { db.courant = n.id; sauver(true); viderForm(); setTimeout(function () { aller('camion'); }, 60); }
            else setTimeout(function () { detail(db.camions[n.id]); }, 260);
          }).catch(function (er) { b.disabled = false; toast(er.message); });
        }
        if (a === 'suppr') {
          if (!peutSupprimer(c)) return;
          c.supprime = true; toucher(c); fermerFeuille(); rendreHisto(); effacerPlusTard(c);
          toast('Camion supprimé', function () { c.supprime = false; db.camions[c.id] = c; toucher(c); rendreHisto(); });
        }
      };
    });
  }

  // ---------- Équipe ----------
  function initiale(p) { return esc(String(p || '?').trim().charAt(0).toUpperCase() || '?'); }
  function formRejoindre(dansFeuille) {
    return '<div class="carte rejoindre"><h2>Rejoindre l\'équipe</h2><p class="petit-txt">Demande le code à ton responsable. Pas de compte, pas de mot de passe.</p>' +
      '<label class="champ"><span>Ton prénom</span><input id="rjPrenom" class="maj" autocapitalize="characters" autocomplete="given-name" value="' + esc(Sync.moi().prenom || '') + '" placeholder="ex. Sylvano"></label>' +
      '<label class="champ"><span>Code de l\'équipe</span><input id="rjCode" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ex. SDC2026"></label>' +
      '<button class="btn" id="rjOk" type="button">Rejoindre</button>' +
      '<p class="petit-txt rj-info">Tes camions déjà dans ce téléphone sont envoyés à l\'équipe : rien n\'est effacé.<br>Nouveau téléphone ? Retape le même prénom : tu retrouves ton compte.</p>' +
      '</div>';
  }
  function lierRejoindre(apres) {
    $('#rjOk').onclick = function () {
      var code = $('#rjCode').value.trim(), pr = $('#rjPrenom').value.trim(), b = this;
      if (!code) { toast('Écris le code de l\'équipe.'); return; }
      if (!pr) { toast('Écris ton prénom.'); return; }
      b.disabled = true; b.textContent = 'Connexion…';
      Sync.rejoindre(code, pr).then(function (j) {
        verrouEquipe = false; delete db.equipePlusTard; sauver(true);
        if (apres) apres();
        if (Sync.secretAVoir()) setTimeout(montrerSecret, 300);
        else toast(j.admin && j.recup ? 'Bon retour, ' + pr + ' ✔' : 'Bienvenue dans l\'équipe, ' + pr + ' ✔');
        rafraichirVue();
      }).catch(function (e) { b.disabled = false; b.textContent = 'Rejoindre'; toast(e.message); });
    };
  }
  var verrouEquipe = false;
  function proposerRejoindre() {
    verrouEquipe = !Sync.rejoint();
    ouvrirFeuille('<div style="text-align:center;margin:4px 0 2px"><span class="logo rj-logo-w"><img class="rj-logo l-clair" src="logo-clair.png?v=83" alt="SDC"><img class="rj-logo l-sombre" src="logo-sombre.png?v=83" alt=""></span></div>' + formRejoindre(true));
    $('#feuilleFond').onclick = null;
    lierRejoindre(function () { fermerFeuille(); });
  }
  // Code secret : montré une seule fois, sur le seul téléphone qui gère l'équipe
  function montrerSecret(code) {
    var s = code || Sync.secretAVoir(); if (!s) return;
    var f = ouvrirFeuille('<h2>Ton code secret</h2><p class="petit-txt">Garde-le pour toi. Il sert à retrouver tes accès si tu changes de téléphone : tape-le à la place du code d\'équipe.</p>' +
      '<div class="code-secret">' + esc(s) + '</div><p class="verrou">🔒 Personne d\'autre ne voit cet écran.</p><button class="btn" id="secOk" type="button">J\'ai noté le code</button>');
    $('#feuilleFond').onclick = null;
    $('#secOk').onclick = function () { Sync.oublierSecret(); fermerFeuille(); };
  }
  function rafraichirVue() {
    if (vueActive === 'equipe') rendreEquipe();
    else if (vueActive === 'profil') rendreProfil();
    else if (vueActive === 'reglages') rendreReglages();
    else if (vueActive === 'historique') rendreHisto();
    else if (vueActive === 'stats') rendreStats();
    else if (vueActive === 'accueil') rendreAccueil();
  }
  function camionsDe(uidP) {
    return Object.keys(db.camions).map(function (k) { return db.camions[k]; }).filter(function (c) {
      return !c.supprime && (uidP === Sync.moi().uid ? estAMoi(c) : c.auteur === uidP);
    });
  }
  function rendreEquipe() {
    var z = $('#equipeZone');
    if (!Sync.actif()) { z.innerHTML = '<div class="carte vide">L\'équipe n\'est pas encore branchée.<br><small>Tout fonctionne sur ce téléphone en attendant.</small></div>'; return; }
    if (!enEquipe()) {
      z.innerHTML = (Sync.etat().erreur ? '<p class="verrou">' + esc(Sync.etat().erreur) + '</p>' : '') + formRejoindre(false);
      lierRejoindre(); return;
    }
    var moi = Sync.moi(), auj = jourCle(new Date().toISOString());
    var gens = [{ uid: moi.uid, prenom: moi.prenom, moi: true }].concat(personnes());
    var tous = Object.keys(db.camions).map(function (k) { return db.camions[k]; }).filter(function (c) { return !c.supprime; });
    var jour = tous.filter(function (c) { return c.statut === 'termine' && jourCle(c.termine_le) === auj && compte(c); });
    var cours = tous.filter(function (c) { return c.statut === 'en_cours' && c.lignes.length && coursVivant(c); });
    z.innerHTML = '<div class="carte eq-liste">' + gens.map(function (g) {
      var sesC = camionsDe(g.uid), n = sesC.filter(function (c) { return c.statut === 'termine'; }).length, na = sesC.filter(function (c) { return c.statut === 'en_cours' && c.lignes.length; }).length;
      var cpt = (n ? '<b class="eq-ok">' + n + ' validé' + (n > 1 ? 's' : '') + '</b>' : '') + (na ? '<b class="eq-av">' + na + ' à valider</b>' : '') || '—';
      return '<button type="button" class="eq-p" data-p="' + esc(g.uid) + '"><span class="av' + (g.moi ? '' : ' b') + '">' + initiale(g.prenom) + '</span><span class="eq-n"><b>' + esc(g.prenom) + '</b>' + (g.moi ? '<small>toi</small>' : '') + '</span><span class="eq-c">' + cpt + '</span><i>›</i></button>';
    }).join('') + '</div><p class="astuce">Touche un prénom pour voir son profil.</p>' +
      '<div class="carte eq-jour"><h2>Aujourd\'hui · équipe</h2><div class="eq-k eq-tap"><button type="button" data-liste="val"><small>Validés ›</small><b class="sb-ok">' + jour.length + '</b></button><button type="button" data-liste="vol"><small>Volume ›</small><b>' + f2(somV(jour)) + '<em> m³</em></b></button><button type="button" data-liste="av"><small>À valider ›</small><b class="sb-av">' + cours.length + '</b></button></div><p class="petit-txt eq-astuce">Touche une case pour voir la liste.</p></div>' +
      '<p class="petit-txt eq-sync">' + etatSyncTxt() + '</p>';
    z.onclick = function (e) {
      var li = e.target.closest('[data-liste]'); if (li) { listeJour(li.dataset.liste); return; }
      var b = e.target.closest('[data-p]'); if (b) { profilUid = b.dataset.p; aller('profil'); }
    };
  }
  var profilUid = null;
  function rendreProfil() {
    var moi = Sync.moi(), estMoi = profilUid === moi.uid;
    var p = estMoi ? { prenom: moi.prenom } : personnes().filter(function (x) { return x.uid === profilUid; })[0] || { prenom: '?' };
    $('#profilNom').textContent = p.prenom;
    var liste = camionsDe(profilUid), maint = new Date(), debM = new Date(maint.getFullYear(), maint.getMonth(), 1);
    var fin = liste.filter(function (c) { return c.statut === 'termine'; }).sort(function (a, b) { return b.termine_le < a.termine_le ? -1 : 1; });
    var mois = fin.filter(function (c) { return new Date(c.termine_le) >= debM; });
    var cours = liste.filter(function (c) { return c.statut === 'en_cours' && c.lignes.length; });
    var h = '<div class="kpi"><div><small>Ce mois</small><b>' + mois.length + '</b><em>validé' + (mois.length > 1 ? 's' : '') + '</em></div><div><small>Volume ce mois</small><b>' + f2(somV(mois)) + '</b><em>m³</em></div></div>';
    if (cours.length) h += '<div class="jour"><div class="jour-tete"><h2>À valider</h2><span>' + cours.length + '</span></div><div class="carte">' + cours.map(function (c) { return ligneCam(c, true); }).join('') + '</div></div>';
    var jours = {}, ordre = [];
    fin.slice(0, 40).forEach(function (c) { var k = jourCle(c.termine_le); if (!jours[k]) { jours[k] = []; ordre.push(k); } jours[k].push(c); });
    ordre.forEach(function (k) {
      var tot = jours[k].reduce(function (a, c) { return a + m3De(c); }, 0);
      h += '<div class="jour"><div class="jour-tete"><h2>' + jourNom(k) + '</h2><span>' + nbCompte(jours[k]) + ' · ' + f2(tot) + ' m³</span></div><div class="carte">' + jours[k].map(function (c) { return ligneCam(c, false); }).join('') + '</div></div>';
    });
    if (!fin.length && !cours.length) h += '<div class="carte vide">Aucun camion pour l\'instant.</div>';
    if (!estMoi && enEquipe() && p.prenom !== '?') h += '<button type="button" class="btn sec retirer-p" id="profilRetirer">Retirer ' + esc(p.prenom) + ' de l\'équipe</button>' +
      '<p class="petit-txt" style="text-align:center">Ses camions validés restent dans l\'historique.</p>';
    $('#profilZone').innerHTML = h;
    var br = $('#profilRetirer');
    if (br) br.onclick = function () {
      if (!br.dataset.ok) { br.dataset.ok = '1'; br.textContent = 'Confirmer : retirer ' + p.prenom; br.classList.add('rouge-plein'); return; }
      br.disabled = true;
      Sync.retirer(profilUid, false).then(function () { toast(p.prenom + ' a été retiré de l\'équipe'); aller('equipe'); }).catch(function (er) { br.disabled = false; toast(er.message); });
    };
  }
  $('#profilZone').addEventListener('click', function (e) { var b = e.target.closest('.cam'); if (b && Date.now() - glisseListeFin > 350) detail(db.camions[b.dataset.id]); });
  function etatSyncTxt() {
    var st = Sync.etat(), att = Sync.attente(db);
    if (!navigator.onLine) return 'Hors ligne · ' + att + ' en attente';
    if (st.erreur) return '⚠ ' + esc(st.erreur);
    if (att) return att + ' en attente d\'envoi…';
    return '<span class="dot-ok"></span>À jour' + (st.derniere ? ' · ' + heure(st.derniere.toISOString()) : '');
  }
  function sauvegarderFichier() {
    var nom = 'camions-sdc-' + jourCle(maintenant()) + '.json';
    var blob = new Blob([JSON.stringify({ app: 'camions-sdc', version: 2, exporte_le: maintenant(), camions: db.camions, reglages: db.reglages, clients: db.clients }, null, 1)], { type: 'application/json' });
    var fi = null; try { fi = new File([blob], nom, { type: 'application/json' }); } catch (e) {}
    if (fi && navigator.canShare && navigator.canShare({ files: [fi] })) { navigator.share({ files: [fi], title: nom }).catch(function () {}); return; }
    var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nom;
    document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Sauvegarde enregistrée : ' + nom);
  }

  // ---------- Apparence ----------
  var PRESETS = {
    accent: ['#28533F', '#18A06B', '#0F766E', '#1F4D2E', '#2F5C8F', '#5B4FBF', '#7C3AED', '#C2410C', '#D0332B'],
    bg: ['#F5F6F4', '#EEF2F6', '#F1EEFB', '#FBF5EC', '#FFFFFF', '#0E1311', '#0F172A'],
    card: ['#FFFFFF', '#F8FAFC', '#FFFCF5', '#171E1B', '#1E293B'],
    nav: ['#FFFFFF', '#F5F6F4', '#131916', '#1E293B'],
    text: ['#101512', '#111827', '#24364F', '#F2F5F3', '#F8FAFC']
  };
  var NOMS_COUL = { accent: 'Couleur principale', bg: 'Fond', card: 'Cartes', nav: 'Barre du bas', text: 'Texte' };
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  function appliquerTheme() {
    var r = reg(), root = document.documentElement;
    var eff = r.theme === 'auto' ? (mq && mq.matches ? 'sombre' : 'clair') : r.theme;
    root.dataset.theme = eff;
    var c = r.couleurs || {};
    ['accent', 'card', 'nav', 'text'].forEach(function (k) { if (c[k]) root.style.setProperty('--' + k, c[k]); else root.style.removeProperty('--' + k); });
    if (c.bg) { root.style.setProperty('--bg', c.bg); root.style.setProperty('--bg2', 'color-mix(in srgb, ' + c.bg + ' 88%, var(--accent))'); }
    else { root.style.removeProperty('--bg'); root.style.removeProperty('--bg2'); }
    if (c.text) root.style.setProperty('--muted', 'color-mix(in srgb, ' + c.text + ' 62%, var(--card))'); else root.style.removeProperty('--muted');
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim() || '#F5F6F4');
  }
  if (mq && mq.addEventListener) mq.addEventListener('change', appliquerTheme);

  // ---------- Réglages ----------
  function champNum(id, label, val) { return '<label class="champ"><span>' + label + '</span><input id="' + id + '" inputmode="decimal" value="' + fm(val) + '"></label>'; }
  function rendreReglages() {
    var r = reg(), verrou = enEquipe() && !Sync.moi().admin, adm = enEquipe() && Sync.moi().admin;
    var coul = Object.keys(PRESETS).map(function (k) {
      var cur = (r.couleurs || {})[k];
      return '<div class="couleur" data-k="' + k + '"><span class="nom">' + NOMS_COUL[k] + '</span><div class="pastilles">' +
        '<button type="button" class="auto' + (!cur ? ' actif' : '') + '" data-v="">Auto</button>' +
        PRESETS[k].map(function (p) { return '<button type="button" data-v="' + p + '" style="background:' + p + '" class="' + (cur && cur.toLowerCase() === p.toLowerCase() ? 'actif' : '') + '" aria-label="' + p + '"></button>'; }).join('') +
        '<input type="color" value="' + (cur || PRESETS[k][0]) + '" aria-label="Couleur libre"></div></div>';
    }).join('');
    if (r.couleurs && Object.keys(r.couleurs).length) { r.couleurs = {}; appliquerTheme(); }
    $('#reglagesZone').innerHTML = blocEquipe() + (estAdmin() ? blocAdmin() : '') +
      '<div class="carte reg"><h2>Limites du camion</h2>' + (enEquipe() ? '<p class="petit-txt">Communes à toute l\'équipe : ce que tu changes s\'applique à tout le monde.</p>' : '') +
      '<div class="g3">' + champNum('rMin', 'Vol min', r.m3Min) + champNum('rMax', 'Vol max', r.m3Max) + champNum('rEcart', 'Écart G/D', r.ecartMax) + champNum('rE1Min', 'Ét.1 min', r.e1Min) + champNum('rE1Max', 'Ét.1 max', r.e1Max) + '</div>' +
      '</div>' +

      '<button class="carte reg-ouvrir" id="ouvrirClients" type="button"><span><b>Clients</b><small>' + tousClients().length + ' clients · fusionner les doublons</small></span><i>›</i></button>' +
      '<button class="carte reg-ouvrir" id="ouvrirSections" type="button"><span><b>Sections et quantités</b><small>' + r.sections.length + ' sections · ' + (enEquipe() ? 'communes à l\'équipe' : 'quantité remplie toute seule') + '</small></span><i>›</i></button>' +

      '<div class="carte reg ligne-app"><span>Apparence</span><div class="seg" id="segTheme">' +
      [['auto', 'Auto'], ['clair', 'Clair'], ['sombre', 'Sombre']].map(function (t) { return '<button type="button" data-t="' + t[0] + '" class="' + (r.theme === t[0] ? 'actif' : '') + '">' + t[1] + '</button>'; }).join('') +
      '</div></div>' +

      '<div class="carte reg"><div class="g2"><button class="btn sec petit" id="exp" type="button">Sauvegarder mes données</button><button class="btn sec petit" id="imp" type="button">Restaurer</button></div>' +
      '<input type="file" id="impFichier" accept="application/json,.json" hidden>' +
      '<p class="petit-txt">' + Object.keys(db.camions).filter(function (k) { return !db.camions[k].supprime && db.camions[k].statut === 'termine'; }).length + ' camions enregistrés' + (estAdmin() ? ' · version ' + VERSION_APP : '') + '</p></div>';
    if (verrou) $$('#reglagesZone .verrouille input').forEach(function (x) { x.disabled = true; });
    lierReglages();
  }

  function blocEquipe() {
    if (!Sync.actif()) return '';
    if (!enEquipe()) return '<div class="carte reg"><div class="reg-l" style="border:0;padding:0"><span class="petit-txt">Ce téléphone n\'est pas dans l\'équipe.</span><button class="lien" id="regRejoindre" type="button">Rejoindre ›</button></div></div>';
    var m = Sync.moi();
    return '<div class="carte reg eq-compact"><div class="reg-l" style="border:0;padding:0"><span><button class="lien" id="regPrenom" type="button" style="font-weight:700">' + esc(m.prenom) + ' ✎</button> <span class="petit-txt">· ' + etatSyncTxt() + '</span></span><button class="lien" id="regSync" type="button">⟳ Synchro</button></div>' +
      '<div class="eq-btns">' + (m.admin ? '<button class="eq-b" id="regGestion" type="button">Gestion ›</button>' : '') + '<button class="eq-b rouge" id="regQuitter" type="button">Se déconnecter</button></div></div>';
  }
  function ouvrirGestion() {
    var moi = Sync.moi().uid, ms = Sync.membres();
    var f = ouvrirFeuille('<div class="sec-tete"><h2>Gestion de l\'équipe</h2><button class="lien" data-g="fermer" type="button">Fermer</button></div>' +
      '<div class="reg-l"><span>Code de l\'équipe</span><button class="lien" data-g="code" type="button">Changer ›</button></div>' +
      '<div class="reg-l"><span>Mon code secret</span><button class="lien" data-g="secret" type="button">Définir ›</button></div>' +
      '<p class="reg-st">Membres (' + ms.length + ')</p>' +
      ms.map(function (x) {
        return '<div class="reg-l"><span>' + esc(x.prenom) + (x.user_id === moi ? ' <small>· toi</small>' : '') + '</span>' +
          (x.user_id === moi ? '' : '<button class="lien rouge" data-retirer="' + esc(x.user_id) + '" type="button">Retirer</button>') + '</div>';
      }).join('') + '<p class="petit-txt">Les sections et limites que tu modifies s\'appliquent à toute l\'équipe.</p>');
    f.onclick = function (e) {
      var b = e.target.closest('[data-g],[data-retirer]'); if (!b) return;
      if (b.dataset.g === 'fermer') fermerFeuille();
      if (b.dataset.g === 'code') { fermerFeuille(); setTimeout(function () { demanderTexte('Nouveau code d\'équipe', '', 'Les téléphones déjà dans l\'équipe ne sont pas déconnectés.').then(function (v) { if (v) Sync.changerCode(v).then(function () { toast('Code d\'équipe changé ✔'); }).catch(function (er) { toast(er.message); }); }); }, 120); }
      if (b.dataset.g === 'secret') { fermerFeuille(); setTimeout(function () { demanderTexte('Mon code secret', '', 'Tu le choisis, il ne change plus. 4 caractères minimum. Il sert à retrouver ton compte admin sur un nouveau téléphone.').then(function (v) { if (v) Sync.definirSecret(v).then(function () { toast('Code secret enregistré ✔'); }).catch(function (er) { toast(er.message); }); }); }, 120); }
      if (b.dataset.retirer) {
        if (!b.dataset.ok) { b.dataset.ok = '1'; b.textContent = 'Confirmer'; return; }
        Sync.retirer(b.dataset.retirer, false).then(function () { toast('Retiré de l\'équipe'); fermerFeuille(); setTimeout(ouvrirGestion, 150); }).catch(function (er) { toast(er.message); });
      }
    };
  }


  // ---------- Fonds d'écran et ambiance : réservé à l'administrateur (invisible pour les autres) ----------
  function estAdmin() { return enEquipe() && Sync.moi().admin; }
  function sauverAmb(forcer) { Ambiance.preparer(reg()); db.sync = db.sync || {}; db.sync.reglagesSales = true; sauver(); Ambiance.appliquer(reg(), forcer); }
  var EFFETS = [['aucun', 'Aucun'], ['feuilles', '🍂 Feuilles'], ['neige', '❄️ Neige'], ['petales', '🌸 Pétales'], ['poussieres', '✨ Poussières'], ['confettis', '🎊 Confettis']];
  var EXTRAS = [['etoiles', '⭐ Étoiles dorées'], ['feux', '🎆 Feux d\'artifice']];
  var FREQ = [['30m', '30 min'], ['1h', '1 h'], ['2h', '2 h'], ['4h', '4 h'], ['ouv', 'Ouverture'], ['fixe', 'Fixe']];
  var MOIS_C = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  function nomDe(l, k) { var x = l.filter(function (y) { return y[0] === k; })[0]; return x ? x[1] : ''; }
  function dateTxt(m) { return (+m.slice(3)) + (m.slice(3) === '01' ? 'er' : '') + ' ' + MOIS_C[+m.slice(0, 2) - 1]; }
  function freqTxt(f) { return f.freq === 'fixe' ? 'image fixe' : (f.freq === 'ouv' ? 'change à chaque ouverture' : 'change toutes les ' + nomDe(FREQ, f.freq)); }
  function dureeTxt(ms) { var m = Math.max(1, Math.round(ms / 60000)); return m >= 60 ? Math.floor(m / 60) + ' h ' + ('0' + (m % 60)).slice(-2) : m + ' min'; }
  function segAdm(k, l, v) { return '<div class="seg adm-seg" data-k="' + k + '">' + l.map(function (x) { return '<button type="button" data-v="' + x[0] + '" class="' + (String(v) === x[0] ? 'actif' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>'; }
  function pucesAdm(k, l, sel) { return '<div class="chips adm-chips" data-k="' + k + '">' + l.map(function (x) { return '<button type="button" data-v="' + x[0] + '" class="' + (sel.indexOf(x[0]) >= 0 ? 'on' : '') + '">' + x[1] + '</button>'; }).join('') + '</div>'; }
  function curseurAdm(k, nomC, min, max, pas, v, suf) { return '<label class="adm-cur"><span>' + nomC + '</span><input type="range" data-k="' + k + '" min="' + min + '" max="' + max + '" step="' + pas + '" value="' + v + '"><b>' + v + suf + '</b></label>'; }
  var NOTE_ADM = '<p class="adm-note">🔒 Visible par toi seul · s\'applique à toute l\'équipe</p>';
  function etatAdm() { return db.sync && db.sync.reglagesSales ? 'Envoi à l\'équipe…' : '✓ Enregistré · envoyé à l\'équipe'; }
  function blocAdmin() {
    var c = Ambiance.cfg(reg()), e = Ambiance.evenement(reg()), ef = Ambiance.effetActuel(reg());
    return '<div class="carte reg adm-carte"><button class="adm-l" data-adm="ambiance" type="button"><span><b>Ambiance <i class="lock-p">🔒 toi seul</i></b><small>' + esc((e ? e.emo + ' ' + e.nom : 'Aucune période') + ' · ' + nomDe(EFFETS, ef.effet)) + '</small></span><em>›</em></button>' +
      '<button class="adm-l" data-adm="fonds" type="button"><span><b>Fonds d\'écran <i class="lock-p">🔒 toi seul</i></b><small>' + Ambiance.visibles(reg()).length + ' images · ' + freqTxt(c.fonds) + ' · flou ' + c.fonds.flou + '</small></span><em>›</em></button>' +
      '</div>';
  }
  function rendreFonds() {
    var z = $('#fondsZone');
    if (!estAdmin()) { z.innerHTML = ''; setTimeout(retour, 0); return; }
    Ambiance.preparer(reg());
    var f = reg().fonds, im = Ambiance.imageActuelle(reg()), masq = f.liste.filter(function (x) { return x.masque; }).length;
    var proch = im.prochaine ? 'prochaine dans ' + dureeTxt(im.prochaine - Date.now()) : (f.freq === 'fixe' ? 'image fixe' : 'change à chaque ouverture');
    z.innerHTML = NOTE_ADM +
      '<div class="carte adm-apercu"><div class="adm-ph" id="admPh"><i></i><u></u><u></u></div><div><b>En ce moment</b><small>Image ' + (im.item ? f.liste.indexOf(im.item) + 1 : '–') + ' · ' + proch + '</small><small class="adm-ok">' + etatAdm() + '</small></div></div>' +
      '<div class="carte"><div class="adm-lab"><span>Images (' + f.liste.length + ') · touche pour les options</span>' + (masq ? '<span>' + masq + ' masquée' + (masq > 1 ? 's' : '') + '</span>' : '') + '</div><div class="adm-grille">' +
      f.liste.map(function (x, i) { return '<button type="button" class="adm-im' + (im.item && im.item.id === x.id ? ' on' : '') + (x.masque ? ' off' : '') + '" data-im="' + i + '" style="background-image:url(\'' + esc(Ambiance.miniDe(x)) + '\')"><em>' + (i + 1) + '</em></button>'; }).join('') +
      '<button type="button" class="adm-im add" id="admAjout">＋<br>Ajouter</button></div><input type="file" id="admFichier" accept="image/*" hidden></div>' +
      '<div class="carte adm-sl">' + curseurAdm('flou', 'Flou', 0, 10, 1, f.flou, '') + curseurAdm('voile', 'Voile', 0, 90, 5, f.voile, ' %') + '</div>' +
      '<div class="carte"><div class="adm-lab"><span>Changer d\'image</span></div>' + segAdm('freq', FREQ, f.freq) +
      '<div class="adm-lab" style="margin-top:10px"><span>Ordre</span></div>' + segAdm('ordre', [['hasard', 'Au hasard'], ['ordre', 'Dans l\'ordre']], f.ordre) + '</div>' +
      '<button class="lien adm-reset" id="admReset" type="button">Remettre les images d\'origine</button>';
    if (im.item) Ambiance.urlDe(im.item).then(function (u) { var p = $('#admPh'); if (u && p) { p.style.backgroundImage = 'url("' + u + '")'; p.style.setProperty('--fl', (f.flou * 0.6) + 'px'); p.style.setProperty('--vo', f.voile / 100); } });
    $$('input[type=range]', z).forEach(function (r) {
      r.oninput = function () { f[r.dataset.k] = +r.value; r.nextElementSibling.textContent = r.value + (r.dataset.k === 'voile' ? ' %' : ''); Ambiance.majFond(reg()); var p = $('#admPh'); if (p) { p.style.setProperty('--fl', (f.flou * 0.6) + 'px'); p.style.setProperty('--vo', f.voile / 100); } };
      r.onchange = function () { sauverAmb(); };
    });
    z.onclick = function (e) {
      var sb = e.target.closest('.adm-seg button'), b = e.target.closest('[data-im]');
      if (sb) { var k = sb.parentNode.dataset.k; f[k] = sb.dataset.v; if (k === 'freq' && sb.dataset.v === 'fixe' && !f.fixe && im.item) f.fixe = im.item.id; f.ancre = null; sauverAmb(); rendreFonds(); return; }
      if (b) { ouvrirImage(+b.dataset.im); return; }
      if (e.target.closest('#admAjout')) { $('#admFichier').click(); return; }
      if (e.target.closest('#admReset')) {
        var r0 = e.target.closest('#admReset'); if (!r0.dataset.ok) { r0.dataset.ok = '1'; r0.textContent = 'Touche encore pour confirmer'; return; }
        var ids = f.liste.map(function (x) { return x.id; });
        Ambiance.defFonds().liste.forEach(function (x) { if (ids.indexOf(x.id) < 0) f.liste.push(x); });
        f.liste.forEach(function (x) { x.masque = false; }); sauverAmb(); rendreFonds(); toast('Images d\'origine remises');
      }
    };
    $('#admFichier').onchange = function () {
      var fi = this.files[0]; this.value = ''; if (!fi) return;
      preparerImage(fi).then(function (o) {
        var fe = ouvrirFeuille('<h2>Ajouter une image</h2><p class="petit-txt">Elle est allégée automatiquement et envoyée à toute l\'équipe.</p><div class="adm-big" style="background-image:url(\'' + o.data + '\')"></div>' +
          '<div class="grille-btns"><button class="btn sec" data-a="non" type="button">Annuler</button><button class="btn" data-a="oui" type="button">Ajouter</button></div>');
        fe.onclick = function (ev) {
          var bb = ev.target.closest('[data-a]'); if (!bb) return;
          if (bb.dataset.a === 'non') { fermerFeuille(); return; }
          bb.disabled = true; bb.textContent = 'Envoi…';
          var id = 'x' + Date.now().toString(36);
          Sync.ajouterFond(id, o.data).then(function () { return Ambiance.garderExt(id, o.data); }).then(function () {
            reg().fonds.liste.push({ id: id, ext: true, th: o.th }); sauverAmb(); fermerFeuille(); setTimeout(rendreFonds, 80); toast('Image ajoutée ✔');
          }).catch(function (er) { bb.disabled = false; bb.textContent = 'Ajouter'; toast(er.message || 'Envoi impossible.'); });
        };
      }).catch(function () { toast('Image non reconnue.'); });
    };
  }
  function preparerImage(fi) {
    return new Promise(function (ok, ko) {
      var u = URL.createObjectURL(fi), im = new Image();
      im.onload = function () {
        function rendu(max, q) { var k = Math.min(1, max / Math.max(im.width, im.height)), c = document.createElement('canvas'); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k); c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); return c.toDataURL('image/jpeg', q); }
        var d = rendu(1400, 0.8); if (d.length > 2400000) d = rendu(1100, 0.7);
        URL.revokeObjectURL(u); ok({ data: d, th: rendu(180, 0.7) });
      };
      im.onerror = function () { URL.revokeObjectURL(u); ko(); };
      im.src = u;
    });
  }
  function ouvrirImage(i) {
    var f = reg().fonds, x = f.liste[i]; if (!x) return;
    var fe = ouvrirFeuille('<div class="adm-big" id="admBig"></div><div class="sec-tete"><h2>Image ' + (i + 1) + '</h2><span class="petit-txt">' + (i + 1) + (i ? 'ᵉ' : 'ʳᵉ') + ' sur ' + f.liste.length + '</span></div>' +
      '<div class="grille-btns"><button class="btn" data-a="voir" type="button">Afficher maintenant</button><button class="btn sec" data-a="masque" type="button">' + (x.masque ? 'Afficher dans la liste' : 'Masquer') + '</button>' +
      '<button class="btn sec" data-a="g" type="button"' + (i ? '' : ' disabled') + '>◀ Avancer</button><button class="btn sec" data-a="d" type="button"' + (i < f.liste.length - 1 ? '' : ' disabled') + '>Reculer ▶</button></div>' +
      '<button class="btn danger" data-a="suppr" type="button" style="width:100%;margin-top:8px">Supprimer l\'image</button>');
    Ambiance.urlDe(x).then(function (u) { var b = $('#admBig'); if (u && b) b.style.backgroundImage = 'url("' + u + '")'; });
    fe.onclick = function (e) {
      var b = e.target.closest('[data-a]'); if (!b || b.disabled) return;
      var a = b.dataset.a, msg = '';
      if (a === 'voir') { x.masque = false; f.fixe = x.id; f.ancre = { id: x.id, t: Date.now() }; if (f.freq === 'ouv') f.freq = 'fixe'; msg = 'Image affichée sur tous les téléphones'; }
      if (a === 'masque') { x.masque = !x.masque; msg = x.masque ? 'Image masquée' : 'Image remise dans la liste'; }
      if (a === 'g') { f.liste.splice(i, 1); f.liste.splice(i - 1, 0, x); }
      if (a === 'd') { f.liste.splice(i, 1); f.liste.splice(i + 1, 0, x); }
      if (a === 'suppr') {
        if (!b.dataset.ok) { b.dataset.ok = '1'; b.textContent = 'Touche encore pour supprimer'; return; }
        f.liste.splice(i, 1); if (x.ext) Sync.supprimerFond(x.id); msg = 'Image supprimée';
        if (!f.liste.length) f.liste = Ambiance.defFonds().liste;
      }
      if (!f.liste.some(function (y) { return !y.masque; })) { f.liste[0].masque = false; }
      sauverAmb(); fermerFeuille(); setTimeout(rendreFonds, 80); if (msg) toast(msg);
    };
  }
  function rendreAmbiance() {
    var z = $('#ambianceZone');
    if (!estAdmin()) { z.innerHTML = ''; setTimeout(retour, 0); return; }
    Ambiance.preparer(reg());
    var a = reg().ambiance, ev = Ambiance.evenement(reg());
    var lst = a.evts.map(function (e, i) {
      return '<button type="button" class="adm-ev" data-ev="' + i + '"><span class="e">' + esc(e.emo || '•') + '</span><span class="t"><b>' + esc(e.nom) + '</b><small>' + dateTxt(e.du) + ' → ' + dateTxt(e.au) + ' · ' + nomDe(EFFETS, e.effet) +
        (e.extras && e.extras.length ? ' + ' + e.extras.map(function (k) { return nomDe(EXTRAS, k); }).join(', ') : '') + (e.msg ? ' · « ' + esc(e.msg.replace('{annee}', new Date().getFullYear())) + ' »' : '') + '</small></span>' + (ev === e ? '<i class="now">EN COURS</i>' : '<em>›</em>') + '</button>';
    }).join('');
    z.innerHTML = NOTE_ADM +
      '<div class="carte"><div class="adm-lab"><span>Mode</span></div>' + segAdm('mode', [['auto', 'Auto (calendrier)'], ['force', 'Forcer un effet'], ['aucun', 'Aucun']], a.mode) +
      (a.mode === 'force' ? '<div class="adm-lab" style="margin-top:10px"><span>Effet forcé</span></div>' + pucesAdm('fEffet', EFFETS, [a.force.effet]) + '<div class="adm-lab" style="margin-top:8px"><span>En plus</span></div>' + pucesAdm('fExtras', EXTRAS, a.force.extras || []) : '') +
      '<div class="adm-lab" style="margin-top:10px"><span>Quantité</span></div>' + segAdm('quantite', [['1', 'Peu'], ['2', 'Moyen'], ['3', 'Beaucoup']], String(a.quantite)) + '</div>' +
      '<div class="carte"><div class="adm-lab"><span>Calendrier · ' + a.evts.length + ' périodes</span><span>Aujourd\'hui : ' + (ev ? esc(ev.nom) : '—') + '</span></div>' + lst +
      '<button type="button" class="adm-ev add" data-ev="-1"><span class="e">＋</span><span class="t"><b>Ajouter un événement</b><small>Fête, anniversaire, période spéciale…</small></span></button></div>' +
      '<div class="carte"><div class="reg-l" style="border:0;padding:0"><span><b>Message d\'accueil auto</b><br><small class="petit-txt">Bonne journée, bon week-end, bonne soirée… quand l\'événement n\'a pas de message</small></span><button type="button" class="adm-tog' + (a.msgAuto !== false ? ' on' : '') + '" id="admMsg" aria-label="Message d\'accueil auto"></button></div></div>' +
      '<button class="lien adm-reset" id="admResetCal" type="button">Remettre le calendrier d\'origine</button>';
    z.onclick = function (e) {
      var sb = e.target.closest('.adm-seg button'), pu = e.target.closest('.adm-chips button'), b = e.target.closest('[data-ev]');
      if (sb) { var k = sb.parentNode.dataset.k; a[k] = k === 'quantite' ? +sb.dataset.v : sb.dataset.v; sauverAmb(); rendreAmbiance(); return; }
      if (pu) {
        var kk = pu.parentNode.dataset.k;
        if (kk === 'fEffet') a.force.effet = pu.dataset.v;
        else { var l = a.force.extras || (a.force.extras = []), j = l.indexOf(pu.dataset.v); if (j >= 0) l.splice(j, 1); else l.push(pu.dataset.v); }
        sauverAmb(); rendreAmbiance(); return;
      }
      if (b) { editerEvt(+b.dataset.ev); return; }
      if (e.target.closest('#admMsg')) { a.msgAuto = a.msgAuto === false; sauverAmb(); rendreAmbiance(); return; }
      if (e.target.closest('#admResetCal')) {
        var r0 = e.target.closest('#admResetCal'); if (!r0.dataset.ok) { r0.dataset.ok = '1'; r0.textContent = 'Touche encore pour confirmer'; return; }
        a.evts = Ambiance.defEvts(); sauverAmb(true); rendreAmbiance(); toast('Calendrier d\'origine remis');
      }
    };
  }
  function selDate(id, v) {
    var j = +v.slice(3), m = +v.slice(0, 2), h = '<div class="adm-date" id="' + id + '"><select data-p="j">';
    for (var d = 1; d <= 31; d++) h += '<option value="' + d + '"' + (d === j ? ' selected' : '') + '>' + d + '</option>';
    h += '</select><select data-p="m">' + MOIS_C.map(function (n, i) { return '<option value="' + (i + 1) + '"' + (i + 1 === m ? ' selected' : '') + '>' + n + '</option>'; }).join('') + '</select></div>';
    return h;
  }
  function lireDate(id) { var z = $('#' + id); return ('0' + $('[data-p="m"]', z).value).slice(-2) + '-' + ('0' + $('[data-p="j"]', z).value).slice(-2); }
  function editerEvt(i) {
    var a = reg().ambiance, f = reg().fonds, neuf = i < 0;
    var e = neuf ? { id: 'e' + Date.now().toString(36), emo: '🎉', nom: '', du: md2(new Date()), au: md2(new Date()), msg: '', effet: 'confettis', extras: [], fonds: null } : JSON.parse(JSON.stringify(a.evts[i]));
    var choix = Array.isArray(e.fonds) && e.fonds.length;
    var fe = ouvrirFeuille('<div class="adm-edit"><h2>' + (neuf ? 'Nouvel événement' : esc(e.emo + ' ' + e.nom)) + '</h2>' +
      '<div class="adm-2"><label class="champ" style="flex:0 0 64px"><span>Icône</span><input id="evEmo" value="' + esc(e.emo || '') + '" maxlength="4"></label><label class="champ" style="flex:1"><span>Nom</span><input id="evNom" value="' + esc(e.nom) + '" placeholder="ex. Anniversaire SDC"></label></div>' +
      '<div class="adm-2"><div style="flex:1"><div class="adm-lab"><span>Du</span></div>' + selDate('evDu', e.du) + '</div><div style="flex:1"><div class="adm-lab"><span>Au</span></div>' + selDate('evAu', e.au) + '</div></div>' +
      '<label class="champ"><span>Message sous « Bonjour » (vide = message auto · {annee} = l\'année)</span><input id="evMsg" value="' + esc(e.msg || '') + '" placeholder="ex. Joyeuses fêtes 🎄"></label>' +
      '<div class="adm-lab"><span>Effet</span></div>' + pucesAdm('effet', EFFETS, [e.effet]) +
      '<div class="adm-lab" style="margin-top:8px"><span>En plus</span></div>' + pucesAdm('extras', EXTRAS, e.extras || []) +
      '<div class="adm-lab" style="margin-top:8px"><span>Fonds d\'écran pendant cette période</span></div>' + segAdm('fch', [['tous', 'Tous'], ['choisir', 'Choisir']], choix ? 'choisir' : 'tous') +
      '<div class="adm-grille petite" id="evFonds"' + (choix ? '' : ' hidden') + '>' + f.liste.map(function (x) { return '<button type="button" class="adm-im' + (choix && e.fonds.indexOf(x.id) >= 0 ? ' on' : ' off') + '" data-fid="' + esc(x.id) + '" style="background-image:url(\'' + esc(Ambiance.miniDe(x)) + '\')"></button>'; }).join('') + '</div>' +
      '<div class="grille-btns" style="margin-top:12px">' + (neuf ? '<button class="btn sec" data-a="non" type="button">Annuler</button>' : '<button class="btn danger" data-a="suppr" type="button">Supprimer</button>') + '<button class="btn" data-a="ok" type="button">Enregistrer</button></div></div>');
    $('#feuilleFond').onclick = null;
    fe.onclick = function (ev) {
      var pu = ev.target.closest('.adm-chips button'), sb = ev.target.closest('.adm-seg button'), fi = ev.target.closest('[data-fid]'), b = ev.target.closest('[data-a]');
      if (pu) {
        var k = pu.parentNode.dataset.k;
        if (k === 'effet') { e.effet = pu.dataset.v; $$('button', pu.parentNode).forEach(function (x) { x.classList.toggle('on', x === pu); }); }
        else { var l = e.extras || (e.extras = []), j = l.indexOf(pu.dataset.v); if (j >= 0) l.splice(j, 1); else l.push(pu.dataset.v); pu.classList.toggle('on', j < 0); }
        return;
      }
      if (sb) { $$('button', sb.parentNode).forEach(function (x) { x.classList.toggle('actif', x === sb); }); $('#evFonds').hidden = sb.dataset.v !== 'choisir'; return; }
      if (fi) { fi.classList.toggle('on'); fi.classList.toggle('off'); return; }
      if (!b) return;
      if (b.dataset.a === 'non') { $('#feuilleFond').onclick = null; fermerFeuille(); return; }
      if (b.dataset.a === 'suppr') {
        if (!b.dataset.ok) { b.dataset.ok = '1'; b.textContent = 'Confirmer'; return; }
        a.evts.splice(i, 1); sauverAmb(true); fermerFeuille(); setTimeout(rendreAmbiance, 80); toast('Événement supprimé'); return;
      }
      if (b.dataset.a === 'ok') {
        e.nom = $('#evNom').value.trim(); e.emo = $('#evEmo').value.trim() || '•'; e.msg = $('#evMsg').value.trim(); e.du = lireDate('evDu'); e.au = lireDate('evAu');
        if (!e.nom) { toast('Donne un nom à l\'événement.'); $('#evNom').focus(); return; }
        var fsel = $$('#evFonds .adm-im.on').map(function (x) { return x.dataset.fid; });
        e.fonds = $('#evFonds').hidden || !fsel.length ? null : fsel;
        if (neuf) a.evts.push(e); else a.evts[i] = e;
        sauverAmb(true); fermerFeuille(); setTimeout(rendreAmbiance, 80); toast('Enregistré ✔ · appliqué à toute l\'équipe');
      }
    };
  }
  function md2(d) { return ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); }

  // ---------- Sections et quantités ----------
  function txtLg(lg) { return (lg || []).map(fm).join(' · '); }
  function sectionsVerrou() { return false; }
  function sectionsSales() { if (enEquipe() && !Sync.moi().admin) db.sync.sectionsSales = true; else db.sync.reglagesSales = true; }
  function ouvrirSections() {
    var f = ouvrirFeuille(
      '<div class="sec-tete"><h2>Sections et quantités</h2><button class="lien" data-s="fermer" type="button">Fermer</button></div>' +
      '<div id="secEdit" hidden></div>' +
      '<input id="secCherche" class="sec-cherche" type="search" inputmode="decimal" placeholder="Chercher (ex. 75x225)" autocomplete="off">' +
      '<div id="secListe"></div>' +
      (enEquipe() ? '<p class="petit-txt">Ce que tu changes s\'applique à toute l\'équipe.</p>' : '') +
      '<button class="btn" data-s="ajout" type="button">+ Ajouter une section</button>' +
      '<button class="lien sec-reset" data-s="reset" type="button">Remettre la liste d\'origine</button>');
    $('#feuilleFond').onclick = null;
    $('#secCherche').addEventListener('input', rendreSections);
    f.onclick = function (e) {
      var b = e.target.closest('[data-s]'); if (!b) return;
      var a = b.dataset.s;
      if (a === 'fermer') fermerFeuille();
      if (a === 'ajout') editerSection(-1);
      if (a === 'edit') { if (sectionsVerrou()) { toast('Liste commune à l\'équipe : non modifiable ici.'); return; } editerSection(+b.dataset.i); }
      if (a === 'reset') {
        if (!b.dataset.ok) { b.dataset.ok = '1'; b.textContent = 'Touche encore pour confirmer'; return; }
        reg().sections = copieSections(); sectionsSales(); sauver();
        delete b.dataset.ok; b.textContent = 'Remettre la liste d\'origine'; rendreSections(); toast('Liste d\'origine remise');
      }
    };
    rendreSections();
  }
  function rendreSections() {
    var liste = reg().sections, q = ($('#secCherche').value || '').replace(/\s/g, '').replace(/[×*X]/g, 'x').replace(',', '.');
    var groupes = {}, ordre = [];
    liste.forEach(function (x, i) {
      if (q && (x.ep + 'x' + x.la).indexOf(q) !== 0 && (x.la + 'x' + x.ep).indexOf(q) !== 0) return;
      if (!groupes[x.ep]) { groupes[x.ep] = []; ordre.push(x.ep); }
      groupes[x.ep].push(i);
    });
    ordre.sort(function (a, b) { return b - a; });
    var h = ordre.map(function (ep) {
      var ids = groupes[ep].sort(function (a, b) { return liste[a].la - liste[b].la; });
      return '<details class="sec-groupe"' + (q ? ' open' : '') + '><summary><b>' + fm(ep) + ' mm</b><span>' + ids.length + '</span></summary><div class="sec-grille">' +
        ids.map(function (i) {
          var x = liste[i];
          return '<button type="button" class="sec-t" data-s="edit" data-i="' + i + '"><span>' + fm(x.ep) + ' × ' + fm(x.la) + (x.lg && x.lg.length ? '<small>' + txtLg(x.lg) + ' m</small>' : '') + '</span><b>' + x.pi + '</b></button>';
        }).join('') + '</div></details>';
    }).join('');
    $('#secListe').innerHTML = h || '<p class="petit-txt">Aucune section trouvée.</p>';
  }
  function editerSection(i) {
    var liste = reg().sections, x = i >= 0 ? liste[i] : { ep: '', la: '', pi: '', lg: [] }, z = $('#secEdit');
    z.hidden = false;
    z.innerHTML = '<div class="carte sec-edit"><b>' + (i >= 0 ? 'Modifier ' + fm(x.ep) + ' × ' + fm(x.la) : 'Nouvelle section') + '</b>' +
      '<div class="sec-champs"><label class="champ"><span>Épaiss.</span><input id="seEp" inputmode="decimal" value="' + (x.ep === '' ? '' : fm(x.ep)) + '" placeholder="mm"></label>' +
      '<label class="champ"><span>Largeur</span><input id="seLa" inputmode="decimal" value="' + (x.la === '' ? '' : fm(x.la)) + '" placeholder="mm"></label>' +
      '<label class="champ"><span>Pièces</span><input id="sePi" inputmode="numeric" value="' + x.pi + '"></label></div>' +
      '<label class="champ"><span>Longueurs proposées (facultatif)</span><input id="seLg" inputmode="decimal" value="' + (x.lg || []).map(fm).join(' ; ') + '" placeholder="ex. 3 ; 4 ; 5"></label>' +
      '<div class="sec-btns">' + (i >= 0 ? '<button class="btn danger" id="seSuppr" type="button">Supprimer</button>' : '') +
      '<button class="btn sec" id="seAnnuler" type="button">Annuler</button><button class="btn" id="seOk" type="button">Enregistrer</button></div></div>';
    $('#feuille').scrollTop = 0;
    if (i < 0) setTimeout(function () { var e = $('#seEp'); if (e) e.focus(); }, 60);
    $('#seAnnuler').onclick = function () { z.hidden = true; z.innerHTML = ''; };
    if ($('#seSuppr')) $('#seSuppr').onclick = function () {
      var old = liste.splice(i, 1)[0]; sectionsSales(); sauver();
      z.hidden = true; z.innerHTML = ''; rendreSections();
      toast('Section supprimée', function () { liste.splice(i, 0, old); sectionsSales(); sauver(); rendreSections(); });
    };
    $('#seOk').onclick = function () {
      var ep = P.num($('#seEp').value), la = P.num($('#seLa').value), pi = P.num($('#sePi').value);
      var lg = $('#seLg').value.split(/[;\s\/]+/).filter(Boolean).map(P.num);
      if (!(ep > 0 && la > 0)) { toast('Épaisseur et largeur obligatoires.'); return; }
      if (!(pi > 0) || Math.round(pi) !== pi) { toast('Nombre de pièces invalide.'); return; }
      if (lg.some(function (v) { return !(v > 0 && v <= 20); })) { toast('Longueurs invalides (ex. 3 ; 4).'); return; }
      var dbl = liste.findIndex(function (y, j) { return j !== i && ((y.ep === ep && y.la === la) || (y.ep === la && y.la === ep)); });
      if (dbl >= 0) { toast('Cette section existe déjà.'); return; }
      var o = { ep: ep, la: la, pi: pi }; if (lg.length) o.lg = lg;
      if (i >= 0) liste[i] = o; else liste.push(o);
      sectionsSales(); sauver();
      z.hidden = true; z.innerHTML = ''; rendreSections();
      toast(fm(ep) + ' × ' + fm(la) + ' = ' + pi + ' pièces');
    };
  }

  // Liste des clients : on en choisit 2 ou plus, puis on garde un seul nom
  function ouvrirClients() {
    var choisis = [];
    function rendre(f) {
      var l = tousClients();
      var doubles = {}; l.forEach(function (a) { l.forEach(function (b) { if (a !== b && cliProches(a, b)) doubles[a] = 1; }); });
      f.innerHTML = '<div class="poignee"></div><div class="sec-tete"><h2>Clients</h2><button class="lien" data-f="1" type="button">Fermer</button></div>' +
        '<p class="petit-txt">Touche 2 clients (ou plus) qui sont les mêmes, puis « Fusionner ». ⚠ = doublon probable.</p>' +
        '<div class="carte cl-liste">' + (l.length ? l.map(function (x) {
          return '<button type="button" class="cl-l' + (choisis.indexOf(x) >= 0 ? ' actif' : '') + '" data-cl="' + esc(x) + '"><span class="cl-c"></span><b>' + esc(x) + (doubles[x] ? ' <i class="cl-d">⚠</i>' : '') + '</b><small>' + nbCamionsClient(x) + ' camion' + (nbCamionsClient(x) > 1 ? 's' : '') + '</small></button>';
        }).join('') : '<div class="vide">Aucun client.</div>') + '</div>' +
        (choisis.length >= 2 ? '<p class="reg-st">Garder quel nom ?</p><div class="cl-garder">' + choisis.map(function (x) { return '<button type="button" class="btn sec" data-garde="' + esc(x) + '">' + esc(x) + '</button>'; }).join('') + '</div>' : '');
    }
    var f = ouvrirFeuille(''); rendre(f);
    f.onclick = function (e) {
      if (e.target.closest('[data-f]')) { fermerFeuille(); return; }
      var b = e.target.closest('[data-cl]');
      if (b) { var x = b.dataset.cl, i = choisis.indexOf(x); if (i >= 0) choisis.splice(i, 1); else choisis.push(x); rendre(f); return; }
      var g = e.target.closest('[data-garde]'); if (!g) return;
      var garde = g.dataset.garde, de = choisis.filter(function (x) { return x !== garde; });
      fusionnerClients(de, garde).then(function (n) { toast(de.length + ' nom' + (de.length > 1 ? 's' : '') + ' fusionné' + (de.length > 1 ? 's' : '') + ' dans ' + garde); choisis = []; rendre(f); }).catch(function (er) { toast(er.message); });
    };
  }
  function fusionnerClients(de, garde) {
    Object.keys(db.camions).forEach(function (k) {
      var c = db.camions[k]; if (de.indexOf(c.client) < 0) return;
      c.client = garde; if (estAMoi(c) || (enEquipe() && Sync.moi().admin)) toucher(c);
    });
    db.clients = db.clients.filter(function (x) { return de.indexOf(x) < 0; }); if (db.clients.indexOf(garde) < 0) db.clients.push(garde);
    sauver();
    return enEquipe() ? Sync.renommerClient(de, garde) : Promise.resolve(0);
  }
  function lierReglages() {
    $('#ouvrirSections').onclick = ouvrirSections;
    $('#ouvrirClients').onclick = ouvrirClients;
    var r = reg();
    function numChamp(id, cle, verif) {
      $('#' + id).addEventListener('change', function () {
        var v = P.num(this.value);
        if (!isFinite(v) || v <= 0 || (verif && !verif(v))) { toast('Valeur refusée.'); this.value = fm(r[cle]); return; }
        r[cle] = v; db.sync = db.sync || {}; if (enEquipe() && !Sync.moi().admin) db.sync.limitesSales = true; else db.sync.reglagesSales = true; sauver(); this.value = fm(v);
        Object.keys(db.camions).forEach(function (k) { var c = db.camions[k]; if (c.statut === 'en_cours') c.etat = P.etat(c.total_m3, r).code; });
      });
    }
    numChamp('rMin', 'm3Min', function (v) { return v < r.m3Max; });
    numChamp('rMax', 'm3Max', function (v) { return v > r.m3Min; });
    numChamp('rE1Min', 'e1Min', function (v) { return v < r.e1Max; });
    numChamp('rE1Max', 'e1Max', function (v) { return v > r.e1Min; });
    numChamp('rEcart', 'ecartMax');
    $$('#segTheme button').forEach(function (b) { b.onclick = function () { r.theme = b.dataset.t; db.sync.reglagesSales = true; sauver(); appliquerTheme(); rendreReglages(); }; });

    if ($('#regRejoindre')) $('#regRejoindre').onclick = proposerRejoindre;
    if ($('#regQuitter')) $('#regQuitter').onclick = function () {
      var adm2 = Sync.moi().admin;
      ouvrirFeuille('<h2>Se déconnecter ?</h2><p class="petit-txt">Tes camions restent dans l\'équipe. ' + (adm2 ? '🔴 Pour revenir, il te faudra ton <b>code secret</b> d\'admin. L\'as-tu bien noté ?' : 'Pour revenir : le code de l\'équipe et le même prénom.') + '</p>' +
        '<div class="grille-btns"><button class="btn sec" id="qNon" type="button">Annuler</button><button class="btn danger" id="qOui" type="button">Se déconnecter</button></div>');
      $('#qNon').onclick = function () { fermerFeuille(); };
      $('#qOui').onclick = function () {
        this.disabled = true; this.textContent = 'Envoi…';
        Sync.quitter().then(function () { fermerFeuille(); rendreReglages(); setTimeout(proposerRejoindre, 250); }).catch(function (e) { fermerFeuille(); toast(e.message); });
      };
    };
    if ($('#regSync')) $('#regSync').onclick = function () { Sync.lancer().then(function () { rendreReglages(); toast(Sync.etat().erreur || 'Synchro terminée ✔'); }); };
    if ($('#regPrenom')) $('#regPrenom').onclick = function () {
      demanderTexte('Ton prénom', Sync.moi().prenom, '', true).then(function (v) { if (v) Sync.changerPrenom(v).then(function () { toast('Prénom changé'); rendreReglages(); }).catch(function (e) { toast(e.message); }); });
    };
    if ($('#regGestion')) $('#regGestion').onclick = ouvrirGestion;
    $$('[data-adm]').forEach(function (b) { b.onclick = function () { aller(b.dataset.adm); }; });
    $('#exp').onclick = sauvegarderFichier;
    $('#imp').onclick = function () { $('#impFichier').click(); };
    $('#impFichier').onchange = function () {
      var fi = this.files[0]; if (!fi) return;
      fi.text().then(function (t) {
        var d = JSON.parse(t), n = 0;
        if (!d || d.app !== 'camions-sdc') throw new Error();
        Object.keys(d.camions || {}).forEach(function (k) {
          var c = d.camions[k], l = db.camions[k];
          if (!l || (c.maj_le || '') > (l.maj_le || '')) { c._sale = true; db.camions[k] = c; n++; }
        });
        (d.clients || []).forEach(function (x) { if (db.clients.indexOf(x) < 0) db.clients.push(x); });
        sauver(); toast(n + ' camion(s) importé(s)'); rendreReglages();
      }).catch(function () { toast('Fichier non reconnu.'); });
    };
  }

  // ---------- Démarrage ----------
  if (MODE_FICHE) { document.documentElement.dataset.theme = 'clair'; Ambiance.appliquer(reg()); pageFiche(); return; }
  Sync.init({
    lire: function () { return db; },
    ecrire: function (d) { db = d; sauver(true); },
    changement: function (st, change) {
      Ambiance.appliquer(reg());
      if (Sync.actif() && !Sync.rejoint() && !verrouEquipe && !st.attente) { setTimeout(proposerRejoindre, 200); }
      if (document.activeElement && document.activeElement.matches('input')) return; // on ne dérange pas une saisie
      if (vueActive === 'plan') { if (change && !apercu && !selection) rendrePlanVue(); return; }
      if (vueActive === 'camion' || vueActive === 'client' || vueActive === 'calcul') return;
      rafraichirVue();
    }
  });
  appliquerTheme();
  Ambiance.chargeur(function (id) { return Sync.lireFond(id); });
  Ambiance.appliquer(reg());
  setInterval(function () { if (!document.hidden) Ambiance.appliquer(reg()); }, 60000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) Ambiance.appliquer(reg()); });
  try { // petit message après une mise à jour automatique
    if (localStorage.getItem('csdc.version') && localStorage.getItem('csdc.version') !== VERSION_APP) setTimeout(function () { toast(estAdmin() ? 'Appli mise à jour : nouvelle version ' + VERSION_APP : 'Appli mise à jour ✔'); }, 900);
    localStorage.setItem('csdc.version', VERSION_APP);
  } catch (e) {}
  history.replaceState({ v: 'accueil', d: 0 }, '');
  montrer('accueil');
  if (Sync.actif() && !Sync.rejoint()) setTimeout(proposerRejoindre, 500);
  else if (Sync.secretAVoir()) setTimeout(montrerSecret, 500);

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    var avaitCtrl = !!navigator.serviceWorker.controller, recharge = false;
    // Mise à jour automatique : l'appli vérifie au démarrage et à chaque retour sur l'écran, puis se recharge toute seule
    navigator.serviceWorker.register('sw.js?v=17').then(function (reg) {
      function verifier() { try { reg.update(); } catch (e) {} }
      document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible') verifier(); });
      setInterval(verifier, 30 * 60 * 1000);
    }).catch(function () {});
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (avaitCtrl && !recharge) { recharge = true; try { localStorage.setItem('csdc.majVue', '0'); } catch (e) {} location.reload(); }
    });
  }
})();
