# Plumise Oracle

**[English](README.md) | [한국어](README.ko.md)**

Contribution proof oracle for Plumise AI chain -- monitors AI agents, collects inference metrics, calculates contribution scores, and reports rewards on-chain.

This is a **team-operated service**. It acts as the bridge between Petals inference nodes and the Plumise blockchain, aggregating off-chain metrics into on-chain contribution records that determine PLM reward distribution.

## Overview

The Plumise Oracle performs the following tasks:

- **Agent Monitoring**: Tracks agent registrations, heartbeats, and activity
- **Node Management**: Maintains a registry of active inference nodes (used by API Gateway)
- **Challenge Automation**: Creates and manages AI agent challenges
- **Inference Metrics Collection**: Receives signed metrics from Petals nodes, validates signatures
- **Inference Proof Verification**: Receives and stores inference proofs from Petals nodes, enriches scoring
- **Contribution Scoring**: Calculates scores using the V2 weighted formula (enriched with proof data)
- **On-chain Reporting**: Reports contribution scores to RewardPool via precompile 0x23
- **Epoch Distribution**: Triggers reward distribution at epoch boundaries

## Architecture

```
+-------------------+     +-------------------+     +-------------------+
|  Petals Node A    |     |  Petals Node B    |     |  Petals Node C    |
|  (signed metrics) |     |  (signed metrics) |     |  (signed metrics) |
+--------+----------+     +--------+----------+     +--------+----------+
         |                         |                         |
         v                         v                         v
+--------+-------------------------+-------------------------+--------+
|                        Plumise Oracle (this service)                 |
|                                                                      |
|  +----------+  +----------+  +----------+  +-----------+             |
|  | Metrics  |  | Scorer   |  | Reporter |  | Distribu- |             |
|  | Module   |  | Module   |  | Module   |  | tor Module|             |
|  +----------+  +----------+  +----------+  +-----------+             |
|  +----------+  +----------+  +----------+  +-----------+             |
|  | Monitor  |  | Challenge|  | Sync     |  | API       |             |
|  | Module   |  | Module   |  | Module   |  | Module    |             |
|  +----------+  +----------+  +----------+  +-----------+             |
|  +----------+                                                        |
|  | Proof    |  (receives, stores, and queries inference proofs)       |
|  | Module   |                                                        |
|  +----------+                                                        |
+------------------+-------------------------------------+-------------+
                   |                                     |
                   v                                     v
           +-------+--------+                   +--------+-------+
           | RewardPool     |                   | Inference API  |
           | (on-chain)     |                   | (Gateway)      |
           | precompile 0x23|                   | node list API  |
           +----------------+                   +----------------+
```

For the full ecosystem architecture, see [plumise-petals/docs/ARCHITECTURE.md](https://github.com/mikusnuz/plumise-petals/blob/main/docs/ARCHITECTURE.md).

## Module Structure

```
src/
├── modules/
│   ├── chain/         # Web3 provider & contract instances
│   ├── monitor/       # Agent activity monitoring
│   ├── metrics/       # Inference metrics collection & storage
│   ├── proof/         # Inference proof verification & storage
│   ├── scorer/        # Contribution score calculation (V2 formula)
│   ├── reporter/      # On-chain contribution reporting (V2)
│   ├── challenge/     # Challenge creation & tracking
│   ├── distributor/   # Epoch reward distribution
│   ├── sync/          # Blockchain event synchronization
│   └── api/           # REST API endpoints
├── entities/          # TypeORM database entities
├── contracts/         # Contract ABI files
├── config/            # Chain configuration
└── utils/             # Logging utilities
```

## Setup

### Prerequisites

- Node.js 18+
- Yarn
- MySQL database
- Oracle wallet private key (must be set as oracle in RewardPool)

### Installation

```bash
yarn install
```

### Configuration

Copy `.env.example` to `.env` and configure:

| Variable | Default | Description |
|---|---|---|
| `RPC_URL` | `https://node-1.plumise.com/rpc` | Plumise chain RPC endpoint |
| `WS_URL` | `wss://node-1.plumise.com/ws` | Plumise chain WebSocket endpoint |
| `CHAIN_ID` | `41956` | Plumise chain ID |
| `ORACLE_PRIVATE_KEY` | -- | **Required.** Oracle wallet private key |
| `AGENT_REGISTRY_ADDRESS` | -- | AgentRegistry contract address |
| `REWARD_POOL_ADDRESS` | `0x...1000` | RewardPool contract address |
| `CHALLENGE_MANAGER_ADDRESS` | -- | ChallengeManager contract address |
| `MONITOR_INTERVAL_MS` | `30000` | Agent monitoring interval |
| `CHALLENGE_INTERVAL_MS` | `600000` | Challenge creation interval |
| `REPORT_INTERVAL_BLOCKS` | `1200` | On-chain reporting interval (blocks) |
| `DB_HOST` | `localhost` | MySQL host |
| `DB_PORT` | `15411` | MySQL port |
| `DB_USERNAME` | `root` | MySQL username |
| `DB_PASSWORD` | -- | MySQL password |
| `DB_DATABASE` | `plumise_dashboard` | MySQL database name |
| `API_PORT` | `15481` | Oracle API server port |
| `LOG_LEVEL` | `debug` | Log level |

## Running

### Development

```bash
yarn start:dev
```

### Production

```bash
yarn build
yarn start:prod
```

## Contract Addresses (v2 chain, chainId: 41956)

- **RewardPool**: `0x0000000000000000000000000000000000001000`
- **AgentRegistry**: TBD (post-genesis)
- **ChallengeManager**: TBD (post-genesis)

## Scoring Formula (V2)

Agent contribution scores are calculated using a weighted formula that reflects AI inference workload:

```
score = (tokenScore x 40) + (taskCount x 25) + (uptimeSeconds x 20) + (latencyScore x 15)

where:
  tokenScore = processedTokens / 1000
  latencyScore = max(0, 10000 - avgLatencyMs)
```

**Weights**:
- **Tokens Processed**: 40% (primary metric for inference workload)
- **Task Count**: 25% (challenges solved)
- **Uptime**: 20% (agent availability)
- **Latency**: 15% (response speed, inverted -- lower latency = higher score)

## Inference Proof Verification

The Oracle receives inference proofs from Petals nodes, stores them, and uses them to enrich contribution scoring. This provides a verifiable record of actual AI work performed by each agent.

**Proof Flow:**

1. Petals node completes an inference and generates a proof hash: `keccak256(modelHash || inputHash || outputHash || agentAddress)`
2. The signed proof is submitted to the Oracle via `POST /api/v1/proofs/submit`
3. Oracle validates the signature and stores the proof with metadata (model, timestamp, agent)
4. During scoring, proof count and validity are factored into the agent's contribution score
5. Proofs can be queried per agent or by time range for audit purposes

**Scoring Enrichment:**

Agents with a higher ratio of valid proofs receive a scoring bonus. This discourages fake metric reporting -- without corresponding proofs, inflated metrics are penalized.

## API Endpoints

### Node Management

These endpoints are consumed by the Inference API Gateway for node discovery and routing.

#### POST `/api/nodes/register`
Register a node with the oracle. Nodes must be registered on-chain first.

**Request Body**:
```json
{
  "address": "0x...",
  "endpoint": "http://my-server:31330",
  "capabilities": ["text-generation"],
  "timestamp": 1707645600,
  "signature": "0x..."
}
```

**Signature**: Sign the JSON payload (without signature field) with node's private key using `ethers.signMessage()`.

#### GET `/api/nodes`
Get list of all active nodes. **Used by Inference API Gateway for request routing.**

**Response**:
```json
{
  "count": 3,
  "nodes": [
    {
      "address": "0x...",
      "endpoint": "http://server1:31330",
      "status": "active",
      "score": 85.2,
      "lastHeartbeat": "1707645600",
      "capabilities": ["text-generation"]
    }
  ]
}
```

**Active Criteria**: Last heartbeat within 10 minutes AND on-chain heartbeat active.

#### GET `/api/nodes/:address`
Get detailed information for a specific node.

#### GET `/api/agents/active`
Get all agents with active status (status = 1).

### Inference Metrics

#### POST `/api/metrics`
Report inference metrics (simple endpoint with optional API key).

**Headers** (optional): `x-api-key: your-oracle-api-key`

#### POST `/api/v1/metrics/report`
Report inference metrics from Petals nodes with signature verification.

**Request Body**:
```json
{
  "wallet": "0x...",
  "tokensProcessed": 50000,
  "avgLatencyMs": 250.5,
  "requestCount": 100,
  "uptimeSeconds": 3600,
  "signature": "0x..."
}
```

**Signature**: Sign the JSON payload (without signature field) with agent's private key using `ethers.signMessage()`.

**Validation**:
- Signature must match wallet address
- Agent must be registered on-chain

#### GET `/api/v1/metrics/agents/:address`
Get current epoch metrics for an agent.

**Query Params**: `?epoch=5` (optional, defaults to current epoch)

#### GET `/api/v1/metrics/agents/:address/history`
Get historical metrics across epochs.

**Query Params**: `?limit=50` (optional, default 50)

#### GET `/api/v1/metrics/summary`
Get network-wide inference metrics summary.

### Inference Proofs

#### POST `/api/v1/proofs/submit`
Submit an inference proof from a Petals node.

**Request Body**:
```json
{
  "agent": "0x...",
  "proofHash": "0x...",
  "modelHash": "0x...",
  "inputHash": "0x...",
  "outputHash": "0x...",
  "timestamp": 1707645600,
  "signature": "0x..."
}
```

**Signature**: Sign the proof payload (without signature field) with the agent's private key.

#### GET `/api/v1/proofs/agent/:address`
Get proofs submitted by a specific agent.

**Query Params**: `?limit=50&offset=0&from=1707600000&to=1707700000` (all optional)

**Response**:
```json
{
  "count": 128,
  "proofs": [
    {
      "proofHash": "0x...",
      "modelHash": "0x...",
      "agent": "0x...",
      "timestamp": 1707645600,
      "verified": true
    }
  ]
}
```

#### GET `/api/v1/proofs/stats`
Get network-wide proof statistics.

**Response**:
```json
{
  "totalProofs": 5240,
  "uniqueAgents": 12,
  "proofsLast24h": 320,
  "verificationRate": 0.98
}
```

### Agent & Contribution Data

#### GET `/api/stats`
Network statistics (block number, active agents, current epoch).

#### GET `/api/agents`
List all registered agents (ordered by registration date, DESC).

#### GET `/api/agents/:address`
Get agent details and contribution history (last 50 epochs).

#### GET `/api/epochs`
List recent epochs (last 50).

#### GET `/api/epochs/:number`
Get epoch details with per-agent contributions.

#### GET `/api/challenges`
List recent challenges (last 50).

#### GET `/api/challenges/current`
Get current active (unsolved, unexpired) challenge.

#### GET `/api/rewards/:address`
Get pending rewards and contribution history for an address.

#### GET `/api/formula`
Get current reward formula weights.

## Testing Inference Metrics

Run the test script to simulate a Petals node reporting metrics:

```bash
# Start oracle in dev mode
yarn start:dev

# In another terminal, run test script
npx ts-node test-inference-metrics.ts
```

The test script will:
1. Generate signed metrics payload
2. Report metrics to oracle
3. Fetch agent metrics
4. Fetch network summary
5. Send multiple incremental reports
6. Display final aggregated metrics

## Related Projects

| Project | Description | Link |
|---------|-------------|------|
| **plumise-petals** | AI inference node (users/miners install this) | [GitHub](https://github.com/mikusnuz/plumise-petals) |
| **plumise-inference-api** | API Gateway for end-user inference requests | [GitHub](https://github.com/mikusnuz/plumise-inference-api) |
| **plumise** | Plumise chain node (geth fork with AI precompiles) | [GitHub](https://github.com/mikusnuz/plumise) |
| **plumise-contracts** | On-chain system contracts (RewardPool, AgentRegistry, etc.) | [GitHub](https://github.com/mikusnuz/plumise-contracts) |

## License

MIT
