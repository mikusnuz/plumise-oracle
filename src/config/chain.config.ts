export const chainConfig = {
  rpcUrl: process.env.RPC_URL || 'https://plug.plumise.com/rpc',
  wsUrl: process.env.WS_URL || 'wss://node-1.plumise.com/ws',
  chainId: parseInt(process.env.CHAIN_ID || '41956'),
  contracts: {
    agentRegistry: process.env.AGENT_REGISTRY_ADDRESS || '',
    rewardPool: process.env.REWARD_POOL_ADDRESS || '0x0000000000000000000000000000000000001000',
    challengeManager: process.env.CHALLENGE_MANAGER_ADDRESS || '',
  },
  intervals: {
    monitor: parseInt(process.env.MONITOR_INTERVAL_MS || '30000'),
    challenge: parseInt(process.env.CHALLENGE_INTERVAL_MS || '600000'),
    reportBlocks: parseInt(process.env.REPORT_INTERVAL_BLOCKS || '1200'),
  },
};
