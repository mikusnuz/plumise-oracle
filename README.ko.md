# Plumise Oracle

**[English](README.md) | [한국어](README.ko.md)**

Plumise AI 체인의 기여 증명 오라클 -- AI 에이전트를 모니터링하고, 추론 메트릭을 수집하며, 기여 점수를 산출하고, 온체인으로 보상을 보고합니다.

이 서비스는 **팀이 운영하는 서비스**입니다. Petals 추론 노드와 Plumise 블록체인 사이의 다리 역할을 하며, 오프체인 메트릭을 PLM 보상 분배를 결정하는 온체인 기여 기록으로 집계합니다.

## 개요

Plumise Oracle은 다음 작업을 수행합니다:

- **에이전트 모니터링**: 에이전트 등록, 하트비트, 활동 추적
- **노드 관리**: 활성 추론 노드 레지스트리 유지 (API Gateway에서 사용)
- **챌린지 자동화**: AI 에이전트 챌린지 생성 및 관리
- **추론 메트릭 수집**: Petals 노드에서 서명된 메트릭 수신 및 서명 검증
- **기여 스코어링**: V2 가중치 공식으로 점수 계산
- **온체인 보고**: 프리컴파일 0x23을 통해 RewardPool에 기여 점수 보고
- **에포크 분배**: 에포크 경계에서 보상 분배 트리거

## 아키텍처

```
+-------------------+     +-------------------+     +-------------------+
|  Petals Node A    |     |  Petals Node B    |     |  Petals Node C    |
|  (서명된 메트릭)   |     |  (서명된 메트릭)   |     |  (서명된 메트릭)   |
+--------+----------+     +--------+----------+     +--------+----------+
         |                         |                         |
         v                         v                         v
+--------+-------------------------+-------------------------+--------+
|                        Plumise Oracle (이 서비스)                     |
|                                                                      |
|  +----------+  +----------+  +----------+  +-----------+             |
|  | 메트릭   |  | 스코어러 |  | 리포터   |  | 분배      |             |
|  | 모듈     |  | 모듈     |  | 모듈     |  | 모듈      |             |
|  +----------+  +----------+  +----------+  +-----------+             |
|  +----------+  +----------+  +----------+  +-----------+             |
|  | 모니터   |  | 챌린지   |  | 동기화   |  | API       |             |
|  | 모듈     |  | 모듈     |  | 모듈     |  | 모듈      |             |
|  +----------+  +----------+  +----------+  +-----------+             |
+------------------+-------------------------------------+-------------+
                   |                                     |
                   v                                     v
           +-------+--------+                   +--------+-------+
           | RewardPool     |                   | Inference API  |
           | (온체인)        |                   | (게이트웨이)    |
           | precompile 0x23|                   | 노드 목록 API  |
           +----------------+                   +----------------+
```

전체 생태계 아키텍처는 [plumise-petals/docs/ARCHITECTURE.md](https://github.com/mikusnuz/plumise-petals/blob/main/docs/ARCHITECTURE.md)를 참조하세요.

## 모듈 구조

```
src/
├── modules/
│   ├── chain/         # Web3 프로바이더 및 컨트랙트 인스턴스
│   ├── monitor/       # 에이전트 활동 모니터링
│   ├── metrics/       # 추론 메트릭 수집 및 저장
│   ├── scorer/        # 기여 점수 계산 (V2 공식)
│   ├── reporter/      # 온체인 기여 보고 (V2)
│   ├── challenge/     # 챌린지 생성 및 추적
│   ├── distributor/   # 에포크 보상 분배
│   ├── sync/          # 블록체인 이벤트 동기화
│   └── api/           # REST API 엔드포인트
├── entities/          # TypeORM 데이터베이스 엔티티
├── contracts/         # 컨트랙트 ABI 파일
├── config/            # 체인 설정
└── utils/             # 로깅 유틸리티
```

## 설정

### 사전 요구사항

- Node.js 18+
- Yarn
- MySQL 데이터베이스
- Oracle 지갑 프라이빗 키 (RewardPool에서 oracle로 설정 필요)

### 설치

```bash
yarn install
```

### 환경 설정

`.env.example`을 `.env`로 복사하고 설정합니다:

| 변수 | 기본값 | 설명 |
|---|---|---|
| `RPC_URL` | `https://node-1.plumise.com/rpc` | Plumise 체인 RPC 엔드포인트 |
| `WS_URL` | `wss://node-1.plumise.com/ws` | Plumise 체인 WebSocket 엔드포인트 |
| `CHAIN_ID` | `41956` | Plumise 체인 ID |
| `ORACLE_PRIVATE_KEY` | -- | **필수.** Oracle 지갑 프라이빗 키 |
| `AGENT_REGISTRY_ADDRESS` | -- | AgentRegistry 컨트랙트 주소 |
| `REWARD_POOL_ADDRESS` | `0x...1000` | RewardPool 컨트랙트 주소 |
| `CHALLENGE_MANAGER_ADDRESS` | -- | ChallengeManager 컨트랙트 주소 |
| `MONITOR_INTERVAL_MS` | `30000` | 에이전트 모니터링 주기 |
| `CHALLENGE_INTERVAL_MS` | `600000` | 챌린지 생성 주기 |
| `REPORT_INTERVAL_BLOCKS` | `1200` | 온체인 보고 주기 (블록) |
| `DB_HOST` | `localhost` | MySQL 호스트 |
| `DB_PORT` | `15411` | MySQL 포트 |
| `DB_USERNAME` | `root` | MySQL 사용자명 |
| `DB_PASSWORD` | -- | MySQL 비밀번호 |
| `DB_DATABASE` | `plumise_dashboard` | MySQL 데이터베이스명 |
| `API_PORT` | `15481` | Oracle API 서버 포트 |
| `LOG_LEVEL` | `debug` | 로그 레벨 |

## 실행

### 개발

```bash
yarn start:dev
```

### 프로덕션

```bash
yarn build
yarn start:prod
```

## 컨트랙트 주소 (v2 체인, chainId: 41956)

- **RewardPool**: `0x0000000000000000000000000000000000001000`
- **AgentRegistry**: TBD (제네시스 이후)
- **ChallengeManager**: TBD (제네시스 이후)

## 스코어링 공식 (V2)

에이전트 기여 점수는 AI 추론 워크로드를 반영하는 가중치 공식으로 계산됩니다:

```
score = (tokenScore x 40) + (taskCount x 25) + (uptimeSeconds x 20) + (latencyScore x 15)

각 항목:
  tokenScore = processedTokens / 1000
  latencyScore = max(0, 10000 - avgLatencyMs)
```

**가중치**:
- **처리된 토큰**: 40% (추론 워크로드의 주요 지표)
- **작업 수**: 25% (챌린지 해결)
- **업타임**: 20% (에이전트 가용성)
- **레이턴시**: 15% (응답 속도, 역수 -- 낮은 레이턴시 = 높은 점수)

## API 엔드포인트

### 노드 관리

Inference API Gateway에서 노드 디스커버리 및 라우팅에 사용하는 엔드포인트입니다.

#### POST `/api/nodes/register`
Oracle에 노드를 등록합니다. 노드는 온체인에 먼저 등록되어야 합니다.

**요청 본문**:
```json
{
  "address": "0x...",
  "endpoint": "http://my-server:31330",
  "capabilities": ["text-generation"],
  "timestamp": 1707645600,
  "signature": "0x..."
}
```

#### GET `/api/nodes`
활성 노드 목록을 조회합니다. **Inference API Gateway에서 요청 라우팅에 사용.**

**응답**:
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

**활성 기준**: 마지막 하트비트가 10분 이내 AND 온체인 하트비트 활성.

#### GET `/api/nodes/:address`
특정 노드의 상세 정보를 조회합니다.

#### GET `/api/agents/active`
활성 상태(status = 1)인 모든 에이전트를 조회합니다.

### 추론 메트릭

#### POST `/api/metrics`
추론 메트릭을 보고합니다 (선택적 API 키 포함 간단한 엔드포인트).

**헤더** (선택): `x-api-key: your-oracle-api-key`

#### POST `/api/v1/metrics/report`
서명 검증이 포함된 Petals 노드의 추론 메트릭을 보고합니다.

**요청 본문**:
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

**검증**:
- 서명이 지갑 주소와 일치해야 함
- 에이전트가 온체인에 등록되어 있어야 함

#### GET `/api/v1/metrics/agents/:address`
에이전트의 현재 에포크 메트릭을 조회합니다.

#### GET `/api/v1/metrics/agents/:address/history`
에포크별 히스토리 메트릭을 조회합니다.

#### GET `/api/v1/metrics/summary`
네트워크 전체 추론 메트릭 요약을 조회합니다.

### 추론 증명 검증 (Inference Proof Verification)

**Milestone 2.3** 기능으로, Petals 노드로부터 받은 추론 증명을 검증하고 저장합니다.

#### POST `/api/v1/proofs/submit`
Petals 노드가 추론 증명을 제출합니다.

**요청 본문**:
```json
{
  "agent": "0x...",
  "proofHash": "0x1234...",
  "input": "프롬프트 텍스트",
  "output": "생성된 텍스트",
  "timestamp": 1707645600,
  "model": "bloom-560m",
  "signature": "0x5678..."
}
```

**검증 절차**:
1. 서명이 에이전트 주소와 일치하는지 확인
2. 에이전트가 온체인에 등록되어 있는지 확인
3. 타임스탬프가 유효한지 확인 (만료되지 않음)
4. 증명 해시를 재계산하여 일치 여부 확인: `keccak256(입력 + 출력 + 타임스탬프 + 모델 + 에이전트)`
5. 중복 증명 해시가 아닌지 확인

#### GET `/api/v1/proofs/:hash`
특정 증명 해시의 상세 정보를 조회합니다.

**응답**:
```json
{
  "proofHash": "0x1234...",
  "agent": "0x...",
  "input": "프롬프트 텍스트",
  "output": "생성된 텍스트",
  "timestamp": 1707645600,
  "model": "bloom-560m",
  "verified": true,
  "createdAt": "2024-02-11T12:00:00Z"
}
```

#### GET `/api/v1/proofs/agent/:address`
특정 에이전트의 모든 증명 목록을 조회합니다.

**쿼리 파라미터**: `?limit=50&offset=0` (선택, 페이지네이션)

#### GET `/api/v1/proofs/stats`
전체 네트워크의 증명 통계를 조회합니다.

**응답**:
```json
{
  "totalProofs": 10000,
  "totalAgents": 50,
  "proofs24h": 2400,
  "avgProofsPerAgent": 200,
  "verifiedRate": 0.998
}
```

### 에이전트 및 기여 데이터

#### GET `/api/stats`
네트워크 통계 (블록 번호, 활성 에이전트, 현재 에포크).

#### GET `/api/agents`
등록된 모든 에이전트 목록 (등록일 기준 내림차순).

#### GET `/api/agents/:address`
에이전트 상세 정보 및 기여 히스토리 (최근 50 에포크).

#### GET `/api/epochs`
최근 에포크 목록 (최근 50개).

#### GET `/api/epochs/:number`
에이전트별 기여가 포함된 에포크 상세 정보.

#### GET `/api/challenges`
최근 챌린지 목록 (최근 50개).

#### GET `/api/challenges/current`
현재 활성 (미해결, 미만료) 챌린지.

#### GET `/api/rewards/:address`
주소의 미청구 보상 및 기여 히스토리.

#### GET `/api/formula`
현재 보상 공식 가중치.

## 추론 메트릭 테스트

Petals 노드의 메트릭 보고를 시뮬레이션하는 테스트 스크립트를 실행합니다:

```bash
# 개발 모드로 oracle 시작
yarn start:dev

# 다른 터미널에서 테스트 스크립트 실행
npx ts-node test-inference-metrics.ts
```

테스트 스크립트는 다음을 수행합니다:
1. 서명된 메트릭 페이로드 생성
2. Oracle에 메트릭 보고
3. 에이전트 메트릭 조회
4. 네트워크 요약 조회
5. 여러 증분 리포트 전송
6. 최종 집계된 메트릭 표시

## 관련 프로젝트

| 프로젝트 | 설명 | 링크 |
|---------|------|------|
| **plumise-petals** | AI 추론 노드 (사용자/채굴자가 설치) | [GitHub](https://github.com/mikusnuz/plumise-petals) |
| **plumise-inference-api** | 최종 사용자 추론 요청을 위한 API 게이트웨이 | [GitHub](https://github.com/mikusnuz/plumise-inference-api) |
| **plumise** | Plumise 체인 노드 (AI 프리컴파일 포함 geth 포크) | [GitHub](https://github.com/mikusnuz/plumise) |
| **plumise-contracts** | 온체인 시스템 컨트랙트 (RewardPool, AgentRegistry 등) | [GitHub](https://github.com/mikusnuz/plumise-contracts) |

## 라이선스

MIT
