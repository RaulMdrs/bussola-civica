/**
 * Pseudonimização do CPF.
 *
 * O CPF é a única chave confiável de reconciliação entre Câmara e TSE — nome
 * não serve (nome parlamentar × nome de urna) e partido não serve (6 dos 31
 * trocaram de legenda desde a eleição). Validada em 31/31 (FONTES.md §3.4).
 *
 * Mas ele é chave de junção, nunca dado a exibir. Guardá-lo em claro fazia do
 * acervo uma base de dados pessoais: não versionável, não sincronizável, e um
 * vazamento de arquivo viraria vazamento de CPF. Guardando o HMAC, a junção
 * continua funcionando — aplica-se o mesmo HMAC aos dois lados — e o banco
 * deixa de conter o identificador.
 *
 * **Hash puro não serviria.** CPF tem 11 dígitos: 10^11 combinações, que um
 * laptop percorre em segundos. Sem segredo, "hashear" o CPF é ofuscação, não
 * proteção. É HMAC com segredo fora do repositório, ou nada.
 *
 * Perder o segredo não perde dado: `npm run ingerir -- --etapas deputados`
 * traz os CPFs da API oficial de novo (62 requisições) e re-deriva tudo com um
 * segredo novo. O que se perde é só a comparabilidade com o que já estava
 * gravado — daí o recálculo ser da etapa inteira, não de uma linha.
 */

import { createHmac } from "node:crypto";
import { normalizarCpf } from "./normalizar.ts";

export const ENV_SEGREDO = "BUSSOLA_CPF_SEGREDO";

/**
 * Segredo do HMAC. Falha explícita se ausente — jamais um default.
 *
 * Um segredo padrão tornaria o HMAC trivialmente reversível por qualquer pessoa
 * com acesso ao código, que é público. Melhor não coletar do que coletar com
 * proteção de fachada.
 */
export function segredoCpf(): string {
  const s = process.env[ENV_SEGREDO];
  if (!s || s.length < 16) {
    throw new Error(
      `${ENV_SEGREDO} ausente ou curto demais (mínimo 16 caracteres).\n` +
        `  O CPF é guardado como HMAC, e o segredo não pode ter default: com um\n` +
        `  valor conhecido, 10^11 CPFs são percorridos em segundos.\n\n` +
        `  Gere um e guarde em .env (que já está no .gitignore):\n` +
        `    echo "${ENV_SEGREDO}=$(openssl rand -hex 32)" >> .env`,
    );
  }
  return s;
}

/**
 * HMAC-SHA256 do CPF normalizado a 11 dígitos.
 *
 * A normalização vem antes do HMAC porque as duas fontes entregam o CPF sem
 * zeros à esquerda (§3.4): `"1234567890"` e `"01234567890"` são a mesma pessoa
 * e precisam dar o mesmo HMAC. Normalizar depois seria tarde.
 */
export function hmacCpf(
  cpf: string | number | null | undefined,
  segredo: string,
): string | null {
  const normalizado = normalizarCpf(cpf);
  if (!normalizado) return null;
  return createHmac("sha256", segredo).update(normalizado).digest("hex");
}
