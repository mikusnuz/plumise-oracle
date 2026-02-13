-- Migration: Add lastRawTokens and lastRawRequests columns to inference_metrics
-- Date: 2026-02-13
-- Description: Store agent's actual last raw cumulative values separately from
--   the accumulated delta sum (tokensProcessed). Fixes onModuleInit restoration
--   flaw where using tokensProcessed caused false reset detection after Oracle restart.
-- Ref: Security Audit 3rd round, Finding #1 (High)

ALTER TABLE `inference_metrics`
  ADD COLUMN `lastRawTokens` bigint NOT NULL DEFAULT 0
    COMMENT 'Agent last reported cumulative token count (not delta sum)',
  ADD COLUMN `lastRawRequests` int NOT NULL DEFAULT 0
    COMMENT 'Agent last reported cumulative request count (not delta sum)';
