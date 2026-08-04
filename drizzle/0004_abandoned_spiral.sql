DROP INDEX `posicao_uq`;--> statement-breakpoint
DROP INDEX `posicao_eixo_idx`;--> statement-breakpoint
ALTER TABLE `posicao` ADD `escopo` text DEFAULT 'merito' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `posicao_uq` ON `posicao` (`politico_id`,`eixo_id`,`escopo`,`legislatura_numero`,`periodo_inicio`,`periodo_fim`);--> statement-breakpoint
CREATE INDEX `posicao_eixo_idx` ON `posicao` (`eixo_id`,`escopo`,`legislatura_numero`);--> statement-breakpoint
ALTER TABLE `votacao` ADD `natureza` text;--> statement-breakpoint
ALTER TABLE `votacao` ADD `natureza_versao` text;--> statement-breakpoint
CREATE INDEX `votacao_natureza_idx` ON `votacao` (`natureza`,`nominal`);