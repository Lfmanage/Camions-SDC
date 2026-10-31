/* Camions SDC — application */
(function () {
  'use strict';
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(function (e) { document.addEventListener(e, function (x) { x.preventDefault(); }, { passive: false }); });
  document.addEventListener('touchmove', function (x) { if (x.touches && x.touches.length > 1) x.preventDefault(); }, { passive: false });
  var dtap = 0; document.addEventListener('touchend', function (x) { var n = Date.now(); if (n - dtap < 350 && !/INPUT|TEXTAREA|SELECT/.test((x.target.tagName || ''))) x.preventDefault(); dtap = n; }, { passive: false });
  var P = window.Plan;
  var VERSION_APP = '47';
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
    d.sync = d.sync || {};
    return d;
  }
  var db = charger();
  function sauver(sansSynchro) {
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
    if (c && c.parentId) { var pp = db.camions[c.parentId], rp = pp ? cfgC(pp) : r; r.m3Min = 0; r.m3Max = 1e6; r.cible = rp.cible; return r; }
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
  function besoinSplit(p) { return p.double && p.lignes.length && (!p.double.r || p.double.sig !== sigLignes(p.lignes)); }
  function splitDouble(p) {
    var res = P.partager(p.lignes, p.double.lg, Object.assign({}, db.reglages), p.double.graine || 0);
    p.double.r = res.map(function (x, i) {
      return { id: p.id + '~' + i, parentId: p.id, rem: i, lgMax: p.double.lg[i], lignes: x.lignes, plan: x.plan, ordre: null, decal: null,
        planDepart: { plan: JSON.parse(JSON.stringify(x.plan)), note: x.note }, planCalcule: true, planManuel: false, planVariante: false, plansVus: null, graineAutre: 1,
        total_m3: Math.round(P.totalM3(x.lignes) * 1000) / 1000 };
    });
    p.double.actif = 0; p.double.sig = sigLignes(p.lignes);
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
    var res = P.meilleurTient(c.lignes, cfgC(c));
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
  function peutSupprimer(c) { return estAMoi(c) || (enEquipe() && Sync.moi().admin); }
  function prenomDe(c) { return Sync.nom(c.auteur_prenom) || (estAMoi(c) ? (Sync.moi().prenom || 'Moi') : '?'); }
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
    f.innerHTML = '<div class="poignee"></div>' + html;
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
  var ONGLET = { accueil: 'accueil', client: 'accueil', camion: 'accueil', plan: 'accueil', ajout: 'accueil', calcul: 'calcul', historique: 'historique', reglages: 'reglages', equipe: 'equipe', profil: 'equipe' };
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
    if (v === 'historique') { if (ongletHisto === 'stats') rendreStats(); else rendreHisto(); }
    if (v === 'reglages') rendreReglages();
    if (v === 'ajout') rendreAjout();
    if (v === 'equipe') rendreEquipe();
    if (v === 'profil') rendreProfil();
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
    var d = Object.assign({}, c.lignes[c.lignes.length - 1], { id: petitId() });
    c.lignes.push(d); majPlan(c); toucher(c); rendreCamion();
    toast('Ajouté : ' + fm(d.ep) + ' × ' + fm(d.la) + ' · ' + fLong(d.lo) + ' m');
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
    $('.acc-titre').textContent = h >= 6 && h < 18 ? 'Bonjour' : 'Bonsoir';
    majInstaller();
    var auj = jourCle(d.toISOString()), tous = Object.keys(db.camions).map(function (k) { return db.camions[k]; }).filter(function (c) { return !c.supprime; });
    var jour = tous.filter(function (c) { return c.statut === 'termine' && jourCle(c.termine_le) === auj; });
    var m3 = jour.reduce(function (a, c) { return a + c.total_m3; }, 0);
    $('#accStats').innerHTML = '<div class="stat"><small>Aujourd\'hui</small><b>' + f2(m3) + ' m³</b></div><button type="button" class="stat stat-go" data-camions="1"><small>Camions aujourd\'hui</small><b>' + jour.length + '</b><i>Voir les derniers</i></button>';
    $('#accNbJour').textContent = 'Tous les camions';
    $('#accSous').textContent = salutation(d);
    var cours = tous.filter(function (c) { return c.statut === 'en_cours' && c.lignes.length && estAMoi(c); }).sort(function (a, b) { return b.maj_le < a.maj_le ? -1 : 1; });
    $('#accEnCours').innerHTML = cours.length ? '<p class="titre-sec">En cours</p><div class="carte liste-cours">' + cours.map(function (c) {
      return glisse(c.id, '<button type="button" class="en-cours-l" data-reprendre="' + esc(c.id) + '"><span><b>' + esc(c.client || 'Sans client') + '</b><small>' + (c.reference ? 'Réf. ' + esc(c.reference) + ' · ' : '') + f2(c.total_m3) + ' m³</small></span><span class="go">Reprendre</span></button>');
    }).join('') + '</div><p class="astuce">Glisse à gauche pour supprimer, à droite pour ouvrir.</p>' : '';
  }
  // ---------- Feuilles d'automne qui tombent (décor, ne bloque jamais un appui) ----------
  function feuillesAutomne() {
    var z = $('#feuillesZone'); if (!z || z.childNodes.length) return;
    var h = '', n = 11;
    for (var i = 0; i < n; i++) {
      var prof = Math.random(), taille = Math.round(16 + prof * 26), duree = (14 - prof * 5 + Math.random() * 6).toFixed(1);
      var flou = prof > 0.86 ? 2.2 : (prof < 0.2 ? 0.8 : 0);
      h += '<i class="fe' + (i >= 5 ? ' fe-plus' : '') + '" style="left:' + (Math.random() * 96).toFixed(1) + '%;--d:' + duree + 's;--r:' + (-Math.random() * duree).toFixed(1) + 's;--b:' + (2 + Math.random() * 3).toFixed(1) + 's;--x:' + Math.round(20 + Math.random() * 50) + 'px">' +
        '<i style="width:' + taille + 'px;height:' + taille + 'px;background-size:' + taille * 10 + 'px ' + taille + 'px;background-position:' + (-(i % 10) * taille) + 'px 0;filter:blur(' + flou + 'px) drop-shadow(0 ' + Math.round(2 + prof * 5) + 'px ' + Math.round(3 + prof * 6) + 'px rgba(40,20,0,.22));--t:' + (3 + Math.random() * 4).toFixed(1) + 's"></i></i>';
    }
    z.innerHTML = h;
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
    }).join('') + '<p class="sous">Les dernières longueurs sont gardées pour la prochaine fois.</p>';
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
    rendreSuivi();
  }
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
  $('#calcSuivi').addEventListener('click', function (e) {
    var c = courant();
    if (e.target.closest('[data-voirplan]')) { if (!c.lignes.length) { toast('Ajoute d\'abord un paquet.'); return; } aller('plan'); return; }
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
    aller('camion');
    setTimeout(function () { $('#fEp').focus(); }, 80);
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
      if (!res) { toast('C\'est le seul bon plan avec ces colis.'); return; }
      c.plan = res.plan; c.ordre = null; c.decal = null; c.planManuel = false; c.planVariante = true; c.graineAutre = res.graine;
      var mieux = c.planDepart && res.note < c.planDepart.note - 0.01;
      if (mieux) c.planDepart = { plan: JSON.parse(JSON.stringify(res.plan)), note: res.note };
      c.plansVus.push(res.signature); selection = null; toucher(c);
      rendrePlanVue(); window.scrollTo({ top: 0, behavior: 'smooth' });
      toast(mieux ? 'Meilleur plan trouvé : c\'est le nouveau plan de départ' : 'Nouveau plan · ' + (c.plansVus.length) + 'e proposition');
    }, 30);
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
    var e1 = ['G', 'D'].filter(function (s) { var l = v.rows[s + '1'].len; return l < Math.round(r.e1Min * 100) && l > 0; });
    if (e1.length) out.push(['⚠', 'É1 trop court', e1.map(function (s) { return (s === 'G' ? 'conducteur ' : 'passager ') + fm(v.rows[s + '1'].m) + ' m'; }).join(' · ') + ' (mini ' + fm(r.e1Min) + ' m)']);
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
    c.statut = 'termine'; c.termine_le = maintenant();
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
  // ---------- Camion en photo ----------
  var nSvg = 0, detailsOuverts = false;
  var PH = { W: 1672, H: 570, x0: 48, xd: 1213, deck: 378, img: 'camion.jpg?v=17', bois: 'bois.jpg?v=17' };
  PH.k = (PH.xd - PH.x0) / 13.6;
  var PIQUETS = [105, 238, 370, 578, 722, 960, 1082];
  function cielDefs(u) {
    return '<linearGradient id="ciel' + u + '" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="380">' +
      '<stop offset="0" stop-color="#A3C1E0"/><stop offset=".35" stop-color="#BBCEDF"/><stop offset=".5" stop-color="#CBD4DD"/><stop offset="1" stop-color="#E4DDD5"/></linearGradient>' +
      '<linearGradient id="piq' + u + '" x1="0" x2="1"><stop offset="0" stop-color="#8E979F"/><stop offset=".45" stop-color="#F1F3F4"/><stop offset="1" stop-color="#7D868E"/></linearGradient>';
  }
  // Rangées de la photo (camion d'accueil) : on dévoile le chargement de l'avant vers l'arrière
  var RANGS_HERO = [{ x1: 48, x2: 1213, y1: 278, y2: 378 }, { x1: 85, x2: 1213, y1: 158, y2: 280 }];

  function heroPhoto(c, r, trop) {
    var f = Math.max(0, Math.min(1, c.total_m3 / r.m3Max));
    var parts = [Math.min(1, f * 2), Math.max(0, Math.min(1, f * 2 - 1))];
    var zone = $('#heroCamion');
    var svg = zone.querySelector('svg[data-photo]');
    if (!svg) {
      var u = 'h' + (++nSvg);
      var h = '<svg class="camion-photo" data-photo="1" viewBox="0 92 1672 470" preserveAspectRatio="xMidYMid slice" role="img" aria-label="Camion en cours de chargement"><defs>' + cielDefs(u) + '</defs>' +
        '<image href="' + PH.img + '" x="0" y="0" width="1672" height="570" preserveAspectRatio="none"/>';
      RANGS_HERO.forEach(function (g, i) {
        h += '<rect class="vide-rang" data-i="' + i + '" x="' + g.x1 + '" y="' + g.y1 + '" width="' + (g.x2 - g.x1) + '" height="' + (g.y2 - g.y1) + '" fill="url(#ciel' + u + ')"/>';
        h += '<rect class="vide-trait" data-i="' + i + '" x="' + (g.x1 + 4) + '" y="' + (g.y1 + 4) + '" width="' + (g.x2 - g.x1 - 8) + '" height="' + (g.y2 - g.y1 - 8) + '" rx="8"/>';
      });
      h += '<rect class="trop-voile" x="85" y="158" width="1128" height="122"/></svg>';
      zone.innerHTML = h;
      svg = zone.querySelector('svg[data-photo]');
    }
    $$('.vide-rang', svg).forEach(function (el, i) { el.style.transform = 'scaleX(' + (1 - parts[i]).toFixed(4) + ')'; });
    $$('.vide-trait', svg).forEach(function (el, i) { el.style.opacity = parts[i] >= 1 ? 0 : 1; el.style.transform = 'scaleX(' + (1 - parts[i]).toFixed(4) + ')'; });
    svg.classList.toggle('trop', !!trop);
  }

  // ---------- Plan : barres modernes, sens de chargement réel ----------
  function libColis(k) { return fm(k.lo) + ' m · ' + fm(k.ep) + '×' + fm(k.la); }

  function statutPlan(v, r) {
    var totCm = 0;
    Object.keys(v.rows).forEach(function (k) { totCm += v.rows[k].len; });
    v.nonPlaces.forEach(function (k) { totCm += k.cm; });
    var N = v.N || 3, maxCm = 2 * N * Math.round(r.e1Max * 100);
    if (totCm > maxCm) return { cls: 'e', etq: '⚠ Trop long', court: fm((totCm - maxCm) / 100) + ' m de colis en trop : retire des colis.', detail: 'Les colis font ' + fm(totCm / 100) + ' m bout à bout : ' + fm((totCm - maxCm) / 100) + ' m de trop pour ' + N + ' étages de ' + fm(r.e1Max) + ' m. Retire des colis.' };
    if (v.etat.code === 'peu') return { cls: 'a', etq: 'Il manque ' + f2(v.etat.manque) + ' m³' };
    var lg = v.erreurs.filter(function (m) { return /^Étage/.test(m); });
    if (lg.length) return { cls: 'e', etq: '⚠ À revoir', detail: lg[0] };
    if (v.etat.code === 'trop') return { cls: 'e', etq: 'Dépassé ' + f2(v.etat.depasse) + ' m³' };
    if (v.ecrase) return { cls: 'a', etq: '≈ Fait au mieux', court: 'Étages en rouge : épaisseurs mélangées.', detail: 'Avec ces colis, impossible de mettre toutes les sections fines au-dessus des plus épaisses : les étages en rouge ont un colis posé sur plus fin que lui.' };
    if (P.deseq(v) > r.ecartMax + 0.005) return { cls: 'a', etq: '≈ Équilibré au mieux', court: 'Écart de ' + f2(Math.min(P.deseq(v), 99)) + ' m³, le plus faible possible.', detail: 'Avec ces colis, écart de ' + f2(Math.min(P.deseq(v), 99)) + ' m³ entre gauche et droite : le plus faible possible.' };
    var lgM = v.avis.filter(function (m) { return /cm/.test(m); });
    if (lgM.length) return { cls: 'a', etq: '≈ Équilibré au mieux', court: 'Longueurs gauche/droite : le plus proche possible.', detail: lgM[0].replace(/\.$/, '') + ' : le plus petit écart possible avec ces colis.' };
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
        var ro = v.rows[s + f], ext = f === N ? ro.ext + v.rows['C' + N].len : ro.ext;
        if (ext > mx) aj('Dépasse ' + fm(r.e1Max) + ' m');
        if (f > 1) {
          var dessous = v.rows[s + (f - 1)].ext;
          if (ext > dessous && ro.colis.length + (f === N ? v.rows['C' + N].colis.length : 0)) aj('É' + f + ' plus long que É' + (f - 1));
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
    var place = edit && (selection || selEtr) ? 36 : 0; // place gardée pour le bouton « + » en bout d'étage
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
        h += '<div class="rang' + (ro.alerte ? ' ko' : '') + '"><div class="tag">É' + f + '<b>@LG@</b></div><div class="trk"><i class="lim" style="left:calc(2px + (100% - ' + (4 + place) + 'px) * ' + (r.e1Max * 100 / maxLen).toFixed(4) + ')"></i>';
        if (f === N) {
          var c3 = v.rows['C' + N], maxPaire = Math.max(v.rows['G' + N].len, v.rows['D' + N].len);
          var E = maxPaire + c3.len, sup = Math.min(v.rows['G' + (N - 1)].len, v.rows['D' + (N - 1)].len);
          if (c3.colis.length) c3.colis.forEach(function (k) { h += chip(k, true); }); // colis du milieu : tout devant, contre la cabine
          var gg = gapsRow(c, v, s + f), fin = c3.len;
          var aMain = ro.colis.some(function (k) { return c.decal && c.decal[k.id] != null; }); // vides seulement si l'utilisateur en a fait
          ro.colis.forEach(function (k, i) { if (aMain) h += htmlVide(gg[i], 'data-gap="' + esc(k.id) + '"'); fin += gg[i] + k.cm; h += chip(k, false, false, true); });
          if (ro.colis.length && aMain) h += htmlVide(Math.max(0, v.rows[s + (f - 1)].ext - fin), 'data-fin="' + s + f + '"');
          lgAff = E / 100;
        } else ro.colis.forEach(function (k) { h += chip(k, false); });
        if (edit && (selection || selEtr)) {
          var libre = (f > 1 ? Math.min(Math.round(r.e1Max * 100), v.rows[s + (f - 1)].ext) : Math.round(r.e1Max * 100)) - ro.ext - (f === N ? v.rows['C' + N].len : 0);
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
               : '<button type="button" class="btn petit btn-mil" data-milieu="1">' + (dejaMil ? 'Échanger avec le milieu' : 'Milieu') + '</button><button type="button" class="btn sec petit" data-decote="1">De côté</button>') +
        (c.parentId ? '<button type="button" class="btn sec petit bs-rem" data-verem="1">' + (c.rem ? '← Rem. 1' : '→ Rem. 2') + '</button>' : '') +
        '<button type="button" class="btn sec petit bs-sup" data-suppr="1">Supprimer</button>' +
        '<button type="button" class="x" data-annuler="1" aria-label="Annuler">×</button></div>';
      else if (sel) h += '<div class="barre-sel bs1"><span class="bs-t"><b>' + esc(libColis(sel)) + '</b> · touche + pour le poser</span><button type="button" class="btn sec petit bs-sup" data-suppr="1">Supprimer</button><button type="button" class="x" data-annuler="1" aria-label="Annuler">×</button></div>';
      else h += '<div class="aide-l">' + (legMil || '<span>' + (N === 4 ? '4 étages (surtout du 18×100). ' : '') + 'Touche un colis pour le déplacer. Glisse ceux du dernier étage.</span>') +
        ((c.planManuel || c.planVariante) ? '<button type="button" class="btn-lien recalc" data-recalc="1">Plan de départ</button>' : '') + '</div>';
      if (sel && (c.planManuel || c.planVariante)) h += '<button type="button" class="btn-lien recalc" data-recalc="1">Plan de départ</button>';
    }
    return h;
  }

  var planGeo = { maxLen: 1300, place: 0 };
  function styleVide(cm) { return cm > 0 ? 'width:calc((100% - ' + (4 + planGeo.place) + 'px) * ' + (cm / planGeo.maxLen).toFixed(4) + ' - 2px)' : 'width:0;margin-left:-2px'; }
  function txtVide(cm) { if (cm < 100) return ''; var t = fm(Math.round(cm) / 100) + ' m'; return cm >= 160 ? t + ' libre' : t; }
  var selRem = null, selEtr = false; // double : remorque où le colis choisi a été pris
  function rendrePlanVue() {
    var base = courantBase(), dbl = base.double;
    $('#v-plan h1').textContent = dbl ? 'Remorque ' + ((dbl.actif || 0) + 1) : 'Plan';
    $('#btnTerminer').textContent = dbl && !(dbl.actif || 0) ? '2ème plan →' : 'Terminer';
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
    var besoin = c.lignes.length && (v.nonPlaces.length || (!c.planCalcule && !c.planManuel && (P.noteVerif(v) >= 1000 || (!c.planVariante && P.deseq(v) > reg().ecartMax + 0.005))));
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
  function ajusterPlan() {
    var z = $('#planZone'); if (!z || vueActive !== 'plan') return;
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
    var haut = Object.keys(plan0).filter(function (x) { return x !== id && (plan0[x] === 'G' + N || plan0[x] === 'D' + N || plan0[x] === k); });
    var base = Object.assign({}, plan0); base[id] = k;
    var errAvant = v1.erreurs.slice(), best = null, pire = null, nb = Math.min(haut.length, 14);
    for (var m = 0; m < (1 << nb); m++) {
      var q = Object.assign({}, base);
      haut.forEach(function (x, i) { q[x] = i < nb ? ((m >> i) & 1 ? 'D' + N : 'G' + N) : plan0[x] === k ? 'G' + N : plan0[x]; });
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
    var gaps = gapsRow(c, v, k), fin = v.rows['C' + v.N].len + cs.reduce(function (a2, x, j) { return a2 + x.cm + gaps[j]; }, 0);
    var finSup = v.rows[k.charAt(0) + (v.N - 1)].ext;
    gl = { c: c, k: k, id: id, i: i, cs: cs, g0: gaps, fin0: fin, finSup: finSup, x0: e.clientX, y0: e.clientY, lu: lu, d: 0, actif: false, ch: ch, pid: e.pointerId, trk: trk };
  });
  window.addEventListener('pointermove', function (e) {
    if (!gl || e.pointerId !== gl.pid) return;
    var dx = e.clientX - gl.x0;
    if (!gl.actif) {
      if (Math.abs(dx) < 8) return;
      if (Math.abs(e.clientY - gl.y0) > Math.abs(dx)) { gl = null; return; }
      gl.actif = true; gl.ch.classList.add('glisse'); try { gl.ch.setPointerCapture(gl.pid); } catch (er) {}
      if (!$('[data-gap]', gl.trk)) { // 1er glissement sur cet étage : on fait apparaître les vides
        var der = null;
        gl.cs.forEach(function (x, j) { var el = $('.chip.gl[data-c="' + cssEsc(x.id) + '"]', gl.trk); if (!el) return; var iv = document.createElement('i'); iv.className = 'vide'; iv.setAttribute('data-gap', x.id); iv.setAttribute('style', styleVide(gl.g0[j])); el.parentNode.insertBefore(iv, el); der = el; });
        if (der) { var fv = document.createElement('i'); fv.className = 'vide'; fv.setAttribute('data-fin', gl.k); var rs = Math.max(0, gl.finSup - gl.fin0); fv.setAttribute('style', styleVide(rs)); fv.textContent = txtVide(rs); der.parentNode.insertBefore(fv, der.nextSibling); }
      }
    }
    e.preventDefault();
    var d = Math.round(dx / gl.lu / 50) * 50;
    var r = nouveauxVides(gl, d); if (r.d === gl.d) return;
    gl.d = r.d; gl.gg = r.gg;
    var trk = gl.trk;
    gl.cs.forEach(function (x, j) { var el = $('[data-gap="' + cssEsc(x.id) + '"]', trk); if (el) { el.setAttribute('style', styleVide(r.gg[j])); el.textContent = txtVide(r.gg[j]); } });
    var fe = $('[data-fin]', trk), reste = Math.max(0, gl.finSup - r.fin);
    if (fe) { fe.setAttribute('style', styleVide(reste)); fe.textContent = txtVide(reste); }
  }, { passive: false });
  // Vers l'arrière : le colis prend d'abord le vide devant le suivant, puis pousse les suivants.
  // Vers la cabine : seul ce colis avance, les suivants ne bougent pas.
  function nouveauxVides(g, d) {
    var gg = g.g0.slice(), i = g.i, n = gg.length, lim = Math.max(planGeo.maxLen, g.fin0);
    if (d < 0) { d = Math.max(d, -gg[i]); gg[i] += d; if (i + 1 < n) gg[i + 1] -= d; }
    else if (d > 0) {
      var libre = i + 1 < n ? gg[i + 1] : 0, pousse = Math.min(Math.max(0, d - libre), lim - g.fin0);
      d = Math.min(d, libre + pousse); gg[i] += d; if (i + 1 < n) gg[i + 1] -= Math.min(d, libre);
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
  function ficheCanvas(c) {
    if (c.lignes.length && !c.double && (!c.plan || !Object.keys(c.plan).length)) c.plan = P.meilleur(c.lignes, cfgC(c)).plan;
    var v = vplan(c), W = 1080, pad = 56, larg = W - 2 * pad;
    var INK = '#13221A', MU = '#5E6E64', VERT = '#3B5A34';
    var F = function (w, px) { return w + ' ' + px + 'px "Inter Tight", Inter, system-ui, sans-serif'; };
    // regroupement par section
    var grp = {}, ordre = [];
    c.lignes.forEach(function (l) {
      var k = fm(l.ep) + ' × ' + fm(l.la);
      if (!grp[k]) { grp[k] = { ep: l.ep, la: l.la, lgs: [], n: 0, m: 0 }; ordre.push(k); }
      var g = grp[k]; if (g.lgs.indexOf(l.lo) < 0) g.lgs.push(l.lo); g.n += l.nb || 1; g.m += P.volTotalLigne(l);
    });
    ordre.sort(function (a, b) { return grp[b].ep - grp[a].ep || grp[b].la - grp[a].la; });
    var nbTot = c.lignes.reduce(function (a, l) { return a + (l.nb || 1); }, 0);
    var plan = imagePlan(c), cropY = 230, cropH = Math.max(10, (plan.finPlan || plan.height) - cropY), planH = Math.round(cropH * (larg / W));
    // hauteur des lignes du tableau (les longueurs passent à la ligne si besoin)
    var cv = document.createElement('canvas'), x = cv.getContext('2d');
    var colLg = pad + 290, colN = W - pad - 220, colM = W - pad - 20, lgMax = colN - 60 - colLg;
    x.font = F(600, 26);
    var lignesTab = ordre.map(function (k) {
      var g = grp[k], puces = g.lgs.sort(function (a, b) { return a - b; }).map(function (lo) { return fLong(lo) + ' m'; }), lignes = [[]], larg0 = 0;
      puces.forEach(function (t) { var w = x.measureText(t).width + 28; if (larg0 + w > lgMax && lignes[lignes.length - 1].length) { lignes.push([]); larg0 = 0; } lignes[lignes.length - 1].push([t, w]); larg0 += w + 10; });
      return { k: k, g: g, lignes: lignes, h: 40 + lignes.length * 46 };
    });
    var hTab = lignesTab.reduce(function (a, l) { return a + l.h; }, 0);
    var H = 440 + 60 + hTab + 90 + 80 + planH + 110;
    cv.width = W; cv.height = H;
    x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
    function rond(a, b, w, h, rr) { x.beginPath(); x.moveTo(a + rr, b); x.arcTo(a + w, b, a + w, b + h, rr); x.arcTo(a + w, b + h, a, b + h, rr); x.arcTo(a, b + h, a, b, rr); x.arcTo(a, b, a + w, b, rr); x.closePath(); }
    // en-tête
    x.fillStyle = MU; x.font = F(600, 22); x.fillText('FICHE DE CHARGEMENT', pad, 76);
    x.fillStyle = INK; x.font = F(700, 68); x.fillText(c.client || 'Camion', pad, 150);
    var d = new Date(c.termine_le || c.maj_le || Date.now());
    x.fillStyle = MU; x.font = F(500, 28);
    x.fillText((c.reference ? 'Réf. ' + c.reference + ' · ' : '') + d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + heure(d.toISOString()), pad, 196);
    if (LOGO.complete && LOGO.naturalWidth) { var lh = 120, lw = LOGO.naturalWidth * lh / LOGO.naturalHeight; x.drawImage(LOGO, W - pad - lw, 40, lw, lh); }
    x.fillStyle = VERT; x.fillRect(pad, 226, larg, 6);
    // chiffres clés
    var cases = [['Volume', f2(v.total), ' m³', 1], ['Colis', String(nbTot), '', .6], ['Gauche / Droite', f2(v.volG) + ' / ' + f2(v.volD), '', 1.4]];
    var tw = cases.reduce(function (a, k) { return a + k[3]; }, 0), cx = pad, gap = 20;
    cases.forEach(function (k) {
      var w = (larg - gap * 2) * k[3] / tw;
      x.fillStyle = '#F1F5F0'; rond(cx, 260, w, 136, 22); x.fill();
      x.fillStyle = MU; x.font = F(500, 24); x.fillText(k[0], cx + 28, 304);
      x.fillStyle = INK; x.font = F(700, k[3] > 1.2 ? 50 : 56); x.fillText(k[1], cx + 28, 370);
      if (k[2]) { var wv = x.measureText(k[1]).width; x.fillStyle = MU; x.font = F(500, 28); x.fillText(k[2], cx + 28 + wv, 370); }
      cx += w + gap;
    });
    // tableau
    var y = 460;
    x.fillStyle = MU; x.font = F(600, 21);
    x.fillText('SECTION', pad + 20, y); x.fillText('LONGUEURS', colLg, y);
    x.textAlign = 'center'; x.fillText('COLIS', colN, y); x.textAlign = 'right'; x.fillText('M³', colM, y); x.textAlign = 'left';
    y += 22; x.fillStyle = '#DDE3DC'; x.fillRect(pad, y, larg, 2); y += 2;
    lignesTab.forEach(function (l, i) {
      if (i % 2 === 0) { x.fillStyle = '#F7F9F6'; x.fillRect(pad, y, larg, l.h); }
      var mid = y + l.h / 2 + 12;
      x.fillStyle = INK; x.font = F(700, 36); x.fillText(l.k, pad + 20, mid);
      var yy = y + 20;
      l.lignes.forEach(function (lg) {
        var xx = colLg;
        lg.forEach(function (pu) { x.fillStyle = '#EADBBF'; rond(xx, yy, pu[1], 40, 10); x.fill(); x.fillStyle = '#3A2814'; x.font = F(600, 26); x.fillText(pu[0], xx + 14, yy + 29); xx += pu[1] + 10; });
        yy += 46;
      });
      x.fillStyle = INK; x.font = F(700, 32); x.textAlign = 'center'; x.fillText(String(l.g.n), colN, mid);
      x.font = F(600, 32); x.textAlign = 'right'; x.fillText(f3(l.g.m), colM, mid); x.textAlign = 'left';
      y += l.h; x.fillStyle = '#EEF1ED'; x.fillRect(pad, y - 2, larg, 2);
    });
    x.fillStyle = VERT; x.fillRect(pad, y, larg, 4); y += 4;
    x.fillStyle = '#F1F5F0'; x.fillRect(pad, y, larg, 80);
    x.fillStyle = INK; x.font = F(700, 34); x.fillText('Total', pad + 20, y + 52);
    x.textAlign = 'center'; x.fillText(String(nbTot), colN, y + 52); x.textAlign = 'right'; x.fillText(f3(v.total), colM, y + 52); x.textAlign = 'left';
    y += 80 + 70;
    // plan
    x.fillStyle = INK; x.font = F(700, 34); x.fillText('Plan de chargement', pad, y); y += 26;
    x.drawImage(plan, 0, cropY, W, cropH, pad, y, larg, planH);
    x.strokeStyle = '#E3E6E1'; x.lineWidth = 2; rond(pad, y, larg, planH, 14); x.stroke();
    y += planH + 50;
    x.fillStyle = '#8A928D'; x.font = F(500, 22); x.textAlign = 'center'; x.fillText('SDC – Les Scieries du Centre · Camions SDC', W / 2, y); x.textAlign = 'left';
    return cv;
  }
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
    var f = ouvrirFeuille('<h2>Partager le camion</h2>' +
      '<button type="button" class="opt-part" data-p="fiche"><span class="op-ic">💬</span><span><b>Fiche chauffeur (image)</b><small>Colis par section + plan, s\'affiche direct dans WhatsApp</small></span></button>' +
      '<button type="button" class="opt-part" data-p="pdf"><span class="op-ic">📄</span><span><b>Fiche chauffeur (PDF)</b><small>La même fiche, pratique pour imprimer</small></span></button>' +
      '<button type="button" class="opt-part" data-p="image"><span class="op-ic">🖼</span><span><b>Image du plan seulement</b><small>Comme avant</small></span></button>' +
      '<button type="button" class="opt-part" data-p="texte"><span class="op-ic">📋</span><span><b>Copier le texte</b><small>Pour le coller où tu veux</small></span></button>');
    f.onclick = function (e) {
      var b = e.target.closest('[data-p]'); if (!b) return;
      var p = b.dataset.p; f.onclick = null; fermerFeuille();
      if (p === 'image') { setTimeout(function () { partagerImage(c); }, 120); return; }
      if (p === 'texte') { copier(texteChauffeur(c)); return; }
      var fc = ficheCanvas(c), url = fc.toDataURL('image/jpeg', 0.9), jpg = octets(url);
      if (p === 'fiche') envoyerFichier(new File([jpg], nomFichier(c, 'jpg'), { type: 'image/jpeg' }), ligneCourte(c), url);
      else envoyerFichier(new File([pdfDepuisJpeg(jpg, fc.width, fc.height)], nomFichier(c, 'pdf'), { type: 'application/pdf' }), ligneCourte(c), null);
    };
  }

  // ---------- Image du plan (partage) ----------
  var LOGO = new Image(); LOGO.src = 'logo-clair.png?v=26';
  // Double remorque : les 2 plans l'un sous l'autre, avec le total du camion en haut
  function imagePlan(c) {
    if (!c.double) return imagePlan1(c);
    assurerPlan(c);
    var A = imagePlan1(remDeN(c, 0)), B = imagePlan1(remDeN(c, 1)), W = A.width, top = 230, tH = 70;
    var fa = A.finPlan || A.height, fb = B.finPlan || B.height;
    var cv = document.createElement('canvas'), x = cv.getContext('2d');
    cv.width = W; cv.height = top + 2 * tH + (fa - top) + (fb - top) + 30;
    x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, W, cv.height);
    x.drawImage(A, 0, 0, W, top, 0, 0, W, top);
    x.fillStyle = '#FFFFFF'; x.fillRect(W / 2, 40, W / 2, 120); // total : celui des 2 remorques
    var F = function (w, px) { return w + ' ' + px + 'px "Inter Tight", Inter, system-ui, sans-serif'; };
    x.textAlign = 'right'; x.fillStyle = '#141A17'; x.font = F(600, 64); x.fillText(f2(c.total_m3) + ' m³', W - 56, 132); x.textAlign = 'left';
    x.fillStyle = '#FFFFFF'; x.fillRect(0, 180, W, 48);
    x.font = F(600, 28); x.fillStyle = '#141A17'; x.fillText('Double remorque · ' + fm(c.double.lg[0]) + ' m + ' + fm(c.double.lg[1]) + ' m', 56, 216);
    var y = top;
    [[A, fa, 0], [B, fb, 1]].forEach(function (z) {
      x.fillStyle = '#3B5A34'; x.font = F(800, 34); x.fillText('Remorque ' + (z[2] + 1) + ' · ' + fm(c.double.lg[z[2]]) + ' m · ' + f2(c.double.r[z[2]].total_m3) + ' m³', 56, y + 48);
      y += tH; x.drawImage(z[0], 0, top, W, z[1] - top, 0, y, W, z[1] - top); y += z[1] - top;
    });
    cv.finPlan = y; return cv;
  }
  function remDeN(p, i) { var a = p.double.actif; p.double.actif = i; var s = remDe(p); p.double.actif = a; return s; }
  function imagePlan1(c) {
    var r = cfgC(c), v = vplan(c);
    var W = 1080, pad = 56, larg = W - 2 * pad, rowH = 92, tagW = 120;
    var INK = '#141A17', MU = '#6E7570', LINE = '#E3E6E1', ROUGE = '#C23A2B';
    var msgs = v.erreurs.map(function (m) { return [ROUGE, m]; }).concat(v.avis.map(function (m) { return ['#B4690E', m]; }));
    if (!msgs.length) msgs.push(['#1E7A50', 'Plan conforme : longueurs bonnes et camion équilibré.']);
    var cv = document.createElement('canvas'), x = cv.getContext('2d');
    var F = function (w, px) { return w + ' ' + px + 'px "Inter Tight", Inter, system-ui, sans-serif'; };
    x.font = F(500, 26);
    function couper(t, max) {
      var mots = t.split(' '), out = [], cur = '';
      mots.forEach(function (w) { var essai = cur ? cur + ' ' + w : w; if (x.measureText(essai).width > max && cur) { out.push(cur); cur = w; } else cur = essai; });
      if (cur) out.push(cur); return out;
    }
    var lignesMsg = []; msgs.forEach(function (m) { couper(m[1], larg - 30).forEach(function (l, i) { lignesMsg.push([m[0], l, i === 0]); }); });
    var N = v.N, ETG = []; for (var e0 = N; e0 >= 1; e0--) ETG.push(e0);
    var hCote = 70 + N * (rowH + 14) + 50;
    var H = 250 + 2 * (hCote + 30) + (v.rows['C' + N].colis.length ? 50 : 0) + (v.cote.length ? rowH + 80 : 0) + lignesMsg.length * 38 + 110;
    cv.width = W; cv.height = H;
    x.fillStyle = '#FFFFFF'; x.fillRect(0, 0, W, H);
    // en-tête
    x.fillStyle = INK; x.font = F(700, 50);
    x.fillText((c.client || 'Camion') + (c.reference ? ' ' + c.reference : ''), pad, 96);
    var d = new Date(c.termine_le || c.maj_le || Date.now()), dt = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    x.font = F(500, 26); x.fillStyle = MU;
    x.fillText(dt.charAt(0).toUpperCase() + dt.slice(1) + ', ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), pad, 138);
    x.textAlign = 'right'; x.fillStyle = INK; x.font = F(600, 64);
    var tTxt = f2(v.total); x.font = F(500, 26); var wU = x.measureText(' m³').width;
    x.fillStyle = MU; x.fillText(' m³', W - pad, 132); x.font = F(600, 64); x.fillStyle = INK; x.fillText(tTxt, W - pad - wU, 132);
    x.textAlign = 'left';
    x.fillStyle = LINE; x.fillRect(pad, 168, larg, 2);
    var meta = [['Gauche', f2(v.volG)], ['Droite', f2(v.volD)], ['Écart', f2(Math.abs(v.ecart))]], mx = pad;
    meta.forEach(function (m) { x.font = F(500, 26); x.fillStyle = MU; x.fillText(m[0] + ' ', mx, 216); mx += x.measureText(m[0] + ' ').width; x.font = F(600, 28); x.fillStyle = INK; x.fillText(m[1], mx, 216); mx += x.measureText(m[1]).width + 40; });
    var maxLen = Math.max.apply(null, v.ROWS.map(function (k) { return v.rows[k].len; }).concat([r.e1Max * 100]));
    var trkX = pad + tagW, trkW = larg - tagW;
    function rond(a, b, w, h, rr) { x.beginPath(); x.moveTo(a + rr, b); x.arcTo(a + w, b, a + w, b + h, rr); x.arcTo(a + w, b + h, a, b + h, rr); x.arcTo(a, b + h, a, b, rr); x.arcTo(a, b, a + w, b, rr); x.closePath(); }
    function colis(k, xx, yy, w, centre) {
      x.fillStyle = '#EBCF9C'; rond(xx, yy, w, rowH - 20, 8); x.fill();
      if (centre) { x.save(); rond(xx, yy, w, rowH - 20, 8); x.clip(); x.strokeStyle = 'rgba(59,90,52,.28)'; x.lineWidth = 6; for (var t = -rowH; t < w; t += 18) { x.beginPath(); x.moveTo(xx + t, yy + rowH); x.lineTo(xx + t + rowH, yy - 20); x.stroke(); } x.restore(); }
      x.fillStyle = 'rgba(160,110,50,.25)'; x.fillRect(xx + w - 7, yy + 4, 5, rowH - 28);
      x.strokeStyle = centre ? '#3B5A34' : 'rgba(120,80,30,.14)'; x.lineWidth = centre ? 4 : 2; rond(xx, yy, w, rowH - 20, 8); x.stroke();
      if (centre) { x.font = F(800, 17); var bw = x.measureText('MILIEU').width + 14; x.fillStyle = '#3B5A34'; rond(xx + w - bw - 10, yy - 12, bw, 24, 6); x.fill(); x.fillStyle = '#fff'; x.fillText('MILIEU', xx + w - bw - 3, yy + 6); }
      x.save(); x.beginPath(); x.rect(xx, yy, w - 8, rowH - 20); x.clip();
      x.fillStyle = '#2B2216'; x.font = F(700, 28); x.fillText(fm(k.lo) + ' m', xx + 14, yy + 34);
      x.fillStyle = '#6A5536'; x.font = F(500, 21); x.fillText(fm(k.ep) + '×' + fm(k.la), xx + 14, yy + 62);
      x.restore();
    }
    function piste(items, yy) {
      x.fillStyle = ROUGE; x.fillRect(trkX, yy, 5, rowH - 20);
      var xx = trkX + 12;
      items.forEach(function (it) {
        var w = it.cm / maxLen * (trkW - 16) - 6;
        if (!it.esp) colis(it.k, xx, yy, Math.max(w, 10), it.centre);
        else if (it.cm >= 50 && w > 30) { x.save(); x.setLineDash([8, 6]); x.strokeStyle = '#9AA59E'; x.lineWidth = 2; rond(xx, yy, w, rowH - 20, 8); x.stroke(); x.restore(); x.fillStyle = MU; x.font = F(600, 20); x.textAlign = 'center'; x.fillText(fm(Math.round(it.cm) / 100) + ' m', xx + w / 2, yy + (rowH - 20) / 2 + 7); x.textAlign = 'left'; }
        xx += w + 6;
      });
    }
    var y = 250;
    function surligne(txt, coul, yy) {
      x.font = F(700, 34); var tw = x.measureText(txt).width;
      x.fillStyle = coul; x.save(); x.translate(pad - 6, yy - 26); x.transform(1, 0, -0.08, 1, 0, 0); x.fillRect(0, 0, tw + 14, 30); x.restore();
      x.fillStyle = INK; x.fillText(txt, pad, yy);
    }
    ['G', 'D'].forEach(function (s) {
      surligne(NOMS[s], s === 'G' ? 'rgba(56,170,255,.55)' : 'rgba(255,92,170,.50)', y + 40);
      x.textAlign = 'right'; x.font = F(500, 26); x.fillStyle = MU; x.fillText(f2(s === 'G' ? v.volG : v.volD) + ' m³', W - pad, y + 40); x.textAlign = 'left';
      x.fillStyle = '#F5F6F3'; rond(pad - 14, y + 62, larg + 28, N * (rowH + 14) + 60, 22); x.fill();
      var yy = y + 80;
      ETG.forEach(function (f) {
        var ro = v.rows[s + f], items = [], lgAff = ro.m;
        if (f === N) {
          var c3 = v.rows['C' + N], maxPaire = Math.max(v.rows['G' + N].len, v.rows['D' + N].len), E = maxPaire + c3.len, sup = Math.min(v.rows['G' + (N - 1)].len, v.rows['D' + (N - 1)].len);
          if (c3.colis.length) c3.colis.forEach(function (k) { items.push({ k: k, cm: k.cm, centre: 1 }); });
          var gg = gapsRow(c, v, s + f);
          ro.colis.forEach(function (k, i) { if (gg[i] > 0) items.push({ esp: 1, cm: gg[i] }); items.push({ k: k, cm: k.cm }); });
          lgAff = E / 100;
        } else ro.colis.forEach(function (k) { items.push({ k: k, cm: k.cm }); });
        x.font = F(500, 22); x.fillStyle = MU; x.fillText('É' + f, pad, yy + 26);
        x.font = F(600, 28); x.fillStyle = ro.alerte ? ROUGE : INK; x.fillText(fm(Math.round(lgAff * 100) / 100) + ' m', pad, yy + 60);
        piste(items, yy);
        yy += rowH + 14;
      });
      x.font = F(600, 22); x.fillStyle = ROUGE; x.fillText('Cabine', trkX, yy + 10);
      x.textAlign = 'right'; x.fillStyle = MU; x.font = F(500, 22); x.fillText('Arrière', W - pad, yy + 10); x.textAlign = 'left';
      y += hCote + 30;
    });
    if (v.rows['C' + N].colis.length) {
      x.font = F(800, 22); var mw = x.measureText('MILIEU').width + 16; x.fillStyle = '#3B5A34'; rond(pad, y - 8, mw, 32, 7); x.fill();
      x.fillStyle = '#fff'; x.fillText('MILIEU', pad + 8, y + 16);
      x.font = F(500, 24); x.fillStyle = INK; x.fillText('= colis à cheval sur les 2 côtés, posé tout devant contre la cabine', pad + mw + 10, y + 16); y += 50;
    }
    if (v.cote.length) {
      x.font = F(700, 28); x.fillStyle = ROUGE; x.fillText('De côté (pas dans le camion)', pad, y + 20);
      piste(v.cote.map(function (k) { return { k: k, cm: k.cm }; }), y + 40); y += rowH + 80;
    }
    x.font = F(500, 26);
    cv.finPlan = y; // fin du dessin du plan (pour la fiche chauffeur)
    lignesMsg.forEach(function (m) { x.fillStyle = m[0]; x.fillText((m[2] ? '• ' : '   ') + m[1], pad, y + 20); y += 38; });
    x.fillStyle = LINE; x.fillRect(pad, H - 74, larg, 2);
    x.fillStyle = MU; x.font = F(500, 22);
    if (LOGO.complete && LOGO.naturalWidth) { var lh = 52, lw = LOGO.naturalWidth * lh / LOGO.naturalHeight; x.drawImage(LOGO, pad, H - 64, lw, lh); }
    else x.fillText('SDC – Les Scieries du Centre', pad, H - 34);
    x.textAlign = 'right'; x.fillText('Camions SDC', W - pad, H - 34); x.textAlign = 'left';
    return cv;
  }

  function partagerImage(c) {
    if (!c.lignes.length) { toast('Aucun colis.'); return; }
    var cv = imagePlan(c), url = cv.toDataURL('image/png');
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
  window.__imagePlan = imagePlan; window.__fiche = function (c) { return ficheCanvas(c); }; window.__pdf = function (c) { var fc = ficheCanvas(c); return pdfDepuisJpeg(octets(fc.toDataURL('image/jpeg', 0.9)), fc.width, fc.height); }; // pour les tests

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
  function ligneCam(c, enCours) {
    var qui = c.client || 'Sans client';
    return glisse(c.id, '<button class="cam" type="button" data-id="' + esc(c.id) + '"><span class="h">' + heure(enCours ? c.maj_le : c.termine_le) + '</span>' +
      '<span class="qui"><b>' + esc(qui) + (c.double ? ' <i class="tag-dbl">Double</i>' : '') + '</b><small>' + (enEquipe() ? '<i class="qui-p' + (estAMoi(c) ? ' moi' : '') + '">' + esc(prenomDe(c)) + '</i>' : '') + (c.reference ? 'Réf. ' + esc(c.reference) + ' · ' : '') + c.lignes.reduce(function (a, l) { return a + (l.nb || 1); }, 0) + ' colis</small></span>' +
      '<span class="m3 ' + (enCours ? 'cours' : c.etat) + '" title="' + (enCours ? 'En cours' : LIB[c.etat]) + '">' + f2(c.total_m3) + '</span></button>');
  }
  // ---------- Glisser une ligne : à gauche supprimer, à droite ouvrir ----------
  function glisse(id, html) {
    return '<div class="sw" data-sw="' + esc(id) + '"><div class="sw-fond"><span class="sw-o">Ouvrir</span><span class="sw-s">Supprimer</span></div>' + html + '</div>';
  }
  var SEUIL_GLISSE = 90, glisseFini = 0;
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
      glisseFini = Date.now();
      o.sw.classList.remove('glisse');
      var id = o.sw.dataset.sw;
      if (o.dx < -SEUIL_GLISSE) { o.el.style.transform = 'translateX(-110%)'; setTimeout(function () { supprimer(id); }, 180); }
      else if (o.dx > SEUIL_GLISSE) { o.el.style.transform = ''; o.sw.classList.remove('vers-d', 'pret'); ouvrir(id); }
      else { o.el.style.transform = ''; o.sw.classList.remove('vers-g', 'vers-d', 'pret'); }
    }
    zone.addEventListener('pointerup', fin); zone.addEventListener('pointercancel', fin);
    // un appui juste après un glissement ne doit pas ouvrir la ligne
    zone.addEventListener('click', function (e) { if (Date.now() - glisseFini < 350) { e.stopPropagation(); e.preventDefault(); } }, true);
  }
  function supprimerCamion(id, rendre) {
    var c = db.camions[id]; if (!c) return;
    if (!peutSupprimer(c)) { rendre(); toast('Camion de ' + prenomDe(c) + ' : seul ' + prenomDe(c) + ' peut le supprimer.'); return; }
    c.supprime = true; toucher(c); rendre();
    toast('Camion supprimé', function () { c.supprime = false; toucher(c); rendre(); }, 'Annuler');
  }
  function ouvrirCamion(id) {
    var c = db.camions[id]; if (!c) return;
    if (c.statut === 'en_cours' && estAMoi(c)) { db.courant = id; sauver(true); viderForm(); aller('camion'); }
    else detail(c);
  }
  var filtreQui = 'tous';
  function personnes() { // prénoms de l'équipe (membres actifs + auteurs des camions)
    var l = [], vu = {}, moi = Sync.moi();
    Sync.membres().forEach(function (m) { if (m.actif && m.user_id !== moi.uid && !vu[m.user_id]) { vu[m.user_id] = 1; l.push({ uid: m.user_id, prenom: m.prenom }); } });
    Object.keys(db.camions).forEach(function (k) { var c = db.camions[k]; if (c.auteur && c.auteur !== moi.uid && !vu[c.auteur] && !c.supprime) { vu[c.auteur] = 1; l.push({ uid: c.auteur, prenom: c.auteur_prenom || '?' }); } });
    return l;
  }
  function rendreHisto() {
    var q = ($('#recherche').value || '').trim().toUpperCase(), moi = Sync.moi().uid;
    var tous = Object.keys(db.camions).map(function (k) { return db.camions[k]; }).filter(function (c) {
      if (c.supprime) return false;
      if (enEquipe() && filtreQui !== 'tous' && (filtreQui === 'moi' ? !estAMoi(c) : c.auteur !== filtreQui)) return false;
      if (q && (c.client || '').toUpperCase().indexOf(q) < 0 && (c.reference || '').toUpperCase().indexOf(q) < 0) return false;
      return true;
    });
    var cours = tous.filter(function (c) { return c.statut === 'en_cours' && c.lignes.length; }).sort(function (a, b) { return b.maj_le < a.maj_le ? -1 : 1; });
    var fini = tous.filter(function (c) { return c.statut === 'termine'; }).sort(function (a, b) { return b.termine_le < a.termine_le ? -1 : 1; });
    var h = '';
    if (cours.length) h += '<div class="jour"><div class="jour-tete"><h2>Non terminés</h2><span>' + cours.length + '</span></div><div class="carte">' + cours.map(function (c) { return ligneCam(c, true); }).join('') + '</div></div>';
    if (cours.length || fini.length) h = '<p class="astuce">Glisse à gauche pour supprimer, à droite pour ouvrir.</p>' + h;
    if (enEquipe()) h = '<div class="seg seg-qui" id="segQui">' + [{ uid: 'tous', prenom: 'Tous' }, { uid: 'moi', prenom: 'Moi' }].concat(personnes()).map(function (x) {
      return '<button type="button" data-qui="' + esc(x.uid) + '" class="' + (filtreQui === x.uid ? 'actif' : '') + '">' + esc(x.prenom) + '</button>';
    }).join('') + '</div>' + h;
    var jours = {}, ordre = [];
    fini.forEach(function (c) { var k = jourCle(c.termine_le); if (!jours[k]) { jours[k] = []; ordre.push(k); } jours[k].push(c); });
    ordre.forEach(function (k) {
      var tot = jours[k].reduce(function (a, c) { return a + c.total_m3; }, 0);
      h += '<div class="jour"><div class="jour-tete"><h2>' + jourNom(k) + '</h2><span>' + jours[k].length + ' camion' + (jours[k].length > 1 ? 's' : '') + ' · ' + f2(tot) + ' m³</span></div>' +
        '<div class="carte">' + jours[k].map(function (c) { return ligneCam(c, false); }).join('') + '</div></div>';
    });
    if (!h) h = '<div class="carte vide">' + (q ? 'Aucun camion trouvé.' : 'Aucun camion enregistré pour l\'instant.') + '</div>';
    else h += '<p class="legende"><i class="ok"></i>bon <i class="peu"></i>pas assez <i class="trop"></i>dépassé <i class="cours"></i>en cours</p>';
    $('#histo').innerHTML = h;
  }
  $('#recherche').addEventListener('input', rendreHisto);
  // ---------- Statistiques ----------
  var ongletHisto = 'camions', periodeStats = 'semaine';
  $('#histoOnglets').addEventListener('click', function (e) {
    var b = e.target.closest('[data-o]'); if (!b) return;
    ongletHisto = b.dataset.o;
    $$('#histoOnglets button').forEach(function (x) { x.classList.toggle('actif', x === b); });
    $('#histoCamions').hidden = $('#histo').hidden = ongletHisto !== 'camions';
    $('#stats').hidden = ongletHisto !== 'stats';
    if (ongletHisto === 'stats') rendreStats(); else rendreHisto();
  });
  $('#stats').addEventListener('click', function (e) { var b = e.target.closest('[data-per]'); if (b) { periodeStats = b.dataset.per; rendreStats(); } });
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
    var finis = Object.keys(db.camions).map(function (k) { return db.camions[k]; }).filter(function (c) { return !c.supprime && c.statut === 'termine' && c.termine_le; });
    var dans = finis.filter(function (c) { var t = new Date(c.termine_le); return t >= deb && t < fin; });
    var avant = finis.filter(function (c) { var t = new Date(c.termine_le); return t >= prevDeb && t < deb; });
    function som(l) { return l.reduce(function (a, c) { return a + c.total_m3; }, 0); }
    var tot = som(dans), totAv = som(avant), evol = totAv > 0 ? Math.round((tot - totAv) / totAv * 100) : null, dn = dans.length - avant.length;
    var okP = dans.length ? Math.round(dans.filter(function (c) { return c.etat === 'ok'; }).length / dans.length * 100) : 0;
    // bâtons
    var cases = [], idx;
    if (per === 'jour') { for (var hh = 6; hh < 20; hh += 2) cases.push({ n: hh + 'h', v: 0 }); idx = function (t) { return Math.max(0, Math.min(cases.length - 1, Math.floor((t.getHours() - 6) / 2))); }; }
    else if (per === 'semaine') { ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach(function (n) { cases.push({ n: n, v: 0 }); }); idx = function (t) { return (t.getDay() + 6) % 7; }; }
    else if (per === 'mois') { for (var w = 0; w < 5; w++) cases.push({ n: 'S' + (w + 1), v: 0 }); idx = function (t) { return Math.min(4, Math.floor((t.getDate() - 1) / 7)); }; }
    else { 'JFMAMJJASOND'.split('').forEach(function (n) { cases.push({ n: n, v: 0 }); }); idx = function (t) { return t.getMonth(); }; }
    dans.forEach(function (c) { cases[idx(new Date(c.termine_le))].v += c.total_m3; });
    var actuel = idx(maint), max = Math.max.apply(null, cases.map(function (x) { return x.v; }).concat([1]));
    function groupe(cle) {
      var g = {};
      dans.forEach(function (c) { var k = cle(c); (g[k] = g[k] || { m: 0, n: 0 }); g[k].m += c.total_m3; g[k].n++; });
      return Object.keys(g).map(function (k) { return { k: k, m: g[k].m, n: g[k].n }; }).sort(function (a, b) { return b.m - a.m; });
    }
    var gens = enEquipe() ? groupe(function (c) { return prenomDe(c); }) : [];
    var clients = groupe(function (c) { return c.client || 'Sans client'; }).slice(0, 5);
    var nomBar = { jour: 'm³ par heure', semaine: 'm³ par jour', mois: 'm³ par semaine', annee: 'm³ par mois' }[per];
    function lignesBarres(l, cl) {
      var mx = l.length ? l[0].m : 1;
      return l.map(function (x, i) { return '<div class="st-r"><b>' + (cl ? (i + 1) + '. ' : '') + esc(x.k) + '<em>' + x.n + ' camion' + (x.n > 1 ? 's' : '') + '</em></b><span>' + f2(x.m) + ' m³</span><small><i style="width:' + Math.round(x.m / mx * 100) + '%"></i></small></div>'; }).join('');
    }
    var h = '<div class="seg seg4" id="segPer">' + [['jour', 'Jour'], ['semaine', 'Semaine'], ['mois', 'Mois'], ['annee', 'Année']].map(function (p) { return '<button type="button" data-per="' + p[0] + '" class="' + (per === p[0] ? 'actif' : '') + '">' + p[1] + '</button>'; }).join('') + '</div>' +
      '<div class="kpi st-kpi">' +
      '<div><small>Volume</small><b>' + f2(tot) + '</b><em>m³</em>' + (evol !== null ? '<i class="' + (evol >= 0 ? 'plus' : 'moins') + '">' + (evol >= 0 ? '+' : '') + evol + ' %</i>' : '') + '</div>' +
      '<div><small>Camions</small><b>' + dans.length + '</b>' + (avant.length || dans.length ? '<i class="' + (dn >= 0 ? 'plus' : 'moins') + '">' + (dn >= 0 ? '+' : '') + dn + '</i>' : '') + '</div>' +
      '<div><small>Moyenne</small><b>' + (dans.length ? f2(tot / dans.length) : '–') + '</b><em>m³</em></div>' +
      '<div><small>Volume OK</small><b>' + (dans.length ? okP + ' %' : '–') + '</b></div></div>';
    if (!dans.length) h += '<div class="carte vide">Aucun camion terminé sur cette période.</div>';
    else {
      h += '<div class="carte st-tot"><small>' + nomBar + '</small><div class="st-ch' + (cases.length > 7 ? ' serre' : '') + '">' + cases.map(function (x, k) {
        return '<div class="' + (k === actuel ? 'auj' : '') + '"><b>' + (x.v ? Math.round(x.v) : '') + '</b><em style="height:' + Math.max(2, Math.round(x.v / max * 100)) + '%"></em><span>' + x.n + '</span></div>';
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
  function derniersCamions() {
    var fini = Object.keys(db.camions).map(function (k) { return db.camions[k]; }).filter(function (c) { return !c.supprime && c.statut === 'termine'; })
      .sort(function (a, b) { return b.termine_le < a.termine_le ? -1 : 1; }).slice(0, 20);
    var h = '', jours = {}, ordre = [];
    fini.forEach(function (c) { var k = jourCle(c.termine_le); if (!jours[k]) { jours[k] = []; ordre.push(k); } jours[k].push(c); });
    ordre.forEach(function (k) {
      var tot = jours[k].reduce(function (a, c) { return a + c.total_m3; }, 0);
      h += '<div class="jour"><div class="jour-tete"><h2>' + jourNom(k) + '</h2><span>' + jours[k].length + ' camion' + (jours[k].length > 1 ? 's' : '') + ', ' + f2(tot) + ' m³</span></div><div class="carte">' + jours[k].map(function (c) { return ligneCam(c, false); }).join('') + '</div></div>';
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
    var date = enCours ? 'En cours · modifié à ' + heure(c.maj_le) : new Date(c.termine_le).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + heure(c.termine_le);
    var sel = selection, aMoi = estAMoi(c); selection = null;
    var f = ouvrirFeuille(
      '<h2>' + esc(c.client || 'Sans client') + (c.reference ? ' · Réf. ' + esc(c.reference) : '') + '</h2>' +
      '<p class="petit-txt" style="margin-top:-6px">' + date + ' · <b>' + f2(c.total_m3) + ' m³</b> ' + (enCours ? '' : '<span class="pastille ' + c.etat + '">' + LIB[c.etat] + '</span>') + '</p>' +
      (enEquipe() ? '<p class="charge-par">Chargé par <b>' + esc(prenomDe(c)) + '</b></p>' : '') +
      '<div class="grille-btns">' +
      (!aMoi ? '<button class="btn sec" data-a="image" type="button">Partager</button><button class="btn" data-a="recuperer" type="button">Récupérer</button>'
        : (enCours ? '<button class="btn" data-a="reprendre" type="button">Reprendre</button>' : '<button class="btn" data-a="dupliquer" type="button">Dupliquer</button>') +
          '<button class="btn sec" data-a="image" type="button">Partager</button>') + '</div>' +
      (!aMoi ? '<p class="verrou">🔒 Camion de ' + esc(prenomDe(c)) + ' : tu peux le voir et le partager, pas le modifier. « Récupérer » en fait une copie à ton nom.</p>' : '') +
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
        if (a === 'dupliquer' || a === 'recuperer') { fermerFeuille(); copierCamion(c, a === 'recuperer'); }
        if (a === 'suppr') {
          if (!peutSupprimer(c)) return;
          c.supprime = true; toucher(c); fermerFeuille(); rendreHisto();
          toast('Camion supprimé', function () { c.supprime = false; toucher(c); rendreHisto(); });
        }
      };
    });
  }

  // ---------- Équipe ----------
  function initiale(p) { return esc(String(p || '?').trim().charAt(0).toUpperCase() || '?'); }
  function formRejoindre(dansFeuille) {
    return '<div class="carte rejoindre"><h2>Rejoindre l\'équipe</h2><p class="petit-txt">Demande le code à ton responsable. Pas de compte, pas de mot de passe.</p>' +
      '<label class="champ"><span>Code de l\'équipe</span><input id="rjCode" autocapitalize="characters" autocomplete="off" spellcheck="false" placeholder="ex. SDC2026"></label>' +
      '<label class="champ"><span>Ton prénom</span><input id="rjPrenom" class="maj" autocapitalize="characters" autocomplete="given-name" value="' + esc(Sync.moi().prenom || '') + '" placeholder="ex. Sylvano"></label>' +
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
    ouvrirFeuille('<div style="text-align:center;margin:4px 0 2px"><span class="logo rj-logo-w"><img class="rj-logo l-clair" src="logo-clair.png?v=47" alt="SDC"><img class="rj-logo l-sombre" src="logo-sombre.png?v=47" alt=""></span></div>' + formRejoindre(true));
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
    else if (vueActive === 'historique') { if (ongletHisto === 'stats') rendreStats(); else rendreHisto(); }
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
    var jour = tous.filter(function (c) { return c.statut === 'termine' && jourCle(c.termine_le) === auj; });
    var cours = tous.filter(function (c) { return c.statut === 'en_cours' && c.lignes.length; });
    z.innerHTML = '<div class="carte eq-liste">' + gens.map(function (g) {
      var n = camionsDe(g.uid).filter(function (c) { return c.statut === 'termine'; }).length;
      return '<button type="button" class="eq-p" data-p="' + esc(g.uid) + '"><span class="av' + (g.moi ? '' : ' b') + '">' + initiale(g.prenom) + '</span><span class="eq-n"><b>' + esc(g.prenom) + '</b>' + (g.moi ? '<small>toi</small>' : '') + '</span><span class="eq-c">' + n + ' camion' + (n > 1 ? 's' : '') + '</span><i>›</i></button>';
    }).join('') + '</div><p class="astuce">Touche un prénom pour voir son profil.</p>' +
      '<div class="carte eq-jour"><h2>Aujourd\'hui · équipe</h2><div class="eq-k"><div><small>Camions</small><b>' + jour.length + '</b></div><div><small>Volume</small><b>' + f2(jour.reduce(function (a, c) { return a + c.total_m3; }, 0)) + '<em> m³</em></b></div><div><small>En cours</small><b>' + cours.length + '</b></div></div></div>' +
      '<p class="petit-txt eq-sync">' + etatSyncTxt() + '</p>';
    z.onclick = function (e) { var b = e.target.closest('[data-p]'); if (b) { profilUid = b.dataset.p; aller('profil'); } };
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
    var h = '<div class="kpi"><div><small>Ce mois</small><b>' + mois.length + '</b><em>camions</em></div><div><small>Volume ce mois</small><b>' + f2(mois.reduce(function (a, c) { return a + c.total_m3; }, 0)) + '</b><em>m³</em></div></div>';
    if (cours.length) h += '<div class="jour"><div class="jour-tete"><h2>En cours</h2><span>' + cours.length + '</span></div><div class="carte">' + cours.map(function (c) { return ligneCam(c, true); }).join('') + '</div></div>';
    var jours = {}, ordre = [];
    fin.slice(0, 40).forEach(function (c) { var k = jourCle(c.termine_le); if (!jours[k]) { jours[k] = []; ordre.push(k); } jours[k].push(c); });
    ordre.forEach(function (k) {
      var tot = jours[k].reduce(function (a, c) { return a + c.total_m3; }, 0);
      h += '<div class="jour"><div class="jour-tete"><h2>' + jourNom(k) + '</h2><span>' + jours[k].length + ' · ' + f2(tot) + ' m³</span></div><div class="carte">' + jours[k].map(function (c) { return ligneCam(c, false); }).join('') + '</div></div>';
    });
    if (!fin.length && !cours.length) h += '<div class="carte vide">Aucun camion pour l\'instant.</div>';
    $('#profilZone').innerHTML = h;
  }
  $('#profilZone').addEventListener('click', function (e) { var b = e.target.closest('.cam'); if (b && Date.now() - glisseFini > 350) detail(db.camions[b.dataset.id]); });
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
    $('#reglagesZone').innerHTML = blocEquipe() +
      '<div class="carte reg' + (verrou ? ' verrouille' : '') + '"><h2>Limites du camion</h2>' + (verrou ? '<p class="petit-txt">Réglages communs à toute l\'équipe.</p>' : '') +
      '<div class="g3">' + champNum('rMin', 'Vol min', r.m3Min) + champNum('rMax', 'Vol max', r.m3Max) + champNum('rEcart', 'Écart G/D', r.ecartMax) + champNum('rE1Min', 'Ét.1 min', r.e1Min) + champNum('rE1Max', 'Ét.1 max', r.e1Max) + '</div>' +
      '</div>' +

      '<button class="carte reg-ouvrir" id="ouvrirSections" type="button"><span><b>Sections et quantités</b><small>' + r.sections.length + ' sections · ' + (verrou ? 'communes à l\'équipe' : 'quantité remplie toute seule') + '</small></span><i>›</i></button>' +

      '<div class="carte reg ligne-app"><span>Apparence</span><div class="seg" id="segTheme">' +
      [['auto', 'Auto'], ['clair', 'Clair'], ['sombre', 'Sombre']].map(function (t) { return '<button type="button" data-t="' + t[0] + '" class="' + (r.theme === t[0] ? 'actif' : '') + '">' + t[1] + '</button>'; }).join('') +
      '</div></div>' +

      '<div class="carte reg"><div class="g2"><button class="btn sec petit" id="exp" type="button">Sauvegarder mes données</button><button class="btn sec petit" id="imp" type="button">Restaurer</button></div>' +
      '<input type="file" id="impFichier" accept="application/json,.json" hidden>' +
      '<p class="petit-txt">' + Object.keys(db.camions).filter(function (k) { return !db.camions[k].supprime && db.camions[k].statut === 'termine'; }).length + ' camions enregistrés · version ' + VERSION_APP + '</p></div>';
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
      if (b.dataset.g === 'secret') { fermerFeuille(); setTimeout(function () { demanderTexte('Mon code secret', '', 'Tu le choisis, il ne change plus. 6 caractères minimum. Il sert à retrouver ton compte admin sur un nouveau téléphone.').then(function (v) { if (v) Sync.definirSecret(v).then(function () { toast('Code secret enregistré ✔'); }).catch(function (er) { toast(er.message); }); }); }, 120); }
      if (b.dataset.retirer) {
        if (!b.dataset.ok) { b.dataset.ok = '1'; b.textContent = 'Confirmer'; return; }
        Sync.retirer(b.dataset.retirer, false).then(function () { toast('Retiré de l\'équipe'); fermerFeuille(); setTimeout(ouvrirGestion, 150); }).catch(function (er) { toast(er.message); });
      }
    };
  }

  // ---------- Sections et quantités ----------
  function txtLg(lg) { return (lg || []).map(fm).join(' · '); }
  function sectionsVerrou() { return enEquipe() && !Sync.moi().admin; }
  function ouvrirSections() {
    var f = ouvrirFeuille(
      '<div class="sec-tete"><h2>Sections et quantités</h2><button class="lien" data-s="fermer" type="button">Fermer</button></div>' +
      '<div id="secEdit" hidden></div>' +
      '<input id="secCherche" class="sec-cherche" type="search" inputmode="decimal" placeholder="Chercher (ex. 75x225)" autocomplete="off">' +
      '<div id="secListe"></div>' +
      (sectionsVerrou() ? '<p class="verrou">Liste commune à toute l\'équipe.</p>' : '<button class="btn" data-s="ajout" type="button">+ Ajouter une section</button>' +
      '<button class="lien sec-reset" data-s="reset" type="button">Remettre la liste d\'origine</button>'));
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
        reg().sections = copieSections(); db.sync.reglagesSales = true; sauver();
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
      var old = liste.splice(i, 1)[0]; db.sync.reglagesSales = true; sauver();
      z.hidden = true; z.innerHTML = ''; rendreSections();
      toast('Section supprimée', function () { liste.splice(i, 0, old); db.sync.reglagesSales = true; sauver(); rendreSections(); });
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
      db.sync.reglagesSales = true; sauver();
      z.hidden = true; z.innerHTML = ''; rendreSections();
      toast(fm(ep) + ' × ' + fm(la) + ' = ' + pi + ' pièces');
    };
  }

  function lierReglages() {
    $('#ouvrirSections').onclick = ouvrirSections;
    var r = reg();
    function numChamp(id, cle, verif) {
      $('#' + id).addEventListener('change', function () {
        var v = P.num(this.value);
        if (!isFinite(v) || v <= 0 || (verif && !verif(v))) { toast('Valeur refusée.'); this.value = fm(r[cle]); return; }
        r[cle] = v; db.sync.reglagesSales = true; sauver(); this.value = fm(v);
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
  Sync.init({
    lire: function () { return db; },
    ecrire: function (d) { db = d; sauver(true); },
    changement: function (st, change) {
      if (Sync.actif() && !Sync.rejoint() && !verrouEquipe && !st.attente) { setTimeout(proposerRejoindre, 200); }
      if (document.activeElement && document.activeElement.matches('input')) return; // on ne dérange pas une saisie
      if (vueActive === 'plan') { if (change && !apercu && !selection) rendrePlanVue(); return; }
      if (vueActive === 'camion' || vueActive === 'client' || vueActive === 'calcul') return;
      rafraichirVue();
    }
  });
  appliquerTheme();
  feuillesAutomne();
  try { // petit message après une mise à jour automatique
    if (localStorage.getItem('csdc.version') && localStorage.getItem('csdc.version') !== VERSION_APP) setTimeout(function () { toast('Appli mise à jour : nouvelle version ' + VERSION_APP); }, 900);
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
