/*
 * Gráficos simples em SVG feitos à mão (sem biblioteca):
 *  - anel: progresso circular (calorias do dia)
 *  - barrasPareadas: duas séries lado a lado (tarefas concluídas por dia)
 *  - barrasMeta: uma série com linha de meta (calorias por dia)
 *  - linhas: evolução no tempo (peso)
 */
(function () {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';

  function s(tag, attrs, filhos) {
    var el = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] !== null && attrs[k] !== undefined) el.setAttribute(k, attrs[k]);
    });
    (filhos || []).forEach(function (f) {
      if (f === null || f === undefined) return;
      el.appendChild(typeof f === 'string' ? document.createTextNode(f) : f);
    });
    return el;
  }

  function svgBase(largura, altura, rotulo) {
    return s('svg', {
      viewBox: '0 0 ' + largura + ' ' + altura, class: 'grafico', role: 'img',
      'aria-label': rotulo || 'Gráfico', preserveAspectRatio: 'xMidYMid meet'
    });
  }

  function fmt(n, casas) {
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: casas || 0 }).format(n);
  }

  /** Progresso circular. */
  function anel(o) {
    var tam = o.tamanho || 120, esp = o.espessura || 12;
    var r = (tam - esp) / 2, circ = 2 * Math.PI * r;
    var pct = o.meta ? Math.max(0, Math.min(o.valor / o.meta, 1)) : (o.valor > 0 ? 1 : 0);
    var svg = svgBase(tam, tam, o.rotulo);
    svg.classList.add('anel');
    svg.appendChild(s('circle', { cx: tam / 2, cy: tam / 2, r: r, fill: 'none', stroke: o.fundo, 'stroke-width': esp }));
    if (pct > 0) {
      svg.appendChild(s('circle', {
        cx: tam / 2, cy: tam / 2, r: r, fill: 'none', stroke: o.cor, 'stroke-width': esp,
        'stroke-linecap': 'round', 'stroke-dasharray': (circ * pct) + ' ' + circ,
        transform: 'rotate(-90 ' + tam / 2 + ' ' + tam / 2 + ')'
      }));
    }
    svg.appendChild(s('text', { x: tam / 2, y: tam / 2 - 2, 'text-anchor': 'middle', class: 'anel-valor' }, [o.texto]));
    if (o.subtexto) svg.appendChild(s('text', { x: tam / 2, y: tam / 2 + 16, 'text-anchor': 'middle', class: 'anel-sub' }, [o.subtexto]));
    return svg;
  }

  /** itens: [{rotulo, a, b}] com a/b de 0 a 1 (ou null quando não há dado). */
  function barrasPareadas(o) {
    var W = 340, H = o.altura || 150, topo = 10, base = H - 22, esq = 28, dir = W - 6;
    var svg = svgBase(W, H, o.rotulo);
    [0, 0.5, 1].forEach(function (v) {
      var y = base - (base - topo) * v;
      svg.appendChild(s('line', { x1: esq, x2: dir, y1: y, y2: y, class: 'grade' }));
      svg.appendChild(s('text', { x: esq - 5, y: y + 3, 'text-anchor': 'end', class: 'eixo' }, [Math.round(v * 100) + '%']));
    });
    var n = o.itens.length, passo = (dir - esq) / n, larg = Math.min(9, passo * 0.36);
    o.itens.forEach(function (it, i) {
      var cx = esq + passo * i + passo / 2;
      [['a', -1], ['b', 1]].forEach(function (par, j) {
        var v = it[par[0]];
        if (v === null || v === undefined) return;
        var hgt = Math.max(2, (base - topo) * Math.min(v, 1));
        svg.appendChild(s('rect', {
          x: cx + (par[1] < 0 ? -larg - 1 : 1), y: base - hgt, width: larg, height: hgt, rx: Math.min(4, larg / 2),
          fill: o.cores[j]
        }, [s('title', {}, [(it.titulo || it.rotulo) + ': ' + Math.round(v * 100) + '%'])]));
      });
      if (n <= 14 || (n - 1 - i) % Math.ceil(n / 10) === 0) {
        svg.appendChild(s('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'eixo' }, [it.rotulo]));
      }
    });
    return svg;
  }

  /** itens: [{rotulo, valor}] ; meta opcional (linha tracejada). */
  function barrasMeta(o) {
    var W = 340, H = o.altura || 130, topo = 12, base = H - 22, esq = 34, dir = W - 6;
    var valores = o.itens.map(function (i) { return i.valor || 0; });
    var max = Math.max.apply(null, valores.concat([o.meta ? o.meta * 1.15 : 0, 1]));
    max = Math.ceil(max / 500) * 500;
    var svg = svgBase(W, H, o.rotulo);
    [0, 0.5, 1].forEach(function (v) {
      var y = base - (base - topo) * v;
      svg.appendChild(s('line', { x1: esq, x2: dir, y1: y, y2: y, class: 'grade' }));
      svg.appendChild(s('text', { x: esq - 5, y: y + 3, 'text-anchor': 'end', class: 'eixo' }, [fmt(max * v)]));
    });
    var n = o.itens.length, passo = (dir - esq) / n, larg = Math.min(14, passo * 0.6);
    o.itens.forEach(function (it, i) {
      var cx = esq + passo * i + passo / 2;
      if (it.valor !== null && it.valor !== undefined) {
        var hgt = Math.max(2, (base - topo) * (it.valor / max));
        var acima = o.meta && it.valor > o.meta * 1.1;
        svg.appendChild(s('rect', {
          x: cx - larg / 2, y: base - hgt, width: larg, height: hgt, rx: Math.min(4, larg / 2),
          fill: acima ? o.corForte : o.cor
        }, [s('title', {}, [(it.titulo || it.rotulo) + ': ' + fmt(it.valor) + ' kcal'])]));
      }
      if (i % 2 === (n - 1) % 2) svg.appendChild(s('text', { x: cx, y: H - 6, 'text-anchor': 'middle', class: 'eixo' }, [it.rotulo]));
    });
    if (o.meta) {
      var ym = base - (base - topo) * (o.meta / max);
      svg.appendChild(s('line', { x1: esq, x2: dir, y1: ym, y2: ym, class: 'linha-meta' }));
      svg.appendChild(s('text', { x: dir, y: ym - 4, 'text-anchor': 'end', class: 'eixo rotulo-meta' }, ['meta ' + fmt(o.meta)]));
    }
    return svg;
  }

  function diaNum(iso) {
    var p = iso.split('-');
    return Date.UTC(+p[0], +p[1] - 1, +p[2]) / 86400000;
  }

  /** series: [{pontos:[{data, kg}], cor}] ; metas: [{valor, cor}] */
  function linhas(o) {
    var W = 340, H = o.altura || 170, topo = 14, base = H - 24, esq = 36, dir = W - 10;
    var todos = [];
    o.series.forEach(function (sr) { sr.pontos.forEach(function (p) { todos.push(p); }); });
    var svg = svgBase(W, H, o.rotulo);
    if (!todos.length) return svg;
    var ys = todos.map(function (p) { return p.kg; });
    (o.metas || []).forEach(function (m) { if (m.valor) ys.push(m.valor); });
    var minY = Math.floor(Math.min.apply(null, ys) - 1), maxY = Math.ceil(Math.max.apply(null, ys) + 1);
    var xs = todos.map(function (p) { return diaNum(p.data); });
    var minX = Math.min.apply(null, xs), maxX = Math.max.apply(null, xs);
    if (maxX === minX) { minX -= 3; maxX += 3; }
    var px = function (d) { return esq + (dir - esq) * (diaNum(d) - minX) / (maxX - minX); };
    var py = function (v) { return base - (base - topo) * (v - minY) / (maxY - minY); };

    [minY, (minY + maxY) / 2, maxY].forEach(function (v) {
      svg.appendChild(s('line', { x1: esq, x2: dir, y1: py(v), y2: py(v), class: 'grade' }));
      svg.appendChild(s('text', { x: esq - 5, y: py(v) + 3, 'text-anchor': 'end', class: 'eixo' }, [fmt(v, 1)]));
    });
    (o.metas || []).forEach(function (m) {
      if (!m.valor) return;
      svg.appendChild(s('line', { x1: esq, x2: dir, y1: py(m.valor), y2: py(m.valor), class: 'linha-meta' }));
      if (m.rotulo) svg.appendChild(s('text', { x: dir, y: py(m.valor) - 4, 'text-anchor': 'end', class: 'eixo rotulo-meta' }, [m.rotulo]));
    });
    o.series.forEach(function (sr) {
      if (!sr.pontos.length) return;
      var d = sr.pontos.map(function (p, i) { return (i ? 'L' : 'M') + px(p.data).toFixed(1) + ' ' + py(p.kg).toFixed(1); }).join(' ');
      svg.appendChild(s('path', { d: d, fill: 'none', stroke: sr.cor, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
      sr.pontos.forEach(function (p) {
        svg.appendChild(s('circle', { cx: px(p.data), cy: py(p.kg), r: 3.5, fill: '#fff', stroke: sr.cor, 'stroke-width': 2 }, [
          s('title', {}, [p.data.split('-').reverse().slice(0, 2).join('/') + ': ' + fmt(p.kg, 1) + ' kg'])
        ]));
      });
    });
    var rot = function (n) {
      var d = new Date(n * 86400000);
      return String(d.getUTCDate()).padStart(2, '0') + '/' + String(d.getUTCMonth() + 1).padStart(2, '0');
    };
    svg.appendChild(s('text', { x: esq, y: H - 6, 'text-anchor': 'start', class: 'eixo' }, [rot(minX)]));
    svg.appendChild(s('text', { x: dir, y: H - 6, 'text-anchor': 'end', class: 'eixo' }, [rot(maxX)]));
    return svg;
  }

  window.Graficos = { anel: anel, barrasPareadas: barrasPareadas, barrasMeta: barrasMeta, linhas: linhas };
})();
