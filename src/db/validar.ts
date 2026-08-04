/**
 * Validação do modelo contra os casos de borda encontrados no reconhecimento.
 *
 * Não é teste de unidade nem seed de produção: é a prova de que o schema
 * responde corretamente às quatro situações que quebrariam a plataforma se
 * fossem modeladas ingenuamente. Roda em banco em memória.
 *
 *   uso:  node --experimental-strip-types src/db/validar.ts
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  classificarDiscurso,
  type CategoriaDiscurso,
} from "../lib/classificar.ts";

const db = new DatabaseSync(":memory:");

// aplica TODAS as migrations, em ordem — não apenas a inicial
const dir = "drizzle";
for (const arquivo of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
  for (const stmt of readFileSync(join(dir, arquivo), "utf8").split("--> statement-breakpoint")) {
    const s = stmt.trim();
    if (s) db.exec(s);
  }
}
db.exec("PRAGMA foreign_keys = ON");

// ---------------------------------------------------------------------------
// Fixture: 3 deputados, 4 votações. Cada linha existe para exercitar um achado.
// ---------------------------------------------------------------------------

db.exec(`
INSERT INTO legislatura (numero, data_inicio, data_fim)
  VALUES (57, '2023-02-01', '2027-01-31');

INSERT INTO partido (id, sigla, nome) VALUES
  (1,'PT','Partido dos Trabalhadores'),
  (2,'PL','Partido Liberal'),
  (3,'NOVO','Partido Novo');

-- (§3.4) TSE grafa "PC do B", Câmara grafa "PCdoB": alias evita falso positivo
INSERT INTO partido (id, sigla, nome) VALUES (4,'PCdoB','Partido Comunista do Brasil');
INSERT INTO partido_alias (partido_id, alias, fonte) VALUES (4,'PC do B','tse');

INSERT INTO politico (id, cpf, nome_parlamentar, fonte_url) VALUES
  (1,'00000000001','Titular Integral','https://exemplo/1'),
  (2,'00000000002','Suplente Tardio','https://exemplo/2'),
  (3,'00000000003','Trocou de Partido','https://exemplo/3');

INSERT INTO mandato (id, politico_id, casa, legislatura_numero, uf, condicao_eleitoral, fonte_url) VALUES
  (1,1,'camara',57,'RS','titular','https://exemplo/m1'),
  (2,2,'camara',57,'RS','suplente','https://exemplo/m2'),
  (3,3,'camara',57,'RS','titular','https://exemplo/m3');

-- (§1.8) o suplente só entra em exercício depois de metade das votações
INSERT INTO exercicio (mandato_id, data_inicio, data_fim, situacao, fonte_url) VALUES
  (1,'2023-02-01',NULL,'Exercício','https://exemplo/e1'),
  (2,'2025-03-01',NULL,'Exercício','https://exemplo/e2'),
  (3,'2023-02-01',NULL,'Exercício','https://exemplo/e3');

-- (§1.2) político 3 troca de PT para PL no meio do período
INSERT INTO filiacao (politico_id, partido_id, data_inicio, data_fim, fonte_url) VALUES
  (1,1,'2023-02-01',NULL,'https://exemplo/f1'),
  (2,2,'2025-03-01',NULL,'https://exemplo/f2'),
  (3,1,'2023-02-01','2025-02-15','https://exemplo/f3'),
  (3,2,'2025-02-16',NULL,'https://exemplo/f4');

INSERT INTO orgao (id, casa, id_externo, sigla, nome) VALUES (1,'camara','180','PLEN','Plenário');

-- (§1.4) v3 é simbólica: nominal=0, sem votos. (§2.4) v4 é secreta.
INSERT INTO votacao (id, casa, id_externo, orgao_id, data, descricao, nominal, secreta, fonte_url) VALUES
  (1,'camara','111-1',1,'2025-01-15','Votação nominal A',1,0,'https://exemplo/v1'),
  (2,'camara','222-2',1,'2025-04-10','Votação nominal B',1,0,'https://exemplo/v2'),
  (3,'camara','333-3',1,'2025-04-11','Simbólica (sem votos)',0,0,'https://exemplo/v3'),
  (4,'senado','444',  1,'2025-04-12','Secreta do Senado',1,1,'https://exemplo/v4');

-- (§1.6) Governo/Oposição são agregados: tipo 'B' e partido_id NULL.
-- NOVO orienta pela própria sigla: tipo 'P', com partido_id resolvido.
INSERT INTO orientacao (votacao_id, sigla_bruta, tipo_lideranca, partido_id, orientacao, liberado) VALUES
  (1,'Governo','B',NULL,'sim',0),
  (1,'Oposição','B',NULL,'nao',0),
  (1,'Bl PlFdrPtUniPp...','B',NULL,NULL,1),      -- bloco truncado + liberado
  (1,'NOVO','P',3,'nao',0),
  (2,'Governo','B',NULL,'sim',0),
  (2,'Oposição','B',NULL,'nao',0);

-- votos. (§1.5) 'obstrucao' e 'presidente' entram no acervo mas não são computáveis
INSERT INTO voto (votacao_id, politico_id, partido_id, voto, tipo_voto_original, computavel) VALUES
  (1,1,1,'sim','Sim',1),
  (1,3,1,'nao','Não',1),                          -- v1 é de jan/2025: pol.3 ainda no PT
  (2,1,1,'obstrucao','Obstrução',0),              -- obstrução: registrada, não computada
  (2,2,2,'sim','Sim',1),
  (2,3,2,'presidente','Artigo 17',0),             -- desempate: fora do cálculo
  (4,1,1,'sigiloso','Votou',0);                   -- secreta: voto não revelado
`);

// ---------------------------------------------------------------------------
// Verificações
// ---------------------------------------------------------------------------

let falhas = 0;
const checar = (nome: string, obtido: unknown, esperado: unknown) => {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (!ok) falhas++;
  console.log(`  ${ok ? "✓" : "✗"} ${nome}`);
  if (!ok) console.log(`      esperado ${JSON.stringify(esperado)}, obtido ${JSON.stringify(obtido)}`);
};

console.log("\n§1.8 — denominador respeita o período de exercício");
{
  // votações nominais, não secretas, ocorridas DENTRO do exercício de cada um
  const q = db.prepare(`
    SELECT p.nome_parlamentar AS nome, COUNT(*) AS oportunidades
    FROM politico p
    JOIN mandato m   ON m.politico_id = p.id
    JOIN exercicio e ON e.mandato_id = m.id
    JOIN votacao v   ON v.nominal = 1 AND v.secreta = 0
                    AND v.data >= e.data_inicio
                    AND (e.data_fim IS NULL OR v.data <= e.data_fim)
    GROUP BY p.id ORDER BY p.id
  `).all() as { nome: string; oportunidades: number }[];
  // titulares veem v1 e v2; o suplente entrou em 2025-03-01, então só v2
  checar("titular integral tem 2 oportunidades", q[0]?.oportunidades, 2);
  checar("suplente tardio tem 1 oportunidade (não 2)", q[1]?.oportunidades, 1);
}

console.log("\n§1.4 / §2.4 — simbólicas e secretas fora do universo elegível");
{
  const n = db.prepare(
    `SELECT COUNT(*) AS n FROM votacao WHERE nominal = 1 AND secreta = 0`,
  ).get() as { n: number };
  checar("2 votações elegíveis de 4 registradas", n.n, 2);
}

console.log("\n§1.5 — obstrução preservada, mas fora do cálculo");
{
  const r = db.prepare(
    `SELECT voto, computavel FROM voto WHERE tipo_voto_original = 'Obstrução'`,
  ).get() as { voto: string; computavel: number };
  checar("obstrução é categoria própria", r.voto, "obstrucao");
  checar("obstrução não é computável", r.computavel, 0);
  const art17 = db.prepare(
    `SELECT computavel FROM voto WHERE tipo_voto_original = 'Artigo 17'`,
  ).get() as { computavel: number };
  checar("Artigo 17 não é computável", art17.computavel, 0);
}

console.log("\n§1.2 — voto guarda o partido vigente na data");
{
  const r = db.prepare(`
    SELECT pt.sigla FROM voto v JOIN partido pt ON pt.id = v.partido_id
    WHERE v.politico_id = 3 AND v.votacao_id = 1
  `).get() as { sigla: string };
  // v1 ocorreu em 2025-01-15, antes da troca em 2025-02-16
  checar("voto de jan/2025 aponta para o PT, não para o PL atual", r.sigla, "PT");

  const atual = db.prepare(`
    SELECT pt.sigla FROM filiacao f JOIN partido pt ON pt.id = f.partido_id
    WHERE f.politico_id = 3 AND f.data_fim IS NULL
  `).get() as { sigla: string };
  checar("filiação vigente é o PL", atual.sigla, "PL");
}

console.log("\n§3.4 — alias resolve divergência de grafia entre fontes");
{
  const r = db.prepare(`
    SELECT p.sigla FROM partido_alias a JOIN partido p ON p.id = a.partido_id
    WHERE a.alias = 'PC do B' AND a.fonte = 'tse'
  `).get() as { sigla: string };
  checar("'PC do B' (TSE) resolve para 'PCdoB'", r.sigla, "PCdoB");
}

console.log("\n§1.6 — orientação de bloco não inventa partido");
{
  const bloco = db.prepare(
    `SELECT partido_id, liberado FROM orientacao WHERE sigla_bruta LIKE 'Bl %'`,
  ).get() as { partido_id: number | null; liberado: number };
  checar("bloco truncado mantém partido_id NULL", bloco.partido_id, null);
  checar("liberação de bancada é registrada como tal", bloco.liberado, 1);

  const novo = db.prepare(
    `SELECT partido_id FROM orientacao WHERE sigla_bruta = 'NOVO'`,
  ).get() as { partido_id: number | null };
  checar("partido que orienta sozinho tem partido_id resolvido", novo.partido_id, 3);
}

console.log("\nEixo 1 — alinhamento com o governo federal");
{
  const q = db.prepare(`
    SELECT p.nome_parlamentar AS nome,
           SUM(CASE WHEN vt.voto = o.orientacao THEN 1 ELSE 0 END) AS concordou,
           COUNT(*) AS n
    FROM voto vt
    JOIN votacao v   ON v.id = vt.votacao_id AND v.nominal = 1 AND v.secreta = 0
    JOIN orientacao o ON o.votacao_id = v.id AND o.sigla_bruta = 'Governo'
                     AND o.liberado = 0 AND o.orientacao IN ('sim','nao')
    JOIN politico p  ON p.id = vt.politico_id
    WHERE vt.computavel = 1
    GROUP BY p.id ORDER BY p.id
  `).all() as { nome: string; concordou: number; n: number }[];
  checar("titular: 1 voto computável contra orientação do Governo",
    [q[0]?.concordou, q[0]?.n], [1, 1]);
  checar("suplente: 1 voto, concordou", [q[1]?.concordou, q[1]?.n], [1, 1]);
  checar("obstrução e Artigo 17 não entraram no denominador",
    q.every((r) => r.n <= 1), true);
}

console.log("\nEixo 2 — coesão partidária, excluindo o voto do próprio deputado");
{
  // (§1.6.1) a maioria do partido é apurada SEM o voto de quem está sendo medido,
  // senão o parlamentar ajuda a definir a régua contra a qual é comparado.
  const q = db.prepare(`
    WITH cont AS (
      SELECT votacao_id, partido_id,
             SUM(CASE WHEN voto='sim' THEN 1 ELSE 0 END) AS sim,
             SUM(CASE WHEN voto='nao' THEN 1 ELSE 0 END) AS nao
      FROM voto WHERE computavel = 1
      GROUP BY votacao_id, partido_id
    )
    SELECT vt.politico_id AS pid,
           (c.sim - CASE WHEN vt.voto='sim' THEN 1 ELSE 0 END) AS sim_pares,
           (c.nao - CASE WHEN vt.voto='nao' THEN 1 ELSE 0 END) AS nao_pares
    FROM voto vt
    JOIN cont c ON c.votacao_id = vt.votacao_id AND c.partido_id = vt.partido_id
    WHERE vt.computavel = 1 AND vt.votacao_id = 1 AND vt.politico_id = 1
  `).get() as { pid: number; sim_pares: number; nao_pares: number };
  // na votação 1 o PT tem 2 votos: pol.1 'sim' e pol.3 'nao'.
  // ao medir pol.1, restam 0 'sim' e 1 'nao' entre os pares.
  checar("voto do próprio deputado é removido da apuração",
    [q.sim_pares, q.nao_pares], [0, 1]);
}

console.log("\nProveniência — nenhum fato exibível sem fonte");
{
  const tabelas = ["politico", "votacao", "discurso", "filiacao", "exercicio", "mandato"];
  const semFonte = tabelas.filter((t) => {
    const r = db.prepare(`SELECT COUNT(*) AS n FROM ${t} WHERE fonte_url IS NULL OR fonte_url = ''`).get() as { n: number };
    return r.n > 0;
  });
  checar("todas as tabelas de fato têm fonte_url preenchida", semFonte, []);
}

console.log("\nClassificação de discursos — casos reais do acervo");
{
  // Regressões: cada caso abaixo quebrou uma versão anterior da regra.
  const casos: Array<[string, string, string, CategoriaDiscurso]> = [
    [
      "orientação pela ordem é ritual",
      "PELA ORDEM",
      "O Deputado orientou a bancada na votação do requerimento de urgência do Projeto de Lei nº 363, de 2025.",
      "orientacao_voto",
    ],
    [
      "orientação COMO LÍDER é discurso, não ritual",
      "COMO LÍDER",
      "O Deputado orientou a bancada e celebrou os 45 anos do PDT.",
      "substantivo",
    ],
    [
      "ementa com 'solicita' não torna a orientação substantiva",
      "PELA ORDEM",
      "O Deputado orientou a bancada na votação do requerimento que solicita o encerramento da discussão do Projeto de Lei nº 4.149, de 2004.",
      "orientacao_voto",
    ],
    [
      "registro de presença puro é protocolar",
      "PELA ORDEM",
      "O Deputado registrou a presença dos Vereadores Eduardo Moura e Felipe Alecrim, do Partido Novo de Recife (PE).",
      "registro_presenca",
    ],
    [
      "presença + apelo político em sentença seguinte é substantivo",
      "PELA ORDEM",
      "O Deputado registrou a presença da Vereadora Cátina Monteiro, de Jaguari (RS), destacando o envio de recursos ao Município. Em seguida, fez um apelo em defesa dos combatentes da missão de paz em Suez. Criticou ainda o veto presidencial.",
      "substantivo",
    ],
    [
      "'registrou o protesto' não é registro de presença",
      "BREVES COMUNICAÇÕES",
      "O Deputado registrou o protesto dos produtores rurais do Rio Grande do Sul, que bloquearam rodovias.",
      "substantivo",
    ],
    [
      "'saudou os estudantes' com crítica é substantivo",
      "PELA ORDEM",
      "O Deputado saudou os estudantes presentes e lamentou a atual situação do Direito no Brasil, criticando a atuação do Judiciário.",
      "substantivo",
    ],
  ];
  for (const [nome, tipo, sumario, esperado] of casos) {
    checar(nome, classificarDiscurso(tipo, sumario).categoria, esperado);
  }
}

const totalChecagens = 24;
console.log(
  falhas === 0
    ? `\n✓ modelo validado: ${totalChecagens} verificações, 0 falhas\n`
    : `\n✗ ${falhas} falha(s)\n`,
);
process.exit(falhas === 0 ? 0 : 1);
