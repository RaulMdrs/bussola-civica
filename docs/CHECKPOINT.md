# CHECKPOINT — Bússola Cívica

**Data:** 2026-09-06 · **Fase:** 0 concluída · Fase 1 (Senado) integrada
**Estado:** backend e site no ar, com design próprio, discursos das duas casas
visíveis e buscáveis, todo número decomposto até a votação que o compõe, e a
atualização **rodando sozinha** duas vezes por semana desde 2026-08-25. App
mobile não iniciado.

Site: <https://raulmdrs.github.io/bussola-civica/>

Documentos detalhados: [FONTES.md](./FONTES.md) · [MODELO-DADOS.md](./MODELO-DADOS.md) · [INGESTOR.md](./INGESTOR.md)
(links com extensão de propósito: este arquivo é excluído do site e lido no
repositório, onde é `FONTES.md` que existe — nas páginas publicadas é `/FONTES`)

---

## 1. O que foi feito

| # | Etapa | Entregável |
|---|---|---|
| 1 | Reconhecimento das APIs | `docs/FONTES.md` — 26 endpoints testados, request/response verificados |
| 2 | Modelo de dados | `src/db/schema.ts` — 20 tabelas, 7 migrations, 83 verificações |
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
| 14 | Design próprio | `docs/_layouts/` + `docs/assets/bussola.css` — sem tema de terceiro, sem dependência (§6.3) |
| 15 | Site inteiramente gerado | home incluída: nenhum número do acervo é digitado |
| 16 | Discursos no site | 5.851 discursos visíveis, 111 páginas por parlamentar e ano (§6.4) |
| 17 | Busca nos discursos | `docs/assets/busca.js` — 236 linhas à mão, sob demanda, degrada sem script (§6.5) |
| 18 | Decomposição completa | 47.441 votações em 127 páginas — cada percentual do site vira link para a sua conta (§6.6) |
| 19 | Discursos do Senado | etapa `senado` — 717 pronunciamentos, classificados **pela própria fonte** (§6.7) |
| 20 | Atualização automatizada | `.github/workflows/acervo.yml` — 2×/semana, custo zero, valida antes de publicar. **Em produção desde 2026-08-25** (§6.8) |
| 21 | Guarda contra retrocesso | O gerador se recusa a publicar acervo mais velho que o já publicado (§6.9) |
| 22 | Visualização orbital | SVG estático, **sem JavaScript** — desenhada para não conseguir expressar a comparação falsa (§6.10) |
| 23 | Encontrabilidade | `sitemap.xml` de 308 URLs, `robots.txt` e etiquetas de compartilhamento (§6.11) |

Acervo em **2026-09-06** (banco de 79 MB): Câmara com 6.450 votações, 1.125
nominais; Senado com 357, das quais 117 abertas. 484.460 votos, 6.619 discursos,
871 posições e 87.244 evidências — 5.902 discursos da Câmara e 717 do Senado.
34 parlamentares com perfil completo: 31 deputados e 3 senadores.

> **Todo número deste documento é uma medição datada, não um fato corrente.**
> Desde 2026-08-25 a Action atualiza o acervo duas vezes por semana, então
> qualquer contagem escrita aqui envelhece em dias. O que não envelhece é a
> forma de refazê-la: `npm run relatorio` recalcula tudo a partir do banco e
> compara com o reconhecimento. **A fonte é o acervo; isto aqui é registro.**

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
que as queries respondem certo. **83 verificações.**

O total é **contado, não digitado**. Até 2026-08-19 era a constante
`totalChecagens = 79`, atualizada à mão — e já estava errada em 4 quando alguém
foi conferir. O arquivo cuja razão de existir é impedir desvio silencioso
desviava no próprio resumo, que é o pior lugar possível: quem lê "79
verificações" acredita que 79 rodaram.

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
| `GET /senador/{cod}/discursos.json` | ✅ **usado** | **Janela grampeada em 12 meses, sem aviso** — coletar ano a ano (FONTES §2.5) |
| `GET /senador/{cod}/apartes.json` | ✅ testado | Aparte é fala no discurso de outro; fora do escopo |
| `GET /senador/{cod}/pronunciamentos.json` | ❌ 404 | O caminho é `discursos` |
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

| Categoria | Qtd | No perfil | No site |
|---|---:|---|---|
| `substantivo` | 4.947 (84,5%) | sim | seção do perfil + páginas por ano |
| `orientacao_voto` | 866 | não — já estruturado em `orientacao` | páginas por ano, em seção própria |
| `registro_presenca` | 38 | não | páginas por ano, em seção própria |

Total **5.851**. A coluna "no site" é o que torna a terceira restrição
verificável: classificar sem excluir só significa alguma coisa se o classificado
continuar alcançável, e desde 2026-08-15 ele está — inteiro, com o mesmo link
para a fonte (§6.4).

### 6.3 Design do site

O design foi produzido a partir de um briefing ([BRIEFING-DESIGN.md](https://github.com/RaulMdrs/bussola-civica/blob/main/BRIEFING-DESIGN.md))
e entregue como CSS e layout de produção. Ele vive em
`docs/_layouts/default.html` e `docs/assets/bussola.css`: folha única escrita à
mão, sem build, sem CDN, clara e escura. O `jekyll-theme-primer` saiu.

Até 2026-08-15 esta seção dizia também **"sem JavaScript"**. Deixou de ser
verdade com a busca (§6.5), e a afirmação foi corrigida aqui em vez de
sobreviver por inércia: CHECKPOINT que descreve um estado que o repositório não
tem mais é pior que CHECKPOINT nenhum.

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

#### Uma família de defeitos que reincide

Quatro bugs deste CSS foram o **mesmo** erro: uma regra com seletor mais curto
perdendo para outra mais longa, silenciosamente.

| Regra | Perdia para | Efeito |
|---|---|---|
| `.superada` | `.conteudo blockquote` | faixa de versão arquivada saía cinza |
| `.evidencia { max-width: none }` | `.conteudo blockquote` | evidência presa em 34rem, corpo em 310px |
| `.evidencia` (móvel) | `.conteudo .evidencia` | grade em duas colunas no celular: 483px em tela de 360 |
| `td:last-child` (móvel) | `td:last-child` (desktop) | valor encostando na borda do cartão |

O terceiro foi **criado pela correção do segundo** — subir a especificidade da
regra base sem subir a do override. Ao mexer neste arquivo, a checagem é
mecânica: mudou o seletor de uma regra, procure quem a sobrescreve.

### 6.4 Discursos — o que o site exibe, e o que não

Os discursos entraram no MVP como substituto do plano de governo, que não existe
para deputado federal (§5). São a única coisa no acervo em que o parlamentar
fala por si, em vez de ser medido contra uma régua externa.

**A transcrição não vai para o site.** São **11 MB** — entrariam no git e seriam
reescritos a cada rebuild semanal, para reproduzir um texto que já está
publicado no Diário. O site exibe o **sumário oficial**, que é o que permite
varrer 981 discursos e achar o que interessa, e cada item leva ao Diário.

**Uma página por parlamentar e ano**, não uma por parlamentar. O mais falante
tem 981 discursos e 451 KB só de sumário; por ano, o pior caso cai para 294 KB
de Markdown — **42 KB pelo fio**, com o gzip do Pages. Ano é divisão que a fonte
já traz: não é recorte editorial, e ninguém precisa decidir o que fica de fora.

| Decisão | Por quê |
|---|---|
| Sumário sim, transcrição não | 11 MB no git para duplicar o Diário, que já publica e para onde o link aponta |
| Página por ano | 981 discursos num arquivo só dá 700 KB; ano é divisão da própria fonte |
| Protocolares em seção própria, não escondidos | Classificar é separar, não excluir — a página inteira ficaria mentindo sobre isso |
| Sem sumário → dizer que não há | 53 discursos não têm sumário na origem. Cortar transcrição para preencher seria resumo nosso |
| `url_texto`, com `fonte_url` de reserva | 403 não têm link do Diário utilizável. Rótulos diferentes porque os destinos são diferentes |

**O `url_texto` da coleção `J` não abre.** Descoberto clicando no primeiro link
da primeira página publicada: o Diário responde "Documento não encontrado no
Banco de Dados". Medido em seguida — **20 de 20** links com
`selCodColecaoCsv=J` mortos; **30 de 30** da amostra geral (98% coleção `D`)
vivos. São 101 dos 5.549 discursos com `url_texto`.

O defeito é da origem, e não cabe a nós consertar o link dela. Cabe **não
repassar como "texto integral no Diário" um endereço que sabidamente entrega
página de erro** — esses 101 caem no mesmo tratamento dos 302 sem `url_texto`, e
o site tem hoje 5.448 links para o Diário e 403 para a API.

Uma consequência de nomenclatura: `n` passou a valer só para **base de
percentual**. Contagem de discursos por ano é contagem, não base de nada, e sai
como número simples — rotular tudo de `n` gastaria o símbolo justamente onde ele
precisa parar o leitor. O mesmo valeu para "votações nominais" no índice de
temas.

### 6.5 Busca nos discursos — onde o JavaScript entrou

Exibir os 5.851 sumários resolveu metade do problema: o leitor passou a ver o
que cada parlamentar disse, mas só se já soubesse **em qual parlamentar e em
qual ano** procurar. A busca fecha isso.

**Não havia caminho sem script.** Procurar uma palavra em 5.851 sumários exige o
texto do lado do leitor, e não há servidor. As alternativas foram medidas e
descartadas: uma página por termo daria dezenas de milhares de páginas
repetindo o mesmo texto (16.562 termos no vocabulário, 6.073 deles ocorrendo uma
única vez); uma página única com tudo daria 2,8 MB.

Foi a primeira vez que o site ganhou JavaScript, e a decisão veio com três
condições, todas cumpridas:

| Condição | Como ficou |
|---|---|
| Escrito à mão, sem dependência | 236 linhas em `docs/assets/busca.js`. Uma biblioteca de busca traria mais bytes que o acervo que procuraria |
| Nada essencial depende dele | Sem script, a página lista os 31 parlamentares e seus anos — a navegação que já existia. O `<noscript>` diz isso, não pede para ligar o JavaScript |
| O custo é declarado | Medido com `gzipSync` no gerador e escrito na página, nunca digitado. Ver a ressalva sobre o nível de compressão abaixo |

**A busca não classifica nada.** Casa a palavra que o parlamentar disse contra o
sumário que a Câmara publicou, e ordena por data — sem tema inferido, sem
relevância inventada, sem agrupamento nosso. É o oposto de rotular: devolve o
texto da fonte para quem perguntou.

Decisões de formato, todas medidas:

- **Quatro fragmentos, um por ano**, buscados sob demanda: 172 · 186 · 273 ·
  93 KB. Ano é a mesma divisão das páginas de discurso.
- **Colunar, não lista de objetos** — as chaves não se repetem 1.900 vezes.
  Rende 46 KB.
- **A coluna dobrada não é enviada.** Enviar o sumário já sem acento e em
  minúsculas dobrava o arquivo (5,7 MB contra 3,0 MB); dobrar no cliente, uma
  vez ao carregar, custa milissegundos. A função `dobrar()` existe nos dois
  lados e **precisa continuar idêntica** — se divergirem, a busca mente.
- **O destaque monta nós de texto, nunca `innerHTML`.** O sumário é texto de
  terceiro; montá-lo como marcação deixaria a página à mercê do que a origem
  publicar. Mesmo motivo do escape no gerador.
- Cada discurso ganhou âncora (`id="d-<id>"`), e o resultado leva ao discurso
  exato na página do parlamentar, com `:target`.

Verificado no navegador, não por leitura de código:

| Teste | Resultado |
|---|---|
| `seguranca` × `segurança` | 290 dos dois lados — acento não importa |
| `arroz` → `arroz produtores` | 27 → 9: os termos são combinados por **E** |
| filtro de protocolares | 331 → 1.197 |
| link do resultado | cai no `#d-177` certo, com o contorno de `:target` |
| 360px | `scrollWidth == clientWidth == 360`, alvo de toque de 44px |

**O que o leitor paga não é o que medimos.** A página dizia "720 KB", que é o
que o `gzipSync` do Node produz. Medido contra o site publicado, o GitHub Pages
serve **747 KB** — comprime com outro nível, 3,7% a mais:

| Fragmento | Local | Servido | Δ |
|---|---:|---:|---:|
| 2023 | 172 KB | 178 KB | +5,4 KB |
| 2024 | 186 KB | 192 KB | +5,6 KB |
| 2025 | 273 KB | 281 KB | +8,3 KB |
| 2026 | 93 KB | 96 KB | +2,9 KB |

O nível do CDN não é nosso para controlar e pode mudar. A saída não foi fixar
747: foi manter a medição e **arredondar para cima** — margem de 5%, dezena
cheia, e a página diz "cerca de", porque precisão que não temos não se finge.
Hoje declara 760 KB contra 747 reais. **Subestimar o que o leitor vai baixar é
o lado errado de errar.**

**Custo no repositório:** `docs/` passou de 6,2 MB para **9,3 MB**, dos quais
3,0 MB são os fragmentos — reescritos por inteiro a cada `npm run site`. É a
primeira vez que o peso do site pesa na rotina semanal, e entra na conta da
automação (§11).

### 6.6 Decomposição completa — a promessa fechada

O princípio do projeto (§2) diz que "por que este político está aqui?" tem de
ser respondível até a votação que compõe o número. Até 2026-08-16 o perfil
mostrava **3 votações de amostra** e dizia que era amostra; o resto existia só
no banco, para quem roda SQL. Era a promessa aberta mais antiga.

Agora **cada percentual da tabela "Os dois eixos" é um link** para a sua própria
decomposição: todas as votações que entraram na conta, coincidências inclusive,
com o voto registrado e o link para a fonte. Nenhum número do site fica sem.

**São 47.441 evidências, não as 86.315 do banco.** A diferença são 38.874 de
posições por tema, que são as *mesmas votações recontadas uma vez por tema* —
uma matéria pertence a várias. O espelho está nos números: o recorte temático
tem 17.623 evidências de alinhamento contra 10.984 do geral. Não é mais
informação; é a mesma repetida, e publicá-la faria o site parecer maior que o
acervo.

| Decisão | Por quê |
|---|---|
| Página por (parlamentar, eixo, escopo) | 127 páginas, mediana de 388 linhas, máximo 545. É a granularidade da tabela do perfil: cada número exibido ganha o link da sua conta, e nenhum sobra |
| Tabela, não bloco de citação | O CSS já converte tabela em cartões no celular, e é a forma mais densa que sobrevive a 545 linhas |
| Coincidências **e** divergências | Amostra de divergência prova que a decomposição existe; a conta inteira é a decomposição. Omitir as coincidências deixaria o denominador sem lastro |
| Identificador oficial como texto do link | Rotula o link (regra do §6.3) e entrega a chave da votação na origem no mesmo gesto |
| Recorte por tema sem página própria | Seria o mesmo fato três vezes. O tema tem página própria, com as votações dele |

**Coincidiu e divergiu não são acerto e erro**, e o CSS não os pinta como tal:
sem verde, sem vermelho, sem ícone de aprovação — só peso tipográfico, o mesmo
para os dois. A página diz isso em prosa antes da tabela. É a mesma regra que
proíbe cor avaliativa nos eixos (§6.3), aplicada onde ela seria mais tentadora.

#### A guarda: a página tem de reproduzir o número que decompõe

Uma decomposição que não fecha com o número que explica é pior que amostra
nenhuma — parece prova e não é. Verificado nas 127 páginas: linhas =
`n_observacoes`, marcadores = linhas, e coincidências ÷ n reproduz o `valor`
gravado em `posicao`, com uma casa decimal. **127/127.**

Isso virou guarda dentro de `gerarEvidencia()`: se a consulta do gerador e a de
`calc/posicoes.ts` divergirem algum dia — filtro diferente, período diferente,
evidência perdida —, a geração **falha** em vez de publicar uma tabela que não
fecha com o percentual ao lado dela. A guarda foi testada corrompendo o filtro
de propósito:

```
decomposição não fecha para Afonso Hamm · alinhamento_governo · merito:
348 evidências e 49,1% contra n=349 e 49,0% gravados em posicao
```

É o mesmo método do §3.2 aplicado ao site: em vez de confiar que os dois lados
continuam de acordo, tornar o desacordo impossível de publicar.

**Custo:** `docs/` passou de 9,3 MB para **23 MB**, dos quais 13,4 MB são estas
páginas. É o maior salto do projeto. Por página o peso é baixo — a maior tem 171
KB de Markdown e **23 KB pelo fio** —, mas o repositório inteiro é reconstruído
a cada `npm run site`, e isso muda a conta da automação (§11).

### 6.7 Discursos do Senado — a armadilha da janela

A lacuna estava registrada como "desconhecida, que é pior que bloqueada": não
havia reconhecimento nenhum sobre se a fonte entrega discurso de senador. Entrega
— e bem. Mas o caminho até lá tem um alçapão.

#### A janela é grampeada em 12 meses, em silêncio

`GET /senador/{cod}/discursos.json` **ignora `dataInicio` além de 12 meses antes
de `dataFim`**, e não avisa. Medido para Paulo Paim em 2026-08-18:

| Janela pedida | Devolvidos | Período realmente coberto |
|---|---:|---|
| `20230201..20260818` (3,5 anos) | 134 | 2025-08-18 .. 2026-07-14 |
| `20250801..20260818` (12 meses) | 134 | 2025-08-18 .. 2026-07-14 |
| `20240818..20260818` (24 meses) | 134 | 2025-08-18 .. 2026-07-14 |
| ano a ano, 2023 + 2024 + 2025 + 2026 | **506** | 2023-02 .. 2026-07 |

Não há erro, não há aviso, não há paginação. A resposta é 200 e parece completa.
Uma coleta ingênua registraria **26% do acervo como se fosse tudo**, e a
auditoria em `coleta` diria "ok" — porque ela audita a requisição, não a
verdade da resposta.

**Como apareceu:** 2023 e 2024 vieram vazios para um senador que fala muito.
Implausível o bastante para investigar em vez de aceitar. É o passo 5 do §3.1
— medir cobertura antes de prometer — fazendo exatamente o que existe para
fazer, e é o argumento mais forte a favor do método que este documento registra.

A janela agora é sempre um ano-calendário (`LIMITE_JANELA_MESES` em
`src/ingest/senado.ts`), e o recurso gravado em `coleta` declara qual ano.

#### Classificação vem da fonte, não da nossa regra

`src/lib/classificar.ts` foi calibrado contra sumário e tipo da **Câmara**.
Rodá-lo aqui repetiria o erro que o projeto recusou no recorte mérito ×
procedimental (§6.1): aplicar a senador uma regra medida em deputado.

Não é preciso. O Senado publica `TipoUsoPalavra` — classificação **oficial** do
ato, com 14 valores observados —, e nela `Orientação à bancada` vem nomeada pela
própria origem. É o mesmo critério da Câmara chegando por um caminho melhor:
declarado, não inferido. O banco grava
`classificacao_versao = 'oficial:TipoUsoPalavra'`, então cada linha diz qual
regra a produziu.

Os 61 registros que a origem marca `Não classificado` continuam substantivos:
dizer que não classificou não é dizer que é protocolar, e decidir por ela seria
rotular por conta própria.

#### A fonte é melhor que a da Câmara

| | Câmara | Senado |
|---|---|---|
| Campos ausentes | 53 sem sumário, 403 sem link de Diário utilizável | **zero**, em 718 registros |
| Identificador | não existe — exigiu hash de conteúdo (§8) | `CodigoPronunciamento`, 718 distintos em 718 |
| Classificação do ato | inferida por regex sobre o sumário | publicada pela origem |

Sem transcrição, pela mesma razão do Diário (§6.4): o link leva ao texto
integral que a origem já publica, e guardar cópia custaria 718 requisições para
duplicá-lo.

Entraram **717** e não 718: o pronunciamento de 2023-01-10 é da 56ª legislatura,
e o filtro de período o exclui corretamente.

#### No site

12 páginas por ano novas, seção de discursos nos 3 perfis, e a busca deixou de
ser só da Câmara — o metadado passou a carregar a **seção** de cada pessoa,
porque supor `parlamentares/` mandaria todo senador para um 404.

Duas correções de texto que não são cosméticas: o rótulo do link passou a sair
do **destino** (o Senado publica em página própria, não em Diário — chamá-la de
"Diário da Câmara" seria a mesma mentira pequena que a regra já proibia com
outro nome), e a prosa passou a nomear só as categorias que o parlamentar de
fato tem, porque o Senado não produz registro de presença e dizer que produz
seria descrever outra fonte.

### 6.8 Automatização — o que ela custa e o que ela recusa fazer

`.github/workflows/acervo.yml` roda duas vezes por semana:

```
ingerir:incremental → db:validar → relatorio → site → commit docs/
```

**Custo: zero.** Não há modelo de linguagem envolvido — são os mesmos scripts
determinísticos que rodavam à mão. O repositório é público, e para repositórios
públicos os runners padrão do GitHub não têm limite de minutos; as APIs da
Câmara e do Senado não cobram nem autenticam; o Pages é gratuito. A pergunta
"quantos tokens isso gasta" tem resposta simples: nenhum. Uma tarefa sem decisão
não precisa de um modelo para executá-la.

| Decisão | Por quê |
|---|---|
| **Duas vezes por semana**, não uma | O acervo de 78 MB vive no cache do Actions, que descarta entradas não acessadas há mais de 7 dias. Cron semanal fica na borda: uma execução atrasada por indisponibilidade do runner apagaria o banco. Segunda e quinta deixam 4 dias de folga |
| **Cache**, não release asset | Em repositório público, release asset é download público — e o banco tem `cpf_hmac` de 1.261 políticos. O cache não é baixável de fora |
| **Falhar sem cache**, não reconstruir | São ~91 min e ~9.700 requisições contra APIs públicas. Disparar isso sozinha, sem ninguém olhando, por causa de um despejo de cache, é automação que castiga a fonte |
| **Reconstruir só por `workflow_dispatch`** | Resolve o ovo e galinha da primeira execução — o cache só é escrito ao fim de uma execução bem-sucedida — sem que ninguém tropece nisso |
| **Validar antes de publicar** | `db:validar` e os invariantes rodam entre a coleta e o commit. Acervo incoerente não vira site |
| Checar o **arquivo**, não a saída da action | Cobre cache ausente e cache truncado com a mesma condição, e não depende do nome de um output entre versões |

O gerador é **determinístico**: duas execuções sobre o mesmo banco produzem
saída byte a byte idêntica (verificado, 0 arquivos diferentes).

#### Medido em produção, não estimado

A semeadura rodou em 2026-08-25 e três execuções agendadas se seguiram. O que
elas provaram, que nenhuma leitura de código provaria:

| Pergunta | Resposta medida |
|---|---|
| A reconstrução cabe no teto? | **76,8 min** (75,3 na reconstrução), contra 180 de teto e 91 medidos localmente. O runner foi **mais rápido** que a máquina local |
| O cache é escrito? | Sim — **20 MB**, comprimido a partir dos 78 MB do banco |
| O cache sobrevive entre execuções? | **5 dias** entre a semeadura e o uso bem-sucedido de 31/08 |
| A validação roda antes de publicar? | `db:validar` e `relatorio` verdes antes do passo de commit, nas duas execuções bem-sucedidas |

**A restauração acontece antes de qualquer falha** — propriedade que não estava
prevista e que ajuda: execução que quebra depois de restaurar ainda toca o
cache, e o relógio dos 7 dias reinicia. A cadência de 2×/semana fica mais
folgada do que o projeto supunha.

#### A primeira falha real, e por que ela não é defeito

A execução agendada de 2026-08-27 falhou:

```
✗ ingestão interrompida: HTTP 0 em .../legislaturas/57 (8 tentativas): fetch failed
  a tabela 'coleta' registra o que foi obtido antes da falha
```

A API da Câmara ficou inalcançável do runner. O ingestor tentou 8 vezes com
backoff, desistiu em ~2m40s e **falhou alto**, sem corromper acervo nem publicar
coleta pela metade (§3.5). A execução seguinte, em 31/08, se curou sozinha.

É a resiliência projetada exercitada contra indisponibilidade real, não
simulada. Automação que quebra e se cura é o comportamento certo; automação que
quebra e publica é o que a ordem dos passos existe para impedir.

#### Duas observações que não pedem ação

**O agendamento atrasa muito.** O cron pede 09:10 UTC; as execuções saíram às
09:46, 09:58, **19:48** e **17:01**. É comportamento conhecido do GitHub sob
carga, não defeito nosso — mas come parte da janela de 7 dias do cache, e é
mais um argumento a favor de duas vezes por semana em vez de uma.

**Toda execução bem-sucedida commita ao menos `docs/_data/meta.yml`**, porque o
período apurado avança com a data. O commit de 31/08 mudou exatamente uma linha.
É honesto — o período realmente avançou —, mas significa que o caminho "nada
mudou, nenhum commit" nunca dispara na prática.

**O custo no repositório foi medido e é desprezível:** ~0,3 MB por semana, com o
`.git` inteiro em 4,5 MB contra 24 MB de árvore de trabalho (§11, item 1). A
dúvida que a automação abriu — se valeria gerar no CI em vez de versionar — está
encerrada pela medição, não por preferência.

**Um passo continua humano:** `BUSSOLA_CPF_SEGREDO` precisa existir como segredo
do repositório, porque a etapa `deputados` chama `hmacCpf()` toda semana. É uma
ampliação real de exposição — hoje o segredo só vive no `.env` da máquina — e
foi decidida, não herdada.

#### O que a automatização encontrou antes de automatizar

Os três defeitos do §8 datados de 2026-08-19 apareceram porque rodar o
incremental para testar é diferente de lê-lo. **Nenhum dava erro**, e o segundo
teria publicado um índice com 35 deputados para 31 cadeiras.

É o argumento de fundo a favor da ordem escolhida: validar entre a coleta e o
commit não é zelo, é o que separa "a rotina rodou" de "a rotina está certa".

### 6.9 Guarda contra retrocesso do site

Desde que a atualização virou automática existem **duas cópias do banco**: a da
máquina e a do cache do Actions. Elas avançam sozinhas, e em 2026-09-02 a local
estava 15 dias atrás da do CI.

Gerar da máquina atrasada e commitar faria as 305 páginas **retrocederem, sem
erro nenhum** — o gerador é determinístico sobre o banco que recebe, e o banco é
que estava velho. Nenhuma validação existente pegaria: o acervo antigo é
internamente coerente, os 5 invariantes passam, a decomposição fecha. Está tudo
certo, só que atrasado.

O `meta.yml` publicado é a prova de até quando o site já afirmou ter apurado. A
guarda compara com o banco atual e **para antes do `rmSync`** — falhar depois de
apagar as páginas trocaria um problema por outro.

| Caso | O que acontece |
|---|---|
| Banco à frente | Passa. É o avanço normal |
| Banco igual | Passa. Regenerar o mesmo estado é a propriedade determinística que a Action usa para não commitar ruído |
| Banco atrás | **Aborta**, dizendo quantos dias retrocederia e qual comando resolve |
| `meta.yml` ausente | Passa. Primeira geração, nada a comparar |
| `meta.yml` sem o campo | **Aborta.** Formato mudou, a guarda parou de guardar — e isso não pode acontecer calado |
| `BUSSOLA_PERMITIR_RETROCESSO=1` | Passa com aviso. Guarda que não pode ser desligada vira obstáculo no dia em que a resposta certa for retroceder |

Exercitada contra o caso real, não simulado — o acervo local estava mesmo 15
dias atrás:

```
Error: o acervo está atrás do site publicado — geração abortada.

  site publicado apurado até  2026-09-03
  este banco apura até        2026-08-19

Gerar agora faria as páginas retrocederem 15 dia(s).
```

Verificado nos seis casos, incluindo que `docs/` fica **intacto** quando ela
dispara (305 páginas no lugar) e que o determinismo se mantém depois dela.

---

### 6.10 Órbita — desenhada para não conseguir mentir

Estava no plano original desde a Fase 0, e era a peça de maior risco do
projeto: **o eixo 2 é o único que mente sozinho.**

Marcel van Hattem tem 99% de coesão com o NOVO; Bohn Gass, 98% com o PT. Num
espalhamento 2D com coesão no eixo Y, os dois ficam colados — e proximidade
lê-se como semelhança, sem que ninguém tenha escrito uma frase falsa. Mesmo
número, política oposta. É a única forma de exibição em que o princípio do
projeto pode ser violado **por geometria**, não por texto.

A saída não foi avisar em legenda. Foi tornar a comparação **inexprimível**:

| Decisão | O que ela impede |
|---|---|
| **Uma faixa por partido** | Coesão só significa algo dentro da mesma legenda, porque a referência é a maioria daquele partido. Em grupos separados, ninguém compara coesão entre partidos por acidente |
| **Coesão não ocupa eixo** — vira o raio da órbita | Atributo da marca, não posição num espaço compartilhado. Órbitas iguais em faixas diferentes não sugerem nada |
| **Só o alinhamento é posição** | É a comparação legítima: a referência é a mesma para todos, a orientação declarada do Governo |
| **Uma linha por parlamentar** | Empilhar dentro da faixa não escala — sete deputados do PL entre 28% e 35% viram pilha ilegível |

**SVG estático, sem uma linha de JavaScript.** A busca precisou de script porque
casar texto exige o texto do lado do leitor (§6.5); um panorama de 31 pontos,
não. Funciona sem script, em impressão e em leitor de tela — `aria-label` no
conjunto, `<title>` por corpo —, e cada corpo é um link nativo para o perfil.

Nenhuma cor no SVG, nem de partido nem avaliativa: verificado que não há um
único atributo `fill` ou `stroke` embutido. Tudo vem da folha de estilo, e a
única variação visual é o raio.

**O `n` não ficou no tooltip.** A regra do §6.3 é que ele nunca é tooltip, e num
gráfico não há número impresso para acompanhá-lo. Entrou em prosa, com a
amplitude real — 102 a 432 votações —, e a tabela logo abaixo traz o de cada um.
O `<title>` é acréscimo, não substituto.

Em 360px o documento continua sem rolar lateralmente: só o quadro do gráfico
rola por dentro, com a dica apontando a tabela como alternativa em texto. É a
única exceção que a regra do §6.3 admite, e ela é declarada.

#### Três defeitos que só apareceram ao olhar o resultado

Nenhum apareceria em revisão de código:

- **Empilhar não escalava.** O PL tem sete deputados entre 28% e 35%; a primeira
  versão os sobrepunha com rótulos ilegíveis.
- **O `text-anchor` de cada rótulo perdia para o CSS.** Atributo de apresentação
  perde para folha de estilo, e o nome saía por cima do próprio corpo. A regra
  antiga `text-anchor: middle` sobrevivera de uma versão anterior.
- **Encurtar para sobrenome era invenção nossa**, e criava dois erros: o acervo
  tem "Mauricio Marcon" (PL) e "Marcon" (PT), que viravam o mesmo rótulo, e
  "Covatti Filho" virava "Filho". Nome oficial não se abrevia por conveniência
  de layout.

---

### 6.11 Encontrabilidade — o que dependia só de código

O §11 registra que **o site está pronto e ninguém sabe que ele existe**. Isto
não resolve a lacuna; resolve a parte dela que era código.

**Etiquetas de compartilhamento.** Até 2026-09-06, um link colado no WhatsApp,
no Telegram ou no Slack aparecia como URL crua — nas 305 páginas. Agora cada uma
carrega título, descrição e endereço canônico próprios, derivados do acervo.

**Sem imagem, e é decisão, não omissão.** Cartão com imagem exige PNG ou JPEG;
SVG não é aceito pelas plataformas, e não há rasterizador no projeto nem vale
trazer um por isto. `summary` mostra título, descrição e domínio. Os dois
caminhos com imagem foram descartados pelo mesmo motivo: imagem decorativa seria
enfeite, e imagem com número seria **número sem `n` e sem link para a fonte**,
que o §6.3 proíbe na tela e não passa a valer fora dela.

**O sitemap é varrido, não digitado** — 308 URLs, do que foi realmente escrito.
Lista à mão envelheceria no primeiro parlamentar novo, pelo mesmo motivo que
levou a home a ser gerada (§6.8). `lastmod` é a data do acervo e não o mtime do
arquivo: no CI todo arquivo é recém-escrito, e mtime diria "tudo mudou agora" em
toda execução, o que é falso e treina o buscador a ignorar o campo.

**A base pública sai do acervo.** `eixo.metodologia_url` já guardava a URL
absoluta; a base é ela sem o último trecho. Rodapé, sitemap, robots e etiquetas
passaram a sair do mesmo lugar, então trocar de domínio continua sendo a
mudança única que as dívidas do §11 descrevem — não virou quatro.

`url` e `baseurl` entraram no `_config.yml` porque `absolute_url` precisa dos
dois. O `baseurl` declarado é o que o Pages já usava, **conferido contra o HTML
publicado antes de escrever** — declará-lo errado quebraria todos os links do
site de uma vez.

Verificado em produção: 308 URLs no sitemap contra 305 páginas mais os 3
documentos técnicos; XML válido; 8 URLs sorteadas, todas 200; nem o CHECKPOINT,
nem `_data`, nem os fragmentos de busca entram; e os links internos continuam
saindo com o prefixo certo depois da mudança de config.

---

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
| **Cobertura** (até onde se olhou) | 2023-02-01 → 2026-09-06 |
| **Votações** (primeira → última sessão) | Câmara 2023-02-07 → 2026-09-03 |
| Votações — Câmara | 6.450 (1.125 nominais) |
| Votações — Senado | 357 (117 abertas, 240 secretas) |
| Taxa de nominais (Câmara) | **17,8%** |
| Taxa de sigilo (Senado) | **67,3%** — só as abertas são apuráveis |
| Votos individuais | 484.460, de 746 parlamentares (454.900 computáveis) |
| Natureza das nominais (Câmara) | mérito 571, procedimental 536, formal 10 |
| Proposições / vínculos de tema | 653 / 923 |
| Nominais vinculadas à matéria | 1.116/1.117 (99,9%); com tema 1.110 (99,4%) |
| Discursos | **6.619** (5.714 substantivos) |
| Posições | 871 · destas 127 gerais (34 parlamentares × eixos × escopos) e 744 por tema |
| Evidências | 87.244 |
| Coleta | 11.058 operações (acumulado), 166 falhas |

> Medidos em **2026-09-06**. A Action os move duas vezes por semana; conferir é
> `npm run relatorio`. Ver a ressalva do §1.

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

| Descrição de votação com **quebra de linha** posta em célula de tabela Markdown | A quebra encerra a linha da tabela: a célula seguinte virava linha órfã, sem referência, sem voto e sem fonte. **425 evidências** assim, em 17 votações da origem. Apareceu ao contar marcadores — 349 numa tabela de 356 linhas | `umaLinha()` colapsa espaço em branco antes de emitir. Trocar quebra por espaço é o mínimo para o texto caber na célula, e não altera uma palavra da origem |

| `relatorio` agrupava natureza **sem filtrar por casa** | `natureza` é conceito da Câmara e fica NULL no Senado por escolha. As 355 votações do Senado entravam com `null` e o relatório quebrava em `null.padEnd()`: a ferramenta de conferência do acervo parava por causa de um dado corretamente nulo. Confirmado contra backup — anterior ao trabalho de discursos do Senado | Query escopada em `casa = 'camara'`, título da seção idem, e `null` passou a ter tratamento explícito que diz "investigar, não deveria existir na Câmara" |
| Etapa `senado` avança o acervo, mas não recalcula posições | A coleta de discursos trouxe junto 2 votações novas (acervo até 2026-08-12) com as posições apuradas até 2026-08-11. O site derivava "116 abertas" do banco e "de 114" da posição — dois números certos, uma página inconsistente | Recalcular `posicoes` faz parte de avançar o acervo, não é passo opcional. Uma série só, 871 posições, 4 invariantes limpos |

| `ingerir:incremental` **não coletava o Senado** | `ETAPAS_COLETA` não o incluía e `horizonte.ts` só conhecia recursos da Câmara. A rotina semanal congelava a casa inteira enquanto o log dizia "concluído" — mesma classe da janela de 12 meses (§6.7). Nenhuma execução do incremental jamais tocou no Senado | Etapa nas duas listas, e um recurso-resumo `senado <ini>..<fim>` que declara **até que dia se olhou** — `ano=2026` não é uma data. Duas regressões novas em `db:validar` |
| A origem **reescreveu o próprio passado**, e o ingestor acumulou | O histórico de filiação de Afonso Hamm passou de `PPB → PP** → PP` para só `PP`. A chave `(político, partido, data_inicio)` não casou com nenhuma linha antiga, o `onConflictDoUpdate` virou insert, e 4 deputados ficaram com **duas filiações abertas**. O site resolve legenda por filiação aberta: o índice passou a listar **35 deputados para 31 cadeiras**, sem erro nenhum | `derivarFiliacoes` traduz o histórico inteiro — é afirmação completa sobre a pessoa, não acréscimo. A escrita passou a **substituir**, com `DELETE` escopado por `fonte_url` para não levar junto filiação de senador. Invariante novo pega o estado |
| `db:validar` **mentia no próprio resumo** | `const totalChecagens = 79`, digitado à mão, já errado em 4. Quem lê "79 verificações" acredita que 79 rodaram — e o arquivo existe justamente para impedir desvio silencioso | Contado em vez de digitado. São 83 |

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
| ~~Senado~~ | ✅ **integrado** — 357 votações, 117 abertas, 3 senadores, 717 discursos | Só coesão partidária: não há orientação de bancada em dados abertos, então o eixo 1 não é calculável lá (§8). Sem CPF na origem, senador não cruza com o TSE |
| ~~Discursos do Senado~~ | ✅ **coletados e exibidos** — 717, classificados pela própria fonte (§6.7) | Era a última lacuna "desconhecida". A janela de 12 meses da origem está mapeada e contornada |
| ~~Período coletado~~ | ✅ **resolvido** — legislatura 57 varrida até 2026-08-08 | Restam as sessões até 2027-01-31, via `npm run ingerir:incremental` |
| ~~Votação parcialmente escrita~~ | ✅ **resolvido** — transação em `ingerirVotacoes` (§8) | O invariante "nominal sem voto gravado" detecta o estado, caso volte a ocorrer |
| ~~`posicao` acumula períodos~~ | ✅ **resolvido** — o `DELETE` supersede a série (§8) | O invariante "mesma série em dois períodos" detecta. Recortes com `periodo_inicio` diferente continuam coexistindo, que é o caso legítimo |
| ~~Camada web~~ | ✅ **no ar** — 305 páginas estáticas no GitHub Pages, design próprio (§6.3) | Sem API HTTP e sem servidor, por escolha: o acervo é reconstruível e o site é derivado dele |
| App mobile | **não iniciado** | Fase 3 |
| ~~Metodologia pública dos eixos~~ | ✅ **publicada** em <https://raulmdrs.github.io/bussola-civica/metodologia/> — documento vivo, versões superadas arquivadas | `eixo.metodologia_url` grava a URL absoluta; `urlDaVersao()` resolve qualquer versão. Requisito para exibir posição: cumprido |
| Download de arquivos DivulgaCand | padrão de URL não resolvido (404) | Sem impacto no MVP |

### Ressalva sobre o filtro de discursos

Os 866 classificados como `orientacao_voto` às vezes passam de 1.400 caracteres
— o parlamentar justifica o voto ao orientar, e **esse conteúdo não está na
tabela `orientacao`**, que guarda só a posição.

A lacuna encolheu quando o site passou a exibi-los: eles estão nas páginas por
ano, em seção própria, com o texto no Diário pelo link. O que continua aberto é
se algum deles deveria contar como substantivo — a regra hoje decide pelo tipo
declarado pela fonte, e há justificativa de voto ali dentro que é posição.

---

## 10. Estado do código

```
src/                                    7.805 linhas TypeScript
  db/schema.ts        872   20 tabelas, comentadas com o achado que as motivou
  db/client.ts         72   node:sqlite via sqlite-proxy + consultar() tipado
  db/migrar.ts         59   aplica migrations, controla em _migrations
  db/validar.ts       890   83 verificações contra casos de borda reais
  db/integridade.ts   111   5 invariantes do acervo (usados por validar e relatorio)
  lib/http.ts         148   retry, backoff, janelas de data
  lib/normalizar.ts   151   voto, CPF, sigla, data, hoje() em Brasília
  lib/classificar.ts  111   classificação de discurso
  lib/natureza.ts      69   mérito vs. procedimental
  lib/zip.ts           83   leitor mínimo de ZIP, sem dependência
  lib/identidade.ts    64   HMAC do CPF — por que hash puro não serve
  ingest/camara.ts    271   cliente tipado da API (dataFim exclusivo)
  ingest/senado.ts    560   cliente + ingestão; votação e discurso; janela de 1 ano
  ingest/tse.ts       275   candidaturas 2022 via CSV, cruzadas por HMAC
  ingest/pipeline.ts 1042   7 etapas; votação+votos em transação; filiação substitui
  ingest/index.ts     125   CLI
  ingest/incremental.ts 154 CLI da retomada automática, Câmara e Senado
  ingest/horizonte.ts 132   de onde continuar, por etapa — testável, sem rede
  calc/posicoes.ts    563   dois eixos + evidências, recorte por tema, regime por casa
  site/gerar.ts      1639   gerador do site — 305 páginas, busca, órbita, sitemap e as duas guardas
  relatorio.ts        414   verificação do acervo + invariantes
drizzle/                    8 migrations

.github/workflows/acervo.yml         139  atualização 2×/semana, custo zero (§6.8)

docs/                                    1105 linhas de camada web
  _layouts/default.html 76  cabeçalho, conteúdo, rodapé e etiquetas de compartilhamento
  assets/bussola.css   791  folha única, à mão, clara e escura (§6.3)
  assets/busca.js      238  único script do site, à mão, sem dependência (§6.5)
```

**305 páginas geradas** e 4 fragmentos de busca. `docs/` ocupa **24 MB** — 13,4
MB de decomposição da evidência, 6,1 MB de páginas de discurso e 3,2 MB de
fragmentos de busca. Tudo é reescrito a cada `npm run site`; por página o peso
é baixo (23 KB pelo fio no pior caso), o volume está no número de páginas.

**Stack:** TypeScript (type-stripping nativo, sem build), Drizzle ORM,
SQLite via `node:sqlite`. Node **22.6+** (declarado em `engines`, com
`engine-strict=true`): abaixo disso não existe `--experimental-strip-types` e
todo `npm run` falha com erro de sintaxe.

**Uma dependência de runtime** (`drizzle-orm`), e o site não acrescentou
nenhuma: sem Tailwind, sem Sass, sem CDN, sem biblioteca de busca. A camada web
é CSS e um script, os dois escritos à mão sobre a saída do kramdown.

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

**Os três itens de retorno saíram da lista, e com eles a promessa mais antiga
do projeto.** Discursos em 2026-08-15 (§6.4), busca em 2026-08-16 (§6.5),
decomposição completa da evidência no mesmo dia (§6.6). Todo número exibido no
site é agora rastreável até a votação que o compõe, sem SQL e sem pedir
confiança.

A previsão de que o CSS já provisionava a forma se confirmou três vezes:
`blockquote.evidencia` recebeu o discurso sem folha nova, depois o resultado de
busca, e a tabela recebeu 545 linhas de decomposição virando cartões no celular
com quatro rótulos novos.

**A cobertura fechou também.** Os discursos do Senado eram o último item
"desconhecido" — nem feito, nem descartado, nem investigado. Foram medidos,
coletados e exibidos em 2026-08-19 (§6.7), e com eles o site passou a mostrar
as duas casas por inteiro: como votam, o que dizem, e a conta de cada número.

**A operação fechou junto.** A atualização virou automática em 2026-08-19
(§6.8), e o caminho até lá encontrou três defeitos silenciosos que a rotina
manual vinha carregando — inclusive um que congelava o Senado inteiro. Desde
2026-08-25 ela roda sozinha, já sobreviveu a uma indisponibilidade da origem e
se curou na execução seguinte.

**A forma fechou também.** A órbita entrou em 2026-09-06 (§6.10) — a peça que
estava no plano desde a Fase 0 e a de maior risco, porque era a única em que o
princípio podia ser violado por geometria em vez de por texto.

**Não sobra peça de trabalho.** Cobertura, rastreabilidade, operação e forma
estão fechadas. O que resta são duas fases de escopo novo, o que a fonte não
entrega, dívidas pequenas — e uma lacuna que este documento nunca registrou
porque não é código:

> **O site está pronto e quase ninguém sabe que ele existe.** Para uma
> plataforma cívica, essa é hoje a maior distância entre o que foi construído e
> o que ele se propõe a fazer. Nenhuma das fases seguintes a diminui: um app
> mobile e a expansão para o estadual multiplicam o que já não é encontrado.

Em 2026-09-06 saiu dela **a parte que era código** (§6.11): sitemap, robots e
etiquetas de compartilhamento. Um link colado numa conversa deixou de aparecer
como URL crua, e o buscador passou a ter como percorrer as 308 páginas.

O que sobra não é código, e por isso não tem item nesta lista: **decidir para
quem este site é, e onde essas pessoas estão.** Sitemap diz ao buscador que o
site existe; não faz ninguém procurar por ele. Fica registrado porque omitir
isso faria o estado do projeto parecer melhor do que é.

### Rotina — não é mais sua

**0. Nada.** Segunda e quinta, `.github/workflows/acervo.yml` coleta, valida,
gera e commita sozinho (§6.8). Custo zero, sem modelo de linguagem envolvido.

À mão continua funcionando, e é o que se roda para conferir antes de mexer em
regra de cálculo. **Nesta ordem**: a máquina local pode estar semanas atrás do
acervo do CI. Desde 2026-09-06 pular o primeiro comando não estraga mais nada —
a guarda do §6.9 aborta a geração —, mas continua sendo trabalho perdido.

```bash
npm run ingerir:incremental && npm run relatorio && npm run site
```

O que **não** é opcional, nem à mão nem na Action: rodar `db:validar` e ler os
invariantes antes de publicar. Os três defeitos de 2026-08-19 (§8) eram todos
silenciosos, e um deles publicaria 35 deputados para 31 cadeiras.

### O que estava para acompanhar — os dois fecharam

As duas perguntas que a automatização deixou em aberto foram respondidas em
2026-09-06. Ficam aqui como registro, não como pendência: uma foi medida, a
outra virou guarda.

**1. ~~O peso do repositório.~~** ✅ **medido em 2026-09-06 — não é problema.**

A pergunta estava registrada como observável, não estimável. Três commits
automáticos depois, a observação:

| Commit da Action | Arquivos | Blobs novos |
|---|---:|---:|
| 2026-08-25 | 157 | 668 KB |
| 2026-08-31 | 1 | ~0 KB |
| 2026-09-03 | 99 | 170 KB |

**O `.git` inteiro pesa 4,5 MB**, contra 24 MB de `docs/` na árvore de trabalho.
O git delta-comprime exatamente como se supunha: votação nova entra no topo de
cada tabela e o resto não muda. Ao ritmo atual, ~0,3 MB por semana.

O commit de 31/08 mudou **uma linha** — só o `meta.yml`, porque o período
apurado avança com a data. É a contrapartida prática do determinismo do gerador:
execução sem dado novo não move as páginas.

Com isso, **a saída de "gerar no CI em vez de versionar" fica descartada**. Ela
custaria o diff legível de cada rebuild, que é parte do registro auditável, para
economizar frações de megabyte. A troca não se justifica — e agora isso é uma
conclusão medida, não uma intuição.

> Nota de método: o `.git` chegou a marcar 19 MB numa medição intermediária.
> Eram objetos soltos; um `git gc` compactou para 4,3 MiB de pack. Medir
> repositório sem compactar antes superestima em 4×.

**2. ~~Dois acervos, e eles divergem.~~** ✅ **resolvido por guarda** em
2026-09-06 (§6.9). O risco continua existindo — a máquina e o cache do CI
avançam sozinhos —, mas deixou de ser silencioso: o gerador se recusa a
publicar acervo mais velho que o já publicado.

### Bloqueado pela fonte, não por nós

Registrado para quando houver fonte — nenhum destes é "fazer depois":

| Item | Por que está parado |
|---|---|
| Eixo 1 no Senado | Não há orientação de bancada em dados abertos. Nove endpoints testados, todos 404; busca por nome de campo em 2,5 MB não achou nada (§8) |
| Senador × TSE | Não há CPF na API do Senado. Nome de urna não é chave, e partido menos ainda |
| Discurso de senador | A etapa `discursos` é da Câmara. O Senado tem endpoint próprio, ainda não reconhecido — a página de senador hoje não tem seção de discurso, e não é escolha de design |
| Recorte por escopo no Senado | A regra mérito × procedimental foi calibrada contra texto da Câmara. Validá-la para o Senado exige casos de borda que ainda não temos |
| Plano de governo | Não existe para deputado federal — interseção medida: zero (§5) |
| Notícias por político | Sem fonte oficial (§5) |

### Fases seguintes — escopo novo, não continuação

**App mobile** (Fase 3) e **estadual/municipal** (Fase 4). Nenhuma das duas é
continuação do que existe: a primeira é outra plataforma de entrega, a segunda é
outro reconhecimento de fonte inteiro — 497 municípios no RS, e nada garante que
câmara municipal publique voto nominal em dado aberto.

Antes de qualquer uma, vale considerar se a resposta não é **distribuição**. Um
app não resolve não ser encontrado; e a Fase 4 multiplicaria por 497 um acervo
que hoje não tem leitor.

### Dívidas pequenas

- **Aviso de Node 20 nas actions de terceiros.** `actions/checkout@v4`,
  `actions/setup-node@v4` e `actions/cache@v4` declaram Node 20, que o GitHub
  depreciou e força a rodar em Node 24. Não quebra nada hoje e não tem relação
  com o Node 22 que roda o nosso código; a correção é subir as três de major
  quando as versões novas saírem.
- **O segredo `BUSSOLA_CPF_SEGREDO` agora vive também no GitHub.** A etapa
  `deputados` chama `hmacCpf()` toda semana, então a Action precisa dele. É uma
  ampliação real de exposição — antes só existia no `.env` de uma máquina — e
  foi decidida, não herdada. O banco não vai para o repositório, então os
  `cpf_hmac` continuam fora do alcance público; o segredo protege contra força
  bruta caso isso mude.
- **Não existe Jekyll local.** O Ruby do sistema é 2.6 e a cadeia não instala
  sem trabalho. Hoje a verificação da camada web é feita em duas partes:
  `kramdown` isolado (Ruby puro, mesmo conversor do GitHub Pages) para conferir
  que o IAL e o HTML inline sobrevivem, e varredura de links contra o site
  **já publicado**. Funciona, mas descobre erro depois do deploy — foi assim que
  apareceram os cinco links `../src/*.ts` quebrados. A busca agravou: ela
  depende de `fetch` relativo (`../busca/<ano>.json`), que só é testável servindo
  a estrutura real de diretórios — foi preciso montá-la à mão no scratchpad para
  verificar.
- **`dobrar()` existe em dois lugares** — `src/site/gerar.ts` e
  `docs/assets/busca.js` — e precisa continuar idêntica nos dois. Não há como
  compartilhá-la: um é TypeScript sob type-stripping, o outro é script servido
  ao navegador. Se divergirem, a busca deixa de achar o que existe e ninguém
  recebe erro. Está comentado nos dois arquivos; é a dívida mais silenciosa
  desta lista.
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
- **Cartão de compartilhamento sem imagem** (§6.11). Resolver exigiria gerar
  PNG, e gerar PNG com texto exige rasterizar fonte — dependência que o projeto
  não tem e que não se justifica por um enfeite. Fica registrado como escolha,
  não como esquecimento.
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
