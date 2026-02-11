import { ethers } from 'ethers';

const ORACLE_URL = process.env.ORACLE_URL || 'http://localhost:15481';
const AGENT_PRIVATE_KEY = process.env.AGENT_PRIVATE_KEY || '0x9c58a8cb028296b717e0b21a01a473bccdc38602a8815ab4c92b1bc68ba7ed61';

interface MetricsPayload {
  wallet: string;
  tokensProcessed: number;
  avgLatencyMs: number;
  requestCount: number;
  uptimeSeconds: number;
  signature: string;
}

async function generateSignedMetrics(
  wallet: ethers.Wallet,
  tokensProcessed: number,
  avgLatencyMs: number,
  requestCount: number,
  uptimeSeconds: number,
): Promise<MetricsPayload> {
  const message = JSON.stringify({
    wallet: wallet.address.toLowerCase(),
    tokensProcessed,
    avgLatencyMs,
    requestCount,
    uptimeSeconds,
    timestamp: Math.floor(Date.now() / 1000),
  });

  const signature = await wallet.signMessage(message);

  return {
    wallet: wallet.address.toLowerCase(),
    tokensProcessed,
    avgLatencyMs,
    requestCount,
    uptimeSeconds,
    signature,
  };
}

async function reportMetrics(payload: MetricsPayload) {
  const response = await fetch(`${ORACLE_URL}/api/v1/metrics/report`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Failed to report metrics: ${response.status} ${error}`);
  }

  return await response.json();
}

async function getAgentMetrics(address: string) {
  const response = await fetch(`${ORACLE_URL}/api/v1/metrics/agents/${address}`);
  if (!response.ok) {
    throw new Error(`Failed to get metrics: ${response.status}`);
  }
  return await response.json();
}

async function getNetworkSummary() {
  const response = await fetch(`${ORACLE_URL}/api/v1/metrics/summary`);
  if (!response.ok) {
    throw new Error(`Failed to get summary: ${response.status}`);
  }
  return await response.json();
}

async function main() {
  console.log('Plumise Oracle - Inference Metrics Test');
  console.log('========================================\n');

  const wallet = new ethers.Wallet(AGENT_PRIVATE_KEY);
  console.log(`Agent Wallet: ${wallet.address}`);
  console.log(`Oracle URL: ${ORACLE_URL}\n`);

  console.log('1. Reporting inference metrics...');
  const tokensProcessed = Math.floor(Math.random() * 100000) + 10000;
  const avgLatencyMs = Math.random() * 500 + 100;
  const requestCount = Math.floor(Math.random() * 100) + 10;
  const uptimeSeconds = Math.floor(Math.random() * 3600) + 600;

  console.log(`   - Tokens Processed: ${tokensProcessed}`);
  console.log(`   - Avg Latency: ${avgLatencyMs.toFixed(2)}ms`);
  console.log(`   - Request Count: ${requestCount}`);
  console.log(`   - Uptime: ${uptimeSeconds}s`);

  const payload = await generateSignedMetrics(
    wallet,
    tokensProcessed,
    avgLatencyMs,
    requestCount,
    uptimeSeconds,
  );

  const reportResult = await reportMetrics(payload);
  console.log(`   ✓ Reported: ${JSON.stringify(reportResult)}\n`);

  await new Promise(resolve => setTimeout(resolve, 1000));

  console.log('2. Fetching agent metrics...');
  const agentMetrics = await getAgentMetrics(wallet.address);
  console.log(`   ${JSON.stringify(agentMetrics, null, 2)}\n`);

  console.log('3. Fetching network summary...');
  const summary = await getNetworkSummary();
  console.log(`   ${JSON.stringify(summary, null, 2)}\n`);

  console.log('4. Sending multiple reports to simulate continuous operation...');
  for (let i = 0; i < 3; i++) {
    const incrementalTokens = Math.floor(Math.random() * 5000) + 1000;
    const incrementalRequests = Math.floor(Math.random() * 10) + 1;
    const latency = Math.random() * 200 + 100;

    const payload2 = await generateSignedMetrics(
      wallet,
      incrementalTokens,
      latency,
      incrementalRequests,
      uptimeSeconds + (i + 1) * 300,
    );

    await reportMetrics(payload2);
    console.log(`   Report ${i + 1}/3: +${incrementalTokens} tokens, ${latency.toFixed(2)}ms latency`);
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  console.log('\n5. Final agent metrics:');
  const finalMetrics = await getAgentMetrics(wallet.address);
  console.log(`   ${JSON.stringify(finalMetrics, null, 2)}`);

  console.log('\n✅ Test completed successfully!');
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error('Error:', error);
    process.exit(1);
  });
