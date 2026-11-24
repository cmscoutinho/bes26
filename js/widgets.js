/* Componentes das questões: objetiva, classificação, ordenação, normalização (tabelas), DER e discursiva.
 * Cada componente funciona em modo edição (aluno) e em modo leitura (professor/consulta), opcionalmente com gabarito. */
(function () {
  'use strict';
  const { h, clone, uid } = P;
  const NS = 'http://www.w3.org/2000/svg';

  // ======================================================================
  //  Arrastar e soltar com Pointer Events (mouse, caneta e toque)
  // ======================================================================
  P.arrastar = function (el, opts) {
    el.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      if (ev.target.closest('input, textarea, button, select, [data-nodrag]')) return;
      const sx = ev.clientX, sy = ev.clientY;
      const rect = el.getBoundingClientRect();
      const offX = sx - rect.left, offY = sy - rect.top;
      let ativo = false, ghost = null, alvo = null;
      const mover = e => {
        if (!ativo) {
          if (Math.hypot(e.clientX - sx, e.clientY - sy) < 5) return;
          ativo = true;
          ghost = el.cloneNode(true);
          ghost.classList.add('dnd-ghost');
          ghost.style.width = rect.width + 'px';
          document.body.append(ghost);
          el.classList.add('dnd-origem');
          document.body.classList.add('dnd-ativo');
        }
        e.preventDefault();
        ghost.style.transform = 'translate(' + (e.clientX - offX) + 'px,' + (e.clientY - offY) + 'px)';
        const sob = document.elementFromPoint(e.clientX, e.clientY);
        let novo = sob && sob.closest('[data-drop]');
        if (novo && opts.aceitar && !opts.aceitar(novo)) novo = null;
        if (novo !== alvo) {
          if (alvo) alvo.classList.remove('dnd-sobre');
          alvo = novo;
          if (alvo) alvo.classList.add('dnd-sobre');
        }
        if (opts.onMove) opts.onMove(e.clientX, e.clientY, alvo);
      };
      const soltar = e => {
        window.removeEventListener('pointermove', mover);
        window.removeEventListener('pointerup', soltar);
        window.removeEventListener('pointercancel', soltar);
        if (!ativo) return;
        ghost.remove();
        el.classList.remove('dnd-origem');
        document.body.classList.remove('dnd-ativo');
        if (alvo) alvo.classList.remove('dnd-sobre');
        // evita que o "click" após arrastar seja interpretado como clique
        const bloq = c => { c.stopPropagation(); c.preventDefault(); };
        el.addEventListener('click', bloq, true);
        setTimeout(() => el.removeEventListener('click', bloq, true), 0);
        if (opts.onDrop) opts.onDrop(e.type === 'pointercancel' ? null : alvo, e.clientX, e.clientY);
      };
      window.addEventListener('pointermove', mover, { passive: false });
      window.addEventListener('pointerup', soltar);
      window.addEventListener('pointercancel', soltar);
    });
  };

  const W = P.widgets = {};

  /** Renderiza a questão. o = { readonly, gabarito } */
  W.render = function (q, resp, onChange, o) {
    o = o || {};
    const fn = { objetiva: wObjetiva, classificacao: wClassif, ordenacao: wOrdem, normalizacao: wNorm, der: wDER, discursiva: wDisc }[q.tipo];
    const el = fn(q, resp === undefined || resp === null ? undefined : clone(resp), onChange || function () { }, o);
    if (o.readonly) el.classList.add('ro');
    return el;
  };

  W.respondida = function (q, r) {
    if (r === undefined || r === null) return false;
    switch (q.tipo) {
      case 'objetiva': return !!r;
      case 'classificacao': return Object.keys(r).length > 0;
      case 'ordenacao': return Array.isArray(r);
      case 'normalizacao': return !!(r.tabelas && r.tabelas.some(t => t.atributos && t.atributos.length));
      case 'der': return !!(r.nos && r.nos.length);
      case 'discursiva': return String(r).trim().length > 0;
    }
    return false;
  };

  W.incompleta = function (q, r) {
    if (!W.respondida(q, r)) return true;
    if (q.tipo === 'classificacao') return Object.keys(r).length < q.itens.length;
    return false;
  };

  // ======================================================================
  //  Objetiva
  // ======================================================================
  function wObjetiva(q, resp, onChange, o) {
    const box = h('div', { class: 'opcoes' });
    const g = o.gabarito;
    const labels = [];
    q.opcoes.forEach((op, i) => {
      const input = h('input', { type: 'radio', name: 'q_' + q.id + '_' + uid(), value: op.id, checked: resp === op.id, disabled: !!o.readonly });
      const lab = h('label', { class: 'opcao' }, input, h('span', { class: 'letra' }, 'ABCDE'[i]), h('span', { class: 'txt' }, op.texto));
      if (resp === op.id) lab.classList.add('sel');
      if (g) {
        if (op.id === g.correta) lab.classList.add('correta');
        else if (resp === op.id) lab.classList.add('errada');
      }
      if (!o.readonly) input.addEventListener('change', () => {
        labels.forEach(l => l.classList.remove('sel'));
        lab.classList.add('sel');
        resp = op.id;
        onChange(op.id);
      });
      labels.push(lab);
      box.append(lab);
    });
    if (!o.readonly) box.append(h('div', null, h('button', {
      class: 'btn-link', type: 'button', onclick: () => {
        labels.forEach(l => { l.classList.remove('sel'); l.querySelector('input').checked = false; });
        resp = undefined; onChange(undefined);
      }
    }, 'Limpar resposta')));
    if (o.readonly && !resp) box.prepend(h('div', { class: 'alerta aviso' }, 'Questão deixada em branco.'));
    if (g && g.explicacao) box.append(h('div', { class: 'explicacao' }, h('b', null, 'Comentário: '), g.explicacao));
    return box;
  }

  // ======================================================================
  //  Classificação (arrastar itens para categorias)
  // ======================================================================
  function wClassif(q, resp, onChange, o) {
    let mapa = resp || {};
    let sel = null;
    const root = h('div', { class: 'classif' });
    const catNome = id => (q.categorias.find(c => c.id === id) || {}).nome || '—';

    function mover(itemId, catId) {
      if (catId) mapa[itemId] = catId; else delete mapa[itemId];
      sel = null;
      onChange(clone(mapa));
      desenhar();
    }
    function cartao(it) {
      const cls = ['cartao-item'];
      let extra = null;
      if (o.gabarito) {
        const certo = o.gabarito.gabarito[it.id];
        if (mapa[it.id] === certo) cls.push('ok');
        else { cls.push('nok'); extra = h('span', { class: 'corr' }, 'Correto: ' + catNome(certo)); }
      }
      if (sel === it.id) cls.push('sel');
      if (!o.readonly) cls.push('arrastavel');
      const el = h('div', { class: cls.join(' '), 'data-item': it.id }, it.texto, extra);
      if (!o.readonly) {
        P.arrastar(el, {
          aceitar: z => z.dataset.drop === 'classif' && root.contains(z),
          onDrop: alvo => { if (alvo) mover(it.id, alvo.dataset.cat || null); }
        });
        el.addEventListener('click', () => { sel = sel === it.id ? null : it.id; desenhar(); });
      }
      return el;
    }
    function zona(catId, titulo, conteudo, cls) {
      const z = h('div', { class: cls, 'data-drop': 'classif', 'data-cat': catId || '' }, titulo, conteudo);
      if (!o.readonly) z.addEventListener('click', e => { if (sel && !e.target.closest('.cartao-item')) mover(sel, catId || null); });
      return z;
    }
    function desenhar() {
      const soltos = q.itens.filter(it => !mapa[it.id]);
      P.set(root, 
        (o.readonly && !soltos.length) ? null :
          zona('', h('h4', null, o.readonly ? 'Itens não classificados' : 'Itens a classificar'),
            h('div', { class: 'cartoes' }, soltos.map(cartao), soltos.length ? null : h('span', { class: 'muted peq' }, 'Todos os itens foram classificados.')), 'classif-pool'),
        h('div', { class: 'classif-cols' }, q.categorias.map(c =>
          zona(c.id, h('h4', null, c.nome), q.itens.filter(it => mapa[it.id] === c.id).map(cartao), 'classif-col'))),
        o.readonly ? null : h('p', { class: 'dica-widget' }, 'Arraste os cartões até a coluna correta, ou clique em um cartão e depois na coluna. Para desfazer, arraste de volta para “Itens a classificar”.')
      );
    }
    desenhar();
    return root;
  }

  // ======================================================================
  //  Ordenação
  // ======================================================================
  function wOrdem(q, resp, onChange, o) {
    const ids = q.itens.map(i => i.id);
    let ordem = Array.isArray(resp) && resp.length === ids.length ? resp.slice() : ids.slice();
    let confirmado = Array.isArray(resp);
    const txt = id => (q.itens.find(i => i.id === id) || {}).texto;
    const root = h('div');

    function salvar() { confirmado = true; onChange(ordem.slice()); desenhar(); }
    function mover(de, para) { const x = ordem.splice(de, 1)[0]; ordem.splice(para, 0, x); salvar(); }
    function limparMarcas(lista) { P.$$('.ins-antes, .ins-depois', lista).forEach(e => e.classList.remove('ins-antes', 'ins-depois')); }

    function desenhar() {
      if (o.readonly && !confirmado) { P.set(root, h('div', { class: 'alerta aviso' }, 'Sem resposta (a ordem não foi alterada nem confirmada).')); return; }
      const lista = h('ol', { class: 'ord-lista' });
      ordem.forEach((id, idx) => {
        const cls = ['ord-item'];
        let extra = null;
        if (o.gabarito) {
          const gi = o.gabarito.gabarito.indexOf(id);
          if (gi === idx) cls.push('ok'); else { cls.push('nok'); extra = h('span', { class: 'peq muted' }, 'posição correta: ' + (gi + 1)); }
        }
        if (!o.readonly) cls.push('arrastavel');
        const li = h('li', { class: cls.join(' '), 'data-drop': 'ordem', 'data-idx': idx },
          o.readonly ? null : h('span', { class: 'alca', 'aria-hidden': 'true' }, '⋮⋮'),
          h('span', { class: 'n' }, (idx + 1) + '.'), h('span', { class: 't' }, txt(id)), extra,
          o.readonly ? null : h('button', { class: 'btn mini fantasma', type: 'button', title: 'Subir', disabled: idx === 0, onclick: () => mover(idx, idx - 1) }, '↑'),
          o.readonly ? null : h('button', { class: 'btn mini fantasma', type: 'button', title: 'Descer', disabled: idx === ordem.length - 1, onclick: () => mover(idx, idx + 1) }, '↓'));
        if (!o.readonly) P.arrastar(li, {
          aceitar: z => z.dataset.drop === 'ordem' && lista.contains(z),
          onMove: (x, y, alvo) => {
            limparMarcas(lista);
            if (alvo && alvo !== li) { const r = alvo.getBoundingClientRect(); alvo.classList.add(y < r.top + r.height / 2 ? 'ins-antes' : 'ins-depois'); }
          },
          onDrop: (alvo, x, y) => {
            limparMarcas(lista);
            if (!alvo || alvo === li) return;
            const ti = Number(alvo.dataset.idx);
            const r = alvo.getBoundingClientRect();
            let para = y < r.top + r.height / 2 ? ti : ti + 1;
            if (para > idx) para--;
            if (para !== idx) mover(idx, para);
          }
        });
        lista.append(li);
      });
      P.set(root, lista, o.readonly ? null : h('div', { style: { marginTop: '12px', display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' } },
        confirmado ? h('span', { class: 'pilula verde' }, '✓ Ordem registrada')
          : [h('button', { class: 'btn mini', type: 'button', onclick: salvar }, 'Confirmar esta ordem'),
          h('span', { class: 'peq muted' }, 'A resposta só é registrada depois que você mover algum item ou confirmar a ordem.')]));
    }
    desenhar();
    return root;
  }

  // ======================================================================
  //  Normalização: montar tabelas arrastando atributos
  // ======================================================================
  function notacaoTabela(t) {
    return (t.nome || 'SemNome') + '(' + (t.atributos || []).map(a => (a.pk ? '#' : '') + (a.fk ? '&' : '') + a.n).join(', ') + ')';
  }
  W.notacaoTabela = notacaoTabela;

  function tabelaOriginalEl(q) {
    const t = q.tabelaOriginal;
    return h('div', null,
      h('div', { class: 'norm-orig' }, h('table', null,
        h('tr', null, t.colunas.map(c => h('th', null, c))),
        t.linhas.map(l => h('tr', null, l.map(v => h('td', null, v)))))),
      q.dependencias ? h('div', { class: 'norm-deps' }, h('b', { class: 'peq' }, 'Dependências funcionais:'), q.dependencias.map(d => h('div', null, d))) : null);
  }

  function wNorm(q, resp, onChange, o) {
    let est = resp && Array.isArray(resp.tabelas) ? resp : { tabelas: [] };
    const root = h('div', { class: 'norm' });
    if (o.readonly) return normLeitura(q, est, o, root);
    if (!est.tabelas.length) est.tabelas.push({ id: uid(), nome: '', atributos: [] });
    const salvar = () => onChange(clone(est));
    const tab = id => est.tabelas.find(t => t.id === id);
    const area = h('div', { class: 'norm-area' });

    function addAttr(tid, nome) {
      const t = tab(tid);
      if (!t) return false;
      if (t.atributos.some(a => a.n === nome)) { P.toast('Esse atributo já está nesta tabela.'); return false; }
      t.atributos.push({ n: nome, pk: false, fk: false });
      return true;
    }
    function desenhar() {
      const usos = {};
      est.tabelas.forEach(t => t.atributos.forEach(a => { usos[a.n] = (usos[a.n] || 0) + 1; }));
      const chips = q.tabelaOriginal.colunas.map(c => {
        const chip = h('div', { class: 'chip arrastavel' + (usos[c] ? '' : ' nao-usado'), title: 'Arraste para uma tabela' }, c, h('span', { class: 'cont' }, '×' + (usos[c] || 0)));
        P.arrastar(chip, {
          aceitar: z => z.dataset.drop === 'ntab' && root.contains(z),
          onDrop: alvo => { if (alvo && addAttr(alvo.dataset.tid, c)) { salvar(); desenhar(); } }
        });
        return chip;
      });
      const paleta = h('div', { class: 'norm-paleta', 'data-drop': 'paleta' },
        h('h4', null, 'Atributos'),
        h('p', { class: 'peq muted' }, 'Arraste para as tabelas. Em laranja: ainda não usados. Solte aqui para remover de uma tabela.'),
        h('div', { class: 'chips' }, chips));
      const tabs = h('div', { class: 'norm-tabelas' }, est.tabelas.map(cartaoTabela),
        h('button', { class: 'nova-tab', type: 'button', onclick: () => { est.tabelas.push({ id: uid(), nome: '', atributos: [] }); salvar(); desenhar(); } }, '+ Nova tabela'));
      P.set(area, paleta, tabs);
    }
    function cartaoTabela(t) {
      const corpo = h('div', { class: 'ntab-corpo' + (t.atributos.length ? '' : ' vazio'), 'data-drop': 'ntab', 'data-tid': t.id });
      t.atributos.forEach((a, i) => {
        const linha = h('div', { class: 'nlinha arrastavel' + (a.pk ? ' pk' : '') },
          h('span', { class: 'nome' }, a.n),
          h('button', { class: 'tag pk' + (a.pk ? ' on' : ''), type: 'button', title: 'Marcar/desmarcar chave primária', onclick: () => { a.pk = !a.pk; salvar(); desenhar(); } }, 'PK'),
          h('button', { class: 'tag fk' + (a.fk ? ' on' : ''), type: 'button', title: 'Marcar/desmarcar chave estrangeira', onclick: () => { a.fk = !a.fk; salvar(); desenhar(); } }, 'FK'),
          h('button', { class: 'x', type: 'button', title: 'Remover desta tabela', onclick: () => { t.atributos.splice(i, 1); salvar(); desenhar(); } }, '×'));
        P.arrastar(linha, {
          aceitar: z => (z.dataset.drop === 'ntab' || z.dataset.drop === 'paleta') && root.contains(z),
          onDrop: alvo => {
            if (!alvo) return;
            if (alvo.dataset.drop === 'paleta') t.atributos.splice(i, 1);
            else if (alvo.dataset.tid !== t.id) {
              const d = tab(alvo.dataset.tid);
              if (!d) return;
              if (d.atributos.some(x => x.n === a.n)) { P.toast('Esse atributo já está na tabela de destino.'); return; }
              t.atributos.splice(i, 1);
              d.atributos.push(a);
            } else return;
            salvar(); desenhar();
          }
        });
        corpo.append(linha);
      });
      const not = h('div', { class: 'notacao', title: 'Notação: # = PK, & = FK' }, notacaoTabela(t));
      const inp = h('input', { type: 'text', value: t.nome, placeholder: 'NomeDaTabela', maxlength: '40', 'aria-label': 'Nome da tabela' });
      inp.addEventListener('input', () => { t.nome = inp.value; not.textContent = notacaoTabela(t); salvar(); });
      const restantes = q.tabelaOriginal.colunas.filter(c => !t.atributos.some(a => a.n === c));
      const sel = h('select', { 'aria-label': 'Adicionar atributo' }, h('option', { value: '' }, '+ adicionar atributo…'), restantes.map(c => h('option', { value: c }, c)));
      sel.addEventListener('change', () => { if (sel.value && addAttr(t.id, sel.value)) { salvar(); desenhar(); } });
      const del = h('button', {
        class: 'btn mini fantasma', type: 'button', title: 'Excluir tabela', onclick: async () => {
          if (t.atributos.length && !(await P.confirmar('Excluir tabela', 'Excluir a tabela "' + (t.nome || 'sem nome') + '" com seus atributos?', 'Excluir', 'perigo'))) return;
          est.tabelas = est.tabelas.filter(x => x !== t); salvar(); desenhar();
        }
      }, '🗑');
      return h('div', { class: 'ntab' }, h('div', { class: 'ntab-cab' }, inp, del), corpo, h('div', { class: 'ntab-rod' }, sel), not);
    }
    root.append(tabelaOriginalEl(q), area);
    desenhar();
    return root;
  }

  function normLeitura(q, est, o, root) {
    const tabs = est.tabelas.filter(t => t.atributos && t.atributos.length);
    root.append(h('details', null, h('summary', { class: 'peq muted' }, 'Ver tabela original e dependências'), tabelaOriginalEl(q)));
    if (!tabs.length) root.append(h('div', { class: 'alerta aviso' }, 'Nenhuma tabela montada.'));
    else root.append(h('div', { class: 'norm-tabelas', style: { marginTop: '10px' } }, tabs.map(t =>
      h('div', { class: 'ntab' }, h('div', { class: 'ntab-cab' }, h('b', { class: 'mono', style: { color: '#fff', padding: '4px 6px' } }, t.nome || '(sem nome)')),
        h('div', { class: 'ntab-corpo' }, t.atributos.map(a => h('div', { class: 'nlinha' + (a.pk ? ' pk' : '') }, h('span', { class: 'nome' }, a.n),
          h('span', { class: 'tag pk' + (a.pk ? ' on' : '') }, 'PK'), h('span', { class: 'tag fk' + (a.fk ? ' on' : '') }, 'FK')))),
        h('div', { class: 'notacao' }, notacaoTabela(t))))));
    if (o.gabarito && o.gabarito.gabarito) {
      root.append(h('div', { class: 'gab-box' }, h('h4', null, 'Solução esperada'),
        o.gabarito.gabarito.map(g => h('div', { class: 'mono' }, notacaoTabela({ nome: g.nome, atributos: g.atributos.map(a => ({ n: a, pk: g.pk.includes(a), fk: g.fk.includes(a) })) }))),
        o.gabarito.criterios ? h('p', { class: 'peq', style: { marginTop: '6px' } }, o.gabarito.criterios) : null));
    }
    return root;
  }

  // ======================================================================
  //  DER (notação de Peter Chen)
  // ======================================================================
  const DER_W = 1000, DER_H = 600;
  let ctx2d = null;
  function medir(txt, peso, tam) {
    if (!ctx2d) ctx2d = document.createElement('canvas').getContext('2d');
    ctx2d.font = (peso || 600) + ' ' + (tam || 14) + 'px "IBM Plex Sans", "Segoe UI", system-ui, sans-serif';
    return ctx2d.measureText(String(txt || '')).width;
  }
  const attrsDe = n => String(n.attrs || '').split('\n').map(s => s.trim()).filter(Boolean);
  function geom(n) {
    const at = attrsDe(n);
    const wn = medir(n.nome || '?', 600, 14);
    const wa = at.length ? Math.max.apply(null, at.map(a => medir(a, 400, 12))) : 0;
    if (n.tipo === 'relacionamento') return { w: Math.max(116, wn + 60), h: 66, at };
    if (n.tipo === 'associativa') return { w: Math.max(160, wn + 86, wa + 28), h: 64 + (at.length ? at.length * 16 + 8 : 0), at };
    return { w: Math.max(112, wn + 34, wa + 28), h: 42 + (at.length ? at.length * 16 + 8 : 0), at };
  }
  function borda(n, g, ux, uy) {
    if (n.tipo === 'relacionamento') return 1 / ((Math.abs(ux) / (g.w / 2) + Math.abs(uy) / (g.h / 2)) || 1);
    const tx = Math.abs(ux) > 1e-6 ? (g.w / 2) / Math.abs(ux) : Infinity;
    const ty = Math.abs(uy) > 1e-6 ? (g.h / 2) / Math.abs(uy) : Infinity;
    return Math.min(tx, ty);
  }
  const ehRel = n => n.tipo === 'relacionamento';
  function posRotulo(a, b, G) {
    let alvo, outro;
    if (!ehRel(a) && ehRel(b)) { alvo = a; outro = b; }
    else if (!ehRel(b) && ehRel(a)) { alvo = b; outro = a; }
    else return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dx = outro.x - alvo.x, dy = outro.y - alvo.y, len = Math.hypot(dx, dy) || 1;
    const ux = dx / len, uy = dy / len;
    const d = Math.min(borda(alvo, G[alvo.id], ux, uy) + 20, len / 2);
    return { x: alvo.x + ux * d, y: alvo.y + uy * d };
  }
  const E = P.esc;

  /** Gera o conteúdo SVG (string). opt = { sel, origem, ro } */
  function svgConteudo(m, opt) {
    opt = opt || {};
    const porId = {}, G = {};
    m.nos.forEach(n => { porId[n.id] = n; G[n.id] = geom(n); });
    let s = '';
    m.arestas.forEach(e => {
      const a = porId[e.a], b = porId[e.b];
      if (!a || !b) return;
      const sel = opt.sel && opt.sel.tipo === 'aresta' && opt.sel.id === e.id;
      s += '<g class="aresta" data-aresta="' + E(e.id) + '">';
      s += '<line x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '" stroke="' + (sel ? '#2f6cc0' : '#3a4458') + '" stroke-width="' + (sel ? 3.2 : 1.8) + '"/>';
      if (!opt.ro) s += '<line class="aresta-hit" x1="' + a.x + '" y1="' + a.y + '" x2="' + b.x + '" y2="' + b.y + '"/>';
      const p = posRotulo(a, b, G);
      if (e.card) {
        s += '<circle cx="' + p.x + '" cy="' + p.y + '" r="11" fill="#fff" stroke="' + (sel ? '#2f6cc0' : '#3a4458') + '" stroke-width="1.4"/>';
        s += '<text x="' + p.x + '" y="' + (p.y + 4.5) + '" text-anchor="middle" font-size="13" font-weight="700" fill="#18212f">' + E(e.card) + '</text>';
      } else if (!opt.ro && (ehRel(a) !== ehRel(b))) {
        s += '<circle cx="' + p.x + '" cy="' + p.y + '" r="9" fill="#fff" stroke="#c3cbd8" stroke-dasharray="2 2"/>';
        s += '<text x="' + p.x + '" y="' + (p.y + 4) + '" text-anchor="middle" font-size="11" fill="#9aa5b8">?</text>';
      }
      s += '</g>';
    });
    m.nos.forEach(n => {
      const g = G[n.id];
      const sel = opt.sel && opt.sel.tipo === 'no' && opt.sel.id === n.id;
      const orig = opt.origem === n.id;
      const cor = sel ? '#2f6cc0' : orig ? '#1d7a4f' : '#18212f';
      const sw = sel || orig ? 2.8 : 1.6;
      const w = g.w, hh = g.h, x0 = -w / 2, y0 = -hh / 2;
      s += '<g class="no" data-no="' + E(n.id) + '" transform="translate(' + n.x + ',' + n.y + ')">';
      if (n.tipo === 'relacionamento') {
        s += '<polygon points="0,' + y0 + ' ' + (w / 2) + ',0 0,' + (hh / 2) + ' ' + x0 + ',0" fill="#fffdf5" stroke="' + cor + '" stroke-width="' + sw + '"/>';
        s += '<text x="0" y="5" text-anchor="middle" font-size="14" font-weight="600" font-style="italic" fill="#18212f">' + E(n.nome) + '</text>';
        g.at.forEach((a, i) => { s += '<text x="0" y="' + (hh / 2 + 16 + i * 15) + '" text-anchor="middle" font-size="12" fill="#44506a">○ ' + E(a) + '</text>'; });
      } else {
        const assoc = n.tipo === 'associativa';
        s += '<rect x="' + x0 + '" y="' + y0 + '" width="' + w + '" height="' + hh + '" rx="4" fill="' + (assoc ? '#f3f7fd' : '#fff') + '" stroke="' + cor + '" stroke-width="' + sw + '"/>';
        const topo = assoc ? 48 : 27;
        if (assoc) {
          const dw = Math.min(w - 16, medir(n.nome, 600, 14) + 64);
          s += '<polygon points="0,' + (y0 + 6) + ' ' + (dw / 2) + ',' + (y0 + 26) + ' 0,' + (y0 + 46) + ' ' + (-dw / 2) + ',' + (y0 + 26) + '" fill="#fff" stroke="' + cor + '" stroke-width="1.2"/>';
          s += '<text x="0" y="' + (y0 + 31) + '" text-anchor="middle" font-size="14" font-weight="600" fill="#18212f">' + E(n.nome) + '</text>';
        } else {
          s += '<text x="0" y="' + (g.at.length ? y0 + 26 : 5) + '" text-anchor="middle" font-size="14" font-weight="600" fill="#18212f">' + E(n.nome) + '</text>';
        }
        if (g.at.length) {
          s += '<line x1="' + x0 + '" y1="' + (y0 + topo + 6) + '" x2="' + (w / 2) + '" y2="' + (y0 + topo + 6) + '" stroke="#c3cbd8"/>';
          g.at.forEach((a, i) => {
            const pk = a.charAt(0) === '#';
            s += '<text x="' + (x0 + 12) + '" y="' + (y0 + topo + 22 + i * 16) + '" font-size="12" fill="#44506a"' + (pk ? ' text-decoration="underline" font-weight="600"' : '') + '>' + E(a) + '</text>';
          });
        }
      }
      s += '</g>';
    });
    return s;
  }

  /** SVG completo e autossuficiente (para leitura e exportação), com enquadramento automático. */
  W.derSVG = function (m, opt) {
    opt = opt || {};
    m = m && Array.isArray(m.nos) ? m : { nos: [], arestas: [] };
    let minX = 0, minY = 0, maxX = 400, maxY = 120;
    if (m.nos.length) {
      minX = Infinity; minY = Infinity; maxX = -Infinity; maxY = -Infinity;
      m.nos.forEach(n => {
        const g = geom(n);
        const extraY = n.tipo === 'relacionamento' ? g.at.length * 15 + 10 : 0;
        minX = Math.min(minX, n.x - g.w / 2); maxX = Math.max(maxX, n.x + g.w / 2);
        minY = Math.min(minY, n.y - g.h / 2); maxY = Math.max(maxY, n.y + g.h / 2 + extraY);
      });
    }
    const pad = 24;
    // enquadramento mínimo, para que DERs pequenos não apareçam ampliados
    const minW = 760, minH = 260;
    if (maxX - minX < minW) { const c = (minX + maxX) / 2; minX = c - minW / 2; maxX = c + minW / 2; }
    if (maxY - minY < minH) { const c = (minY + maxY) / 2; minY = c - minH / 2; maxY = c + minH / 2; }
    const vb = [minX - pad, minY - pad, (maxX - minX) + pad * 2, (maxY - minY) + pad * 2].map(v => Math.round(v));
    const corpo = m.nos.length ? svgConteudo(m, { ro: true }) : '<text x="200" y="60" text-anchor="middle" font-size="14" fill="#9aa5b8">(DER vazio)</text>';
    return '<svg xmlns="' + NS + '" viewBox="' + vb.join(' ') + '" width="' + vb[2] + '" height="' + vb[3] + '" font-family="IBM Plex Sans, Segoe UI, Arial, sans-serif" style="background:#fff">' + corpo + '</svg>';
  };

  function iconeSVG(tipo) {
    if (tipo === 'entidade') return '<svg width="26" height="16"><rect x="1" y="1" width="24" height="14" rx="2" fill="#fff" stroke="#18212f" stroke-width="1.4"/></svg>';
    if (tipo === 'relacionamento') return '<svg width="26" height="18"><polygon points="13,1 25,9 13,17 1,9" fill="#fffdf5" stroke="#18212f" stroke-width="1.4"/></svg>';
    return '<svg width="26" height="18"><rect x="1" y="1" width="24" height="16" rx="2" fill="#f3f7fd" stroke="#18212f" stroke-width="1.4"/><polygon points="13,3 22,9 13,15 4,9" fill="#fff" stroke="#18212f"/></svg>';
  }

  function wDER(q, resp, onChange, o) {
    let m = resp && Array.isArray(resp.nos) ? resp : { nos: [], arestas: [] };
    if (o.readonly) {
      const box = h('div', null);
      if (!m.nos.length) box.append(h('div', { class: 'alerta aviso' }, 'DER não preenchido.'));
      else box.append(h('div', { class: 'der-ro', html: W.derSVG(m) }));
      box.append(h('details', { style: { marginTop: '8px' } }, h('summary', { class: 'peq muted' }, 'Descrição textual do DER'), h('pre', { class: 'bloco' }, derTexto(m))));
      if (o.gabarito && o.gabarito.gabarito) {
        box.append(h('div', { class: 'gab-box' }, h('h4', null, 'Modelo de referência'),
          h('div', { class: 'der-ro', html: W.derSVG(o.gabarito.gabarito) }),
          o.gabarito.criterios ? h('p', { class: 'peq', style: { marginTop: '6px' } }, o.gabarito.criterios) : null));
      }
      return box;
    }

    let sel = null, modo = 'mover', origem = null;
    let ultimoToque = { id: null, t: 0 };
    const root = h('div', { class: 'der-wrap' });
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + DER_W + ' ' + DER_H);
    svg.setAttribute('class', 'der-canvas');
    const area = h('div', { 'data-drop': 'der' }, svg);
    const barra = h('div', { class: 'der-barra' });
    const dica = h('div', { class: 'der-dica' });
    const salvar = () => onChange(clone(m));
    const clampX = v => Math.max(60, Math.min(DER_W - 60, v));
    const clampY = v => Math.max(36, Math.min(DER_H - 36, v));

    function ponto(cx, cy) {
      const pt = svg.createSVGPoint(); pt.x = cx; pt.y = cy;
      const r = pt.matrixTransform(svg.getScreenCTM().inverse());
      return { x: r.x, y: r.y };
    }
    function desenhar() {
      svg.innerHTML = svgConteudo(m, { sel, origem });
      svg.classList.toggle('ligando', modo === 'ligar');
      desenharBarra();
    }
    function paleta(tipo, rotulo) {
      const el = h('div', { class: 'der-paleta arrastavel', title: 'Arraste para a área de desenho (ou clique)' }, h('span', { html: iconeSVG(tipo) }), rotulo);
      P.arrastar(el, {
        aceitar: z => z.dataset.drop === 'der' && root.contains(z),
        onDrop: (alvo, x, y) => { if (alvo) { const p = ponto(x, y); criar(tipo, p.x, p.y); } }
      });
      el.addEventListener('click', () => { const k = m.nos.length; criar(tipo, 110 + (k % 5) * 190, 80 + (Math.floor(k / 5) % 4) * 130); });
      return el;
    }
    function criar(tipo, x, y) {
      const n = { id: 'n' + uid(), tipo, nome: tipo === 'entidade' ? 'Entidade' : tipo === 'relacionamento' ? 'relaciona' : 'Associativa', attrs: '', x: clampX(x), y: clampY(y) };
      m.nos.push(n);
      sel = { tipo: 'no', id: n.id };
      modo = 'mover'; origem = null;
      salvar(); desenhar();
      editarNo(n);
    }
    function conectar(a, b) {
      if (m.arestas.some(e => (e.a === a && e.b === b) || (e.a === b && e.b === a))) { P.toast('Esses elementos já estão ligados.'); return; }
      const e = { id: 'e' + uid(), a, b, card: '' };
      m.arestas.push(e);
      sel = { tipo: 'aresta', id: e.id };
      salvar();
    }
    function excluirSel() {
      if (!sel) return;
      if (sel.tipo === 'no') {
        m.nos = m.nos.filter(n => n.id !== sel.id);
        m.arestas = m.arestas.filter(e => e.a !== sel.id && e.b !== sel.id);
      } else m.arestas = m.arestas.filter(e => e.id !== sel.id);
      sel = null; salvar(); desenhar();
    }
    async function editarNo(n) {
      const rotAttrs = n.tipo === 'relacionamento' ? 'Atributos do relacionamento (opcional, um por linha)' : 'Atributos (um por linha; use # antes do identificador)';
      const inNome = h('input', { type: 'text', value: n.nome, maxlength: '40' });
      const inAt = h('textarea', { rows: '5', placeholder: n.tipo === 'relacionamento' ? 'ex.: dataHora' : '#id\nnome' });
      inAt.value = n.attrs || '';
      const tipoNome = { entidade: 'entidade', relacionamento: 'relacionamento', associativa: 'entidade associativa' }[n.tipo];
      const ok = await P.modal({
        titulo: 'Editar ' + tipoNome,
        corpo: h('div', null, h('label', { class: 'campo' }, h('span', null, 'Nome'), inNome), h('label', { class: 'campo' }, h('span', null, rotAttrs), inAt)),
        botoes: [{ texto: 'Cancelar', valor: false }, { texto: 'Aplicar', classe: 'primario', valor: true }]
      });
      if (!ok) return;
      n.nome = inNome.value.trim() || n.nome;
      n.attrs = inAt.value.split('\n').map(s => s.trim()).filter(Boolean).slice(0, 15).join('\n');
      salvar(); desenhar();
    }
    function desenharBarra() {
      const selNo = sel && sel.tipo === 'no' ? m.nos.find(n => n.id === sel.id) : null;
      const selAr = sel && sel.tipo === 'aresta' ? m.arestas.find(a => a.id === sel.id) : null;
      P.set(barra, [
        paleta('entidade', 'Entidade'), paleta('relacionamento', 'Relacionamento'), paleta('associativa', 'Ent. associativa'),
        h('span', { class: 'sep' }),
        h('button', { class: 'btn mini' + (modo === 'ligar' ? ' on' : ''), type: 'button', onclick: () => { modo = modo === 'ligar' ? 'mover' : 'ligar'; origem = null; desenhar(); } }, '🔗 Ligar'),
        (selNo || selAr) ? h('span', { class: 'sep' }) : null,
        selNo ? h('button', { class: 'btn mini', type: 'button', onclick: () => editarNo(selNo) }, '✎ Editar') : null,
        selAr ? [h('span', { class: 'peq muted' }, 'Cardinalidade:'),
        ['1', 'N', ''].map(c => h('button', { class: 'btn mini' + ((selAr.card || '') === c ? ' on' : ''), type: 'button', onclick: () => { selAr.card = c; salvar(); desenhar(); } }, c || 'sem'))] : null,
        (selNo || selAr) ? h('button', { class: 'btn mini', type: 'button', onclick: excluirSel }, '🗑 Excluir') : null
      ].flat(Infinity).filter(Boolean));
      dica.textContent = modo === 'ligar'
        ? (origem ? 'Agora clique no elemento de destino. Clique em “Ligar” de novo para sair desse modo.' : 'Modo ligar: clique no primeiro elemento (ex.: uma entidade) e depois no segundo (ex.: um relacionamento).')
        : selAr ? 'Linha selecionada: defina a cardinalidade (1 ou N) do lado da entidade. O valor aparece junto à entidade.'
          : selNo ? 'Arraste para mover. Dê duplo clique ou use “Editar” para alterar o nome e os atributos. Delete remove.'
            : 'Arraste Entidade, Relacionamento ou Ent. associativa para a área abaixo. Depois use “Ligar” para conectar os elementos.';
    }
    svg.addEventListener('pointerdown', ev => {
      const gNo = ev.target.closest('[data-no]');
      const gAr = ev.target.closest('[data-aresta]');
      if (modo === 'ligar') {
        if (gNo) {
          const id = gNo.dataset.no;
          if (!origem) origem = id;
          else if (origem !== id) { conectar(origem, id); origem = null; }
        } else origem = null;
        desenhar();
        return;
      }
      if (gNo) {
        const n = m.nos.find(x => x.id === gNo.dataset.no);
        if (!n) return;
        const agora = Date.now();
        if (ultimoToque.id === n.id && agora - ultimoToque.t < 380) { ultimoToque = { id: null, t: 0 }; editarNo(n); return; }
        ultimoToque = { id: n.id, t: agora };
        sel = { tipo: 'no', id: n.id };
        const p0 = ponto(ev.clientX, ev.clientY);
        const ox = n.x - p0.x, oy = n.y - p0.y;
        let moveu = false;
        try { svg.setPointerCapture(ev.pointerId); } catch (e) { }
        const mv = e => { const p = ponto(e.clientX, e.clientY); n.x = Math.round(clampX(p.x + ox)); n.y = Math.round(clampY(p.y + oy)); moveu = true; desenhar(); };
        const up = () => {
          svg.removeEventListener('pointermove', mv); svg.removeEventListener('pointerup', up); svg.removeEventListener('pointercancel', up);
          if (moveu) salvar();
        };
        svg.addEventListener('pointermove', mv); svg.addEventListener('pointerup', up); svg.addEventListener('pointercancel', up);
        ev.preventDefault();
        desenhar();
      } else if (gAr) { sel = { tipo: 'aresta', id: gAr.dataset.aresta }; desenhar(); }
      else { sel = null; desenhar(); }
    });
    const tecla = e => {
      if (!root.isConnected) { document.removeEventListener('keydown', tecla); return; }
      if (document.querySelector('.modal-fundo')) return;
      if (e.target.closest && e.target.closest('input, textarea, select')) return;
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); excluirSel(); }
      if (e.key === 'Escape' && (modo === 'ligar' || sel)) { modo = 'mover'; origem = null; sel = null; desenhar(); }
    };
    document.addEventListener('keydown', tecla);
    root.append(barra, dica, area);
    desenhar();
    return root;
  }

  function derTexto(m) {
    if (!m || !m.nos || !m.nos.length) return '(DER vazio)';
    const porId = {};
    m.nos.forEach(n => { porId[n.id] = n; });
    const viz = id => m.arestas.filter(e => e.a === id || e.b === id).map(e => ({ no: porId[e.a === id ? e.b : e.a], card: e.card || '?' })).filter(v => v.no);
    const at = n => { const a = attrsDe(n); return a.length ? ' {' + a.join(', ') + '}' : ''; };
    const L = [];
    const ents = m.nos.filter(n => n.tipo === 'entidade');
    const assoc = m.nos.filter(n => n.tipo === 'associativa');
    const rels = m.nos.filter(n => n.tipo === 'relacionamento');
    L.push('Entidades: ' + (ents.length ? ents.map(n => n.nome + at(n)).join('; ') : '(nenhuma)'));
    if (assoc.length) L.push('Entidades associativas: ' + assoc.map(n => n.nome + at(n) + ' — ligada a: ' + (viz(n.id).map(v => v.no.nome + ' [' + v.card + ']').join(', ') || 'nada')).join('; '));
    L.push('Relacionamentos (cardinalidade escrita junto a cada entidade):');
    if (!rels.length) L.push('  (nenhum)');
    rels.forEach(r => {
      const v = viz(r.id);
      if (v.length === 2) L.push('  - ' + v[0].no.nome + ' (' + v[0].card + ') —[' + r.nome + ']— (' + v[1].card + ') ' + v[1].no.nome + at(r));
      else L.push('  - [' + r.nome + '] ligado a: ' + (v.map(x => x.no.nome + ' (' + x.card + ')').join(', ') || 'nada') + at(r));
    });
    const diretas = m.arestas.filter(e => porId[e.a] && porId[e.b] && !ehRel(porId[e.a]) && !ehRel(porId[e.b]));
    if (diretas.length) L.push('Ligações diretas entre entidades: ' + diretas.map(e => porId[e.a].nome + ' — ' + porId[e.b].nome + (e.card ? ' [' + e.card + ']' : '')).join('; '));
    return L.join('\n');
  }
  W.derTexto = derTexto;

  // ======================================================================
  //  Discursiva
  // ======================================================================
  function wDisc(q, resp, onChange, o) {
    if (o.readonly) {
      const box = h('div', null, h('div', { class: 'resposta-texto' }, resp && String(resp).trim() ? resp : '(em branco)'));
      if (o.gabarito && o.gabarito.respostaEsperada) box.append(h('div', { class: 'gab-box' }, h('h4', null, 'Resposta esperada'), o.gabarito.respostaEsperada));
      return box;
    }
    const max = q.maxChars || 3000;
    const ta = h('textarea', { maxlength: String(max), placeholder: 'Escreva sua resposta aqui…', spellcheck: 'true', 'aria-label': 'Resposta' });
    ta.value = resp || '';
    const cont = h('div', { class: 'contador' });
    const upd = () => { cont.textContent = ta.value.length + ' / ' + max + ' caracteres'; };
    ta.addEventListener('input', () => { upd(); onChange(ta.value); });
    upd();
    return h('div', { class: 'disc' }, ta, cont);
  }

  // ======================================================================
  //  Representação textual (arquivo do aluno, pacote para LLM)
  // ======================================================================
  W.texto = function (q, r) {
    if (!W.respondida(q, r)) return '(em branco)';
    switch (q.tipo) {
      case 'objetiva': {
        const i = q.opcoes.findIndex(op => op.id === r);
        return i < 0 ? '(em branco)' : 'ABCDE'[i] + ') ' + q.opcoes[i].texto;
      }
      case 'classificacao':
        return q.itens.map(it => '- ' + it.texto + ' → ' + ((q.categorias.find(c => c.id === r[it.id]) || {}).nome || '(não classificado)')).join('\n');
      case 'ordenacao':
        return r.map((id, i) => (i + 1) + '. ' + ((q.itens.find(x => x.id === id) || {}).texto || id)).join('\n');
      case 'normalizacao':
        return r.tabelas.filter(t => t.atributos.length).map(notacaoTabela).join('\n') + '\n(# = PK, & = FK)';
      case 'der': return derTexto(r);
      case 'discursiva': return String(r);
    }
    return JSON.stringify(r);
  };
})();
