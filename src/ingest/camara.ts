/**
 * Cliente da API da Câmara dos Deputados.
 *
 * Base e limites documentados em docs/FONTES.md §1. Os dois que mais afetam
 * este arquivo:
 *   - /votacoes aceita janela máxima de 3 meses e `itens` máximo 100;
 *   - /votacoes/{id}/votos NÃO aceita paginação (400 se enviada) e devolve tudo.
 */

import { buscarJson, buscarPaginado, type OpcoesFetch } from "../lib/http.ts";

export const BASE = "https://dadosabertos.camara.leg.br/api/v2";

/** Plenário — obtido de /orgaos?sigla=PLEN (§1.3). */
export const ID_ORGAO_PLENARIO = "180";

export interface DeputadoLista {
  id: number;
  nome: string;
  siglaPartido: string;
  siglaUf: string;
  idLegislatura: number;
  urlFoto: string | null;
  email: string | null;
}

export interface DeputadoDetalhe {
  id: number;
  nomeCivil: string | null;
  cpf: string | null;
  sexo: string | null;
  dataNascimento: string | null;
  dataFalecimento: string | null;
  ufNascimento: string | null;
  municipioNascimento: string | null;
  escolaridade: string | null;
  redeSocial: string[] | null;
  ultimoStatus: {
    nome: string;
    siglaPartido: string | null;
    siglaUf: string;
    idLegislatura: number;
    urlFoto: string | null;
    data: string | null;
    situacao: string | null;
    condicaoEleitoral: string | null;
  };
}

export interface HistoricoItem {
  dataHora: string;
  nome: string | null;
  siglaPartido: string | null;
  siglaUf: string | null;
  idLegislatura: number;
  situacao: string | null;
  condicaoEleitoral: string | null;
  descricaoStatus: string | null;
}

export interface VotacaoLista {
  id: string; // "2381043-91" — alfanumérico, não inteiro (§1.3)
  data: string;
  dataHoraRegistro: string;
  siglaOrgao: string;
  uriOrgao: string | null;
  proposicaoObjeto: string | null;
  uriProposicaoObjeto: string | null;
  descricao: string;
  aprovacao: number | null;
}

export interface VotoApi {
  tipoVoto: string;
  dataRegistroVoto: string | null;
  deputado_: {
    id: number;
    nome: string;
    siglaPartido: string | null;
    siglaUf: string | null;
  };
}

export interface OrientacaoApi {
  orientacaoVoto: string;
  codTipoLideranca: string; // "P" = partido, "B" = bloco/agregado
  siglaPartidoBloco: string;
  codPartidoBloco: number | null;
  uriPartidoBloco: string | null;
}

export interface DiscursoApi {
  dataHoraInicio: string;
  tipoDiscurso: string | null;
  sumario: string | null;
  transcricao: string | null;
  urlTexto: string | null;
  urlAudio: string | null;
  urlVideo: string | null;
}

export interface OrgaoApi {
  id: number;
  sigla: string;
  nome: string;
  tipoOrgao: string | null;
}

export interface TemaApi {
  cod: number;
  nome: string;
}

export interface LegislaturaApi {
  id: number;
  dataInicio: string;
  dataFim: string;
}

// ---------------------------------------------------------------------------

const um = async <T>(url: string, o?: OpcoesFetch) => {
  const r = await buscarJson<{ dados: T }>(url, o);
  return { dados: r.dados.dados, tentativas: r.tentativas, url };
};

export const camara = {
  deputadosPorUf: (uf: string, o?: OpcoesFetch) =>
    um<DeputadoLista[]>(`${BASE}/deputados?siglaUf=${uf}&itens=100&ordem=ASC&ordenarPor=nome`, o),

  deputado: (id: number, o?: OpcoesFetch) =>
    um<DeputadoDetalhe>(`${BASE}/deputados/${id}`, o),

  historico: (id: number, o?: OpcoesFetch) =>
    um<HistoricoItem[]>(`${BASE}/deputados/${id}/historico`, o),

  legislatura: (numero: number, o?: OpcoesFetch) =>
    um<LegislaturaApi>(`${BASE}/legislaturas/${numero}`, o),

  orgaoPorSigla: (sigla: string, o?: OpcoesFetch) =>
    um<OrgaoApi[]>(`${BASE}/orgaos?sigla=${sigla}`, o),

  temas: (o?: OpcoesFetch) =>
    um<TemaApi[]>(`${BASE}/referencias/proposicoes/codTema`, o),

  /** Janela de datas limitada a 3 meses pela origem — use `janelas()` (§1.3). */
  async votacoes(idOrgao: string, inicio: string, fim: string, o?: OpcoesFetch) {
    const r = await buscarPaginado<VotacaoLista>(
      (p) =>
        `${BASE}/votacoes?idOrgao=${idOrgao}&dataInicio=${inicio}&dataFim=${fim}` +
        `&itens=100&pagina=${p}&ordem=ASC&ordenarPor=dataHoraRegistro`,
      100,
      o,
    );
    return { ...r, url: `${BASE}/votacoes?idOrgao=${idOrgao}&dataInicio=${inicio}&dataFim=${fim}` };
  },

  /** Sem paginação: enviar `itens`/`pagina` devolve 400 (§1.3). */
  votos: (idVotacao: string, o?: OpcoesFetch) =>
    um<VotoApi[]>(`${BASE}/votacoes/${idVotacao}/votos`, o),

  orientacoes: (idVotacao: string, o?: OpcoesFetch) =>
    um<OrientacaoApi[]>(`${BASE}/votacoes/${idVotacao}/orientacoes`, o),

  discursos: (id: number, inicio: string, fim: string, o?: OpcoesFetch) =>
    buscarPaginado<DiscursoApi>(
      (p) =>
        `${BASE}/deputados/${id}/discursos?dataInicio=${inicio}&dataFim=${fim}` +
        `&itens=100&pagina=${p}&ordenarPor=dataHoraInicio&ordem=ASC`,
      100,
      o,
    ).then((r) => ({ ...r, url: `${BASE}/deputados/${id}/discursos` })),
};

/** URL pública da votação no portal da Câmara — é o link que o usuário vê. */
export function urlPublicaVotacao(id: string): string {
  return `https://www.camara.leg.br/presenca-comissoes/votacao-portal?reuniao=${id}`;
}

/**
 * Extrai o placar do texto livre de `descricao`.
 *
 * Heurística deliberadamente secundária (§1.4): serve para preencher os totais,
 * nunca para decidir se a votação é nominal. Essa decisão vem de /votos.
 */
export function extrairPlacar(
  descricao: string,
): { sim: number; nao: number } | null {
  const m = descricao.match(/Sim:\s*(\d+)[;,]?\s*N[ãa]o:\s*(\d+)/i);
  if (!m) return null;
  return { sim: Number(m[1]), nao: Number(m[2]) };
}
