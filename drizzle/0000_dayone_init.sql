CREATE TABLE `blockers` (
	`id` text PRIMARY KEY NOT NULL,
	`journey_id` text NOT NULL,
	`task_id` text,
	`category` text DEFAULT 'environment' NOT NULL,
	`summary` text NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`resolved_at` text,
	FOREIGN KEY (`journey_id`) REFERENCES `journeys`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`task_id`) REFERENCES `journey_tasks`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "blockers_status_check" CHECK("blockers"."status" IN ('open', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE INDEX `idx_blockers_journey_status_created` ON `blockers` (`journey_id`,`status`,`created_at`);--> statement-breakpoint
CREATE INDEX `idx_blockers_journey_category` ON `blockers` (`journey_id`,`category`);--> statement-breakpoint
CREATE TABLE `doctor_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`journey_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text NOT NULL,
	`total_checks` integer NOT NULL,
	`passed_checks` integer NOT NULL,
	`blocked_checks` integer NOT NULL,
	`duration_ms` integer,
	`results_json` text DEFAULT '[]' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`journey_id`) REFERENCES `journeys`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "doctor_runs_status_check" CHECK("doctor_runs"."status" IN ('healthy', 'blocked', 'error'))
);
--> statement-breakpoint
CREATE INDEX `idx_doctor_runs_journey_created` ON `doctor_runs` (`journey_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `idx_doctor_runs_journey_idempotency` ON `doctor_runs` (`journey_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `guide_sources` (
	`id` text PRIMARY KEY NOT NULL,
	`project_key` text NOT NULL,
	`topic` text NOT NULL,
	`title` text NOT NULL,
	`type` text NOT NULL,
	`locator` text NOT NULL,
	`excerpt` text NOT NULL,
	`priority` integer DEFAULT 100 NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	CONSTRAINT "guide_sources_type_check" CHECK("guide_sources"."type" IN ('repository', 'runbook', 'person', 'architecture'))
);
--> statement-breakpoint
CREATE INDEX `idx_guide_sources_project_topic_priority` ON `guide_sources` (`project_key`,`topic`,`priority`);--> statement-breakpoint
CREATE TABLE `journey_steps` (
	`id` text PRIMARY KEY NOT NULL,
	`journey_id` text NOT NULL,
	`slug` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`status` text DEFAULT 'locked' NOT NULL,
	`position` integer NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`journey_id`) REFERENCES `journeys`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "journey_steps_status_check" CHECK("journey_steps"."status" IN ('active', 'complete', 'blocked', 'locked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_journey_steps_journey_slug` ON `journey_steps` (`journey_id`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_journey_steps_journey_position` ON `journey_steps` (`journey_id`,`position`);--> statement-breakpoint
CREATE TABLE `journey_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`journey_id` text NOT NULL,
	`step_id` text NOT NULL,
	`slug` text NOT NULL,
	`label` text NOT NULL,
	`detail` text NOT NULL,
	`command` text,
	`status` text DEFAULT 'ready' NOT NULL,
	`position` integer NOT NULL,
	`required` integer DEFAULT true NOT NULL,
	`completed_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`journey_id`) REFERENCES `journeys`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`step_id`) REFERENCES `journey_steps`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "journey_tasks_status_check" CHECK("journey_tasks"."status" IN ('ready', 'done', 'blocked'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_journey_tasks_journey_slug` ON `journey_tasks` (`journey_id`,`slug`);--> statement-breakpoint
CREATE INDEX `idx_journey_tasks_step_position` ON `journey_tasks` (`step_id`,`position`);--> statement-breakpoint
CREATE INDEX `idx_journey_tasks_journey_status` ON `journey_tasks` (`journey_id`,`status`);--> statement-breakpoint
CREATE TABLE `journeys` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_id` text NOT NULL,
	`project_key` text NOT NULL,
	`project_name` text NOT NULL,
	`repository` text NOT NULL,
	`branch` text DEFAULT 'main' NOT NULL,
	`active_step` text DEFAULT 'get-access' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`started_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`target_date` text,
	`first_mr_url` text,
	`first_mr_recorded_at` text,
	`completed_at` text,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "journeys_status_check" CHECK("journeys"."status" IN ('active', 'complete', 'paused'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_journeys_profile_project` ON `journeys` (`profile_id`,`project_key`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`display_name` text NOT NULL,
	`role` text DEFAULT 'Frontend Engineer' NOT NULL,
	`team` text DEFAULT 'Repository' NOT NULL,
	`buddy_name` text DEFAULT 'Repository maintainer' NOT NULL,
	`buddy_email` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `services` (
	`id` text PRIMARY KEY NOT NULL,
	`project_key` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`description` text NOT NULL,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_services_project_name` ON `services` (`project_key`,`name`);--> statement-breakpoint
CREATE INDEX `idx_services_project_position` ON `services` (`project_key`,`position`);
