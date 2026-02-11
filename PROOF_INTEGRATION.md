# Inference Proof Integration

## Overview

Oracle이 Petals 노드로부터 추론 증명(inference proof)을 받아 저장하고, 검증된 증명 데이터를 스코어링에 활용하는 시스템입니다.

**중요**: Oracle은 `verifyInference(0x20)` precompile을 직접 호출하지 않습니다. 체인의 fork 이후에는 호출자(caller)가 agent 본인이어야 하므로, **Petals 노드가 자체적으로 0x20을 호출하여 검증**하고, Oracle은 증명 기록을 관리합니다.

## Architecture

```
Petals Node
    ├─> 추론 수행
    ├─> proof 생성 (modelHash, inputHash, outputHash, tokenCount)
    ├─> Oracle에 metrics + proofs 전송 (저장용)
    └─> 0x20 precompile 직접 호출 (self-verification)

Oracle
    ├─> proof 수신 및 DB 저장
    ├─> proof 통계 계산
    ├─> verified proofs 기반 scoring 강화
    └─> API 제공 (proof 조회)
```

## Database Schema

### `inference_proofs` 테이블

```typescript
{
  id: number (PK)
  agentAddress: string (varchar 42)
  epoch: number
  modelHash: string (varchar 66)
  inputHash: string (varchar 66)
  outputHash: string (varchar 66)
  tokenCount: string (bigint)
  verified: boolean (default: false)
  verificationTxHash: string (nullable)
  createdAt: Date
  verifiedAt: Date (nullable)
}
```

**Indexes:**
- `(agentAddress, epoch)`
- `(agentAddress, verified)`
- `modelHash`
- `createdAt`

## API Endpoints

### 1. POST `/api/metrics` 또는 `/api/v1/metrics/report`

Petals 노드가 metrics와 함께 proofs를 제출합니다.

**Request Body (ReportMetricsDto):**
```json
{
  "wallet": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
  "tokensProcessed": 1500,
  "avgLatencyMs": 250,
  "requestCount": 10,
  "uptimeSeconds": 3600,
  "timestamp": 1739217600,
  "signature": "0x...",
  "proofs": [
    {
      "modelHash": "0x1234...",
      "inputHash": "0x5678...",
      "outputHash": "0x9abc...",
      "tokenCount": 150
    }
  ]
}
```

**Response:**
```json
{
  "success": true,
  "message": "Metrics recorded successfully",
  "shouldReset": false
}
```

### 2. GET `/api/v1/proofs/:address`

특정 agent의 proof 목록을 조회합니다.

**Query Parameters:**
- `limit` (optional): 1-1000, default 100
- `verified` (optional): "true" | "false", verified만 필터링

**Response:**
```json
{
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
  "count": 25,
  "proofs": [
    {
      "id": 123,
      "epoch": 42,
      "modelHash": "0x1234...",
      "inputHash": "0x5678...",
      "outputHash": "0x9abc...",
      "tokenCount": "150",
      "verified": true,
      "verificationTxHash": "0xdef0...",
      "createdAt": "2026-02-11T12:00:00Z",
      "verifiedAt": "2026-02-11T12:05:00Z"
    }
  ]
}
```

### 3. GET `/api/v1/proofs/:address/stats`

Agent의 proof 통계를 조회합니다.

**Query Parameters:**
- `epoch` (optional): 특정 epoch만 조회

**Response:**
```json
{
  "address": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
  "epoch": 42,
  "totalProofs": 100,
  "verifiedProofs": 95,
  "pendingProofs": 5,
  "verifiedTokens": "14250",
  "verificationRate": 95.0
}
```

## Scoring Enhancement

ScorerService가 agent의 score 계산 시 verified proofs를 활용합니다:

```typescript
// 기존: metrics에서 tokensProcessed 사용
processedTokens = BigInt(metrics.tokensProcessed)

// 개선: verified proofs에서 실제 검증된 token 수 사용
verifiedTokens = await proofService.getVerifiedTokenCount(agent, epoch)
if (verifiedTokens > processedTokens) {
  processedTokens = verifiedTokens  // 더 신뢰할 수 있는 값 우선
}
```

`AgentScore` interface에 새 필드 추가:
- `verifiedTokens?: bigint` - 온체인 검증된 token 수
- `proofVerificationRate?: number` - 검증률 (0-100%)

## Implementation Files

### 신규 파일

1. **Entity**: `/src/entities/inference-proof.entity.ts`
   - TypeORM entity 정의

2. **DTO**: `/src/modules/proof/dto/inference-proof.dto.ts`
   - Proof 데이터 validation

3. **Service**: `/src/modules/proof/proof.service.ts`
   - Proof CRUD 로직
   - 통계 계산

4. **Module**: `/src/modules/proof/proof.module.ts`
   - NestJS module 등록

### 수정된 파일

1. **`/src/entities/index.ts`**
   - InferenceProof entity export 추가

2. **`/src/modules/metrics/dto/report-metrics.dto.ts`**
   - `proofs?: InferenceProofDto[]` 필드 추가

3. **`/src/modules/metrics/metrics.service.ts`**
   - ProofService 주입
   - proof 저장 로직 추가

4. **`/src/modules/metrics/metrics.module.ts`**
   - ProofModule import

5. **`/src/modules/metrics/metrics.controller.ts`**
   - ProofService 주입
   - `/api/v1/proofs/:address` endpoint 추가
   - `/api/v1/proofs/:address/stats` endpoint 추가

6. **`/src/modules/scorer/scorer.service.ts`**
   - ProofService, ChainService 활용
   - verified proofs 기반 scoring

7. **`/src/modules/scorer/scorer.module.ts`**
   - ProofModule, ChainModule import

8. **`/src/app.module.ts`**
   - ProofModule 추가
   - InferenceProof entity 등록
   - ScorerService에 ChainService 주입

## Proof Verification Flow

### 1. Petals 노드 (자체 검증)

```typescript
// 추론 완료 후
const proof = {
  modelHash: keccak256(modelId),
  inputHash: keccak256(input),
  outputHash: keccak256(output),
  tokenCount: output.length
};

// 1. Oracle에 저장용으로 전송
await fetch('http://oracle/api/metrics', {
  method: 'POST',
  body: JSON.stringify({ ...metrics, proofs: [proof] })
});

// 2. 체인에 직접 검증 요청
const precompile = '0x0000000000000000000000000000000000000020';
const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
  ['bytes32', 'bytes32', 'bytes32', 'address', 'uint256'],
  [proof.modelHash, proof.inputHash, proof.outputHash, agentAddress, proof.tokenCount]
);
const tx = await wallet.sendTransaction({ to: precompile, data: encoded });
```

### 2. Oracle (기록 관리)

```typescript
// 1. Proof 저장
await proofService.saveProof(agentAddress, epoch, proof);

// 2. (선택) 노드가 검증 완료 후 알림을 보내면 verified 마킹
await proofService.markVerified(proofId, txHash);

// 3. Scoring 시 활용
const verifiedTokens = await proofService.getVerifiedTokenCount(agent, epoch);
```

## Migration

기존 데이터베이스에 새 테이블이 자동 생성됩니다 (TypeORM `synchronize: true` 설정).

**Production 배포 시 주의:**
- `synchronize: false`로 변경 권장
- 수동 migration 스크립트 작성 필요

## Testing

### 1. Proof 제출 테스트

```bash
curl -X POST http://localhost:3001/api/metrics \
  -H "Content-Type: application/json" \
  -d '{
    "wallet": "0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0",
    "tokensProcessed": 100,
    "avgLatencyMs": 200,
    "requestCount": 1,
    "uptimeSeconds": 60,
    "timestamp": 1739217600,
    "signature": "0x...",
    "proofs": [{
      "modelHash": "0x1234567890123456789012345678901234567890123456789012345678901234",
      "inputHash": "0x2345678901234567890123456789012345678901234567890123456789012345",
      "outputHash": "0x3456789012345678901234567890123456789012345678901234567890123456",
      "tokenCount": 100
    }]
  }'
```

### 2. Proof 조회 테스트

```bash
# 전체 조회
curl http://localhost:3001/api/v1/proofs/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0

# Verified만 조회
curl http://localhost:3001/api/v1/proofs/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0?verified=true

# 통계 조회
curl http://localhost:3001/api/v1/proofs/0x742d35Cc6634C0532925a3b844Bc9e7595f0bEb0/stats
```

## Future Enhancements

1. **Webhook for verification callbacks**
   - Petals 노드가 검증 완료 후 Oracle에 알림
   - `POST /api/v1/proofs/:id/verify` endpoint

2. **Batch verification tracking**
   - 여러 proof를 한 번에 검증하는 경우 추적

3. **Proof challenge system**
   - 잘못된 proof 신고 메커니즘

4. **Verification reward calculation**
   - 검증률 기반 추가 보상 로직

## Notes

- **중요**: 0x20 precompile은 caller === agent 검증을 수행하므로, Oracle이 아닌 agent 본인이 호출해야 합니다.
- Proof는 비동기적으로 검증됩니다 (노드가 제출 → 나중에 검증 → Oracle에 상태 업데이트).
- `verified` 플래그가 false인 proof는 아직 온체인 검증이 완료되지 않은 상태입니다.
- Scoring 시 verifiedTokens > processedTokens인 경우 verifiedTokens를 우선 사용하여 더 신뢰할 수 있는 데이터 활용.
