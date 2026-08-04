-- Classificação de discurso por natureza do ato (ver src/lib/classificar.ts).
--
-- As colunas entram com DEFAULT porque o SQLite não aceita ADD COLUMN NOT NULL
-- sem default em tabela populada. O default é provisório e conservador — tudo
-- nasce como "substantivo"/pendente, para que nada seja ocultado por acidente.
--
-- A regra real NÃO é reproduzida aqui de propósito: duplicá-la em SQL criaria
-- duas definições que divergem com o tempo. Ela vive só em TypeScript e é
-- aplicada por:
--   npm run ingerir -- --etapas reclassificar
ALTER TABLE `discurso` ADD `categoria` text NOT NULL DEFAULT 'substantivo';--> statement-breakpoint
ALTER TABLE `discurso` ADD `relevante` integer NOT NULL DEFAULT 1;--> statement-breakpoint
ALTER TABLE `discurso` ADD `classificacao_versao` text NOT NULL DEFAULT 'pendente';--> statement-breakpoint
CREATE INDEX `discurso_relevante_idx` ON `discurso` (`politico_id`,`relevante`,`data_hora_inicio`);