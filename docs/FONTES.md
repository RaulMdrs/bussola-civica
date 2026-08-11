---
layout: default
kind: prosa
title: "Fontes oficiais"
description: "Reconhecimento das APIs oficiais: o que cada endpoint entrega e onde falha."
---

# FONTES.md — Reconhecimento das APIs

Documento de reconhecimento das fontes oficiais, anterior à definição do modelo
de dados. Todos os requests abaixo foram executados e verificados em
**2026-08-03**. Números apresentados são medidos, não estimados.

---

## Sumário: cinco achados que afetam o escopo

| # | Achado | Impacto |
|---|--------|---------|
| 1 | **Não existe endpoint de votações por deputado** na Câmara (`/deputados/{id}/votacoes` → HTTP 405). O acesso é sempre pelo lado da votação. | Inverte a direção da ingestão. Ver §1.3. |
| 2 | **Só 34% das votações de plenário são nominais.** As demais são simbólicas e retornam lista de votos **vazia**. | O universo real para posicionamento é ~1/3 do que a lista de votações sugere. Ver §1.4. |
| 3 | **Nenhum deputado federal tem plano de governo.** Interseção medida entre os 546 candidatos do RS e os PDFs de proposta: **zero**. Proposta de governo é exigida apenas de candidatos a **chefe do Executivo**. | Item do MVP Fase 0 é inviável como especificado. Ver §3.3. |
| 4 | **67% das votações do Senado são secretas** e nelas o voto individual não é revelado (vem como `"Votou"`). Além disso, o endpoint de votações por senador está **depreciado, com desativação marcada para 2026-02-01** — data já passada. | Afeta a Fase 1. Ver §2. |
| 5 | **Não há fonte oficial de notícias por político.** Os RSS da Câmara são por tema, não por parlamentar. | Item do MVP Fase 0 sem fonte oficial. Alternativa em §4. |
| 6 | **11 de 12 partidos nunca orientam pela própria sigla** — orientam por bloco, com sigla truncada e sem id resolvível. `/blocos/{id}/partidos` vem vazio. | Fidelidade partidária não é derivável da orientação. Via empírica em §1.6.1. |

Os achados 3 e 5 atingem dois dos quatro itens do perfil de político previsto na
Fase 0. Recomendações e decisões em §6.

---

## 1. Câmara dos Deputados

Base: `https://dadosabertos.camara.leg.br/api/v2`
Sem autenticação. Sem chave. Sem headers de rate limit declarados.

**Spec OpenAPI 3.0.1 completa (78 endpoints):** `GET /api/v2/api-docs`
(`/openapi.json` e `/swagger.json` retornam 405 — o path correto é `api-docs`.)

### 1.1 Dados cadastrais

```
GET /deputados?siglaUf=RS&ordem=ASC&ordenarPor=nome
```
Retorna **31 deputados** — exatamente a bancada do RS.

```json
{
  "id": 136811,
  "uri": "https://dadosabertos.camara.leg.br/api/v2/deputados/136811",
  "nome": "Afonso Hamm",
  "siglaPartido": "PP",
  "uriPartido": "https://dadosabertos.camara.leg.br/api/v2/partidos/37903",
  "siglaUf": "RS",
  "idLegislatura": 57,
  "urlFoto": "https://www.camara.leg.br/internet/deputado/bandep/136811.jpg",
  "email": "dep.afonsohamm@camara.leg.br"
}
```

`urlFoto` resolve direto — serve para a visualização orbital sem hospedar imagem.

```
GET /deputados/136811
```
Acrescenta `nomeCivil`, `cpf`, `dataNascimento`, `escolaridade`, `redeSocial[]`,
`municipioNascimento` e `ultimoStatus` (com `situacao`, `condicaoEleitoral`,
`gabinete`).

> **Nota de privacidade:** a API expõe o **CPF** do parlamentar. É dado público
> na fonte oficial e é a única chave confiável de cruzamento com o TSE (§3.4),
> mas recomendo **não expor o CPF na API pública nem no front** — usar apenas
> como chave interna de reconciliação.

### 1.2 Filiação partidária ao longo do tempo

```
GET /deputados/{id}/historico
```
```
2019-02-01T00:00 | NOVO | null          | null    | Nome/Partido no início da legislatura
2019-02-01T11:45 | NOVO | Exercício     | Titular | Entrada - Posse de Eleito Titular
2023-01-31T23:59 | NOVO | Fim de Mandato| Titular | Saída - Término da Legislatura
2023-02-01T12:05 | NOVO | Exercício     | Titular | Entrada - Posse de Eleito Titular
```

Este endpoint entrega **três coisas de uma vez**: troca de partido, troca de
nome e — crucialmente — os **intervalos exatos de exercício do mandato**.

Medição do cruzamento com o TSE (§3.4): **7 dos 31 deputados do RS estão hoje em
partido diferente daquele pelo qual se elegeram** (um deles, "PC do B"→"PCdoB",
é só diferença de grafia; **6 são trocas reais**).

**Consequência para o modelo:** partido **não pode ser campo do político**.
Precisa ser entidade temporal (`filiacao: politico, partido, inicio, fim`), e o
voto deve ser atribuído ao partido **vigente na data da votação**. Sem isso, a
visualização orbital agrupa errado todo deputado que trocou de legenda.

### 1.3 Votações — a inversão obrigatória

```
GET /deputados/136811/votacoes   →   HTTP 405 Method Not Allowed
```

**Não existe.** Confirmado contra a spec: os únicos sub-recursos de
`/deputados/{id}` são `despesas, discursos, eventos, frentes, historico,
mandatosExternos, ocupacoes, orgaos, profissoes`.

O caminho obrigatório é o inverso:

```
GET /votacoes?idOrgao=180&dataInicio=2025-04-01&dataFim=2025-06-30&itens=100
GET /votacoes/{id}/votos
```

`idOrgao=180` é o Plenário (obtido via `GET /orgaos?sigla=PLEN`). O parâmetro é
`idOrgao` — **`siglaOrgao` não existe** e devolve 400.

**Limites medidos:**
- Janela máxima de datas: **3 meses**. Além disso: `400 — "A diferença entre as
  datas não pode ser maior que 3 meses"`. Um ano exige 4 requisições.
- `itens` máximo em `/votacoes`: **100** (valores maiores são ignorados
  silenciosamente). Mas em `/deputados` aceita 1000 — **o limite varia por
  endpoint**; não assuma um valor global.
- `/votacoes/{id}/votos` **não aceita `itens` nem `pagina`** (400 se enviados) e
  **não pagina**: devolve todos os votos de uma vez (336 registros no exemplo
  testado).

Formato do id de votação: `"2381043-91"` (`idProposicao-sequencial`), string
alfanumérica — **não é inteiro**. Modelar como texto.

### 1.4 Nominal vs. simbólica — o filtro que define o universo

Medição sobre **todas as 450 votações de Plenário do 1º semestre de 2025**:

| | Quantidade | % |
|---|---|---|
| Nominais (`/votos` retorna dados) | **154** | 34,2% |
| Simbólicas (`/votos` retorna `[]`) | **296** | 65,8% |

Não há campo que sinalize isso na listagem. **A única forma de distinguir é
chamar `/votos` e verificar se o array está vazio.** Custo: 450 requisições para
descobrir 154 úteis.

Heurística auxiliar: votações nominais trazem o placar no texto de `descricao`
(`"Mantido o texto. Sim: 226; Não: 109; Total: 335."`). Serve para priorizar,
mas é texto livre — não confie nela como fonte, apenas como filtro barato.

### 1.5 Tipos de voto

Distribuição real (58.724 votos individuais, 1º sem/2025):

| `tipoVoto` | Ocorrências |
|---|---|
| Sim | 31.375 |
| Não | 26.940 |
| Artigo 17 | 151 |
| Abstenção | 149 |
| Obstrução | 109 |

Dois exigem tratamento explícito na metodologia:

- **`Obstrução`** é ato político deliberado, **não ausência**. Tratar como
  ausência distorce o posicionamento de bancadas minoritárias, que usam
  obstrução como instrumento regimental.
- **`Artigo 17`** é o voto do Presidente da Mesa, que só vota em desempate.
  Não é posicionamento comparável e deve sair do cálculo.

Estrutura do voto (note o underscore em `deputado_` — nome real do campo):

```json
{
  "tipoVoto": "Não",
  "dataRegistroVoto": "2025-06-26T12:00:11",
  "deputado_": {
    "id": 204355, "nome": "Da Vitoria", "siglaPartido": "PP", "siglaUf": "ES",
    "urlFoto": "https://www.camara.leg.br/internet/deputado/bandep/204355.jpg"
  }
}
```

O voto **carrega o partido do deputado na data** — não precisa de join para
saber a filiação no momento da votação.

### 1.6 Orientação de bancada

```
GET /votacoes/{id}/orientacoes
```
```
Governo → Sim        Oposição → Não       Minoria → Não
Maioria → Sim        NOVO → Não           Fdr PSOL-REDE → Sim
Bl AvanSolidPrd... → Sim
```

Objeto completo:

```json
{ "orientacaoVoto": "Não", "codTipoLideranca": "P",
  "siglaPartidoBloco": "NOVO", "codPartidoBloco": 37901,
  "uriPartidoBloco": "https://dadosabertos.camara.leg.br/api/v2/partidos/37901" }

{ "orientacaoVoto": "Sim", "codTipoLideranca": "B",
  "siglaPartidoBloco": "Bl AvanSolidPrd...", "codPartidoBloco": null,
  "uriPartidoBloco": null }
```

**`codPartidoBloco` e `uriPartidoBloco` só vêm preenchidos quando
`codTipoLideranca == "P"`** (partido orientando sozinho). Para blocos e agregados
são sempre `null`, e a sigla vem **truncada com reticências**.

Medição sobre as 42 votações nominais do 2º trimestre/2025:

| Orientação | Presente em |
|---|---|
| `Governo` | 42/42 (100%) |
| `Oposição` | 42/42 (100%) |
| `Maioria` / `Minoria` | 42/42 (100%) |
| `NOVO` (única por sigla própria) | 42/42 (100%) |
| Blocos truncados (`Bl PlFdrPtUniPp...`, `Bl AvanSolidPrd...`, `Fdr PSOL-REDE`) | 42/42 |

Cobertura de orientação **pela própria sigla**, para os 12 partidos com deputado
do RS: **NOVO 100%; os outros 11 partidos, 0%**.

> **Consequência:** o eixo Governo↔Oposição é totalmente calculável. Já
> **fidelidade partidária via orientação não é** — 11 de 12 partidos nunca
> orientam pela própria sigla, e o mapeamento bloco→partido não está disponível
> (`/blocos/{id}/partidos` retorna array vazio; a sigla em `orientacoes` vem
> truncada e sem id). Reconstruir esse mapeamento na mão seria inferência
> própria não rastreável — exatamente o que o princípio do projeto proíbe.
> Alternativa medida e viável em §1.6.1.

Tratar também `orientacaoVoto: ""` (string vazia): ocorre quando a liderança
liberou a bancada. Não é ausência de dado — é liberação, e é informação.

> **Ressalva metodológica:** o eixo Governo↔Oposição mede **alinhamento ao
> executivo do momento**, não ideologia. Um partido pode ser "Governo" numa
> legislatura e "Oposição" na seguinte sem mudar de posição programática. É o
> eixo mais fácil de calcular e o mais fácil de rotular errado. O rótulo exibido
> precisa ser literalmente "alinhamento com o governo federal", nunca
> "esquerda/direita".

### 1.6.1 Fidelidade partidária empírica — a via que funciona

Como a orientação por sigla é indisponível, a coesão pode ser calculada
**diretamente dos votos**, sem depender de orientação alguma: para cada votação,
apura-se a posição majoritária dos deputados de cada partido (o registro de voto
já carrega `siglaPartido`, §1.5) e compara-se com o voto individual.

Resultado medido (42 votações nominais, 2º tri/2025, bancada do RS):

| Faixa | Deputados |
|---|---|
| 100% | 13 |
| 90–99% | 4 |
| 70–89% | 3 |
| 50–69% | 5 |
| 32–49% | 4 |

Cobertura: **29/31** (os 2 ausentes são os suplentes sem mandato no período,
§1.8). Amplitude: **32,4% a 100%** — discrimina bem e produz visualização
informativa. Partidos coesos (PT, PL, PSOL) concentram-se em 100%; a dispersão
está no centro (PP, PSD, MDB, PSDB).

Vantagens: 100% derivado de dado oficial, sem tabela manual, sem inferência
editorial, e funciona igual para qualquer UF na expansão nacional.

> **Refinamento obrigatório antes de publicar:** excluir o voto do próprio
> deputado ao apurar a maioria do seu partido. Sem isso há circularidade — em
> bancadas pequenas o parlamentar ajuda a definir a maioria contra a qual está
> sendo medido, inflando artificialmente a própria fidelidade.

### 1.7 Temas — insumo para múltiplos eixos (Fase 2)

```
GET /referencias/proposicoes/codTema   → 32 temas
GET /proposicoes/{id}/temas
```
```json
[{"codTema": 44, "tema": "Direitos Humanos e Minorias", "relevancia": 0},
 {"codTema": 72, "tema": "Homenagens e Datas Comemorativas", "relevancia": 0}]
```

Temas incluem Direitos Humanos e Minorias, Meio Ambiente, Direito Penal,
Economia, Trabalho, Saúde, Defesa e Segurança. É a base natural para os eixos
temáticos da Fase 2, sem necessidade de classificação manual.

Atenção: `relevancia: 0` em ambos, e uma proposição pode ter tema meramente
protocolar ("Homenagens e Datas Comemorativas") ao lado de tema substantivo.
Filtrar por tema exige cuidado.

### 1.8 Cobertura real da bancada do RS

Votos registrados por deputado, sobre as 154 votações nominais do 1º sem/2025:

| Faixa | Deputados |
|---|---|
| 90–98% | 7 |
| 80–89% | 12 |
| 60–79% | 8 |
| 50–59% | 2 |
| **0%** | **2** |

Média de participação: **77,4%**.

**Os dois com 0% não são faltosos** — investigação via `/deputados/{id}`:

- **Carlos Gomes** (REPUBLICANOS): entrou em exercício em **2026-02-05**
- **Sérgio Turra** (PP): suplente, em exercício desde **2026-04-07**

Nenhum dos dois tinha mandato no período medido. **O denominador do cálculo tem
que ser o número de votações ocorridas dentro do período de exercício de cada
parlamentar**, obtido de `/deputados/{id}/historico` (§1.2). Com denominador
fixo, todo suplente aparece como ausente contumaz — erro grave num produto cujo
princípio é credibilidade.

Volume para escalonamento: ~154 nominais/semestre → **~300/ano → ~1.200 na
legislatura**. Suficiente para métodos de escalonamento por rollcall
(W-NOMINATE, IDEAL) com folga.

### 1.9 Estabilidade — risco operacional real

A API apresentou **HTTP 504 intermitente** durante todo o reconhecimento. Uma
requisição a `/votacoes` precisou de **6 tentativas** para completar; outras
passaram de primeira. Não há correlação com o tamanho da resposta.

**Retry com backoff exponencial não é refinamento — é requisito.** Um ingestor
sem retry falha de forma aleatória. Todas as medições deste documento usaram um
helper com até 8 tentativas.

---

## 2. Senado Federal

Base: `https://legis.senado.leg.br/dadosabertos`

### 2.1 Lista de senadores — funciona

```
GET /senador/lista/atual.json
```
Bancada do RS:

| Código | Nome | Partido |
|---|---|---|
| 6341 | Hamilton Mourão | REPUBLICANOS |
| 1186 | Luis Carlos Heinze | PP |
| 825 | Paulo Paim | PT |

Estrutura é JSON convertido de XML, profundamente aninhado
(`ListaParlamentarEmExercicio.Parlamentares.Parlamentar[].IdentificacaoParlamentar.*`)
— bem mais verboso que o da Câmara.

### 2.2 Endpoint de votações por senador — DEPRECIADO

```
GET /senador/{codigo}/votacoes.json
```

Ainda responde HTTP 200, mas os próprios metadados declaram:

```json
"Descontinuacao": {
  "DataDepreciacao": "2025-03-18",
  "DataDesativacaoCompleta": "2026-02-01",
  "UrlServicoSubstituto": "https://legis.senado.leg.br/dadosabertos/votacao"
}
```

**A data de desativação completa já passou** (hoje: 2026-08-03). O serviço está
respondendo além do próprio prazo de morte. **Não construir nada sobre ele.**

Vale notar o contraste com a Câmara: o Senado *tem* votações por parlamentar
(§1.3 mostra que a Câmara não tem) — mas justamente esse é o endpoint que está
sendo desligado.

### 2.3 Serviço substituto

```
GET /votacao
GET /votacao?ano=2025                          → 93 votações
GET /votacao?dataInicio=2025-04-01&dataFim=2025-04-30   → 5 votações
GET /votacao?codigoMateria=156169              → 1 votação
```

JSON limpo e plano, sem o wrapper XML do serviço antigo. **Os votos vêm
embutidos** em cada votação — não requer segunda chamada.

Formato de data é `YYYY-MM-DD` (usar `YYYYMMDD` devolve
`400 Invalid request content`). `pagina` e `itens` são **ignorados** — sempre
retorna o conjunto completo do filtro.

```json
{
  "codigoSessaoVotacao": 6966,
  "dataSessao": "2025-08-13",
  "identificacao": "MSF 81/2024",
  "descricaoVotacao": "Votação nominal da Mensagem nº 81, de 2024 - Patrícia Barcelos (Ancine).",
  "votacaoSecreta": "S",
  "totalVotosSim": 53, "totalVotosNao": 5, "totalVotosAbstencao": 2,
  "votos": [
    { "codigoParlamentar": 5672, "nomeParlamentar": "Alan Rick",
      "siglaPartidoParlamentar": "UNIÃO", "siglaUFParlamentar": "AC",
      "siglaVotoParlamentar": "Votou" }
  ]
}
```

### 2.4 Voto secreto — limitação estrutural

Das 134 votações mais recentes: **90 secretas (67%), 44 abertas (33%)**.

Correlação medida entre `votacaoSecreta` e o voto individual:

| `votacaoSecreta` | `siglaVotoParlamentar` | Votações |
|---|---|---|
| N (aberta) | `Sim` / `Não` / `AP` | 44 |
| S (secreta) | `Votou` / `P-NRV` | 90 |

**Em votação secreta o voto individual não é recuperável** — a API informa
apenas que o senador votou. Só as ~33% abertas servem para posicionamento.

Os códigos de voto do Senado **diferem completamente dos da Câmara**:
`Sim`, `Não`, `Abstenção`, `Votou`, `P-NRV` (presente, não registrou voto),
`AP`, `LS` (licença saúde), `MIS` (missão), `NCom` (não compareceu), `LP`, `NA`,
`LAP`, `Presidente (art. 51 RISF)`.

**Consequência para a Fase 1:** Câmara e Senado exigem normalizadores separados
e o Senado terá base amostral muito menor. Não é "o mesmo modelo com outra
fonte".

---

## 3. TSE

### 3.1 DivulgaCandContas (API REST)

Base: `https://divulgacandcontas.tse.jus.br/divulga/rest/v1`

Requer `User-Agent` de navegador. Path correto (descoberto por tentativa —
não há spec pública):

```
GET /candidatura/listar/{ano}/{UF}/{idEleicao}/{codCargo}/candidatos
GET /candidatura/buscar/{ano}/{UF}/{idEleicao}/candidato/{idCandidato}
```

Para RS 2022, `idEleicao=2040602022`. Códigos de cargo: **3**=Governador,
**5**=Senador, **6**=Deputado Federal.

```
GET /candidatura/listar/2022/RS/2040602022/6/candidatos
```
→ **546 candidatos** a deputado federal.

**Armadilha:** a listagem traz `cpf: null` e `arquivos: null` para **todos** os
546. Esses campos só vêm preenchidos no endpoint de **detalhe**, um candidato
por vez. Cruzar por CPF via API custaria 546 requisições por UF. A solução está
em §3.4.

### 3.2 Portal de dados abertos (CKAN)

`https://dadosabertos.tse.jus.br/api/3/action/package_search?q=candidatos`
`https://dadosabertos.tse.jus.br/api/3/action/package_show?id=candidatos-2022`

CKAN padrão, funciona bem. O dataset `candidatos-2022` tem **144 recursos**.
Existe `candidatos-2026` (eleição em curso).

### 3.3 Plano de governo — não existe para deputados

Recurso do CKAN:
`https://cdn.tse.jus.br/estatistica/sead/odsele/proposta_governo/proposta_governo_2022_RS.zip`
(9,1 MB — PDFs nomeados `2022RS{idCandidato}.pdf`)

**O ZIP contém 13 arquivos: 12 propostas + 1 leiame.** Contra 546 candidatos a
deputado federal.

Cruzamento dos ids dos PDFs contra as listas de candidatos por cargo:

| Cargo | Candidatos | Com proposta de governo |
|---|---|---|
| Governador | 12 | **12** |
| Senador | 11 | **0** |
| **Deputado Federal** | **546** | **0** |

**Interseção com deputados federais: zero.** As 12 propostas são exatamente os
12 candidatos a Governador. Nem senadores têm.

Isto é consistente com a legislação: proposta de governo é exigida no registro
de candidatura apenas para **chefe do Executivo**. Não é lacuna de dados nem
falha da API — **o documento não existe para o cargo escolhido no MVP**.

> **Impacto direto:** "plano de governo (link)" está no escopo da Fase 0, que
> cobre apenas deputados federais do RS. Esse item **não pode ser entregue** como
> especificado. Alternativas em §6.

(O padrão de download de arquivos individuais do DivulgaCand — certidões, IRPF —
não foi resolvido: as URLs montadas a partir do campo `arquivos` retornaram 404.
Não bloqueia o MVP, já que os arquivos disponíveis para deputados são certidões
criminais e declaração de bens, não posicionamento político.)

### 3.4 Cruzamento Câmara ↔ TSE — resolvido via CSV

Em vez das 546 requisições da §3.1, os CSVs de dados abertos trazem CPF para
todos de uma vez, **já separados por UF**:

```
https://cdn.tse.jus.br/estatistica/sead/odsele/consulta_cand/consulta_cand_2022.zip
  → consulta_cand_2022_RS.csv   (783 KB, 1.437 candidatos, todos os cargos)
```

Encoding **latin-1**, separador `;`, campos entre aspas. Colunas relevantes:
`SQ_CANDIDATO`, `NR_CPF_CANDIDATO`, `NM_URNA_CANDIDATO`, `DS_CARGO`,
`SG_PARTIDO`, `DS_SIT_TOT_TURNO`.

Distribuição de `DS_SIT_TOT_TURNO` para DEPUTADO FEDERAL no RS:

| Situação | Qtd |
|---|---|
| SUPLENTE | 315 |
| NÃO ELEITO | 178 |
| ELEITO POR QP | 22 |
| #NULO | 22 |
| ELEITO POR MÉDIA | 9 |

`ELEITO POR QP` + `ELEITO POR MÉDIA` = **31** — confere exatamente com a bancada
retornada pela Câmara. Filtrar por `~/ELEITO/` é erro: captura "NÃO ELEITO".

**Resultado do cruzamento por CPF: 31/31 (100%).**

O CPF é a **única chave confiável**. Nome não serve: a Câmara usa nome
parlamentar ("Marcel van Hattem", "Zucco") e o TSE usa nome de urna em caixa
alta ("MARCEL VAN HATTEM"), com divergências de acentuação e apelido. Partido
também não serve — 6 dos 31 trocaram de legenda desde a eleição.

Cuidado obrigatório: **CPF vem sem zeros à esquerda** em ambas as fontes.
Normalizar com `padStart(11, "0")` antes de comparar.

---

## 4. Notícias

**Não há fonte oficial de notícias por parlamentar.**

- `https://www12.senado.leg.br/noticias/rss` → RSS válido, mas institucional.
- `https://www.camara.leg.br/noticias/rss` → devolve HTML; os feeds reais são
  **por tema**: `/noticias/rss/dinamico/ECONOMIA`,
  `/noticias/rss/dinamico/DIREITOS-HUMANOS`, etc.

Nenhum permite filtrar por político. Um "feed de notícias do deputado X" exigiria
busca por nome em portais de terceiros — o que traz risco de viés editorial na
seleção, exatamente o que o princípio de credibilidade do projeto quer evitar.

### Alternativa oficial e rastreável: discursos

```
GET /deputados/{id}/discursos?dataInicio=2025-01-01&dataFim=2025-03-31
```
```json
{
  "dataHoraInicio": "2025-03-27T17:28",
  "tipoDiscurso": "COMISSÃO GERAL",
  "sumario": "O Deputado discursou na Comissão Geral destinada a debater...",
  "transcricao": "O SR. MARCEL VAN HATTEM (NOVO - RS. Sem revisão do orador.) - ...",
  "urlTexto": "https://imagem.camara.gov.br/dc_20b.asp?..."
}
```

Traz **transcrição integral** e **link para o Diário da Câmara** (`urlTexto`).
É palavra do próprio parlamentar, em fonte oficial, com link verificável — muito
mais aderente ao princípio "dado rastreável" do que agregar manchetes de
terceiros.

---

## 5. Implicações para o modelo de dados

1. **`partido` não é atributo de político.** É relação temporal
   (`filiacao: politico_id, partido_id, data_inicio, data_fim`). 6 dos 31
   deputados do RS trocaram de legenda desde 2022. Votos devem ser lidos com o
   partido vigente na data — que já vem no próprio registro de voto (§1.5).

2. **`mandato` precisa de intervalo explícito.** Sem ele não há denominador
   correto para participação, e suplentes aparecem como faltosos (§1.8).
   Fonte: `/deputados/{id}/historico`.

3. **`votacao` precisa da flag `nominal`** (derivada: `votos.length > 0`),
   calculada na ingestão. Sem ela, 66% do acervo entra como ruído no cálculo
   (§1.4).

4. **`id` de votação é string** (`"2381043-91"`), não inteiro.

5. **`tipo_voto` é enum divergente entre casas.** A normalização precisa
   preservar `Obstrução` como categoria própria (é posição política, não falta) e
   descartar `Artigo 17` do cálculo (§1.5).

6. **`cpf` como chave interna de reconciliação**, normalizado a 11 dígitos, nunca
   exposto publicamente (§1.1, §3.4).

7. **Camada de proveniência é obrigatória, não opcional.** Cada número exibido
   precisa carregar a URL oficial que o origina. Isso é decisão de schema —
   retrofitar depois é caro.

---

## 6. Decisões de escopo da Fase 0

Decidido em 2026-08-03, após o reconhecimento:

**1. Plano de governo → substituído por discursos.** O documento não existe para
deputados federais (§3.3). `/deputados/{id}/discursos` (§4) entrega transcrição
integral e link para o Diário da Câmara, é palavra do próprio parlamentar em
fonte oficial, e cobre 100% da bancada. Preserva a promessa de "ideias do
político" sem inventar dado.

**2. Notícias:** sem fonte oficial por político. Início apenas com discursos. Se
notícias de terceiros entrarem depois, precisam estar visualmente separadas do
dado oficial e identificadas como fonte terceira.

**3. Dois eixos já na Fase 0** — com uma correção de rota obrigatória:

| Eixo | Fonte | Status |
|---|---|---|
| **Alinhamento com o governo federal** | `/votacoes/{id}/orientacoes`, chave `Governo` | ✅ presente em 100% das nominais |
| **Coesão com o próprio partido** | calculada dos votos (§1.6.1) | ✅ 29/31, amplitude 32–100% |

O segundo eixo **não pode** ser derivado da orientação partidária como se
imaginava inicialmente: 11 dos 12 partidos do RS nunca orientam pela própria
sigla, e o mapeamento bloco→partido não é entregue pela API (§1.6). A via que
funciona é a **empírica** (§1.6.1) — apurar a posição majoritária de cada partido
a partir dos votos reais. Mesma pergunta, fonte diferente, e sem tabela manual.

Requisitos que acompanham essa decisão:
- Excluir o voto do próprio deputado ao apurar a maioria do partido (§1.6.1),
  sob pena de circularidade.
- Rotular o eixo 1 literalmente como "alinhamento com o governo federal", nunca
  como "esquerda/direita" (§1.6).
- Rotular o eixo 2 como "coesão com o próprio partido" — é medida de
  comportamento, não de ideologia. Dois deputados com 100% de coesão em partidos
  opostos ocupam o mesmo ponto nesse eixo e são politicamente opostos.
- Documentar a metodologia dos dois eixos antes da publicação. A Fase 2 previa
  isso para "múltiplos eixos"; ao antecipar o segundo eixo, antecipa-se também a
  obrigação de documentar.

**Sobre a ingestão:** a direção é `votações → votos → deputados` (§1.3), não o
contrário. Para um ano de plenário: 4 requisições de listagem (janela de 3
meses) + ~900 de `/votos`. Com retry obrigatório (§1.9). Como as votações
passadas são imutáveis, cabe cache permanente por `id` de votação — só o período
corrente precisa ser reprocessado.

**Sobre a ingestão:** a direção é `votações → votos → deputados` (§1.3), não o
contrário. Para um ano de plenário: 4 requisições de listagem (janela de 3
meses) + ~900 de `/votos`. Com retry obrigatório (§1.9). Como as votações
passadas são imutáveis, cabe cache permanente por `id` de votação — só o período
corrente precisa ser reprocessado.

---

## Apêndice — endpoints verificados

| Endpoint | Status | Observação |
|---|---|---|
| `GET /api/v2/api-docs` | ✅ | Spec OpenAPI, 78 paths |
| `GET /deputados?siglaUf=RS` | ✅ | 31 registros |
| `GET /deputados/{id}` | ✅ | inclui CPF |
| `GET /deputados/{id}/historico` | ✅ | filiação + mandato |
| `GET /deputados/{id}/discursos` | ✅ | transcrição + link oficial |
| `GET /deputados/{id}/votacoes` | ❌ 405 | **não existe** |
| `GET /votacoes?idOrgao=180&...` | ✅ | janela máx. 3 meses, itens máx. 100 |
| `GET /votacoes?siglaOrgao=PLEN` | ❌ 400 | parâmetro inexistente |
| `GET /votacoes/{id}/votos` | ✅ | sem paginação; `[]` se simbólica |
| `GET /votacoes/{id}/votos?itens=600` | ❌ 400 | não aceita paginação |
| `GET /votacoes/{id}/orientacoes` | ⚠️ | id do partido só quando `codTipoLideranca="P"`; blocos truncados |
| `GET /blocos?idLegislatura=57` | ✅ | nomes completos dos blocos |
| `GET /blocos/{id}/partidos` | ⚠️ | responde 200 mas **retorna array vazio** |
| `GET /orgaos?sigla=PLEN` | ✅ | id 180 |
| `GET /proposicoes/{id}/temas` | ✅ | insumo p/ eixos |
| `GET /referencias/proposicoes/codTema` | ✅ | 32 temas |
| `GET /senador/lista/atual.json` | ✅ | 3 senadores RS |
| `GET /senador/{cod}/votacoes.json` | ⚠️ | **depreciado; desativação 2026-02-01** |
| `GET /votacao` (Senado) | ✅ | substituto; votos embutidos |
| `GET /votacao?dataInicio=20250401` | ❌ 400 | exige `YYYY-MM-DD` |
| DivulgaCand `/candidatura/listar/...` | ✅ | 546 cands.; CPF nulo na listagem |
| DivulgaCand `/candidatura/buscar/...` | ✅ | CPF e arquivos preenchidos |
| CKAN `package_show?id=candidatos-2022` | ✅ | 144 recursos |
| CDN `proposta_governo_2022_RS.zip` | ✅ | 13 arquivos — só governadores |
| CDN `consulta_cand_2022.zip` | ✅ | CSV por UF, latin-1, com CPF |
| `camara.leg.br/noticias/rss` | ⚠️ | HTML; feeds só por tema |
| `senado.leg.br/noticias/rss` | ✅ | RSS institucional, não por político |
