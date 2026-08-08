# CHECKPOINT — Bússola Cívica

**Data:** 2026-08-07 · **Fase:** 0 (deputados federais do RS)
**Estado:** backend funcional — reconhecimento, modelo, ingestor e cálculo de
posições prontos e validados contra dados reais. Web e app ainda não iniciados.

Documentos detalhados: [FONTES.md](./FONTES.md) · [MODELO-DADOS.md](./MODELO-DADOS.md) · [INGESTOR.md](./INGESTOR.md)

---

## 1. O que foi feito

| # | Etapa | Entregável |
|---|---|---|
| 1 | Reconhecimento das APIs | `docs/FONTES.md` — 26 endpoints testados, request/response verificados |
| 2 | Modelo de dados | `src/db/schema.ts` — 20 tabelas, 5 migrations, 45 verificações |
| 3 | Ingestor | `src/ingest/` + `src/lib/` — coleta idempotente com retry e auditoria |
| 4 | Cálculo de posições | `src/calc/posicoes.ts` — 2 eixos com evidência rastreável |
| 5 | Classificação de discursos | `src/lib/classificar.ts` — filtro de ruído protocolar |
| 6 | Vínculo votação↔proposição | etapa `proposicoes` — matéria, objeto votado e temas |
| 7 | Separação mérito/procedimental | `src/lib/natureza.ts` — eixos apurados em dois escopos |
| 8 | Ampliação para a legislatura | 6.281 votações, 450 mil votos, 31/31 parlamentares posicionados |
| 9 | Ingestão incremental | `src/ingest/incremental.ts` — retomada automática, sem informar data |

Banco atual: **80 MB**, **legislatura 57 inteira**, coletada de 2023-02-01 a
2026-08-07: 6.281 votações, 1.112 nominais, 450.630 votos.

O acervo foi **reconstruído do zero** em 2026-08-07 (91 min, ~9.700 operações) e
reproduziu exatamente os totais estruturais da coleta anterior — 1.112 nominais,
5.169 simbólicas, natureza 570/532/10. As diferenças residuais estão em §7.1.

---

## 2. Princípio que governou todas as decisões

> Nunca rotular político por conta própria. Todo dado exibido deriva de fonte
> oficial e carrega link para ela. O usuário tira a conclusão.

Consequências concretas no código:

- `fonte_url` é coluna obrigatória em toda tabela de fato, não metadado opcional.
- `posicao_evidencia` decompõe cada número votação por votação — "por que este
  político está aqui?" é respondível com links oficiais.
- Onde a fonte não permite resolver algo (membros de bloco), o campo fica **NULL**
  em vez de ser preenchido por inferência.
- Rótulos de eixo vivem no banco (`eixo.rotulo_min/max`), não no componente de UI.
- Discursos são **classificados**, nunca excluídos.

---

## 3. Metodologias empregadas

### 3.1 Reconhecimento de API — verificação antes de modelar

Nenhum endpoint foi assumido a partir de documentação. Cada um foi chamado, a
resposta inspecionada e os limites descobertos empiricamente. Método:

1. Descobrir a spec real (`/api/v2/api-docs` — não `/openapi.json`, que dá 405).
2. Testar cada endpoint candidato e registrar status HTTP.
3. Testar os limites por tentativa (janela de datas, `itens`, paginação).
4. **Cruzar contagens contra a realidade conhecida** — 31 deputados retornados =
   31 cadeiras do RS; 22+9 eleitos no CSV do TSE = 31.
5. Medir cobertura real antes de prometer funcionalidade.

Foi o passo 5 que derrubou dois itens do escopo original (§6).

### 3.2 Modelagem defensiva — o schema bloqueia o erro

O modelo não espelha as APIs; espelha o que precisa ser verdadeiro para a
plataforma não mentir. Quatro modos de erro foram identificados e bloqueados
estruturalmente:

| Modelagem ingênua | Erro que produziria |
|---|---|
| `partido` como coluna de `politico` | 6 dos 31 na legenda errada |
| Denominador fixo de votações | Todo suplente vira "ausente contumaz" |
| Votação simbólica tratada como nominal | 66% de ruído no cálculo |
| `Obstrução` colapsada em ausência | Bancadas minoritárias distorcidas |

### 3.3 Validação por caso de borda real

`npm run db:validar` monta um banco em memória com fixture que reproduz cada
armadilha encontrada — suplente com exercício parcial, deputado que trocou de
legenda, votação simbólica, obstrução, Artigo 17, votação secreta — e verifica
que as queries respondem certo. **45 verificações.**

Os sete casos de classificação de discurso são regressões: cada um quebrou uma
versão anterior da regra.

### 3.4 Verificação cruzada contra o reconhecimento

O ingestor não é considerado correto por rodar sem erro. `npm run relatorio`
compara o acervo com os números medidos independentemente na fase de
reconhecimento. Tudo bate exatamente (§7).

### 3.5 Coleta resiliente

A API da Câmara devolveu **504 intermitente** durante todo o trabalho. Métodos:

- Retry com backoff exponencial + jitter, teto de 30s, até 8 tentativas.
- Distinção entre erro retriável (5xx, timeout, rede, 429) e definitivo (4xx) —
  insistir em 400 mascara bug de parâmetro.
- Idempotência em todas as etapas: retomar coleta interrompida é o caso normal.
- Cache permanente de votação passada (imutável).
- Auditoria em `coleta`: sem ela, coleta parcial é indistinguível de completa —
  e lacuna vira "o deputado não votou" na interface.

### 3.6 Normalização com original preservado

Normalizar é interpretar; interpretação precisa ser auditável. Todo voto guarda
`tipo_voto_original` ao lado do valor normalizado. Códigos desconhecidos geram
**aviso explícito**, nunca default silencioso.

### 3.7 Derivação com metodologia versionada

Valores calculados (`posicao`, classificação de discurso) carregam a versão da
regra que os produziu, e são recalculáveis a partir da camada coletada, sem nova
coleta.

---

## 4. Endpoints — mapa completo

### 4.1 Câmara dos Deputados

Base: `https://dadosabertos.camara.leg.br/api/v2` · sem autenticação

| Endpoint | Status | Uso / observação |
|---|---|---|
| `GET /api/v2/api-docs` | ✅ | Spec OpenAPI 3.0.1, 78 paths. `/openapi.json` e `/swagger.json` → 405 |
| `GET /deputados?siglaUf=RS` | ✅ **usado** | 31 registros; `itens` até 1000 |
| `GET /deputados/{id}` | ✅ **usado** | Cadastro + **CPF** + `ultimoStatus` |
| `GET /deputados/{id}/historico` | ✅ **usado** | Filiação, mandato e **períodos de exercício** |
| `GET /deputados/{id}/discursos` | ✅ **usado** | Transcrição integral + link do Diário |
| `GET /deputados/{id}/votacoes` | ❌ **405** | **NÃO EXISTE** — determina a direção da ingestão |
| `GET /votacoes?idOrgao=180&dataInicio=&dataFim=` | ✅ **usado** | Janela **máx. 3 meses**; `itens` **máx. 100** |
| `GET /votacoes?siglaOrgao=PLEN` | ❌ 400 | Parâmetro inexistente — é `idOrgao` |
| `GET /votacoes/{id}/votos` | ✅ **usado** | **Sem paginação**; `[]` = votação simbólica |
| `GET /votacoes/{id}/votos?itens=600` | ❌ 400 | Não aceita paginação |
| `GET /votacoes/{id}/orientacoes` | ✅ **usado** | `partido_id` só resolvível se `codTipoLideranca='P'` |
| `GET /orgaos?sigla=PLEN` | ✅ **usado** | Plenário = id **180** |
| `GET /legislaturas/{id}` | ✅ **usado** | 57ª: 2023-02-01 → 2027-01-31 |
| `GET /referencias/proposicoes/codTema` | ✅ **usado** | 32 temas — base dos eixos da Fase 2 |
| `GET /votacoes/{id}` | ✅ **usado** | Detalhe; única fonte de `proposicoesAfetadas` |
| `GET /proposicoes/{id}` | ✅ **usado** | Resolve o objeto formalmente votado |
| `GET /proposicoes/{id}/temas` | ✅ **usado** | 153 de 154 votações nominais têm tema |
| `GET /blocos?idLegislatura=57` | ✅ testado | Nomes completos dos blocos |
| `GET /blocos/{id}/partidos` | ⚠️ | Responde 200 mas **retorna array vazio** |
| `camara.leg.br/noticias/rss` | ⚠️ | HTML; feeds reais são **por tema**, não por político |

### 4.2 Senado Federal

Base: `https://legis.senado.leg.br/dadosabertos`

| Endpoint | Status | Observação |
|---|---|---|
| `GET /senador/lista/atual.json` | ✅ testado | 3 senadores do RS |
| `GET /senador/{cod}/votacoes.json` | ⚠️ **depreciado** | Desativação marcada para **2026-02-01** — data já passada |
| `GET /votacao` | ✅ testado | Substituto; votos embutidos; `pagina`/`itens` ignorados |
| `GET /votacao?ano=2025` | ✅ testado | 93 votações |
| `GET /votacao?dataInicio=2025-04-01&dataFim=...` | ✅ testado | Exige `YYYY-MM-DD` (`YYYYMMDD` → 400) |
| `senado.leg.br/noticias/rss` | ✅ testado | RSS institucional, não por parlamentar |

**Não integrado ao ingestor** — é escopo da Fase 1.

### 4.3 TSE

| Endpoint / recurso | Status | Observação |
|---|---|---|
| DivulgaCand `/candidatura/listar/{ano}/{UF}/{idEleicao}/{cargo}/candidatos` | ✅ testado | RS 2022 dep. federal: **546**. `idEleicao=2040602022`; cargos 3=Gov, 5=Sen, 6=DepFed |
| DivulgaCand `/candidatura/buscar/.../candidato/{id}` | ✅ testado | CPF e `arquivos` **só aqui** — na listagem vêm `null` |
| DivulgaCand `/divulga/rest/arquivo/img/...` | ❌ 404 | Padrão de download não resolvido |
| CKAN `dadosabertos.tse.jus.br/api/3/action/package_show?id=candidatos-2022` | ✅ testado | 144 recursos |
| CDN `consulta_cand_2022.zip` | ✅ testado | **CSV por UF**, latin-1, `;`, com `NR_CPF_CANDIDATO` |
| CDN `proposta_governo_2022_RS.zip` | ✅ testado | **13 arquivos** — só candidatos a Governador |

Requer `User-Agent` de navegador. **Não integrado ao ingestor** (ver §9).

---

## 5. Achados que mudaram o projeto

| # | Achado | Consequência |
|---|---|---|
| 1 | `/deputados/{id}/votacoes` → **405** | Ingestão invertida: `votações → votos → deputados` |
| 2 | Só **34,2%** das votações de plenário são nominais; simbólicas devolvem `[]` | `votacao.nominal` derivado e persistido; ~450 requisições para achar 154 úteis |
| 3 | **Nenhum** deputado federal tem plano de governo (interseção medida: **zero**) | Item do MVP substituído por **discursos** |
| 4 | **67%** das votações do Senado são secretas; endpoint por senador depreciado | Fase 1 exige normalizador próprio e base amostral menor |
| 5 | Sem fonte oficial de notícias por político | Item do MVP substituído por discursos |
| 6 | **11 de 12** partidos nunca orientam pela própria sigla; blocos truncados e sem id | Eixo 2 mudou de fonte: cálculo empírico a partir dos votos |

---

## 6. Decisões de escopo

| Decisão | Situação |
|---|---|
| Plano de governo → **discursos da Câmara** | ✅ implementado |
| Notícias → adiado (sem fonte oficial por político) | ✅ fora do escopo |
| **Dois eixos** já na Fase 0 | ✅ implementado |
| Eixo 1: alinhamento com o governo federal | ✅ via `orientacoes` |
| Eixo 2: coesão com o próprio partido | ✅ via cálculo empírico (§6.1) |

### 6.1 Metodologia dos eixos

**Regras comuns:** só votações nominais e não secretas; só votos `sim`/`nao`
computáveis; denominador = votações ocorridas **dentro do período de exercício**
do parlamentar; toda posição grava evidência votação por votação.

**Dois escopos.** 86 das 154 votações nominais (56%) são sobre requerimentos —
urgência, retirada de pauta, adiamento. Votar a urgência de um projeto não é
votar o projeto. Os dois eixos são apurados separadamente em `merito` (escopo
principal) e `procedimental` (disciplina de pauta); `formal` (redação final)
fica fora dos dois. A separação revela comportamento oposto: a oposição alinha
mais no mérito que na pauta (Marcel van Hattem 27,8% × 12,6%), e Franciane Bayer
faz o inverso (57,7% × 64,5%).

> Os percentuais acima são da **legislatura inteira**. Até 2026-08-04 esta seção
> citava 22,5% × 2,8% e 56,0% × 72,2%, medidos no 1º sem/2025 — a direção do
> efeito é a mesma, a magnitude não. Comparar recortes diferentes não vale.

**Eixo 1 — Alinhamento com o governo federal.** Compara o voto com a orientação
da liderança do Governo (`sigla_bruta = 'Governo'`, `liberado = 0`). Presente em
100% das votações nominais medidas.
*Rótulo obrigatório:* "alinhamento com o governo federal". **Nunca**
"esquerda/direita" — mede posição relativa ao Executivo do momento, e um partido
troca de lado sem mudar de programa.

**Eixo 2 — Coesão com o próprio partido.** Apura a posição majoritária do partido
**a partir dos votos reais** (não da orientação, indisponível), **excluindo o voto
do parlamentar medido** — senão ele ajuda a definir a régua contra a qual é
comparado. Empate entre os pares não gera observação.
*Rótulo obrigatório:* "coesão com o próprio partido". É comportamento, não
ideologia: dois deputados de partidos opostos com 100% ocupam o mesmo ponto.

Versão da metodologia gravada em cada linha: `2026-08-04.2`.

### 6.2 Classificação de discursos

Três restrições: só campos oficiais; classifica e **nunca exclui**; na dúvida é
substantivo. Regra em `src/lib/classificar.ts`, versão `2026-08-04.4`.

| Categoria | Qtd | No perfil |
|---|---|---|
| `substantivo` | 736 (87,7%) | sim |
| `orientacao_voto` | 97 | não — já estruturado em `orientacao` |
| `registro_presenca` | 6 | não |

---

## 7. Números medidos — ingestor × reconhecimento

Verificação independente: os números do reconhecimento foram obtidos por scripts
avulsos, antes de existir banco.

Validação original, no 1º semestre de 2025 (recorte do reconhecimento):

| Métrica | Ingestor | Reconhecimento |
|---|---|---|
| Votações de plenário | 450 | 450 |
| Nominais / simbólicas | 154 / 296 | 154 / 296 |
| Taxa de nominais | 34,2% | 34,2% |
| Votos individuais | 58.724 | 58.724 |
| Sim / Não | 31.375 / 26.940 | idênticos |
| Artigo 17 / Abstenção / Obstrução | 151 / 149 / 109 | idênticos |
| Natureza das nominais | mérito 66, proc. 86, formal 2 | idênticos |
| Orientações de bloco com `partido_id` | 0 de 980 | confirma achado 6 |
| Cruzamento Câmara↔TSE por CPF | — | 31/31 |

### Acervo atual — legislatura 57 completa

| | |
|---|---|
| **Cobertura** (até onde se olhou) | 2023-02-01 → 2026-08-07 |
| **Votações** (primeira → última sessão) | 2023-02-07 → 2026-07-15 |
| Votações | 6.281 (1.112 nominais, 5.169 simbólicas) |
| Taxa de nominais | **17,7%** |
| Votos individuais | 450.630, de 643 parlamentares (442.821 computáveis) |
| Natureza das nominais | mérito 570, procedimental 532, formal 10 |
| Proposições / vínculos de tema | 645 / 905 |
| Nominais vinculadas à matéria | 1.111/1.112 (99,9%); com tema 1.105 (99,4%) |
| Discursos | 5.851 (4.947 substantivos) |
| Posições | 124 = 31/31 parlamentares × 2 eixos × 2 escopos |
| Evidências | 47.011 |
| Coleta | 10.071 operações (acumulado), 83 falhas, 34 com retry |

> **Cobertura e votação não são a mesma data.** O acervo foi varrido até
> 2026-08-07, mas a última sessão com votação em plenário é de 2026-07-15 —
> 23 dias de recesso à frente. Registrar as duas é o que permite retomar a
> coleta do ponto certo; `MAX(votacao.data)` sozinho revarreria o recesso a
> cada execução. Versões anteriores deste documento traziam uma só linha,
> "Período 2023-02-01 → 2026-08-04", que era a **data passada em `--fim`**, não
> um fato do acervo.

> **A taxa de nominais varia muito por período** — 34,2% no 1º sem/2025 contra
> 17,7% na legislatura inteira. Não existe um valor de referência universal; só
> faz sentido comparar recortes iguais.

**31/31 parlamentares posicionados** (contra 29/31 no semestre): com a
legislatura inteira, Carlos Gomes e Sérgio Turra passam a ter votações dentro
dos seus períodos de exercício. O denominador individualizado funciona como
projetado — Sérgio Turra tem 28 oportunidades (em exercício desde 2026-04-07),
Carlos Gomes 171 (períodos fragmentados) e Paulo Pimenta 272 (licenciado para
o cargo de ministro), contra 570 de quem serviu o período inteiro.

### Conteúdo do banco

| Tabela | Linhas | | Tabela | Linhas |
|---|---|---|---|---|
| `voto` | 450.630 | | `mandato` | 31 |
| `posicao_evidencia` | 47.011 | | `tema` | 32 |
| `orientacao` | 11.682 | | `partido` | 33 |
| `coleta` | 10.071 | | `exercicio` | 40 |
| `discurso` | 5.851 | | `filiacao` | 54 |
| `politico` | 643 (31 completos) | | `posicao` | 124 |
| `identidade_externa` | 643 | | `eixo` | 2 |
| `votacao` | 6.281 | | `legislatura` | 1 |
| `proposicao` | 645 | | `proposicao_tema` | 905 |

**Coleta:** 10.071 operações (acumulado — cresce a cada execução), 83 falhas,
**34 precisaram de retry**. As 83 falhas
são todas 404 em `/votos` de votações que a listagem devolve mas os endpoints de
detalhe não reconhecem — inconsistência conhecida da origem (§5, achado 1 de
INGESTOR.md). Ficam **fora** do acervo, com registro em `coleta`: inventar
`nominal = false` afirmaria algo não verificado.

### 7.1 Diferenças contra a coleta de 2026-08-04

A reconstrução reproduziu **exatamente** tudo que é estrutural: 6.281 votações,
1.112/5.169, natureza 570/532/10, 1.111/1.112 vinculadas, 11.682 orientações,
643 políticos. As diferenças estão nos derivados e têm causa identificada:

| Tabela | Antes | Agora | Causa |
|---|---|---|---|
| `posicao` | 240 | **124** | O banco antigo acumulava **dois períodos**: a legislatura (124 = 31×2×2) e o 1º sem/2025 (116 = 29×2×2). O novo tem só um. Ver §9 |
| `posicao_evidencia` | 51.766 | **47.011** | Mesma causa — 4.755 eram do período do semestre |
| `proposicao_tema` | 1.071 | **905** | Mesma causa — 166 eram do run do semestre |
| `proposicao` | 741 | **645** | Mesma causa, parcialmente: 96 proposições sem correspondência no run da legislatura. **Não totalmente explicado** |
| `discurso` | 5.868 | **5.851** | Deduplicação por hash de conteúdo: transcrição republicada pela Câmara gera segundo registro na re-ingestão (custo assumido, INGESTOR.md). Coleta limpa não tem os 17 |
| `voto` | 450.209 | **450.630** | +421, exatamente o nº de votos com `tipoVoto` nulo na origem. Hipótese em §9 |

Nenhuma dessas diferenças altera eixo, escopo ou posição de parlamentar. O
acervo novo é o menos ambíguo dos dois: um período só, sem resíduo de execução
anterior.

---

## 8. Defeitos encontrados e corrigidos

Todos apareceram ao rodar contra dados reais, não em revisão de código.

| Defeito | Sintoma | Correção |
|---|---|---|
| `db.all()` do sqlite-proxy devolve **arrays posicionais** | **0 posições gravadas** apesar de 40k evidências calculadas — falha silenciosa | Via tipada `consultar()` para SQL analítico |
| Chave de discurso `(politico, dataHoraInicio)` não é única | 6 discursos reais descartados | Hash de conteúdo incluindo transcrição → 839/839 |
| `politico.cpf` era `NOT NULL` | Impedia registrar os 513 votantes | Nullable + flag `perfil_completo` |
| Classificação olhava só a abertura do sumário | Descartava fala política (caso Suez/Jaguari, 3.071 chars cobrando o Governo) | Salvaguarda por sentenças posteriores |
| Salvaguarda testava o sumário inteiro | Ementa do projeto ("requerimento que **solicita**…") virava "posicionamento"; filtro caiu para 10% | Testar só sentenças após a primeira |
| `\b` impedia casar radicais prefixados | "Reafirmou" não casava `afirm` | `(?:re)?` opcional |
| `validar.ts` aplicava só a 1ª migration | Validação silenciosamente desatualizada | Aplica todas em ordem |
| 404 numa votação abortava o lote inteiro | Coleta parou no item 657 de 6.364 | Falha individual vira aviso; votação fica fora do acervo |
| `tipoVoto` e `siglaPartido` nulos quebravam `.trim()` | Coleta parou de novo, no item ~4.700 | Normalizações aceitam null; código nulo vira aviso |
| Relatório misturava períodos | Cada parlamentar aparecia duas vezes com números diferentes | Escolhe o período mais abrangente e o declara |
| Log reportava evidências calculadas como gravadas | Número enganoso (40.666 vs 2.544) | Log distingue os dois |
| `hoje` calculado em UTC (`toISOString()`) | Das 21h à meia-noite BRT o pipeline lia o dia seguinte, dava por passada a votação **do próprio dia** e gravava o placar de sessão em curso como imutável — nunca mais rebuscado | `hoje()` em `America/Sao_Paulo`, compartilhado por pipeline e incremental; 3 regressões em `db:validar` |

**Ajustes de ambiente:** `better-sqlite3` não compila no Node 26 → `node:sqlite`
nativo via `sqlite-proxy`; type-stripping proíbe *parameter properties* e enums.

---

## 9. Lacunas conhecidas

Honestamente: o que está no schema mas **não é populado**, e o que não foi feito.

| Item | Estado | Impacto |
|---|---|---|
| ~~`proposicao` / `proposicao_tema`~~ | ✅ **resolvido** — 166 proposições, 154/154 nominais vinculadas, 153 com tema | Eixos temáticos da Fase 2 destravados |
| `partido_alias` | **vazia** — schema existe, pipeline não popula | Sem efeito hoje (só Câmara); vira problema ao integrar TSE ("PC do B" vs "PCdoB") |
| Integração TSE | **não implementada** — `identidade_externa` só tem fonte `camara` | Sem vínculo com candidatura, bens declarados, `SQ_CANDIDATO`. O método está validado (31/31 por CPF), falta codificar |
| Senado | **não integrado** | Escopo da Fase 1 |
| ~~Período coletado~~ | ✅ **resolvido** — legislatura 57 varrida até 2026-08-07 | Restam as sessões até 2027-01-31, via `npm run ingerir:incremental` |
| Votação parcialmente escrita é dada por completa | **gap conhecido** — a checagem de "já coletada" olha só se a linha de `votacao` existe (`pipeline.ts:470`), não se os votos ficaram completos | Coleta interrompida no meio de uma votação deixa votos faltando **permanentemente**: na re-execução ela é pulada. É a hipótese para os 421 votos a mais na recoleta (§7.1) — a coleta anterior sofreu duas interrupções documentadas em §8. Correção possível: comparar o nº de votos gravados com o placar da `descricao`, ou marcar a votação como completa só após o commit dos votos |
| `posicao` acumula períodos sem sinalizar | **gap de modelo** — nada impede dois recortes coexistirem, e só o `relatorio` escolhe o mais abrangente | Foi o que produziu `posicao = 240` no banco antigo (§7.1). `ingerir:incremental` evita **criar** o resíduo, mas não limpa o que já existe nem alerta. Uma UI que consultasse `posicao` sem filtrar por período mostraria o parlamentar duas vezes |
| Camada web / API HTTP | **não iniciada** | Nada é servido ainda |
| App mobile | **não iniciado** | Fase 3 |
| Metodologia pública dos eixos | documentada em `MODELO-DADOS.md`, **não publicada** | Requisito antes de exibir posições |
| Download de arquivos DivulgaCand | padrão de URL não resolvido (404) | Sem impacto no MVP |

### Ressalva sobre o filtro de discursos

Os 97 classificados como `orientacao_voto` às vezes passam de 1.400 caracteres —
o parlamentar justifica o voto ao orientar, e **esse conteúdo não está na tabela
`orientacao`**, que guarda só a posição. Se o perfil parecer vazio demais, é o
primeiro grupo a reconsiderar.

---

## 10. Estado do código

```
src/                                    4.350 linhas TypeScript
  db/schema.ts        840   20 tabelas, comentadas com o achado que as motivou
  db/client.ts         72   node:sqlite via sqlite-proxy + consultar() tipado
  db/migrar.ts         59   aplica migrations, controla em _migrations
  db/validar.ts       480   45 verificações contra casos de borda reais
  lib/http.ts         148   retry, backoff, janelas de data
  lib/normalizar.ts   137   voto, CPF, sigla, data, hoje() em Brasília
  lib/classificar.ts  111   classificação de discurso
  lib/natureza.ts      69   mérito vs. procedimental
  ingest/camara.ts    251   cliente tipado da API
  ingest/pipeline.ts  967   6 etapas de ingestão
  ingest/index.ts     110   CLI
  ingest/incremental.ts 153 CLI da retomada automática
  ingest/horizonte.ts 105   de onde continuar — testável, sem rede
  calc/posicoes.ts    338   dois eixos + evidências
  relatorio.ts        255   verificação do acervo
drizzle/                    5 migrations
```

**Stack:** TypeScript (type-stripping nativo, sem build), Drizzle ORM,
SQLite via `node:sqlite`. Node **22.6+** (declarado em `engines`, com
`engine-strict=true`): abaixo disso não existe `--experimental-strip-types` e
todo `npm run` falha com erro de sintaxe.

### Comandos

```bash
npm run ingerir:incremental
```

Manutenção periódica: descobre no banco até onde cada etapa chegou e continua do
**menor** horizonte. Sem banco, falha dizendo como reconstruir — não inicia
acervo. Rejeita `--inicio`/`--fim`/`--etapas`: as datas vêm do banco.

Medido: **~49 s** em regime normal; **8,3 min** na primeira execução sobre banco
anterior a esta versão, que recoleta os discursos por não ter como provar
cobertura (auto-cura, uma vez por banco — ver INGESTOR.md).

```bash
npm run ingerir -- --inicio 2023-02-01 --fim 2026-08-07
```

Reconstrução do zero. A legislatura inteira leva **~91 min** e ~9.700 operações.

```bash
npm run relatorio
```

```bash
npm run db:validar
```

Etapas: `referencias`, `deputados`, `votacoes`, `proposicoes`, `discursos`,
`reclassificar`, `posicoes`. A etapa `reclassificar` re-deriva natureza de
votação e categoria de discurso sem recoletar. Flags: `--uf`, `--legislatura`, `--inicio`, `--fim`, `--etapas`.

Custo por semestre: ~3 + 62 + (2 janelas + ~450 `/votos` + ~154 `/orientacoes`)
+ ~31 ≈ 700 requisições. Primeira execução ~510s; re-execução ~60s (cache).

> **`--etapas` importa na ingestão incremental.** `posicao` é gravada com chave
> `(periodo_inicio, periodo_fim)`. Rodar todas as etapas com uma janela estreita
> não atualiza as posições da legislatura: cria um segundo conjunto apurado
> sobre poucos dias, que o `relatorio` não mostra por escolher o período mais
> abrangente. `ingerir:incremental` existe para separar as duas janelas.

---

## 11. Próximos passos sugeridos

1. ~~**Manter o acervo atualizado**~~ — ✅ automatizado em
   `npm run ingerir:incremental`. Rodar periodicamente; votações passadas são
   imutáveis e ficam em cache. A legislatura vai até 2027-01-31.
2. **Integrar TSE via CSV** — método validado, falta implementar. Popular
   `identidade_externa` e `partido_alias`.
3. **Publicar a metodologia dos eixos** antes de qualquer exibição pública.
4. **Eixos temáticos (Fase 2)** — agora possíveis: `proposicao_tema` está
   populada e 99,4% das votações nominais têm tema.
5. **Camada web (Next.js)** — perfis indexáveis; a visualização orbital pode
   consumir `posicao` + `posicao_evidencia` diretamente.
