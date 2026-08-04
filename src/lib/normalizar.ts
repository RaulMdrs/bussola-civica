/**
 * Normalizações entre fontes.
 *
 * Normalizar é interpretar. Toda função aqui preserva o valor original no banco
 * (ver `voto.tipo_voto_original`) e sinaliza o que não soube classificar, em vez
 * de escolher um default silencioso — classificar errado o voto de um
 * parlamentar real é o pior defeito possível neste projeto.
 */

import type { VOTO_NORMALIZADO } from "../db/schema.ts";

export type VotoNormalizado = (typeof VOTO_NORMALIZADO)[number];

/** Só `sim`/`nao` entram em cálculo de posição na Fase 0. */
export const COMPUTAVEIS: ReadonlySet<VotoNormalizado> = new Set(["sim", "nao"]);

/** Câmara (§1.5) — os 5 valores observados em 58.724 votos do 1º sem/2025. */
const CAMARA: Record<string, VotoNormalizado> = {
  "Sim": "sim",
  "Não": "nao",
  "Abstenção": "abstencao",
  "Obstrução": "obstrucao",
  "Artigo 17": "presidente",
};

/** Senado (§2.4) — vocabulário distinto e mais extenso que o da Câmara. */
const SENADO: Record<string, VotoNormalizado> = {
  "Sim": "sim",
  "Não": "nao",
  "Abstenção": "abstencao",
  "Presidente (art. 51 RISF)": "presidente",
  "LS": "ausente",   // licença saúde
  "MIS": "ausente",  // missão
  "NCom": "ausente", // não compareceu
  "LP": "ausente",   // licença particular
  "NA": "ausente",
  "LAP": "ausente",
  "AP": "ausente",
};

/** Códigos que confirmam presença sem revelar a posição, em votação secreta. */
const SIGILOSOS = new Set(["Votou", "P-NRV"]);

export interface ResultadoVoto {
  voto: VotoNormalizado;
  computavel: boolean;
  /** true quando o código não é conhecido — exige revisão humana. */
  desconhecido: boolean;
}

export function normalizarVoto(
  original: string,
  casa: "camara" | "senado",
  votacaoSecreta = false,
): ResultadoVoto {
  const bruto = original.trim();

  if (SIGILOSOS.has(bruto)) {
    // Em votação secreta a API confirma que votou, mas não como (§2.4).
    // Fora dela, "P-NRV" é presença sem registro — ausência de posição.
    const voto: VotoNormalizado = votacaoSecreta ? "sigiloso" : "ausente";
    return { voto, computavel: false, desconhecido: false };
  }

  const tabela = casa === "camara" ? CAMARA : SENADO;
  const voto = tabela[bruto];
  if (!voto) {
    return { voto: "ausente", computavel: false, desconhecido: true };
  }
  return { voto, computavel: COMPUTAVEIS.has(voto), desconhecido: false };
}

/** Orientação de bancada usa o mesmo vocabulário de voto; "" = liberado (§1.6). */
export function normalizarOrientacao(
  original: string | null | undefined,
): { orientacao: VotoNormalizado | null; liberado: boolean } {
  const bruto = (original ?? "").trim();
  if (!bruto) return { orientacao: null, liberado: true };
  const voto = CAMARA[bruto];
  return { orientacao: voto ?? null, liberado: false };
}

/** 11 dígitos com zeros à esquerda — ambas as fontes omitem zeros (§3.4). */
export function normalizarCpf(cpf: string | number | null | undefined): string | null {
  if (cpf === null || cpf === undefined) return null;
  const so = String(cpf).replace(/\D/g, "");
  if (!so) return null;
  return so.padStart(11, "0");
}

/**
 * Grafias divergentes da mesma legenda entre fontes.
 *
 * Caso concreto: TSE grafa "PC do B", Câmara grafa "PCdoB" (§3.4). Sem isto o
 * cruzamento reporta troca de partido que não houve.
 */
const ALIASES: Record<string, string> = {
  "PC DO B": "PCdoB",
  "PCDOB": "PCdoB",
  "SOLIDARIED": "SOLIDARIEDADE",
  "REPUBLICAN": "REPUBLICANOS",
};

export function normalizarSigla(sigla: string): string {
  const limpa = sigla.trim().replace(/\s+/g, " ");
  return ALIASES[limpa.toUpperCase()] ?? limpa;
}

/** "2025-06-26T12:00:11" ou "2025-06-26" → ISO estável para ordenação textual. */
export function normalizarData(v: string | null | undefined): string | null {
  if (!v) return null;
  return v.trim().replace(" ", "T");
}
