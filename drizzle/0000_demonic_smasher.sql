CREATE TABLE `coleta` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`fonte` text NOT NULL,
	`recurso` text NOT NULL,
	`url` text NOT NULL,
	`iniciado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	`concluido_em` text,
	`status` text NOT NULL,
	`http_status` integer,
	`tentativas` integer DEFAULT 1 NOT NULL,
	`registros` integer,
	`erro` text
);
--> statement-breakpoint
CREATE INDEX `coleta_recurso_idx` ON `coleta` (`recurso`,`iniciado_em`);--> statement-breakpoint
CREATE TABLE `discurso` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`politico_id` integer NOT NULL,
	`data_hora_inicio` text NOT NULL,
	`tipo_discurso` text,
	`sumario` text,
	`transcricao` text,
	`url_texto` text,
	`url_audio` text,
	`url_video` text,
	`fonte_url` text NOT NULL,
	FOREIGN KEY (`politico_id`) REFERENCES `politico`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `discurso_politico_idx` ON `discurso` (`politico_id`,`data_hora_inicio`);--> statement-breakpoint
CREATE UNIQUE INDEX `discurso_uq` ON `discurso` (`politico_id`,`data_hora_inicio`);--> statement-breakpoint
CREATE TABLE `eixo` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`chave` text NOT NULL,
	`nome_exibicao` text NOT NULL,
	`descricao` text NOT NULL,
	`rotulo_min` text NOT NULL,
	`rotulo_max` text NOT NULL,
	`metodologia_versao` text NOT NULL,
	`metodologia_url` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `eixo_chave_uq` ON `eixo` (`chave`);--> statement-breakpoint
CREATE TABLE `exercicio` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`mandato_id` integer NOT NULL,
	`data_inicio` text NOT NULL,
	`data_fim` text,
	`situacao` text,
	`descricao_status` text,
	`fonte_url` text NOT NULL,
	FOREIGN KEY (`mandato_id`) REFERENCES `mandato`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exercicio_mandato_idx` ON `exercicio` (`mandato_id`,`data_inicio`);--> statement-breakpoint
CREATE UNIQUE INDEX `exercicio_uq` ON `exercicio` (`mandato_id`,`data_inicio`);--> statement-breakpoint
CREATE TABLE `filiacao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`politico_id` integer NOT NULL,
	`partido_id` integer NOT NULL,
	`data_inicio` text NOT NULL,
	`data_fim` text,
	`fonte_url` text NOT NULL,
	FOREIGN KEY (`politico_id`) REFERENCES `politico`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`partido_id`) REFERENCES `partido`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `filiacao_politico_idx` ON `filiacao` (`politico_id`,`data_inicio`);--> statement-breakpoint
CREATE UNIQUE INDEX `filiacao_uq` ON `filiacao` (`politico_id`,`partido_id`,`data_inicio`);--> statement-breakpoint
CREATE TABLE `identidade_externa` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`politico_id` integer NOT NULL,
	`fonte` text NOT NULL,
	`id_externo` text NOT NULL,
	`contexto` text,
	`fonte_url` text NOT NULL,
	FOREIGN KEY (`politico_id`) REFERENCES `politico`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `identidade_fonte_id_uq` ON `identidade_externa` (`fonte`,`id_externo`,`contexto`);--> statement-breakpoint
CREATE INDEX `identidade_politico_idx` ON `identidade_externa` (`politico_id`);--> statement-breakpoint
CREATE TABLE `legislatura` (
	`numero` integer PRIMARY KEY NOT NULL,
	`data_inicio` text NOT NULL,
	`data_fim` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `mandato` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`politico_id` integer NOT NULL,
	`casa` text NOT NULL,
	`legislatura_numero` integer NOT NULL,
	`uf` text NOT NULL,
	`condicao_eleitoral` text NOT NULL,
	`fonte_url` text NOT NULL,
	FOREIGN KEY (`politico_id`) REFERENCES `politico`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`legislatura_numero`) REFERENCES `legislatura`(`numero`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mandato_uq` ON `mandato` (`politico_id`,`casa`,`legislatura_numero`);--> statement-breakpoint
CREATE INDEX `mandato_uf_idx` ON `mandato` (`uf`,`casa`,`legislatura_numero`);--> statement-breakpoint
CREATE TABLE `orgao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`casa` text NOT NULL,
	`id_externo` text NOT NULL,
	`sigla` text NOT NULL,
	`nome` text,
	`tipo` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orgao_uq` ON `orgao` (`casa`,`id_externo`);--> statement-breakpoint
CREATE TABLE `orientacao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`votacao_id` integer NOT NULL,
	`sigla_bruta` text NOT NULL,
	`tipo_lideranca` text NOT NULL,
	`partido_id` integer,
	`orientacao` text,
	`liberado` integer DEFAULT false NOT NULL,
	FOREIGN KEY (`votacao_id`) REFERENCES `votacao`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`partido_id`) REFERENCES `partido`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orientacao_uq` ON `orientacao` (`votacao_id`,`sigla_bruta`);--> statement-breakpoint
CREATE INDEX `orientacao_votacao_idx` ON `orientacao` (`votacao_id`);--> statement-breakpoint
CREATE TABLE `partido` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sigla` text NOT NULL,
	`nome` text,
	`fonte_url` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partido_sigla_uq` ON `partido` (`sigla`);--> statement-breakpoint
CREATE TABLE `partido_alias` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`partido_id` integer NOT NULL,
	`alias` text NOT NULL,
	`fonte` text NOT NULL,
	FOREIGN KEY (`partido_id`) REFERENCES `partido`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `partido_alias_uq` ON `partido_alias` (`alias`,`fonte`);--> statement-breakpoint
CREATE TABLE `politico` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`cpf` text,
	`nome_civil` text,
	`nome_parlamentar` text NOT NULL,
	`data_nascimento` text,
	`data_falecimento` text,
	`sexo` text,
	`uf_nascimento` text,
	`municipio_nascimento` text,
	`escolaridade` text,
	`url_foto` text,
	`perfil_completo` integer DEFAULT false NOT NULL,
	`fonte_url` text NOT NULL,
	`coletado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `politico_cpf_uq` ON `politico` (`cpf`);--> statement-breakpoint
CREATE INDEX `politico_nome_idx` ON `politico` (`nome_parlamentar`);--> statement-breakpoint
CREATE TABLE `posicao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`politico_id` integer NOT NULL,
	`eixo_id` integer NOT NULL,
	`legislatura_numero` integer NOT NULL,
	`periodo_inicio` text NOT NULL,
	`periodo_fim` text NOT NULL,
	`valor` real NOT NULL,
	`n_observacoes` integer NOT NULL,
	`n_oportunidades` integer NOT NULL,
	`metodologia_versao` text NOT NULL,
	`calculado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	FOREIGN KEY (`politico_id`) REFERENCES `politico`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`eixo_id`) REFERENCES `eixo`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`legislatura_numero`) REFERENCES `legislatura`(`numero`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `posicao_uq` ON `posicao` (`politico_id`,`eixo_id`,`legislatura_numero`,`periodo_inicio`,`periodo_fim`);--> statement-breakpoint
CREATE INDEX `posicao_eixo_idx` ON `posicao` (`eixo_id`,`legislatura_numero`);--> statement-breakpoint
CREATE TABLE `posicao_evidencia` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`posicao_id` integer NOT NULL,
	`votacao_id` integer NOT NULL,
	`voto_id` integer,
	`referencia` text NOT NULL,
	`concordou` integer NOT NULL,
	FOREIGN KEY (`posicao_id`) REFERENCES `posicao`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`votacao_id`) REFERENCES `votacao`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`voto_id`) REFERENCES `voto`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `evidencia_uq` ON `posicao_evidencia` (`posicao_id`,`votacao_id`);--> statement-breakpoint
CREATE INDEX `evidencia_posicao_idx` ON `posicao_evidencia` (`posicao_id`);--> statement-breakpoint
CREATE TABLE `proposicao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`casa` text NOT NULL,
	`id_externo` text NOT NULL,
	`sigla_tipo` text,
	`numero` integer,
	`ano` integer,
	`ementa` text,
	`data_apresentacao` text,
	`fonte_url` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proposicao_uq` ON `proposicao` (`casa`,`id_externo`);--> statement-breakpoint
CREATE TABLE `proposicao_tema` (
	`proposicao_id` integer NOT NULL,
	`tema_id` integer NOT NULL,
	`relevancia` real,
	FOREIGN KEY (`proposicao_id`) REFERENCES `proposicao`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`tema_id`) REFERENCES `tema`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `proposicao_tema_uq` ON `proposicao_tema` (`proposicao_id`,`tema_id`);--> statement-breakpoint
CREATE TABLE `tema` (
	`id` integer PRIMARY KEY NOT NULL,
	`nome` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `votacao` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`casa` text NOT NULL,
	`id_externo` text NOT NULL,
	`orgao_id` integer,
	`proposicao_id` integer,
	`data` text NOT NULL,
	`descricao` text,
	`aprovacao` integer,
	`nominal` integer NOT NULL,
	`secreta` integer DEFAULT false NOT NULL,
	`total_sim` integer,
	`total_nao` integer,
	`total_abstencao` integer,
	`fonte_url` text NOT NULL,
	`coletado_em` text DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')) NOT NULL,
	FOREIGN KEY (`orgao_id`) REFERENCES `orgao`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposicao_id`) REFERENCES `proposicao`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `votacao_uq` ON `votacao` (`casa`,`id_externo`);--> statement-breakpoint
CREATE INDEX `votacao_data_idx` ON `votacao` (`data`);--> statement-breakpoint
CREATE INDEX `votacao_elegivel_idx` ON `votacao` (`nominal`,`secreta`,`data`);--> statement-breakpoint
CREATE TABLE `voto` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`votacao_id` integer NOT NULL,
	`politico_id` integer NOT NULL,
	`partido_id` integer,
	`voto` text NOT NULL,
	`tipo_voto_original` text NOT NULL,
	`computavel` integer NOT NULL,
	`data_registro` text,
	FOREIGN KEY (`votacao_id`) REFERENCES `votacao`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`politico_id`) REFERENCES `politico`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`partido_id`) REFERENCES `partido`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `voto_uq` ON `voto` (`votacao_id`,`politico_id`);--> statement-breakpoint
CREATE INDEX `voto_politico_idx` ON `voto` (`politico_id`);--> statement-breakpoint
CREATE INDEX `voto_votacao_partido_idx` ON `voto` (`votacao_id`,`partido_id`,`voto`);