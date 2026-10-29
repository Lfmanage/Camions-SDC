/* Camions SDC — application */
(function () {
  'use strict';
  var P = window.Plan;
  var VERSION_APP = '2';
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
  function toucher(c) {
    c.total_m3 = Math.round(P.totalM3(c.lignes) * 1000) / 1000;
    c.etat = P.etat(c.total_m3, reg()).code;
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
    if (!(history.state && history.state.f)) history.pushState({ f: 1, v: history.state && history.state.v }, '');
    return f;
  }
  function fermerFeuille(parRetour) {
    if ($('#feuille').hidden) return;
    $('#feuille').hidden = true; $('#feuilleFond').hidden = true; $('#feuille').innerHTML = '';
    if (parRetour !== true && history.state && history.state.f) history.back();
  }
  window.addEventListener('popstate', function () {
    if (!$('#feuille').hidden) { fermerFeuille(true); return; }
    if (vueActive === 'plan' && !(history.state && history.state.v === 'plan')) { selection = null; montrer('camion'); }
  });
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
  var vueActive = 'camion';
  function montrer(v) {
    vueActive = v;
    $$('.vue').forEach(function (s) { s.classList.toggle('active', s.id === 'v-' + v); });
    var onglet = v === 'plan' ? 'camion' : v;
    $$('.onglet').forEach(function (b) { b.classList.toggle('actif', b.dataset.vue === onglet); });
    window.scrollTo(0, 0);
    if (v === 'camion') rendreCamion();
    if (v === 'plan') rendrePlanVue();
    if (v === 'historique') rendreHisto();
    if (v === 'reglages') rendreReglages();
  }
  $$('.onglet').forEach(function (b) { b.addEventListener('click', function () { selection = null; if (history.state && history.state.v) history.replaceState(null, ''); montrer(b.dataset.vue); }); });

  // ---------- Écran Camion ----------
  var nb = 1, editId = null;
  var champs = ['#fEp', '#fLa', '#fPi', '#fLo'];

  function messageEtat(total) {
    var e = P.etat(total, reg());
    if (e.code === 'peu') return 'Pas assez : il manque ' + f2(e.manque) + ' m³ pour atteindre ' + fm(reg().m3Min) + ' m³';
    if (e.code === 'trop') return '⚠ ATTENTION : limite autorisée dépassée de ' + f2(e.depasse) + ' m³';
    return 'Camion OK';
  }

  function rendreCompteur(c) {
    var r = reg(), tot = c.total_m3, e = P.etat(tot, r);
    var reste = Math.round((r.m3Max - tot) * 100) / 100;
    $('#lblReste').textContent = reste < 0 ? 'Dépassé de' : 'Reste';
    $('#reste').textContent = f2(Math.abs(reste));
    $('#total').textContent = f2(tot);
    var cpt = $('#compteur');
    cpt.classList.remove('peu', 'ok', 'trop'); cpt.classList.add(e.code);
    var echelle = r.m3Max * 1.12;
    $('#jaugeFill').style.width = Math.min(100, tot / echelle * 100) + '%';
    $('#rep1').style.left = (r.m3Min / echelle * 100) + '%';
    $('#rep2').style.left = (r.m3Max / echelle * 100) + '%';
    $('#rep1 em').textContent = fm(r.m3Min);
    $('#rep2 em').textContent = fm(r.m3Max);
    $('#msgEtat').textContent = messageEtat(tot);
    // camion dessiné : les colis se remplissent avec le volume
    var n = tot > 0 ? Math.max(1, Math.min(9, Math.ceil(tot / r.m3Max * 9 - 1e-6))) : 0;
    $$('.camion-svg .pk').forEach(function (g, i) {
      g.classList.toggle('plein', i < n);
      g.classList.toggle('rouge', e.code === 'trop' && i >= 6);
    });
  }

  function rendreListe(c) {
    var el = $('#liste');
    if (!c.lignes.length) {
      el.innerHTML = '<div class="vide">Aucun colis pour l\'instant.<br>Saisis épaisseur, largeur, pièces et longueur.</div>';
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

  function rendreRapides() {
    var v = P.num($('#fLo').value);
    $('#rapides').innerHTML = (reg().longueurs || []).map(function (x) {
      return '<button type="button" data-l="' + x + '" class="' + (v === x ? 'actif' : '') + '">' + fLong(x) + '</button>';
    }).join('');
  }

  function rendreCamion() {
    var c = courant();
    if (document.activeElement !== $('#client')) $('#client').value = c.client || '';
    if (document.activeElement !== $('#reference')) $('#reference').value = c.reference || '';
    $('#listeClients').innerHTML = tousClients().map(function (x) { return '<option value="' + esc(x) + '">'; }).join('');
    rendreCompteur(c);
    rendreListe(c);
    rendreRapides();
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
    toucher(c);
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
    $(s).addEventListener('input', function () { $(s).classList.remove('erreur'); if (s === '#fLo') rendreRapides(); });
  });
  $('#client').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#reference').focus(); } });
  $('#reference').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('#fEp').focus(); } });
  $('#client').addEventListener('input', function () {
    var el = $('#client'), p = el.selectionStart, up = el.value.toUpperCase();
    if (up !== el.value) { el.value = up; try { el.setSelectionRange(p, p); } catch (e) {} }
    var c = courant(); c.client = up.trim(); toucher(c);
  });
  $('#reference').addEventListener('input', function () { var c = courant(); c.reference = $('#reference').value.trim(); toucher(c); });

  $('#rapides').addEventListener('click', function (e) {
    var b = e.target.closest('button'); if (!b) return;
    $('#fLo').value = fLong(Number(b.dataset.l)); $('#fLo').classList.remove('erreur');
    rendreRapides();
  });
  $('#nbMoins').addEventListener('click', function () { nb = Math.max(1, nb - 1); $('#nbVal').textContent = nb; });
  $('#nbPlus').addEventListener('click', function () { nb = Math.min(99, nb + 1); $('#nbVal').textContent = nb; });
  $('#btnMeme').addEventListener('click', function () {
    var c = courant();
    if (!c.lignes.length) { toast('Aucune ligne à dupliquer.'); return; }
    var d = Object.assign({}, c.lignes[c.lignes.length - 1], { id: petitId() });
    c.lignes.push(d); toucher(c); rendreCamion();
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
      toucher(c); rendreCamion();
      toast('Ligne supprimée', function () { c.lignes.splice(idx, 0, l); toucher(c); rendreCamion(); });
    }
  });

  $('#btnNouveau').addEventListener('click', function () {
    var c = courant();
    if (!c.lignes.length && !c.client && !c.reference) { toast('Ce camion est déjà vide.'); return; }
    viderForm(); nouveauCamion(); sauver(true); rendreCamion();
    toast('Camion précédent gardé dans Historique › En cours.');
  });

  $('#btnTerminer').addEventListener('click', function () {
    var c = courant();
    if (!c.lignes.length) { toast('Aucun colis à enregistrer.'); return; }
    var e = P.etat(c.total_m3, reg());
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
      rendreCamion();
      toast('Camion enregistré ✔');
    });
  });

  $('#btnPlan').addEventListener('click', function () {
    var c = courant();
    if (!c.lignes.length) { toast('Ajoute d\'abord des colis.'); return; }
    var place = c.plan && P.colisDe(c.lignes).some(function (k) { return c.plan[k.id]; });
    if (!place) { c.plan = P.proposer(c.lignes, reg()).plan; c.planManuel = false; toucher(c); }
    history.pushState({ v: 'plan' }, '');
    montrer('plan');
  });

  // ---------- Plan de chargement ----------
  var selection = null;
  var NOMS = { G: 'Gauche · conducteur', D: 'Droite · passager' };

  function htmlPlan(c, opts) {
    var r = reg(), v = P.verifier(c.lignes, c.plan || {}, r);
    var idxLigne = {}; c.lignes.forEach(function (l, i) { idxLigne[l.id] = i; });
    var maxLen = Math.max.apply(null, P.ROWS.map(function (k) { return v.rows[k].len; }).concat([r.e1Max * 100]));
    var echelle = maxLen * 1.02;
    function bloc(k) {
      var w = k.cm / echelle * 100;
      return '<button type="button" class="colis c' + (idxLigne[k.ligneId] % 6) + (selection === k.id ? ' sel' : '') + '" data-c="' + esc(k.id) + '" style="width:calc(' + w.toFixed(3) + '% - 2px)">' +
        '<b>' + fm(k.ep) + '×' + fm(k.la) + '</b><span>' + fm(k.lo) + ' m · ' + f2(k.vol) + '</span></button>';
    }
    var selRow = selection && c.plan ? c.plan[selection] || '' : null;
    function rangee(s, f) {
      var key = s + f, ro = v.rows[key];
      var lims = f === 1 ? [r.e1Min * 100, r.e1Max * 100] : [v.rows[s + (f - 1)].len];
      var cible = !opts.lecture && selection && selRow !== key;
      return '<div class="rangee' + (ro.alerte ? ' alerte' : '') + (cible ? ' cible' : '') + '" data-row="' + key + '">' +
        '<div class="tete"><b>' + NOMS[s] + '</b><span class="info">' + f2(ro.m) + ' m · ' + f2(ro.vol) + ' m³</span></div>' +
        '<div class="piste">' + ro.colis.map(bloc).join('') +
        lims.map(function (L) { return L > 0 ? '<i class="limite" style="left:' + (L / echelle * 100).toFixed(3) + '%"></i>' : ''; }).join('') +
        '</div></div>';
    }
    var ecartNeg = v.ecart < -0.005;
    var h = '<div class="carte plan-totaux">' +
      '<div><small>Gauche</small><b>' + f2(v.volG) + '</b></div>' +
      '<div><small>Droite</small><b>' + f2(v.volD) + '</b></div>' +
      '<div class="' + (ecartNeg ? 'neg' : '') + '"><small>Écart G−D</small><b>' + (v.ecart >= 0 ? '+' : '−') + f2(Math.abs(v.ecart)) + '</b></div>' +
      '<div><small>Total m³</small><b>' + f2(v.total) + '</b></div></div>';
    [3, 2, 1].forEach(function (f) {
      h += '<div class="carte etage"><h3><span>Étage ' + f + (f === 1 ? ' (bas)' : '') + '</span><span>' +
        f2(v.rows['G' + f].vol + v.rows['D' + f].vol) + ' m³</span></h3>' + rangee('G', f) + rangee('D', f) + '</div>';
    });
    if (v.nonPlaces.length) {
      h += '<div class="carte plateau rangee' + (!opts.lecture && selection && selRow !== '' ? ' cible' : '') + '" data-row=""><div class="tete"><b>Non placés</b><span class="info">' + v.nonPlaces.length + ' colis</span></div>' +
        '<div class="piste">' + v.nonPlaces.map(bloc).join('') + '</div></div>';
    }
    var m = v.erreurs.map(function (x) { return '<p class="e">' + esc(x) + '</p>'; }).concat(v.avis.map(function (x) { return '<p class="a">' + esc(x) + '</p>'; }));
    if (!m.length) m.push('<p class="o">✔ Plan conforme : longueurs et équilibre respectés.</p>');
    h += '<div class="msgs">' + m.join('') + '</div>';
    if (!opts.lecture) h += '<p class="aide">' + (selection ? 'Touche la rangée où mettre ce colis (ou le colis pour annuler).' : 'Touche un colis, puis la rangée où le mettre.') + '</p>';
    return h;
  }

  function rendrePlanVue() {
    var c = courant();
    $('#planZone').innerHTML = htmlPlan(c, {});
  }

  $('#planZone').addEventListener('click', function (e) {
    var c = courant();
    var col = e.target.closest('.colis'), row = e.target.closest('[data-row]');
    if (col) {
      var id = col.dataset.c;
      if (selection === id) { selection = null; }
      else if (selection && row && ((c.plan || {})[selection] || '') !== row.dataset.row) { deplacer(c, selection, row.dataset.row); }
      else selection = id;
      rendrePlanVue(); return;
    }
    if (row && selection) { deplacer(c, selection, row.dataset.row); rendrePlanVue(); }
  });
  function deplacer(c, id, dest) {
    c.plan = c.plan || {};
    if (dest) c.plan[id] = dest; else delete c.plan[id];
    // on garde l'ordre : le colis déplacé va en bout de rangée
    var o = {}; Object.keys(c.plan).forEach(function (k) { if (k !== id) o[k] = c.plan[k]; }); if (dest) o[id] = dest;
    c.plan = o;
    c.planManuel = true; selection = null; toucher(c);
  }
  $('#btnRetour').addEventListener('click', function () { selection = null; if (history.state && history.state.v === 'plan') history.back(); else montrer('camion'); });
  $('#btnRecalc').addEventListener('click', function () {
    var c = courant();
    if (!c.lignes.length) { toast('Aucun colis.'); return; }
    var go = c.planManuel ? demander({ titre: 'Remplacer le plan ?', texte: 'Tes déplacements à la main seront remplacés par un nouveau plan calculé.', oui: 'Recalculer' }) : Promise.resolve(true);
    go.then(function (ok) {
      if (!ok) return;
      c.plan = P.proposer(c.lignes, reg()).plan; c.planManuel = false; selection = null; toucher(c); rendrePlanVue();
      toast('Plan recalculé');
    });
  });
  $('#btnPartager').addEventListener('click', function () { partagerImage(courant()); });

  // ---------- Image du plan (partage) ----------
  function imagePlan(c) {
    var r = reg(), v = P.verifier(c.lignes, c.plan || {}, r);
    var acc = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#2F5C8F';
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
    var fondG = x.createLinearGradient(0, 0, W, H); fondG.addColorStop(0, '#EEF2F6'); fondG.addColorStop(1, '#D3DDE8'); x.fillStyle = fondG; x.fillRect(0, 0, W, H);
    x.fillStyle = '#F5A04A'; x.fillRect(0, 192, W, 3);
    x.fillStyle = '#1E1B2E'; x.font = '700 50px Fraunces, Georgia, serif';
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
      x.fillStyle = '#EEF2F6'; rond(pad, yy, larg, rowH, 14); x.fill();
      var xx = pad + 4;
      liste.forEach(function (k) {
        var w = k.cm / maxLen * (larg - 8) - 4;
        x.fillStyle = teintes[idxLigne[k.ligneId] % 6]; rond(xx, yy + 4, Math.max(w, 6), rowH - 8, 10); x.fill();
        x.save(); x.beginPath(); x.rect(xx, yy, Math.max(w, 6), rowH); x.clip();
        x.fillStyle = '#fff'; x.textAlign = 'center';
        x.font = '700 24px Inter, system-ui, sans-serif'; x.fillText(fm(k.ep) + '×' + fm(k.la), xx + w / 2, yy + 42);
        x.font = '500 21px Inter, system-ui, sans-serif'; x.fillText(fm(k.lo) + ' m · ' + f2(k.vol), xx + w / 2, yy + 72);
        x.restore(); x.textAlign = 'left';
        xx += w + 4;
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
        x.fillText(NOMS[s], pad, yy + 26);
        x.textAlign = 'right'; x.fillStyle = ro.alerte ? '#D7261E' : '#6E6A80';
        x.fillText(f2(ro.m) + ' m · ' + f2(ro.vol) + ' m³', pad + larg, yy + 26); x.textAlign = 'left';
        piste(ro.colis, yy + 38);
        yy += rowH + 46;
      });
      y += hEtage + 24;
    });
    if (v.nonPlaces.length) {
      x.fillStyle = '#D7261E'; x.font = '700 26px Inter, system-ui, sans-serif'; x.fillText('Non placés', pad, y + 30);
      piste(v.nonPlaces, y + 44); y += rowH + 90;
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
        if (a === 'reprendre') { db.courant = c.id; sauver(true); fermerFeuille(); viderForm(); montrer('camion'); }
        if (a === 'dupliquer') {
          var copie = JSON.parse(JSON.stringify({ client: c.client, reference: c.reference, lignes: c.lignes, plan: c.plan }));
          var n = nouveauCamion(copie); toucher(n);
          fermerFeuille(); viderForm(); montrer('camion'); toast('Camion dupliqué : il est ouvert.');
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
    accent: ['#2F5C8F', '#5B4FBF', '#7C3AED', '#0F766E', '#15803D', '#C2410C', '#D0332B', '#1F4D2E'],
    bg: ['#EEF2F6', '#F1EEFB', '#F4F4F5', '#EFF6F0', '#FBF5EC', '#FFFFFF', '#1A2230', '#0F172A'],
    card: ['#FFFFFF', '#F8FAFC', '#FAF9FF', '#FFFCF5', '#222C3B', '#1E293B'],
    nav: ['#FFFFFF', '#F8FAFC', '#EEF2F6', '#1C2533', '#1E293B'],
    text: ['#1C2633', '#111827', '#24364F', '#E8EDF4', '#F8FAFC']
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
    if (meta) meta.setAttribute('content', getComputedStyle(root).getPropertyValue('--bg').trim() || '#EEF2F6');
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
      '<label class="champ"><span>Longueurs rapides (m), séparées par « ; »</span><input id="rLong" inputmode="decimal" value="' + (r.longueurs || []).map(fLong).join(' ; ') + '"></label></div>' +

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
    $('#rLong').addEventListener('change', function () {
      var l = this.value.split(/[;\s]+/).map(P.num).filter(function (x) { return isFinite(x) && x > 0; });
      r.longueurs = l.slice(0, 12); db.sync.reglagesSales = true; sauver();
      this.value = r.longueurs.map(fLong).join(' ; ');
    });
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
    }
  });
  appliquerTheme();
  montrer('camion');

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    var avaitCtrl = !!navigator.serviceWorker.controller, recharge = false;
    navigator.serviceWorker.register('sw.js?v=2').catch(function () {});
    navigator.serviceWorker.addEventListener('controllerchange', function () {
      if (avaitCtrl && !recharge) { recharge = true; location.reload(); }
    });
  }
})();
