/* Camions SDC — application */
(function () {
  'use strict';
  var P = window.Plan;
  var VERSION_APP = '16';
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
  function charger() {
    var d = null;
    try { d = JSON.parse(localStorage.getItem(CLE)); } catch (e) { d = null; }
    d = d || {};
    d.camions = d.camions || {};
    d.reglages = Object.assign({}, REG_DEF, d.reglages || {});
    d.reglages.couleurs = d.reglages.couleurs || {};
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
  function courant() {
    var c = db.camions[db.courant];
    if (!c || c.supprime || c.statut !== 'en_cours') { c = nouveauCamion(); sauver(true); }
    return c;
  }
  function majPlan(c) { // le camion se remplit tout seul au fil de la saisie
    c.plan = c.lignes.length ? P.meilleur(c.lignes, cfgC(c)).plan : null;
    c.planManuel = false;
  }
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
    $('#feuille').hidden = true; $('#feuilleFond').hidden = true; $('#feuille').innerHTML = '';
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
  });
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
    vueActive = v;
    $$('.vue').forEach(function (s) { s.classList.toggle('active', s.id === 'v-' + v); });
    $$('.onglet').forEach(function (b) { b.classList.toggle('actif', b.dataset.vue === ONGLET[v]); });
    window.scrollTo(0, 0);
    if (v === 'accueil') rendreAccueil();
    if (v === 'calcul') rendreCalc();
    if (v === 'client') rendreClient();
    if (v === 'camion') rendreCamion();
    if (v === 'plan') rendrePlanVue();
    if (v === 'historique') rendreHisto();
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
  var nb = 1, editId = null;
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
    $('#lblReste').textContent = reste < 0 ? 'Dépassé de' : (e.code === 'ok' ? 'Camion OK · reste' : 'Reste à charger');
    $('#reste').textContent = f2(Math.abs(reste));
    $('#total').textContent = f2(tot);
    $('#totMax').textContent = fm(r.cible);
    var pct = Math.max(0, Math.min(100, tot / r.cible * 100));
    $('#anneauVal').setAttribute('stroke-dasharray', pct.toFixed(1) + ' 100');
    $('#anneauPct').textContent = Math.round(tot / r.cible * 100) + '%';
    var cpt = $('#compteur');
    var avant = cpt.dataset.etat;
    cpt.classList.remove('peu', 'ok', 'trop'); cpt.classList.add(e.code);
    if (avant && avant !== 'ok' && e.code === 'ok' && cpt.dataset.camion === c.id) pluieFeuilles();
    cpt.dataset.etat = e.code; cpt.dataset.camion = c.id;
    heroPhoto(c, r, e.code === 'trop');
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
        '<button class="txt" type="button" data-act="edit"><div class="sec">' + fm(l.ep) + ' × ' + fm(l.la) + (n > 1 ? '<span class="mult">×' + n + '</span>' : '') + '</div>' +
        '<div class="det">' + fm(l.pi) + ' p · ' + fLong(l.lo) + ' m</div></button>' +
        '<span class="vol">' + f3(P.volTotalLigne(l)) + '</span>' +
        '<button class="suppr" type="button" data-act="del" aria-label="Supprimer">×</button></div>';
    }
    el.innerHTML = h;
  }

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
    nb = 1; editId = null;
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
      if (i < champs.length - 1) $(champs[i + 1]).focus(); else ajouter();
    });
    $(s).addEventListener('input', function () { $(s).classList.remove('erreur'); rendreApercu(); });
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
      nb = l.nb || 1;
      rendreCamion();
    } else {
      c.lignes.splice(idx, 1);
      if (editId === id) viderForm();
      majPlan(c); toucher(c); rendreCamion();
      toast('Ligne supprimée', function () { c.lignes.splice(idx, 0, l); majPlan(c); toucher(c); rendreCamion(); });
    }
  });

  // ---------- Accueil ----------
  function rendreAccueil() {
    var d = new Date(), txt = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    $('#accDate').textContent = txt.charAt(0).toUpperCase() + txt.slice(1);
    var h = d.getHours();
    $('.acc-titre').innerHTML = (h < 18 ? 'Bonjour' : 'Bonsoir') + ' <span>👋</span>';
    var auj = jourCle(d.toISOString()), tous = Object.keys(db.camions).map(function (k) { return db.camions[k]; }).filter(function (c) { return !c.supprime; });
    var jour = tous.filter(function (c) { return c.statut === 'termine' && jourCle(c.termine_le) === auj; });
    var m3 = jour.reduce(function (a, c) { return a + c.total_m3; }, 0);
    $('#accStats').innerHTML = '<div class="stat"><small>Aujourd\'hui</small><b>' + f2(m3) + ' m³</b></div><div class="stat"><small>Camions</small><b>' + jour.length + '</b></div>';
    $('#accNbJour').textContent = jour.length ? jour.length + ' camion' + (jour.length > 1 ? 's' : '') + ' aujourd\'hui' : 'Tous les camions';
    var cours = tous.filter(function (c) { return c.statut === 'en_cours' && c.lignes.length; }).sort(function (a, b) { return b.maj_le < a.maj_le ? -1 : 1; });
    $('#accEnCours').innerHTML = cours.length ? '<p class="titre-sec">En cours</p><div class="carte liste-cours">' + cours.map(function (c) {
      return '<button type="button" class="en-cours-l" data-reprendre="' + esc(c.id) + '"><span><b>' + esc(c.client || 'Sans client') + '</b><small>' + (c.reference ? 'Réf. ' + esc(c.reference) + ' · ' : '') + f2(c.total_m3) + ' m³</small></span><span class="go">Reprendre ›</span></button>';
    }).join('') + '</div>' : '';
  }
  $('#btnCommencer').addEventListener('click', function () {
    var c = courant();
    if (c.lignes.length || c.client || c.reference) { nouveauCamion(); sauver(true); }
    viderForm(); aller('client');
    setTimeout(function () { $('#client').focus(); }, 120);
  });
  $('#v-accueil').addEventListener('click', function (e) {
    var g = e.target.closest('[data-go]'); if (g) { aller(g.dataset.go); return; }
    var r = e.target.closest('[data-reprendre]');
    if (r) { db.courant = r.dataset.reprendre; sauver(true); viderForm(); aller('camion'); }
  });

  // ---------- Calcul m³ ----------
  var calc = { ep: '', la: '', pi: '', lo: '', nb: 1, actif: 'ep' };
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
    var vol = calcVol();
    $('#calcVol').textContent = vol == null ? '0,000' : f3(vol * calc.nb);
    $('#calcFormule').textContent = vol == null ? 'Épaisseur × largeur × pièces × longueur' :
      calc.ep + ' × ' + calc.la + ' mm × ' + calc.pi + ' pièces × ' + fLong(P.num(calc.lo)) + ' m' + (calc.nb > 1 ? '  ·  × ' + calc.nb + ' colis' : '');
    $('#cNb').textContent = calc.nb;
  }
  $$('#v-calcul .fd').forEach(function (b) { b.addEventListener('click', function () { calc.actif = b.dataset.k; rendreCalc(); }); });
  $('#pave').addEventListener('click', function (e) {
    var t = e.target.closest('[data-t]'); if (!t) return;
    var k = calc.actif, val = calc[k], key = t.dataset.t;
    if (key === 'del') calc[k] = val.slice(0, -1);
    else if (key === 'next') calc.actif = ORDRE[(ORDRE.indexOf(k) + 1) % 4];
    else if (key === ',') { if (k !== 'pi' && val.indexOf(',') < 0) calc[k] = (val || '0') + ','; }
    else if (val.replace(',', '').length < 6) calc[k] = (val === '0' ? '' : val) + key;
    rendreCalc();
  });
  $('#calcEffacer').addEventListener('click', function () { calc = { ep: '', la: '', pi: '', lo: '', nb: 1, actif: 'ep' }; rendreCalc(); });
  $('#cMoins').addEventListener('click', function () { calc.nb = Math.max(1, calc.nb - 1); rendreCalc(); });
  $('#cPlus').addEventListener('click', function () { calc.nb = Math.min(99, calc.nb + 1); rendreCalc(); });
  $('#calcAjout').addEventListener('click', function () {
    var vol = calcVol();
    if (vol == null) { toast('Remplis les 4 valeurs.'); return; }
    var c = courant();
    c.lignes.push({ id: petitId(), ep: P.num(calc.ep), la: P.num(calc.la), pi: P.num(calc.pi), lo: P.num(calc.lo), nb: calc.nb });
    majPlan(c); toucher(c);
    calc.pi = ''; calc.lo = ''; calc.nb = 1; calc.actif = 'pi'; rendreCalc();
    toast('Ajouté au camion · ' + f2(c.total_m3) + ' m³', function () { aller('camion'); }, 'Voir');
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

  $('#btnTerminer').addEventListener('click', function () {
    var c = courant();
    if (!c.lignes.length) { toast('Aucun colis à enregistrer.'); return; }
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
  var PH = { W: 1672, H: 570, x0: 48, xd: 1213, deck: 378, img: 'camion.jpg?v=16', bois: 'bois.jpg?v=16' };
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
    var maxCm = 6 * Math.round(r.e1Max * 100);
    if (totCm > maxCm) return { cls: 'e', etq: '⚠ Trop long', detail: 'Les colis font ' + fm(totCm / 100) + ' m bout à bout : ' + fm((totCm - maxCm) / 100) + ' m de trop pour 3 étages de ' + fm(r.e1Max) + ' m. Retire des colis.' };
    if (v.etat.code === 'peu') return { cls: 'a', etq: 'Il manque ' + f2(v.etat.manque) + ' m³' };
    var lg = v.erreurs.filter(function (m) { return /^Étage/.test(m); });
    if (lg.length) return { cls: 'e', etq: '⚠ À revoir', detail: lg[0] };
    if (v.etat.code === 'trop') return { cls: 'e', etq: 'Dépassé ' + f2(v.etat.depasse) + ' m³' };
    if (P.deseq(v) > r.ecartMax + 0.005) return { cls: 'a', etq: '≈ Équilibré au mieux', detail: 'Avec ces colis, écart de ' + f2(Math.min(P.deseq(v), 99)) + ' m³ entre gauche et droite : le plus faible possible.' };
    return { cls: 'o', etq: '✓ Équilibré' };
  }

  function htmlPlan(c, opts) {
    var r = cfgC(c), v = P.verifier(c.lignes, c.plan || {}, r), st = statutPlan(v, r);
    var maxLen = r.e1Max * 100;
    P.ROWS.forEach(function (k) { maxLen = Math.max(maxLen, v.rows[k].len); });
    var idxLigne = {}; c.lignes.forEach(function (l, i) { idxLigne[l.id] = i; });
    var h = '<div class="statut3 ' + st.cls + '"><span class="tot">' + f2(v.total) + ' <small>/ ' + fm(r.cible) + ' m³</small></span><span class="etq">' + esc(st.etq) + '</span>' +
      '<span class="gd">G ' + f2(v.volG) + '<br>D ' + f2(v.volD) + '</span></div>';
    if (st.detail) h += '<p class="statut-detail">' + esc(st.detail) + '</p>';
    ['G', 'D'].forEach(function (s) {
      var inv = s === 'D';
      h += '<div class="titre-cote">' + (s === 'G' ? 'Côté conducteur' : 'Côté passager') + '</div>';
      h += '<div class="carte cote3"><div class="c3-tete"><b>' + (s === 'G' ? 'Gauche' : 'Droite') + '</b><span>' + f2(s === 'G' ? v.volG : v.volD) + ' m³</span></div>';
      [3, 2, 1].forEach(function (f) {
        var ro = v.rows[s + f];
        h += '<div class="et3' + (inv ? ' inv' : '') + (ro.alerte ? ' ko' : '') + '"><div class="trk"><i class="cab"></i>' +
          '<i class="lim" style="' + (inv ? 'right' : 'left') + ':calc(3px + ' + (r.e1Max * 100 / maxLen * 100).toFixed(2) + '% * (100% - 6px) / 100%)"></i>';
        function chip(k, centre) {
          return '<button type="button" class="chip b' + (idxLigne[k.ligneId] % 4) + (centre ? ' centre' : '') + (selection === k.id ? ' sel' : '') + '" data-c="' + esc(k.id) + '" style="width:calc((100% - 6px) * ' + (k.cm / maxLen).toFixed(4) + ' - 3px)"' + (opts.lecture ? ' disabled' : '') + ' aria-label="' + esc(libColis(k) + (centre ? ' · au centre' : '')) + '">' + (k.cm / maxLen > .06 ? '<b>' + fm(k.lo) + ' m</b>' : '') + (k.cm / maxLen > .13 ? '<small>' + (centre ? 'centre · ' : '') + fm(k.ep) + '×' + fm(k.la) + '</small>' : '') + '</button>';
        }
        function vide(cm) { return cm > 1 ? '<i class="esp" style="width:calc((100% - 6px) * ' + (cm / maxLen).toFixed(4) + ' - 3px)"></i>' : ''; }
        var lgAff = ro.m;
        if (f === 3) {
          // étage 3 : paires gauche/droite puis le colis du centre, le tout centré dans la longueur
          var c3 = v.rows.C3, maxPaire = Math.max(v.rows.G3.len, v.rows.D3.len);
          var E = maxPaire + c3.len, sup = Math.min(v.rows.G2.len, v.rows.D2.len);
          h += vide(Math.max(0, (sup - E) / 2));
          ro.colis.forEach(function (k) { h += chip(k, false); });
          if (c3.colis.length) { h += vide(maxPaire - ro.len); c3.colis.forEach(function (k) { h += chip(k, true); }); }
          lgAff = E / 100;
        } else ro.colis.forEach(function (k) { h += chip(k, false); });
        h += '</div><div class="tag">É' + f + '<b>' + fm(Math.round(lgAff * 100) / 100) + ' m</b></div></div>';
      });
      h += inv ? '<div class="sens inv"><span>◂ Arrière</span><span class="c">Cabine ▮</span></div>' : '<div class="sens"><span class="c">▮ Cabine</span><span>Arrière ▸</span></div>';
      h += '</div>';
    });
    if (!opts.lecture) {
      var sel = selection && P.colisDe(c.lignes).filter(function (k) { return k.id === selection; })[0];
      if (sel) h += '<div class="barre-sel"><span><b>' + esc(libColis(sel)) + '</b><br>Touche un autre colis pour les échanger.</span><button type="button" class="btn-lien" data-annuler="1">Annuler</button></div>';
      else h += '<p class="aide">Plan calculé et équilibré automatiquement. En haut : paires gauche/droite, le colis seul <span class="centre-mini">au centre</span>.<br>Pour échanger deux colis : touche l\'un puis l\'autre.</p>';
      if (c.planManuel) h += '<button type="button" class="btn-lien recalc" data-recalc="1">↺ Revenir au plan automatique</button>';
    }
    return h;
  }

  function rendrePlanVue() {
    var c = courant();
    // le plan doit toujours être bon : on le refait s'il est faux ou incomplet (sauf échange manuel valide)
    var v = P.verifier(c.lignes, c.plan || {}, cfgC(c));
    if (c.lignes.length && (v.nonPlaces.length || (!c.planManuel && (P.noteVerif(v) >= 1000 || P.deseq(v) > reg().ecartMax + 0.005)))) { majPlan(c); toucher(c); }
    $('#planZone').innerHTML = htmlPlan(c, {});
  }

  function echanger(c, a, b) {
    var plan = Object.assign({}, c.plan || {}), ra = plan[a], rb = plan[b];
    if (!ra || !rb || ra === rb) { selection = null; return toast(ra === rb ? 'Ces deux colis sont sur le même étage.' : 'Échange impossible.'); }
    plan[a] = rb; plan[b] = ra;
    var avant = P.noteVerif(P.verifier(c.lignes, c.plan, cfgC(c))), v2 = P.verifier(c.lignes, plan, cfgC(c));
    var lg = v2.erreurs.filter(function (m) { return /^Étage/.test(m); });
    if (lg.length && P.noteVerif(v2) > avant) { selection = null; return toast('Échange refusé : ' + lg[0]); }
    var v1 = P.verifier(c.lignes, c.plan, cfgC(c));
    if (P.deseq(v2) > Math.max(reg().ecartMax, P.deseq(v1)) + 0.001) { selection = null; return toast('Échange refusé : le camion serait déséquilibré.'); }
    c.plan = plan; c.planManuel = true; selection = null; toucher(c);
    toast('Colis échangés');
  }

  $('#planZone').addEventListener('click', function (e) {
    var c = courant();
    if (e.target.closest('[data-annuler]')) { selection = null; rendrePlanVue(); return; }
    if (e.target.closest('[data-recalc]')) { majPlan(c); toucher(c); selection = null; rendrePlanVue(); toast('Plan automatique remis'); return; }
    var ch = e.target.closest('.chip'); if (!ch) return;
    var id = ch.dataset.c;
    if (!selection) selection = id;
    else if (selection === id) selection = null;
    else echanger(c, selection, id);
    rendrePlanVue();
  });
  $('#btnPartager').addEventListener('click', function () { partagerImage(courant()); });

  // ---------- Image du plan (partage) ----------
  function imagePlan(c) {
    var r = cfgC(c), v = P.verifier(c.lignes, c.plan || {}, r);
    var acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#18A06B';
    var W = 1080, pad = 48, rowH = 96;
    var msgs = v.erreurs.map(function (m) { return ['#D7261E', m]; }).concat(v.avis.map(function (m) { return ['#C46A00', m]; }));
    if (!msgs.length) msgs.push(['#18924C', '✔ Plan conforme']);
    var cv = document.createElement('canvas'), x = cv.getContext('2d');
    x.font = '600 28px Inter, system-ui, sans-serif';
    function couper(t, max) {
      var mots = t.split(' '), out = [], cur = '';
      mots.forEach(function (w) { var essai = cur ? cur + ' ' + w : w; if (x.measureText(essai).width > max && cur) { out.push(cur); cur = w; } else cur = essai; });
      if (cur) out.push(cur); return out;
    }
    var lignesMsg = []; msgs.forEach(function (m) { couper(m[1], W - 2 * pad - 30).forEach(function (l, i) { lignesMsg.push([m[0], l, i === 0]); }); });
    var hEtage = 56 + 2 * (rowH + 46);
    var H = 210 + 3 * (hEtage + 24) + (v.nonPlaces.length ? rowH + 90 : 0) + lignesMsg.length * 40 + 90;
    cv.width = W; cv.height = H;
    var fondG = x.createLinearGradient(0, 0, W, H); fondG.addColorStop(0, '#F4F1E8'); fondG.addColorStop(1, '#E1EAD9'); x.fillStyle = fondG; x.fillRect(0, 0, W, H);
    x.fillStyle = '#E3A94F'; x.fillRect(0, 192, W, 3);
    x.fillStyle = '#1E1B2E'; x.font = '800 50px Inter, system-ui, sans-serif';
    var titre = 'Camion' + (c.client ? ' — ' + c.client : '') + (c.reference ? ' · Réf. ' + c.reference : '');
    x.fillText(titre, pad, 82);
    var d = new Date(c.termine_le || c.maj_le || Date.now());
    x.font = '500 28px Inter, system-ui, sans-serif'; x.fillStyle = '#6E6A80';
    x.fillText(d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }), pad, 126);
    x.font = '700 30px Inter, system-ui, sans-serif'; x.fillStyle = '#1E1B2E';
    x.fillText('Total ' + f2(v.total) + ' m³   ·   G ' + f2(v.volG) + '   ·   D ' + f2(v.volD) + '   ·   Écart ' + (v.ecart >= 0 ? '+' : '−') + f2(Math.abs(v.ecart)), pad, 176);
    var maxLen = Math.max.apply(null, P.ROWS.map(function (k) { return v.rows[k].len; }).concat([r.e1Max * 100])) * 1.02;
    var y = 210, larg = W - 2 * pad;
    var teintes = [acc, '#3E7C8C', '#B5654A', '#4F8A5B', '#5468A8', '#8A5C93'];
    var idxLigne = {}; c.lignes.forEach(function (l, i) { idxLigne[l.id] = i; });
    function piste(liste, yy) {
      x.fillStyle = '#EFEADC'; rond(pad, yy, larg, rowH, 14); x.fill();
      var gauche = piste.side === 'G', xx = gauche ? pad + 4 : pad + larg - 4;
      liste.forEach(function (k) {
        var w = k.cm / maxLen * (larg - 8) - 4;
        if (!gauche) xx -= w + 4;
        var gb = x.createLinearGradient(0, yy, 0, yy + rowH); gb.addColorStop(0, '#F0D9A6'); gb.addColorStop(1, '#CFA864');
        x.fillStyle = gb; rond(xx, yy + 4, Math.max(w, 6), rowH - 8, 8); x.fill();
        x.strokeStyle = '#A07C43'; x.lineWidth = 2; x.stroke();
        x.strokeStyle = 'rgba(160,124,67,.45)'; x.lineWidth = 1.5;
        for (var pl = 1; pl < 5; pl++) { x.beginPath(); x.moveTo(xx + 3, yy + 4 + pl * (rowH - 8) / 5); x.lineTo(xx + w - 3, yy + 4 + pl * (rowH - 8) / 5); x.stroke(); }
        x.fillStyle = '#2F3B47'; x.fillRect(xx + w * .2, yy + 4, 3, rowH - 8); x.fillRect(xx + w * .8 - 3, yy + 4, 3, rowH - 8);
        x.save(); x.beginPath(); x.rect(xx, yy, Math.max(w, 6), rowH); x.clip();
        x.textAlign = 'center';
        x.fillStyle = '#FFFDF7'; rond(xx + w / 2 - 54, yy + 14, 108, 38, 6); x.fill();
        x.fillStyle = '#3A2A14'; x.font = '800 28px Inter, system-ui, sans-serif'; x.fillText(fm(k.lo) + ' m', xx + w / 2, yy + 43);
        x.font = '600 20px Inter, system-ui, sans-serif'; x.fillStyle = '#5E4622'; x.fillText(fm(k.ep) + '×' + fm(k.la), xx + w / 2, yy + 78);
        x.restore(); x.textAlign = 'left';
        if (gauche) xx += w + 4;
      });
    }
    function rond(a, b, w, h, rr) { x.beginPath(); x.moveTo(a + rr, b); x.arcTo(a + w, b, a + w, b + h, rr); x.arcTo(a + w, b + h, a, b + h, rr); x.arcTo(a, b + h, a, b, rr); x.arcTo(a, b, a + w, b, rr); x.closePath(); }
    [3, 2, 1].forEach(function (f) {
      x.fillStyle = '#fff'; rond(pad - 16, y, larg + 32, hEtage, 22); x.fill();
      x.fillStyle = '#6E6A80'; x.font = '700 28px Inter, system-ui, sans-serif';
      x.fillText('Étage ' + f + (f === 1 ? ' (bas)' : ''), pad, y + 40);
      var yy = y + 56;
      ['G', 'D'].forEach(function (s) {
        var ro = v.rows[s + f];
        x.font = '600 24px Inter, system-ui, sans-serif'; x.fillStyle = '#1E1B2E';
        x.fillText(NOMS[s] + (s === 'G' ? '  ·  ▮ cabine à gauche' : '  ·  cabine à droite ▮'), pad, yy + 26);
        x.textAlign = 'right'; x.fillStyle = ro.alerte ? '#D7261E' : '#6E6A80';
        x.fillText(f2(ro.m) + ' m · ' + f2(ro.vol) + ' m³', pad + larg, yy + 26); x.textAlign = 'left';
        piste.side = s; piste(f === 3 ? ro.colis.concat(v.rows.C3.colis) : ro.colis, yy + 38);
        yy += rowH + 46;
      });
      y += hEtage + 24;
    });
    if (v.nonPlaces.length) {
      x.fillStyle = '#D7261E'; x.font = '700 26px Inter, system-ui, sans-serif'; x.fillText('Non placés', pad, y + 30);
      piste.side = 'G'; piste(v.nonPlaces, y + 44); y += rowH + 90;
    }
    x.font = '600 28px Inter, system-ui, sans-serif';
    lignesMsg.forEach(function (m) { x.fillStyle = m[0]; x.fillText((m[2] ? '• ' : '  ') + m[1], pad, y + 30); y += 40; });
    x.fillStyle = '#9A96AE'; x.font = '500 22px Inter, system-ui, sans-serif'; x.fillText('SDC – Les Scieries du Centre', pad, H - 30);
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
  window.__imagePlan = imagePlan; // pour les tests

  // ---------- Historique ----------
  function jourCle(iso) { var d = new Date(iso); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function jourNom(cle) {
    var p = cle.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2]);
    var auj = jourCle(new Date().toISOString()), hier = jourCle(new Date(Date.now() - 864e5).toISOString());
    var txt = d.toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    if (cle === auj) return 'Aujourd\'hui · ' + txt;
    if (cle === hier) return 'Hier · ' + txt;
    return txt.charAt(0).toUpperCase() + txt.slice(1);
  }
  function heure(iso) { return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
  var LIB = { ok: 'OK', peu: 'Pas assez', trop: 'Dépassé' };
  function ligneCam(c, enCours) {
    var qui = c.client || 'Sans client';
    return '<button class="cam" type="button" data-id="' + esc(c.id) + '"><span class="h">' + heure(enCours ? c.maj_le : c.termine_le) + '</span>' +
      '<span class="qui"><b>' + esc(qui) + '</b><small>' + (c.reference ? 'Réf. ' + esc(c.reference) + ' · ' : '') + c.lignes.reduce(function (a, l) { return a + (l.nb || 1); }, 0) + ' colis</small></span>' +
      '<span class="m3">' + f2(c.total_m3) + '</span>' +
      (enCours ? '<span class="pastille cours">' + (c.id === db.courant ? 'Ouvert' : 'En cours') + '</span>' : '<span class="pastille ' + c.etat + '">' + LIB[c.etat] + '</span>') + '</button>';
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
    var jours = {}, ordre = [];
    fini.forEach(function (c) { var k = jourCle(c.termine_le); if (!jours[k]) { jours[k] = []; ordre.push(k); } jours[k].push(c); });
    ordre.forEach(function (k) {
      var tot = jours[k].reduce(function (a, c) { return a + c.total_m3; }, 0);
      h += '<div class="jour"><div class="jour-tete"><h2>' + jourNom(k) + '</h2><span>' + jours[k].length + ' camion' + (jours[k].length > 1 ? 's' : '') + ' · ' + f2(tot) + ' m³</span></div>' +
        '<div class="carte">' + jours[k].map(function (c) { return ligneCam(c, false); }).join('') + '</div></div>';
    });
    if (!h) h = '<div class="carte vide">' + (q ? 'Aucun camion trouvé.' : 'Aucun camion enregistré pour l\'instant.') + '</div>';
    $('#histo').innerHTML = h;
  }
  $('#recherche').addEventListener('input', rendreHisto);
  $('#histo').addEventListener('click', function (e) { var b = e.target.closest('.cam'); if (b) detail(db.camions[b.dataset.id]); });

  function detail(c) {
    if (!c) return;
    var enCours = c.statut === 'en_cours';
    var lignes = c.lignes.map(function (l) {
      return '<div class="lig"><div class="txt"><div class="sec">' + fm(l.ep) + ' × ' + fm(l.la) + ((l.nb || 1) > 1 ? '<span class="mult">×' + l.nb + '</span>' : '') + '</div><div class="det">' + fm(l.pi) + ' p · ' + fLong(l.lo) + ' m</div></div><span class="vol">' + f3(P.volTotalLigne(l)) + '</span></div>';
    }).join('');
    var date = enCours ? 'En cours · modifié à ' + heure(c.maj_le) : new Date(c.termine_le).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }) + ' · ' + heure(c.termine_le);
    var sel = selection; selection = null;
    var f = ouvrirFeuille(
      '<h2>' + esc(c.client || 'Sans client') + (c.reference ? ' · Réf. ' + esc(c.reference) : '') + '</h2>' +
      '<p class="petit-txt" style="margin-top:-6px">' + date + ' · <b>' + f2(c.total_m3) + ' m³</b> ' + (enCours ? '' : '<span class="pastille ' + c.etat + '">' + LIB[c.etat] + '</span>') + '</p>' +
      '<div class="grille-btns">' +
      (enCours ? '<button class="btn" data-a="reprendre" type="button">Reprendre</button>' : '<button class="btn" data-a="dupliquer" type="button">Dupliquer</button>') +
      '<button class="btn sec" data-a="image" type="button">Partager l\'image</button></div>' +
      '<div class="carte liste" style="flex:none;max-height:none">' + (lignes || '<div class="vide">Aucun colis</div>') + '</div>' +
      (c.lignes.length ? htmlPlan(c, { lecture: true }) : '') +
      '<div class="grille-btns"><button class="btn danger" data-a="suppr" type="button">Supprimer</button><button class="btn sec" data-a="fermer" type="button">Fermer</button></div>');
    selection = sel;
    $('#feuilleFond').onclick = null;
    $$('[data-a]', f).forEach(function (b) {
      b.onclick = function () {
        var a = b.dataset.a;
        if (a === 'fermer') fermerFeuille();
        if (a === 'image') partagerImage(c);
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
    accent: ['#18A06B', '#0F766E', '#1F4D2E', '#2F5C8F', '#5B4FBF', '#7C3AED', '#C2410C', '#D0332B'],
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

  function lierReglages() {
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
  history.replaceState({ v: 'accueil', d: 0 }, '');
  montrer('accueil');

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    var avaitCtrl = !!navigator.serviceWorker.controller, recharge = false;
    navigator.serviceWorker.register('sw.js?v=16').catch(function () {});
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (avaitCtrl && !recharge) { recharge = true; location.reload(); }
    });
  }
})();
