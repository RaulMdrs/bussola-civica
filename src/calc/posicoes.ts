/**
 * Cálculo das posições nos dois eixos da Fase 0.
 *
 * Regras que não podem ser relaxadas (docs/FONTES.md §6):
 *   - só votações nominais e não secretas entram;
 *   - só votos `sim`/`nao` são computáveis;
 *   - o denominador é o nº de votações ocorridas DENTRO do exercício do
 *     parlamentar — sem isso, suplente vira "ausente contumaz" (§1.8);
 *   - toda posição grava suas evidências, votação por votação, para que a
 *     pergunta "por que este político está aqui?" seja respondível.
 */

import { sql } from "drizzle-orm";
import type { Banco, Consultar } from "../db/client.ts";
import * as s from "../db/schema.ts";

export const METODOLOGIA_VERSAO = "2026-08-12.1";

/**
 * Escopos de apuração.
 *
 * `merito` é o principal — é o que o cidadão entende por "posição do
 * parlamentar". `procedimental` mede disciplina de pauta e estratégia
 * regimental: legítimo, informativo, e uma coisa diferente.
 *
 * Antes desta versão os dois eram somados num índice único. Como 56% das
 * votações nominais são procedimentais, o número resultante não respondia a
 * nenhuma pergunta específica. Votações `formal` (redação final) ficam fora dos
 * dois escopos: consolidam texto já aprovado, não expressam posição.
 */
export const ESCOPOS = ["merito", "procedimental", "unico"] as const;
export type Escopo = (typeof ESCOPOS)[number];

export type Casa = "camara" | "senado";

interface Periodo {
  legislatura: number;
  inicio: string;
  fim: string;
  casa: Casa;
}

/**
 * Um recorte de apuração: o escopo gravado e o filtro de natureza que o define.
 *
 * `natureza: null` significa **sem filtro**, não "natureza nula" — é o caso do
 * Senado, cujas votações entram com `natureza` NULL porque a regra de
 * classificação foi calibrada e testada contra descrição da Câmara. Aplicá-la
 * ao texto do Senado devolve `merito` para as 114 votações abertas, inclusive
 * as 9 que mencionam requerimento: afirmaria mérito onde não se mediu.
 */
interface Recorte {
  escopo: Escopo;
  natureza: "merito" | "procedimental" | null;
}

/**
 * O que cada casa sustenta.
 *
 * **O Senado não tem eixo 1.** Não existe orientação de bancada nos dados
 * abertos — nem no endpoint de votação, nem em endpoint próprio: nove
 * candidatos testados, todos 404, e busca por nome de campo numa resposta de
 * 2,5 MB não achou nada. Sem referência oficial não há contra o que comparar, e
 * escolher uma seria rotular por conta própria.
 *
 * O recorte por tema também não se aplica: depende de `proposicao_tema`, que
 * vem da classificação da Câmara.
 */
const REGIME: Record<Casa, { eixos: readonly string[]; recortes: Recorte[]; temas: boolean }> = {
  camara: {
    eixos: ["alinhamento_governo", "coesao_partidaria"],
    recortes: [
      { escopo: "merito", natureza: "merito" },
      { escopo: "procedimental", natureza: "procedimental" },
    ],
    temas: true,
  },
  senado: {
    eixos: ["coesao_partidaria"],
    recortes: [{ escopo: "unico", natureza: null }],
    temas: false,
  },
};

/**
 * Onde a metodologia está publicada.
 *
 * Precisa ser **absoluta**: o valor vai para `eixo.metodologia_url`, que a
 * interface exibe como "como calculamos". Um caminho relativo de repositório
 * (`docs/MODELO-DADOS.md#...`, como era antes) só resolve para quem tem o
 * checkout — e a metodologia pública é requisito para exibir posição, não
 * nota de rodapé.
 *
 * `VIVA` sempre descreve a versão em vigor. Números antigos apontam para o
 * documento congelado da versão que os produziu: cada linha de `posicao` grava
 * `metodologia_versao`, e `urlDaVersao()` resolve o endereço a partir dela.
 * Sem isso a rastreabilidade quebraria na primeira mudança de regra.
 */
const METODOLOGIA = {
  VIVA: "https://raulmdrs.github.io/bussola-civica/metodologia/",
  ARQUIVO: "https://raulmdrs.github.io/bussola-civica/metodologia/versoes",
} as const;

/**
 * Endereço do documento que explica um número já calculado.
 *
 * Versão arquivada mora num **diretório** (`versoes/2026-08-04.2/index.md`), não
 * num arquivo solto. A URL sai com barra final e não depende de como o Jekyll
 * resolve extensão em nome com ponto — e nome de versão é todo ponto.
 */
export function urlDaVersao(versao: string): string {
  return versao === METODOLOGIA_VERSAO
    ? METODOLOGIA.VIVA
    : `${METODOLOGIA.ARQUIVO}/${versao}/`;
}

/**
 * Definição dos eixos.
 *
 * Os rótulos vivem no dado, não no componente de UI. O risco deste projeto não
 * está no cálculo — está no rótulo: o mesmo número vira "alinhamento com o
 * governo" ou "esquerda/direita" conforme quem escreve a legenda, e só o
 * primeiro é defensável (§1.6).
 */
const EIXOS = [
  {
    chave: "alinhamento_governo",
    nomeExibicao: "Alinhamento com o governo federal",
    descricao:
      "Proporção de votações nominais em que o parlamentar votou conforme a " +
      "orientação da liderança do Governo. Apurado em dois escopos: no MÉRITO " +
      "das matérias e em votações PROCEDIMENTAIS (requerimentos de urgência, " +
      "retirada de pauta, adiamento). Os dois medem coisas diferentes — o " +
      "segundo é disciplina de pauta, não concordância de conteúdo. Nenhum é " +
      "medida de ideologia: um partido muda de lado sem mudar de programa.",
    rotuloMin: "Vota contra a orientação do governo",
    rotuloMax: "Vota conforme a orientação do governo",
  },
  {
    chave: "coesao_partidaria",
    nomeExibicao: "Coesão com o próprio partido",
    descricao:
      "Proporção de votações nominais em que o parlamentar votou com a maioria " +
      "dos demais deputados do seu partido, excluído o próprio voto da apuração. " +
      "Apurado separadamente no mérito e em votações procedimentais. Mede " +
      "comportamento, não ideologia: dois parlamentares de partidos opostos " +
      "com 100% de coesão ocupam o mesmo ponto neste eixo.",
    rotuloMin: "Vota contra a maioria do partido",
    rotuloMax: "Vota com a maioria do partido",
  },
] as const;

export async function garantirEixos(db: Banco): Promise<Map<string, number>> {
  for (const e of EIXOS) {
    await db
      .insert(s.eixo)
      .values({
        chave: e.chave,
        nomeExibicao: e.nomeExibicao,
        descricao: e.descricao,
        rotuloMin: e.rotuloMin,
        rotuloMax: e.rotuloMax,
        metodologiaVersao: METODOLOGIA_VERSAO,
        metodologiaUrl: METODOLOGIA.VIVA,
      })
      .onConflictDoUpdate({
        target: s.eixo.chave,
        set: {
          nomeExibicao: e.nomeExibicao,
          descricao: e.descricao,
          metodologiaVersao: METODOLOGIA_VERSAO,
          metodologiaUrl: METODOLOGIA.VIVA,
        },
      });
  }
  const linhas = await db.select({ id: s.eixo.id, chave: s.eixo.chave }).from(s.eixo);
  return new Map(linhas.map((l) => [l.chave, l.id]));
}

interface LinhaCalculo {
  politico_id: number;
  concordou: number;
  n: number;
}

interface LinhaEvidencia {
  politico_id: number;
  votacao_id: number;
  voto_id: number;
  referencia: string;
  concordou: number;
}

/**
 * Restringe o universo de votações a um tema. `null` = todas as matérias.
 *
 * `EXISTS` e não `JOIN`, mas **não** porque um `JOIN` duplicaria linha aqui:
 * com `tema_id` fixado e `proposicao_tema_uq` sobre `(proposicao_id, tema_id)`,
 * cada votação casa no máximo uma vez, e as duas formas dariam o mesmo `n`.
 * (Foi o que a mutação mostrou quando este comentário afirmava o contrário.)
 *
 * O motivo é outro, e é de robustez: `proposicao_tema` é N:N — 646 proposições,
 * 906 vínculos —, e a semântica pretendida é *filtrar*, não *combinar*. No dia
 * em que o recorte aceitar um conjunto de temas, ou entrar outra tabela N:N no
 * caminho, o `EXISTS` continua correto e o `JOIN` passa a multiplicar em
 * silêncio. Expressar a intenção evita o defeito antes de ele existir.
 *
 * Devolve o fragmento e o parâmetro juntos porque a ordem posicional importa:
 * o fragmento é inserido logo após o `BETWEEN` de datas em todas as consultas.
 */
/**
 * Filtro de natureza. `natureza: null` no recorte = **sem cláusula nenhuma**.
 *
 * Não é `natureza IS NULL`: a diferença importa. O Senado grava `natureza` NULL
 * e apura sobre todas as suas votações abertas; se um dia a regra for validada
 * para o texto do Senado, o recorte ganha filtro sem mudar mais nada aqui.
 */
function filtroNatureza(r: Recorte): { sql: string; params: string[] } {
  return r.natureza === null
    ? { sql: "", params: [] }
    : { sql: "AND v.natureza = ?", params: [r.natureza] };
}

function filtroTema(temaId: number | null): { sql: string; params: number[] } {
  if (temaId === null) return { sql: "", params: [] };
  return {
    sql: `AND EXISTS (SELECT 1 FROM proposicao_tema pt
                      WHERE pt.proposicao_id = v.proposicao_id AND pt.tema_id = ?)`,
    params: [temaId],
  };
}

/**
 * Eixo 1 — comparação com a orientação da liderança do Governo.
 *
 * `liberado = 0` é essencial: liberação de bancada não é orientação, e tratá-la
 * como tal inventaria concordância onde não houve instrução (§1.6).
 */
function calcularAlinhamentoGoverno(
  consultar: Consultar,
  p: Periodo,
  r: Recorte,
  temaId: number | null = null,
) {
  const t = filtroTema(temaId);
  const nat = filtroNatureza(r);
  const evidencias = consultar<LinhaEvidencia>(
    `SELECT vt.politico_id, vt.votacao_id, vt.id AS voto_id,
            'Orientação do Governo: ' || o.orientacao AS referencia,
            CASE WHEN vt.voto = o.orientacao THEN 1 ELSE 0 END AS concordou
     FROM voto vt
     JOIN votacao v     ON v.id = vt.votacao_id
                       AND v.nominal = 1 AND v.secreta = 0
                       AND v.casa = ?
                       ${nat.sql}
                       AND v.data BETWEEN ? AND ?
                       ${t.sql}
     JOIN orientacao o  ON o.votacao_id = v.id
                       AND o.sigla_bruta = 'Governo'
                       AND o.liberado = 0
                       AND o.orientacao IN ('sim','nao')
     WHERE vt.computavel = 1`,
    p.casa,
    ...nat.params,
    p.inicio,
    p.fim,
    ...t.params,
  );
  return agregar(evidencias);
}

/**
 * Eixo 2 — coesão com a maioria do próprio partido (§1.6.1).
 *
 * Não sai de `orientacao`: 11 dos 12 partidos do RS nunca orientam pela própria
 * sigla, orientam por bloco com sigla truncada e sem id resolvível (§1.6).
 *
 * A maioria é apurada EXCLUINDO o voto do parlamentar medido — senão ele ajuda
 * a definir a régua contra a qual está sendo comparado, o que infla a coesão
 * artificialmente em bancadas pequenas.
 *
 * Empate entre os pares (inclusive quando o parlamentar é o único do partido na
 * votação) não gera observação: não há maioria contra a qual comparar.
 */
function calcularCoesaoPartidaria(
  consultar: Consultar,
  p: Periodo,
  r: Recorte,
  temaId: number | null = null,
) {
  const t = filtroTema(temaId);
  const nat = filtroNatureza(r);
  const evidencias = consultar<LinhaEvidencia>(
    `WITH elegiveis AS (
      SELECT vt.id, vt.votacao_id, vt.politico_id, vt.partido_id, vt.voto
      FROM voto vt
      JOIN votacao v ON v.id = vt.votacao_id
                    AND v.nominal = 1 AND v.secreta = 0
                    AND v.casa = ?
                    ${nat.sql}
                    AND v.data BETWEEN ? AND ?
                    ${t.sql}
      WHERE vt.computavel = 1 AND vt.partido_id IS NOT NULL
    ),
    cont AS (
      SELECT votacao_id, partido_id,
             SUM(CASE WHEN voto = 'sim' THEN 1 ELSE 0 END) AS sim,
             SUM(CASE WHEN voto = 'nao' THEN 1 ELSE 0 END) AS nao
      FROM elegiveis
      GROUP BY votacao_id, partido_id
    ),
    pares AS (
      SELECT e.id AS voto_id, e.votacao_id, e.politico_id, e.voto,
             c.sim - (CASE WHEN e.voto = 'sim' THEN 1 ELSE 0 END) AS sim_pares,
             c.nao - (CASE WHEN e.voto = 'nao' THEN 1 ELSE 0 END) AS nao_pares
      FROM elegiveis e
      JOIN cont c ON c.votacao_id = e.votacao_id AND c.partido_id = e.partido_id
    )
    SELECT politico_id, votacao_id, voto_id,
           'Maioria do partido: ' ||
             (CASE WHEN sim_pares > nao_pares THEN 'sim' ELSE 'nao' END) ||
             ' (' || sim_pares || ' sim / ' || nao_pares || ' não entre os pares)'
             AS referencia,
           CASE WHEN voto = (CASE WHEN sim_pares > nao_pares THEN 'sim' ELSE 'nao' END)
                THEN 1 ELSE 0 END AS concordou
    FROM pares
    WHERE sim_pares <> nao_pares`,
    p.casa,
    ...nat.params,
    p.inicio,
    p.fim,
    ...t.params,
  );
  return agregar(evidencias);
}

function agregar(evidencias: LinhaEvidencia[]) {
  const porPolitico = new Map<number, LinhaCalculo>();
  for (const e of evidencias) {
    let acc = porPolitico.get(e.politico_id);
    if (!acc) {
      acc = { politico_id: e.politico_id, concordou: 0, n: 0 };
      porPolitico.set(e.politico_id, acc);
    }
    acc.n++;
    acc.concordou += e.concordou;
  }
  return { porPolitico, evidencias };
}

/**
 * Oportunidades: votações elegíveis ocorridas dentro do exercício efetivo.
 *
 * É o denominador honesto (§1.8). Sem ele, quem assumiu em abril é comparado
 * contra o mesmo total de quem serviu o período inteiro.
 */
function oportunidadesPorPolitico(
  consultar: Consultar,
  p: Periodo,
  r: Recorte,
  temaId: number | null = null,
) {
  const t = filtroTema(temaId);
  const nat = filtroNatureza(r);
  const linhas = consultar<{ politico_id: number; n: number }>(
    `SELECT m.politico_id, COUNT(DISTINCT v.id) AS n
     FROM mandato m
     JOIN exercicio e ON e.mandato_id = m.id
     JOIN votacao v   ON v.nominal = 1 AND v.secreta = 0
                     AND v.casa = ?
                     ${nat.sql}
                     AND v.data BETWEEN ? AND ?
                     ${t.sql}
                     AND v.data >= e.data_inicio
                     AND (e.data_fim IS NULL OR v.data <= e.data_fim)
     WHERE m.legislatura_numero = ?
     GROUP BY m.politico_id`,
    p.casa,
    ...nat.params,
    p.inicio,
    p.fim,
    ...t.params,
    p.legislatura,
  );
  return new Map(linhas.map((l) => [l.politico_id, l.n]));
}

export async function calcularPosicoes(
  db: Banco,
  consultar: Consultar,
  p: Periodo,
  log: (m: string) => void = console.log,
  /** Injetável só para teste: fixture não tem como reunir 30 votações por tema. */
  limiarTema: number = LIMIAR_TEMA,
) {
  const eixos = await garantirEixos(db);

  // só quem está no recorte recebe posição publicável
  const doRecorte = new Set(
    consultar<{ id: number }>(
      `SELECT id FROM politico WHERE perfil_completo = 1`,
    ).map((r) => r.id),
  );

  const regime = REGIME[p.casa];
  const calculos = [
    { chave: "alinhamento_governo", fn: calcularAlinhamentoGoverno },
    { chave: "coesao_partidaria", fn: calcularCoesaoPartidaria },
  ].filter((c) => regime.eixos.includes(c.chave));

  /**
   * Recortes a apurar: as matérias todas, mais um por tema elegível.
   *
   * **Tema não é eixo novo** — é o mesmo eixo sobre um universo menor. E não é
   * posição *sobre* o tema: a origem diz que a proposição trata de meio
   * ambiente, não se aprová-la protege ou desprotege. Essa direção não existe
   * em fonte oficial, e inventá-la seria rotular por conta própria.
   *
   * **Só no mérito.** O recorte temático responde *onde* o parlamentar diverge;
   * "onde" só faz sentido sobre o conteúdo. Disciplina de pauta por tema seria
   * um número sobre poucas votações respondendo a pergunta nenhuma.
   */
  const temas = regime.temas ? temasElegiveis(consultar, p, limiarTema) : [];
  const recortes: { temaId: number | null; nome: string; recortes: Recorte[] }[] = [
    { temaId: null, nome: "todas as matérias", recortes: regime.recortes },
    ...temas.map((t) => ({
      temaId: t.id,
      nome: t.nome,
      recortes: [{ escopo: "merito", natureza: "merito" }] as Recorte[],
    })),
  ];
  if (regime.temas) log(`  ${temas.length} temas elegíveis (>= ${limiarTema} votações de mérito)`);

  for (const recorte of recortes) {
  for (const r of recorte.recortes) {
    const escopo = r.escopo;
    const oportunidades = oportunidadesPorPolitico(consultar, p, r, recorte.temaId);

    for (const c of calculos) {
      const eixoId = eixos.get(c.chave)!;
      const { porPolitico, evidencias } = c.fn(consultar, p, r, recorte.temaId);

      /**
       * Substitui a apuração anterior da **mesma série** — mesmo eixo, escopo,
       * legislatura e início de período —, qualquer que fosse o fim. Cascade
       * leva as evidências junto.
       *
       * O `periodo_fim` **não** entra na condição, e isso é deliberado.
       * "Alinhamento na legislatura 57 desde 2023-02-01" é uma série só; o fim
       * é apenas até onde ela foi apurada, e uma apuração mais recente torna a
       * anterior obsoleta, não paralela.
       *
       * Casá-lo tornava o recálculo idempotente apenas dentro do mesmo dia:
       * `ingerir:incremental` rodado em dois dias seguidos gravava dois
       * conjuntos completos, um por `fim`, e o acervo passava a ter o mesmo
       * parlamentar duas vezes. Medido: 124 posições viraram 248 na virada de
       * 2026-08-07 para 2026-08-08.
       *
       * Recorte com outro `periodo_inicio` (um semestre, por exemplo) é outra
       * série e continua coexistindo — é o caso legítimo.
       */
      // O recorte temático entra na condição: apagar por eixo+escopo sem
      // distinguir o tema faria o cálculo de "todas as matérias" varrer as
      // posições temáticas gravadas logo antes.
      await db.run(sql`
        DELETE FROM posicao
        WHERE eixo_id = ${eixoId}
          AND escopo = ${escopo}
          AND legislatura_numero = ${p.legislatura}
          AND periodo_inicio = ${p.inicio}
          AND ${recorte.temaId === null ? sql`tema_id IS NULL` : sql`tema_id = ${recorte.temaId}`}
      `);

      let gravadas = 0;
      let evidenciasGravadas = 0;
      for (const [politicoId, acc] of porPolitico) {
        if (!doRecorte.has(politicoId)) continue;

        await db.insert(s.posicao).values({
          politicoId,
          eixoId,
          escopo,
          temaId: recorte.temaId,
          legislaturaNumero: p.legislatura,
          periodoInicio: p.inicio,
          periodoFim: p.fim,
          valor: acc.n > 0 ? acc.concordou / acc.n : 0,
          nObservacoes: acc.n,
          nOportunidades: oportunidades.get(politicoId) ?? 0,
          metodologiaVersao: METODOLOGIA_VERSAO,
        });

        const [posicao] = consultar<{ id: number }>(
          `SELECT id FROM posicao
           WHERE politico_id = ? AND eixo_id = ? AND escopo = ?
             AND legislatura_numero = ? AND periodo_inicio = ? AND periodo_fim = ?
             AND tema_id IS ?`,
          politicoId,
          eixoId,
          escopo,
          p.legislatura,
          p.inicio,
          p.fim,
          recorte.temaId,
        );

        const minhas = evidencias.filter((e) => e.politico_id === politicoId);
        for (let i = 0; i < minhas.length; i += 200) {
          await db.insert(s.posicaoEvidencia).values(
            minhas.slice(i, i + 200).map((e) => ({
              posicaoId: posicao!.id,
              votacaoId: e.votacao_id,
              votoId: e.voto_id,
              referencia: e.referencia,
              concordou: Boolean(e.concordou),
            })),
          );
        }
        gravadas++;
        evidenciasGravadas += minhas.length;
      }
      // as evidências calculadas cobrem a casa inteira; só as do recorte são gravadas
      const onde = recorte.temaId === null ? escopo : `${escopo} · ${recorte.nome}`;
      log(
        `  ${c.chave} [${onde}]: ${gravadas} posições, ${evidenciasGravadas} evidências ` +
          `(de ${evidencias.length} calculadas para a casa toda)`,
      );
    }
  }
  }
}

/**
 * Temas com votações de mérito suficientes para sustentar um eixo.
 *
 * O limiar é do **tema**, não do parlamentar: define quais recortes existem.
 * Quantas observações cada parlamentar tem dentro do tema é outra coisa, fica
 * gravada em `n_observacoes` e é exibida ao lado do valor — porque um tema
 * pode ter 40 votações e um suplente ter votado em 3 delas.
 *
 * Dinâmico de propósito: à medida que o acervo cresce, tema novo cruza o
 * limiar e passa a ter eixo, sem edição de código. Contagem só sobe, então
 * nenhum recorte desaparece depois de existir.
 */
const LIMIAR_TEMA = 30;

function temasElegiveis(consultar: Consultar, p: Periodo, limiar: number) {
  return consultar<{ id: number; nome: string; n: number }>(
    `SELECT t.id, t.nome, COUNT(DISTINCT v.id) AS n
     FROM tema t
     JOIN proposicao_tema pt ON pt.tema_id = t.id
     JOIN votacao v ON v.proposicao_id = pt.proposicao_id
                    AND v.nominal = 1 AND v.secreta = 0
                    AND v.natureza = 'merito'
                    AND v.data BETWEEN ? AND ?
     GROUP BY t.id
     HAVING n >= ?
     ORDER BY n DESC`,
    p.inicio,
    p.fim,
    limiar,
  );
}
