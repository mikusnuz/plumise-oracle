# Pipeline API Documentation

## Overview

The Pipeline module manages distributed inference layer assignments for the plumise-agent system. It replaces the Petals/hivemind architecture with a custom solution for assigning transformer layers to agent nodes based on their hardware capabilities.

## Endpoints

### POST /api/v1/pipeline/register

Register a node for pipeline inference.

**Request Body:**
```json
{
  "address": "0x...",
  "grpcEndpoint": "http://agent-1.example.com:50051",
  "httpEndpoint": "http://agent-1.example.com:8080",
  "model": "meta-llama/Llama-3.1-8B",
  "ramMb": 32768,
  "device": "cuda",
  "vramMb": 16384,
  "timestamp": 1707734400,
  "signature": "0x..."
}
```

**Signature Message:**
```json
{
  "address": "0x...",
  "grpcEndpoint": "http://...",
  "httpEndpoint": "http://...",
  "model": "meta-llama/Llama-3.1-8B",
  "ramMb": 32768,
  "device": "cuda",
  "vramMb": 16384,
  "timestamp": 1707734400
}
```

**Response:**
```json
{
  "success": true,
  "message": "Pipeline node registered successfully"
}
```

### POST /api/v1/pipeline/ready

Mark a node as ready to serve inference requests.

**Request Body:**
```json
{
  "address": "0x...",
  "model": "meta-llama/Llama-3.1-8B",
  "timestamp": 1707734400,
  "signature": "0x..."
}
```

**Signature Message:**
```json
{
  "address": "0x...",
  "model": "meta-llama/Llama-3.1-8B",
  "timestamp": 1707734400
}
```

**Response:**
```json
{
  "success": true,
  "message": "Pipeline node marked as ready"
}
```

### GET /api/v1/pipeline/topology?model={model_name}

Get the current pipeline topology for a specific model.

**Query Parameters:**
- `model` (required): Model name (e.g., "meta-llama/Llama-3.1-8B")

**Response:**
```json
{
  "model": "meta-llama/Llama-3.1-8B",
  "count": 3,
  "nodes": [
    {
      "id": 1,
      "nodeAddress": "0xaaa...",
      "modelName": "meta-llama/Llama-3.1-8B",
      "layerStart": 0,
      "layerEnd": 10,
      "totalLayers": 32,
      "grpcEndpoint": "http://agent-1.example.com:50051",
      "httpEndpoint": "http://agent-1.example.com:8080",
      "ramMb": 16384,
      "device": "cuda",
      "vramMb": 8192,
      "ready": true,
      "pipelineOrder": 0,
      "createdAt": "2026-02-12T08:00:00.000Z",
      "updatedAt": "2026-02-12T08:05:00.000Z"
    },
    {
      "id": 2,
      "nodeAddress": "0xbbb...",
      "modelName": "meta-llama/Llama-3.1-8B",
      "layerStart": 10,
      "layerEnd": 22,
      "totalLayers": 32,
      "grpcEndpoint": "http://agent-2.example.com:50051",
      "httpEndpoint": "http://agent-2.example.com:8080",
      "ramMb": 32768,
      "device": "cuda",
      "vramMb": 16384,
      "ready": true,
      "pipelineOrder": 1,
      "createdAt": "2026-02-12T08:01:00.000Z",
      "updatedAt": "2026-02-12T08:05:00.000Z"
    },
    {
      "id": 3,
      "nodeAddress": "0xccc...",
      "modelName": "meta-llama/Llama-3.1-8B",
      "layerStart": 22,
      "layerEnd": 32,
      "totalLayers": 32,
      "grpcEndpoint": "http://agent-3.example.com:50051",
      "httpEndpoint": "http://agent-3.example.com:8080",
      "ramMb": 16384,
      "device": "cuda",
      "vramMb": 8192,
      "ready": true,
      "pipelineOrder": 2,
      "createdAt": "2026-02-12T08:02:00.000Z",
      "updatedAt": "2026-02-12T08:05:00.000Z"
    }
  ]
}
```

## Layer Assignment Algorithm

### Supported Models

```typescript
const MODEL_LAYERS = {
  'bigscience/bloom-560m': 24,
  'meta-llama/Llama-3.1-8B': 32,
};
```

Default: 32 layers for unknown models.

### Assignment Logic

1. **Single Node**: Assigns all layers [0, totalLayers) to the node.

2. **Multiple Nodes**: Proportional distribution based on hardware:
   - For GPU nodes: Weight = `vramMb`
   - For CPU nodes: Weight = `ramMb`
   - Calculate each node's proportion: `weight / totalWeight`
   - Assign layers proportionally, with the last node getting any remainder

3. **No Weight Info**: Equal distribution across all nodes.

### Example

**3 Nodes for Llama-3.1-8B (32 layers):**
- Node A: VRAM=8GB → Weight=8192, Layers=[0, 10)
- Node B: VRAM=16GB → Weight=16384, Layers=[10, 22)
- Node C: VRAM=8GB → Weight=8192, Layers=[22, 32)

## Stale Node Cleanup

- **Cron Schedule**: Every 5 minutes
- **Timeout**: Nodes inactive for 10+ minutes are removed
- **Auto Re-assignment**: Layers are automatically reassigned after cleanup

## Security

- All mutations require EIP-712 signature verification
- On-chain agent registration verification via `agent_isAgentAccount` precompile
- Address normalization to lowercase

## Database Schema

```sql
CREATE TABLE pipeline_assignments (
  id INT PRIMARY KEY AUTO_INCREMENT,
  nodeAddress VARCHAR(42) NOT NULL,
  modelName VARCHAR(255) NOT NULL,
  layerStart INT NOT NULL,
  layerEnd INT NOT NULL,
  totalLayers INT NOT NULL,
  grpcEndpoint VARCHAR(255) NOT NULL,
  httpEndpoint VARCHAR(255) NOT NULL,
  ramMb BIGINT DEFAULT 0,
  device VARCHAR(50) DEFAULT 'cpu',
  vramMb BIGINT DEFAULT 0,
  ready BOOLEAN DEFAULT FALSE,
  pipelineOrder INT DEFAULT 0,
  createdAt DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6),
  updatedAt DATETIME(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX idx_nodeAddress (nodeAddress),
  INDEX idx_modelName (modelName),
  INDEX idx_ready (ready)
);
```
