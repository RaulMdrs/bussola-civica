/**
 * Leitor mínimo de ZIP — extrai uma entrada pelo nome.
 *
 * Existe porque o Node não lê ZIP nativamente e este projeto não tem
 * dependência de runtime além do Drizzle. As alternativas foram descartadas:
 * `unzip` por shell quebra no Windows, que é destino declarado do projeto; e
 * uma dependência nova para ler um arquivo por ano não se paga.
 *
 * Suporta o que o TSE publica: STORE (0) e DEFLATE (8), sem criptografia e sem
 * ZIP64. Formato desconhecido vira erro explícito, nunca dado parcial.
 */

import { inflateRawSync } from "node:zlib";

const FIM_DIRETORIO = 0x06054b50;
const ENTRADA_DIRETORIO = 0x02014b50;

export interface EntradaZip {
  nome: string;
  metodo: number;
  tamanhoComprimido: number;
  tamanhoOriginal: number;
  deslocamentoLocal: number;
}

/** Lê o diretório central e lista as entradas, sem descomprimir nada. */
export function listarZip(buf: Buffer): EntradaZip[] {
  // O EOCD fica no fim, depois de um comentário de tamanho variável (máx 64 KB).
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === FIM_DIRETORIO) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("ZIP inválido: fim do diretório central não encontrado");

  const total = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);

  const entradas: EntradaZip[] = [];
  for (let i = 0; i < total; i++) {
    if (buf.readUInt32LE(p) !== ENTRADA_DIRETORIO) {
      throw new Error(`ZIP inválido: entrada ${i} do diretório central corrompida`);
    }
    const metodo = buf.readUInt16LE(p + 10);
    const tamanhoComprimido = buf.readUInt32LE(p + 20);
    const tamanhoOriginal = buf.readUInt32LE(p + 24);
    const nomeLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const comentarioLen = buf.readUInt16LE(p + 32);
    const deslocamentoLocal = buf.readUInt32LE(p + 42);
    const nome = buf.subarray(p + 46, p + 46 + nomeLen).toString("latin1");

    entradas.push({ nome, metodo, tamanhoComprimido, tamanhoOriginal, deslocamentoLocal });
    p += 46 + nomeLen + extraLen + comentarioLen;
  }
  return entradas;
}

/**
 * Extrai uma entrada pelo nome exato.
 *
 * O cabeçalho local traz os próprios comprimentos de nome e campo extra, que
 * **não** são iguais aos do diretório central — usar os do diretório é o erro
 * clássico aqui, e produz dado deslocado em vez de erro.
 */
export function extrairDoZip(buf: Buffer, nome: string): Buffer {
  const entrada = listarZip(buf).find((e) => e.nome === nome);
  if (!entrada) {
    throw new Error(`entrada não encontrada no ZIP: ${nome}`);
  }

  const p = entrada.deslocamentoLocal;
  const nomeLen = buf.readUInt16LE(p + 26);
  const extraLen = buf.readUInt16LE(p + 28);
  const inicio = p + 30 + nomeLen + extraLen;
  const dados = buf.subarray(inicio, inicio + entrada.tamanhoComprimido);

  if (entrada.metodo === 0) return Buffer.from(dados);
  if (entrada.metodo === 8) return inflateRawSync(dados);
  throw new Error(`método de compressão não suportado no ZIP: ${entrada.metodo}`);
}
