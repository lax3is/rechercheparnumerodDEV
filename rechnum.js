// ==UserScript==
// @name         Odoo – Recherche Client par Téléphone (Many2one)
// @namespace    https://votre-domaine
// @version      1.9
// @description  Active la recherche "Téléphone/Mobile" automatiquement dans le champ Client des tickets Odoo.
// @match        *://*/web*
// @match        https://winprovence.odoo.com/*
// @match        http://winprovence.odoo.com/*
// @match        https://winprovence.odoo.com/*
// @match        http://winprovence.odoo.com/*
// @match        https://*/web*
// @match        http://*/web*
// @match        https://winprovence.odoo.com/*
// @match        https://*.odoo.com/*
// @match        https://winprovence.fr/*
// @match        http://winprovence.fr/*
// @match        https://*.winprovence.fr/*
// @match        http://*.winprovence.fr/*
// @match        https://www.winprovence.fr/*
// @match        http://www.winprovence.fr/*
// @match        https://winprovence.odoo.fr/*
// @match        http://winprovence.odoo.fr/*
// @match        http://winprovence.odoo.fr/*
// @updateURL    https://raw.githubusercontent.com/lax3is/rechercheparnumerodDEV/refs/heads/main/rechnum.js
// @downloadURL  https://raw.githubusercontent.com/lax3is/rechercheparnumerodDEV/refs/heads/main/rechnum.js
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Réglages
  const MIN_DIGITS = 3;                // minimum de chiffres pour déclencher la recherche
  const AUTOCLICK_DELAY_MS = 250;      // délai avant clic automatique
  const FORCE_HOTKEY = 'p';            // Alt+P force la recherche téléphone
  const TEL_PREFIX = 'tel:';           // saisir "tel:0494..." force la recherche
  const INTERNAL_INPUT_FLAG = 'tmTelInternal'; // drapeau pour ignorer les événements 'input' déclenchés par le script
  let THEME_STYLES_INJECTED = false;
  const MIN_SUGGEST_DIGITS = 5;        // afficher les suggestions à partir de 5 chiffres

  // Utilitaires
  const isDigitsLike = (s) => /^[+\d][\d .-]{2,}$/.test(s);
  const onlyDigitsPlus = (s) => (s || '').replace(/[^\d+]/g, '');

  function visibleMenus(root = document) {
    // Supporte anciens (jQuery UI) et nouveaux menus (OWL)
    const selectors = [
      'ul.ui-autocomplete',
      '.ui-menu',
      '.o-autocomplete--dropdown-menu',
      '.o-dropdown--menu',
    ];


    const nodes = selectors.flatMap((sel) => Array.from(root.querySelectorAll(sel)));
    return nodes.filter((el) => !!(el.offsetParent || el.getClientRects().length));
  }

  function findPhoneSuggestion(menus, query) {
    const rePhone = /(t(é|e)l(é|e)phone|mobile|phone)/i;
    const normQuery = onlyDigitsPlus(query);
    for (const ul of menus) {
      const items = Array.from(
        ul.querySelectorAll('li.ui-menu-item, .o_m2o_dropdown_option, .o_selection_item, li')
      );
      const found = items.find((li) => {
        const text = (li.textContent || '').trim();
        if (!rePhone.test(text)) return false;
        // Correspondance tolérante aux séparateurs (ex: '04.94' vs '0494')
        const normText = onlyDigitsPlus(text);
        return text.includes(query) || (!!normQuery && normText.includes(normQuery));
      });
      if (found) return found;
    }
    return null;
  }

  // -----------------------------
  // Styles - harmonisation visuelle avec Odoo
  // -----------------------------
  function ensureThemeStyles() {
    if (THEME_STYLES_INJECTED) return;
    THEME_STYLES_INJECTED = true;
    const style = document.createElement('style');
    style.setAttribute('data-tm', 'tel-helper-styles');
    style.textContent = `
      .tm-tel-helper-wrapper{
        display:flex; align-items:center; gap:8px; flex-wrap:wrap; position: relative;
      }
      .tm-tel-helper-wrapper .tm-tel-input{
        border-radius:8px; padding:6px 10px; min-width:220px; height:32px;
        background: var(--o-input-bg, var(--o-view-background-color, transparent));
        border: 1px solid var(--o-input-border-color, rgba(255,255,255,0.12));
        color: var(--o-text-color, inherit);
      }
      .tm-tel-helper-wrapper .tm-tel-input:focus{
        outline: none;
        box-shadow: 0 0 0 2px rgba(135,90,123,.35);
        border-color: var(--o-brand-primary, #875a7b);
      }
      .tm-tel-helper-wrapper .tm-tel-btn{
        border-radius:8px; padding:6px 12px;
        background: var(--o-brand-odoo, var(--o-brand-primary, #875a7b));
        border: 1px solid transparent; color: var(--o-button-text-color, #fff);
      }
      .tm-tel-helper-wrapper .tm-tel-btn:hover{
        filter: brightness(1.08);
      }
      .tm-tel-suggestions{
        position:absolute; left:0; top: calc(100% + 4px);
        background: var(--o-dropdown-menu-bg, var(--o-view-background-color, #1e1e2d));
        border: 1px solid var(--o-input-border-color, rgba(255,255,255,0.12));
        border-radius:8px; box-shadow: 0 6px 18px rgba(0,0,0,.25);
        max-height: 260px; overflow:auto; z-index: 10000; min-width: 260px;
      }
      .tm-tel-suggestion-item{
        padding:8px 10px; cursor: pointer; display:flex; align-items:center; justify-content:space-between; gap:10px;
      }
      .tm-tel-suggestion-item:hover{ background: rgba(135,90,123,.12); }
      .tm-tel-suggestion-name{ font-weight:600; }
      .tm-tel-suggestion-phone{ opacity:.8; font-size:.9em; }
    `;
    document.head.appendChild(style);
  }

  // -----------------------------
  // RPC Odoo direct (JSON-RPC)
  // -----------------------------
  function readCookie(name) {
    return (document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()[\]\\/+^])/g, '\\$1') + '=([^;]*)')) || [])[1] || '';
  }

  function getOdooContext() {
    const lang = decodeURIComponent(readCookie('frontend_lang') || 'fr_FR');
    const cids = (readCookie('cids') || '1')
      .split(',')
      .map((x) => parseInt(x.trim(), 10))
      .filter((n) => !isNaN(n));
    return {
      lang: lang || 'fr_FR',
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Paris',
      allowed_company_ids: cids.length ? cids : [1],
      bin_size: true,
      res_partner_search_mode: 'customer',
    };
  }

  function buildPhoneVariantsForSearch(raw) {
    const clean = (raw || '').trim();
    const digits = onlyDigitsPlus(clean);
    const variants = [];
    if (clean) variants.push(clean);

    const noPlusDigits = digits.replace(/[^\d]/g, '');
    if (noPlusDigits && !variants.includes(noPlusDigits)) variants.push(noPlusDigits);

    // Variante groupée par 2 (04 94 94 83 03)
    if (noPlusDigits.length >= 6) {
      const grouped = noPlusDigits.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
      if (!variants.includes(grouped)) variants.push(grouped);
    }

    // +33 <-> 0
    if (/^0\d{6,}$/.test(noPlusDigits)) {
      const alt = '+33 ' + noPlusDigits.slice(1).replace(/(\d{2})(?=\d)/g, '$1 ').trim();
      if (!variants.includes(alt)) variants.push(alt);
      const alt2 = '+33' + noPlusDigits.slice(1);
      if (!variants.includes(alt2)) variants.push(alt2);
    } else if (/^33\d{6,}$/.test(noPlusDigits)) {
      const alt = '0' + noPlusDigits.slice(2);
      const altGrouped = alt.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
      if (!variants.includes(alt)) variants.push(alt);
      if (!variants.includes(altGrouped)) variants.push(altGrouped);
    }
    return variants;
  }

  async function rpcSearchPartnerByPhone(phoneRaw, { limit = 20 } = {}) {
    const variants = buildPhoneVariantsForSearch(phoneRaw);
    const ctx = getOdooContext();
    const companyIds = ctx.allowed_company_ids && ctx.allowed_company_ids.length ? ctx.allowed_company_ids : [1];
    const companyId = companyIds[0];

    const url = `${location.origin}/web/dataset/call_kw/res.partner/web_search_read`;

    for (const q of variants) {
      const body = {
        id: Math.floor(Math.random() * 10000),
        jsonrpc: '2.0',
        method: 'call',
        params: {
          model: 'res.partner',
          method: 'web_search_read',
          args: [],
          kwargs: {
            limit,
            offset: 0,
            order: '',
            context: Object.assign({}, ctx, {
              default_name: false,
              default_email: false,
              default_phone: false,
            }),
            count_limit: 10001,
            domain: ['&', '|', ['company_id', '=', false], ['company_id', '=', companyId], ['phone_mobile_search', 'ilike', q]],
            fields: ['id', 'display_name', 'phone', 'mobile', 'email', 'is_company', 'parent_id'],
          },
        },
      };

      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
          credentials: 'same-origin',
        });
        if (!res.ok) continue;
        const json = await res.json();
        const records = (((json || {}).result || {}).records) || [];
        if (records.length) return { query: q, records };
      } catch (_) {
        // ignore this variant and try next
      }
    }
    return { query: phoneRaw, records: [] };
  }

  // -----------------------------
  // UI - suggestions sur le champ téléphone
  // -----------------------------
  function getOrCreateDropdown(telInput) {
    let dd = telInput._tmDropdown;
    if (dd && dd.isConnected) return dd;
    dd = document.createElement('div');
    dd.className = 'tm-tel-suggestions';
    dd.style.display = 'none';
    telInput._tmDropdown = dd;
    const wrapper = telInput.closest('.tm-tel-helper-wrapper') || telInput.parentElement;
    wrapper && wrapper.appendChild(dd);
    return dd;
  }

  function hideDropdown(telInput) {
    const dd = telInput && telInput._tmDropdown;
    if (dd) dd.style.display = 'none';
  }

  function renderSuggestions(telInput, records, targetInput) {
    const dd = getOrCreateDropdown(telInput);
    dd.innerHTML = '';
    if (!records || records.length === 0) {
      dd.style.display = 'none';
      return;
    }
    const width = Math.max(260, telInput.offsetWidth);
    dd.style.minWidth = width + 'px';
    records.slice(0, 20).forEach((r) => {
      const item = document.createElement('div');
      item.className = 'tm-tel-suggestion-item';
      const name = document.createElement('div');
      name.className = 'tm-tel-suggestion-name';
      name.textContent = r.display_name || 'Client';
      const phone = document.createElement('div');
      phone.className = 'tm-tel-suggestion-phone';
      phone.textContent = r.phone || r.mobile || '';
      item.appendChild(name);
      item.appendChild(phone);
      item.addEventListener('click', async () => {
        await selectPartnerInMany2One(targetInput, r);
        hideDropdown(telInput);
      });
      dd.appendChild(item);
    });
    dd.style.display = 'block';
  }

  function attachTelInputSuggestions(telInput, targetInput) {
    if (telInput.dataset.tmSuggestAttached) return;
    telInput.dataset.tmSuggestAttached = '1';
    let t;
    telInput.addEventListener('input', () => {
      const value = (telInput.value || '').trim();
      const num = onlyDigitsPlus(value).replace(/\D/g, '');
      if (num.length >= MIN_SUGGEST_DIGITS) {
        clearTimeout(t);
        t = setTimeout(async () => {
          try {
            const { records } = await rpcSearchPartnerByPhone(value, { limit: 30 });
            renderSuggestions(telInput, records, targetInput);
          } catch (_) {
            hideDropdown(telInput);
          }
        }, 200);
      } else {
        hideDropdown(telInput);
      }
    });
    // cacher à l'extérieur
    document.addEventListener('click', (e) => {
      const dd = telInput._tmDropdown;
      if (!dd) return;
      const inside = dd.contains(e.target) || telInput.contains(e.target);
      if (!inside) hideDropdown(telInput);
    });
    // Enter sélectionne le premier
    telInput.addEventListener('keydown', async (e) => {
      if (e.key === 'Enter') {
        const dd = telInput._tmDropdown;
        const first = dd && dd.querySelector('.tm-tel-suggestion-item');
        if (first) {
          e.preventDefault();
          first.click();
        }
      } else if (e.key === 'Escape') {
        hideDropdown(telInput);
      }
    });
  }

  function findPartnerMenuItemByIdOrName(menus, partner) {
    for (const ul of menus) {
      const items = Array.from(
        ul.querySelectorAll('li.ui-menu-item, .o_m2o_dropdown_option, .o_selection_item, li')
      );
      let match = items.find((li) => {
        const idAttr = li.getAttribute('data-record-id') || li.getAttribute('data-id');
        if (idAttr && String(idAttr) === String(partner.id)) return true;
        const text = (li.textContent || '').trim();
        return text.includes(partner.display_name);
      });
      if (match) return match;
    }
    return null;
  }

  function findFirstRecordItem(menus) {
    const isOption = (text) =>
      /(rechercher|search|créer|create|modifier|edit)/i.test((text || '').toLowerCase());
    for (const ul of menus) {
      const items = Array.from(ul.querySelectorAll('li, .o_selection_item, .ui-menu-item'));
      for (const li of items) {
        const text = (li.textContent || '').trim();
        if (!text || isOption(text)) continue;
        // éliminer les lignes de titre/administration
        if (/^(administrateur|administrator)/i.test(text)) continue;
        return li;
      }
    }
    return null;
  }

  async function selectPartnerInMany2One(input, partner) {
    input.focus();
    input.value = partner.display_name;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // Forcer l'ouverture du dropdown (OWL) pour permettre le clic auto
    try {
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 }));
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 }));
    } catch (_) {}
    // Attendre l'ouverture du menu puis cliquer sur l'option correspondant à l'id/nom
    let tries = 0;
    while (tries++ < 25) {
      const menus = visibleMenus();
      const item = findPartnerMenuItemByIdOrName(menus, partner);
      if (item) {
        const candidates = [item, ...Array.from(item.querySelectorAll('a,button,div,span'))];
        const prefer = candidates
          .map((el) => ({ el, text: ((el.textContent || '')).trim() }))
          .filter((x) => x.text && x.text.includes(partner.display_name) && !/SPEEK_/i.test(x.text))
          .sort((a, b) => a.text.length - b.text.length)[0];
        const target = (prefer && prefer.el) || item.querySelector('a,button,div,span') || item;
        const evOpts = { bubbles: true, cancelable: true };
        target.dispatchEvent(new MouseEvent('mousedown', evOpts));
        target.dispatchEvent(new MouseEvent('mouseup', evOpts));
        target.dispatchEvent(new MouseEvent('click', evOpts));
        return true;
      }
      // Si on ne trouve pas exactement l'item, sélectionner la première ligne de résultat non-option
      const firstRecord = findFirstRecordItem(menus);
      if (firstRecord) {
        const target = firstRecord.querySelector('a,button,div,span') || firstRecord;
        const evOpts = { bubbles: true, cancelable: true };
        target.dispatchEvent(new MouseEvent('mousedown', evOpts));
        target.dispatchEvent(new MouseEvent('mouseup', evOpts));
        target.dispatchEvent(new MouseEvent('click', evOpts));
        return true;
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    return false;
  }

  function clickSearchMoreFromDropdown(input) {
    // Ouvre le menu du many2one puis clique "Recherche avancée..."
    input.focus();
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    let attempts = 0;
    return new Promise((resolve) => {
      const t = setInterval(() => {
        attempts++;
        const menus = visibleMenus(document);
        let item = null;
        for (const ul of menus) {
          const lis = Array.from(ul.querySelectorAll('li, .o_m2o_dropdown_option'));
          item =
            lis.find((li) => /recherche avanc|search more/i.test((li.textContent || '').toLowerCase())) ||
            null;
          if (item) break;
        }
        if (item) {
          const target = item.querySelector('a,button,div,span') || item;
          const evOpts = { bubbles: true, cancelable: true };
          target.dispatchEvent(new MouseEvent('mousedown', evOpts));
          target.dispatchEvent(new MouseEvent('mouseup', evOpts));
          target.dispatchEvent(new MouseEvent('click', evOpts));
          clearInterval(t);
          resolve(true);
        } else if (attempts > 15) {
          clearInterval(t);
          resolve(false);
        }
      }, 120);
    });
  }

  function getActiveModalRoot() {
    const candidates = Array.from(
      document.querySelectorAll(
        '.modal.show, .modal.in, .o_dialog_container .modal, .o_dialog, .o_modal'
      )
    );
    return candidates.find((el) => !!(el.offsetParent || el.getClientRects().length)) || null;
  }

  async function openAdvancedAndApplyPhoneFilter(query, targetInput) {
    const active = targetInput || document.activeElement;
    if (!active || !(active instanceof HTMLInputElement)) return false;
    const opened = await clickSearchMoreFromDropdown(active);
    if (!opened) return false;

    // Attendre l'ouverture de la modale
    let tries = 0;
    let modal = null;
    while (tries++ < 25 && !(modal = getActiveModalRoot())) {
      await new Promise((r) => setTimeout(r, 120));
    }
    if (!modal) return false;

    // Trouver la barre de recherche dans la modale
    const searchInput =
      modal.querySelector('input.o_searchview_input') ||
      modal.querySelector('.o_searchview input[type="text"]') ||
      modal.querySelector('input[type="search"]') ||
      modal.querySelector('input[type="text"]');
    if (!searchInput) return false;

    // Saisir la requête
    searchInput.focus();
    searchInput.value = query;
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));

    // Chercher et cliquer l'option "Téléphone/Mobile pour: ..."
    tries = 0;
    while (tries++ < 25) {
      // Important: l'autocomplete est souvent attaché au body, pas à la modale
      const menus = visibleMenus(document);
      const phoneItem = findPhoneSuggestion(menus, query);
      if (phoneItem) {
        const target = phoneItem.querySelector('a,button,div,span') || phoneItem;
        const evOpts = { bubbles: true, cancelable: true };
        target.dispatchEvent(new MouseEvent('mousedown', evOpts));
        target.dispatchEvent(new MouseEvent('mouseup', evOpts));
        target.dispatchEvent(new MouseEvent('click', evOpts));
        return true;
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    return false;
  }

  function isClientMany2OneInput(input) {
    const widget = input.closest('.o_field_many2one, .o_field_widget');
    if (!widget) return false;
    // Inspecter les attributs de champ sur le widget et ses ancêtres proches
    const attrNames = ['name', 'data-name', 'data-field-name', 'data-oe-field', 'data-field'];
    let el = widget;
    for (let depth = 0; depth < 3 && el; depth++, el = el.parentElement) {
      for (const a of attrNames) {
        const v = el.getAttribute && el.getAttribute(a);
        if (v === 'partner_id' || v === 'commercial_partner_id') return true;
      }
    }
    // Tentative via attributs de l'input
    const inputName =
      input.getAttribute('name') || input.getAttribute('aria-label') || input.getAttribute('id') || '';
    if (/(^|[_-])(partner_id|commercial_partner_id)(_|-|$)/i.test(inputName)) return true;
    if ((input.getAttribute('aria-label') || '').toLowerCase().includes('client')) return true;

    // Heuristique par libellé voisin "Client"
    const labelRegex = /\bclient\b/i;
    const prev = widget.previousElementSibling;
    if (prev && labelRegex.test((prev.textContent || '').trim())) return true;
    const container =
      widget.closest('.o_form_sheet, .o_form_view, .o_group, .o_row, .o_group_col') ||
      widget.parentElement;
    if (container) {
      const labels = Array.from(container.querySelectorAll('label, .o_form_label, .o_form_label_help'));
      // Chercher un label "Client" situé avant le widget dans le DOM
      for (const lab of labels) {
        if (!labelRegex.test((lab.textContent || '').trim())) continue;
        if (lab.compareDocumentPosition(widget) & Node.DOCUMENT_POSITION_FOLLOWING) {
          // Même conteneur et label placé avant le widget
          return true;
        }
      }
    }
    return false;
  }

  function ensurePhoneSearchUI(widget, input) {
    if (widget.dataset.tmTelUiAttached) return;
    widget.dataset.tmTelUiAttached = '1';

    ensureThemeStyles();
    const wrapper = document.createElement('div');
    wrapper.className = 'tm-tel-helper-wrapper';
    wrapper.style.marginTop = '6px';
    wrapper.style.display = 'flex';
    wrapper.style.gap = '6px';

    const telInput = document.createElement('input');
    telInput.type = 'text';
    telInput.placeholder = 'n° téléphone';
    telInput.title = 'Rechercher par téléphone (+33, espaces et points acceptés)';
    telInput.style.width = '220px';
    telInput.style.padding = '2px 6px';
    telInput.style.fontSize = '12px';
    telInput.className = 'tm-tel-helper-input o_input';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Rech. tel';
    btn.style.fontSize = '12px';
    btn.style.padding = '2px 6px';
    btn.className = 'tm-tel-btn btn btn-primary';

    const doSearch = () => {
      const q = (telInput.value || '').trim();
      if (!q) return;
      // Recherche directe via RPC puis sélection dans la liste déroulante
      rpcSearchPartnerByPhone(q, { limit: 20 })
        .then(async ({ records }) => {
          if (records && records.length) {
            const chosen = records[0];
            await selectPartnerInMany2One(input, chosen);
          }
        })
        .catch(() => {});
    };
    btn.addEventListener('click', doSearch);
    telInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSearch();
      }
    });

    wrapper.appendChild(telInput);
    wrapper.appendChild(btn);
    // Insérer SOUS le champ Client, dans la zone Odoo .o_field_many2one_extra
    let host =
      widget.querySelector('.o_field_many2one_extra') ||
      (widget.parentElement && widget.parentElement.querySelector('.o_field_many2one_extra'));
    if (!host) {
      host = document.createElement('div');
      host.className = 'o_field_many2one_extra';
      widget.appendChild(host);
    }
    host.appendChild(wrapper);

    // Suggestions sur saisie
    attachTelInputSuggestions(telInput, input);

    // Si une UI flottante existe déjà, la retirer pour éviter la duplication
    removeFloatingPhoneUI();
  }

  function ensurePhoneSearchUIAtBottom(root = document) {
    const input = findClientInput(root);
    if (!input) return;

    ensureThemeStyles();
    const wrapper = document.createElement('div');
    wrapper.className = 'tm-tel-helper-wrapper';
    wrapper.style.marginTop = '12px';
    wrapper.style.display = 'flex';
    wrapper.style.gap = '6px';

    const telInput = document.createElement('input');
    telInput.type = 'text';
    telInput.placeholder = 'n° téléphone';
    telInput.title = 'Rechercher par téléphone (+33, espaces et points acceptés)';
    telInput.style.width = '220px';
    telInput.style.padding = '2px 6px';
    telInput.style.fontSize = '12px';
    telInput.className = 'tm-tel-helper-input o_input';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Rech. tel';
    btn.style.fontSize = '12px';
    btn.style.padding = '2px 6px';
    btn.className = 'tm-tel-btn btn btn-primary';

    const doSearch = () => {
      const q = (telInput.value || '').trim();
      if (!q) return;
      rpcSearchPartnerByPhone(q, { limit: 20 })
        .then(async ({ records }) => {
          if (records && records.length) {
            const chosen = records[0];
            await selectPartnerInMany2One(input, chosen);
          }
        })
        .catch(() => {});
    };
    btn.addEventListener('click', doSearch);
    telInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSearch();
      }
    });

    wrapper.appendChild(telInput);
    wrapper.appendChild(btn);

    const sheet =
      root.querySelector('.o_form_sheet') ||
      root.querySelector('.o_form_sheet_bg') ||
      root.querySelector('.o_form_view') ||
      document.body;
    sheet.appendChild(wrapper);
    removeFloatingPhoneUI();

    // Suggestions sur saisie
    attachTelInputSuggestions(telInput, input);
  }

  function cleanupWrongHelpers() {
    const helpers = Array.from(document.querySelectorAll('.tm-tel-helper-input'));
    helpers.forEach((inp) => {
      const widget = inp.closest('.o_field_many2one, .o_field_widget');
      const relatedInput = widget ? widget.querySelector('input') : null;
      if (!relatedInput || !isClientMany2OneInput(relatedInput)) {
        const container = inp.parentElement;
        if (container) container.remove();
        else inp.remove();
      }
    });
  }

  function ensureUIByClientLabel(root = document) {
    // Ne pas court-circuiter si une UI flottante existe; on veut injecter localement et la retirer ensuite

    // Ciblage direct par id 'partner_id' si présent (Odoo ajoute souvent cet id)
    const byIdInput = root.querySelector('input#partner_id');
    if (byIdInput) {
      const byIdWidget = byIdInput.closest('.o_field_many2one, .o_field_widget');
      if (byIdWidget) {
        ensurePhoneSearchUI(byIdWidget, byIdInput);
        attachToInput(byIdInput);
        removeFloatingPhoneUI();
        return;
      }
    }

    const labels = Array.from(root.querySelectorAll('label, .o_form_label, .o_form_label_help'));
    const clientLabels = labels.filter((l) => /^client$/i.test((l.textContent || '').trim()));
    for (const lab of clientLabels) {
      const row =
        lab.closest('.o_row, .o_form_sheet, .o_group, .o_group_col') || lab.parentElement;
      if (!row) continue;
      const widget = row.querySelector('.o_field_many2one');
      const input = widget && widget.querySelector('input');
      if (widget && input) {
        ensurePhoneSearchUI(widget, input);
        attachToInput(input); // s'assurer des listeners
        removeFloatingPhoneUI();
        return;
      }
    }
  }

  function findClientInput(root = document) {
    const selectors = [
      'input#partner_id',
      '.o_field_many2one[name="partner_id"] input',
      '.o_field_widget[name="partner_id"] input',
      '.o_field_many2one[data-name="partner_id"] input',
      '.o_field_widget[data-name="partner_id"] input',
      '.o_field_many2one[data-field-name="partner_id"] input',
      '.o_field_widget[data-field-name="partner_id"] input',
      '.o_field_many2one[data-oe-field="partner_id"] input',
      '.o_field_widget[data-oe-field="partner_id"] input',
      '.o_field_many2one[data-field="partner_id"] input',
      '.o_field_widget[data-field="partner_id"] input',
    ];
    for (const sel of selectors) {
      const el = root.querySelector(sel);
      if (el) return el;
    }
    const labels = Array.from(root.querySelectorAll('label, .o_form_label, .o_form_label_help'));
    const lab = labels.find((l) => /^client$/i.test((l.textContent || '').trim()));
    if (lab) {
      const container =
        lab.closest('.o_row, .o_group, .o_group_col, .o_form_sheet, .o_form_view') ||
        lab.parentElement;
      if (container) {
        const cand = container.querySelector('.o_field_many2one input');
        if (cand) return cand;
      }
    }
    return null;
  }

  function ensureFloatingPhoneUI() {
    // Ne pas créer si un helper local existe déjà
    if (!isTicketFormContext()) return;
    if (document.querySelector('.tm-tel-helper-input')) return;
    if (document.getElementById('tm-tel-floating')) return;
    const box = document.createElement('div');
    box.id = 'tm-tel-floating';
    box.style.position = 'fixed';
    box.style.top = '96px';
    box.style.right = '16px';
    box.style.zIndex = '9999';
    box.style.display = 'flex';
    box.style.gap = '6px';
    box.style.background = 'rgba(0,0,0,0.25)';
    box.style.padding = '6px';
    box.style.borderRadius = '6px';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'n° téléphone';
    input.style.width = '160px';
    input.style.padding = '2px 6px';
    input.style.fontSize = '12px';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Rech. tel';
    btn.style.fontSize = '12px';
    btn.style.padding = '2px 6px';

    const doSearch = () => {
      const q = (input.value || '').trim();
      if (!q) return;
      const clientInput = findClientInput(document);
      if (!clientInput) return;
      clientInput.focus();
      rpcSearchPartnerByPhone(q, { limit: 20 })
        .then(async ({ records }) => {
          if (records && records.length) {
            const chosen = records[0];
            await selectPartnerInMany2One(clientInput, chosen);
          }
        })
        .catch(() => {});
    };

    btn.addEventListener('click', doSearch);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        doSearch();
      }
    });

    box.appendChild(input);
    box.appendChild(btn);
    document.body.appendChild(box);
  }

  function removeFloatingPhoneUI() {
    const el = document.getElementById('tm-tel-floating');
    if (el && el.parentElement) el.parentElement.removeChild(el);
  }

  function isTicketFormContext() {
    try {
      const hash = (location.hash || '').replace(/^#/, '');
      const params = new URLSearchParams(hash);
      const model = params.get('model') || '';
      const viewType = (params.get('view_type') || '').toLowerCase();
      return model === 'helpdesk.ticket' && (viewType === '' || viewType === 'form');
    } catch (_) {
      return false;
    }
  }

  // Alias: certaines parties du bridge utilisent ce nom
  function isHelpdeskTicketFormRoute() {
    return isTicketFormContext();
  }

  function cleanupAllHelpers() {
    Array.from(document.querySelectorAll('.tm-tel-helper-wrapper')).forEach((el) => {
      if (el && el.parentElement) el.parentElement.removeChild(el);
    });
    Array.from(document.querySelectorAll('.tm-tel-helper-input')).forEach((el) => {
      const p = el && el.parentElement;
      if (p && p.parentElement) p.parentElement.removeChild(p);
      else if (el && el.parentElement) el.parentElement.removeChild(el);
    });
    removeFloatingPhoneUI();
  }
  async function autoSelectFirstResult() {
    let tries = 0;
    while (tries++ < 25) {
      const modal = getActiveModalRoot();
      if (modal) {
        const row =
          modal.querySelector('tr.o_data_row') ||
          modal.querySelector('.o_list_view tbody tr') ||
          modal.querySelector('.o_kanban_record') ||
          null;
        if (row) {
          const target = row.querySelector('td,div,span') || row;
          const evOpts = { bubbles: true, cancelable: true };
          target.dispatchEvent(new MouseEvent('mousedown', evOpts));
          target.dispatchEvent(new MouseEvent('mouseup', evOpts));
          target.dispatchEvent(new MouseEvent('click', evOpts));
          return true;
        }
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    return false;
  }

  function triggerPhoneSearch(input, rawValue) {
    const raw = (((rawValue ?? input.value) || '')).trim();
    let query = raw;

    // Forcer via préfixe "tel:" si saisi
    if (raw.toLowerCase().startsWith(TEL_PREFIX)) {
      query = raw.slice(TEL_PREFIX.length);
    } else if (!isDigitsLike(raw)) {
      return; // pas un numéro plausible
    }

    const digits = onlyDigitsPlus(query);
    const digitCount = digits.replace(/\D/g, '').length;
    if (digitCount < MIN_DIGITS) return;

    // Prépare des variantes FR: "0494..." <-> "+33494..."
    const variants = [query];
    if (/^0\d{6,}$/.test(digits)) {
      const alt = '+33' + digits.slice(1);
      if (!variants.includes(alt)) variants.push(alt);
    } else if (/^\+33\d{6,}$/.test(digits)) {
      const alt = '0' + digits.slice(3);
      if (!variants.includes(alt)) variants.push(alt);
    }

    // Ouvre/rafraîchit la liste
    input.focus();
    // Marquer l'événement comme interne pour éviter la boucle sur notre propre écouteur 'input'
    input.dataset[INTERNAL_INPUT_FLAG] = '1';
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ' ' }));
    input.dispatchEvent(new Event('input', { bubbles: true }));
    // Retirer le drapeau au prochain tick
    setTimeout(() => { try { delete input.dataset[INTERNAL_INPUT_FLAG]; } catch (_) {} }, 0);

    // Cherche et clique la suggestion "Téléphone/Mobile"
    let attempts = 0;
    let variantIdx = 0;
    const timer = setInterval(() => {
      attempts++;
      // Toutes les quelques tentatives, essayer l'autre variante (+33 ou 0)
      if (variants.length > 1 && attempts % 6 === 0) {
        variantIdx = (variantIdx + 1) % variants.length;
        const v = variants[variantIdx];
        if (typeof v === 'string' && v.length) {
          input.dataset[INTERNAL_INPUT_FLAG] = '1';
          input.value = v;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          setTimeout(() => { try { delete input.dataset[INTERNAL_INPUT_FLAG]; } catch (_) {} }, 0);
        }
      }
      const currentQuery = (input.value || '').trim();
      const menus = visibleMenus();
      const phoneItem = findPhoneSuggestion(menus, currentQuery);
      if (phoneItem) {
        phoneItem.click();
        clearInterval(timer);
      } else if (attempts > 18) {
        clearInterval(timer);
        // Fallback sans ouvrir la modale: appel RPC direct et sélection dans la liste déroulante
        rpcSearchPartnerByPhone(currentQuery, { limit: 20 })
          .then(async ({ records }) => {
            if (records && records.length) {
              // sélectionner le premier résultat
              const chosen = records[0];
              await selectPartnerInMany2One(input, chosen);
              return;
            }
            // Si aucun résultat RPC, ne pas ouvrir la modale pour respecter la consigne utilisateur
            // (laisser l'utilisateur ajuster la saisie)
          })
          .catch(() => {});
      }
    }, 120);
  }

  function attachToInput(input) {
    if (input.dataset.tmTelAttached) return;
    input.dataset.tmTelAttached = '1';

    // Ajouter mini-UI de recherche par numéro mais uniquement pour le champ Client
    if (isClientMany2OneInput(input)) {
      const widget = input.closest('.o_field_many2one, .o_field_widget');
      if (widget) ensurePhoneSearchUI(widget, input);
    }

    let t;
    input.addEventListener('input', () => {
      // Ignorer les événements 'input' que nous générons nous-mêmes
      if (input.dataset[INTERNAL_INPUT_FLAG] === '1') return;
      if (!isClientMany2OneInput(input)) return;
      const v = input.value.trim();
      if (!v) return;
      // auto-déclenchement si on tape des chiffres
      if (isDigitsLike(v)) {
        clearTimeout(t);
        t = setTimeout(() => triggerPhoneSearch(input, v), AUTOCLICK_DELAY_MS);
      }
    });

    // Raccourci Alt+P pour forcer
    input.addEventListener('keydown', (e) => {
      if (e.altKey && e.key.toLowerCase() === FORCE_HOTKEY) {
        if (!isClientMany2OneInput(input)) return;
        e.preventDefault();
        triggerPhoneSearch(input);
      }
    });
  }

  function scanAndAttach(root = document) {
    // Injecter uniquement si un champ Client (partner_id) est présent dans la vue
    if (!findClientInput(document)) {
      cleanupAllHelpers();
      return;
    }
    // Retirer l'UI flottante si elle existe encore
    removeFloatingPhoneUI();
    const inputs = Array.from(
      root.querySelectorAll('.o_field_many2one input, .o_field_widget.o_field_many2one input')
    );
    inputs.forEach((inp) => {
      // Les inputs many2one d’Odoo sont souvent en mode combobox
      const isCombo =
        inp.getAttribute('role') === 'combobox' ||
        inp.classList.contains('ui-autocomplete-input') ||
        inp.classList.contains('o_input');
      if (isCombo && isClientMany2OneInput(inp)) attachToInput(inp);
    });
    // Nettoyer d'éventuels champs injectés au mauvais endroit
    cleanupWrongHelpers();
    // En dernier recours, injecter via libellé "Client"
    ensureUIByClientLabel(root);
    // Si l'aide n'a pas été créée, placer en bas du formulaire
    if (!document.querySelector('.tm-tel-helper-input')) {
      ensurePhoneSearchUIAtBottom(root);
    }
  }

  // Lancement initial + observation du DOM (changement de formulaire/onglet)
  scanAndAttach();
  window.addEventListener('hashchange', () => {
    // Navigation Odoo: re-scan au changement d'URL
    scanAndAttach();
  });
  const mo = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.addedNodes && m.addedNodes.length) {
        m.addedNodes.forEach((n) => {
          if (n.nodeType === 1) scanAndAttach(n);
        });
      }
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // -----------------------------
  // Bridge Speek → Odoo (sans serveur)
  // Objectif:
  // - fallback URL: lire #phone/#team/#subject et remplir
  // - mode direct: sur F8, attendre un collage JSON (Ctrl+V) depuis l'app Windows,
  //   puis remplir Client + Équipe + Subject.
  // -----------------------------
  const BRIDGE_FKEY = 8; // F8
  const PENDING_KEY = 'tm_speek_payload';

  function keepReadyTag() {
    try {
      const ready =
        isHelpdeskTicketFormRoute() &&
        isClientFieldEmpty() &&
        !!findClientInput(document) &&
        !!(
          document.querySelector('.o_field_widget[name="name"] input') ||
          document.querySelector('.o_field_widget[name="name"] textarea') ||
          document.querySelector('input[name="name"]')
        ) &&
        !!(
          document.querySelector('.o_field_widget[name="team_id"] input') ||
          document.querySelector('.o_field_widget[name="team_id"] textarea') ||
          document.querySelector('input[name="team_id"]')
        );

      const cur = document.title || '';
      const has = cur.includes('SPEEK_READY');
      if (ready && !has) {
        const base = cur.replace(/\s*\|\s*SPEEK_(ARMED|READY|PAGE_OK|OK)(:[a-z0-9]+)?/ig, '').trim();
        document.title = base ? `${base} | SPEEK_READY` : 'SPEEK_READY';
      } else if (!ready && has) {
        document.title = cur.replace(/\s*\|\s*SPEEK_READY\b/ig, '').trim();
      }
    } catch (_) {}
  }

  // Keep READY resilient to Odoo title rewrites / slow PCs
  // (plus léger pour PC lents)
  setInterval(keepReadyTag, 1000);

  function extractBridgePayloadFromHash() {
    try {
      const hash = (location.hash || '').replace(/^#/, '');
      const params = new URLSearchParams(hash);
      const phone = (params.get('phone') || params.get('tel') || '').trim();
      const team = (params.get('team') || '').trim();
      const subject = (params.get('subject') || '').trim();
      if (!phone && !team && !subject) return null;
      return { phone, team, subject };
    } catch (_) {
      return null;
    }
  }

  function clearBridgePayloadFromHash() {
    try {
      const hash = (location.hash || '').replace(/^#/, '');
      const params = new URLSearchParams(hash);
      params.delete('phone');
      params.delete('tel');
      params.delete('team');
      params.delete('subject');
      const newHash = params.toString();
      const url = location.pathname + location.search + (newHash ? '#' + newHash : '');
      history.replaceState(null, '', url);
    } catch (_) {
      // ignore
    }
  }

  function safeJsonParse(text) {
    try {
      const v = JSON.parse(text);
      if (!v || typeof v !== 'object') return null;
      return v;
    } catch (_) {
      return null;
    }
  }

  function setPendingPayload(p) {
    try {
      sessionStorage.setItem(PENDING_KEY, JSON.stringify(p));
    } catch (_) {}
  }

  function getPendingPayload() {
    try {
      const raw = sessionStorage.getItem(PENDING_KEY) || '';
      return raw ? safeJsonParse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function clearPendingPayload() {
    try {
      sessionStorage.removeItem(PENDING_KEY);
    } catch (_) {}
  }

  function tryPasteIntoTelHelperAndSearch(phone) {
    const telInput = document.querySelector('input.tm-tel-helper-input');
    if (!(telInput instanceof HTMLInputElement)) return false;

    telInput.focus();
    telInput.value = phone;
    telInput.dispatchEvent(new Event('input', { bubbles: true }));

    const wrapper = telInput.closest('.tm-tel-helper-wrapper') || telInput.parentElement;
    const btn = wrapper && wrapper.querySelector('button.tm-tel-btn');
    if (btn instanceof HTMLButtonElement) {
      btn.click();
      return true;
    }

    // fallback: Enter (ton script écoute déjà Enter sur ce champ)
    try {
      telInput.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'Enter',
          code: 'Enter',
          keyCode: 13,
          which: 13,
          bubbles: true,
        })
      );
      return true;
    } catch (_) {
      return false;
    }
  }

  function isClientFieldEmpty() {
    try {
      const clientInput =
        document.querySelector('input#partner_id') ||
        document.querySelector('.o_field_widget[name="partner_id"] input') ||
        document.querySelector('.o_field_many2one[name="partner_id"] input') ||
        null;
      if (!(clientInput instanceof HTMLInputElement)) return true;
      return !(clientInput.value || '').trim();
    } catch (_) {
      return true;
    }
  }

  function setSubject(subject) {
    const s = (subject || '').trim();
    if (!s) return false;
    const el =
      document.querySelector('.o_field_widget[name="name"] input') ||
      document.querySelector('.o_field_widget[name="name"] textarea') ||
      document.querySelector('input[name="name"]') ||
      null;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) return false;
    el.focus();
    el.value = s;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }

  async function setTeamByText(teamText) {
    const t = (teamText || '').trim();
    if (!t) return false;
    const input =
      document.querySelector('.o_field_widget[name="team_id"] input') ||
      document.querySelector('.o_field_many2one[name="team_id"] input') ||
      document.querySelector('input[name="team_id"]') ||
      null;
    if (!(input instanceof HTMLInputElement)) return false;

    input.focus();
    input.value = t;
    input.dispatchEvent(new Event('input', { bubbles: true }));

    // attendre menu, puis cliquer option qui contient le texte
    let tries = 0;
    while (tries++ < 20) {
      const menus = visibleMenus(document);
      for (const ul of menus) {
        const items = Array.from(
          ul.querySelectorAll('li.ui-menu-item, .o_m2o_dropdown_option, .o_selection_item, li')
        );
        const found = items.find((li) =>
          ((li.textContent || '').trim().toLowerCase()).includes(t.toLowerCase())
        );
        if (found) {
          const target = found.querySelector('a,button,div,span') || found;
          target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
          target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
          target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
          return true;
        }
      }
      await new Promise((r) => setTimeout(r, 120));
    }
    // fallback: Enter
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter', code: 'Enter', keyCode: 13, which: 13 }));
    return true;
  }

  async function applyBridgePayloadOnce(payload) {
    const phone = (
      payload && (payload.Phone ?? payload.phone ?? payload.tel ?? payload.telephone) != null
        ? String(payload.Phone ?? payload.phone ?? payload.tel ?? payload.telephone)
        : ''
    ).trim();
    const team = (payload && payload.Team ? String(payload.Team) : payload.team ? String(payload.team) : '').trim();
    const subject = (payload && payload.Subject ? String(payload.Subject) : payload.subject ? String(payload.subject) : '').trim();
    const token = (payload && (payload.Token ?? payload.token) != null ? String(payload.Token ?? payload.token) : '').trim();
    if (!phone && !team && !subject) return;

    // Mode clinique: ne rien faire si on n'est pas sur le bon formulaire
    if (!isHelpdeskTicketFormRoute()) {
      if (payload) setPendingPayload(payload);
      return;
    }

    // Ne jamais écraser un ticket en cours: uniquement si Client vide
    if (!isClientFieldEmpty()) {
      clearPendingPayload();
      clearBridgePayloadFromHash();
      return;
    }

    function keepTitleTag(tag, ms) {
      try {
        const start = Date.now();
        const tick = () => {
          try {
            const cur = document.title || '';
            if (!cur.includes(tag)) {
              const base = cur.replace(/\s*\|\s*SPEEK_(ARMED|PAGE_OK|OK)(:[a-z0-9]+)?/ig, '').trim();
              document.title = base ? `${base} | ${tag}` : tag;
            }
          } catch (_) {}
          if (Date.now() - start >= ms) clearInterval(id);
        };
        tick();
        const id = setInterval(tick, 120);
        setTimeout(() => { try { clearInterval(id); } catch (_) {} }, ms + 200);
      } catch (_) {}
    }

    function setTitleAck(kind) {
      const tag = token ? `SPEEK_${kind}:${token}` : `SPEEK_${kind}`;
      keepTitleTag(tag, 3500);
    }

    // ACK rapide via document.title (évite d'écrire dans le presse-papier)
    if (isHelpdeskTicketFormRoute() && isClientFieldEmpty()) {
      setTitleAck('PAGE_OK');
    }

    // attendre que TON champ soit injecté, puis appliquer
    const start = Date.now();
    while (Date.now() - start < 12000) {
      scanAndAttach();
      // Vérifications strictes: si un champ est introuvable, ne rien faire maintenant
      const clientInput = findClientInput(document);
      const clientOk = !phone || !!clientInput;
      const subjectOk = !subject || !!(
        document.querySelector('.o_field_widget[name="name"] input') ||
        document.querySelector('.o_field_widget[name="name"] textarea') ||
        document.querySelector('input[name="name"]')
      );
      const teamOk = !team || !!(
        document.querySelector('.o_field_widget[name="team_id"] input') ||
        document.querySelector('.o_field_widget[name="team_id"] textarea') ||
        document.querySelector('input[name="team_id"]')
      );
      const phoneOk = !phone || !!document.querySelector('input.tm-tel-helper-input') || !!clientInput;

      if (!clientOk || !subjectOk || !teamOk || !phoneOk) {
        if (payload) setPendingPayload(payload);
        await new Promise((r) => setTimeout(r, 250));
        continue;
      }

      // 1) subject
      if (subject) setSubject(subject);
      // 2) team
      if (team) await setTeamByText(team);
      // 3) phone -> client
      if (phone && clientInput) {
        let selected = false;
        try {
          const { records } = await rpcSearchPartnerByPhone(phone, { limit: 20 });
          if (records && records.length) {
            selected = await selectPartnerInMany2One(clientInput, records[0]);
          }
        } catch (_) {}

        // Fallback: helper UI if present
        if (!selected) {
          try {
            selected = tryPasteIntoTelHelperAndSearch(phone);
          } catch (_) {}
        }

        if (selected) {
          // Attendre que le champ Client soit réellement rempli (sinon pas d'ACK)
          const t0 = Date.now();
          while (Date.now() - t0 < 6000 && isClientFieldEmpty()) {
            await new Promise((r) => setTimeout(r, 150));
          }

          // Nettoyage: si un tag SPEEK s'est glissé dans l'affichage, on le retire sans toucher l'id sélectionné
          try {
            const ci =
              document.querySelector('input#partner_id') ||
              document.querySelector('.o_field_widget[name="partner_id"] input') ||
              document.querySelector('.o_field_many2one[name="partner_id"] input') ||
              null;
            if (ci instanceof HTMLInputElement) {
              const cleaned = (ci.value || '').replace(/SPEEK_[A-Z_]+(:[a-z0-9]+)?/ig, '').trim();
              if (cleaned && cleaned !== ci.value) {
                ci.value = cleaned;
                ci.dispatchEvent(new Event('input', { bubbles: true }));
                ci.dispatchEvent(new Event('change', { bubbles: true }));
              }
            }
          } catch (_) {}

          if (!isClientFieldEmpty()) {
            setTitleAck('OK');
            clearPendingPayload();
            clearBridgePayloadFromHash();
            return;
          }
        }
      }
      if (!phone) {
        clearPendingPayload();
        clearBridgePayloadFromHash();
        return;
      }
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  // IMPORTANT: l'app Windows est la source de vérité.
  // On n'applique plus automatiquement depuis l'URL/session au chargement.
  // On applique uniquement après réception explicite via collage JSON (F8 + Ctrl+V).

  // F8: arm a paste listener to receive JSON payload from Windows app (Ctrl+V)
  (function initPasteBridge() {
    const ID = 'tm-speek-bridge-paste';
    function ensurePasteBox() {
      let el = document.getElementById(ID);
      if (el) return el;
      el = document.createElement('textarea');
      el.id = ID;
      el.style.position = 'fixed';
      el.style.left = '-9999px';
      el.style.top = '0';
      el.style.width = '1px';
      el.style.height = '1px';
      document.body.appendChild(el);
      return el;
    }

    let armed = false;
    window.addEventListener('keydown', (e) => {
      if (e.key !== `F${BRIDGE_FKEY}`) return;
      if (e.ctrlKey || e.altKey || e.metaKey) return;
      if (e.repeat) return;
      e.preventDefault();
      try { e.stopImmediatePropagation(); } catch (_) {}
      try { e.stopPropagation(); } catch (_) {}

      const box = ensurePasteBox();
      box.focus();
      box.value = '';

      // Marqueur "armé" dans le titre: l'app Windows ne doit coller QUE si ce marqueur apparaît.
      (function keepArmed() {
        try {
          const start = Date.now();
          const tick = () => {
            try {
              const cur = document.title || '';
              if (!cur.includes('SPEEK_ARMED')) {
                const base = cur.replace(/\s*\|\s*SPEEK_(ARMED|PAGE_OK|OK)(:[a-z0-9]+)?/ig, '').trim();
                document.title = base ? `${base} | SPEEK_ARMED` : 'SPEEK_ARMED';
              }
            } catch (_) {}
            if (Date.now() - start >= 2500) clearInterval(id);
          };
          tick();
          const id = setInterval(tick, 120);
          setTimeout(() => { try { clearInterval(id); } catch (_) {} }, 2700);
        } catch (_) {}
      })();

      if (armed) return;
      armed = true;
      const onPaste = async (pe) => {
        try {
          pe.preventDefault();
          const text = (pe.clipboardData && pe.clipboardData.getData('text')) || '';
          const parsed = safeJsonParse(text);
          if (parsed) setPendingPayload(parsed);
          try {
            await applyBridgePayloadOnce(parsed || {});
          } catch (_) {
            // mode clinique: si une erreur arrive, ne rien casser
          }
        } finally {
          armed = false;
          try { box.removeEventListener('paste', onPaste); } catch (_) {}
        }
      };
      box.addEventListener('paste', onPaste);
    }, true);
  })();
})();
