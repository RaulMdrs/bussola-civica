/**
 * Bússola Cívica — modelo de dados (Fase 0)
 *
 * Referências entre parênteses (§x.y) apontam para docs/FONTES.md, onde o achado
 * que motivou cada decisão está documentado com request/response verificados.
 *
 * Três regras estruturais atravessam o schema:
 *   1. Nada que a plataforma exibe pode existir sem `fonteUrl` — proveniência é
 *      coluna, não metadado opcional (§5.7).
 *   2. Todo dado que muda com o tempo (partido, exercício) é linha com intervalo,
 *      nunca coluna do político (§1.2, §1.8).
 *   3. Valores derivados vivem separados dos valores coletados, e carregam a
 *      versão da metodologia que os produziu (§6).
 */

import { relations, sql } from "drizzle-orm";
import { CATEGORIAS_DISCURSO } from "../lib/classificar.ts";
import { NATUREZAS_VOTACAO } from "../lib/natureza.ts";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** Datas e instantes são TEXT em ISO-8601 — ordenáveis lexicograficamente em SQLite. */
const agora = sql`(strftime('%Y-%m-%dT%H:%M:%SZ','now'))`;

export const CASAS = ["camara", "senado"] as const;
export const FONTES = ["camara", "senado", "tse"] as const;

// ---------------------------------------------------------------------------
// 1. Identidade
// ---------------------------------------------------------------------------

/**
 * Pessoa. Estável através de trocas de partido, de casa e de mandato.
 *
 * `cpf` é a única chave confiável de reconciliação entre Câmara e TSE — validada
 * em 31/31 deputados do RS (§3.4). Nome não serve (nome parlamentar vs. nome de
 * urna), partido menos ainda (6 dos 31 trocaram de legenda desde a eleição).
 *
 * É NULLABLE de propósito. O eixo de coesão partidária compara o deputado com a
 * maioria **nacional** do seu partido (§1.6.1), o que obriga a registrar os votos
 * dos 513 — mas o CPF só vem no endpoint de detalhe, um request por deputado.
 * Exigir CPF de todos custaria 513 requisições para sustentar 31 perfis. Quem
 * está no recorte tem cadastro completo; os demais existem como contraparte de
 * voto. Em SQLite, UNIQUE admite múltiplos NULL, então o índice segue válido.
 *
 * ATENÇÃO: o CPF é uso interno. É público na origem, mas não deve ser exposto
 * pela API nem pelo front (§1.1). Manter fora de qualquer serializer público.
 */
export const politico = sqliteTable(
  "politico",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    cpf: text("cpf"), // 11 dígitos, com zeros à esquerda (§3.4)
    nomeCivil: text("nome_civil"),
    nomeParlamentar: text("nome_parlamentar").notNull(),
    dataNascimento: text("data_nascimento"),
    dataFalecimento: text("data_falecimento"),
    sexo: text("sexo"),
    ufNascimento: text("uf_nascimento"),
    municipioNascimento: text("municipio_nascimento"),
    escolaridade: text("escolaridade"),
    urlFoto: text("url_foto"), // resolve direto na origem; não hospedar (§1.1)
    /**
     * true = está no recorte da fase (cadastro, histórico e discursos coletados).
     * false = existe apenas como contraparte de voto, para apurar a maioria
     * partidária nacional. Impede que a interface ofereça perfil de quem só tem
     * nome e id — lacuna de coleta não pode parecer perfil vazio.
     */
    perfilCompleto: integer("perfil_completo", { mode: "boolean" })
      .notNull()
      .default(false),
    fonteUrl: text("fonte_url").notNull(),
    coletadoEm: text("coletado_em").notNull().default(agora),
  },
  (t) => [
    uniqueIndex("politico_cpf_uq").on(t.cpf),
    index("politico_nome_idx").on(t.nomeParlamentar),
  ],
);

/**
 * Ponte entre o político e seus identificadores em cada fonte.
 *
 * Tabela em vez de colunas `idCamara`/`idSenado` porque o TSE emite um
 * SQ_CANDIDATO **por eleição** — a cardinalidade é 1:N por fonte. `contexto`
 * guarda o discriminador (ano da eleição, legislatura).
 */
export const identidadeExterna = sqliteTable(
  "identidade_externa",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    politicoId: integer("politico_id")
      .notNull()
      .references(() => politico.id, { onDelete: "cascade" }),
    fonte: text("fonte", { enum: FONTES }).notNull(),
    idExterno: text("id_externo").notNull(),
    contexto: text("contexto"), // ex.: "2022" (eleição), "57" (legislatura)
    fonteUrl: text("fonte_url").notNull(),
  },
  (t) => [
    uniqueIndex("identidade_fonte_id_uq").on(t.fonte, t.idExterno, t.contexto),
    index("identidade_politico_idx").on(t.politicoId),
  ],
);

// ---------------------------------------------------------------------------
// 2. Partido e filiação (temporal)
// ---------------------------------------------------------------------------

export const partido = sqliteTable(
  "partido",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sigla: text("sigla").notNull(), // grafia canônica adotada
    nome: text("nome"),
    fonteUrl: text("fonte_url"),
  },
  (t) => [uniqueIndex("partido_sigla_uq").on(t.sigla)],
);

/**
 * Grafias alternativas da mesma legenda entre fontes.
 *
 * Existe por um caso concreto: o TSE grafa "PC do B" e a Câmara "PCdoB" (§3.4).
 * Sem esta tabela o cruzamento produz um falso positivo de troca de partido —
 * e "trocou de partido" é afirmação sobre uma pessoa real, que não pode sair
 * errada num produto cujo princípio é credibilidade.
 */
export const partidoAlias = sqliteTable(
  "partido_alias",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    partidoId: integer("partido_id")
      .notNull()
      .references(() => partido.id, { onDelete: "cascade" }),
    alias: text("alias").notNull(),
    fonte: text("fonte", { enum: FONTES }).notNull(),
  },
  (t) => [uniqueIndex("partido_alias_uq").on(t.alias, t.fonte)],
);

/**
 * Filiação partidária como intervalo — decorre de §1.2.
 *
 * 6 dos 31 deputados do RS estão em partido diferente daquele pelo qual se
 * elegeram. Partido como coluna de `politico` agruparia errado todos eles na
 * visualização orbital.
 *
 * `dataFim` NULL = filiação vigente.
 */
export const filiacao = sqliteTable(
  "filiacao",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    politicoId: integer("politico_id")
      .notNull()
      .references(() => politico.id, { onDelete: "cascade" }),
    partidoId: integer("partido_id")
      .notNull()
      .references(() => partido.id),
    dataInicio: text("data_inicio").notNull(),
    dataFim: text("data_fim"),
    fonteUrl: text("fonte_url").notNull(),
  },
  (t) => [
    index("filiacao_politico_idx").on(t.politicoId, t.dataInicio),
    uniqueIndex("filiacao_uq").on(t.politicoId, t.partidoId, t.dataInicio),
  ],
);

// ---------------------------------------------------------------------------
// 3. Mandato e exercício
// ---------------------------------------------------------------------------

export const legislatura = sqliteTable("legislatura", {
  numero: integer("numero").primaryKey(),
  dataInicio: text("data_inicio").notNull(),
  dataFim: text("data_fim").notNull(),
});

export const mandato = sqliteTable(
  "mandato",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    politicoId: integer("politico_id")
      .notNull()
      .references(() => politico.id, { onDelete: "cascade" }),
    casa: text("casa", { enum: CASAS }).notNull(),
    legislaturaNumero: integer("legislatura_numero")
      .notNull()
      .references(() => legislatura.numero),
    uf: text("uf").notNull(),
    condicaoEleitoral: text("condicao_eleitoral", {
      enum: ["titular", "suplente"],
    }).notNull(),
    fonteUrl: text("fonte_url").notNull(),
  },
  (t) => [
    uniqueIndex("mandato_uq").on(t.politicoId, t.casa, t.legislaturaNumero),
    index("mandato_uf_idx").on(t.uf, t.casa, t.legislaturaNumero),
  ],
);

/**
 * Períodos efetivos de exercício — a tabela que impede o erro dos suplentes.
 *
 * Motivo concreto (§1.8): Carlos Gomes e Sérgio Turra aparecem com 0% de
 * participação no 1º sem/2025 porque só entraram em exercício em fev e abr de
 * 2026. Não são faltosos — não tinham mandato. Com denominador fixo, todo
 * suplente vira "ausente contumaz".
 *
 * É 1:N com `mandato`, não 1:1: um mesmo mandato acumula entradas e saídas
 * (posse, licença, afastamento, retorno). O denominador de qualquer métrica de
 * participação é o nº de votações ocorridas DENTRO destes intervalos.
 *
 * `dataFim` NULL = em exercício.
 */
export const exercicio = sqliteTable(
  "exercicio",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    mandatoId: integer("mandato_id")
      .notNull()
      .references(() => mandato.id, { onDelete: "cascade" }),
    dataInicio: text("data_inicio").notNull(),
    dataFim: text("data_fim"),
    situacao: text("situacao"), // "Exercício", "Fim de Mandato", "Licença"...
    descricaoStatus: text("descricao_status"),
    fonteUrl: text("fonte_url").notNull(),
  },
  (t) => [
    index("exercicio_mandato_idx").on(t.mandatoId, t.dataInicio),
    uniqueIndex("exercicio_uq").on(t.mandatoId, t.dataInicio),
  ],
);

// ---------------------------------------------------------------------------
// 4. Proposições, temas e órgãos
// ---------------------------------------------------------------------------

export const orgao = sqliteTable(
  "orgao",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    casa: text("casa", { enum: CASAS }).notNull(),
    idExterno: text("id_externo").notNull(), // Plenário da Câmara = "180" (§1.3)
    sigla: text("sigla").notNull(),
    nome: text("nome"),
    tipo: text("tipo"),
  },
  (t) => [uniqueIndex("orgao_uq").on(t.casa, t.idExterno)],
);

export const proposicao = sqliteTable(
  "proposicao",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    casa: text("casa", { enum: CASAS }).notNull(),
    idExterno: text("id_externo").notNull(),
    siglaTipo: text("sigla_tipo"), // PL, PEC, MPV, PLP...
    numero: integer("numero"),
    ano: integer("ano"),
    ementa: text("ementa"),
    dataApresentacao: text("data_apresentacao"),
    fonteUrl: text("fonte_url").notNull(),
  },
  (t) => [uniqueIndex("proposicao_uq").on(t.casa, t.idExterno)],
);

/** 32 temas oficiais da Câmara (§1.7) — base dos eixos temáticos da Fase 2. */
export const tema = sqliteTable("tema", {
  id: integer("id").primaryKey(), // codTema da Câmara
  nome: text("nome").notNull(),
});

export const proposicaoTema = sqliteTable(
  "proposicao_tema",
  {
    proposicaoId: integer("proposicao_id")
      .notNull()
      .references(() => proposicao.id, { onDelete: "cascade" }),
    temaId: integer("tema_id")
      .notNull()
      .references(() => tema.id),
    relevancia: real("relevancia"),
  },
  (t) => [uniqueIndex("proposicao_tema_uq").on(t.proposicaoId, t.temaId)],
);

// ---------------------------------------------------------------------------
// 5. Votações
// ---------------------------------------------------------------------------

/**
 * Votação.
 *
 * `idExterno` é TEXT: a Câmara usa "2381043-91" (idProposicao-sequencial), que
 * não é inteiro (§1.3). O Senado usa numérico — TEXT acomoda ambos.
 *
 * `nominal` é DERIVADO na ingestão (`votos.length > 0`) e persistido. Não existe
 * campo equivalente na origem: a única forma de saber é chamar /votos e ver se
 * volta vazio (§1.4). Persistir evita repetir a descoberta a cada consulta —
 * 66% das votações de plenário são simbólicas e não servem para posicionamento.
 *
 * `secreta` só se aplica ao Senado, onde 67% das votações ocultam o voto
 * individual (§2.4). Votação secreta nunca entra em cálculo de posição.
 */
export const votacao = sqliteTable(
  "votacao",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    casa: text("casa", { enum: CASAS }).notNull(),
    idExterno: text("id_externo").notNull(),
    orgaoId: integer("orgao_id").references(() => orgao.id),
    /**
     * Matéria de fundo — de `proposicoesAfetadas` no detalhe da votação.
     * É "sobre o que" a votação versa, e é onde os temas fazem sentido.
     */
    proposicaoId: integer("proposicao_id").references(() => proposicao.id),
    /**
     * O que foi FORMALMENTE votado, quando difere da matéria de fundo.
     *
     * Numa votação de requerimento de urgência, o objeto é o requerimento
     * (REQ 4731/2024) e a matéria afetada é o projeto (PLP 167/2024). Tratar os
     * dois como a mesma coisa faria a plataforma dizer que o parlamentar "votou
     * a favor do PLP" quando votou apenas a urgência da tramitação — impreciso
     * o bastante para violar o princípio do projeto.
     *
     * Igual a `proposicaoId` = votação de mérito sobre a própria matéria.
     * Diferente = votação procedimental a respeito dela.
     */
    objetoVotadoId: integer("objeto_votado_id").references(() => proposicao.id),
    data: text("data").notNull(),
    descricao: text("descricao"),
    aprovacao: integer("aprovacao", { mode: "boolean" }), // pode ser NULL na origem
    nominal: integer("nominal", { mode: "boolean" }).notNull(),
    /**
     * O que estava em jogo: mérito da matéria, procedimento (requerimento de
     * urgência, retirada de pauta…) ou ato formal (redação final).
     *
     * 56% das votações nominais são procedimentais. Votar a urgência de um
     * projeto não é votar o projeto — misturar as duas coisas num índice único
     * produz um número que não responde a pergunta nenhuma. Ver src/lib/natureza.ts.
     */
    natureza: text("natureza", { enum: NATUREZAS_VOTACAO }),
    naturezaVersao: text("natureza_versao"),
    secreta: integer("secreta", { mode: "boolean" }).notNull().default(false),
    totalSim: integer("total_sim"),
    totalNao: integer("total_nao"),
    totalAbstencao: integer("total_abstencao"),
    fonteUrl: text("fonte_url").notNull(),
    coletadoEm: text("coletado_em").notNull().default(agora),
  },
  (t) => [
    uniqueIndex("votacao_uq").on(t.casa, t.idExterno),
    index("votacao_data_idx").on(t.data),
    // índice de trabalho: o universo elegível para posicionamento
    index("votacao_elegivel_idx").on(t.nominal, t.secreta, t.data),
    index("votacao_natureza_idx").on(t.natureza, t.nominal),
  ],
);

/**
 * Vocabulário normalizado de voto.
 *
 * Câmara e Senado usam conjuntos incompatíveis (§1.5, §2.4). A normalização
 * preserva as distinções que têm peso político:
 *
 *  - `obstrucao`  — ato político deliberado, NÃO ausência. Colapsar em "faltou"
 *                   distorce bancadas minoritárias, que usam obstrução como
 *                   instrumento regimental.
 *  - `presidente` — Câmara "Artigo 17" / Senado "Presidente (art. 51 RISF)".
 *                   Só vota em desempate; não é posição comparável.
 *  - `sigiloso`   — Senado: "Votou"/"P-NRV" em votação secreta. A API confirma
 *                   que votou, mas não revela como. Ausência de dado, não voto.
 *  - `ausente`    — licença, missão, não compareceu.
 */
export const VOTO_NORMALIZADO = [
  "sim",
  "nao",
  "abstencao",
  "obstrucao",
  "presidente",
  "sigiloso",
  "ausente",
] as const;

/**
 * Voto individual.
 *
 * `partidoId` é o partido do parlamentar NA DATA da votação — vem no próprio
 * registro de voto da Câmara (§1.5), então não depende de join com `filiacao`.
 * Guardar aqui torna o cálculo imune a trocas de legenda posteriores.
 *
 * `tipoVotoOriginal` preserva o texto exato da origem. Normalização é
 * interpretação, e interpretação precisa ser auditável contra o original.
 *
 * `computavel` marca se o voto entra em cálculo de posição — apenas `sim`/`nao`
 * na Fase 0. Persistido para que a regra fique explícita e versionável, em vez
 * de espalhada por queries.
 */
export const voto = sqliteTable(
  "voto",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    votacaoId: integer("votacao_id")
      .notNull()
      .references(() => votacao.id, { onDelete: "cascade" }),
    politicoId: integer("politico_id")
      .notNull()
      .references(() => politico.id, { onDelete: "cascade" }),
    partidoId: integer("partido_id").references(() => partido.id),
    voto: text("voto", { enum: VOTO_NORMALIZADO }).notNull(),
    tipoVotoOriginal: text("tipo_voto_original").notNull(),
    computavel: integer("computavel", { mode: "boolean" }).notNull(),
    dataRegistro: text("data_registro"),
  },
  (t) => [
    uniqueIndex("voto_uq").on(t.votacaoId, t.politicoId),
    index("voto_politico_idx").on(t.politicoId),
    // suporta a apuração da maioria partidária por votação (§1.6.1)
    index("voto_votacao_partido_idx").on(t.votacaoId, t.partidoId, t.voto),
  ],
);

/**
 * Orientação de bancada.
 *
 * Modelada com fidelidade à limitação real da fonte (§1.6): `partidoId` só é
 * preenchível quando `tipoLideranca = 'P'` (partido orientando sozinho). Para
 * blocos, a origem devolve `codPartidoBloco: null` e sigla truncada
 * ("Bl PlFdrPtUniPp..."), e `/blocos/{id}/partidos` retorna vazio — não há como
 * resolver os membros sem inferência própria.
 *
 * Por isso `siglaBruta` é guardada como veio, truncada e tudo. Preencher
 * `partidoId` por adivinhação a partir do texto truncado seria criar dado não
 * rastreável — o que o princípio do projeto proíbe.
 *
 * Uso na Fase 0: apenas as chaves agregadas "Governo" e "Oposição", presentes em
 * 100% das votações nominais medidas. O eixo de coesão partidária NÃO sai daqui
 * (ver `posicao` e §1.6.1).
 *
 * `liberado` distingue liberação de bancada (orientacaoVoto = "") de ausência
 * de orientação. São coisas diferentes: liberação é informação política.
 */
export const orientacao = sqliteTable(
  "orientacao",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    votacaoId: integer("votacao_id")
      .notNull()
      .references(() => votacao.id, { onDelete: "cascade" }),
    siglaBruta: text("sigla_bruta").notNull(), // pode vir truncada
    tipoLideranca: text("tipo_lideranca", { enum: ["P", "B"] }).notNull(),
    partidoId: integer("partido_id").references(() => partido.id), // só se 'P'
    orientacao: text("orientacao", { enum: VOTO_NORMALIZADO }),
    liberado: integer("liberado", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    uniqueIndex("orientacao_uq").on(t.votacaoId, t.siglaBruta),
    index("orientacao_votacao_idx").on(t.votacaoId),
  ],
);

// ---------------------------------------------------------------------------
// 6. Discursos (substituem plano de governo na Fase 0)
// ---------------------------------------------------------------------------

/**
 * Plano de governo não existe para deputados federais — interseção medida entre
 * os 546 candidatos do RS e os PDFs de proposta do TSE: zero (§3.3). O documento
 * só é exigido de candidatos a chefe do Executivo.
 *
 * Discursos ocupam o lugar: são palavra do próprio parlamentar, em fonte
 * oficial, com link para o Diário da Câmara em `urlTexto`, e cobrem 100% da
 * bancada (§4).
 */
export const discurso = sqliteTable(
  "discurso",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    politicoId: integer("politico_id")
      .notNull()
      .references(() => politico.id, { onDelete: "cascade" }),
    dataHoraInicio: text("data_hora_inicio").notNull(),
    tipoDiscurso: text("tipo_discurso"),
    sumario: text("sumario"),
    transcricao: text("transcricao"),
    urlTexto: text("url_texto"), // Diário da Câmara
    urlAudio: text("url_audio"),
    urlVideo: text("url_video"),
    /**
     * Hash do conteúdo, para deduplicar sem perder discurso.
     *
     * A API não expõe id de discurso, e `(politico, dataHoraInicio)` NÃO é
     * única: um mesmo parlamentar registra falas distintas no mesmo minuto —
     * Bibo Nunes tem duas em 2025-05-05T23:04, uma orientando a bancada e outra
     * criticando um projeto. Chavear pelo instante descartava 5 discursos reais
     * no 1º semestre de 2025.
     */
    chaveConteudo: text("chave_conteudo").notNull(),
    /**
     * Natureza do ato, derivada de `tipoDiscurso` + padrão do sumário — ambos
     * campos oficiais. Ver src/lib/classificar.ts.
     *
     * `relevante = false` NÃO significa descartado: o discurso continua no
     * acervo, com fonte, e deve permanecer acessível. A flag existe para que o
     * perfil destaque pronunciamento substantivo em vez de 167 registros de
     * "orientou a bancada" — informação que já está estruturada em `orientacao`.
     *
     * `classificacaoVersao` permite revisar a regra sem recoletar.
     */
    categoria: text("categoria", { enum: CATEGORIAS_DISCURSO }).notNull(),
    relevante: integer("relevante", { mode: "boolean" }).notNull(),
    classificacaoVersao: text("classificacao_versao").notNull(),
    fonteUrl: text("fonte_url").notNull(),
  },
  (t) => [
    index("discurso_politico_idx").on(t.politicoId, t.dataHoraInicio),
    uniqueIndex("discurso_uq").on(t.politicoId, t.chaveConteudo),
    index("discurso_relevante_idx").on(t.politicoId, t.relevante, t.dataHoraInicio),
  ],
);

// ---------------------------------------------------------------------------
// 7. Eixos e posições (derivados)
// ---------------------------------------------------------------------------

/**
 * Definição de um eixo da visualização.
 *
 * `rotuloMin`/`rotuloMax` existem para forçar a decisão de nomenclatura a viver
 * no dado, não no componente de UI. O princípio do projeto proíbe rotular
 * político por conta própria; o risco prático não está no cálculo, está no
 * rótulo. "Alinhamento com o governo federal" e "esquerda/direita" saem do mesmo
 * número — e só o primeiro é defensável (§1.6).
 *
 * `metodologiaVersao` versiona a fórmula. Mudou o cálculo, muda a versão, e as
 * posições antigas continuam explicáveis pelo que valia quando foram geradas.
 */
export const eixo = sqliteTable(
  "eixo",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    chave: text("chave").notNull(), // "alinhamento_governo" | "coesao_partidaria"
    nomeExibicao: text("nome_exibicao").notNull(),
    descricao: text("descricao").notNull(),
    rotuloMin: text("rotulo_min").notNull(),
    rotuloMax: text("rotulo_max").notNull(),
    metodologiaVersao: text("metodologia_versao").notNull(),
    metodologiaUrl: text("metodologia_url"),
  },
  (t) => [uniqueIndex("eixo_chave_uq").on(t.chave)],
);

/**
 * Posição de um político num eixo, num recorte de tempo.
 *
 * Separar `nObservacoes` de `nOportunidades` é o que torna a métrica honesta
 * (§1.8): `nOportunidades` conta as votações elegíveis ocorridas DENTRO dos
 * períodos de `exercicio` do parlamentar; `nObservacoes` conta em quantas ele
 * de fato registrou voto computável. Sem essa distinção, suplente com mandato
 * de dois meses é comparado contra o denominador de quem serviu quatro anos.
 *
 * `valor` em [0,1]. A escala visual é decisão de apresentação, não de dados.
 */
export const posicao = sqliteTable(
  "posicao",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    politicoId: integer("politico_id")
      .notNull()
      .references(() => politico.id, { onDelete: "cascade" }),
    eixoId: integer("eixo_id")
      .notNull()
      .references(() => eixo.id, { onDelete: "cascade" }),
    legislaturaNumero: integer("legislatura_numero")
      .notNull()
      .references(() => legislatura.numero),
    periodoInicio: text("periodo_inicio").notNull(),
    periodoFim: text("periodo_fim").notNull(),
    /**
     * Universo de votações sobre o qual a posição foi apurada.
     *
     * `merito` é o escopo principal — é o que o cidadão entende por "posição do
     * parlamentar". `procedimental` mede outra coisa (disciplina de pauta,
     * estratégia regimental) e é exibido como tal, nunca como substituto.
     *
     * Ambos existem porque descartar as procedimentais jogaria fora 56% do
     * acervo e uma informação política legítima.
     */
    escopo: text("escopo", { enum: ["merito", "procedimental"] })
      .notNull()
      .default("merito"),
    valor: real("valor").notNull(),
    nObservacoes: integer("n_observacoes").notNull(),
    nOportunidades: integer("n_oportunidades").notNull(),
    metodologiaVersao: text("metodologia_versao").notNull(),
    calculadoEm: text("calculado_em").notNull().default(agora),
  },
  (t) => [
    uniqueIndex("posicao_uq").on(
      t.politicoId,
      t.eixoId,
      t.escopo,
      t.legislaturaNumero,
      t.periodoInicio,
      t.periodoFim,
    ),
    index("posicao_eixo_idx").on(t.eixoId, t.escopo, t.legislaturaNumero),
  ],
);

/**
 * Evidência por trás de cada posição — a tabela que sustenta o princípio do
 * projeto.
 *
 * Sem ela, a plataforma exibe um número e pede confiança. Com ela, "por que este
 * político está aqui?" é respondível votação por votação, cada uma com link para
 * a fonte oficial via `votacao.fonteUrl`.
 *
 * `referencia` guarda contra o que o voto foi comparado — "Governo" no eixo 1,
 * a posição majoritária do partido no eixo 2 — para que a conta seja refeita à
 * mão por quem quiser conferir.
 */
export const posicaoEvidencia = sqliteTable(
  "posicao_evidencia",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    posicaoId: integer("posicao_id")
      .notNull()
      .references(() => posicao.id, { onDelete: "cascade" }),
    votacaoId: integer("votacao_id")
      .notNull()
      .references(() => votacao.id, { onDelete: "cascade" }),
    votoId: integer("voto_id").references(() => voto.id, {
      onDelete: "set null",
    }),
    referencia: text("referencia").notNull(),
    concordou: integer("concordou", { mode: "boolean" }).notNull(),
  },
  (t) => [
    uniqueIndex("evidencia_uq").on(t.posicaoId, t.votacaoId),
    index("evidencia_posicao_idx").on(t.posicaoId),
  ],
);

// ---------------------------------------------------------------------------
// 8. Auditoria de coleta
// ---------------------------------------------------------------------------

/**
 * Log de ingestão.
 *
 * Existe porque a API da Câmara apresentou 504 intermitente durante todo o
 * reconhecimento — uma requisição precisou de 6 tentativas (§1.9). Sem registro
 * de tentativas e falhas, uma coleta parcial é indistinguível de uma completa, e
 * lacuna de coleta vira "o deputado não votou" na interface. Num produto de
 * credibilidade, essa confusão é inaceitável.
 */
export const coleta = sqliteTable(
  "coleta",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    fonte: text("fonte", { enum: FONTES }).notNull(),
    recurso: text("recurso").notNull(),
    url: text("url").notNull(),
    iniciadoEm: text("iniciado_em").notNull().default(agora),
    concluidoEm: text("concluido_em"),
    status: text("status", {
      enum: ["ok", "falha", "parcial"],
    }).notNull(),
    httpStatus: integer("http_status"),
    tentativas: integer("tentativas").notNull().default(1),
    registros: integer("registros"),
    erro: text("erro"),
  },
  (t) => [index("coleta_recurso_idx").on(t.recurso, t.iniciadoEm)],
);

// ---------------------------------------------------------------------------
// 9. Relations
// ---------------------------------------------------------------------------

export const politicoRelations = relations(politico, ({ many }) => ({
  identidades: many(identidadeExterna),
  filiacoes: many(filiacao),
  mandatos: many(mandato),
  votos: many(voto),
  discursos: many(discurso),
  posicoes: many(posicao),
}));

export const identidadeExternaRelations = relations(
  identidadeExterna,
  ({ one }) => ({
    politico: one(politico, {
      fields: [identidadeExterna.politicoId],
      references: [politico.id],
    }),
  }),
);

export const partidoRelations = relations(partido, ({ many }) => ({
  aliases: many(partidoAlias),
  filiacoes: many(filiacao),
}));

export const partidoAliasRelations = relations(partidoAlias, ({ one }) => ({
  partido: one(partido, {
    fields: [partidoAlias.partidoId],
    references: [partido.id],
  }),
}));

export const filiacaoRelations = relations(filiacao, ({ one }) => ({
  politico: one(politico, {
    fields: [filiacao.politicoId],
    references: [politico.id],
  }),
  partido: one(partido, {
    fields: [filiacao.partidoId],
    references: [partido.id],
  }),
}));

export const mandatoRelations = relations(mandato, ({ one, many }) => ({
  politico: one(politico, {
    fields: [mandato.politicoId],
    references: [politico.id],
  }),
  legislatura: one(legislatura, {
    fields: [mandato.legislaturaNumero],
    references: [legislatura.numero],
  }),
  exercicios: many(exercicio),
}));

export const exercicioRelations = relations(exercicio, ({ one }) => ({
  mandato: one(mandato, {
    fields: [exercicio.mandatoId],
    references: [mandato.id],
  }),
}));

export const proposicaoRelations = relations(proposicao, ({ many }) => ({
  temas: many(proposicaoTema),
  votacoes: many(votacao),
}));

export const proposicaoTemaRelations = relations(proposicaoTema, ({ one }) => ({
  proposicao: one(proposicao, {
    fields: [proposicaoTema.proposicaoId],
    references: [proposicao.id],
  }),
  tema: one(tema, {
    fields: [proposicaoTema.temaId],
    references: [tema.id],
  }),
}));

export const votacaoRelations = relations(votacao, ({ one, many }) => ({
  orgao: one(orgao, { fields: [votacao.orgaoId], references: [orgao.id] }),
  proposicao: one(proposicao, {
    fields: [votacao.proposicaoId],
    references: [proposicao.id],
  }),
  votos: many(voto),
  orientacoes: many(orientacao),
}));

export const votoRelations = relations(voto, ({ one }) => ({
  votacao: one(votacao, {
    fields: [voto.votacaoId],
    references: [votacao.id],
  }),
  politico: one(politico, {
    fields: [voto.politicoId],
    references: [politico.id],
  }),
  partido: one(partido, {
    fields: [voto.partidoId],
    references: [partido.id],
  }),
}));

export const orientacaoRelations = relations(orientacao, ({ one }) => ({
  votacao: one(votacao, {
    fields: [orientacao.votacaoId],
    references: [votacao.id],
  }),
  partido: one(partido, {
    fields: [orientacao.partidoId],
    references: [partido.id],
  }),
}));

export const discursoRelations = relations(discurso, ({ one }) => ({
  politico: one(politico, {
    fields: [discurso.politicoId],
    references: [politico.id],
  }),
}));

export const eixoRelations = relations(eixo, ({ many }) => ({
  posicoes: many(posicao),
}));

export const posicaoRelations = relations(posicao, ({ one, many }) => ({
  politico: one(politico, {
    fields: [posicao.politicoId],
    references: [politico.id],
  }),
  eixo: one(eixo, { fields: [posicao.eixoId], references: [eixo.id] }),
  evidencias: many(posicaoEvidencia),
}));

export const posicaoEvidenciaRelations = relations(
  posicaoEvidencia,
  ({ one }) => ({
    posicao: one(posicao, {
      fields: [posicaoEvidencia.posicaoId],
      references: [posicao.id],
    }),
    votacao: one(votacao, {
      fields: [posicaoEvidencia.votacaoId],
      references: [votacao.id],
    }),
    voto: one(voto, {
      fields: [posicaoEvidencia.votoId],
      references: [voto.id],
    }),
  }),
);
