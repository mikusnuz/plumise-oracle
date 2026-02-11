-- Migration: Add agent_nodes table for multi-node support
-- Date: 2026-02-11
-- Description: Stores information about distributed AI nodes reporting metrics to the oracle

CREATE TABLE IF NOT EXISTS `agent_nodes` (
  `address` varchar(42) NOT NULL,
  `endpoint` varchar(255) NOT NULL COMMENT 'Node inference endpoint URL',
  `capabilities` json NOT NULL COMMENT 'Array of capabilities: ["text-generation", "image-generation", etc]',
  `status` enum('active','inactive','slashed') NOT NULL DEFAULT 'inactive',
  `score` float NOT NULL DEFAULT 0 COMMENT 'Computed contribution score',
  `lastHeartbeat` bigint NOT NULL COMMENT 'Unix timestamp of last heartbeat',
  `lastMetricReport` bigint NOT NULL COMMENT 'Unix timestamp of last metric report',
  `registrationSignature` varchar(66) DEFAULT NULL COMMENT 'Signature from node registration',
  `createdAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updatedAt` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  PRIMARY KEY (`address`),
  KEY `idx_status` (`status`),
  KEY `idx_lastHeartbeat` (`lastHeartbeat`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
