/* Página de consulta: o aluno vê a própria prova corrigida, depois que o professor libera. */
(function () {
  'use strict';
  const { h, $ } = P;
  const W = P.widgets;

  $('#f-consulta').addEventListener('submit', async e => {
    e.preventDefault();
    P.set($('#c-erro'));
    const btn = e.target.querySelector('button');
    btn.disabled = true; btn.textContent = 'Consultando…';
    try {
      const r = await P.api('consulta', { matricula: $('#c-mat').value, codigo: $('#c-cod').value });
      mostrar(r);
    } catch (err) {
      P.set($('#c-erro'), h('div', { class: 'alerta erro' }, err.message));
    } finally {
      btn.disabled = false; btn.textContent = 'Ver minha prova';
    }
  });

  function mostrar(r) {
    const n = r.notas;
    const pend = n.pendentes.length;
    const blocos = r.questoes.map((q, i) => {
      const nq = n.porQuestao[q.id] || {};
      const g = r.gabarito ? r.gabarito[q.id] : null;
      const nota = nq.nota === null || nq.nota === undefined
        ? h('span', { class: 'pilula ambar' }, 'aguardando correção')
        : h('span', { class: 'pilula ' + (nq.nota >= q.valor - 1e-9 ? 'verde' : nq.nota > 0 ? 'azul' : 'vermelho') }, P.fmtNota(nq.nota) + ' / ' + P.fmtNota(q.valor));
      return h('section', { class: 'q-resultado' },
        h('div', { class: 'q-cab' }, h('span', { class: 'q-num' }, 'Questão ' + (i + 1) + ' · ' + (P.rotuloTipo[q.tipo] || q.tipo)), nota),
        h('h3', null, q.titulo),
        h('details', { open: q.tipo === 'objetiva' }, h('summary', { class: 'peq muted' }, 'Enunciado'), h('div', { class: 'enunciado', html: q.enunciado })),
        W.render(q, r.respostas[q.id], null, { readonly: true, gabarito: g }),
        (nq.detalhes && nq.detalhes.length && q.tipo !== 'objetiva' && !nq.ajustada) ? h('div', { class: 'det-auto' }, nq.detalhes.map(d => h('div', null, d))) : null,
        nq.feedback ? h('div', { class: 'feedback' }, h('b', null, 'Comentário do professor: '), nq.feedback) : null);
    });
    P.set($('#c-resultado'),
      h('div', { class: 'cartao', style: { marginBottom: '18px', borderTop: '4px solid var(--bordo)' } },
        h('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end' } },
          h('div', { class: 'marca-id' }, h('img', { src: 'img/uepa-logo.png', alt: 'UEPA', style: { height: '84px' } }), h('div', null,
            h('div', { class: 'peq', style: { textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: '700', color: 'var(--bordo)' } }, 'Universidade do Estado do Pará'),
            h('div', { class: 'sobre muted peq', style: { textTransform: 'uppercase', letterSpacing: '.08em', fontWeight: '600' } }, r.config.disciplina + ' · Turma ' + r.config.turma),
            h('h1', { style: { margin: '4px 0' } }, r.config.titulo),
            h('div', null, h('b', null, r.aluno.nome), ' · Matrícula ', r.aluno.matricula),
            h('div', { class: 'peq muted' }, 'Enviada em ' + P.fmtDataHora(r.aluno.envio)))),
          h('div', { style: { textAlign: 'right' } },
            h('div', { class: 'peq muted' }, 'NOTA'),
            h('div', { class: 'nota-grande' }, P.fmtNota(n.total), h('span', { class: 'muted', style: { fontSize: '1rem' } }, ' / ' + P.fmtNota(n.max))),
            pend ? h('span', { class: 'pilula ambar' }, pend + ' questão(ões) aguardando correção') : null)),
        n.feedbackGeral ? h('div', { class: 'feedback' }, h('b', null, 'Comentário geral: '), n.feedbackGeral) : null,
        h('div', { class: 'no-print', style: { marginTop: '14px', display: 'flex', gap: '8px' } },
          h('button', { class: 'btn', onclick: () => window.print() }, 'Imprimir / salvar PDF'),
          h('button', { class: 'btn fantasma', onclick: () => location.reload() }, 'Sair'))),
      blocos);
    $('#c-form-box').classList.add('oculto');
    $('#c-resultado').classList.remove('oculto');
    window.scrollTo(0, 0);
  }
})();
