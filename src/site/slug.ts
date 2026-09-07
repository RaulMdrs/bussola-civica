/**
 * Nome de parlamentar → caminho de URL.
 *
 * Módulo separado por um motivo só: `gerar.ts` é um script — executa ao ser
 * importado. Esta função precisa ser importável por quem baixa as fotos, que
 * grava `<slug>.jpg` e depende de casar exatamente com o caminho da página.
 * Mesma razão que separou `horizonte.ts` de `incremental.ts`.
 *
 * Se as duas divergirem, a foto some do perfil sem erro nenhum.
 */
export function slug(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
