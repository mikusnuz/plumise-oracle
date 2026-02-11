# Plumise Oracle

Contribution proof oracle for Plumise AI chain - monitors AI agents, creates challenges, calculates contribution scores, and reports them on-chain.

## Overview

The Plumise Oracle is a NestJS service that acts as the automated oracle for the Plumise AI chain. It performs the following tasks:

- **Agent Monitoring**: Tracks agent registrations, heartbeats, and activity
- **Challenge Automation**: Creates and manages AI agent challenges
- **Inference Metrics Collection**: Receives and stores inference metrics from Petals nodes
- **Contribution Scoring**: Calculates scores based on tasks, uptime, response time, tokens processed, and latency
- **On-chain Reporting**: Reports contributions to RewardPool contract (V2 format)
- **Epoch Distribution**: Triggers reward distribution at epoch boundaries

## Architecture

```
src/
├── modules/
│   ├── chain/         # Web3 provider & contract instances
│   ├── monitor/       # Agent activity monitoring
│   ├── metrics/       # Inference metrics collection & storage
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
- Oracle wallet private key (must be set as oracle in RewardPool)

### Installation

```bash
yarn install
```

### Configuration

Copy `.env.example` to `.env` and configure:

```env
# Chain
RPC_URL=https://node-1.plumise.com/rpc
WS_URL=wss://node-1.plumise.com/ws
CHAIN_ID=41956

# Oracle wallet (must be set as oracle in RewardPool)
ORACLE_PRIVATE_KEY=your_private_key_here

# Contract Addresses
AGENT_REGISTRY_ADDRESS=0x...
REWARD_POOL_ADDRESS=0x0000000000000000000000000000000000001000
CHALLENGE_MANAGER_ADDRESS=0x...

# Intervals
MONITOR_INTERVAL_MS=30000
CHALLENGE_INTERVAL_MS=600000
REPORT_INTERVAL_BLOCKS=1200

# Logging
LOG_LEVEL=debug
NODE_ENV=development
```

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
score = (tokenScore × 40) + (taskCount × 25) + (uptimeSeconds × 20) + (latencyScore × 15)

where:
  tokenScore = processedTokens / 1000
  latencyScore = avgLatencyInv (higher is better, max(0, 10000 - avgLatencyMs))
```

**Weights**:
- **Tokens Processed**: 40% (primary metric for inference workload)
- **Task Count**: 25% (challenges solved)
- **Uptime**: 20% (agent availability)
- **Latency**: 15% (response speed, inverted)

**Metrics**:
- `processedTokens`: Total tokens processed by the agent (from Petals)
- `taskCount`: Number of challenges solved
- `uptimeSeconds`: Time since last heartbeat gap
- `responseScore`: Average challenge solve time (100 - avgSolveTime)
- `avgLatencyInv`: Inverse latency score (10000 - avgLatencyMs)

## API Endpoints

### Inference Metrics

#### POST `/api/v1/metrics/report`
Report inference metrics from Petals nodes.

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

#### GET `/api/v1/metrics/agents/:address`
Get current epoch metrics for an agent.

#### GET `/api/v1/metrics/agents/:address/history?limit=50`
Get historical metrics across epochs.

#### GET `/api/v1/metrics/summary`
Get network-wide inference metrics summary.

### Agent & Contribution Data

#### GET `/api/stats`
Network statistics (block number, active agents, current epoch).

#### GET `/api/agents`
List all registered agents.

#### GET `/api/agents/:address`
Get agent details and contribution history.

#### GET `/api/rewards/:address`
Get pending rewards and contributions.

#### GET `/api/formula`
Get current reward formula weights from RewardPool contract.

## Testing Inference Metrics

Run the test script to simulate a Petals node reporting metrics:

```bash
# Start oracle in dev mode
npm run start:dev

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

## License

MIT
