# INGESTOR.md

Coletor das fontes oficiais. Referências (§x.y) apontam para [FONTES.md](./FONTES.md).

## Uso

```bash
npm run ingerir -- --inicio 2025-01-01 --fim 2025-06-30
```

| Flag | Padrão | |
|---|---|---|
| `--uf` | `RS` | recorte da bancada |
| `--legislatura` | `57` | |
| `--inicio` / `--fim` | `2025-01-01` / `2025-06-30` | período das votações |
| `--etapas` | todas | `referencias,deputados,votacoes,proposicoes,discursos,reclassificar,posicoes` |

Etapas isoladamente:

```bash
npm run ingerir -- --etapas votacoes --inicio 2025-07-01 --fim 2025-12-31
```

Conferir o resultado contra os números do reconhecimento:

```bash
npm run relatorio
```

### Manutenção periódica

```bash
npm run ingerir:incremental
```

Sem argumentos: descobre no banco até onde a coleta chegou e continua dali até
hoje. Aceita `--uf` e `--legislatura`. Não inicia acervo — sem banco, falha
dizendo como reconstruir.

---

## Duas janelas, não uma

A ingestão incremental **não** é a ingestão completa com datas mais estreitas.
Coleta e apuração usam janelas diferentes:

| | Janela |
|---|---|
| `votacoes`, `proposicoes`, `discursos` | última data coberta → hoje |
| `posicoes` | início da legislatura → hoje |

`posicao` é gravada com chave `(periodo_inicio, periodo_fim)`. Rodar `posicoes`
na janela incremental não atualiza as posições da legislatura — grava um
**segundo** conjunto, apurado sobre os dias novos, com denominador de poucas
votações. E o `relatorio` escolhe o período mais abrangente, então o engano não
apareceria ali: o acervo teria posições enganosas que nenhum comando exibe.

Rodar `npm run ingerir -- --inicio <última data> --fim <hoje>` sem restringir as
etapas cai exatamente nessa armadilha. É o motivo de `ingerir:incremental`
existir em vez de ser só uma anotação de uso.

### A última data coberta não é a última data com votação

`MAX(votacao.data)` diz onde houve sessão. A tabela `coleta` registra a janela
pedida à origem (`votacoes 2023-02-01..2023-04-30`), e portanto até onde se
**olhou** — que é a pergunta certa. Em recesso as duas divergem por semanas, e
recomeçar pela segunda revarreria janelas já cobertas a cada execução.
`MAX(votacao.data)` fica como fallback, para banco anterior a esta auditoria.

A retomada é **na** última data coberta, não no dia seguinte: a votação do dia
em que a coleta anterior rodou pode ter sido gravada com a sessão em curso, e o
pipeline só trata como imutável votação anterior a hoje (§ *Idempotência*).
Revarrer um dia custa cache; perder a votação de fecho de sessão, não.

### O horizonte é por etapa, e a retomada usa o menor

Duas etapas são recortadas por data — `votacoes` e `discursos` — e elas podem
estar em pontos diferentes. Basta rodar `npm run ingerir -- --etapas votacoes`
isoladamente, uso documentado logo acima.

Por isso as duas gravam a janela no nome do recurso:

```
votacoes 2023-02-01..2023-04-30
deputados/204536/discursos 2023-02-01..2023-04-30
```

e a retomada é o **menor** dos dois horizontes. Adiantar qualquer etapa deixaria
a atrasada permanentemente para trás: quem rodasse só `votacoes` até hoje veria
a próxima execução incremental começar de hoje, e os discursos daquele período
**nunca** seriam coletados — sem erro, sem aviso, sem linha em `coleta` que
denunciasse a lacuna. Exatamente o que a auditoria existe para impedir.

Etapa sem horizonte registrado é tratada como **sem cobertura nenhuma**, não
como "acompanha as outras". Vale para banco anterior a esta versão, em que o
recurso de discurso não trazia a janela. Recoletar discurso custa ~31
requisições e deduplica por hash de conteúdo, então o pior caso é barato — e o
banco se corrige sozinho na primeira execução. Medido: 8,3 min na execução de
auto-cura, ~49 s nas seguintes.

`proposicoes`, `reclassificar` e `posicoes` não entram nessa conta: não
consultam a origem por data. As duas últimas rodam **sempre**, mesmo quando não
há nada novo a coletar — são derivação pura, e mudança de regra de
classificação ou de metodologia de eixo precisa poder ser aplicada sem que a
Câmara tenha publicado uma sessão nova.

A decisão mora em [`src/ingest/horizonte.ts`](../src/ingest/horizonte.ts),
separada da CLI por um motivo só: `incremental.ts` é um script, executa ao ser
importado. Em módulo à parte, a lógica é verificável em `npm run db:validar` —
10 casos, contra banco em memória, sem rede. Os casos foram conferidos por
mutação: herdar o horizonte de votação no discurso, trocar o mínimo entre
etapas pelo máximo, e ignorar `status <> 'ok'` fazem a suíte falhar.

### Data corrente é a de Brasília

`hoje()` (`src/lib/normalizar.ts`) usa `America/Sao_Paulo`, não `toISOString()`.
Vale para a coleta inteira, não só para o incremental — a fronteira do cache é
uma data, e data depende de fuso.

UTC vira o dia às 21h BRT. Enquanto o pipeline usava `toISOString()`, coleta
rodada entre 21h e meia-noite lia o dia seguinte, dava por passada a votação
**do próprio dia** e a gravava como imutável — placar de sessão em curso,
nunca mais rebuscado. No incremental, o mesmo cálculo declararia cobertura até
uma data que ainda não começou no país da fonte.

As três horas do defeito estão fixadas como regressão em `npm run db:validar`.

---

## Arquitetura

```
src/
  lib/http.ts          retry, backoff, janelas de data
  lib/normalizar.ts    voto, CPF, sigla, data
  ingest/camara.ts     cliente tipado da API
  ingest/pipeline.ts   as quatro etapas
  ingest/index.ts      CLI
  calc/posicoes.ts     os dois eixos + evidências
  relatorio.ts         verificação do acervo
```

### Direção da coleta

`votações → votos → deputados`, nunca o inverso: `/deputados/{id}/votacoes`
devolve **405**, não existe (§1.3). O acervo só é acessível pelo lado da votação.

### Idempotência

Todas as etapas podem ser re-executadas sem duplicar. Não é conveniência: com
504 intermitente (§1.9), **retomar coleta interrompida é o caso normal**.

Votação passada é imutável — se já está no banco e a data é anterior a hoje, não
é recoletada. Só o período corrente é reprocessado.

---

## Decisões que o reconhecimento impôs

### Retry não é opcional

Uma requisição a `/votacoes` precisou de 6 tentativas durante o reconhecimento
(§1.9). `buscarJson` faz até 8 tentativas com backoff exponencial e jitter, e
respeita `Retry-After`.

Distingue erro **retriável** (5xx, timeout, rede, 429) de **definitivo** (4xx):
insistir num 400 desperdiça tempo e mascara bug de parâmetro. Foi assim que o
`siglaOrgao` inexistente apareceu rápido no reconhecimento, em vez de virar
oito tentativas silenciosas.

### Nominal vs. simbólica só se descobre chamando

Não há campo na origem. A lista de votos vazia é o único sinal (§1.4):

```ts
const nominal = votos.length > 0;
```

Por isso a etapa `votacoes` faz ~450 requisições para achar ~154 votações úteis
num semestre. O resultado é persistido em `votacao.nominal` para não repetir a
descoberta.

O placar em `descricao` (`"Sim: 226; Não: 109"`) é extraído para preencher os
totais, mas **nunca** decide se a votação é nominal — é texto livre.

### Deputados de fora do recorte entram com perfil mínimo

O eixo de coesão compara o parlamentar com a maioria **nacional** do seu partido
(§1.6.1), o que exige os votos dos 513 — mas o CPF só vem no endpoint de
detalhe, um request por deputado.

Exigir cadastro completo de todos custaria 513 requisições para sustentar 31
perfis. Então:

- **no recorte** (`perfil_completo = 1`): cadastro, CPF, histórico, discursos;
- **fora do recorte** (`perfil_completo = 0`): nome e id, apenas como contraparte
  de voto.

A flag impede que a interface ofereça perfil de quem só tem nome — lacuna de
coleta não pode parecer perfil vazio.

### Orientação de bloco fica sem `partido_id`

Quando `codTipoLideranca = 'B'`, a origem devolve `codPartidoBloco: null` e sigla
truncada (`"Bl PlFdrPtUniPp..."`), e `/blocos/{id}/partidos` retorna vazio
(§1.6). O ingestor grava `partido_id` NULL e preserva a sigla como veio.

Adivinhar os membros a partir do texto truncado seria criar dado não rastreável.

### Votação tem dois vínculos com proposição, não um

`proposicoesAfetadas` (do detalhe da votação) traz a **matéria de fundo**;
o prefixo do id da votação (`"2381043-91"`) traz o **objeto formalmente votado**.

Em 37 de 40 votações amostradas eles coincidem. Nas outras 3, a votação é sobre
um requerimento: objeto = `REQ 4731/2024`, matéria = `PLP 167/2024`. Usar o
prefixo como vínculo de matéria erraria em ~7% dos casos.

Guardar os dois não é preciosismo: dizer que o parlamentar "votou a favor do
PLP" quando ele votou a urgência da tramitação é impreciso o bastante para
violar o princípio do projeto. `objeto_votado_id = proposicao_id` marca votação
de mérito; diferentes, votação procedimental.

Cobertura no 1º sem/2025: **154/154 votações nominais** vinculadas à matéria,
153 com tema. As 6 votações sem `proposicoesAfetadas` na origem são todas
simbólicas, e portanto fora do cálculo dos eixos.

### Discurso deduplica por conteúdo, não por instante

`(politico, dataHoraInicio)` **não é única**. Bibo Nunes tem duas falas em
`2025-05-05T23:04` — uma orientando a bancada, outra criticando um projeto — e
outras duas em `2025-05-27T17:28` com tipo, sumário e `urlTexto` idênticos,
diferindo apenas na transcrição.

A chave ingênua descartava 6 discursos reais no 1º semestre de 2025. A chave
atual é um hash de `dataHoraInicio + tipo + sumário + urlTexto + transcrição`,
e o acervo bate 839/839 com a origem.

Custo assumido: se a Câmara publicar a versão revisada de uma transcrição, o
hash muda e a re-ingestão cria um segundo registro. É preferível a descartar em
silêncio a fala de um parlamentar.

### Natureza da votação separa mérito de procedimento

56% das votações nominais são sobre requerimentos. `votacao.natureza` deriva de
dois sinais oficiais — a descrição padronizada pela Câmara e a divergência entre
objeto votado e matéria — e alimenta os dois escopos de apuração dos eixos.

Medição do cruzamento nas 154 nominais: a descrição sozinha captura as 86
procedimentais (14 com ambos os sinais, 72 só por descrição); o vínculo de
proposição não captura nenhuma adicional. A descrição é o sinal dominante; o id
entra como reforço.

Revisar sem recoletar:

```bash
npm run ingerir -- --etapas reclassificar
```

### Discursos são classificados, nunca descartados

839 discursos num semestre incluem 97 registros de "orientou a bancada" — cujo
conteúdo informativo (como a bancada orientou) **já está estruturado na tabela
`orientacao`**, ligado à votação. Repetir isso no perfil é ruído.

Mas filtrar fala de político é julgamento editorial, e o projeto proíbe
julgamento próprio não rastreável. Então a regra
([`src/lib/classificar.ts`](../src/lib/classificar.ts)) se sujeita a três
restrições:

1. **Só campos oficiais** — `tipoDiscurso` da Câmara + padrão do sumário
   redigido pela própria Casa. Sem limiar de tamanho, sem análise de mérito.
2. **Classifica, não exclui** — `relevante = false` continua no banco, com
   fonte. A interface destaca o substantivo e deve dar acesso ao acervo inteiro.
3. **Na dúvida, é substantivo** — esconder fala política é pior que exibir
   registro protocolar.

| Categoria | 1º sem/2025 | No perfil |
|---|---|---|
| `substantivo` | 736 (87,7%) | sim |
| `orientacao_voto` | 97 | não |
| `registro_presenca` | 6 | não |

**Por que a regra olha dois campos, não um.** Três discursos com sumário
"orientou a bancada" são do tipo `COMO LÍDER` e têm 3.103 caracteres de média
(contra 777 dos "pela ordem"): são pronunciamentos que apenas mencionam a
orientação. Filtrar só pelo sumário os descartaria.

**Por que só as sentenças seguintes contam.** A primeira sentença do sumário
embute a ementa do projeto votado, e ementa descreve a proposição, não a fala.
Testar o sumário inteiro fazia *"requerimento que solicita o encerramento da
discussão"* parecer posicionamento, devolvendo ao perfil a orientação ritual que
se queria separar.

**O caso que definiu a salvaguarda.** Um sumário abre com "registrou a presença
da Vereadora Cátina Monteiro" e segue: *"fez um apelo em defesa dos combatentes
da missão de paz em Suez […] Criticou ainda o veto presidencial"*. Abertura
protocolar, conteúdo político. Se há posicionamento em sentença posterior ao ato
ritual, é substantivo.

Os sete casos reais estão fixados como regressão em `npm run db:validar` — a
regra passou por quatro versões durante o ajuste, e cada uma quebrou um deles.

Revisar a regra não exige recoletar:

```bash
npm run ingerir -- --etapas reclassificar
```

`classificacao_versao` é gravada em cada linha, então dá para saber com que
critério cada discurso foi julgado.

### Códigos de voto desconhecidos viram aviso, não default

`normalizarVoto` sinaliza `desconhecido: true` para código fora do vocabulário
conhecido, e o CLI lista os avisos ao final. Classificar silenciosamente o voto
de um parlamentar real como "ausente" é o pior defeito possível aqui.

### Filiação e exercício são derivados do histórico

`/deputados/{id}/historico` é uma sequência de eventos; o modelo precisa de
intervalos (§1.2, §1.8).

- `derivarFiliacoes` — abre novo intervalo a cada troca de sigla.
- `derivarExercicios` — `"Exercício"` abre período, qualquer outra situação
  fecha. Suporta múltiplos períodos por mandato (posse, licença, retorno).

É o que produz, corretamente, `Sérgio Turra · suplente · início 2026-04-07` — e
o que impede que ele apareça como faltoso no 1º semestre de 2025.

---

## Auditoria

Cada operação grava uma linha em `coleta` com URL, tentativas, status e nº de
registros. Uma linha por operação, não por requisição HTTP: o que precisa ser
auditável é *"este recurso foi coletado por inteiro?"*.

```sql
SELECT recurso, status, tentativas, erro
FROM coleta WHERE status <> 'ok' ORDER BY iniciado_em DESC;
```

Sem isso, coleta parcial é indistinguível de coleta completa — e lacuna vira
"o deputado não votou" na interface.

---

## Custo

Por semestre de plenário, aproximadamente:

| Etapa | Requisições |
|---|---|
| `referencias` | 3 |
| `deputados` | 2 × 31 = 62 |
| `votacoes` | 2 janelas + ~450 `/votos` + ~154 `/orientacoes` |
| `proposicoes` | ~450 detalhes + ~166 proposições + ~166 temas |
| `discursos` | ~31 |

A janela de `/votacoes` é limitada a **3 meses** pela origem (§1.3); `janelas()`
fatia o intervalo automaticamente.

---

## Notas de ambiente

- `node:sqlite` nativo via adaptador `sqlite-proxy` do Drizzle. `better-sqlite3`
  não compila no Node 26 e o Drizzle ainda não publica driver para `node:sqlite`.
- TypeScript roda por type-stripping (`--experimental-strip-types`), sem passo de
  build. Isso proíbe *parameter properties* (`constructor(readonly x: T)`) e
  enums — o código evita ambos.
- `drizzle-kit migrate` exige driver suportado; `src/db/migrar.ts` aplica o SQL
  direto e controla o que já rodou em `_migrations`.
