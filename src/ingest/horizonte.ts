/**
 * De onde a ingestão incremental deve continuar.
 *
 * Módulo separado de `incremental.ts` por um motivo só: aquele arquivo é um
 * script — executa ao ser importado. Esta lógica precisa ser importável para
 * ser verificada em `npm run db:validar`, contra banco em memória, sem tocar
 * na rede nem no acervo real.
 *
 * O que se decide aqui:
 *
 * 1. até onde **cada etapa** recortada por data já foi varrida;
 * 2. de onde recomeçar (o menor dos horizontes);
 * 3. até onde ir (hoje, limitado pelo fim da legislatura);
 * 4. se ainda há o que coletar.
 */

/** Assinatura mínima de leitura. `DatabaseSync.prepare(sql).get(...p)` satisfaz. */
export type Consulta = (
  sql: string,
  ...params: string[]
) => Record<string, unknown> | undefined;

/**
 * As etapas recortadas por data gravam a janela no nome do recurso, e é isso
 * que torna a auditoria capaz de responder "até onde se **olhou**" — não apenas
 * "o que entrou". Os GLOBs exigem a janela: recurso sem data (formato anterior
 * a esta versão) **não** casa, e a etapa conta como sem cobertura.
 */
const JANELA = "????-??-??..????-??-??";
export const GLOB_VOTACOES = `votacoes ${JANELA}`;
export const GLOB_DISCURSOS = `deputados/*/discursos ${JANELA}`;

/** De onde saiu a data — para que "sem registro" nunca pareça "coletado até". */
export type Origem = "coleta" | "votacao" | "nenhuma";

export interface Horizonte {
  ate: string;
  origem: Origem;
}

export interface Janelas {
  votacoes: Horizonte;
  discursos: Horizonte;
  /** Início da janela de coleta: o menor horizonte. */
  inicio: string;
  /** Fim da janela: hoje, limitado pelo fim da legislatura. */
  fim: string;
  /** Falso quando a cobertura já passou do fim da janela. */
  coletar: boolean;
}

/** Até que data uma etapa foi varrida, segundo `coleta`. */
function horizonteDe(consulta: Consulta, glob: string): string | null {
  const r = consulta(
    `SELECT MAX(substr(recurso, -10)) ate
     FROM coleta
     WHERE status = 'ok' AND recurso GLOB ?`,
    glob,
  );
  // MAX() sobre zero linhas devolve uma linha com NULL, não `undefined`.
  return (r?.ate as string | null) ?? null;
}

export function descobrirJanelas(
  consulta: Consulta,
  leg: { ini: string; fim: string },
  hoje: string,
): Janelas {
  const daColetaVotacoes = horizonteDe(consulta, GLOB_VOTACOES);
  const daColetaDiscursos = horizonteDe(consulta, GLOB_DISCURSOS);

  // Fallback só para votação, e só para banco anterior a esta auditoria:
  // `MAX(votacao.data)` diz onde houve sessão, não até onde se olhou. Impreciso
  // para o lado seguro — revarre o recesso em vez de pular sessão.
  const daVotacao =
    (consulta("SELECT MAX(data) ate FROM votacao")?.ate as string | null) ?? null;

  const votacoes: Horizonte = daColetaVotacoes
    ? { ate: daColetaVotacoes, origem: "coleta" }
    : daVotacao
      ? { ate: daVotacao, origem: "votacao" }
      : { ate: leg.ini, origem: "nenhuma" };

  /**
   * Discurso não tem fallback equivalente: `MAX(discurso.data)` diria onde
   * houve fala, e parlamentar pode passar meses sem discursar. Sem registro na
   * auditoria, assume-se **nenhuma** cobertura — porque a alternativa (herdar o
   * horizonte de votação) é o que produzia a lacuna silenciosa que esta função
   * existe para impedir.
   */
  const discursos: Horizonte = daColetaDiscursos
    ? { ate: daColetaDiscursos, origem: "coleta" }
    : { ate: leg.ini, origem: "nenhuma" };

  // O menor: adiantar qualquer etapa deixaria a atrasada para trás, para sempre.
  const inicio = menor(votacoes.ate, discursos.ate);
  // A legislatura tem fim; pedir além dele traria votação de outra.
  const fim = menor(hoje, leg.fim);

  return { votacoes, discursos, inicio, fim, coletar: inicio <= fim };
}

function menor(a: string, b: string) {
  return a < b ? a : b;
}
