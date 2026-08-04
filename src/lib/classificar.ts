/**
 * Classificação de discursos por natureza do ato parlamentar.
 *
 * PROPÓSITO E LIMITE
 *
 * Filtrar fala de político é julgamento editorial, e este projeto proíbe
 * julgamento próprio não rastreável. Então a classificação obedece a três
 * restrições:
 *
 *   1. Só usa campos OFICIAIS (`tipoDiscurso` da Câmara + padrão do sumário
 *      redigido pela própria Casa). Não infere relevância a partir do conteúdo,
 *      não usa limiar de tamanho, não interpreta mérito político.
 *   2. Classifica, NUNCA exclui. O discurso permanece no banco; a interface
 *      decide o que destacar, e deve oferecer o acervo completo.
 *   3. Na dúvida, é substantivo. Esconder fala política é erro pior que exibir
 *      registro protocolar.
 *
 * A versão da regra é gravada em cada linha, para que a decisão seja auditável
 * e revisível sem recoletar nada.
 */

export const CLASSIFICACAO_VERSAO = "2026-08-04.4";

export const CATEGORIAS_DISCURSO = [
  "orientacao_voto",
  "registro_presenca",
  "substantivo",
] as const;

export type CategoriaDiscurso = (typeof CATEGORIAS_DISCURSO)[number];

/**
 * Orientação de bancada registrada como fala "pela ordem".
 *
 * Exige os DOIS campos: `tipoDiscurso === "PELA ORDEM"` E sumário de orientação.
 * A conjunção não é decorativa — 3 discursos com sumário "orientou a bancada"
 * são do tipo COMO LÍDER e têm 3.103 caracteres de média (contra 866 dos "pela
 * ordem"): são pronunciamentos de liderança que apenas mencionam a orientação.
 * Filtrar só pelo sumário descartaria esses.
 *
 * Justificativa objetiva para separar: o conteúdo informativo — como a bancada
 * orientou — já está capturado de forma estruturada na tabela `orientacao`,
 * ligada à votação. Aqui é registro em prosa do mesmo fato.
 */
const ORIENTACAO_SUMARIO = /orientou a bancada/i;

/**
 * Registro protocolar de presença ou visita.
 *
 * Regex deliberadamente estreito: casa "registrou/saudou a presença|visita",
 * e nada além. Formas próximas com conteúdo político — "registrou o protesto
 * dos produtores rurais", "registrou apoio ao requerimento de CPI", "saudou os
 * estudantes presentes e lamentou a situação do Direito no Brasil" — NÃO casam,
 * e permanecem substantivas. Foi por isso que o filtro não usa só o verbo.
 */
const PRESENCA_SUMARIO =
  /^(?:o|a)\s+deputad[oa],?\s+(?:registrou|saudou)\s+(?:a|as|o|os)?\s*(?:presen[çc]a|visita)\b/i;

/**
 * Salvaguarda contra falso positivo: a fala teve MAIS de um ato.
 *
 * Os sumários da Câmara seguem uma estrutura estável: a primeira sentença
 * descreve o ato principal — e embute a ementa do projeto votado —, e as
 * sentenças seguintes descrevem atos adicionais do parlamentar.
 *
 * O caso que motivou esta regra:
 *
 *   "registrou a presença da Vereadora Cátina Monteiro […] para o Município.
 *    Em seguida, fez um apelo em defesa dos combatentes da missão de paz em
 *    Suez […] Criticou ainda o veto presidencial, derrubado pelo Congresso […]"
 *
 * Abre como registro protocolar e termina em cobrança ao Governo Federal.
 *
 * Por que só as sentenças SEGUINTES são testadas: a primeira contém a ementa do
 * projeto, e ementa é descrição da proposição, não fala do parlamentar. Testar o
 * sumário inteiro fazia "requerimento que solicita o encerramento da discussão"
 * parecer posicionamento — e devolvia ao perfil justamente a orientação ritual
 * que se queria separar.
 */
const ATO_SUBSTANTIVO =
  /\b(?:re)?(critic|defend|denunci|cobr|apel|lament|alert|reivindic|protest|repudi|question|reclam|manifest|exig|condena|comemor|celebr|homenage|coment|afirm|declar|destac|anunci|pediu|elogi|discurs|saud|parabeniz|enaltec|lembr|iter|prop[ôo]s)/i;

/** Divide em sentenças: ponto seguido de maiúscula. "art. 4º" e "nº 12" não quebram. */
function sentencasSeguintes(sumario: string): string {
  const partes = sumario.split(/\.\s+(?=[A-ZÀ-Ú])/);
  return partes.slice(1).join(" ");
}

export function classificarDiscurso(
  tipoDiscurso: string | null | undefined,
  sumario: string | null | undefined,
): { categoria: CategoriaDiscurso; relevante: boolean } {
  const tipo = (tipoDiscurso ?? "").trim().toUpperCase();
  const sum = (sumario ?? "").trim();

  const ritual =
    (tipo === "PELA ORDEM" && ORIENTACAO_SUMARIO.test(sum)) ||
    PRESENCA_SUMARIO.test(sum);

  // Ato ritual acompanhado de posicionamento em sentença posterior é substantivo.
  if (ritual && ATO_SUBSTANTIVO.test(sentencasSeguintes(sum))) {
    return { categoria: "substantivo", relevante: true };
  }
  if (tipo === "PELA ORDEM" && ORIENTACAO_SUMARIO.test(sum)) {
    return { categoria: "orientacao_voto", relevante: false };
  }
  if (PRESENCA_SUMARIO.test(sum)) {
    return { categoria: "registro_presenca", relevante: false };
  }
  return { categoria: "substantivo", relevante: true };
}
