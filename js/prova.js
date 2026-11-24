/* Página da prova: landing, prova em tela cheia, monitoramento, salvamento, envio e arquivo do aluno. */
(function () {
  'use strict';
  const { h, $, $$ } = P;
  const W = P.widgets;
  const LS = 'provaBD1:';

  const S = {
    offset: 0, cfg: null, token: null, nome: '', matricula: '', questoes: [], material: [], respostas: {},
    pendentes: [], atual: 0, fimMs: 0, sujo: false, sincronizando: false, ultimaSync: 0, ultimaTentativa: 0,
    finalizando: false, finalizado: false, codigo: null, envio: null, avisos: {}, syncPreFinal: false, emProva: false
  };
  const mon = { ativo: false, fsSaidaEm: null, ocultaEm: null, focoEm: null };
  const agoraServ = () => Date.now() + S.offset;

  // ============================================================
  //  Armazenamento local (resiliência a queda de rede/navegador)
  // ============================================================
  function lerLocal(mat) { try { return JSON.parse(localStorage.getItem(LS + mat) || 'null'); } catch (e) { return null; } }
  let tLocal = null;
  function salvarLocal(imediato) {
    const f = () => {
      try {
        localStorage.setItem(LS + S.matricula, JSON.stringify({
          token: S.token, nome: S.nome, respostas: S.respostas, pendentes: S.pendentes, atual: S.atual,
          finalizado: S.finalizado, codigo: S.codigo, envio: S.envio, questoes: S.finalizado ? S.questoes : undefined,
          cfg: S.finalizado ? S.cfg : undefined, salvoEm: Date.now()
        }));
      } catch (e) { }
    };
    clearTimeout(tLocal);
    if (imediato) f(); else tLocal = setTimeout(f, 300);
  }

  // ============================================================
  //  LANDING
  // ============================================================
  function estadoLocal() {
    if (!S.cfg || !S.cfg.inicio || !S.cfg.fim) return 'nao_configurada';
    const t = agoraServ();
    if (t < S.cfg.inicio) return 'antes';
    if (t >= S.cfg.fim) return 'encerrada';
    return 'aberta';
  }

  async function carregarStatus() {
    try {
      const r = await P.api('status', {}, { tentativas: 1 });
      S.offset = r.agora - Date.now();
      S.cfg = r.config;
      P.set($('#l-erro'));
      atualizarLanding();
    } catch (e) {
      P.set($('#l-erro'), h('div', { class: 'alerta erro' }, e.message));
      $('#l-estado').className = 'pilula vermelho';
      P.set($('#l-estado'), h('span', { class: 'ponto' }), ' Sem conexão');
    }
  }

  let estadoAnterior = null;
  function atualizarLanding() {
    if (S.emProva || !S.cfg) return;
    const c = S.cfg;
    $('#l-sobre').textContent = c.disciplina + ' · Turma ' + c.turma;
    $('#l-titulo').textContent = c.titulo;
    $('#l-prof').textContent = c.professor;
    document.title = 'Prova · ' + c.disciplina + ' · ' + c.turma;
    if (c.instrucoes && !$('#l-extra').childNodes.length) $('#l-extra').append(h('div', { class: 'alerta info' }, c.instrucoes));
    const est = estadoLocal();
    const pil = $('#l-estado'), jan = $('#l-janela'), btn = $('#btn-iniciar');
    const rotulos = { nao_configurada: ['Horário não definido', ''], antes: ['Aguardando início', 'ambar'], aberta: ['Prova aberta', 'verde'], encerrada: ['Prova encerrada', 'vermelho'] };
    pil.className = 'pilula ' + rotulos[est][1];
    P.set(pil, h('span', { class: 'ponto' }), ' ' + rotulos[est][0]);
    const linhaHorario = c.inicio ? h('span', null, 'Início: ', h('b', null, P.fmtDataHora(c.inicio)), ' · Término máximo: ', h('b', null, P.fmtDataHora(c.fim))) : null;
    if (est === 'nao_configurada') P.set(jan, h('span', null, 'O professor ainda não definiu o horário da prova.'));
    else if (est === 'antes') P.set(jan, linhaHorario, h('span', { class: 'muted' }, 'A prova abre em'), h('span', { class: 'contagem' }, P.fmtDurLonga(c.inicio - agoraServ())));
    else if (est === 'aberta') P.set(jan, linhaHorario, h('span', { class: 'muted' }, 'Tempo restante até o término'), h('span', { class: 'contagem' }, P.fmtDur(c.fim - agoraServ())));
    else P.set(jan, linhaHorario, h('span', null, 'O prazo desta prova terminou. Não é mais possível iniciá-la.'));
    btn.disabled = est !== 'aberta' || S.entrando;
    if (estadoAnterior && estadoAnterior !== est) carregarStatus();
    estadoAnterior = est;
  }

  function prepararLanding() {
    try {
      const u = JSON.parse(localStorage.getItem(LS + 'ultimo') || 'null');
      if (u) { $('#in-nome').value = u.nome || ''; $('#in-mat').value = u.matricula || ''; mostrarJaEnviada(); }
    } catch (e) { }
    $('#in-mat').addEventListener('input', mostrarJaEnviada);
    $('#f-inicio').addEventListener('submit', entrar);
    carregarStatus();
    setInterval(atualizarLanding, 1000);
    setInterval(() => { if (!S.emProva) carregarStatus(); }, 30000);
  }

  function mostrarJaEnviada() {
    const mat = normMat($('#in-mat').value);
    const loc = mat ? lerLocal(mat) : null;
    const box = $('#l-ja-enviada');
    if (loc && loc.finalizado && loc.codigo) {
      P.set(box, h('div', { class: 'alerta ok' },
        h('div', null, 'Esta matrícula já enviou a prova neste navegador. Código de consulta: ', h('b', { class: 'mono' }, loc.codigo)),
        loc.questoes ? h('button', { class: 'btn mini', style: { marginTop: '8px' }, onclick: () => baixarArquivo(loc) }, 'Baixar meu arquivo de prova') : null));
    } else P.set(box);
  }

  const normMat = m => String(m || '').trim().toUpperCase().replace(/\s+/g, '');

  async function entrar(ev) {
    ev.preventDefault();
    const erro = $('#l-erro');
    P.set(erro);
    const nome = $('#in-nome').value.replace(/\s+/g, ' ').trim();
    const mat = normMat($('#in-mat').value);
    if (nome.length < 5 || nome.indexOf(' ') < 0) return erro.append(h('div', { class: 'alerta erro' }, 'Informe seu nome completo.'));
    if (!/^[A-Z0-9.\-\/_]{3,20}$/.test(mat)) return erro.append(h('div', { class: 'alerta erro' }, 'Informe uma matrícula válida (somente letras, números, ponto ou hífen).'));
    if (!$('#in-ok').checked) return erro.append(h('div', { class: 'alerta erro' }, 'Marque a caixa confirmando que leu as instruções.'));
    if (estadoLocal() !== 'aberta') return erro.append(h('div', { class: 'alerta erro' }, 'A prova não está aberta agora.'));

    // a tela cheia precisa ser pedida dentro do clique
    const fs = entrarTelaCheia();
    S.entrando = true;
    const btn = $('#btn-iniciar');
    btn.disabled = true; btn.textContent = 'Entrando…';
    try {
      const local = lerLocal(mat);
      const r = await P.api('iniciar', { nome, matricula: mat, token: local && !local.finalizado ? local.token : undefined, ua: navigator.userAgent }, { tentativas: 2 });
      await fs.catch(() => { });
      localStorage.setItem(LS + 'ultimo', JSON.stringify({ nome, matricula: mat }));
      iniciarProva(r, local);
    } catch (e) {
      sairTelaCheia();
      erro.append(h('div', { class: 'alerta erro' }, e.message));
    } finally {
      S.entrando = false;
      btn.textContent = 'Iniciar prova em tela cheia';
    }
  }

  // ============================================================
  //  Tela cheia
  // ============================================================
  const fsElemento = () => document.fullscreenElement || document.webkitFullscreenElement || null;
  const fsSuportado = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  function entrarTelaCheia() {
    const el = document.documentElement;
    try {
      if (el.requestFullscreen) return el.requestFullscreen({ navigationUI: 'hide' });
      if (el.webkitRequestFullscreen) { el.webkitRequestFullscreen(); return Promise.resolve(); }
    } catch (e) { return Promise.reject(e); }
    return Promise.reject(new Error('Tela cheia não suportada'));
  }
  function sairTelaCheia() {
    try {
      if (!fsElemento()) return;
      if (document.exitFullscreen) document.exitFullscreen().catch(() => { });
      else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
    } catch (e) { }
  }

  // ============================================================
  //  PROVA
  // ============================================================
  function iniciarProva(r, local) {
    S.offset = r.agora - Date.now();
    S.token = r.token; S.nome = r.nome; S.matricula = r.matricula; S.cfg = r.config;
    S.fimMs = r.config.fim; S.questoes = r.questoes; S.material = r.material || [];
    const mesmoNavegador = local && local.token === r.token && !local.finalizado;
    S.respostas = mesmoNavegador && local.respostas ? local.respostas : (r.respostas || {});
    S.pendentes = mesmoNavegador && Array.isArray(local.pendentes) ? local.pendentes : [];
    S.atual = mesmoNavegador && local.atual < S.questoes.length ? local.atual : 0;
    S.sujo = !!mesmoNavegador;
    S.ultimaSync = Date.now();
    S.emProva = true;
    salvarLocal(true);

    $('#tela-inicio').classList.add('oculto');
    $('#tela-prova').classList.remove('oculto');
    $('#t-nome').textContent = S.nome;
    $('#t-sub').textContent = 'Matrícula ' + S.matricula + ' · ' + S.cfg.disciplina + ' · ' + S.cfg.turma;
    $$('.aba').forEach(b => b.addEventListener('click', () => trocarAba(b.dataset.v)));
    $('#btn-finalizar').addEventListener('click', confirmarFinalizar);
    $('#t-salv').addEventListener('click', () => { if (Date.now() - S.ultimaTentativa > 8000) sincronizar(true); });
    $('#btn-volta-fs').addEventListener('click', () => entrarTelaCheia().catch(() => P.toast('Não foi possível entrar em tela cheia. Tente a tecla F11.', 'erro')));

    renderLateral();
    irPara(S.atual);
    renderMaterial();
    ativarMonitoramento();
    if (!fsSuportado()) registrar('sem_tela_cheia', 'navegador sem suporte a tela cheia');
    else if (!fsElemento()) { registrar('saida_tela_cheia', 'iniciou fora da tela cheia'); mon.fsSaidaEm = Date.now(); mostrarOverlayFS(); }
    if (r.retomada) P.toast('Prova retomada. Suas respostas foram recuperadas.', 'ok', 4500);
    setInterval(tick, 500);
    setInterval(cicloSync, 4000);
    tick();
  }

  function trocarAba(v) {
    $$('.aba').forEach(b => b.classList.toggle('ativa', b.dataset.v === v));
    $('#v-prova').classList.toggle('oculto', v !== 'prova');
    $('#v-material').classList.toggle('oculto', v !== 'material');
    window.scrollTo(0, 0);
  }

  function renderLateral() {
    const lat = $('#lateral');
    P.set(lat);
    let bloco = null, grade = null;
    S.questoes.forEach((q, i) => {
      if (q.bloco !== bloco) {
        bloco = q.bloco;
        lat.append(h('h4', null, bloco));
        grade = h('div', { class: 'grade-q' });
        lat.append(grade);
      }
      grade.append(h('button', { class: 'qnum', 'data-i': i, title: q.titulo, onclick: () => irPara(i) }, String(i + 1)));
    });
    lat.append(h('div', { class: 'legenda' },
      h('span', null, h('i', { style: { background: 'var(--azul-claro)', borderColor: '#b9cdee' } }), 'respondida'),
      h('span', null, h('i'), 'em branco')),
      h('div', { class: 'peq muted', style: { marginTop: '14px' } }, 'Valor total: ', h('b', null, P.fmtNota(S.questoes.reduce((s, q) => s + q.valor, 0))), ' pontos'));
    atualizarLateral();
  }
  function atualizarLateral() {
    $$('.qnum').forEach(b => {
      const i = Number(b.dataset.i);
      b.classList.toggle('resp', W.respondida(S.questoes[i], S.respostas[S.questoes[i].id]));
      b.classList.toggle('atual', i === S.atual);
    });
  }

  function irPara(i) {
    S.atual = Math.max(0, Math.min(S.questoes.length - 1, i));
    const q = S.questoes[S.atual];
    const main = $('#principal');
    const widget = W.render(q, S.respostas[q.id], v => mudou(q.id, v), {});
    P.set(main, 
      h('article', { class: 'questao' },
        h('div', { class: 'q-cab' },
          h('span', { class: 'q-num' }, 'Questão ' + (S.atual + 1) + ' de ' + S.questoes.length + ' · ' + (P.rotuloTipo[q.tipo] || q.tipo)),
          h('span', { class: 'q-valor' }, P.fmtNota(q.valor) + (q.valor === 1 ? ' ponto' : ' pontos'))),
        h('h2', { class: 'q-titulo' }, q.titulo),
        h('div', { class: 'enunciado', html: q.enunciado }),
        widget),
      h('div', { class: 'q-nav' },
        h('button', { class: 'btn', disabled: S.atual === 0, onclick: () => irPara(S.atual - 1) }, '← Anterior'),
        S.atual < S.questoes.length - 1
          ? h('button', { class: 'btn primario', onclick: () => irPara(S.atual + 1) }, 'Próxima →')
          : h('button', { class: 'btn sucesso', onclick: confirmarFinalizar }, 'Revisar e finalizar')));
    atualizarLateral();
    salvarLocal();
    window.scrollTo(0, 0);
  }

  function mudou(qid, v) {
    if (S.finalizando) return;
    if (v === undefined) delete S.respostas[qid]; else S.respostas[qid] = v;
    S.sujo = true;
    salvarLocal();
    atualizarLateral();
    setStatusSalv('pendente');
  }

  // ---------- material de consulta ----------
  function renderMaterial() {
    const busca = h('input', { type: 'text', placeholder: 'Buscar no material…', 'aria-label': 'Buscar no material' });
    const secoes = S.material.map((s, i) => h('section', { class: 'mat-sec', id: 'mat-' + i }, h('h3', null, s.titulo), h('div', { html: s.html })));
    const indice = h('nav', { class: 'mat-indice' }, busca, S.material.map((s, i) =>
      h('button', { 'data-i': i, onclick: () => document.getElementById('mat-' + i).scrollIntoView({ behavior: 'smooth' }) }, s.titulo)));
    busca.addEventListener('input', () => {
      const t = P.norm(busca.value);
      secoes.forEach((sec, i) => {
        const vis = !t || P.norm(sec.textContent).includes(t);
        sec.classList.toggle('oculto', !vis);
        indice.querySelector('[data-i="' + i + '"]').classList.toggle('oculto', !vis);
      });
    });
    P.set($('#material'), indice, h('div', null,
      h('div', { class: 'alerta info mat-aviso' }, 'Resumo dos conceitos trabalhados nas aulas. Ele ajuda a raciocinar, mas não traz as respostas das questões.'),
      secoes));
  }

  // ============================================================
  //  Relógio
  // ============================================================
  function tick() {
    if (S.finalizado) return;
    const rest = S.fimMs - agoraServ();
    const rel = $('#t-relogio');
    rel.textContent = P.fmtDur(rest);
    rel.classList.toggle('alerta5', rest < 5 * 60000 && rest >= 60000);
    rel.classList.toggle('alerta1', rest < 60000);
    [[10, 'Faltam 10 minutos.'], [5, 'Faltam 5 minutos. Revise suas respostas.'], [1, 'Falta 1 minuto! A prova será enviada automaticamente.']].forEach(([m, msg]) => {
      if (rest <= m * 60000 && rest > (m * 60000 - 30000) && !S.avisos[m]) { S.avisos[m] = true; P.toast(msg, 'aviso', 6000); }
    });
    if (rest < 90000 && !S.syncPreFinal) { S.syncPreFinal = true; setTimeout(() => sincronizar(true), Math.random() * 40000); }
    if (rest <= 0 && !S.finalizando) finalizar('tempo');
  }

  // ============================================================
  //  Sincronização com o servidor
  // ============================================================
  function setStatusSalv(st, quando) {
    const el = $('#t-salv');
    el.classList.toggle('erro', st === 'erro');
    el.textContent = st === 'salvando' ? 'Salvando…' : st === 'erro' ? '⚠ Sem conexão — respostas guardadas neste navegador'
      : st === 'pendente' ? (S.ultimaSync ? 'Alterações guardadas localmente' : '—')
        : 'Salvo no servidor às ' + P.fmtHora(quando || Date.now());
  }

  function cicloSync() {
    if (S.finalizando || S.sincronizando) return;
    const desde = Date.now() - S.ultimaTentativa;
    if ((S.pendentes.length && desde > 12000) || (S.sujo && desde > 45000)) sincronizar();
  }

  async function sincronizar(forcar) {
    if (S.sincronizando || S.finalizando || !S.token) return;
    if (!forcar && !S.sujo && !S.pendentes.length) return;
    S.sincronizando = true;
    S.ultimaTentativa = Date.now();
    const evs = S.pendentes.slice();
    const enviarResp = S.sujo || forcar;
    S.sujo = false;
    setStatusSalv('salvando');
    try {
      const r = await P.api('sincronizar', { matricula: S.matricula, token: S.token, respostas: enviarResp ? S.respostas : undefined, eventos: evs }, { tentativas: 0, timeout: 25000 });
      S.pendentes.splice(0, evs.length);
      S.ultimaSync = Date.now();
      if (r.fim && r.fim !== S.fimMs) {
        S.fimMs = r.fim; S.avisos = {}; S.syncPreFinal = false;
        P.toast('Atenção: o horário de término foi alterado para ' + P.fmtHora(r.fim) + '.', 'aviso', 8000);
      }
      if (r.encerrada) return encerradaPeloProfessor(r);
      setStatusSalv(r.salvo || !enviarResp ? 'salvo' : 'pendente', r.agora - S.offset);
    } catch (e) {
      if (enviarResp) S.sujo = true;
      if (e.sessaoInvalida) return sessaoInvalida(e.message);
      setStatusSalv('erro');
    } finally {
      S.sincronizando = false;
      salvarLocal();
    }
  }

  function enviarBeacon() {
    if (!S.token || S.finalizado || S.finalizando) return;
    try {
      const corpo = JSON.stringify({ acao: 'sincronizar', matricula: S.matricula, token: S.token, respostas: S.respostas, eventos: S.pendentes });
      if (navigator.sendBeacon && navigator.sendBeacon(window.PROVA_CONFIG.API_URL, new Blob([corpo], { type: 'text/plain;charset=utf-8' }))) {
        S.pendentes = [];
        salvarLocal(true);
      }
    } catch (e) { }
  }

  // ============================================================
  //  Monitoramento (tela cheia, abas, foco) e bloqueio de copiar/colar
  // ============================================================
  function registrar(tipo, detalhe, durMs) {
    if (!mon.ativo) return;
    S.pendentes.push({ tipo, detalhe: detalhe || '', t: agoraServ(), dur: durMs !== undefined ? Math.round(durMs / 1000) : undefined });
    salvarLocal(true);
  }
  let tAviso = null;
  function avisoEvento(msg) {
    const el = $('#aviso-evento');
    el.textContent = '⚠ ' + msg;
    el.classList.remove('oculto');
    clearTimeout(tAviso);
    tAviso = setTimeout(() => el.classList.add('oculto'), 4500);
  }
  let ultimoBloq = 0;
  function bloquear(e, msg) {
    e.preventDefault();
    e.stopPropagation();
    if (Date.now() - ultimoBloq > 1500) { ultimoBloq = Date.now(); P.toast(msg, 'erro'); }
  }
  function mostrarOverlayFS() { if (fsSuportado() && !S.finalizando) $('#overlay-fs').classList.remove('oculto'); }
  function esconderOverlayFS() { $('#overlay-fs').classList.add('oculto'); }

  function ativarMonitoramento() {
    mon.ativo = true;
    const onFS = () => {
      if (!mon.ativo) return;
      if (!fsElemento()) {
        mon.fsSaidaEm = Date.now();
        registrar('saida_tela_cheia', 'saiu da tela cheia');
        mostrarOverlayFS();
      } else {
        if (mon.fsSaidaEm) { registrar('retorno_tela_cheia', 'voltou para a tela cheia', Date.now() - mon.fsSaidaEm); avisoEvento('Saída da tela cheia registrada'); }
        mon.fsSaidaEm = null;
        esconderOverlayFS();
      }
    };
    document.addEventListener('fullscreenchange', onFS);
    document.addEventListener('webkitfullscreenchange', onFS);

    document.addEventListener('visibilitychange', () => {
      if (!mon.ativo) return;
      if (document.hidden) {
        mon.ocultaEm = Date.now();
        registrar('aba_oculta', 'trocou de aba ou minimizou a janela');
      } else if (mon.ocultaEm) {
        registrar('aba_visivel', 'voltou para a prova', Date.now() - mon.ocultaEm);
        mon.ocultaEm = null;
        avisoEvento('Troca de aba / minimização registrada');
        sincronizar();
      }
    });
    window.addEventListener('blur', () => {
      setTimeout(() => {
        if (!mon.ativo || document.hidden || document.hasFocus() || mon.focoEm) return;
        mon.focoEm = Date.now();
        registrar('perda_foco', 'a janela da prova perdeu o foco (outro programa ou janela)');
      }, 250);
    });
    window.addEventListener('focus', () => {
      if (!mon.ativo || !mon.focoEm) return;
      registrar('retorno_foco', 'a janela da prova recuperou o foco', Date.now() - mon.focoEm);
      mon.focoEm = null;
      avisoEvento('Perda de foco da janela registrada');
    });

    const MSG = 'Copiar, recortar e colar estão bloqueados durante a prova.';
    ['copy', 'cut', 'paste'].forEach(t => document.addEventListener(t, e => { if (mon.ativo) bloquear(e, MSG); }, true));
    document.addEventListener('beforeinput', e => { if (mon.ativo && /^insertFrom(Paste|Drop|Yank)/.test(e.inputType || '')) bloquear(e, MSG); }, true);
    document.addEventListener('drop', e => { if (mon.ativo) bloquear(e, 'Arrastar conteúdo externo para a prova está bloqueado.'); }, true);
    document.addEventListener('dragstart', e => { if (mon.ativo) e.preventDefault(); }, true);
    document.addEventListener('contextmenu', e => { if (mon.ativo) e.preventDefault(); }, true);
    document.addEventListener('keydown', e => {
      if (!mon.ativo) return;
      const k = (e.key || '').toLowerCase();
      const mod = e.ctrlKey || e.metaKey;
      if ((mod && ['c', 'v', 'x'].includes(k)) || (e.shiftKey && k === 'insert') || (mod && k === 'insert') || (e.shiftKey && k === 'delete')) return bloquear(e, MSG);
      if ((mod && ['p', 's', 'u'].includes(k)) || k === 'f12' || (mod && e.shiftKey && ['i', 'j', 'c', 'k'].includes(k))) return bloquear(e, 'Atalho bloqueado durante a prova.');
    }, true);
    window.addEventListener('beforeunload', e => { if (mon.ativo && !S.finalizado) { e.preventDefault(); e.returnValue = ''; } });
    window.addEventListener('pagehide', enviarBeacon);
  }

  // ============================================================
  //  Finalização
  // ============================================================
  async function confirmarFinalizar() {
    if (S.finalizando) return;
    const brancas = [], incompletas = [];
    S.questoes.forEach((q, i) => {
      const r = S.respostas[q.id];
      if (!W.respondida(q, r)) brancas.push(i + 1);
      else if (W.incompleta(q, r)) incompletas.push(i + 1);
    });
    const corpo = h('div', null,
      h('p', null, 'Depois de enviar, não será possível alterar as respostas.'),
      brancas.length ? h('div', { class: 'alerta aviso' }, 'Questões em branco: ', h('b', null, brancas.join(', '))) : h('div', { class: 'alerta ok' }, 'Todas as questões têm resposta.'),
      incompletas.length ? h('div', { class: 'alerta aviso' }, 'Questões incompletas: ', h('b', null, incompletas.join(', '))) : null);
    const ok = await P.modal({ titulo: 'Finalizar e enviar a prova?', corpo, botoes: [{ texto: 'Voltar à prova', valor: false }, { texto: 'Enviar agora', classe: 'sucesso', valor: true }] });
    if (ok) finalizar('aluno');
  }

  function telaEnvio(titulo, msg, comSpinner, acoes) {
    $('#overlay-envio').classList.remove('oculto');
    $('#env-titulo').textContent = titulo;
    $('#env-msg').textContent = msg;
    $('#env-spin').classList.toggle('oculto', !comSpinner);
    P.set($('#env-acoes'), acoes || []);
  }
  const botaoBaixar = () => h('button', { class: 'btn', style: { marginTop: '12px' }, onclick: () => baixarArquivo() }, 'Baixar meu arquivo de prova');
  const naoRepetir = e => e.sessaoInvalida || /bloquead|não encontrada|outro dispositivo|já foi enviada/i.test(e.message || '');

  async function finalizar(motivo) {
    if (S.finalizando) return;
    S.finalizando = true;
    mon.ativo = false;
    esconderOverlayFS();
    salvarLocal(true);
    telaEnvio(motivo === 'tempo' ? 'Tempo esgotado' : 'Enviando sua prova…',
      motivo === 'tempo' ? 'A prova foi bloqueada e está sendo enviada automaticamente. Não feche esta janela.' : 'Não feche esta janela.', true);
    if (motivo === 'tempo') await P.sleep(Math.random() * 6000); // espalha os envios simultâneos
    let tent = 0;
    while (true) {
      try {
        const r = await P.api('finalizar', { matricula: S.matricula, token: S.token, respostas: S.respostas, eventos: S.pendentes, motivo }, { tentativas: 0, timeout: 45000 });
        S.pendentes = [];
        S.codigo = r.codigo;
        S.envio = r.envio || new Date().toISOString();
        break;
      } catch (e) {
        if (naoRepetir(e)) {
          telaEnvio('Não foi possível enviar', e.message + ' Baixe seu arquivo e procure o professor.', false, [botaoBaixar()]);
          return;
        }
        tent++;
        if (tent >= 40) {
          telaEnvio('Não foi possível enviar', 'O servidor não respondeu. Baixe seu arquivo agora e entregue-o ao professor.', false, [botaoBaixar(), h('button', { class: 'btn primario', style: { marginTop: '12px', marginLeft: '8px' }, onclick: () => { S.finalizando = false; finalizar(motivo); } }, 'Tentar de novo')]);
          return;
        }
        telaEnvio('Tentando enviar…', 'Falha de comunicação (tentativa ' + tent + '). Tentando de novo automaticamente. Suas respostas estão guardadas neste navegador.', true, [botaoBaixar()]);
        await P.sleep(Math.min(20000, 2500 * tent));
      }
    }
    S.finalizado = true;
    salvarLocal(true);
    mostrarFim(motivo);
  }

  function mostrarFim(motivo, msgExtra) {
    sairTelaCheia();
    $('#overlay-envio').classList.add('oculto');
    $('#overlay-fs').classList.add('oculto');
    $('#aviso-evento').classList.add('oculto');
    $('#tela-prova').classList.add('oculto');
    const fim = $('#tela-fim');
    fim.classList.remove('oculto');
    P.set(fim, h('div', { class: 'fim' }, h('div', { class: 'cartao', style: { borderTop: '4px solid var(--bordo)' } },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '14px' } },
        h('img', { src: 'img/uepa-logo.png', alt: 'UEPA', style: { height: '64px' } }),
        h('div', null, h('div', { class: 'peq', style: { fontWeight: '700', color: 'var(--bordo)', textTransform: 'uppercase', letterSpacing: '.06em' } }, 'Universidade do Estado do Pará'),
          h('div', { class: 'peq muted' }, (S.cfg ? S.cfg.disciplina + ' · Turma ' + S.cfg.turma : '')))),
      h('div', { class: 'pilula verde', style: { marginBottom: '12px' } }, '✓ Prova recebida pelo servidor'),
      h('h1', null, motivo === 'tempo' ? 'Tempo esgotado: prova enviada' : 'Prova enviada com sucesso'),
      msgExtra ? h('div', { class: 'alerta info' }, msgExtra) : null,
      h('p', null, S.nome + ' · Matrícula ' + S.matricula + ' · enviada em ' + P.fmtDataHora(S.envio)),
      S.codigo ? [h('p', { style: { marginTop: '18px', marginBottom: '0' } }, h('b', null, 'Seu código de consulta:')),
      h('div', { class: 'codigo-grande' }, S.codigo),
      h('p', { class: 'peq muted' }, 'Anote este código. Com ele e sua matrícula você verá a correção na página de consulta, quando o professor liberar os resultados.')] : null,
      h('div', { style: { display: 'flex', gap: '10px', flexWrap: 'wrap', marginTop: '16px' } },
        h('button', { class: 'btn primario', onclick: () => baixarArquivo() }, 'Baixar meu arquivo de prova'),
        h('a', { class: 'btn', href: 'consulta.html' }, 'Página de consulta')))));
    window.scrollTo(0, 0);
  }

  function encerradaPeloProfessor(r) {
    mon.ativo = false;
    S.finalizando = true;
    if (r.status === 'bloqueada') {
      telaEnvio('Acesso bloqueado', 'O professor bloqueou o acesso desta prova. Baixe seu arquivo e procure-o.', false, [botaoBaixar()]);
      return;
    }
    S.finalizado = true;
    S.codigo = r.codigo || S.codigo;
    S.envio = r.envio || new Date().toISOString();
    salvarLocal(true);
    mostrarFim('professor', 'Sua prova foi encerrada pelo professor. Valeram as respostas da última gravação no servidor.');
  }

  function sessaoInvalida(msg) {
    mon.ativo = false;
    S.finalizando = true;
    telaEnvio('Sessão encerrada', msg + ' Se não foi você, avise o professor imediatamente.', false, [botaoBaixar()]);
  }

  // ============================================================
  //  Arquivo do aluno (HTML autossuficiente)
  // ============================================================
  async function sha256(txt) {
    try {
      const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt));
      return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
    } catch (e) { return '(indisponível neste navegador)'; }
  }

  async function baixarArquivo(fonte) {
    const d = fonte ? {
      nome: fonte.nome, matricula: normMat($('#in-mat').value), questoes: fonte.questoes, respostas: fonte.respostas,
      codigo: fonte.codigo, envio: fonte.envio, cfg: fonte.cfg || S.cfg || {}
    } : { nome: S.nome, matricula: S.matricula, questoes: S.questoes, respostas: S.respostas, codigo: S.codigo, envio: S.envio, cfg: S.cfg || {} };
    const E = P.esc;
    const hash = await sha256(JSON.stringify(d.respostas));
    const blocos = d.questoes.map((q, i) => {
      const r = d.respostas[q.id];
      let resp;
      if (q.tipo === 'objetiva') {
        resp = '<ol type="A" class="ops">' + q.opcoes.map(op => '<li' + (op.id === r ? ' class="marcada"' : '') + '>' + E(op.texto) + (op.id === r ? ' <b>← marcada</b>' : '') + '</li>').join('') + '</ol>' + (r ? '' : '<p class="branco">(em branco)</p>');
      } else if (q.tipo === 'der') {
        resp = (W.respondida(q, r) ? '<div class="svg">' + W.derSVG(r) + '</div>' : '') + '<pre>' + E(W.texto(q, r)) + '</pre>';
      } else resp = '<pre>' + E(W.texto(q, r)) + '</pre>';
      return '<section><h2>Questão ' + (i + 1) + ' · ' + E(q.titulo) + ' <small>(' + E(P.rotuloTipo[q.tipo]) + ' · ' + P.fmtNota(q.valor) + ' pt)</small></h2>' +
        '<div class="enun">' + q.enunciado + '</div><h3>Resposta</h3>' + resp + '</section>';
    }).join('\n');
    const dados = JSON.stringify({ nome: d.nome, matricula: d.matricula, codigo: d.codigo, envio: d.envio, respostas: d.respostas }).replace(/</g, '\\u003c');
    const html = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Prova ' + E(d.cfg.disciplina || '') + ' – ' + E(d.nome) + '</title><style>' +
      'body{font-family:Segoe UI,Arial,sans-serif;max-width:900px;margin:30px auto;padding:0 18px;color:#18212f;line-height:1.5}' +
      'header{border-bottom:3px solid #f0b400;margin-bottom:18px;padding-bottom:12px;display:flex;gap:18px;align-items:center}header img{height:96px}' +
      '.inst{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:#7e3434;font-weight:700}h1{margin:0 0 6px;font-size:22px;color:#5a2226}' +
      'section{border-left:4px solid #7e3434 !important}h3{color:#7e3434 !important}.marcada{background:#fff6dc !important}.cod{background:#fff6dc !important;border:1px dashed #f0b400}' +
      'section{border:1px solid #dfe3ea;border-radius:8px;padding:14px 18px;margin:14px 0;break-inside:avoid}h2{font-size:16px;margin:0 0 8px}h2 small{color:#6b7790;font-weight:400}' +
      'h3{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#1d4f91;margin:12px 0 6px}pre{white-space:pre-wrap;background:#f5f6f8;padding:10px;border-radius:6px;font-family:Consolas,monospace;font-size:13px}' +
      'table{border-collapse:collapse;font-size:13px}td,th{border:1px solid #ccc;padding:3px 8px}.ops li{margin:3px 0}.marcada{background:#e8f0fb;font-weight:600}.branco{color:#a86400}' +
      '.svg svg{max-width:100%;height:auto;border:1px solid #dfe3ea;border-radius:6px}.cod{font-family:Consolas,monospace;font-size:20px;letter-spacing:.1em;background:#eef1f5;padding:4px 10px;border-radius:6px}' +
      'footer{margin-top:24px;font-size:12px;color:#6b7790;word-break:break-all}</style></head><body>' +
      '<header>' + (P.LOGO_UEPA ? '<img src="' + P.LOGO_UEPA + '" alt="UEPA">' : '') + '<div><div class="inst">Universidade do Estado do Pará</div><h1>' + E(d.cfg.disciplina || '') + ' · ' + E(d.cfg.titulo || 'Prova') + '</h1>' +
      '<div>Turma ' + E(d.cfg.turma || '') + ' · ' + E(d.cfg.professor || '') + '</div>' +
      '<div><b>' + E(d.nome) + '</b> · Matrícula ' + E(d.matricula) + '</div>' +
      '<div>' + (d.envio ? 'Enviada em ' + E(P.fmtDataHora(d.envio)) : '<b>Atenção: arquivo gerado antes da confirmação de envio ao servidor.</b>') + '</div>' +
      (d.codigo ? '<div style="margin-top:6px">Código de consulta: <span class="cod">' + E(d.codigo) + '</span></div>' : '') + '</div></header>' +
      blocos + '<footer>Arquivo gerado em ' + E(P.fmtDataHora(Date.now())) + '. SHA-256 das respostas: ' + hash + '</footer>' +
      '<script type="application/json" id="dados-prova">' + dados + '<\/script></body></html>';
    P.baixar('prova_BD1_' + (d.matricula || 'aluno') + '.html', html, 'text/html;charset=utf-8');
  }

  prepararLanding();
})();
