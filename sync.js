/* Camions SDC — synchronisation Supabase (facultative).
   Le stockage local reste la référence : rien n'est jamais perdu si la synchro échoue. */
(function () {
  'use strict';
  var CLE_CFG = 'csdc.supabase';
  var SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.js';
  var client = null, chargement = null, enCours = false, minuterie = null;
  var etat = { connecte: false, email: '', erreur: '', derniere: null };
  var hooks = { lire: null, ecrire: null, changement: null };

  function cfg() { try { return JSON.parse(localStorage.getItem(CLE_CFG)) || {}; } catch (e) { return {}; } }
  function setCfg(c) { localStorage.setItem(CLE_CFG, JSON.stringify(c)); client = null; }

  function chargerSdk() {
    if (window.supabase && window.supabase.createClient) return Promise.resolve();
    if (chargement) return chargement;
    chargement = new Promise(function (ok, ko) {
      var s = document.createElement('script');
      s.src = SDK; s.onload = ok; s.onerror = function () { chargement = null; ko(new Error('Connexion impossible (hors ligne ?)')); };
      document.head.appendChild(s);
    });
    return chargement;
  }

  function getClient() {
    var c = cfg();
    if (!c.url || !c.key) return Promise.resolve(null);
    if (client) return Promise.resolve(client);
    return chargerSdk().then(function () {
      client = window.supabase.createClient(c.url.trim(), c.key.trim(), { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'csdc-auth' } });
      return client;
    });
  }

  function notifier() { if (hooks.changement) hooks.changement(etat); }

  function verifierSession() {
    return getClient().then(function (sb) {
      if (!sb) { etat.connecte = false; return null; }
      return sb.auth.getSession().then(function (r) {
        var s = r && r.data && r.data.session;
        etat.connecte = !!s; etat.email = s ? s.user.email : '';
        return s;
      });
    }).catch(function (e) { etat.erreur = e.message; return null; });
  }

  function versLigne(c) {
    return { id: c.id, client: c.client || null, reference: c.reference || null, cree_le: c.cree_le, termine_le: c.termine_le || null,
      statut: c.statut, etat: c.etat || null, total_m3: Math.round((c.total_m3 || 0) * 1000) / 1000,
      lignes: c.lignes || [], plan: c.plan || null, maj_le: c.maj_le, supprime: !!c.supprime };
  }
  function depuisLigne(r) {
    return { id: r.id, client: r.client || '', reference: r.reference || '', cree_le: r.cree_le, termine_le: r.termine_le,
      statut: r.statut, etat: r.etat, total_m3: Number(r.total_m3) || 0, lignes: r.lignes || [], plan: r.plan || null,
      maj_le: r.maj_le, supprime: !!r.supprime };
  }
  function t(x) { return x ? new Date(x).getTime() : 0; }

  // Une passe complète : envoie les modifs locales puis récupère celles du serveur
  function lancer() {
    if (enCours || !cfg().url) return Promise.resolve(false);
    if (!navigator.onLine) { etat.erreur = 'Hors ligne'; notifier(); return Promise.resolve(false); }
    enCours = true;
    var db = hooks.lire();
    return verifierSession().then(function (session) {
      if (!session) return false;
      var sb = client;
      var sales = Object.keys(db.camions).map(function (k) { return db.camions[k]; }).filter(function (c) { return c._sale; });
      var envoi = sales.length
        ? sb.from('camions').upsert(sales.map(versLigne)).then(function (r) {
            if (r.error) throw r.error;
            var db2 = hooks.lire();
            sales.forEach(function (c) { var l = db2.camions[c.id]; if (l && l.maj_le === c.maj_le) delete l._sale; });
            hooks.ecrire(db2, true);
          })
        : Promise.resolve();
      return envoi.then(function () {
        var depuis = db.sync && db.sync.depuis ? new Date(t(db.sync.depuis) - 10 * 60 * 1000).toISOString() : '1970-01-01T00:00:00Z';
        return sb.from('camions').select('*').gt('maj_le', depuis).order('maj_le', { ascending: true }).limit(2000);
      }).then(function (r) {
        if (r.error) throw r.error;
        var db3 = hooks.lire(), max = db3.sync && db3.sync.depuis || null, change = false;
        (r.data || []).forEach(function (row) {
          var loc = db3.camions[row.id], dist = depuisLigne(row);
          if (!loc || t(dist.maj_le) > t(loc.maj_le)) { db3.camions[row.id] = dist; change = true; }
          if (!max || t(row.maj_le) > t(max)) max = row.maj_le;
        });
        db3.sync = db3.sync || {}; db3.sync.depuis = max;
        // réglages
        var regEnvoi = db3.sync.reglagesSales
          ? sb.from('reglages').upsert({ user_id: session.user.id, data: db3.reglages, maj_le: new Date().toISOString() }).then(function (r2) { if (r2.error) throw r2.error; db3.sync.reglagesSales = false; })
          : sb.from('reglages').select('data, maj_le').maybeSingle().then(function (r2) {
              if (r2.error) throw r2.error;
              if (r2.data && r2.data.data && t(r2.data.maj_le) > t(db3.sync.reglagesLe)) { db3.reglages = Object.assign({}, db3.reglages, r2.data.data); db3.sync.reglagesLe = r2.data.maj_le; change = true; }
            });
        return regEnvoi.then(function () { hooks.ecrire(db3, true); etat.erreur = ''; etat.derniere = new Date(); return change; });
      });
    }).catch(function (e) {
      etat.erreur = (e && (e.message || e.error_description)) || 'Erreur de synchro';
      return false;
    }).then(function (change) { enCours = false; notifier(); return change; });
  }

  function bientot() { clearTimeout(minuterie); minuterie = setTimeout(lancer, 1500); }

  function connexion(email, mdp, creer) {
    return getClient().then(function (sb) {
      if (!sb) throw new Error('Renseigne l\'adresse et la clé Supabase.');
      var p = creer ? sb.auth.signUp({ email: email, password: mdp }) : sb.auth.signInWithPassword({ email: email, password: mdp });
      return p.then(function (r) {
        if (r.error) throw r.error;
        if (creer && !r.data.session) return 'Compte créé : confirme l\'e-mail reçu, puis connecte-toi.';
        // tout renvoyer au premier branchement
        var db = hooks.lire();
        Object.keys(db.camions).forEach(function (k) { db.camions[k]._sale = true; });
        db.sync = db.sync || {}; db.sync.reglagesSales = !db.sync.reglagesLe;
        hooks.ecrire(db, true);
        return lancer().then(function () { return 'Connecté.'; });
      });
    });
  }

  function deconnexion() {
    return getClient().then(function (sb) { return sb && sb.auth.signOut(); }).then(function () { etat.connecte = false; etat.email = ''; notifier(); });
  }

  function attente(db) { return Object.keys(db.camions).filter(function (k) { return db.camions[k]._sale; }).length; }

  window.Sync = {
    init: function (h) {
      hooks = h;
      window.addEventListener('online', bientot);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) bientot(); });
      setInterval(function () { if (!document.hidden) lancer(); }, 90000);
      if (cfg().url) verifierSession().then(function (s) { notifier(); if (s) lancer(); });
    },
    cfg: cfg, setCfg: setCfg, lancer: lancer, bientot: bientot, connexion: connexion, deconnexion: deconnexion,
    etat: function () { return etat; }, attente: attente, actif: function () { return !!cfg().url; }
  };
})();
