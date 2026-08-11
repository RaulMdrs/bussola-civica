DROP INDEX `posicao_uq`;--> statement-breakpoint
ALTER TABLE `posicao` ADD `tema_id` integer REFERENCES tema(id);--> statement-breakpoint
CREATE UNIQUE INDEX `posicao_geral_uq` ON `posicao` (`politico_id`,`eixo_id`,`escopo`,`legislatura_numero`,`periodo_inicio`,`periodo_fim`) WHERE tema_id IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `posicao_tema_uq` ON `posicao` (`politico_id`,`eixo_id`,`escopo`,`legislatura_numero`,`periodo_inicio`,`periodo_fim`,`tema_id`) WHERE tema_id IS NOT NULL;--> statement-breakpoint
CREATE INDEX `posicao_tema_idx` ON `posicao` (`tema_id`,`escopo`);