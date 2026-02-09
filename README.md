# Plumise Oracle

Contribution proof oracle for Plumise AI chain - monitors AI agents, creates challenges, calculates contribution scores, and reports them on-chain.

## Overview

The Plumise Oracle is a NestJS service that acts as the automated oracle for the Plumise AI chain. It performs the following tasks:

- **Agent Monitoring**: Tracks agent registrations, heartbeats, and activity
- **Challenge Automation**: Creates and manages AI agent challenges
- **Contribution Scoring**: Calculates scores based on tasks, uptime, and response time
- **On-chain Reporting**: Reports contributions to RewardPool contract
- **Epoch Distribution**: Triggers reward distribution at epoch boundaries

## Architecture

```
src/
├── modules/
│   ├── chain/         # Web3 provider & contract instances
│   ├── monitor/       # Agent activity monitoring
│   ├── scorer/        # Contribution score calculation
│   ├── reporter/      # On-chain contribution reporting
│   ├── challenge/     # Challenge creation & tracking
│   └── distributor/   # Epoch reward distribution
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

## Scoring Formula

Agent contribution scores are calculated as:

```
score = (taskCount × 50) + (uptimeSeconds × 30) + (responseScore × 20)
```

Where:
- `taskCount`: Number of challenges solved
- `uptimeSeconds`: Time since last heartbeat gap
- `responseScore`: Average challenge solve time (100 - avgSolveTime)

## License

MIT
