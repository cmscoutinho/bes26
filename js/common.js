/* Utilitários compartilhados pelas páginas (prova, professor, consulta). */
(function () {
  'use strict';
  const P = window.P = window.P || {};

  P.$ = (s, r) => (r || document).querySelector(s);
  P.$$ = (s, r) => Array.from((r || document).querySelectorAll(s));

  /** Cria elemento: P.h('div', {class:'x', onclick: fn}, 'texto', filho) */
  P.h = function (tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        const v = attrs[k];
        if (v === null || v === undefined || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      }
    }
    kids.flat(Infinity).forEach(c => {
      if (c === null || c === undefined || c === false) return;
      el.append(c.nodeType ? c : String(c));
    });
    return el;
  };

  /** Substitui os filhos de el, ignorando null/undefined/false e achatando arrays. */
  P.set = (el, ...kids) => { el.replaceChildren(...kids.flat(Infinity).filter(k => k !== null && k !== undefined && k !== false)); return el; };

  P.esc = s => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  P.norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
  P.clone = o => JSON.parse(JSON.stringify(o));
  P.sleep = ms => new Promise(r => setTimeout(r, ms));
  P.uid = () => Math.random().toString(36).slice(2, 9);

  // ---------- formatação ----------
  const pad = n => String(n).padStart(2, '0');
  P.fmtHora = ms => { if (!ms) return '—'; const d = new Date(ms); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };
  P.fmtDataHora = ms => {
    if (!ms) return '—';
    const d = new Date(typeof ms === 'string' ? Date.parse(ms) : ms);
    if (isNaN(d)) return '—';
    return pad(d.getDate()) + '/' + pad(d.getMonth() + 1) + '/' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  };
  P.fmtDur = ms => {
    ms = Math.max(0, ms);
    const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    return (h ? h + ':' + pad(m) : pad(m)) + ':' + pad(ss);
  };
  P.fmtDurLonga = ms => {
    const s = Math.floor(Math.max(0, ms) / 1000);
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
    if (d) return d + 'd ' + h + 'h ' + pad(m) + 'min';
    if (h) return h + 'h ' + pad(m) + 'min ' + pad(ss) + 's';
    return m + 'min ' + pad(ss) + 's';
  };
  P.fmtNota = n => (n === null || n === undefined || n === '' || isNaN(Number(n))) ? '—' : Number(n).toFixed(2).replace('.', ',');

  // ---------- API ----------
  P.api = async function (acao, dados, opt) {
    opt = opt || {};
    const url = (window.PROVA_CONFIG || {}).API_URL || '';
    if (!url || url.indexOf('COLE_AQUI') >= 0) throw new Error('A URL do servidor (Apps Script) não foi configurada em js/config.js.');
    const tentativas = opt.tentativas === undefined ? 2 : opt.tentativas;
    let ultimoErro;
    for (let i = 0; i <= tentativas; i++) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opt.timeout || 30000);
      try {
        const r = await fetch(url, {
          method: 'POST', redirect: 'follow', signal: ctrl.signal,
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify(Object.assign({ acao }, dados || {}))
        });
        clearTimeout(timer);
        const txt = await r.text();
        let j;
        try { j = JSON.parse(txt); } catch (e) { throw Object.assign(new Error('Resposta inesperada do servidor.'), { rede: true }); }
        if (!j.ok) {
          const err = new Error(j.erro || 'Erro no servidor.');
          Object.assign(err, j, { servidor: true });
          throw err;
        }
        return j;
      } catch (e) {
        clearTimeout(timer);
        ultimoErro = e.name === 'AbortError' ? Object.assign(new Error('Tempo de resposta esgotado.'), { rede: true }) : e;
        if (ultimoErro.servidor) throw ultimoErro;
        if (!ultimoErro.rede) ultimoErro.rede = true;
        if (i < tentativas) await P.sleep(1200 * (i + 1));
      }
    }
    if (ultimoErro && ultimoErro.message === 'Failed to fetch') ultimoErro.message = 'Sem conexão com o servidor.';
    throw ultimoErro;
  };

  // ---------- toasts e modais ----------
  P.toast = function (msg, tipo, ms) {
    let box = document.getElementById('toasts');
    if (!box) { box = P.h('div', { id: 'toasts' }); document.body.append(box); }
    const t = P.h('div', { class: 'toast ' + (tipo || '') }, msg);
    box.append(t);
    setTimeout(() => t.remove(), ms || 3200);
  };

  /** Modal simples. botoes: [{texto, classe, valor}] → Promise(valor) */
  P.modal = function ({ titulo, corpo, botoes, largo, fecharFora }) {
    return new Promise(resolve => {
      const fundo = P.h('div', { class: 'modal-fundo' });
      const fechar = v => { fundo.remove(); document.removeEventListener('keydown', esc, true); resolve(v); };
      const esc = e => { if (e.key === 'Escape' && fecharFora !== false) { e.stopPropagation(); fechar(null); } };
      const corpoEl = typeof corpo === 'string' ? P.h('div', { html: corpo }) : corpo;
      const m = P.h('div', { class: 'modal' + (largo ? ' largo' : ''), role: 'dialog', 'aria-modal': 'true' },
        titulo ? P.h('div', { class: 'modal-cab' }, P.h('h2', null, titulo)) : null,
        P.h('div', { class: 'modal-corpo' }, corpoEl),
        P.h('div', { class: 'modal-rodape' }, (botoes || [{ texto: 'OK', classe: 'primario', valor: true }]).map(b =>
          P.h('button', { class: 'btn ' + (b.classe || ''), onclick: () => { if (b.antes && b.antes() === false) return; fechar(b.valor); } }, b.texto)))
      );
      fundo.append(m);
      if (fecharFora !== false) fundo.addEventListener('pointerdown', e => { if (e.target === fundo) fechar(null); });
      document.addEventListener('keydown', esc, true);
      document.body.append(fundo);
      const foco = m.querySelector('input, textarea') || m.querySelector('.modal-rodape .primario');
      if (foco) setTimeout(() => foco.focus(), 30);
    });
  };
  P.confirmar = (titulo, texto, ok, classe) => P.modal({
    titulo, corpo: P.h('p', null, texto),
    botoes: [{ texto: 'Cancelar', valor: false }, { texto: ok || 'Confirmar', classe: classe || 'primario', valor: true }]
  });

  P.baixar = function (nome, conteudo, mime) {
    const blob = new Blob([conteudo], { type: mime || 'text/plain;charset=utf-8' });
    const a = P.h('a', { href: URL.createObjectURL(blob), download: nome });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  };

  P.htmlParaTexto = function (html) {
    let s = String(html || '')
      .replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|tr|h\d|ol|ul|table)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ').replace(/<\/t[dh]>/gi, ' | ').replace(/<[^>]+>/g, '');
    const t = document.createElement('textarea');
    t.innerHTML = s;
    return t.value.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  };

  P.rotuloTipo = { objetiva: 'Objetiva', classificacao: 'Interativa · classificação', ordenacao: 'Interativa · ordenação', normalizacao: 'Interativa · tabelas', der: 'Interativa · DER', discursiva: 'Discursiva' };
})();
