-- Corrige a chave de deduplicação de discurso.
--
-- (politico_id, data_hora_inicio) NÃO é única: um parlamentar registra falas
-- distintas no mesmo minuto (Bibo Nunes tem duas em 2025-05-05T23:04). A chave
-- antiga descartava 5 discursos reais no 1º semestre de 2025.
--
-- A tabela é esvaziada porque o SQLite não aceita ADD COLUMN NOT NULL sem
-- default em tabela populada. Os discursos são recoletáveis:
--   npm run ingerir -- --etapas discursos --inicio 2025-01-01 --fim 2025-06-30
DELETE FROM `discurso`;--> statement-breakpoint
DROP INDEX `discurso_uq`;--> statement-breakpoint
ALTER TABLE `discurso` ADD `chave_conteudo` text NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `discurso_uq` ON `discurso` (`politico_id`,`chave_conteudo`);