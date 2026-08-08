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
import { classificarNatureza, type NaturezaVotacao } from "../lib/natureza.ts";
import { hoje } from "../lib/normalizar.ts";
import { descobrirJanelas } from "../ingest/horizonte.ts";
import { conferirIntegridade } from "./integridade.ts";
import { abrirBanco, schema } from "./client.ts";

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

console.log("\nNatureza da votação — casos reais do acervo");
{
  // (descrição, objetoVotadoId, proposicaoId, esperado)
  const casos: Array<[string, string, number | null, number | null, NaturezaVotacao]> = [
    [
      "requerimento rejeitado é procedimental",
      "Rejeitado o Requerimento. Sim: 125; Não: 236; Abstenção: 2; Total: 363.",
      10, 10, "procedimental",
    ],
    [
      "requerimento de urgência é procedimental",
      "Aprovado, por unanimidade, o Requerimento de Urgência (Art. 155 do RICD).",
      11, 22, "procedimental",
    ],
    [
      "aprovação de projeto é mérito",
      "Aprovado o Projeto de Lei nº 2.215, de 2024. Sim: 273; Não: 136; Total: 409.",
      10, 10, "merito",
    ],
    [
      "'Mantido o texto' é destaque de mérito",
      "Mantido o texto. Sim: 386; Não: 27; Total: 413.",
      10, 10, "merito",
    ],
    [
      "substitutivo é mérito",
      "Aprovado o Substitutivo ao Projeto de Lei nº 9.133, de 2017.",
      10, 10, "merito",
    ],
    [
      "redação final é ato formal, fora dos escopos",
      "Aprovada a Redação Final assinada pelo relator, Dep. Pedro C.",
      10, 10, "formal",
    ],
    [
      "objeto ≠ matéria é procedimental mesmo sem 'requerimento' na descrição",
      "Aprovado.",
      11, 22, "procedimental",
    ],
    [
      "'requerimento' citado na ementa do projeto não torna a votação procedimental",
      "Aprovado o Projeto de Lei nº 4.187, de 2024, que atende a requerimento da sociedade civil.",
      10, 10, "merito",
    ],
  ];
  for (const [nome, desc, obj, prop, esperado] of casos) {
    checar(nome, classificarNatureza(desc, obj, prop), esperado);
  }
}

/**
 * A fronteira do cache é uma data, e data depende de fuso. Com `toISOString()`
 * (UTC), toda coleta rodada entre 21h e meia-noite BRT lia o dia seguinte, dava
 * a sessão em curso por encerrada e gravava o placar parcial como imutável.
 * Os três casos abaixo são as três horas que o defeito ocupava.
 */
console.log("\nFronteira do dia — horário de Brasília, não UTC");
{
  const casos: [string, string, string][] = [
    ["meio-dia BRT é o próprio dia", "2026-08-07T15:00:00Z", "2026-08-07"],
    ["21h BRT ainda é o mesmo dia (UTC já virou)", "2026-08-08T00:30:00Z", "2026-08-07"],
    ["madrugada BRT é o dia novo", "2026-08-08T03:30:00Z", "2026-08-08"],
  ];
  for (const [nome, instante, esperado] of casos) {
    checar(nome, hoje(new Date(instante)), esperado);
  }
}

/**
 * Retomada da ingestão incremental (`src/ingest/horizonte.ts`).
 *
 * O que se prova aqui é que a auditoria consegue responder "até onde se olhou"
 * **por etapa** — e que etapa sem registro nunca é confundida com etapa em dia.
 * Foi a confusão entre as duas que abriu, por um caminho novo, a lacuna
 * silenciosa que a tabela `coleta` existe para impedir: quem rodasse
 * `--etapas votacoes` isoladamente perderia os discursos daquele período para
 * sempre, sem erro e sem sinal.
 */
console.log("\nRetomada incremental — horizonte por etapa");
{
  const LEG = { ini: "2023-02-01", fim: "2027-01-31" }; // igual à fixture
  const consulta = (sql: string, ...p: string[]) =>
    db.prepare(sql).get(...p) as Record<string, unknown> | undefined;

  /** Repõe `coleta` do zero — os casos não podem contaminar uns aos outros. */
  const comColeta = (...recursos: [string, string][]) => {
    db.exec("DELETE FROM coleta");
    for (const [recurso, status] of recursos) {
      db.prepare(
        `INSERT INTO coleta (fonte, recurso, url, status)
         VALUES ('camara', ?, 'https://exemplo/coleta', ?)`,
      ).run(recurso, status);
    }
  };

  const V = (ate: string): [string, string] => [`votacoes 2023-02-01..${ate}`, "ok"];
  const D = (ate: string): [string, string] => [
    `deputados/204536/discursos 2023-02-01..${ate}`,
    "ok",
  ];

  comColeta(V("2026-07-01"), D("2026-07-01"));
  checar(
    "etapas em dia: retoma da data coberta",
    descobrirJanelas(consulta, LEG, "2026-08-07").inicio,
    "2026-07-01",
  );

  comColeta(V("2026-08-07"), D("2026-03-01"));
  checar(
    "discurso atrasado puxa a retomada para trás",
    descobrirJanelas(consulta, LEG, "2026-08-07").inicio,
    "2026-03-01",
  );

  comColeta(V("2026-03-01"), D("2026-08-07"));
  checar(
    "votação atrasada puxa a retomada para trás",
    descobrirJanelas(consulta, LEG, "2026-08-07").inicio,
    "2026-03-01",
  );

  // O caso que motivou a correção: só `votacoes` rodou.
  comColeta(V("2026-08-07"));
  {
    const j = descobrirJanelas(consulta, LEG, "2026-08-07");
    checar("discurso sem registro conta como sem cobertura", j.discursos, {
      ate: LEG.ini,
      origem: "nenhuma",
    });
    checar("e a retomada volta ao início da legislatura", j.inicio, LEG.ini);
  }

  // Recurso no formato anterior a esta versão: sem janela no nome.
  comColeta(V("2026-08-07"), ["deputados/204536/discursos", "ok"]);
  checar(
    "recurso de discurso sem janela não vira horizonte",
    descobrirJanelas(consulta, LEG, "2026-08-07").discursos.origem,
    "nenhuma",
  );

  comColeta(V("2026-08-07"), [`deputados/204536/discursos 2023-02-01..2026-08-07`, "falha"]);
  checar(
    "coleta com status 'falha' não conta como cobertura",
    descobrirJanelas(consulta, LEG, "2026-08-07").discursos.origem,
    "nenhuma",
  );

  // Sem linha de votação em `coleta`, cai no fallback: a fixture tem votação
  // até 2025-04-12.
  comColeta(D("2026-08-07"));
  checar("sem registro de votação, infere de votacao.data", descobrirJanelas(consulta, LEG, "2026-08-07").votacoes, {
    ate: "2025-04-12",
    origem: "votacao",
  });

  comColeta(V("2027-06-30"), D("2027-06-30"));
  checar(
    "cobertura além da janela não coleta (mas o chamador ainda deriva)",
    descobrirJanelas(consulta, LEG, "2026-08-07").coletar,
    false,
  );

  comColeta(V("2026-08-07"), D("2026-08-07"));
  checar(
    "fim da janela é limitado pelo fim da legislatura",
    descobrirJanelas(consulta, LEG, "2027-06-30").fim,
    LEG.fim,
  );

  db.exec("DELETE FROM coleta");
}

/**
 * Invariantes do acervo (`src/db/integridade.ts`).
 *
 * Cada uma existe por causa de um estado que a coleta produziu de verdade: a
 * votação 2576389-4 ficou com a linha gravada e zero votos, porque o processo
 * caiu no meio do laço e a re-execução a pulou como "já coletada". A transação
 * em `ingerirVotacoes` impede que aconteça de novo; estas consultas garantem
 * que, se acontecer, alguém veja.
 */
console.log("\nIntegridade do acervo — estados que a coleta não pode produzir");
{
  const todos = (s: string) => db.prepare(s).all() as Record<string, unknown>[];
  const nomes = (a: ReturnType<typeof conferirIntegridade>) =>
    a.map((x) => x.invariante.nome);

  checar("fixture coerente não acusa nada", conferirIntegridade(todos), []);

  // O caso real: linha de votação escrita, votos interrompidos.
  db.exec(`INSERT INTO votacao (id, casa, id_externo, orgao_id, data, descricao, nominal, secreta, fonte_url)
           VALUES (90,'camara','990-1',1,'2025-05-01','Nominal sem votos',1,0,'https://exemplo/v90')`);
  checar("nominal sem voto é detectada", nomes(conferirIntegridade(todos)), [
    "votação nominal sem nenhum voto gravado",
  ]);
  db.exec("DELETE FROM votacao WHERE id = 90");

  // O inverso: votação 3 da fixture é simbólica.
  db.exec(`INSERT INTO voto (votacao_id, politico_id, voto, tipo_voto_original, computavel)
           VALUES (3,1,'sim','Sim',1)`);
  checar("simbólica com voto é detectada", nomes(conferirIntegridade(todos)), [
    "votação simbólica com voto gravado",
  ]);
  db.exec("DELETE FROM voto WHERE votacao_id = 3");

  db.exec(`
    INSERT INTO eixo (id, chave, nome_exibicao, descricao, rotulo_min, rotulo_max, metodologia_versao)
      VALUES (90,'teste','Teste','—','min','max','2026-08-07.0');
    INSERT INTO posicao (id, politico_id, eixo_id, legislatura_numero, periodo_inicio, periodo_fim,
                         escopo, valor, n_observacoes, n_oportunidades, metodologia_versao)
      VALUES (90,1,90,57,'2023-02-01','2026-08-07','merito',0.5,10,20,'2026-08-07.0')`);
  checar("posição sem evidência é detectada", nomes(conferirIntegridade(todos)), [
    "posição sem nenhuma evidência",
  ]);

  /**
   * O caso que `ingerir:incremental` produzia todo dia: mesma série apurada
   * com dois `periodo_fim`. Aconteceu de verdade na virada de 2026-08-07 para
   * 08-08 — 124 posições viraram 248.
   */
  db.exec(`
    INSERT INTO posicao (id, politico_id, eixo_id, legislatura_numero, periodo_inicio, periodo_fim,
                         escopo, valor, n_observacoes, n_oportunidades, metodologia_versao)
      VALUES (91,1,90,57,'2023-02-01','2026-08-08','merito',0.5,10,20,'2026-08-07.0')`);
  checar(
    "mesma série com dois períodos é detectada",
    nomes(conferirIntegridade(todos)).sort(),
    ["mesma série de posição apurada em dois períodos", "posição sem nenhuma evidência"],
  );

  db.exec("DELETE FROM posicao WHERE id IN (90, 91); DELETE FROM eixo WHERE id = 90");

  checar("e a limpeza devolve o acervo à coerência", conferirIntegridade(todos), []);
}

/**
 * A transação de `ingerirVotacoes` é atômica de verdade?
 *
 * A correção do gap assume uma coisa não óbvia: que uma escrita feita pelo
 * Drizzle **sobre o adaptador `sqlite-proxy`** participa da transação aberta
 * por `sqlite.exec("BEGIN")` na conexão de baixo. Se as duas vias não
 * compartilhassem a transação, o BEGIN/COMMIT seria decorativo e o gap
 * continuaria aberto — sem nenhum sintoma visível.
 *
 * Aqui isso é exercitado com o cliente real, em banco em memória.
 */
console.log("\nAtomicidade — Drizzle e conexão crua na mesma transação");
{
  const mem = abrirBanco(":memory:");
  for (const arquivo of readdirSync(dir).filter((f) => f.endsWith(".sql")).sort()) {
    for (const stmt of readFileSync(join(dir, arquivo), "utf8").split("--> statement-breakpoint")) {
      const t = stmt.trim();
      if (t) mem.sqlite.exec(t);
    }
  }
  mem.sqlite.exec(
    `INSERT INTO orgao (id, casa, id_externo, sigla, nome) VALUES (1,'camara','180','PLEN','Plenário')`,
  );
  const contar = () =>
    (mem.sqlite.prepare("SELECT COUNT(*) n FROM votacao").get() as { n: number }).n;

  mem.sqlite.exec("BEGIN");
  await mem.db.insert(schema.votacao).values({
    casa: "camara",
    idExterno: "999-1",
    orgaoId: 1,
    data: "2026-08-07",
    descricao: "escrita pelo Drizzle dentro de BEGIN",
    nominal: true,
    secreta: false,
    fonteUrl: "https://exemplo/atomicidade",
  });
  checar("dentro da transação, a escrita do Drizzle é visível", contar(), 1);

  mem.sqlite.exec("ROLLBACK");
  checar("ROLLBACK na conexão crua desfaz a escrita do Drizzle", contar(), 0);

  mem.sqlite.exec("BEGIN");
  await mem.db.insert(schema.votacao).values({
    casa: "camara",
    idExterno: "999-2",
    orgaoId: 1,
    data: "2026-08-07",
    descricao: "commitada",
    nominal: true,
    secreta: false,
    fonteUrl: "https://exemplo/atomicidade",
  });
  mem.sqlite.exec("COMMIT");
  checar("COMMIT persiste", contar(), 1);

  mem.sqlite.close();
}

const totalChecagens = 54;
console.log(
  falhas === 0
    ? `\n✓ modelo validado: ${totalChecagens} verificações, 0 falhas\n`
    : `\n✗ ${falhas} falha(s)\n`,
);
process.exit(falhas === 0 ? 0 : 1);
