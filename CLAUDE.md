# Nós dois — dashboard do casal

Site para um casal acompanhar o dia a dia: tarefas (de hoje e de amanhã), metas da semana e de longo prazo, dieta (calorias, macros, peso), quadro do dia (desenho compartilhado; até 23/11/2026 era foto + recado), anticoncepcional, progresso e memórias.

- `ele` = o dono do projeto (quem conversa com o Claude). `ela` = a namorada dele.
- No site, cada um se vê como "Eu" e o outro como "Amor". Cores fixas: ele = menta, ela = pêssego.
- IDs reais (planilha, script, URLs) ficam em `config-local.json` e `CLAUDE.local.md` (fora do git).

## Arquitetura

```
site/ (GitHub Pages, JS puro)  --POST JSON + token-->  apps-script/Code.js (web app)  -->  Planilha Google
                                                               └──> Drive (fotos antigas, privadas)
Claude (conector Google Sheets) ---------------------------------------------------------> Planilha
```

- `apps-script/Code.js`: API inteira (login por PIN, tarefas, metas, momentos, progresso). Uma ação por função `acaoX_`.
- `site/js/app.js`: telas e interações. Sempre criar elementos com `h()`; nunca `innerHTML` com texto de usuário.
- `testes/ambiente.js`: imitação do Apps Script (planilha, Drive, cache...) para rodar `Code.js` no Node.
- `ferramentas/servidor-local.js`: serve o site e a API local com dados de exemplo (PINs de teste: ele 111111, ela 222222).

## Comandos

- Testes do backend: `npm test` (precisam passar antes de publicar)
- Site local: `npm run dev` -> http://localhost:8787 (`--vazio` sobe sem dados de exemplo)
- Publicar: `powershell -ExecutionPolicy Bypass -File ferramentas\implantar.ps1` (precisa de `clasp login` e `gh auth login` feitos uma vez)

## Como editar a planilha (registrar dieta, peso, tarefas)

Use o conector do Google Sheets. O id da planilha está em `CLAUDE.local.md`. Antes de escrever numa aba pela primeira vez na conversa, leia a linha 1 (`Aba!A1:Z1`) para confirmar a ordem das colunas. Grave com `append_values` usando o range `Aba!A1`.

Regras gerais:
- Datas como texto `aaaa-mm-dd`, no fuso de São Paulo. "Hoje" é a data de São Paulo, não UTC, e o dia só vira às 3h da manhã: entre 0h e 2h59 ainda vale o dia anterior (ex.: 1h de 20/11 grava `2026-11-19`). É a mesma regra do site (`HORA_VIRADA` em `Code.js`).
- `pessoa` é sempre `ele` ou `ela` (minúsculo).
- Números como números (ex.: `72.5`, não `"72,5"`). Ao ler, a planilha devolve decimais com vírgula; isso é normal.
- Um pedido explícito ("registra que comi X") já é a aprovação: registre e mostre um resumo. Se a estimativa for muito incerta (porção desconhecida), pergunte antes.
- Nunca mexa nas abas `Quadro`, `Momentos`, `Miniaturas` e `MetasSemanaLog` (são do site). Nunca apague linhas sem pedido explícito.

Abas e colunas (ordem atual):

| Aba | Colunas |
|---|---|
| Pessoas | id, meta_kcal, meta_proteina_g, meta_carbo_g, meta_gordura_g, peso_meta_kg |
| Dieta | data, pessoa, refeicao, alimento, quantidade, kcal, proteina_g, carbo_g, gordura_g, obs |
| Peso | data, pessoa, peso_kg |
| Tarefas | id, pessoa, data, texto, feita, feita_em, criada_em, origem, pendencia |
| MetasSemana | id, pessoa, titulo, vezes_por_semana, ativa, criada_em |
| MetasLongo | id, pessoa, titulo, inicial, atual, alvo, unidade, prazo, ativa, atualizada_em |
| Anticoncepcional | data, hora, marcado_por, atualizado_em |

Dieta:
- Uma linha por alimento ou prato. `refeicao`: "Café da manhã", "Almoço", "Lanche", "Jantar" ou "Ceia".
- Estime kcal e macros (g) com base em tabelas brasileiras (TACO) ou rótulos; arredonde para inteiros (macros podem ter uma casa).
- Depois de registrar, responda com o total do dia de cada pessoa comparado à meta (aba Pessoas) e o que falta.
- Metas de dieta: atualize a linha `ele` ou `ela` da aba Pessoas (ex.: `Pessoas!B2` é a meta_kcal dele, `Pessoas!B3` a dela; confira a ordem antes).

Peso: uma linha por pesagem (`data`, `pessoa`, `peso_kg`).

Anticoncepcional (dias em que ela tomou): uma linha por dia; `hora` como texto `HH:mm`, `marcado_por` = `ele` ou `ela`. Se o dia já tem linha, atualize a hora em vez de criar outra.

Tarefas criadas pelo Claude: `id` = `t_` + 12 caracteres aleatórios (letras minúsculas e números), `feita` = `FALSE`, `criada_em` = `aaaa-mm-ddTHH:mm:ss` (São Paulo), `origem` = `claude`, `pendencia` vazio. "Lista de amanhã" = data de amanhã. Se o id ficar vazio, o site cria um sozinho.

O site lê a planilha a cada 60 segundos (ou ao tocar em atualizar), então o que for gravado aparece logo.

## Convenções de código

- JavaScript puro, sem framework e sem dependências; nomes e textos em português.
- Toda mudança no backend precisa de teste em `testes/backend.test.js`.
- Textos que vão para a planilha passam por `valorCelula_` (evita virar fórmula).
- Não versionar dados pessoais: ids e links reais só em `config-local.json` / `CLAUDE.local.md`.
