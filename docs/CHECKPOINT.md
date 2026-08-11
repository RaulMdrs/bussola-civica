# CHECKPOINT — Bússola Cívica

**Data:** 2026-08-11 · **Fase:** 0 concluída · Fase 1 (Senado) integrada
**Estado:** backend e site no ar, com design próprio. Coleta, modelo, cálculo,
metodologia pública e camada web funcionando e validados contra dados reais.
App mobile não iniciado.

Site: <https://raulmdrs.github.io/bussola-civica/>

Documentos detalhados: [FONTES.md](./FONTES.md) · [MODELO-DADOS.md](./MODELO-DADOS.md) · [INGESTOR.md](./INGESTOR.md)
(links com extensão de propósito: este arquivo é excluído do site e lido no
repositório, onde é `FONTES.md` que existe — nas páginas publicadas é `/FONTES`)

---

## 1. O que foi feito

| # | Etapa | Entregável |
|---|---|---|
| 1 | Reconhecimento das APIs | `docs/FONTES.md` — 26 endpoints testados, request/response verificados |
| 2 | Modelo de dados | `src/db/schema.ts` — 20 tabelas, 7 migrations, 79 verificações |
| 3 | Ingestor | `src/ingest/` + `src/lib/` — coleta idempotente com retry e auditoria |
| 4 | Cálculo de posições | `src/calc/posicoes.ts` — 2 eixos com evidência rastreável |
| 5 | Classificação de discursos | `src/lib/classificar.ts` — filtro de ruído protocolar |
| 6 | Vínculo votação↔proposição | etapa `proposicoes` — matéria, objeto votado e temas |
| 7 | Separação mérito/procedimental | `src/lib/natureza.ts` — eixos apurados em dois escopos |
| 8 | Ampliação para a legislatura | 6.291 votações, 452 mil votos, 31/31 parlamentares posicionados |
| 9 | Ingestão incremental | `src/ingest/incremental.ts` — retomada automática, sem informar data |
| 10 | Eixos por tema | `posicao.tema_id` — 12 temas, mesma metodologia sobre universo menor |
| 11 | Integração TSE | etapa `tse` — 546 candidaturas, 31/31 cruzadas por HMAC do CPF |
| 12 | Camada web | `npm run site` — 31 perfis, 12 temas, estático no GitHub Pages |
| 13 | Senado (Fase 1) | etapa `senado` — 353 votações, 3 senadores, **um eixo só** |
| 14 | Design próprio | `docs/_layouts/` + `docs/assets/bussola.css` — sem tema de terceiro, sem JS, sem dependência (§6.3) |
| 15 | Site inteiramente gerado | 50 páginas, incluindo a home: nenhum número do acervo é digitado |

Banco atual: **80 MB**. Câmara: 6.291 votações (1.117 nominais), 452.356 votos.
Senado: 353 votações (114 abertas), 28.593 votos. 34 parlamentares com perfil
completo — 31 deputados e 3 senadores —, 871 posições e 86.315 evidências.

O acervo foi **reconstruído do zero** em 2026-08-07 (91 min, ~9.700 operações) e
reproduziu exatamente os totais estruturais da coleta anterior — 1.112 nominais,
5.169 simbólicas, natureza 570/532/10. As diferenças residuais estão em §7.1.

Em 2026-08-08 entraram **10 votações de 2023-10-31** que nenhuma das duas
coletas anteriores tinha: caíam na borda de uma janela, e `dataFim` é exclusivo
na origem (§8). Daí os totais atuais serem 6.291 e 1.117, e não 6.281 e 1.112.

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
que as queries respondem certo. **79 verificações.**

Os sete casos de classificação de discurso são regressões: cada um quebrou uma
versão anterior da regra.

### 3.4 Verificação cruzada contra o reconhecimento

O ingestor não é considerado correto por rodar sem erro. `npm run relatorio`
compara o acervo com os números medidos independentemente na fase de
reconhecimento. Tudo bate exatamente (§7).

Divergência sem causa identificada não é arredondada nem racionalizada: fica
escrita como "não explicado" até alguém explicar. Foi assim que as 96
proposições saíram de nota solta para causa confirmada — a resposta estava no
histórico do git, e só apareceu porque a pergunta ficou aberta e visível (§7.1).

Onde o número pode ser conferido **contra a origem, item a item**, é o que se
faz — não por amostra. O vínculo de proposição foi verificado nas 1.117
votações nominais (§7.2).

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
| `GET /votacoes?idOrgao=180&dataInicio=&dataFim=` | ✅ **usado** | Janela **máx. 3 meses**; `itens` **máx. 100**; **`dataFim` é exclusivo** e filtra por `dataHoraRegistro`, não pela data da votação — medido, não documentado na spec (§8) |
| `GET /deputados/{id}/discursos?dataInicio=&dataFim=` | ✅ **usado** | **`dataFim` é inclusivo** aqui — comportamento oposto ao de `/votacoes`, também medido |
| `GET /votacoes?siglaOrgao=PLEN` | ❌ 400 | Parâmetro inexistente — é `idOrgao` |
| `GET /votacoes/{id}/votos` | ✅ **usado** | **Sem paginação**; `[]` = votação simbólica |
| `GET /votacoes/{id}/votos?itens=600` | ❌ 400 | Não aceita paginação |
| `GET /votacoes/{id}/orientacoes` | ✅ **usado** | `partido_id` só resolvível se `codTipoLideranca='P'` |
| `GET /orgaos?sigla=PLEN` | ✅ **usado** | Plenário = id **180** |
| `GET /legislaturas/{id}` | ✅ **usado** | 57ª: 2023-02-01 → 2027-01-31 |
| `GET /referencias/proposicoes/codTema` | ✅ **usado** | 32 temas — base dos eixos da Fase 2 |
| `GET /votacoes/{id}` | ✅ **usado** | Detalhe; única fonte de `proposicoesAfetadas` |
| `GET /proposicoes/{id}` | ✅ **usado** | Resolve o objeto formalmente votado |
| `GET /proposicoes/{id}/temas` | ✅ **usado** | 1.110 de 1.117 votações nominais têm tema (99,4%) |
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

### 6.3 Design do site

O design foi produzido a partir de um briefing ([BRIEFING-DESIGN.md](https://github.com/RaulMdrs/bussola-civica/blob/main/BRIEFING-DESIGN.md))
e entregue como CSS e layout de produção. Ele vive em
`docs/_layouts/default.html` e `docs/assets/bussola.css`: folha única escrita à
mão, sem build, sem JavaScript, sem CDN, clara e escura. O
`jekyll-theme-primer` saiu.

**O gerador continua emitindo Markdown.** As células levam HTML inline
(`.valor`, `.n`, `.aviso-n`) e cada tabela declara sua classe pelo IAL do
kramdown (`{: .t-indice}`). Isso preserva a propriedade que importa: o diff de
cada rebuild mostra o que mudou nos números, e o site segue sendo registro
auditável em vez de artefato opaco.

As restrições abaixo **não são preferências estéticas** — são o princípio do
projeto traduzido para a tela, e qualquer página nova precisa respeitá-las:

| Restrição | Por quê |
|---|---|
| O `n` é conteúdo, nunca tooltip, cinza-claro ou fonte abaixo de 15px | 100% sobre 3 votações e 83% sobre 24 não são comparáveis. O `n` tem de ser lido antes de qualquer conclusão |
| `n < 20` recebe etiqueta âmbar com borda, hachura na linha e, no celular, a linha inteira | O padrão da indústria é opacidade reduzida, que apaga o aviso exatamente quando ele mais importa |
| Nenhuma cor ordena pessoas ou valores | Alinhamento de 27,8% não é pior que 97,5% — é diferente. A cor identifica **eixo**, num filete, nunca no texto |
| Sem cores oficiais de partido | Reintroduziria a leitura ideológica pela porta dos fundos |
| Sem pódio, medalha ou destaque de topo/base | A ordenação por valor é navegação, não julgamento |
| Link de fonte sempre rotulado, alvo de 44px, nunca só em hover | No celular não existe hover |
| Ausência de eixo é bloco tracejado, não buraco | No Senado o eixo 1 não existe, e isso é informação |

Três defeitos do CSS recebido foram corrigidos antes de entrar, todos
confirmados por medição no navegador: `<caption>` encolhendo para 75px em
tabela que virou bloco; `td:last-child { padding-right: 0 }` vazando para os
cartões do celular; e `--eixo-gov` a 0,02 de luminosidade e 5° de matiz do
`--link`, o que fazia nome de eixo parecer clicável.

**Verificado:** `scrollWidth == clientWidth == 360` — nenhuma coluna escondida,
nenhum scroll horizontal, em qualquer largura ≥ 320px.

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
| **Cobertura** (até onde se olhou) | 2023-02-01 → 2026-08-08 |
| **Votações** (primeira → última sessão) | 2023-02-07 → 2026-07-15 |
| Votações | 6.291 (1.117 nominais, 5.174 simbólicas) |
| Taxa de nominais | **17,8%** |
| Votos individuais | 452.356, de 643 parlamentares (444.539 computáveis) |
| Natureza das nominais | mérito 571, procedimental 536, formal 10 |
| Proposições / vínculos de tema | 646 / 906 |
| Nominais vinculadas à matéria | 1.116/1.117 (99,9%); com tema 1.110 (99,4%) |
| Discursos | 5.851 (4.947 substantivos) |
| Posições | 124 = 31/31 parlamentares × 2 eixos × 2 escopos |
| Evidências | 47.158 |
| Coleta | 10.397 operações (acumulado), 83 falhas |

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
| `voto` | 452.356 | | `mandato` | 31 |
| `posicao_evidencia` | 47.158 | | `tema` | 32 |
| `orientacao` | 11.732 | | `partido` | 33 |
| `coleta` | 10.397 | | `exercicio` | 40 |
| `discurso` | 5.851 | | `filiacao` | 54 |
| `politico` | 643 (31 completos) | | `posicao` | 124 |
| `identidade_externa` | 643 | | `eixo` | 2 |
| `votacao` | 6.291 | | `legislatura` | 1 |
| `proposicao` | 646 | | `proposicao_tema` | 906 |

**Coleta:** 10.397 operações (acumulado — cresce a cada execução), 83 falhas. As 83 falhas
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
| `proposicao_tema` | 1.071 | **906** | Mesma causa da linha abaixo: as 96 proposições extras carregavam seus temas |
| `proposicao` | 741 | **646** | **Explicado e verificado** — até `03af5bf` a etapa `proposicoes` não filtrava por `nominal`: vinculava **todas** as votações. O filtro entrou em `1651be2`. As proposições das 296 simbólicas do 1º sem/2025 entraram sob a regra antiga e ficaram. Refazendo aquele cálculo sobre as mesmas simbólicas: **96 proposições** a mais (646 + 96 = 742, contra 741) |
| `discurso` | 5.868 | **5.851** | Deduplicação por hash de conteúdo: transcrição republicada pela Câmara gera segundo registro na re-ingestão (custo assumido, INGESTOR.md). Coleta limpa não tem os 17 |
| `voto` | 450.209 | **450.630** | +421 — a votação 2576389-4, única do acervo em que a origem devolve `tipoVoto` nulo para todos os 421 votantes. **Confirmado**: foi onde a coleta anterior quebrou, e a re-execução a pulou como "já coletada" (§8) |

Nenhuma dessas diferenças altera eixo, escopo ou posição de parlamentar. O
acervo novo é o menos ambíguo dos dois: um período só, sem resíduo de execução
anterior.

### 7.2 Vínculo de proposição — conferido contra a origem

Não por amostra: **as 1.117 votações nominais**, uma a uma.

| Verificação | Resultado |
|---|---|
| Matéria gravada = `proposicoesAfetadas[0]` da origem | **1.116** |
| Sem `proposicoesAfetadas` na origem **e** sem vínculo no acervo | 1 |
| Divergentes | **0** |
| Objeto votado = prefixo do id da votação (conferível sem rede) | **1.117/1.117** |
| Matérias distintas segundo a origem | 421 — as mesmas 421 do acervo |
| Proposições órfãs (no acervo, sem votação que as referencie) | **0** |

As 646 proposições são exatamente a união de 421 matérias e 517 objetos votados.
Não há resíduo nem lacuna: o número não é "o que sobrou", é o conjunto fechado
que a regra atual produz.

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
| Linha de `votacao` gravada antes dos votos, fora de transação | Interrupção no meio do laço deixava a votação registrada e os votos pela metade; a re-execução a pulava como "já coletada". **421 votos da votação 2576389-4 ficaram fora do acervo** entre 2026-08-04 e 2026-08-07 | Votação e votos numa transação só. "A linha existe" volta a significar "os votos estão todos lá" |
| `dataFim` da origem é **exclusivo**, e `janelas()` fatia em blocos consecutivos | O último dia de cada janela não era pedido a ninguém. **10 votações de 2023-10-31** faltavam no acervo; as outras 13 bordas caíram em recesso ou fim de semana e não perderam nada | A URL de `/votacoes` pede o dia seguinte; o intervalo segue inclusivo no resto do código, inclusive no recurso gravado em `coleta` |
| `DELETE` do recálculo de posições casava o `periodo_fim` exato | `ingerir:incremental` rodado em dois dias seguidos gravava dois conjuntos completos, um por `fim` — 124 posições viraram 248 na virada de 2026-08-07 para 08-08 | O `DELETE` passa a casar a **série** (eixo, escopo, legislatura, `periodo_inicio`); apuração nova supersede a anterior |

**Ajustes de ambiente:** `better-sqlite3` não compila no Node 26 → `node:sqlite`
nativo via `sqlite-proxy`; type-stripping proíbe *parameter properties* e enums.

---

## 9. Lacunas conhecidas

Honestamente: o que está no schema mas **não é populado**, e o que não foi feito.

| Item | Estado | Impacto |
|---|---|---|
| ~~`proposicao` / `proposicao_tema`~~ | ✅ **resolvido e conferido contra a origem** (§7.2) — 646 proposições, 1.116/1.117 nominais vinculadas, 1.110 com tema, zero divergências | Eixos temáticos da Fase 2 destravados |
| ~~`partido_alias`~~ | ✅ **populada** pela etapa `tse` | O caso previsto apareceu: "PC do B" (TSE) → "PCdoB" (Câmara), 1 alias |
| ~~Integração TSE~~ | ✅ **implementada** — etapa `tse`, 546 candidaturas de 2022, 31/31 cruzadas | `identidade_externa` tem `SQ_CANDIDATO` por eleição. O CPF passou a ser guardado como HMAC (§8) |
| ~~Senado~~ | ✅ **integrado** — 353 votações, 114 abertas, 3 senadores | Só coesão partidária: não há orientação de bancada em dados abertos, então o eixo 1 não é calculável lá (§8). Sem CPF na origem, senador não cruza com o TSE |
| ~~Período coletado~~ | ✅ **resolvido** — legislatura 57 varrida até 2026-08-08 | Restam as sessões até 2027-01-31, via `npm run ingerir:incremental` |
| ~~Votação parcialmente escrita~~ | ✅ **resolvido** — transação em `ingerirVotacoes` (§8) | O invariante "nominal sem voto gravado" detecta o estado, caso volte a ocorrer |
| ~~`posicao` acumula períodos~~ | ✅ **resolvido** — o `DELETE` supersede a série (§8) | O invariante "mesma série em dois períodos" detecta. Recortes com `periodo_inicio` diferente continuam coexistindo, que é o caso legítimo |
| Camada web / API HTTP | **não iniciada** | Nada é servido ainda |
| App mobile | **não iniciado** | Fase 3 |
| ~~Metodologia pública dos eixos~~ | ✅ **publicada** em <https://raulmdrs.github.io/bussola-civica/metodologia/> — documento vivo, versões superadas arquivadas | `eixo.metodologia_url` grava a URL absoluta; `urlDaVersao()` resolve qualquer versão. Requisito para exibir posição: cumprido |
| Download de arquivos DivulgaCand | padrão de URL não resolvido (404) | Sem impacto no MVP |

### Ressalva sobre o filtro de discursos

Os 97 classificados como `orientacao_voto` às vezes passam de 1.400 caracteres —
o parlamentar justifica o voto ao orientar, e **esse conteúdo não está na tabela
`orientacao`**, que guarda só a posição. Se o perfil parecer vazio demais, é o
primeiro grupo a reconsiderar.

---

## 10. Estado do código

```
src/                                    6.545 linhas TypeScript
  db/schema.ts        872   20 tabelas, comentadas com o achado que as motivou
  db/client.ts         72   node:sqlite via sqlite-proxy + consultar() tipado
  db/migrar.ts         59   aplica migrations, controla em _migrations
  db/validar.ts       856   79 verificações contra casos de borda reais
  db/integridade.ts    91   invariantes do acervo (usadas por validar e relatorio)
  lib/http.ts         148   retry, backoff, janelas de data
  lib/normalizar.ts   151   voto, CPF, sigla, data, hoje() em Brasília
  lib/classificar.ts  111   classificação de discurso
  lib/natureza.ts      69   mérito vs. procedimental
  lib/zip.ts           83   leitor mínimo de ZIP, sem dependência
  lib/identidade.ts    64   HMAC do CPF — por que hash puro não serve
  ingest/camara.ts    271   cliente tipado da API (dataFim exclusivo)
  ingest/senado.ts    379   cliente + ingestão; natureza fica NULL, por escolha
  ingest/tse.ts       275   candidaturas 2022 via CSV, cruzadas por HMAC
  ingest/pipeline.ts 1024   7 etapas de ingestão; votação+votos em transação
  ingest/index.ts     125   CLI
  ingest/incremental.ts 153 CLI da retomada automática
  ingest/horizonte.ts 105   de onde continuar — testável, sem rede
  calc/posicoes.ts    563   dois eixos + evidências, recorte por tema, regime por casa
  site/gerar.ts       672   gerador do site — 50 páginas, nenhum número digitado
  relatorio.ts        402   verificação do acervo + invariantes
drizzle/                    8 migrations

docs/                                     644 linhas de camada web
  _layouts/default.html 56  cabeçalho, conteúdo, rodapé lido de _data/meta.yml
  assets/bussola.css   588  folha única, à mão, clara e escura (§6.3)
```

**Stack:** TypeScript (type-stripping nativo, sem build), Drizzle ORM,
SQLite via `node:sqlite`. Node **22.6+** (declarado em `engines`, com
`engine-strict=true`): abaixo disso não existe `--experimental-strip-types` e
todo `npm run` falha com erro de sintaxe.

**Uma dependência de runtime** (`drizzle-orm`), e o site não acrescentou
nenhuma: sem Tailwind, sem Sass, sem CDN, sem JavaScript. A camada web é CSS
escrito à mão sobre a saída do kramdown.

### `_data/meta.yml` é gerado, não editado

O rodapé de toda página traz período apurado e versão da metodologia, e os dois
vêm de `docs/_data/meta.yml`, que `npm run site` escreve a partir do banco na
mesma execução que escreve as páginas.

Isso não é conveniência. Metadado de rodapé mantido à mão desvia em silêncio, e
no dia em que desviasse o site afirmaria que os números foram calculados sob uma
metodologia que não os produziu — que é exatamente a rastreabilidade que
sustenta o princípio. O arquivo diz na primeira linha para não ser editado.

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

Da lista anterior fecharam o design e a geração completa do site. Os três itens
de retorno continuam abertos, na mesma ordem — e o primeiro ficou **mais
barato**, não mais urgente: o CSS já provisiona `blockquote.evidencia`, `.n` e o
padrão de blocos-registro, então as páginas de discurso e de evidência nascem no
design sem folha nova.

### Rotina

**0. Manter o acervo e o site.** Semanalmente:

```bash
npm run ingerir:incremental && npm run site && git commit -am "atualiza acervo"
```

~49 s de coleta, alguns segundos de geração, e o Pages reconstrói sozinho. O
diff do commit mostra o que mudou nos números — é registro, não ruído.

### O que dá mais retorno agora

**1. Exibir os discursos.** São **4.947 discursos substantivos** coletados,
classificados e com link para o Diário da Câmara — e **invisíveis no site**. É o
maior desperdício do acervo hoje, e não é acaso: os discursos entraram no MVP
justamente como substituto do plano de governo, que não existe para deputado
(§5, achado 3). Coletá-los e não mostrá-los devolve o projeto ao problema que
eles resolviam.

Cuidado ao fazer: são 9,9 MB de transcrição. Perfil com 124 discursos precisa
de recorte — os mais recentes, com link para o resto — e o filtro
`relevante = 0` continua sendo classificação, não exclusão: a interface deve dar
acesso ao acervo inteiro.

O gerador já traz o padrão a seguir: `blocoEvidencia()` monta um registro com
data, texto da fonte sem edição, e link rotulado. Discurso tem a mesma forma —
data, sumário, transcrição, link para o Diário.

**2. Decompor a evidência por inteiro.** O site mostra **amostra** de
divergência e diz que é amostra. As 86.315 evidências existem no banco e não são
alcançáveis por quem não roda SQL. Uma página por eixo, paginada, fecharia a
promessa de "por que este político está aqui?" sem inchar o perfil.

**3. Automatizar a atualização.** Hoje o ciclo depende de você rodar dois
comandos numa máquina que tem o banco. Uma GitHub Action semanal faria tudo —
mas exige reconstruir o acervo no CI ou cacheá-lo, e o segredo do HMAC vira
segredo do repositório. Decisão real de superfície, não tarefa mecânica.

### Bloqueado pela fonte, não por nós

Registrado para quando houver fonte — nenhum destes é "fazer depois":

| Item | Por que está parado |
|---|---|
| Eixo 1 no Senado | Não há orientação de bancada em dados abertos. Nove endpoints testados, todos 404; busca por nome de campo em 2,5 MB não achou nada (§8) |
| Senador × TSE | Não há CPF na API do Senado. Nome de urna não é chave, e partido menos ainda |
| Recorte por escopo no Senado | A regra mérito × procedimental foi calibrada contra texto da Câmara. Validá-la para o Senado exige casos de borda que ainda não temos |
| Plano de governo | Não existe para deputado federal — interseção medida: zero (§5) |
| Notícias por político | Sem fonte oficial (§5) |

### Fases seguintes

**4. Visualização orbital.** Estava no plano original; o site hoje é tabela.
Consome `posicao` + `posicao_evidencia` direto e roda no cliente, sem servidor.
Exige resolver a armadilha do eixo 2: dois parlamentares opostos com 100% de
coesão ocupam o mesmo ponto, e a visualização precisa deixar isso óbvio.

É também **o primeiro item que quebra uma propriedade atual**: o site hoje não
tem uma linha de JavaScript, e uma órbita interativa tem. Não é impedimento — é
uma decisão a tomar de olhos abertos, com um export JSON novo e a regra de que
a página precisa continuar legível e conferível sem script.

**5. App mobile** (Fase 3) e **estadual/municipal** (Fase 4).

### Dívidas pequenas

- **Não existe Jekyll local.** O Ruby do sistema é 2.6 e a cadeia não instala
  sem trabalho. Hoje a verificação da camada web é feita em duas partes:
  `kramdown` isolado (Ruby puro, mesmo conversor do GitHub Pages) para conferir
  que o IAL e o HTML inline sobrevivem, e varredura de links contra o site
  **já publicado**. Funciona, mas descobre erro depois do deploy — foi assim que
  apareceram os cinco links `../src/*.ts` quebrados.
- **Três links mortos** no corpo das metodologias arquivadas, por decisão: o
  corpo é congelado e o aviso do topo diz que os links são da época, com a
  navegação que o leitor precisa. Ver a regra em `metodologia/versoes/`.
- **`esbuild <= 0.24.2`** nas `devDependencies`, via `drizzle-kit`: 4 avisos
  moderados, alcançáveis só por quem roda `npm run db:studio`. A correção sobe o
  `drizzle-kit` de major.
- **Os 515 candidatos sem mandato** entraram com `perfil_completo = 0` e hoje
  **não aparecem no site** — o gerador só lê `perfil_completo = 1`. A barreira
  está funcionando; ela precisa continuar sendo respeitada por qualquer página
  nova.
- **Domínio próprio.** O site está em `raulmdrs.github.io`. Trocar é uma linha
  na constante `METODOLOGIA` mais o CNAME, mas invalida as URLs já gravadas em
  `eixo.metodologia_url` — recalcular `posicoes` resolve.

### Uma observação para quem for mexer no Senado

Os três senadores têm `n` de **104, 102 e 77**, sobre **114 oportunidades** — e
essas 114 são as votações abertas de um total de **353**. São os `n` mais
frágeis do site, e os únicos cujo denominador vem de uma casa que esconde 68%
do que faz. Os números estão corretos e a página avisa em dois blocos — mas
qualquer visualização que coloque senador e deputado no mesmo plano vai estar
comparando universos que não se comparam.
