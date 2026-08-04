# CHECKPOINT — Bússola Cívica

**Data:** 2026-08-04 · **Fase:** 0 (deputados federais do RS)
**Estado:** backend funcional — reconhecimento, modelo, ingestor e cálculo de
posições prontos e validados contra dados reais. Web e app ainda não iniciados.

Documentos detalhados: [FONTES.md](./FONTES.md) · [MODELO-DADOS.md](./MODELO-DADOS.md) · [INGESTOR.md](./INGESTOR.md)

---

## 1. O que foi feito

| # | Etapa | Entregável |
|---|---|---|
| 1 | Reconhecimento das APIs | `docs/FONTES.md` — 26 endpoints testados, request/response verificados |
| 2 | Modelo de dados | `src/db/schema.ts` — 20 tabelas, 3 migrations, 24 verificações |
| 3 | Ingestor | `src/ingest/` + `src/lib/` — coleta idempotente com retry e auditoria |
| 4 | Cálculo de posições | `src/calc/posicoes.ts` — 2 eixos com evidência rastreável |
| 5 | Classificação de discursos | `src/lib/classificar.ts` — filtro de ruído protocolar |

Banco atual: **9,3 MB**, 1º semestre de 2025 (votações de 2025-02-04 a 2025-06-26).

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
que as queries respondem certo. **24 verificações.**

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
| `GET /proposicoes/{id}/temas` | ✅ testado | **Não usado ainda** (ver §9) |
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

Versão da metodologia gravada em cada linha: `2026-08-03.1`.

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

| Métrica | Ingestor | Reconhecimento |
|---|---|---|
| Votações de plenário (1º sem/2025) | 450 | 450 |
| Nominais / simbólicas | 154 / 296 | 154 / 296 |
| Taxa de nominais | 34,2% | 34,2% |
| Votos individuais | 58.724 | 58.724 |
| Sim / Não | 31.375 / 26.940 | idênticos |
| Artigo 17 / Abstenção / Obstrução | 151 / 149 / 109 | idênticos |
| Posições calculadas | 29/31 | 29/31 |
| Orientações de bloco com `partido_id` | 0 de 980 | confirma achado 6 |
| Cruzamento Câmara↔TSE por CPF | — | 31/31 |

### Conteúdo do banco

| Tabela | Linhas | | Tabela | Linhas |
|---|---|---|---|---|
| `voto` | 58.724 | | `mandato` | 31 |
| `posicao_evidencia` | 6.164 | | `tema` | 32 |
| `orientacao` | 1.221 | | `partido` | 28 |
| `coleta` | 926 | | `exercicio` | 39 |
| `discurso` | 839 | | `filiacao` | 53 |
| `politico` | 525 (31 completos) | | `posicao` | 58 |
| `identidade_externa` | 525 | | `eixo` | 2 |
| `votacao` | 450 | | `legislatura` | 1 |

**Coleta:** 926 operações, 952 requisições, **22 precisaram de retry**.

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
| Log reportava evidências calculadas como gravadas | Número enganoso (40.666 vs 2.544) | Log distingue os dois |

**Ajustes de ambiente:** `better-sqlite3` não compila no Node 26 → `node:sqlite`
nativo via `sqlite-proxy`; type-stripping proíbe *parameter properties* e enums.

---

## 9. Lacunas conhecidas

Honestamente: o que está no schema mas **não é populado**, e o que não foi feito.

| Item | Estado | Impacto |
|---|---|---|
| `proposicao` / `proposicao_tema` | **vazias** — 0 de 450 votações ligadas a proposição | Bloqueia eixos temáticos da Fase 2; hoje a votação só tem `descricao` em texto livre |
| `partido_alias` | **vazia** — schema existe, pipeline não popula | Sem efeito hoje (só Câmara); vira problema ao integrar TSE ("PC do B" vs "PCdoB") |
| Integração TSE | **não implementada** — `identidade_externa` só tem fonte `camara` | Sem vínculo com candidatura, bens declarados, `SQ_CANDIDATO`. O método está validado (31/31 por CPF), falta codificar |
| Senado | **não integrado** | Escopo da Fase 1 |
| Período coletado | apenas 1º sem/2025 | Legislatura 57 vai de 2023-02-01 a 2027-01-31 |
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
src/                                    3.049 linhas TypeScript
  db/schema.ts        797   20 tabelas, comentadas com o achado que as motivou
  db/client.ts         72   node:sqlite via sqlite-proxy + consultar() tipado
  db/migrar.ts         59   aplica migrations, controla em _migrations
  db/validar.ts       304   24 verificações contra casos de borda reais
  lib/http.ts         148   retry, backoff, janelas de data
  lib/normalizar.ts   113   voto, CPF, sigla, data
  lib/classificar.ts  111   classificação de discurso
  ingest/camara.ts    192   cliente tipado da API
  ingest/pipeline.ts  694   5 etapas de ingestão
  ingest/index.ts     107   CLI
  calc/posicoes.ts    296   dois eixos + evidências
  relatorio.ts        156   verificação do acervo
drizzle/                    3 migrations
```

**Stack:** TypeScript (type-stripping nativo, sem build), Drizzle ORM,
SQLite via `node:sqlite`, Node 26.

### Comandos

```bash
npm run ingerir -- --inicio 2025-01-01 --fim 2025-06-30
```

```bash
npm run relatorio
```

```bash
npm run db:validar
```

Etapas: `referencias`, `deputados`, `votacoes`, `discursos`, `reclassificar`,
`posicoes`. Flags: `--uf`, `--legislatura`, `--inicio`, `--fim`, `--etapas`.

Custo por semestre: ~3 + 62 + (2 janelas + ~450 `/votos` + ~154 `/orientacoes`)
+ ~31 ≈ 700 requisições. Primeira execução ~510s; re-execução ~60s (cache).

---

## 11. Próximos passos sugeridos

1. **Ligar votação a proposição** — destrava temas e enriquece o perfil. Hoje a
   votação carrega só texto livre.
2. **Ampliar o período** para a legislatura inteira (2023→). São 8 janelas de 3
   meses; volume estimado ~1.200 votações nominais, suficiente para escalonamento.
3. **Integrar TSE via CSV** — método validado, falta implementar. Popular
   `identidade_externa` e `partido_alias`.
4. **Publicar a metodologia dos eixos** antes de qualquer exibição pública.
5. **Camada web (Next.js)** — perfis indexáveis; a visualização orbital pode
   consumir `posicao` + `posicao_evidencia` diretamente.
