/**
 * Baixa as fotos oficiais dos parlamentares para `docs/assets/fotos/`.
 *
 *   npm run fotos            # baixa o que falta
 *   npm run fotos -- --forcar  # rebaixa tudo
 *
 * ## Por que não hotlink
 *
 * Medido em 2026-09-06 contra a origem: a Câmara responde em 0,2 s na mediana
 * e levou **22,7 s** no pior caso, e manda `cache-control: no-cache` — cada
 * visita rebuscaria. Uma página que espera o servidor da Câmara é uma página
 * que às vezes trava.
 *
 * E há a razão que pesa mais: hotlink faz o navegador de quem lê pedir a imagem
 * a `camara.leg.br`, entregando o IP do leitor a quem ele está auditando. Num
 * site sobre voto parlamentar isso não é detalhe de desempenho.
 *
 * ## Por que asset versionado, e não BLOB no banco
 *
 * Foto é asset, como `bussola.css` e `busca.js`: entra no repositório, muda
 * raramente, e não é derivada do acervo. Guardá-la no banco inflaria o acervo
 * com bytes que não são fato apurado, e obrigaria o gerador a escrever binário.
 *
 * Consequência aceita: `npm run site` **não** produz as fotos. Se faltarem, o
 * gerador omite a imagem e mostra só o nome — nunca um quadrado quebrado.
 */

import { mkdirSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { CAMINHO_DB } from "../db/client.ts";
import { slug } from "./slug.ts";

const DESTINO = join("docs", "assets", "fotos");
const forcar = process.argv.includes("--forcar");

const db = new DatabaseSync(process.env.BUSSOLA_DB ?? CAMINHO_DB, { readOnly: true });
const alvos = db
  .prepare(
    `SELECT p.nome_parlamentar nome, p.url_foto url
     FROM politico p
     WHERE p.perfil_completo = 1 AND p.url_foto IS NOT NULL
     ORDER BY p.nome_parlamentar`,
  )
  .all() as { nome: string; url: string }[];

mkdirSync(DESTINO, { recursive: true });

let baixadas = 0;
let mantidas = 0;
const falhas: string[] = [];

console.log(`fotos — ${alvos.length} parlamentares com URL na origem`);

for (const a of alvos) {
  const arquivo = join(DESTINO, `${slug(a.nome)}.jpg`);
  if (!forcar && existsSync(arquivo) && statSync(arquivo).size > 0) {
    mantidas++;
    continue;
  }

  try {
    // `redirect: follow` é obrigatório: o Senado publica `http://www.senado…`
    // e redireciona para `https://legis.senado…`.
    const r = await fetch(a.url, { redirect: "follow", signal: AbortSignal.timeout(30_000) });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);

    const tipo = r.headers.get("content-type") ?? "";
    if (!tipo.startsWith("image/")) throw new Error(`não é imagem: ${tipo}`);

    const bytes = Buffer.from(await r.arrayBuffer());
    if (bytes.length < 1024) throw new Error(`${bytes.length} bytes — pequeno demais para ser foto`);

    writeFileSync(arquivo, bytes);
    baixadas++;
    console.log(`  ✓ ${a.nome} — ${Math.round(bytes.length / 1024)} KB`);
  } catch (erro) {
    // Falha de foto **não** derruba a execução: o site funciona sem ela, e
    // derrubar por causa de um retrato seria desproporcional.
    falhas.push(`${a.nome}: ${(erro as Error).message}`);
    console.log(`  ✗ ${a.nome} — ${(erro as Error).message}`);
  }
}

console.log(`\n  ${baixadas} baixadas · ${mantidas} já existiam · ${falhas.length} falharam`);
if (falhas.length) {
  console.log(`\n  Os perfis sem foto mostram só o nome. Para tentar de novo:`);
  console.log(`    npm run fotos -- --forcar`);
}
db.close();
