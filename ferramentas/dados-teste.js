'use strict';
/**
 * Dados de demonstração para o servidor local (NÃO vão para a planilha real).
 * PINs de teste do ambiente local: ele = 111111, ela = 222222.
 */
const fs = require('fs');
const path = require('path');

const PINS_TESTE = { ele: '111111', ela: '222222' };
const AMOSTRAS = path.join(__dirname, 'amostras');

function dataUrl(arquivo) {
  return 'data:image/jpeg;base64,' + fs.readFileSync(path.join(AMOSTRAS, arquivo)).toString('base64');
}

function semear(amb, opcoes = {}) {
  const c = amb.ctx;
  c.definirPin_('ele', PINS_TESTE.ele);
  c.definirPin_('ela', PINS_TESTE.ela);
  if (opcoes.vazio) return;

  const hoje = c.hoje_();
  const dia = (n) => c.somarDias_(hoje, n);
  let semente = 7;
  const rnd = () => {
    semente = (semente * 1103515245 + 12345) % 2147483648;
    return semente / 2147483648;
  };
  let seq = 0;
  const id = (p) => `${p}_demo${(seq++).toString(36)}`;
  const aba = (n) => amb.aba(n);

  // Metas de dieta
  const pessoas = aba('Pessoas');
  [[2, 'ele', 2200, 150, 250, 70, 76], [3, 'ela', 1700, 110, 190, 55, 58]].forEach(([linha, , kcal, p, cb, g, peso]) => {
    [kcal, p, cb, g, peso].forEach((v, i) => pessoas.escreverCru(linha, i + 2, v));
  });

  // Tarefas: 30 dias de histórico + hoje + amanhã
  const listas = {
    ele: ['Academia', 'Estudar PO', 'Ler 20 páginas', 'Revisar o TCC', 'Responder e-mails', 'Lavar a louça', 'Correr 5 km', 'Preparar marmita'],
    ela: ['Pilates', 'Aula de inglês', 'Mercado', 'Trabalho da faculdade', 'Meditar 10 min', 'Ligar pra mãe', 'Skincare', 'Arrumar o quarto']
  };
  const tarefas = aba('Tarefas');
  const addTarefa = (p, d, texto, feita, extra = {}) => tarefas.acrescentarCru(Object.assign({
    id: id('t'), pessoa: p, data: d, texto, feita, feita_em: feita ? d + 'T19:00:00' : '',
    criada_em: c.somarDias_(d, -1) + 'T22:00:00', origem: 'site', pendencia: ''
  }, extra));
  for (let n = -29; n <= -1; n++) {
    ['ele', 'ela'].forEach((p) => {
      const qtd = 2 + Math.floor(rnd() * 3);
      const tudoFeito = (p === 'ela' && n >= -6) || (p === 'ele' && n >= -9 && n <= -2);
      for (let i = 0; i < qtd; i++) {
        const texto = listas[p][(n + 40 + i * 3) % listas[p].length];
        const feita = tudoFeito ? true : rnd() < (p === 'ele' ? 0.72 : 0.8);
        addTarefa(p, dia(n), texto, feita, n < -1 && !feita ? { pendencia: 'descartada' } : {});
      }
    });
  }
  addTarefa('ele', dia(-1), 'Comprar presente de aniversário', false);
  [['Academia', true], ['Estudar PO', true], ['Revisar o TCC', false], ['Lavar a louça', false]].forEach(([t, f]) => addTarefa('ele', dia(0), t, f));
  [['Pilates', true], ['Aula de inglês', false], ['Mercado', false]].forEach(([t, f]) => addTarefa('ela', dia(0), t, f));
  [['Correr 5 km', false], ['Ler 20 páginas', false]].forEach(([t, f]) => addTarefa('ele', dia(1), t, f));
  addTarefa('ela', dia(1), 'Meditar 10 min', false);

  // Metas da semana (com histórico de 8 semanas)
  const metas = aba('MetasSemana');
  const log = aba('MetasSemanaLog');
  const semIni = c.inicioSemana_(hoje);
  const metasDemo = [
    ['ele', 'Academia', 4, 2], ['ele', 'Ler 20 min', 5, 3],
    ['ela', 'Pilates', 3, 1], ['ela', 'Beber 2 L de água', 7, 4]
  ];
  metasDemo.forEach(([p, titulo, vezes, nestaSemana]) => {
    const mid = id('ms');
    metas.acrescentarCru({ id: mid, pessoa: p, titulo, vezes_por_semana: vezes, ativa: true, criada_em: c.somarDias_(semIni, -60) + 'T10:00:00' });
    for (let w = 1; w <= 7; w++) {
      const ini = c.somarDias_(semIni, -7 * w);
      const feitas = Math.max(0, Math.min(vezes + 1, Math.round(vezes * (0.5 + rnd() * 0.7))));
      for (let k = 0; k < feitas; k++) log.acrescentarCru({ data: c.somarDias_(ini, k % 7), meta_id: mid, pessoa: p, registrado_em: c.somarDias_(ini, k % 7) + 'T08:00:00' });
    }
    for (let k = 0; k < nestaSemana; k++) {
      const d = c.somarDias_(semIni, Math.min(k, (c.diaSemana_(hoje) + 6) % 7));
      log.acrescentarCru({ data: d, meta_id: mid, pessoa: p, registrado_em: d + 'T08:00:00' });
    }
  });

  // Metas de longo prazo
  const longo = aba('MetasLongo');
  [
    ['ele', 'Ler 12 livros em 2027', 0, 3, 12, 'livros', '2027-12-31'],
    ['ele', 'Juntar para a viagem', 0, 1800, 5000, 'R$', '2027-07-01'],
    ['ela', 'Chegar a 58 kg', 63.5, 61.2, 58, 'kg', '2027-03-01']
  ].forEach(([p, titulo, inicial, atual, alvo, unidade, prazo]) => {
    longo.acrescentarCru({ id: id('ml'), pessoa: p, titulo, inicial, atual, alvo, unidade, prazo, ativa: true, atualizada_em: dia(-2) + 'T10:00:00' });
  });

  // Dieta: 14 dias (hoje só café e almoço)
  const dieta = aba('Dieta');
  const cardapio = {
    ele: [['Café da manhã', 'Pão integral com ovos e café', '2 fatias + 2 ovos', 420, 26, 40, 16],
      ['Almoço', 'Arroz, feijão, frango grelhado e salada', '1 prato', 720, 48, 85, 18],
      ['Lanche', 'Iogurte com banana e aveia', '1 pote', 310, 15, 48, 6],
      ['Jantar', 'Omelete com legumes', '3 ovos', 520, 32, 14, 34]],
    ela: [['Café da manhã', 'Tapioca com queijo', '1 unidade', 320, 12, 45, 9],
      ['Almoço', 'Arroz, feijão, peixe e legumes', '1 prato', 560, 36, 62, 14],
      ['Lanche', 'Fruta e castanhas', '1 maçã + 30 g', 260, 6, 28, 15],
      ['Jantar', 'Sopa de legumes com frango', '1 tigela', 380, 28, 30, 12]]
  };
  for (let n = -13; n <= 0; n++) {
    ['ele', 'ela'].forEach((p) => {
      const refeicoes = n === 0 ? cardapio[p].slice(0, 2) : cardapio[p];
      if (n < 0 && rnd() < 0.12) return; // alguns dias sem registro
      refeicoes.forEach(([refeicao, alimento, quantidade, kcal, pr, cb, g]) => {
        const f = 0.85 + rnd() * 0.3;
        dieta.acrescentarCru({
          data: dia(n), pessoa: p, refeicao, alimento, quantidade,
          kcal: Math.round(kcal * f), proteina_g: Math.round(pr * f), carbo_g: Math.round(cb * f), gordura_g: Math.round(g * f), obs: ''
        });
      });
    });
  }

  // Peso semanal (10 semanas)
  const peso = aba('Peso');
  for (let w = 9; w >= 0; w--) {
    peso.acrescentarCru({ data: dia(-7 * w), pessoa: 'ele', peso_kg: Math.round((82 - (9 - w) * 0.45 + (rnd() - 0.5) * 0.6) * 10) / 10 });
    peso.acrescentarCru({ data: dia(-7 * w - 1), pessoa: 'ela', peso_kg: Math.round((63.5 - (9 - w) * 0.25 + (rnd() - 0.5) * 0.4) * 10) / 10 });
  }

  // Anticoncepcional: quase todo dia dos últimos 40 (hoje ainda não), por volta das 21h
  const remedio = aba('Anticoncepcional');
  for (let n = -40; n <= -1; n++) {
    if (n === -12 || n === -25) continue; // dois esquecimentos
    remedio.acrescentarCru({ data: dia(n), hora: `21:${String(Math.floor(rnd() * 50) + 5).padStart(2, '0')}`, marcado_por: rnd() < 0.7 ? 'ela' : 'ele' });
  }

  // Momentos dos últimos 10 dias (+ o dela hoje)
  const momentos = aba('Momentos');
  const minis = aba('Miniaturas');
  const pasta = c.pastaFotos_();
  const fotos = [1, 2, 3].map((i) => ({ foto: fs.readFileSync(path.join(AMOSTRAS, `foto${i}.jpg`)), mini: dataUrl(`foto${i}_mini.jpg`) }));
  const recados = {
    ele: ['Bom dia, amor! Hoje vai dar tudo certo.', 'Orgulho de você!', 'Saudade já.', 'Bora treinar juntos amanhã?', 'Você é a melhor parte do meu dia.'],
    ela: ['Bom dia, meu bem!', 'Não esquece de beber água, hein.', 'Te amo muito!', 'Hoje foi puxado, mas pensei em você.', 'Jantar juntos sexta?']
  };
  const addMomento = (p, d, comFoto, i) => {
    let fotoId = '', miniId = '';
    if (comFoto) {
      const f = fotos[i % fotos.length];
      fotoId = pasta.createFile(c.Utilities.newBlob(Array.from(f.foto), 'image/jpeg', `${d}_${p}.jpg`)).getId();
      miniId = id('mi');
      minis.acrescentarCru({ id: miniId, base64: f.mini });
    }
    momentos.acrescentarCru({ data: d, pessoa: p, recado: recados[p][i % recados[p].length], foto_id: fotoId, miniatura_id: miniId, atualizado_em: d + 'T08:30:00' });
  };
  for (let n = -10; n <= -1; n++) {
    addMomento('ele', dia(n), rnd() < 0.5, n + 10);
    if (n !== -6) addMomento('ela', dia(n), rnd() < 0.6, n + 11);
  }
  addMomento('ela', dia(0), true, 1);
}

module.exports = { semear, PINS_TESTE };
