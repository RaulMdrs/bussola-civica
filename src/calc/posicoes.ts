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

export const METODOLOGIA_VERSAO = "2026-08-04.2";

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
export const ESCOPOS = ["merito", "procedimental"] as const;
export type Escopo = (typeof ESCOPOS)[number];

interface Periodo {
  legislatura: number;
  inicio: string;
  fim: string;
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
        metodologiaUrl: "docs/MODELO-DADOS.md#os-dois-eixos",
      })
      .onConflictDoUpdate({
        target: s.eixo.chave,
        set: {
          nomeExibicao: e.nomeExibicao,
          descricao: e.descricao,
          metodologiaVersao: METODOLOGIA_VERSAO,
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
 * Eixo 1 — comparação com a orientação da liderança do Governo.
 *
 * `liberado = 0` é essencial: liberação de bancada não é orientação, e tratá-la
 * como tal inventaria concordância onde não houve instrução (§1.6).
 */
function calcularAlinhamentoGoverno(
  consultar: Consultar,
  p: Periodo,
  escopo: Escopo,
) {
  const evidencias = consultar<LinhaEvidencia>(
    `SELECT vt.politico_id, vt.votacao_id, vt.id AS voto_id,
            'Orientação do Governo: ' || o.orientacao AS referencia,
            CASE WHEN vt.voto = o.orientacao THEN 1 ELSE 0 END AS concordou
     FROM voto vt
     JOIN votacao v     ON v.id = vt.votacao_id
                       AND v.nominal = 1 AND v.secreta = 0
                       AND v.natureza = ?
                       AND v.data BETWEEN ? AND ?
     JOIN orientacao o  ON o.votacao_id = v.id
                       AND o.sigla_bruta = 'Governo'
                       AND o.liberado = 0
                       AND o.orientacao IN ('sim','nao')
     WHERE vt.computavel = 1`,
    escopo,
    p.inicio,
    p.fim,
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
  escopo: Escopo,
) {
  const evidencias = consultar<LinhaEvidencia>(
    `WITH elegiveis AS (
      SELECT vt.id, vt.votacao_id, vt.politico_id, vt.partido_id, vt.voto
      FROM voto vt
      JOIN votacao v ON v.id = vt.votacao_id
                    AND v.nominal = 1 AND v.secreta = 0
                    AND v.natureza = ?
                    AND v.data BETWEEN ? AND ?
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
    escopo,
    p.inicio,
    p.fim,
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
  escopo: Escopo,
) {
  const linhas = consultar<{ politico_id: number; n: number }>(
    `SELECT m.politico_id, COUNT(DISTINCT v.id) AS n
     FROM mandato m
     JOIN exercicio e ON e.mandato_id = m.id
     JOIN votacao v   ON v.nominal = 1 AND v.secreta = 0
                     AND v.natureza = ?
                     AND v.data BETWEEN ? AND ?
                     AND v.data >= e.data_inicio
                     AND (e.data_fim IS NULL OR v.data <= e.data_fim)
     WHERE m.legislatura_numero = ?
     GROUP BY m.politico_id`,
    escopo,
    p.inicio,
    p.fim,
    p.legislatura,
  );
  return new Map(linhas.map((l) => [l.politico_id, l.n]));
}

export async function calcularPosicoes(
  db: Banco,
  consultar: Consultar,
  p: Periodo,
  log: (m: string) => void = console.log,
) {
  const eixos = await garantirEixos(db);

  // só quem está no recorte recebe posição publicável
  const doRecorte = new Set(
    consultar<{ id: number }>(
      `SELECT id FROM politico WHERE perfil_completo = 1`,
    ).map((r) => r.id),
  );

  const calculos = [
    { chave: "alinhamento_governo", fn: calcularAlinhamentoGoverno },
    { chave: "coesao_partidaria", fn: calcularCoesaoPartidaria },
  ] as const;

  for (const escopo of ESCOPOS) {
    const oportunidades = oportunidadesPorPolitico(consultar, p, escopo);

    for (const c of calculos) {
      const eixoId = eixos.get(c.chave)!;
      const { porPolitico, evidencias } = c.fn(consultar, p, escopo);

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
      await db.run(sql`
        DELETE FROM posicao
        WHERE eixo_id = ${eixoId}
          AND escopo = ${escopo}
          AND legislatura_numero = ${p.legislatura}
          AND periodo_inicio = ${p.inicio}
      `);

      let gravadas = 0;
      let evidenciasGravadas = 0;
      for (const [politicoId, acc] of porPolitico) {
        if (!doRecorte.has(politicoId)) continue;

        await db.insert(s.posicao).values({
          politicoId,
          eixoId,
          escopo,
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
             AND legislatura_numero = ? AND periodo_inicio = ? AND periodo_fim = ?`,
          politicoId,
          eixoId,
          escopo,
          p.legislatura,
          p.inicio,
          p.fim,
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
      // as evidências calculadas cobrem os 513; só as do recorte são gravadas
      log(
        `  ${c.chave} [${escopo}]: ${gravadas} posições, ${evidenciasGravadas} evidências ` +
          `(de ${evidencias.length} calculadas para toda a Câmara)`,
      );
    }
  }
}
