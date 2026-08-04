/**
 * Cliente HTTP com retry.
 *
 * Não é refinamento: a API da Câmara devolveu 504 intermitente durante todo o
 * reconhecimento, e uma requisição a /votacoes precisou de 6 tentativas para
 * completar (docs/FONTES.md §1.9). Sem retry, o ingestor falha aleatoriamente e
 * grava coleta parcial — que na interface vira "o deputado não votou".
 *
 * A distinção entre erro retriável (5xx, timeout, rede) e definitivo (4xx) é
 * essencial: insistir num 400 só desperdiça tempo e mascara bug de parâmetro.
 */

// NB: sem "parameter properties" (readonly no construtor) — o modo strip-only
// do Node não as suporta, por não serem removíveis sem gerar código.
export class ErroHttp extends Error {
  status: number;
  url: string;
  corpo: string;
  tentativas: number;

  constructor(status: number, url: string, corpo: string, tentativas: number) {
    super(`HTTP ${status} em ${url} (${tentativas} tentativa(s)): ${corpo.slice(0, 200)}`);
    this.name = "ErroHttp";
    this.status = status;
    this.url = url;
    this.corpo = corpo;
    this.tentativas = tentativas;
  }
}

export interface OpcoesFetch {
  /** Tentativas totais, incluindo a primeira. */
  maxTentativas?: number;
  timeoutMs?: number;
  /** Chamado a cada tentativa falha — usado para auditoria. */
  aoFalhar?: (tentativa: number, motivo: string) => void;
}

const PADRAO = { maxTentativas: 8, timeoutMs: 60_000 };

const dormir = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Backoff exponencial com jitter, teto de 30s. */
function espera(tentativa: number): number {
  const base = Math.min(1000 * 2 ** (tentativa - 1), 30_000);
  return base * (0.5 + Math.random() * 0.5);
}

export async function buscarJson<T>(
  url: string,
  opcoes: OpcoesFetch = {},
): Promise<{ dados: T; tentativas: number }> {
  const { maxTentativas, timeoutMs } = { ...PADRAO, ...opcoes };
  let ultimoMotivo = "";
  let ultimoStatus = 0;

  for (let tentativa = 1; tentativa <= maxTentativas; tentativa++) {
    try {
      const r = await fetch(url, {
        headers: { Accept: "application/json", "User-Agent": UA },
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (r.ok) {
        return { dados: (await r.json()) as T, tentativas: tentativa };
      }

      ultimoStatus = r.status;
      const corpo = await r.text().catch(() => "");

      // 4xx é definitivo — exceto 429, que é excesso de requisições
      if (r.status >= 400 && r.status < 500 && r.status !== 429) {
        throw new ErroHttp(r.status, url, corpo, tentativa);
      }

      ultimoMotivo = `HTTP ${r.status}`;
      opcoes.aoFalhar?.(tentativa, ultimoMotivo);

      const retryAfter = Number(r.headers.get("retry-after"));
      if (tentativa < maxTentativas) {
        await dormir(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : espera(tentativa),
        );
      }
    } catch (e) {
      if (e instanceof ErroHttp) throw e; // definitivo: não insistir
      ultimoMotivo = (e as Error).name === "TimeoutError" ? "timeout" : (e as Error).message;
      opcoes.aoFalhar?.(tentativa, ultimoMotivo);
      if (tentativa < maxTentativas) await dormir(espera(tentativa));
    }
  }

  throw new ErroHttp(ultimoStatus, url, ultimoMotivo, maxTentativas);
}

const UA = "BussolaCivica/0.1 (+projeto civico de dados abertos)";

/**
 * Percorre um endpoint paginado da Câmara até esgotar.
 *
 * O limite de `itens` varia por endpoint — 100 em /votacoes, 1000 em /deputados
 * (§1.3). Passe o valor correto; enviar mais é ignorado silenciosamente, o que
 * torna o bug invisível.
 */
export async function buscarPaginado<T>(
  montarUrl: (pagina: number) => string,
  itensPorPagina: number,
  opcoes: OpcoesFetch = {},
): Promise<{ dados: T[]; tentativas: number }> {
  const todos: T[] = [];
  let tentativas = 0;
  for (let pagina = 1; ; pagina++) {
    const r = await buscarJson<{ dados: T[] }>(montarUrl(pagina), opcoes);
    tentativas += r.tentativas;
    const lote = r.dados.dados ?? [];
    todos.push(...lote);
    if (lote.length < itensPorPagina) break;
    if (pagina > 200) throw new Error(`paginação sem fim em ${montarUrl(1)}`);
  }
  return { dados: todos, tentativas };
}

/** Divide um intervalo em janelas de no máximo `meses` — /votacoes rejeita >3 (§1.3). */
export function janelas(
  inicio: string,
  fim: string,
  meses = 3,
): Array<{ inicio: string; fim: string }> {
  const out: Array<{ inicio: string; fim: string }> = [];
  const dFim = new Date(`${fim}T00:00:00Z`);
  let cursor = new Date(`${inicio}T00:00:00Z`);

  while (cursor <= dFim) {
    const proximo = new Date(cursor);
    proximo.setUTCMonth(proximo.getUTCMonth() + meses);
    proximo.setUTCDate(proximo.getUTCDate() - 1);
    const janelaFim = proximo > dFim ? dFim : proximo;
    out.push({
      inicio: cursor.toISOString().slice(0, 10),
      fim: janelaFim.toISOString().slice(0, 10),
    });
    cursor = new Date(janelaFim);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}
