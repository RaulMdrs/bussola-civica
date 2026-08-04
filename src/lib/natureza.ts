/**
 * Natureza da votação: o que estava efetivamente em jogo.
 *
 * POR QUE SEPARAR
 *
 * 86 das 154 votações nominais do 1º sem/2025 (56%) são sobre **requerimentos**
 * — urgência, retirada de pauta, adiamento, encerramento de discussão. Votar a
 * urgência de um projeto não é votar o projeto: mede disciplina de pauta e
 * estratégia regimental, não concordância com o conteúdo.
 *
 * Misturar as duas coisas num único índice produz um número que não corresponde
 * a nenhuma pergunta que o cidadão faria.
 *
 * COMO
 *
 * Igual às demais interpretações do projeto: só campos oficiais, regra explícita
 * e versionada, e o valor é persistido para ser auditável e revisável sem nova
 * coleta.
 *
 * Dois sinais, combinados por OR:
 *   1. `descricao` — texto padronizado pela própria Câmara;
 *   2. `objeto_votado_id <> proposicao_id` — o objeto formal é um requerimento
 *      separado da matéria.
 *
 * Medição do cruzamento nas 154 nominais: descrição sozinha captura as 86
 * (14 com ambos os sinais, 72 só por descrição); o id não captura nenhuma
 * adicional. A descrição é o sinal dominante — o id entra como reforço para
 * casos que a redação não cubra.
 */

export const NATUREZA_VERSAO = "2026-08-04.1";

export const NATUREZAS_VOTACAO = ["merito", "procedimental", "formal"] as const;
export type NaturezaVotacao = (typeof NATUREZAS_VOTACAO)[number];

/**
 * Requerimento como objeto da votação.
 *
 * Cobre "Aprovado/Rejeitado o Requerimento…" e variações de gênero/número.
 * Ancorado no início da descrição de propósito: "Aprovado o Projeto de Lei nº
 * 4.187, que atende a requerimento…" não é votação de requerimento.
 */
const DESCRICAO_REQUERIMENTO =
  /^(?:aprovad|rejeitad|retirad|prejudicad)[oa]s?\b[^.]{0,40}?\brequerimento/i;

/**
 * Ato meramente formal — não expressa posição sobre a matéria.
 *
 * "Redação Final" é a consolidação do texto já aprovado. Votar contra costuma
 * ser gesto simbólico ou correção técnica, não divergência de mérito.
 */
const DESCRICAO_FORMAL = /reda[çc][ãa]o final/i;

export function classificarNatureza(
  descricao: string | null | undefined,
  objetoVotadoId: number | null,
  proposicaoId: number | null,
): NaturezaVotacao {
  const d = (descricao ?? "").trim();

  if (DESCRICAO_FORMAL.test(d)) return "formal";
  if (DESCRICAO_REQUERIMENTO.test(d)) return "procedimental";

  // Reforço: objeto formalmente votado difere da matéria de fundo.
  if (objetoVotadoId !== null && proposicaoId !== null && objetoVotadoId !== proposicaoId) {
    return "procedimental";
  }
  return "merito";
}
