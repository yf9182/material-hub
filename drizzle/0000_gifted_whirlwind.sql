CREATE TABLE `api_keys` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`name` text NOT NULL,
	`prefix` text NOT NULL,
	`secret_hash` text NOT NULL,
	`last_used_at` integer,
	`revoked_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `api_keys_hash_uq` ON `api_keys` (`secret_hash`);--> statement-breakpoint
CREATE INDEX `api_keys_product_idx` ON `api_keys` (`product_id`,`revoked_at`);--> statement-breakpoint
CREATE TABLE `assets` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`material_id` text,
	`role` text NOT NULL,
	`r2_key` text NOT NULL,
	`source_url` text,
	`file_name` text NOT NULL,
	`content_type` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`hash` text,
	`width` integer,
	`height` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `assets_material_role_idx` ON `assets` (`material_id`,`role`);--> statement-breakpoint
CREATE INDEX `assets_hash_idx` ON `assets` (`product_id`,`hash`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text,
	`actor_email` text NOT NULL,
	`action` text NOT NULL,
	`target_type` text NOT NULL,
	`target_id` text NOT NULL,
	`changes` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_events_product_idx` ON `audit_events` (`product_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `categories` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`parent_id` text,
	`external_id` text,
	`name` text NOT NULL,
	`code` text NOT NULL,
	`config` text DEFAULT '' NOT NULL,
	`translations` text NOT NULL,
	`marks` text NOT NULL,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`archived_at` integer,
	`material_latest_update_time` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `categories_product_external_uq` ON `categories` (`product_id`,`external_id`);--> statement-breakpoint
CREATE INDEX `categories_parent_idx` ON `categories` (`product_id`,`parent_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `import_items` (
	`id` text PRIMARY KEY NOT NULL,
	`job_id` text NOT NULL,
	`external_id` text,
	`item_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payload` text NOT NULL,
	`result` text,
	`attempts` integer DEFAULT 0 NOT NULL,
	`error` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`job_id`) REFERENCES `import_jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `import_items_job_idx` ON `import_items` (`job_id`,`status`);--> statement-breakpoint
CREATE TABLE `import_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`mode` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`source_label` text NOT NULL,
	`manifest` text NOT NULL,
	`summary` text NOT NULL,
	`created_by` text NOT NULL,
	`completed_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `import_jobs_product_idx` ON `import_jobs` (`product_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `material_categories` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`material_id` text NOT NULL,
	`category_id` text NOT NULL,
	`external_relation_id` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`listing_status` integer DEFAULT 1 NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`material_id`) REFERENCES `materials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`category_id`) REFERENCES `categories`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `material_categories_pair_uq` ON `material_categories` (`material_id`,`category_id`);--> statement-breakpoint
CREATE INDEX `material_categories_category_idx` ON `material_categories` (`category_id`,`sort_order`);--> statement-breakpoint
CREATE TABLE `materials` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`external_material_id` text,
	`source_key` text DEFAULT 'manual' NOT NULL,
	`internal_name` text NOT NULL,
	`title_translations` text NOT NULL,
	`activity_translations` text NOT NULL,
	`material_config_raw` text DEFAULT '{}' NOT NULL,
	`material_config_json` text,
	`source_snapshot` text NOT NULL,
	`manual_overrides` text NOT NULL,
	`min_version` text DEFAULT '' NOT NULL,
	`max_version` text DEFAULT '' NOT NULL,
	`is_free` integer DEFAULT 0 NOT NULL,
	`listing_status` integer DEFAULT 1 NOT NULL,
	`publish_status` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `materials_source_external_uq` ON `materials` (`product_id`,`source_key`,`external_material_id`);--> statement-breakpoint
CREATE INDEX `materials_product_status_idx` ON `materials` (`product_id`,`status`,`updated_at`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`external_pid` text NOT NULL,
	`name` text NOT NULL,
	`channel` text DEFAULT 'English' NOT NULL,
	`source` text DEFAULT 'English' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`archived_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_external_pid_uq` ON `products` (`external_pid`);