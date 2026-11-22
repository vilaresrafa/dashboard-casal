'use strict';
/**
 * Testes do backend (apps-script/Code.js) rodando contra a planilha falsa de testes/ambiente.js.
 * Rodar: npm test   (ou: node --test testes/)
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { criarAmbiente, dataSP } = require('./ambiente');

// Quarta-feira, 18/11/2026, meio-dia em São Paulo.
const QUARTA = '2026-11-18T12:00:00-03:00';
const PIN_ELE = '111111';
const PIN_ELA = '222222';

// JPEG mínimo só para o formato passar (o conteúdo não é aberto pelo backend).
const JPEG = 'data:image/jpeg;base64,' + Buffer.from('foto-de-teste-1').toString('base64');
const JPEG2 = 'data:image/jpeg;base64,' + Buffer.from('foto-de-teste-2').toString('base64');
const MINI = 'data:image/jpeg;base64,' + Buffer.from('mini-1').toString('base64');
const MINI2 = 'data:image/jpeg;base64,' + Buffer.from('mini-2').toString('base64');

function preparado(agora = QUARTA) {
  const amb = criarAmbiente({ agora });
  amb.ctx.prepararPlanilha_();
  amb.ctx.definirPin_('ele', PIN_ELE);
  amb.ctx.definirPin_('ela', PIN_ELA);
  amb.tk = { ele: amb.login('ele', PIN_ELE), ela: amb.login('ela', PIN_ELA) };
  amb.como = (p, acao, dados = {}) => amb.chamar(acao, Object.assign({ token: amb.tk[p] }, dados));
  amb.ok = (p, acao, dados) => {
    const r = amb.como(p, acao, dados);
    assert.equal(r.ok, true, `${acao} falhou: ${r.erro} ${r.detalhe || ''}`);
    return r;
  };
  amb.falha = (p, acao, dados, codigo) => {
    const r = amb.como(p, acao, dados);
    assert.equal(r.ok, false, `${acao} deveria falhar`);
    if (codigo) assert.equal(r.codigo, codigo, r.erro);
    return r;
  };
  return amb;
}

/* ---------------- Preparação da planilha ---------------- */

test('prepararPlanilha cria todas as abas com cabeçalhos e é idempotente', () => {
  const amb = criarAmbiente({ agora: QUARTA });
  amb.ctx.prepararPlanilha_();
  amb.ctx.prepararPlanilha_();
  const nomes = amb.ss.getSheets().map((s) => s.getName()).sort();
  assert.deepEqual(nomes, ['Dieta', 'MetasLongo', 'MetasSemana', 'MetasSemanaLog', 'Miniaturas', 'Momentos', 'Peso', 'Pessoas', 'Tarefas']);
  const pessoas = amb.aba('Pessoas').objetos().map((o) => o.id);
  assert.deepEqual(pessoas, ['ele', 'ela']);
  assert.equal(amb.aba('Miniaturas').isSheetHidden(), true);
  assert.equal(amb.ss.getSpreadsheetTimeZone(), 'America/Sao_Paulo');
  assert.ok(amb.props.get('PLANILHA_ID'));
  assert.ok(amb.props.get('PASTA_FOTOS'));
});

test('prepararPlanilha completa colunas que faltam sem apagar dados', () => {
  const amb = criarAmbiente({ agora: QUARTA });
  const sh = amb.ss.insertSheet('Tarefas');
  sh.getRange(1, 1, 1, 4).setValues([['id', 'pessoa', 'data', 'texto']]);
  sh.escreverCru(2, 1, 't_antiga');
  sh.escreverCru(2, 2, 'ele');
  sh.escreverCru(2, 3, '2026-11-18');
  sh.escreverCru(2, 4, 'Tarefa antiga');
  amb.ctx.prepararPlanilha_();
  const cab = [];
  for (let c = 1; c <= sh.getLastColumn(); c++) cab.push(sh.ler(1, c));
  assert.deepEqual(cab.slice(0, 4), ['id', 'pessoa', 'data', 'texto']);
  assert.ok(cab.includes('pendencia'));
  assert.equal(sh.ler(2, 4), 'Tarefa antiga');
});

/* ---------------- Login e PIN ---------------- */

test('login: sem PIN definido, PIN errado, bloqueio e desbloqueio após 15 minutos', () => {
  const amb = criarAmbiente({ agora: QUARTA });
  amb.ctx.prepararPlanilha_();
  let r = amb.chamar('login', { pessoa: 'ele', pin: '1234' });
  assert.equal(r.codigo, 'sem_pin');

  amb.ctx.definirPin_('ele', PIN_ELE);
  for (let i = 1; i <= 4; i++) {
    r = amb.chamar('login', { pessoa: 'ele', pin: '000000' });
    assert.equal(r.ok, false);
    assert.equal(r.codigo, 'pin');
  }
  r = amb.chamar('login', { pessoa: 'ele', pin: '000000' });
  assert.equal(r.codigo, 'bloqueado');
  r = amb.chamar('login', { pessoa: 'ele', pin: PIN_ELE });
  assert.equal(r.codigo, 'bloqueado', 'mesmo com o PIN certo, fica bloqueado');

  // O bloqueio de uma pessoa não afeta a outra
  amb.ctx.definirPin_('ela', PIN_ELA);
  assert.equal(amb.chamar('login', { pessoa: 'ela', pin: PIN_ELA }).ok, true);

  amb.avancar(16 * 60 * 1000);
  r = amb.chamar('login', { pessoa: 'ele', pin: PIN_ELE });
  assert.equal(r.ok, true);
  assert.equal(r.pessoa, 'ele');
  assert.match(r.token, /^[a-f0-9]{64}$/);
});

test('PIN não é guardado em texto puro e precisa ter 4 a 8 números', () => {
  const amb = criarAmbiente({ agora: QUARTA });
  amb.ctx.prepararPlanilha_();
  amb.ctx.definirPin_('ele', PIN_ELE);
  const valores = Array.from(amb.props.values()).join('|');
  assert.ok(!valores.includes(PIN_ELE));
  assert.throws(() => amb.ctx.definirPin_('ele', '12'), /4 a 8/);
  assert.throws(() => amb.ctx.definirPin_('ele', 'abcdef'), /4 a 8/);
  assert.throws(() => amb.ctx.definirPin_('fulano', '1234'), /inválida/);
});

test('sessão: token inválido, ausente e sair', () => {
  const amb = preparado();
  assert.equal(amb.chamar('estado', {}).codigo, 'sessao');
  assert.equal(amb.chamar('estado', { token: 'abc' }).codigo, 'sessao');
  assert.equal(amb.chamar('estado', { token: 'f'.repeat(64) }).codigo, 'sessao');
  amb.ok('ele', 'estado');
  amb.ok('ele', 'sair');
  amb.falha('ele', 'estado', {}, 'sessao');
  amb.ok('ela', 'estado');
});

test('trocar PIN: exige o atual, mantém a sessão atual e derruba as outras', () => {
  const amb = preparado();
  const outroAparelho = amb.login('ele', PIN_ELE);
  amb.falha('ele', 'trocarPin', { pinAtual: '999999', pinNovo: '654321' }, 'pin');
  amb.falha('ele', 'trocarPin', { pinAtual: PIN_ELE, pinNovo: '12' });
  amb.ok('ele', 'trocarPin', { pinAtual: PIN_ELE, pinNovo: '654321' });
  amb.ok('ele', 'estado');
  assert.equal(amb.chamar('estado', { token: outroAparelho }).codigo, 'sessao');
  assert.equal(amb.chamar('login', { pessoa: 'ele', pin: PIN_ELE }).ok, false);
  assert.equal(amb.chamar('login', { pessoa: 'ele', pin: '654321' }).ok, true);
  amb.ok('ela', 'estado'); // a sessão dela não é afetada
});

/* ---------------- Tarefas ---------------- */

test('tarefas: criar, marcar, editar e excluir; listas separadas por pessoa', () => {
  const amb = preparado();
  let e = amb.ok('ele', 'addTarefa', { data: '2026-11-18', texto: '  Academia   às 7h ' }).estado;
  assert.equal(e.hoje, '2026-11-18');
  assert.equal(e.amanha, '2026-11-19');
  assert.equal(e.tarefas.hoje.ele.length, 1);
  assert.equal(e.tarefas.hoje.ele[0].texto, 'Academia às 7h');
  assert.equal(e.tarefas.hoje.ela.length, 0);
  amb.ok('ela', 'addTarefa', { data: '2026-11-18', texto: 'Inglês' });
  amb.ok('ela', 'addTarefa', { data: '2026-11-19', texto: 'Mercado' });

  e = amb.ok('ele', 'estado').estado;
  assert.equal(e.eu, 'ele');
  assert.deepEqual(e.tarefas.hoje.ela.map((t) => t.texto), ['Inglês']);
  assert.deepEqual(e.tarefas.amanha.ela.map((t) => t.texto), ['Mercado']);

  const id = e.tarefas.hoje.ele[0].id;
  e = amb.ok('ele', 'marcarTarefa', { id, feita: true }).estado;
  assert.equal(e.tarefas.hoje.ele[0].feita, true);
  assert.equal(e.tarefas.hoje.ele[0].feitaEm, '2026-11-18T12:00:00');
  e = amb.ok('ele', 'marcarTarefa', { id, feita: false }).estado;
  assert.equal(e.tarefas.hoje.ele[0].feita, false);
  assert.equal(e.tarefas.hoje.ele[0].feitaEm, '');
  e = amb.ok('ele', 'editarTarefa', { id, texto: 'Academia (perna)' }).estado;
  assert.equal(e.tarefas.hoje.ele[0].texto, 'Academia (perna)');
  amb.falha('ele', 'editarTarefa', { id, texto: '   ' });
  e = amb.ok('ele', 'excluirTarefa', { id }).estado;
  assert.equal(e.tarefas.hoje.ele.length, 0);
  assert.equal(e.tarefas.hoje.ela.length, 1, 'excluir não pode apagar a linha errada');
  amb.falha('ele', 'marcarTarefa', { id, feita: true }, 'nao_encontrado');
});

test('ninguém mexe na tarefa do outro', () => {
  const amb = preparado();
  const e = amb.ok('ela', 'addTarefa', { data: '2026-11-18', texto: 'Pilates' }).estado;
  const id = e.tarefas.hoje.ela[0].id;
  amb.falha('ele', 'marcarTarefa', { id, feita: true }, 'proibido');
  amb.falha('ele', 'editarTarefa', { id, texto: 'x' }, 'proibido');
  amb.falha('ele', 'excluirTarefa', { id }, 'proibido');
  amb.falha('ele', 'trazerTarefa', { id }, 'proibido');
  assert.equal(amb.ok('ela', 'estado').estado.tarefas.hoje.ela[0].feita, false);
});

test('a lista de amanhã vira a lista de hoje no dia seguinte', () => {
  const amb = preparado('2026-11-18T22:30:00-03:00');
  amb.ok('ele', 'addTarefa', { data: '2026-11-19', texto: 'Estudar PO' });
  assert.equal(amb.ok('ele', 'estado').estado.tarefas.amanha.ele.length, 1);
  amb.definirAgora('2026-11-19T03:10:00-03:00');
  const e = amb.ok('ele', 'estado').estado;
  assert.equal(e.hoje, '2026-11-19');
  assert.deepEqual(e.tarefas.hoje.ele.map((t) => t.texto), ['Estudar PO']);
  assert.equal(e.tarefas.amanha.ele.length, 0);
});

test('virada do dia usa o fuso de São Paulo (23h de SP já é amanhã em UTC)', () => {
  const amb = preparado('2026-11-18T23:30:00-03:00');
  assert.equal(amb.ok('ele', 'estado').estado.hoje, '2026-11-18');
});

test('o dia só vira às 3h da manhã: de madrugada ainda vale o dia anterior', () => {
  const amb = preparado('2026-11-18T23:00:00-03:00');
  amb.ok('ele', 'addTarefa', { data: '2026-11-18', texto: 'Revisar o capítulo' });
  amb.ok('ele', 'addTarefa', { data: '2026-11-19', texto: 'Academia' });
  amb.aba('Dieta').acrescentarCru({ data: '2026-11-18', pessoa: 'ele', refeicao: 'Ceia', alimento: 'Pão', kcal: 200 });

  amb.definirAgora('2026-11-19T01:30:00-03:00');
  let e = amb.ok('ele', 'estado').estado;
  assert.equal(e.hoje, '2026-11-18');
  assert.equal(e.amanha, '2026-11-19');
  assert.deepEqual(e.tarefas.hoje.ele.map((t) => t.texto), ['Revisar o capítulo']);
  assert.deepEqual(e.tarefas.amanha.ele.map((t) => t.texto), ['Academia']);
  assert.equal(e.dieta.ele.totais.kcal, 200);
  // o que for feito de madrugada conta para o dia anterior
  amb.ok('ele', 'addTarefa', { data: e.hoje, texto: 'Lavar a louça' });
  e = amb.ok('ele', 'salvarMomento', { recado: 'boa noite' }).estado;
  assert.equal(e.momentos.ele.recado, 'boa noite');
  assert.equal(amb.aba('Momentos').objetos()[0].data, '2026-11-18');
  assert.equal(e.tarefas.hoje.ele.length, 2);

  amb.definirAgora('2026-11-19T02:59:00-03:00');
  assert.equal(amb.ok('ele', 'estado').estado.hoje, '2026-11-18');
  amb.definirAgora('2026-11-19T03:00:00-03:00');
  e = amb.ok('ele', 'estado').estado;
  assert.equal(e.hoje, '2026-11-19');
  assert.deepEqual(e.tarefas.hoje.ele.map((t) => t.texto), ['Academia']);
  assert.equal(e.dieta.ele.totais.kcal, 0);
  assert.equal(e.momentos.ele, null);
});

test('datas fora do intervalo são recusadas', () => {
  const amb = preparado();
  amb.falha('ele', 'addTarefa', { data: '2026-11-10', texto: 'velha' });
  amb.falha('ele', 'addTarefa', { data: '2026-12-31', texto: 'longe' });
  amb.ok('ele', 'addTarefa', { data: '2026-11-25', texto: 'semana que vem' });
  amb.falha('ele', 'addTarefa', { data: '2026-11-18', texto: '' });
});

test('pendentes: aparecem, podem ser trazidas para hoje ou descartadas', () => {
  const amb = preparado('2026-11-17T20:00:00-03:00');
  amb.ok('ele', 'addTarefa', { data: '2026-11-17', texto: 'Ligar pro dentista' });
  amb.ok('ele', 'addTarefa', { data: '2026-11-17', texto: 'Lavar roupa' });
  const feita = amb.ok('ele', 'addTarefa', { data: '2026-11-17', texto: 'Feita' }).estado.tarefas.hoje.ele[2];
  amb.ok('ele', 'marcarTarefa', { id: feita.id, feita: true });

  amb.definirAgora(QUARTA);
  let e = amb.ok('ele', 'estado').estado;
  assert.deepEqual(e.tarefas.pendentes.ele.map((t) => t.texto), ['Ligar pro dentista', 'Lavar roupa']);
  const [dentista, roupa] = e.tarefas.pendentes.ele;

  e = amb.ok('ele', 'trazerTarefa', { id: dentista.id }).estado;
  assert.deepEqual(e.tarefas.hoje.ele.map((t) => t.texto), ['Ligar pro dentista']);
  assert.equal(e.tarefas.hoje.ele[0].origem, 'trazida');
  assert.deepEqual(e.tarefas.pendentes.ele.map((t) => t.texto), ['Lavar roupa']);

  e = amb.ok('ele', 'descartarPendente', { id: roupa.id }).estado;
  assert.equal(e.tarefas.pendentes.ele.length, 0);
  amb.falha('ele', 'trazerTarefa', { id: e.tarefas.hoje.ele[0].id }); // tarefa de hoje não é pendente

  // O histórico de ontem continua mostrando 1 de 3 feita
  const prog = amb.ok('ele', 'progresso').progresso;
  const ontem = prog.tarefas.find((d) => d.data === '2026-11-17');
  assert.deepEqual(ontem.ele, { total: 3, feitas: 1 });

  // Pendentes com mais de 7 dias somem
  amb.ok('ele', 'addTarefa', { data: '2026-11-18', texto: 'Esquecida' });
  amb.definirAgora('2026-11-27T12:00:00-03:00');
  assert.equal(amb.ok('ele', 'estado').estado.tarefas.pendentes.ele.length, 0);
});

test('texto que começa com "=" ou "-" não vira fórmula na planilha', () => {
  const amb = preparado();
  const e = amb.ok('ele', 'addTarefa', { data: '2026-11-18', texto: '=IMPORTXML("http://x", "//a")' }).estado;
  assert.equal(e.tarefas.hoje.ele[0].texto, '=IMPORTXML("http://x", "//a")');
  amb.ok('ele', 'addTarefa', { data: '2026-11-18', texto: '-comprar pão' });
  const linhas = amb.aba('Tarefas').objetos();
  assert.ok(linhas.every((l) => !String(l.texto).startsWith('#FORMULA')));
  assert.equal(linhas[1].texto, '-comprar pão');
});

test('textos parecidos com data ou número continuam texto ("1/2", "12")', () => {
  const amb = preparado();
  amb.ok('ele', 'addTarefa', { data: '2026-11-18', texto: '12' });
  amb.ok('ele', 'addTarefa', { data: '2026-11-18', texto: '1/2' });
  amb.ok('ele', 'salvarMomento', { recado: '20/11' });
  const e = amb.ok('ele', 'estado').estado;
  assert.deepEqual(e.tarefas.hoje.ele.map((t) => t.texto), ['12', '1/2']);
  assert.equal(e.momentos.ele.recado, '20/11');
});

test('tarefas digitadas à mão (ou pelo Claude) sem id ganham id e são lidas com formatos variados', () => {
  const amb = preparado();
  const sh = amb.aba('Tarefas');
  sh.acrescentarCru({ pessoa: 'Ela', data: dataSP(2026, 11, 18), texto: 'Comprar presente', feita: 'FALSE' });
  sh.acrescentarCru({ pessoa: 'ELE', data: '18/11/2026', texto: 'Pagar boleto', feita: 'VERDADEIRO' });
  const serial = (Date.UTC(2026, 10, 19) - Date.UTC(1899, 11, 30)) / 86400000;
  sh.acrescentarCru({ id: 't_claude_1', pessoa: 'ele', data: serial, texto: 'Correr', feita: false });

  const e = amb.ok('ele', 'estado').estado;
  assert.deepEqual(e.tarefas.hoje.ela.map((t) => [t.texto, t.feita]), [['Comprar presente', false]]);
  assert.deepEqual(e.tarefas.hoje.ele.map((t) => [t.texto, t.feita]), [['Pagar boleto', true]]);
  assert.deepEqual(e.tarefas.amanha.ele.map((t) => t.texto), ['Correr']);
  const ids = sh.objetos().map((o) => o.id);
  assert.ok(ids.every((id) => String(id).length > 3), 'todas as linhas têm id agora');
  // e a dona da tarefa consegue marcar pelo site
  amb.ok('ela', 'marcarTarefa', { id: e.tarefas.hoje.ela[0].id, feita: true });
});

/* ---------------- Metas ---------------- */

test('metas da semana: +1, desfazer, contagem zera na segunda e só a dona marca', () => {
  const amb = preparado();
  let e = amb.ok('ele', 'salvarMetaSemana', { titulo: 'Academia', vezes: 4 }).estado;
  const meta = e.metasSemana.ele[0];
  assert.deepEqual([meta.titulo, meta.vezes, meta.feitas], ['Academia', 4, 0]);
  amb.ok('ele', 'marcarMetaSemana', { id: meta.id, delta: 1 });
  e = amb.ok('ele', 'marcarMetaSemana', { id: meta.id, delta: 1 }).estado;
  assert.equal(e.metasSemana.ele[0].feitas, 2);
  e = amb.ok('ele', 'marcarMetaSemana', { id: meta.id, delta: -1 }).estado;
  assert.equal(e.metasSemana.ele[0].feitas, 1);
  amb.falha('ela', 'marcarMetaSemana', { id: meta.id, delta: 1 }, 'proibido');
  assert.equal(e.semana.inicio, '2026-11-16');
  assert.equal(e.semana.fim, '2026-11-22');

  amb.definirAgora('2026-11-22T23:59:00-03:00'); // domingo: ainda conta
  assert.equal(amb.ok('ele', 'estado').estado.metasSemana.ele[0].feitas, 1);
  amb.definirAgora('2026-11-23T02:30:00-03:00'); // segunda de madrugada: ainda é domingo
  assert.equal(amb.ok('ele', 'estado').estado.metasSemana.ele[0].feitas, 1);
  amb.definirAgora('2026-11-23T03:01:00-03:00'); // segunda depois das 3h: zera
  e = amb.ok('ele', 'estado').estado;
  assert.equal(e.metasSemana.ele[0].feitas, 0);
  amb.falha('ele', 'marcarMetaSemana', { id: meta.id, delta: -1 }); // nada a desfazer nesta semana

  e = amb.ok('ele', 'salvarMetaSemana', { id: meta.id, titulo: 'Academia (treino A/B)', vezes: 5 }).estado;
  assert.deepEqual([e.metasSemana.ele[0].titulo, e.metasSemana.ele[0].vezes], ['Academia (treino A/B)', 5]);
  amb.falha('ele', 'salvarMetaSemana', { id: meta.id, vezes: 0 });
  amb.falha('ele', 'salvarMetaSemana', { titulo: '' });
  e = amb.ok('ele', 'salvarMetaSemana', { id: meta.id, ativa: false }).estado;
  assert.equal(e.metasSemana.ele.length, 0);
});

test('metas de longo prazo: criar, atualizar, progresso crescente e decrescente', () => {
  const amb = preparado();
  let e = amb.ok('ele', 'salvarMetaLongo', { titulo: 'Ler 12 livros', alvo: 12, atual: 3, unidade: 'livros', prazo: '2027-12-31' }).estado;
  let m = e.metasLongo.ele[0];
  assert.deepEqual([m.inicial, m.atual, m.alvo, m.progresso, m.prazo], [0, 3, 12, 0.25, '2027-12-31']);

  e = amb.ok('ela', 'salvarMetaLongo', { titulo: 'Chegar a 60 kg', inicial: '64', atual: '62', alvo: '60', unidade: 'kg' }).estado;
  m = e.metasLongo.ela[0];
  assert.equal(m.progresso, 0.5);
  e = amb.ok('ela', 'salvarMetaLongo', { id: m.id, atual: '61,5' }).estado;
  assert.equal(e.metasLongo.ela[0].atual, 61.5);
  assert.equal(e.metasLongo.ela[0].progresso, 0.625);
  e = amb.ok('ela', 'salvarMetaLongo', { id: m.id, atual: 58 }).estado;
  assert.equal(e.metasLongo.ela[0].progresso, 1, 'passar do alvo conta como 100%');

  amb.falha('ele', 'salvarMetaLongo', { id: m.id, atual: 1 }, 'proibido');
  amb.falha('ele', 'salvarMetaLongo', { titulo: 'Sem alvo' });
  amb.falha('ele', 'salvarMetaLongo', { titulo: 'Alvo igual', inicial: 5, alvo: 5 });
  amb.falha('ele', 'salvarMetaLongo', { titulo: 'Texto', alvo: 'abc' });
  e = amb.ok('ela', 'salvarMetaLongo', { id: m.id, ativa: false }).estado;
  assert.equal(e.metasLongo.ela.length, 0);
});

/* ---------------- Dieta e peso (escritos pelo Claude) ---------------- */

test('dieta: soma as refeições de hoje com números em formatos variados e lê as metas', () => {
  const amb = preparado();
  const pessoas = amb.aba('Pessoas');
  pessoas.escreverCru(2, 2, '2.100');   // meta_kcal do ele, com ponto de milhar
  pessoas.escreverCru(2, 3, 150);
  pessoas.escreverCru(3, 2, 1700);      // ela
  pessoas.escreverCru(3, 6, '58,5');    // peso_meta_kg da ela

  const d = amb.aba('Dieta');
  d.acrescentarCru({ data: '2026-11-18', pessoa: 'ele', refeicao: 'Café', alimento: 'Pão com ovo', quantidade: '2 fatias', kcal: 350, proteina_g: 18, carbo_g: 30, gordura_g: 15 });
  d.acrescentarCru({ data: dataSP(2026, 11, 18), pessoa: 'ele', refeicao: 'Almoço', alimento: 'Arroz, feijão, frango', quantidade: '1 prato', kcal: '650,5', proteina_g: '45', carbo_g: '80', gordura_g: '12,5' });
  d.acrescentarCru({ data: '17/11/2026', pessoa: 'ele', refeicao: 'Jantar', alimento: 'Ontem', kcal: 999 });
  d.acrescentarCru({ data: '18/11/2026', pessoa: 'ela', refeicao: 'Lanche', alimento: 'Iogurte', quantidade: '1/2 pote', kcal: 120, proteina_g: 10 });

  const e = amb.ok('ela', 'estado').estado;
  assert.equal(e.pessoas.ele.metaKcal, 2100);
  assert.equal(e.pessoas.ele.metaProteina, 150);
  assert.equal(e.pessoas.ele.metaCarbo, null);
  assert.equal(e.pessoas.ela.pesoMeta, 58.5);
  assert.equal(e.dieta.ele.itens.length, 2);
  assert.equal(e.dieta.ele.totais.kcal, 1000.5);
  assert.equal(e.dieta.ele.totais.gordura, 27.5);
  assert.equal(e.dieta.ela.totais.kcal, 120);
  assert.equal(e.dieta.ela.itens[0].quantidade, '1/2 pote');

  // últimos 14 dias para navegar no site (hoje incluído; dias sem registro vêm vazios)
  const dias = Object.keys(e.dietaDias);
  assert.equal(dias.length, 14);
  assert.equal(dias[0], '2026-11-05');
  assert.equal(dias[13], '2026-11-18');
  assert.equal(e.dietaDias['2026-11-17'].ele.totais.kcal, 999);
  assert.equal(e.dietaDias['2026-11-17'].ele.itens[0].alimento, 'Ontem');
  assert.equal(e.dietaDias['2026-11-16'].ela.itens.length, 0);
  assert.equal(e.dietaDias['2026-11-18'].ele.totais.kcal, 1000.5);

  const prog = amb.ok('ele', 'progresso').progresso;
  assert.equal(prog.kcal.length, 14);
  assert.deepEqual(prog.kcal[13], { data: '2026-11-18', ele: 1000.5, ela: 120 });
  assert.deepEqual(prog.kcal[12], { data: '2026-11-17', ele: 999, ela: null });
  assert.deepEqual(prog.metasKcal, { ele: 2100, ela: 1700 });
});

test('peso: estado mostra o mais recente; progresso traz o histórico ordenado', () => {
  const amb = preparado();
  const p = amb.aba('Peso');
  p.acrescentarCru({ data: '2026-11-11', pessoa: 'ele', peso_kg: '80,2' });
  p.acrescentarCru({ data: '2026-11-04', pessoa: 'ele', peso_kg: 81 });
  p.acrescentarCru({ data: '2026-11-18', pessoa: 'ele', peso_kg: 79.6 });
  p.acrescentarCru({ data: '2026-11-15', pessoa: 'ela', peso_kg: 62 });
  p.acrescentarCru({ data: '2026-11-16', pessoa: 'ela', peso_kg: '' }); // linha incompleta é ignorada
  const e = amb.ok('ele', 'estado').estado;
  assert.deepEqual(e.peso.ele, { data: '2026-11-18', kg: 79.6 });
  assert.deepEqual(e.peso.ela, { data: '2026-11-15', kg: 62 });
  const prog = amb.ok('ela', 'progresso').progresso;
  assert.deepEqual(prog.peso.ele.map((x) => x.kg), [81, 80.2, 79.6]);
  assert.equal(prog.peso.ela.length, 1);
});

/* ---------------- Momentos (foto + recado) ---------------- */

test('momento: recado, foto, troca de foto apaga a antiga e o outro vê', () => {
  const amb = preparado();
  amb.falha('ele', 'salvarMomento', { recado: '   ' });
  let e = amb.ok('ele', 'salvarMomento', { recado: 'Bom dia, amor!\n\n\n\nTe amo' }).estado;
  assert.equal(e.momentos.ele.recado, 'Bom dia, amor!\n\nTe amo');
  assert.equal(e.momentos.ele.fotoId, null);
  assert.equal(e.momentos.ela, null);

  e = amb.ok('ele', 'salvarMomento', { recado: 'Bom dia, amor!', foto: JPEG, miniatura: MINI }).estado;
  const foto1 = e.momentos.ele.fotoId;
  assert.ok(foto1);
  assert.equal(e.momentos.ele.miniatura, MINI);
  assert.equal(amb.aba('Momentos').objetos().length, 1, 'continua uma linha por pessoa por dia');

  // ela vê a foto dele (miniatura no estado e foto inteira pela ação "foto")
  const visto = amb.ok('ela', 'estado').estado;
  assert.equal(visto.momentos.ele.miniatura, MINI);
  assert.equal(amb.ok('ela', 'foto', { id: foto1 }).foto, JPEG);

  // troca a foto: a antiga vai para a lixeira e a miniatura antiga some
  e = amb.ok('ele', 'salvarMomento', { recado: 'Bom dia, amor!', foto: JPEG2, miniatura: MINI2 }).estado;
  const foto2 = e.momentos.ele.fotoId;
  assert.notEqual(foto2, foto1);
  assert.equal(amb.drive.arquivos.get(foto1).lixeira, true);
  assert.equal(amb.aba('Miniaturas').objetos().length, 1);
  amb.falha('ele', 'foto', { id: foto1 }, 'nao_encontrado');

  // só editar o recado mantém a foto
  e = amb.ok('ele', 'salvarMomento', { recado: 'Mudei o recado' }).estado;
  assert.equal(e.momentos.ele.fotoId, foto2);
  assert.equal(e.momentos.ele.recado, 'Mudei o recado');

  // remover a foto e apagar o recado apaga o momento
  e = amb.ok('ele', 'salvarMomento', { recado: '', removerFoto: true }).estado;
  assert.equal(e.momentos.ele, null);
  assert.equal(amb.aba('Miniaturas').objetos().length, 0);
});

test('foto: só entrega arquivos que pertencem a um momento e valida o formato', () => {
  const amb = preparado();
  const pasta = amb.drive.DriveApp.createFolder('outra pasta');
  const segredo = pasta.createFile(amb.ctx.Utilities.newBlob([1, 2, 3], 'application/pdf', 'segredo.pdf'));
  amb.falha('ele', 'foto', { id: segredo.getId() }, 'nao_encontrado');
  amb.falha('ele', 'foto', { id: '' }, 'nao_encontrado');
  amb.falha('ele', 'salvarMomento', { recado: 'x', foto: 'data:text/html;base64,PHNjcmlwdD4=' });
  amb.falha('ele', 'salvarMomento', { recado: 'x', foto: 'nao-e-imagem' });
  amb.falha('ele', 'salvarMomento', { recado: 'x', foto: JPEG, miniatura: 'data:image/jpeg;base64,' + 'A'.repeat(50000) });
});

test('memórias: dias em ordem decrescente, com paginação', () => {
  const amb = preparado('2026-11-01T09:00:00-03:00');
  for (let i = 0; i < 12; i++) {
    amb.ok('ele', 'salvarMomento', { recado: 'Dia ' + (i + 1), foto: JPEG, miniatura: MINI });
    if (i % 2 === 0) amb.ok('ela', 'salvarMomento', { recado: 'Resposta ' + (i + 1) });
    amb.avancarDias(1);
  }
  // agora é 13/11
  let r = amb.ok('ele', 'memorias', { limite: 5 });
  assert.deepEqual(r.dias.map((d) => d.data), ['2026-11-12', '2026-11-11', '2026-11-10', '2026-11-09', '2026-11-08']);
  assert.equal(r.temMais, true);
  assert.equal(r.dias[0].ele.recado, 'Dia 12');
  assert.equal(r.dias[0].ele.miniatura, MINI);
  assert.equal(r.dias[0].ela, null);
  assert.equal(r.dias[1].ela.recado, 'Resposta 11');
  r = amb.ok('ela', 'memorias', { limite: 5, antesDe: '2026-11-08' });
  assert.deepEqual(r.dias.map((d) => d.data), ['2026-11-07', '2026-11-06', '2026-11-05', '2026-11-04', '2026-11-03']);
  r = amb.ok('ela', 'memorias', { limite: 5, antesDe: '2026-11-03' });
  assert.deepEqual(r.dias.map((d) => d.data), ['2026-11-02', '2026-11-01']);
  assert.equal(r.temMais, false);
});

/* ---------------- Progresso ---------------- */

test('progresso: sequência de dias com tudo feito (dias sem tarefa não quebram)', () => {
  const amb = preparado('2026-11-10T10:00:00-03:00');
  const dia = (iso, lista) => {
    amb.definirAgora(iso + 'T10:00:00-03:00');
    lista.forEach(([texto, feita]) => {
      const e = amb.ok('ele', 'addTarefa', { data: iso, texto }).estado;
      const t = e.tarefas.hoje.ele[e.tarefas.hoje.ele.length - 1];
      if (feita) amb.ok('ele', 'marcarTarefa', { id: t.id, feita: true });
    });
  };
  dia('2026-11-10', [['a', true], ['b', true]]);   // completo
  dia('2026-11-11', [['a', false]]);               // incompleto: quebra
  dia('2026-11-12', [['a', true]]);                // completo
  dia('2026-11-13', [['a', true], ['b', true]]);   // completo
  // 14 sem tarefas (neutro)
  dia('2026-11-15', [['a', true]]);                // completo
  dia('2026-11-16', [['a', true], ['b', false]]);  // hoje, ainda incompleto

  let p = amb.ok('ele', 'progresso').progresso;
  assert.deepEqual(p.sequencias.ele, { atual: 3, recorde: 3 });
  assert.deepEqual(p.sequencias.ela, { atual: 0, recorde: 0 });

  const ult = amb.ok('ele', 'estado').estado.tarefas.hoje.ele[1];
  amb.ok('ele', 'marcarTarefa', { id: ult.id, feita: true });
  p = amb.ok('ele', 'progresso').progresso;
  assert.deepEqual(p.sequencias.ele, { atual: 4, recorde: 4 });
  assert.equal(p.tarefas.length, 30);
  assert.equal(p.tarefas[29].data, '2026-11-16');
  assert.deepEqual(p.tarefas[29].ele, { total: 2, feitas: 2 });
});

test('progresso: sequência do casal trocando recados e metas semanais cumpridas', () => {
  const amb = preparado('2026-11-16T09:00:00-03:00'); // segunda
  const meta = amb.ok('ela', 'salvarMetaSemana', { titulo: 'Pilates', vezes: 2 }).estado.metasSemana.ela[0];
  for (let i = 0; i < 4; i++) {
    amb.ok('ele', 'salvarMomento', { recado: 'oi ' + i });
    if (i !== 1) amb.ok('ela', 'salvarMomento', { recado: 'oi! ' + i });
    if (i < 2) amb.ok('ela', 'marcarMetaSemana', { id: meta.id, delta: 1 });
    amb.avancarDias(1);
  }
  // agora é 20/11 (sexta): dias 16 (os dois), 17 (só ele), 18 (os dois), 19 (os dois); hoje ninguém ainda
  let p = amb.ok('ele', 'progresso').progresso;
  assert.deepEqual(p.sequenciaCasal, { atual: 2, recorde: 2 });
  const semana = p.metasSemana[p.metasSemana.length - 1];
  assert.equal(semana.inicio, '2026-11-16');
  assert.deepEqual(semana.ela, { cumpridas: 1, total: 1 });
  assert.deepEqual(semana.ele, { cumpridas: 0, total: 0 });
  assert.equal(p.metasSemana.length, 8);

  amb.ok('ele', 'salvarMomento', { recado: 'hoje' });
  amb.ok('ela', 'salvarMomento', { recado: 'hoje!' });
  p = amb.ok('ela', 'progresso').progresso;
  assert.deepEqual(p.sequenciaCasal, { atual: 3, recorde: 3 });
});

/* ---------------- Robustez ---------------- */

test('requisições inválidas devolvem erro amigável em JSON', () => {
  const amb = preparado();
  let r = amb.chamarCru('isso não é json');
  assert.deepEqual([r.ok, r.erro], [false, 'Requisição inválida.']);
  r = amb.chamar('apagarTudo', { token: amb.tk.ele });
  assert.equal(r.ok, false);
  assert.match(r.erro, /desconhecida/);
  r = amb.chamar('ping');
  assert.equal(r.ok, true);
  assert.equal(r.hoje, '2026-11-18');
  const g = JSON.parse(amb.ctx.doGet().getContent());
  assert.equal(g.ok, true);
});

test('erro inesperado não vaza detalhes como mensagem principal e é registrado no log', () => {
  const amb = preparado();
  amb.ss.getSheetByName('Tarefas').getRange = () => { throw new Error('falha interna simulada'); };
  const r = amb.como('ele', 'estado');
  assert.equal(r.ok, false);
  assert.equal(r.erro, 'Algo deu errado no servidor. Tente de novo.');
  assert.match(r.detalhe, /simulada/);
  assert.equal(amb.errosLog.length, 1);
});

test('escritas usam a trava (LockService)', () => {
  const amb = preparado();
  const antes = amb.travas.tentativas;
  amb.ok('ele', 'addTarefa', { data: '2026-11-18', texto: 'x' });
  assert.ok(amb.travas.tentativas > antes);
});

test('textos longos são cortados no limite', () => {
  const amb = preparado();
  const e = amb.ok('ele', 'addTarefa', { data: '2026-11-18', texto: 'a'.repeat(500) }).estado;
  assert.equal(e.tarefas.hoje.ele[0].texto.length, 200);
  const m = amb.ok('ele', 'salvarMomento', { recado: 'b'.repeat(900) }).estado;
  assert.equal(m.momentos.ele.recado.length, 500);
});

test('a aba cresce além de 1000 linhas sem quebrar', () => {
  const amb = preparado();
  const sh = amb.aba('MetasSemanaLog');
  const meta = amb.ok('ele', 'salvarMetaSemana', { titulo: 'Água', vezes: 21 }).estado.metasSemana.ele[0];
  for (let r = 2; r <= 1000; r++) sh.escreverCru(r, 1, '2020-01-01');
  assert.equal(sh.getLastRow(), 1000);
  const e = amb.ok('ele', 'marcarMetaSemana', { id: meta.id, delta: 1 }).estado;
  assert.equal(e.metasSemana.ele[0].feitas, 1);
  assert.ok(sh.getMaxRows() > 1000);
});
