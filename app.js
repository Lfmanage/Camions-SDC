/* Camions SDC — application */
(function () {
  'use strict';
  var P = window.Plan;
  var VERSION_APP = '31';
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
    if (c && c.volMode === 'exact' && c.volExact > 0) { r.m3Min = c.volExact - TOL_EXACT; r.m3Max = c.volExact + TOL_EXACT; r.cible = c.volExact; }
    else r.cible = r.m3Max;
    return r;
  }

  function nouveauCamion(base) {
    var c = { id: uid(), client: '', reference: '', cree_le: maintenant(), termine_le: null, statut: 'en_cours', lignes: [], plan: null, planManuel: false, total_m3: 0, etat: 'peu', maj_le: maintenant(), supprime: false };
    if (base) Object.assign(c, base);
    db.camions[c.id] = c; db.courant = c.id;
    return c;
  }
  var edition = null; // camion de l'historique ouvert dans le plan
  function courant() {
    if (edition && db.camions[edition] && !db.camions[edition].supprime) return db.camions[edition];
    var c = db.camions[db.courant];
    if (!c || c.supprime || c.statut !== 'en_cours') { c = nouveauCamion(); sauver(true); }
    return c;
  }
  // Les colis ont changé : le plan sera recalculé (le meilleur possible) à l'ouverture du plan
  function majPlan(c) {
    c.plan = null; c.planDepart = null; c.planCalcule = false; c.ordre = null;
    c.planManuel = false; c.planVariante = false; c.plansVus = null; c.graineAutre = 1;
  }
  // Cherche le meilleur plan (jusqu'à ~2 s) ; il devient le « plan de départ »
  function calculerPlan(c) {
    if (!c.lignes.length) { majPlan(c); return; }
    var res = P.meilleur(c.lignes, cfgC(c));
    c.plan = res.plan; c.planDepart = { plan: JSON.parse(JSON.stringify(res.plan)), note: res.note };
    c.planCalcule = true; c.ordre = null; c.planManuel = false; c.planVariante = false; c.plansVus = null; c.graineAutre = 1;
  }
  function assurerPlan(c) { if (c.lignes.length && (!c.plan || !Object.keys(c.plan).length)) { calculerPlan(c); toucher(c); } }
  function toucher(c) {
    c.total_m3 = Math.round(P.totalM3(c.lignes) * 1000) / 1000;
    c.etat = P.etat(c.total_m3, cfgC(c)).code;
    c.maj_le = maintenant(); c._sale = true;
    sauver();
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
    f.innerHTML = '<div class="poignee"></div>' + html;
    f.hidden = false; $('#feuilleFond').hidden = false;
    f.scrollTop = 0;
    if (!(history.state && history.state.f)) history.pushState({ f: 1, v: vueActive, d: profondeur() + 1 }, '');
    return f;
  }
  function fermerFeuille(parRetour) {
    if ($('#feuille').hidden) return;
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

  // ---------- Navigation ----------
  var vueActive = 'accueil';
  var ONGLET = { accueil: 'accueil', client: 'accueil', camion: 'accueil', plan: 'accueil', calcul: 'calcul', historique: 'historique', reglages: 'reglages' };
  function montrer(v) {
    vueActive = v; document.body.dataset.vue = v;
    if (v !== 'plan') edition = null;
    $$('.vue').forEach(function (s) { s.classList.toggle('active', s.id === 'v-' + v); });
    $$('.onglet').forEach(function (b) { b.classList.toggle('actif', b.dataset.vue === (v === 'plan' && edition ? 'historique' : ONGLET[v])); });
    window.scrollTo(0, 0);
    if (v === 'accueil') rendreAccueil();
    if (v === 'calcul') { prepCalc(); rendreCalc(); }
    if (v === 'client') rendreClient();
    if (v === 'camion') rendreCamion();
    if (v === 'plan') { rendrePlanVue(); requestAnimationFrame(ajusterPlan); }
    if (v === 'historique') { if (ongletHisto === 'stats') rendreStats(); else rendreHisto(); }
    if (v === 'reglages') rendreReglages();
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
    $('#cfgResume').textContent = fm(rc.e1Max) + ' m · ' + (c.volMode === 'exact' && c.volExact ? fm(c.volExact) + ' m³ exact' : fm(rc.m3Min) + '–' + fm(rc.m3Max) + ' m³');
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
  function rendreAccueil() {
    var d = new Date(), txt = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#accDate').textContent = txt.charAt(0).toUpperCase() + txt.slice(1);
    var h = d.getHours();
    $('.acc-titre').textContent = h < 18 ? 'Bonjour' : 'Bonsoir';
    majInstaller();
    var auj = jourCle(d.toISOString()), tous = Object.keys(db.camions).map(function (k) { return db.camions[k]; }).filter(function (c) { return !c.supprime; });
    var jour = tous.filter(function (c) { return c.statut === 'termine' && jourCle(c.termine_le) === auj; });
    var m3 = jour.reduce(function (a, c) { return a + c.total_m3; }, 0);
    $('#accStats').innerHTML = '<div class="stat"><small>Aujourd\'hui</small><b>' + f2(m3) + ' m³</b></div><button type="button" class="stat stat-go" data-camions="1"><small>Camions aujourd\'hui</small><b>' + jour.length + '</b><i>Voir les derniers</i></button>';
    $('#accNbJour').textContent = 'Tous les camions';
    $('#accSous').textContent = jour.length ? jour.length + ' camion' + (jour.length > 1 ? 's' : '') + ' chargé' + (jour.length > 1 ? 's' : '') + ' aujourd\'hui' : 'Bonne journée au chantier';
    var cours = tous.filter(function (c) { return c.statut === 'en_cours' && c.lignes.length; }).sort(function (a, b) { return b.maj_le < a.maj_le ? -1 : 1; });
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
  function majInstaller() { $('#btnInstaller').hidden = estInstalle() || !(invite || estIOS()); }
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
    if (c.lignes.length || c.client || c.reference) { nouveauCamion(); sauver(true); }
    viderForm(); aller('client');
    setTimeout(function () { $('#client').focus(); }, 120);
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
  $('#btnAutre').addEventListener('click', function () {
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
      c.plan = res.plan; c.ordre = null; c.planManuel = false; c.planVariante = true; c.graineAutre = res.graine;
      var mieux = c.planDepart && res.note < c.planDepart.note - 0.01;
      if (mieux) c.planDepart = { plan: JSON.parse(JSON.stringify(res.plan)), note: res.note };
      c.plansVus.push(res.signature); selection = null; toucher(c);
      rendrePlanVue(); window.scrollTo({ top: 0, behavior: 'smooth' });
      toast(mieux ? 'Meilleur plan trouvé : c\'est le nouveau plan de départ' : 'Nouveau plan · ' + (c.plansVus.length) + 'e proposition');
    }, 30);
  });

  // Enlève du camion les colis mis de côté, sans toucher au reste du plan
  function supprimerCote(c) {
    var plan = c.plan || {}, nouveauPlan = {}, nouvelOrdre = [], ren = {};
    c.lignes = c.lignes.filter(function (l) {
      var n = l.nb || 1, k2 = 0;
      for (var k = 0; k < n; k++) {
        var id = l.id + '#' + k;
        if (plan[id] === 'X') continue;
        ren[id] = l.id + '#' + k2; if (plan[id]) nouveauPlan[ren[id]] = plan[id]; k2++;
      }
      l.nb = k2; return k2 > 0;
    });
    (c.ordre || []).forEach(function (id) { if (ren[id]) nouvelOrdre.push(ren[id]); });
    c.plan = nouveauPlan; c.ordre = nouvelOrdre; c.planManuel = true; selection = null;
    toucher(c);
  }

  $('#btnVider').addEventListener('click', function () {
    var c = courant(); if (!c.lignes.length) return;
    var avant = { plan: c.plan, ordre: c.ordre, man: c.planManuel };
    fixerOrdre(c);
    var plan = {}; P.colisDe(c.lignes).forEach(function (k) { plan[k.id] = 'X'; });
    c.plan = plan; c.planManuel = true; selection = null; toucher(c); rendrePlanVue();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    toast('Tous les colis sont de côté', function () { c.plan = avant.plan; c.ordre = avant.ordre; c.planManuel = avant.man; toucher(c); rendrePlanVue(); }, 'Annuler');
  });

  $('#btnTerminer').addEventListener('click', function () {
    var c = courant();
    if (!c.lignes.length) { toast('Aucun colis à enregistrer.'); return; }
    assurerPlan(c);
    var nCote = vplan(c).cote.length;
    if (nCote) {
      demander({
        titre: nCote + ' colis de côté',
        texte: 'Remets-' + (nCote > 1 ? 'les' : 'le') + ' dans le camion avant de terminer, ou supprime-' + (nCote > 1 ? 'les' : 'le') + ' du camion.',
        oui: 'Supprimer du camion', non: 'Les remettre', danger: true
      }).then(function (ok) {
        if (!ok) return;
        supprimerCote(c); rendrePlanVue();
        toast(nCote + ' colis supprimé' + (nCote > 1 ? 's' : '') + ' du camion');
        if (c.lignes.length) setTimeout(function () { $('#btnTerminer').click(); }, 350);
      });
      return;
    }
    if (edition) { // camion de l'historique : on enregistre et on revient
      toucher(c); sauver(true); selection = null; edition = null;
      retour(); toast('Plan enregistré ✔'); return;
    }
    var e = P.etat(c.total_m3, cfgC(c));
    var go = e.code === 'ok' ? Promise.resolve(true) : demander({
      titre: 'Camion hors limites',
      html: '<p class="alerte-txt">' + esc(messageEtat(c.total_m3)) + '</p><p>Total : ' + f2(c.total_m3) + ' m³. Enregistrer quand même ?</p>',
      oui: 'Enregistrer quand même', non: 'Revenir'
    });
    go.then(function (ok) {
      if (!ok) return;
      c.statut = 'termine'; c.termine_le = maintenant();
      if (c.client && db.clients.indexOf(c.client) < 0) db.clients.push(c.client);
      toucher(c);
      viderForm(); nouveauCamion(); sauver(true);
      selection = null;
      setTimeout(function () { revenirAuDebut('accueil'); }, 150);
      toast('Camion enregistré ✔');
    });
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

  function vplan(c, plan) { return P.verifier(c.lignes, plan || c.plan || {}, cfgC(c), c.ordre); }
  // ordre d'affichage complet (cabine → arrière) tiré du plan actuel
  function fixerOrdre(c) {
    var v = vplan(c), o = [];
    v.ROWS.forEach(function (k) { v.rows[k].colis.forEach(function (x) { o.push(x.id); }); });
    v.cote.forEach(function (x) { o.push(x.id); });
    c.ordre = o; return v;
  }
  function hashBois(t) { var h = 0; for (var i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) | 0; return h; }
  function htmlPlan(c, opts) {
    var r = cfgC(c), v = vplan(c), st = statutPlan(v, r);
    var maxLen = r.e1Max * 100;
    v.ROWS.forEach(function (k) { maxLen = Math.max(maxLen, v.rows[k].len); });
    var N = v.N, ETG = []; for (var e0 = N; e0 >= 1; e0--) ETG.push(e0);
    var edit = !opts.lecture, selCote = edit && selection && v.cote.some(function (k) { return k.id === selection; });
    var place = edit && selection ? 36 : 0; // place gardée pour le bouton « + » en bout d'étage
    function w(cm) { return 'width:calc((100% - ' + (4 + place) + 'px) * ' + (cm / maxLen).toFixed(4) + ' - 2px)'; }
    function chip(k, centre, libre) {
      return '<button type="button" title="' + esc(libColis(k)) + '" data-bois="' + (Math.abs(hashBois(k.id)) % 6) + '" class="chip' + (centre ? ' centre' : '') + (selection === k.id && edit ? ' sel' : '') + '" data-c="' + esc(k.id) + '" style="' + (libre ? 'width:' + Math.max(48, Math.round(k.cm / maxLen * 300)) + 'px' : w(k.cm)) + '"' + (edit ? '' : ' disabled') + ' aria-label="' + esc(libColis(k) + (centre ? ', au centre' : '')) + '">' +
        '<b>' + fm(k.lo) + ' m</b><small>' + fm(k.ep) + '×' + fm(k.la) + '</small></button>';
    }
    var h = '<div class="sum ' + st.cls + '"><span class="sum-g"><span class="tot">' + f2(v.total) + '<small>/ ' + fm(r.cible) + ' m³</small></span><span class="etq">' + esc(st.etq) + '</span></span>' +
      '<span class="gd">Gauche <b>' + f2(v.volG) + '</b><br>Droite <b>' + f2(v.volD) + '</b></span></div>';
    if (st.detail) h += (st.court && !opts.lecture)
      ? '<p class="statut-detail"><span class="court">' + esc(st.court) + '</span> <button type="button" class="pourquoi" data-pourquoi="1">Pourquoi ?</button><span class="detail-long">' + esc(st.detail) + '</span></p>'
      : '<p class="statut-detail ouvert"><span class="detail-long">' + esc(st.detail) + '</span></p>';
    if (v.cote.length) {
      h += '<div class="tray"><div class="tray-chips">' + v.cote.map(function (k) { return chip(k, false, true); }).join('') + '</div>' +
        '<p><b>' + v.cote.length + ' colis de côté.</b> ' + (selCote ? 'Touche + au bout d\'un étage, ou un colis pour le poser devant.' : 'Touche-en un pour le reposer.') + '</p></div>';
    }
    ['G', 'D'].forEach(function (s) {
      h += '<section class="cote"><div class="cote-t"><span class="hl ' + (s === 'G' ? 'rose' : 'bleu') + '">' + NOMS[s] + '</span><small>' + f2(s === 'G' ? v.volG : v.volD) + ' m³</small></div><div class="rangs">';
      ETG.forEach(function (f) {
        var ro = v.rows[s + f], lgAff = ro.m;
        h += '<div class="rang' + (ro.alerte ? ' ko' : '') + '"><div class="tag">É' + f + '<b>@LG@</b></div><div class="trk"><i class="lim" style="left:calc(2px + (100% - ' + (4 + place) + 'px) * ' + (r.e1Max * 100 / maxLen).toFixed(4) + ')"></i>';
        if (f === N) {
          var c3 = v.rows['C' + N], maxPaire = Math.max(v.rows['G' + N].len, v.rows['D' + N].len);
          var E = maxPaire + c3.len, sup = Math.min(v.rows['G' + (N - 1)].len, v.rows['D' + (N - 1)].len);
          if (sup - E > 2) h += '<i class="esp" style="' + w((sup - E) / 2) + '"></i>';
          ro.colis.forEach(function (k) { h += chip(k, false); });
          if (c3.colis.length) { if (maxPaire - ro.len > 1) h += '<i class="esp" style="' + w(maxPaire - ro.len) + '"></i>'; c3.colis.forEach(function (k) { h += chip(k, true); }); }
          lgAff = E / 100;
        } else ro.colis.forEach(function (k) { h += chip(k, false); });
        if (edit && selection) h += '<button type="button" class="poser" data-poser="' + s + f + '" aria-label="Poser ici">' + (selCote && !ro.colis.length ? 'Poser ici' : '+') + '</button>';
        h = h.replace('@LG@', fm(Math.round(lgAff * 100) / 100) + ' m');
        h += '</div></div>';
      });
      h += '<div class="sens"><span class="c">Cabine</span><span>Arrière</span></div></div></section>';
    });
    if (edit) {
      var sel = selection && P.colisDe(c.lignes).filter(function (k) { return k.id === selection; })[0];
      if (sel && !selCote) h += '<div class="barre-sel"><span><b>' + esc(libColis(sel)) + '</b><br>Touche un autre colis pour échanger, ou + pour le déplacer.</span><button type="button" class="btn sec petit" data-decote="1">Mettre de côté</button><button type="button" class="x" data-annuler="1" aria-label="Annuler">×</button></div>';
      else if (sel) h += '<div class="barre-sel"><span><b>' + esc(libColis(sel)) + '</b><br>Choisis où le poser.</span><button type="button" class="x" data-annuler="1" aria-label="Annuler">×</button></div>';
      else h += '<div class="aide-l"><span>' + (N === 4 ? '4 étages (surtout du 18×100). ' : '') + 'Touche un colis pour le déplacer.</span>' +
        ((c.planManuel || c.planVariante) ? '<button type="button" class="btn-lien recalc" data-recalc="1">Plan de départ</button>' : '') + '</div>';
      if (sel && (c.planManuel || c.planVariante)) h += '<button type="button" class="btn-lien recalc" data-recalc="1">Plan de départ</button>';
    }
    return h;
  }

  function rendrePlanVue() {
    var c = courant();
    // le plan doit toujours être bon : on le refait s'il est faux ou incomplet (sauf modification à la main)
    var v = vplan(c);
    var besoin = c.lignes.length && (v.nonPlaces.length || (!c.planCalcule && !c.planManuel && (P.noteVerif(v) >= 1000 || (!c.planVariante && P.deseq(v) > reg().ecartMax + 0.005))));
    if (besoin) {
      $('#planZone').innerHTML = '<div class="calcul-plan"><span class="spin"></span>Calcul du meilleur plan…</div>';
      setTimeout(function () { calculerPlan(c); toucher(c); if (vueActive === 'plan') { $('#planZone').innerHTML = htmlPlan(c, {}); ajusterPlan(); } }, 40);
      return;
    }
    $('#planZone').innerHTML = htmlPlan(c, {});
    ajusterPlan();
  }
  // Le plan tient sur un écran : hauteur des étages calculée selon la place du téléphone, textes resserrés si besoin
  var RH_MAX = 48, RH_MIN = 30, RH_GRAND = 64;
  function ajusterPlan() {
    var z = $('#planZone'); if (!z || vueActive !== 'plan') return;
    var n = $$('.rang', z).length || 6;
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
    if (!ra || !rb || ra === rb) { selection = null; return toast(ra === rb ? 'Ces deux colis sont sur le même étage : touche + pour le déplacer.' : 'Échange impossible.'); }
    plan[a] = rb; plan[b] = ra;
    var v1 = vplan(c), v2 = vplan(c, plan);
    var lg = v2.erreurs.filter(function (m) { return /^Étage/.test(m); });
    if (lg.length && P.noteVerif(v2) > P.noteVerif(v1)) { selection = null; return toast('Échange refusé : ' + lg[0]); }
    if (P.deseq(v2) > Math.max(reg().ecartMax, P.deseq(v1)) + 0.001) { selection = null; return toast('Échange refusé : le camion serait déséquilibré.'); }
    if (P.ecartLg(v2) > Math.max(P.ECART_LG, P.ecartLg(v1))) { selection = null; return toast('Échange refusé : trop d\'écart de longueur entre gauche et droite.'); }
    if (!c.ordre) fixerOrdre(c);
    var ia = c.ordre.indexOf(a), ib = c.ordre.indexOf(b); c.ordre[ia] = b; c.ordre[ib] = a; // chacun prend la place de l'autre
    c.plan = plan; c.planManuel = true; selection = null; toucher(c);
    toast('Colis échangés');
  }
  // place le colis id dans la rangée k, juste avant le colis avant (ou au bout de la rangée)
  function placer(c, id, k, avant) {
    var v = c.ordre ? vplan(c) : fixerOrdre(c);
    c.plan = Object.assign({}, c.plan); c.plan[id] = k;
    var o = c.ordre.filter(function (x) { return x !== id; });
    if (avant) o.splice(o.indexOf(avant), 0, id);
    else {
      var der = v.rows[k].colis.filter(function (x) { return x.id !== id; }).pop();
      if (der) o.splice(o.indexOf(der.id) + 1, 0, id); else o.push(id);
    }
    c.ordre = o; c.planManuel = true; selection = null; toucher(c);
  }

  $('#planZone').addEventListener('click', function (e) {
    var c = courant();
    if (e.target.closest('[data-annuler]')) { selection = null; rendrePlanVue(); return; }
    var pq = e.target.closest('[data-pourquoi]');
    if (pq) { var sd = pq.closest('.statut-detail'); sd.classList.toggle('ouvert'); pq.textContent = sd.classList.contains('ouvert') ? 'Masquer' : 'Pourquoi ?'; ajusterPlan(); return; }
    if (e.target.closest('[data-recalc]')) {
      if (c.planDepart) { c.plan = JSON.parse(JSON.stringify(c.planDepart.plan)); c.ordre = null; c.planManuel = false; c.planVariante = false; c.planCalcule = true; }
      else calculerPlan(c);
      toucher(c); selection = null; rendrePlanVue(); toast('Meilleur plan remis'); return;
    }
    if (e.target.closest('[data-decote]') && selection) {
      if (!c.ordre) fixerOrdre(c);
      c.plan = Object.assign({}, c.plan); c.plan[selection] = 'X'; c.planManuel = true; selection = null; toucher(c);
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
    rendrePlanVue();
  });
  $('#btnPartager').addEventListener('click', function () { var c = courant(); if (!c.lignes.length) { toast('Aucun colis.'); return; } assurerPlan(c); choixPartage(c); });
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
    if (c.lignes.length && (!c.plan || !Object.keys(c.plan).length)) c.plan = P.meilleur(c.lignes, cfgC(c)).plan;
    var v = vplan(c), W = 1080, pad = 56, larg = W - 2 * pad;
    var INK = '#13221A', MU = '#5E6E64', VERT = '#1F4D38';
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
  function imagePlan(c) {
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
    var H = 250 + 2 * (hCote + 30) + (v.cote.length ? rowH + 80 : 0) + lignesMsg.length * 38 + 110;
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
      x.fillStyle = '#E7D6B8'; rond(xx, yy, w, rowH - 20, 8); x.fill();
      if (centre) { x.save(); rond(xx, yy, w, rowH - 20, 8); x.clip(); x.strokeStyle = 'rgba(156,118,70,.35)'; x.lineWidth = 6; for (var t = -rowH; t < w; t += 18) { x.beginPath(); x.moveTo(xx + t, yy + rowH); x.lineTo(xx + t + rowH, yy - 20); x.stroke(); } x.restore(); }
      x.fillStyle = '#C9AC7E'; x.fillRect(xx + w - 7, yy + 4, 5, rowH - 28);
      x.strokeStyle = 'rgba(0,0,0,.10)'; x.lineWidth = 2; rond(xx, yy, w, rowH - 20, 8); x.stroke();
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
      surligne(NOMS[s], s === 'G' ? 'rgba(255,92,170,.45)' : 'rgba(64,150,255,.38)', y + 40);
      x.textAlign = 'right'; x.font = F(500, 26); x.fillStyle = MU; x.fillText(f2(s === 'G' ? v.volG : v.volD) + ' m³', W - pad, y + 40); x.textAlign = 'left';
      x.fillStyle = '#F5F6F3'; rond(pad - 14, y + 62, larg + 28, N * (rowH + 14) + 60, 22); x.fill();
      var yy = y + 80;
      ETG.forEach(function (f) {
        var ro = v.rows[s + f], items = [], lgAff = ro.m;
        if (f === N) {
          var c3 = v.rows['C' + N], maxPaire = Math.max(v.rows['G' + N].len, v.rows['D' + N].len), E = maxPaire + c3.len, sup = Math.min(v.rows['G' + (N - 1)].len, v.rows['D' + (N - 1)].len);
          if (sup - E > 2) items.push({ esp: 1, cm: (sup - E) / 2 });
          ro.colis.forEach(function (k) { items.push({ k: k, cm: k.cm }); });
          if (c3.colis.length) { if (maxPaire - ro.len > 1) items.push({ esp: 1, cm: maxPaire - ro.len }); c3.colis.forEach(function (k) { items.push({ k: k, cm: k.cm, centre: 1 }); }); }
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
      '<span class="qui"><b>' + esc(qui) + '</b><small>' + (c.reference ? 'Réf. ' + esc(c.reference) + ' · ' : '') + c.lignes.reduce(function (a, l) { return a + (l.nb || 1); }, 0) + ' colis</small></span>' +
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
    c.supprime = true; toucher(c); rendre();
    toast('Camion supprimé', function () { c.supprime = false; toucher(c); rendre(); }, 'Annuler');
  }
  function ouvrirCamion(id) {
    var c = db.camions[id]; if (!c) return;
    if (c.statut === 'en_cours') { db.courant = id; sauver(true); viderForm(); aller('camion'); }
    else detail(c);
  }
  function rendreHisto() {
    var q = ($('#recherche').value || '').trim().toUpperCase();
    var tous = Object.keys(db.camions).map(function (k) { return db.camions[k]; }).filter(function (c) {
      if (c.supprime) return false;
      if (q && (c.client || '').toUpperCase().indexOf(q) < 0 && (c.reference || '').toUpperCase().indexOf(q) < 0) return false;
      return true;
    });
    var cours = tous.filter(function (c) { return c.statut === 'en_cours' && c.lignes.length; }).sort(function (a, b) { return b.maj_le < a.maj_le ? -1 : 1; });
    var fini = tous.filter(function (c) { return c.statut === 'termine'; }).sort(function (a, b) { return b.termine_le < a.termine_le ? -1 : 1; });
    var h = '';
    if (cours.length) h += '<div class="jour"><div class="jour-tete"><h2>Non terminés</h2><span>' + cours.length + '</span></div><div class="carte">' + cours.map(function (c) { return ligneCam(c, true); }).join('') + '</div></div>';
    if (cours.length || fini.length) h = '<p class="astuce">Glisse à gauche pour supprimer, à droite pour ouvrir.</p>' + h;
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
    else { x.setMonth(0); x.setDate(1); }
    return x;
  }
  function rendreStats() {
    var maint = new Date(), deb = debutPeriode(periodeStats, maint), fin, prevDeb = new Date(deb);
    if (periodeStats === 'semaine') { fin = new Date(deb); fin.setDate(fin.getDate() + 7); prevDeb.setDate(prevDeb.getDate() - 7); }
    else if (periodeStats === 'mois') { fin = new Date(deb); fin.setMonth(fin.getMonth() + 1); prevDeb.setMonth(prevDeb.getMonth() - 1); }
    else { fin = new Date(deb); fin.setFullYear(fin.getFullYear() + 1); prevDeb.setFullYear(prevDeb.getFullYear() - 1); }
    var finis = Object.keys(db.camions).map(function (k) { return db.camions[k]; }).filter(function (c) { return !c.supprime && c.statut === 'termine' && c.termine_le; });
    var dans = finis.filter(function (c) { var t = new Date(c.termine_le); return t >= deb && t < fin; });
    var avant = finis.filter(function (c) { var t = new Date(c.termine_le); return t >= prevDeb && t < deb; });
    var tot = dans.reduce(function (a, c) { return a + c.total_m3; }, 0), totAv = avant.reduce(function (a, c) { return a + c.total_m3; }, 0);
    // bâtons : jours de la semaine, semaines du mois, mois de l'année
    var cases = [], idx;
    if (periodeStats === 'semaine') { ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'].forEach(function (n) { cases.push({ n: n, v: 0 }); }); idx = function (t) { return (t.getDay() + 6) % 7; }; }
    else if (periodeStats === 'mois') { for (var w = 0; w < 5; w++) cases.push({ n: 'S' + (w + 1), v: 0 }); idx = function (t) { return Math.min(4, Math.floor((t.getDate() - 1) / 7)); }; }
    else { 'JFMAMJJASOND'.split('').forEach(function (n) { cases.push({ n: n, v: 0 }); }); idx = function (t) { return t.getMonth(); }; }
    dans.forEach(function (c) { cases[idx(new Date(c.termine_le))].v += c.total_m3; });
    var actuel = idx(maint), max = Math.max.apply(null, cases.map(function (x) { return x.v; }).concat([1]));
    var parClient = {};
    dans.forEach(function (c) { var k = c.client || 'Sans client'; (parClient[k] = parClient[k] || { m: 0, n: 0 }); parClient[k].m += c.total_m3; parClient[k].n++; });
    var clients = Object.keys(parClient).sort(function (a, b) { return parClient[b].m - parClient[a].m; });
    var maxC = clients.length ? parClient[clients[0]].m : 1;
    var nomPer = { semaine: 'Cette semaine', mois: 'Ce mois-ci', annee: 'Cette année' }[periodeStats];
    var evol = totAv > 0 ? Math.round((tot - totAv) / totAv * 100) : null;
    var h = '<div class="seg" id="segPer">' + [['semaine', 'Semaine'], ['mois', 'Mois'], ['annee', 'Année']].map(function (p) { return '<button type="button" data-per="' + p[0] + '" class="' + (periodeStats === p[0] ? 'actif' : '') + '">' + p[1] + '</button>'; }).join('') + '</div>' +
      '<div class="carte st-tot"><small>' + nomPer + '</small><b>' + f2(tot) + ' m³</b><p>' + dans.length + ' camion' + (dans.length > 1 ? 's' : '') +
      (evol !== null ? ' · <i class="' + (evol >= 0 ? 'plus' : 'moins') + '">' + (evol >= 0 ? '+' : '') + evol + ' %</i> par rapport à la période d\'avant' : '') + '</p>' +
      '<div class="st-ch' + (cases.length > 7 ? ' serre' : '') + '">' + cases.map(function (x, k) {
        return '<div class="' + (k === actuel ? 'auj' : '') + '"><b>' + (x.v ? Math.round(x.v) : '') + '</b><em style="height:' + Math.max(2, Math.round(x.v / max * 100)) + '%"></em><span>' + x.n + '</span></div>';
      }).join('') + '</div></div>' +
      (clients.length ? '<div class="carte st-cl"><h3>Par client</h3>' + clients.map(function (k) {
        var x = parClient[k];
        return '<div class="st-r"><b>' + esc(k) + '<em>' + x.n + ' camion' + (x.n > 1 ? 's' : '') + '</em></b><span>' + f2(x.m) + ' m³</span><small><i style="width:' + Math.round(x.m / maxC * 100) + '%"></i></small></div>';
      }).join('') + '</div>' : '<div class="carte vide">Aucun camion terminé sur cette période.</div>');
    $('#stats').innerHTML = h;
  }
  activerGlisser($('#histo'), ouvrirCamion, function (id) { supprimerCamion(id, rendreHisto); });
  activerGlisser($('#accEnCours'), ouvrirCamion, function (id) { supprimerCamion(id, rendreAccueil); });
  $('#histo').addEventListener('click', function (e) { var b = e.target.closest('.cam'); if (b) detail(db.camions[b.dataset.id]); });

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
    var sel = selection; selection = null;
    var f = ouvrirFeuille(
      '<h2>' + esc(c.client || 'Sans client') + (c.reference ? ' · Réf. ' + esc(c.reference) : '') + '</h2>' +
      '<p class="petit-txt" style="margin-top:-6px">' + date + ' · <b>' + f2(c.total_m3) + ' m³</b> ' + (enCours ? '' : '<span class="pastille ' + c.etat + '">' + LIB[c.etat] + '</span>') + '</p>' +
      '<div class="grille-btns">' +
      (enCours ? '<button class="btn" data-a="reprendre" type="button">Reprendre</button>' : '<button class="btn" data-a="dupliquer" type="button">Dupliquer</button>') +
      '<button class="btn sec" data-a="image" type="button">Partager</button></div>' +
      (c.lignes.length ? '<div class="plan-histo">' + htmlPlan(c, { lecture: true }) + '<button class="btn-lien plan-grand" data-a="plan" type="button">Ouvrir le plan en grand ›</button></div>' : '') +
      (c.lignes.length ? '<details class="pli carte"><summary><span>Colis</span><small>' + nbColis + ' colis · ' + gl.length + ' section' + (gl.length > 1 ? 's' : '') + '</small></summary>' + lignes + '</details>' : '<div class="carte"><div class="vide">Aucun colis</div></div>') +
      '<div class="grille-btns"><button class="btn danger" data-a="suppr" type="button">Supprimer</button><button class="btn sec" data-a="fermer" type="button">Fermer</button></div>');
    selection = sel;
    $('#feuilleFond').onclick = null;
    $$('[data-a]', f).forEach(function (b) {
      b.onclick = function () {
        var a = b.dataset.a;
        if (a === 'fermer') fermerFeuille();
        if (a === 'plan') {
          selection = null;
          var ouvrirPlan = function () { if (enCours) db.courant = c.id; else edition = c.id; aller('plan'); };
          if (history.state && history.state.f) { apresRetour = ouvrirPlan; fermerFeuille(); } else { fermerFeuille(); ouvrirPlan(); }
          if (!enCours) toast('Plan de ' + (c.client || 'ce camion') + ' : tu peux le modifier');
        }
        if (a === 'image') { fermerFeuille(); setTimeout(function () { choixPartage(c); }, 260); }
        if (a === 'reprendre') { db.courant = c.id; sauver(true); fermerFeuille(); viderForm(); setTimeout(function () { aller('camion'); }, 60); }
        if (a === 'dupliquer') {
          var copie = JSON.parse(JSON.stringify({ client: c.client, reference: c.reference, lignes: c.lignes, plan: c.plan, lgMax: c.lgMax || null, volMode: c.volMode || 'plage', volExact: c.volExact || null }));
          var n = nouveauCamion(copie); toucher(n);
          fermerFeuille(); viderForm(); setTimeout(function () { aller('camion'); }, 60); toast('Camion dupliqué : il est ouvert.');
        }
        if (a === 'suppr') {
          c.supprime = true; toucher(c); fermerFeuille(); rendreHisto();
          toast('Camion supprimé', function () { c.supprime = false; toucher(c); rendreHisto(); });
        }
      };
    });
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
    var r = reg(), cfg = Sync.cfg(), st = Sync.etat(), att = Sync.attente(db);
    var etatTxt, etatCl = '';
    if (!cfg.url) etatTxt = 'Pas de sauvegarde en ligne : les données restent sur cet appareil.';
    else if (!st.connecte) etatTxt = st.erreur ? 'Non connecté · ' + st.erreur : 'Non connecté';
    else if (!navigator.onLine) { etatTxt = 'Hors ligne · ' + att + ' en attente de synchro'; etatCl = 'att'; }
    else if (st.erreur) { etatTxt = 'Erreur : ' + st.erreur; etatCl = 'att'; }
    else if (att) { etatTxt = att + ' camion' + (att > 1 ? 's' : '') + ' en attente de synchro'; etatCl = 'att'; }
    else { etatTxt = 'Tout est synchronisé ✔' + (st.derniere ? ' (' + heure(st.derniere.toISOString()) + ')' : ''); etatCl = 'ok'; }
    var coul = Object.keys(PRESETS).map(function (k) {
      var cur = (r.couleurs || {})[k];
      return '<div class="couleur" data-k="' + k + '"><span class="nom">' + NOMS_COUL[k] + '</span><div class="pastilles">' +
        '<button type="button" class="auto' + (!cur ? ' actif' : '') + '" data-v="">Auto</button>' +
        PRESETS[k].map(function (p) { return '<button type="button" data-v="' + p + '" style="background:' + p + '" class="' + (cur && cur.toLowerCase() === p.toLowerCase() ? 'actif' : '') + '" aria-label="' + p + '"></button>'; }).join('') +
        '<input type="color" value="' + (cur || PRESETS[k][0]) + '" aria-label="Couleur libre"></div></div>';
    }).join('');
    $('#reglagesZone').innerHTML =
      '<div class="carte reg"><h2>Limites du camion</h2>' +
      '<div class="g2">' + champNum('rMin', 'Volume mini (m³)', r.m3Min) + champNum('rMax', 'Volume maxi (m³)', r.m3Max) + '</div>' +
      '<div class="g3">' + champNum('rE1Min', 'Étage 1 mini (m)', r.e1Min) + champNum('rE1Max', 'Étage 1 maxi (m)', r.e1Max) + champNum('rEcart', 'Écart G/D max (m³)', r.ecartMax) + '</div>' +
      '</div>' +

      '<button class="carte reg-ouvrir" id="ouvrirSections" type="button"><span><b>Sections et quantités</b><small>' + r.sections.length + ' sections · quantité remplie toute seule</small></span><i>›</i></button>' +

      '<div class="carte reg"><h2>Apparence</h2><div class="seg" id="segTheme">' +
      [['auto', 'Auto'], ['clair', 'Clair'], ['sombre', 'Sombre']].map(function (t) { return '<button type="button" data-t="' + t[0] + '" class="' + (r.theme === t[0] ? 'actif' : '') + '">' + t[1] + '</button>'; }).join('') +
      '</div><div id="couleurs">' + coul + '</div><button class="btn sec" id="resetCoul" type="button">Remettre les couleurs d\'origine</button></div>' +

      '<div class="carte reg"><h2>Sauvegarde en ligne</h2><div class="etat-sync ' + etatCl + '">' + esc(etatTxt) + '</div>' +
      (st.connecte
        ? '<p class="petit-txt">Connecté : ' + esc(st.email) + '</p><div class="g2"><button class="btn" id="sbSync" type="button">Synchroniser</button><button class="btn sec" id="sbOut" type="button">Se déconnecter</button></div>'
        : '<label class="champ"><span>Adresse du projet Supabase</span><input id="sbUrl" placeholder="https://xxxx.supabase.co" value="' + esc(cfg.url || '') + '" autocapitalize="off" spellcheck="false"></label>' +
          '<label class="champ"><span>Clé publique (anon)</span><input id="sbKey" value="' + esc(cfg.key || '') + '" autocapitalize="off" spellcheck="false"></label>' +
          '<div class="g2"><label class="champ"><span>E-mail</span><input id="sbMail" type="email" autocapitalize="off" autocomplete="username"></label>' +
          '<label class="champ"><span>Mot de passe</span><input id="sbMdp" type="password" autocomplete="current-password"></label></div>' +
          '<div class="g2"><button class="btn" id="sbIn" type="button">Se connecter</button><button class="btn sec" id="sbCreer" type="button">Créer le compte</button></div>' +
          '<p class="petit-txt">À faire une fois : coller le fichier supabase.sql dans Supabase › SQL Editor.</p>') +
      '</div>' +

      '<div class="carte reg"><h2>Données</h2><div class="g2"><button class="btn sec" id="exp" type="button">Exporter</button><button class="btn sec" id="imp" type="button">Importer</button></div>' +
      '<input type="file" id="impFichier" accept="application/json,.json" hidden>' +
      '<p class="petit-txt">' + Object.keys(db.camions).filter(function (k) { return !db.camions[k].supprime && db.camions[k].statut === 'termine'; }).length + ' camions enregistrés · version ' + VERSION_APP + '</p></div>';
    lierReglages();
  }

  // ---------- Sections et quantités ----------
  function txtLg(lg) { return (lg || []).map(fm).join(' · '); }
  function ouvrirSections() {
    var f = ouvrirFeuille(
      '<div class="sec-tete"><h2>Sections et quantités</h2><button class="lien" data-s="fermer" type="button">Fermer</button></div>' +
      '<div id="secEdit" hidden></div>' +
      '<input id="secCherche" class="sec-cherche" type="search" inputmode="decimal" placeholder="Chercher (ex. 75x225)" autocomplete="off">' +
      '<div id="secListe"></div>' +
      '<button class="btn" data-s="ajout" type="button">+ Ajouter une section</button>' +
      '<button class="lien sec-reset" data-s="reset" type="button">Remettre la liste d\'origine</button>');
    $('#feuilleFond').onclick = null;
    $('#secCherche').addEventListener('input', rendreSections);
    f.onclick = function (e) {
      var b = e.target.closest('[data-s]'); if (!b) return;
      var a = b.dataset.s;
      if (a === 'fermer') fermerFeuille();
      if (a === 'ajout') editerSection(-1);
      if (a === 'edit') editerSection(+b.dataset.i);
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
    $$('.couleur').forEach(function (bloc) {
      var k = bloc.dataset.k;
      $$('button', bloc).forEach(function (b) { b.onclick = function () { r.couleurs[k] = b.dataset.v || null; if (!b.dataset.v) delete r.couleurs[k]; db.sync.reglagesSales = true; sauver(); appliquerTheme(); rendreReglages(); }; });
      $('input[type=color]', bloc).addEventListener('change', function () { r.couleurs[k] = this.value; db.sync.reglagesSales = true; sauver(); appliquerTheme(); rendreReglages(); });
    });
    $('#resetCoul').onclick = function () { r.couleurs = {}; db.sync.reglagesSales = true; sauver(); appliquerTheme(); rendreReglages(); toast('Couleurs d\'origine remises'); };

    function connecter(creer) {
      var url = $('#sbUrl').value.trim(), key = $('#sbKey').value.trim();
      if (!/^https:\/\/.+/.test(url) || key.length < 20) { toast('Adresse ou clé Supabase incorrecte.'); return; }
      Sync.setCfg({ url: url, key: key });
      Sync.connexion($('#sbMail').value.trim(), $('#sbMdp').value, creer)
        .then(function (m) { toast(m); rendreReglages(); })
        .catch(function (e) { toast(e.message || 'Connexion impossible'); rendreReglages(); });
    }
    if ($('#sbIn')) { $('#sbIn').onclick = function () { connecter(false); }; $('#sbCreer').onclick = function () { connecter(true); }; }
    if ($('#sbSync')) $('#sbSync').onclick = function () { Sync.lancer().then(function () { rendreReglages(); toast('Synchro terminée'); }); };
    if ($('#sbOut')) $('#sbOut').onclick = function () { Sync.deconnexion().then(rendreReglages); };

    $('#exp').onclick = function () {
      var blob = new Blob([JSON.stringify({ app: 'camions-sdc', version: 1, exporte_le: maintenant(), camions: db.camions, reglages: db.reglages, clients: db.clients }, null, 1)], { type: 'application/json' });
      var a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'camions-sdc-' + jourCle(maintenant()) + '.json';
      document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    };
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
    changement: function () {
      if (vueActive === 'reglages') rendreReglages();
      else if (vueActive === 'historique') rendreHisto();
      else if (vueActive === 'camion' && !document.activeElement.matches('input')) rendreCamion();
      else if (vueActive === 'client' && !document.activeElement.matches('input')) rendreClient();
      else if (vueActive === 'accueil') rendreAccueil();
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
