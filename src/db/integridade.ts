/**
 * Invariantes do acervo — estados que a coleta não pode produzir.
 *
 * Diferente de `validar.ts`, que prova que o **schema** responde certo a casos
 * de borda: aqui se pergunta se o **acervo real** está internamente coerente.
 * As duas perguntas se confundem até o dia em que uma coleta interrompida
 * grava meia votação, e aí só esta encontra.
 *
 * Um acervo saudável devolve zero em tudo. Qualquer linha aqui é coleta
 * parcial se passando por completa — o modo de falha que a tabela `coleta`
 * existe para tornar visível (docs/INGESTOR.md § Auditoria).
 */

/** Assinatura mínima de leitura. `DatabaseSync.prepare(sql).all()` satisfaz. */
export type ConsultaTodos = (sql: string) => Record<string, unknown>[];

export interface Invariante {
  nome: string;
  /** Por que este estado é impossível numa coleta completa. */
  porque: string;
  sql: string;
}

export const INVARIANTES: Invariante[] = [
  {
    nome: "votação nominal sem nenhum voto gravado",
    porque:
      "`nominal` é derivado de `votos.length > 0` — se a votação foi marcada " +
      "nominal, os votos existiam na origem. Zero votos gravados significa que " +
      "a escrita foi interrompida depois da linha de `votacao`.",
    sql: `
      SELECT v.id_externo, v.data, v.descricao
      FROM votacao v
      WHERE v.nominal = 1
        AND NOT EXISTS (SELECT 1 FROM voto WHERE votacao_id = v.id)
      ORDER BY v.data`,
  },
  {
    nome: "votação simbólica com voto gravado",
    porque:
      "O inverso da mesma derivação: se há voto, a votação era nominal. " +
      "Indica `nominal` gravado com base numa lista de votos que depois mudou.",
    sql: `
      SELECT v.id_externo, v.data, COUNT(vo.id) votos
      FROM votacao v JOIN voto vo ON vo.votacao_id = v.id
      WHERE v.nominal = 0
      GROUP BY v.id
      ORDER BY v.data`,
  },
  {
    nome: "mesma série de posição apurada em dois períodos",
    porque:
      "Mesma legislatura e mesmo `periodo_inicio` com `periodo_fim` diferentes " +
      "são duas apurações da mesma série — a antiga está obsoleta, não " +
      "paralela. Uma UI que consultasse `posicao` sem filtrar por período " +
      "exibiria o parlamentar duas vezes, com números diferentes.",
    sql: `
      SELECT legislatura_numero, periodo_inicio,
             COUNT(DISTINCT periodo_fim) fins,
             GROUP_CONCAT(DISTINCT periodo_fim) quais
      FROM posicao
      GROUP BY legislatura_numero, periodo_inicio
      HAVING fins > 1`,
  },
  {
    nome: "posição sem nenhuma evidência",
    porque:
      "Toda posição decompõe-se em evidência votação por votação (§2 do " +
      "CHECKPOINT). Posição sem evidência é número sem como ser auditado — " +
      "exatamente o que o projeto proíbe exibir.",
    sql: `
      SELECT p.id, p.politico_id, p.eixo_id, p.escopo
      FROM posicao p
      WHERE NOT EXISTS (SELECT 1 FROM posicao_evidencia WHERE posicao_id = p.id)`,
  },
];

export interface Achado {
  invariante: Invariante;
  linhas: Record<string, unknown>[];
}

/** Devolve só o que violou. Lista vazia = acervo coerente. */
export function conferirIntegridade(consultar: ConsultaTodos): Achado[] {
  const achados: Achado[] = [];
  for (const invariante of INVARIANTES) {
    const linhas = consultar(invariante.sql);
    if (linhas.length) achados.push({ invariante, linhas });
  }
  return achados;
}
