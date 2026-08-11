DROP INDEX `politico_cpf_uq`;--> statement-breakpoint
ALTER TABLE `politico` ADD `cpf_hmac` text;--> statement-breakpoint
CREATE UNIQUE INDEX `politico_cpf_uq` ON `politico` (`cpf_hmac`);