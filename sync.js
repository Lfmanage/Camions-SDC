/* Camions SDC — équipe partagée avec Supabase, sans compte : un code d'équipe + un prénom.
   Le téléphone garde tout en mémoire (marche sans réseau) et échange avec l'équipe dès que possible.
   Rien n'est jamais effacé du téléphone par la synchro. */
(function () {
  'use strict';
  // ⬇⬇⬇ À REMPLIR UNE FOIS (Supabase › Project Settings › API) ⬇⬇⬇
  var SUPABASE_URL = 'https://gkwpaylkblzwqtaelgvw.supabase.co';   // ex. https://abcdefgh.supabase.co
  var SUPABASE_CLE = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imdrd3BheWxrYmx6d3F0YWVsZ3Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMzNzk3MjcsImV4cCI6MjEwODk1NTcyN30.31xv8Lc20ngIQVfn82zhWwqZeCT70AqX64ZG7znq0m4';   // clé publique « anon » (commence par eyJ…)
  // ⬆⬆⬆

  var CLE = 'csdc.equipe';
  var PARTAGE = ['m3Min', 'm3Max', 'e1Min', 'e1Max', 'ecartMax', 'seuil4', 'sections', 'ajouts', 'fonds', 'ambiance'];
  var st = lire(), hooks = {}, enCours = null, minuterie = null, etat = { erreur: '', derniere: null };

  function lire() { try { return JSON.parse(localStorage.getItem(CLE)) || {}; } catch (e) { return {}; } }
  function garder() { try { localStorage.setItem(CLE, JSON.stringify(st)); } catch (e) {} }
  function conf() {
    var o = window.CSDC_SUPABASE || {};
    return { url: String(o.url || st.url || SUPABASE_URL || '').replace(/^(https?:\/\/[^\/]+).*$/i, '$1'), cle: o.cle || st.cle || SUPABASE_CLE || '' };
  }
  function actif() { var c = conf(); return !!(c.url && c.cle); }
  function rejoint() { return actif() && !!st.equipe && !!(st.session && st.session.uid); }
  function nom(p) { return String(p || '').replace(/[^0-9A-Za-zÀ-ÖØ-öø-ÿ \-]/g, '').trim().replace(/\s+/g, ' ').toUpperCase(); } // « Sylvano. » → « SYLVANO »
  function t(x) { return x ? new Date(x).getTime() : 0; }
  function notifier(change) { if (hooks.changement) hooks.changement(etat, change); }

  // ---------- Appels réseau ----------
  function http(chemin, o) {
    o = o || {};
    var c = conf(), h = { apikey: c.cle, 'Content-Type': 'application/json' };
    if (o.auth !== false && st.session) h.Authorization = 'Bearer ' + st.session.at;
    return fetch(c.url + chemin, { method: o.methode || 'GET', headers: h, body: o.corps !== undefined ? JSON.stringify(o.corps) : undefined })
      .then(function (r) {
        return r.text().then(function (tx) {
          var j = null; try { j = tx ? JSON.parse(tx) : null; } catch (e) {}
          if (!r.ok) {
            var er = new Error((j && (j.message || j.msg || j.error_description || j.error)) || ('Erreur ' + r.status));
            er.status = r.status; throw er;
          }
          return j;
        });
      });
  }
  function garderSession(j) {
    st.session = { at: j.access_token, rt: j.refresh_token, exp: j.expires_at || Math.floor(Date.now() / 1000) + (j.expires_in || 3600), uid: (j.user && j.user.id) || (st.session && st.session.uid) };
    garder(); return st.session;
  }
  // Compte invisible créé tout seul pour ce téléphone (connexion anonyme Supabase)
  function session() {
    if (st.session && st.session.exp > Date.now() / 1000 + 60) return Promise.resolve(st.session);
    if (st.session && st.session.rt) {
      return http('/auth/v1/token?grant_type=refresh_token', { methode: 'POST', auth: false, corps: { refresh_token: st.session.rt } })
        .then(garderSession)
        .catch(function (e) {
          if (e.status === 400 || e.status === 401 || e.status === 403) { st.session = null; st.equipe = null; garder(); etat.erreur = 'Reconnecte-toi à l\'équipe'; notifier(true); }
          throw e;
        });
    }
    return http('/auth/v1/signup', { methode: 'POST', auth: false, corps: { data: {} } }).then(garderSession);
  }
  function rpc(nom, args) { return session().then(function () { return http('/rest/v1/rpc/' + nom, { methode: 'POST', corps: args || {} }); }); }

  // ---------- Camions ----------
  function norm(x) { return String(x || '').trim().toUpperCase().replace(/\s+/g, ' '); }
  function cleCamion(c) {
    if (!c.client && !c.reference) return null;
    return norm(c.client) + '|' + norm(c.reference) + '|' + String(c.termine_le || c.cree_le || '').slice(0, 10);
  }
  function versServeur(c) {
    var d = JSON.parse(JSON.stringify(c)); delete d._sale;
    return { id: c.id, cle: cleCamion(c), maj_le: c.maj_le, supprime: !!c.supprime, data: d };
  }
  function partage(r) { var o = {}; PARTAGE.forEach(function (k) { if (r[k] !== undefined) o[k] = r[k]; }); return o; }

  function envoyer(db, fusion) {
    var moi = st.session.uid;
    var sales = Object.keys(db.camions).map(function (k) { return db.camions[k]; })
      .filter(function (c) { return c._sale && (fusion || !c.auteur || c.auteur === moi || st.admin); });
    // une suppression part seulement quand le « Annuler » a disparu (6 s) : « Annuler » remet donc toujours le camion tel quel
    var attente = sales.filter(function (c) { return c.supprime && Date.now() - t(c.maj_le) < 7000; });
    if (attente.length) { sales = sales.filter(function (c) { return attente.indexOf(c) < 0; }); clearTimeout(envoyer.tard); envoyer.tard = setTimeout(function () { if (rejoint()) lancer(); }, 7500); }
    if (!sales.length) return Promise.resolve(false);
    var change = false;
    function paquet(i) {
      if (i >= sales.length) return Promise.resolve(change);
      var lot = sales.slice(i, i + 40);
      return rpc('envoyer_camions', { p_camions: lot.map(versServeur), p_fusion: !!fusion }).then(function (res) {
        var d = hooks.lire();
        lot.forEach(function (c) {
          var r = res && res[c.id], l = d.camions[c.id];
          if (!l) return;
          if (r === 'refuse') { delete d.camions[c.id]; if (d.courant === c.id) d.courant = null; st.depuis = null; change = true; return; } // pas à moi : on l'enlève de ce téléphone, l'équipe renverra sa version si je peux la voir
          if (r && r !== c.id) { // fusionné avec un camion déjà dans l'équipe
            delete d.camions[c.id]; if (d.courant === c.id) d.courant = r; change = true; return;
          }
          if (l.maj_le === c.maj_le) { delete l._sale; if (l.supprime) { delete d.camions[c.id]; if (d.courant === c.id) d.courant = null; } } // supprimé : effacé pour de bon
        });
        hooks.ecrire(d);
        return paquet(i + 40);
      });
    }
    return paquet(0);
  }

  function recevoir() {
    var change = false;
    function page() {
      var q = '/rest/v1/camions_equipe?select=id,auteur,auteur_prenom,data,supprime,maj_le,serveur_le&order=serveur_le.asc&limit=500' +
        (st.depuis ? '&serveur_le=gt.' + encodeURIComponent(st.depuis) : '');
      return http(q).then(function (rows) {
        rows = rows || [];
        var d = hooks.lire();
        rows.forEach(function (r) {
          var c = r.data || {}, l = d.camions[r.id];
          c.id = r.id; c.auteur = r.auteur; c.auteur_prenom = nom(r.auteur_prenom); c.supprime = !!r.supprime;
          c.maj_le = new Date(r.maj_le).toISOString(); delete c._sale;
          if (c.supprime) { if (l && !l._sale) { delete d.camions[r.id]; change = true; } }
          else if (!l || !l._sale || t(c.maj_le) >= t(l.maj_le)) { d.camions[r.id] = c; change = true; }
          st.depuis = r.serveur_le;
        });
        hooks.ecrire(d); garder();
        return rows.length === 500 ? page() : effaces();
      });
    }
    function effaces() { // camions effacés par un autre téléphone : on les enlève d'ici aussi
      return http('/rest/v1/camions_effaces?select=id').then(function (rows) {
        var d = hooks.lire(), n = 0;
        (rows || []).forEach(function (r) { var l = d.camions[r.id]; if (l && !(l._sale && !l.supprime)) { delete d.camions[r.id]; if (d.courant === r.id) d.courant = null; n++; } });
        if (n) { hooks.ecrire(d); change = true; }
        return change;
      }, function () { return change; }); // ancienne version de Supabase : pas de liste, on continue
    }
    return page();
  }

  function reglages() {
    var d = hooks.lire();
    if (!st.admin && d.sync && d.sync.limitesSales) { // un membre a changé les limites du camion : elles partent à toute l'équipe
      var lim = {}; ['m3Min', 'm3Max', 'ecartMax', 'e1Min', 'e1Max'].forEach(function (k) { lim[k] = d.reglages[k]; });
      return rpc('ecrire_limites', { p: lim }).then(function (le) {
        var d2 = hooks.lire(); d2.sync.limitesSales = false; st.regLe = le; garder(); hooks.ecrire(d2); return false;
      }).catch(function (e) { if (/ecrire_limites|function|404|PGRST/i.test(e.message || '')) { var d3 = hooks.lire(); d3.sync.limitesSales = false; hooks.ecrire(d3); return false; } throw e; });
    }
    if (!st.admin && d.sync && d.sync.sectionsSales) { // un membre a changé la liste des sections : elle part à toute l'équipe
      return rpc('ecrire_sections', { p: { sections: d.reglages.sections, ajouts: d.reglages.ajouts || [] } }).then(function (le) {
        var d2 = hooks.lire(); d2.sync.sectionsSales = false; st.regLe = le; garder(); hooks.ecrire(d2); return false;
      }).catch(function (e) { if (/ecrire_sections|function|404|PGRST/i.test(e.message || '')) { var d3 = hooks.lire(); d3.sync.sectionsSales = false; hooks.ecrire(d3); return false; } throw e; });
    }
    if (st.admin && d.sync && d.sync.reglagesSales) {
      return rpc('ecrire_reglages', { p: partage(d.reglages) }).then(function (le) {
        var d2 = hooks.lire(); d2.sync.reglagesSales = false; st.regLe = le; garder(); hooks.ecrire(d2); return false;
      }).catch(function (e) { if (/ADMIN/.test(e.message)) { st.admin = false; garder(); } throw e; });
    }
    return rpc('lire_reglages').then(function (j) {
      if (!j) throw new Error('PAS_MEMBRE');
      st.admin = !!j.admin;
      var change = false;
      if (j.le && t(j.le) > t(st.regLe) && j.reglages && Object.keys(j.reglages).length) {
        var d2 = hooks.lire();
        PARTAGE.forEach(function (k) { if (j.reglages[k] !== undefined) d2.reglages[k] = j.reglages[k]; });
        d2.sync = d2.sync || {}; d2.sync.reglagesSales = false;
        hooks.ecrire(d2); change = true;
      }
      st.regLe = j.le; garder();
      return change;
    });
  }

  function membres() {
    return http('/rest/v1/membres?select=user_id,prenom,actif,rejoint_le,vu_le&order=rejoint_le.asc').then(function (l) { st.membres = (l || []).map(function (x) { x.prenom = nom(x.prenom); return x; }); garder(); });
  }

  function quitter(raison) {
    st.dernierUid = st.session && st.session.uid; st.equipe = null; st.admin = false; st.depuis = null; st.membres = []; garder();
    etat.erreur = raison === 'retire' ? 'Ce téléphone n\'est plus dans l\'équipe (retiré, ou compte repris sur un autre téléphone).' : 'Reconnecte-toi à l\'équipe';
    notifier(true);
  }

  // Une passe : envoie ce qui a changé ici, puis récupère ce que l'équipe a changé
  function lancer() {
    if (!rejoint()) return Promise.resolve(false);
    if (enCours) return enCours;
    if (!navigator.onLine) { etat.erreur = 'Hors ligne'; notifier(false); return Promise.resolve(false); }
    var change = false;
    enCours = session()
      .then(function () { return envoyer(hooks.lire(), false); }).then(function (c) { change = change || c; return reglages(); })
      .then(function (c) { change = change || c; return recevoir(); }).then(function (c) { change = change || c; return membres(); })
      .then(function () { etat.erreur = ''; etat.derniere = new Date(); })
      .catch(function (e) {
        var m = (e && e.message) || '';
        if (/PAS_MEMBRE|RETIRE/.test(m)) quitter('retire');
        else etat.erreur = /Failed to fetch|NetworkError|Load failed/i.test(m) ? 'Pas de réseau' : (m || 'Erreur de synchro');
      })
      .then(function () { enCours = null; notifier(change); return change; });
    return enCours;
  }
  function bientot() { if (!rejoint()) return; clearTimeout(minuterie); minuterie = setTimeout(lancer, 1200); }

  // ---------- Rejoindre ----------
  var MSG = {
    CODE: 'Code d\'équipe incorrect.', CODE_COURT: 'Code trop court (4 caractères minimum).', SECRET_COURT: 'Code secret trop court (4 caractères minimum).', IMAGE: 'Image trop lourde ou non reconnue.', PRENOM: 'Écris ton prénom.',
    RETIRE: 'Ce téléphone a été retiré de l\'équipe.', PRENOM_PRIS: 'Ce prénom est déjà utilisé dans l\'équipe.', CODE_PRIS: 'Ce code ne peut pas être utilisé.', ADMIN: 'Action non autorisée.',
    SOI_MEME: 'Impossible sur ce téléphone.', INTROUVABLE: 'Ce camion n\'existe plus.'
  };
  function message(e) {
    var m = (e && e.message) || '';
    var cles = Object.keys(MSG).sort(function (a, b) { return b.length - a.length; }); // PRENOM_PRIS avant PRENOM
    for (var i = 0; i < cles.length; i++) if (m.indexOf(cles[i]) >= 0) return MSG[cles[i]];
    if (/anonymous/i.test(m)) return 'Dans Supabase, active « Allow anonymous sign-ins ».';
    if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Pas de réseau : réessaie quand tu as du réseau.';
    return m || 'Connexion impossible.';
  }
  function rejoindre(code, prenom) {
    if (!actif()) return Promise.reject(new Error('Supabase n\'est pas encore branché.'));
    var ancien = (st.session && st.session.uid) || st.dernierUid;
    return rpc('rejoindre', { p_code: code, p_prenom: nom(prenom) }).then(function (j) {
      st.equipe = j.equipe; st.prenom = nom(prenom); st.admin = !!j.admin; st.depuis = null; st.regLe = null;
      if (j.secret) st.secretAVoir = j.secret;
      garder();
      // mes camions déjà dans le téléphone partent dans l'équipe (rien n'est effacé)
      var d = hooks.lire(), moi = st.session.uid;
      Object.keys(d.camions).forEach(function (k) {
        var c = d.camions[k];
        if (!c.auteur) { c.auteur = moi; c.auteur_prenom = st.prenom; } // seuls les camions jamais envoyés deviennent les miens (jamais ceux d'un autre compte)
        if (c.auteur === moi) c._sale = true;
      });
      d.sync = d.sync || {}; d.sync.reglagesSales = !!j.nouvelle; // la toute première équipe prend les réglages de ce téléphone
      hooks.ecrire(d);
      return envoyer(d, true).then(function () { return lancer(); }).then(function () { return j; });
    }).catch(function (e) { throw new Error(message(e)); });
  }

  function deconnecter() {
    return lancer().then(function () {
      var n = hooks.lire ? Object.keys(hooks.lire().camions).filter(function (k) { return hooks.lire().camions[k]._sale; }).length : 0;
      if (n > 0) throw new Error('Des camions ne sont pas encore envoyés. Connecte-toi au réseau puis réessaie.');
      st.dernierUid = st.session && st.session.uid;
      // le téléphone est vidé des camions de l'équipe (ils sont en sécurité dans l'équipe) : le prochain compte ne voit rien de l'ancien
      if (hooks.lire) { var d = hooks.lire(); Object.keys(d.camions).forEach(function (k) { if (d.camions[k].auteur) delete d.camions[k]; }); if (d.courant && !d.camions[d.courant]) d.courant = null; d.clients = []; hooks.ecrire(d); } // la liste des clients aussi
      ['equipe', 'session', 'prenom', 'admin', 'membres', 'depuis', 'regLe', 'secretAVoir'].forEach(function (k) { delete st[k]; });
      garder(); notifier(true); return true;
    });
  }

  window.Sync = {
    quitter: deconnecter,
    init: function (h) {
      hooks = h;
      window.addEventListener('online', bientot);
      document.addEventListener('visibilitychange', function () { if (!document.hidden) bientot(); });
      setInterval(function () { if (!document.hidden) lancer(); }, 20000);
      if (rejoint()) setTimeout(lancer, 300);
    },
    nom: nom, actif: actif, rejoint: rejoint, lancer: lancer, bientot: bientot, rejoindre: rejoindre, message: message,
    moi: function () { return { uid: st.session && st.session.uid, prenom: nom(st.prenom), admin: !!st.admin }; },
    membres: function () { return (st.membres || []).filter(function (x) { return x.actif !== false; }).map(function (x) { var o = {}; for (var k in x) o[k] = x[k]; o.prenom = nom(x.prenom); return o; }); },
    etat: function () { return etat; },
    attente: function (db) { return Object.keys(db.camions).filter(function (k) { return db.camions[k]._sale; }).length; },
    secretAVoir: function () { return st.secretAVoir || null; },
    oublierSecret: function () { delete st.secretAVoir; garder(); },
    changerCode: function (code) { return rpc('changer_code', { p_code: code }).catch(function (e) { throw new Error(message(e)); }); },
    definirSecret: function (c) { return rpc('definir_secret', { p_code: c }).catch(function (e) { throw new Error(message(e)); }); },
    nouveauSecret: function () { return rpc('nouveau_secret').catch(function (e) { throw new Error(message(e)); }); },
    renommerClient: function (de, vers) { return rpc('renommer_client', { p_de: de, p_vers: vers }).catch(function (e) { throw new Error(/renommer_client|function|404|PGRST/i.test(e.message || '') ? 'Mets à jour Supabase (fichier v78) pour fusionner pour toute l\'équipe.' : message(e)); }); },
    recuperer: function (id) { // le camion d'un collègue passe à mon nom
      return rpc('recuperer_camion', { p_id: id }).then(function (r) {
        var d = hooks.lire(), c = r.data || {};
        c.id = r.id; c.auteur = r.auteur; c.auteur_prenom = nom(r.auteur_prenom); c.supprime = false; delete c._sale;
        if (r.maj_le) c.maj_le = new Date(r.maj_le).toISOString();
        d.camions[r.id] = c; hooks.ecrire(d); notifier(true); return c;
      }).catch(function (e) {
        if (/recuperer_camion|function|404|PGRST/i.test(e.message || '')) throw new Error('Mets à jour Supabase (fichier v74) pour pouvoir récupérer.');
        throw new Error(message(e));
      });
    },
    retirer: function (uid, remettre) { return rpc('retirer_membre', { p_user: uid, p_actif: !!remettre }).then(membres).then(function () { notifier(true); }).catch(function (e) { throw new Error(message(e)); }); },
    ajouterFond: function (id, data) { return rpc('ajouter_fond', { p_id: id, p_data: data }).catch(function (e) { throw new Error(message(e)); }); },
    supprimerFond: function (id) { return rpc('supprimer_fond', { p_id: id }).catch(function () {}); },
    lireFond: function (id) {
      if (!rejoint()) return Promise.resolve(null);
      return session().then(function () { return http('/rest/v1/fonds_images?select=data&id=eq.' + encodeURIComponent(id)); })
        .then(function (l) { return l && l[0] ? l[0].data : null; }).catch(function () { return null; });
    },
    changerPrenom: function (p) {
      return rpc('changer_prenom', { p_prenom: nom(p) }).then(function () { st.prenom = nom(p); st.depuis = null; garder(); return lancer(); })
        .catch(function (e) { throw new Error(message(e)); });
    }
  };
})();
