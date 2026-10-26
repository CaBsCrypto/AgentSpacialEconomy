// Every network-specific value in one place: going to mainnet is a diff of this file, not a hunt
// through the code. This MVP runs on testnet only; mainnet is listed for the migration plan but
// refused at runtime (`enabled: false`).
//
// Sources: Stellar docs (network passphrases, Horizon/RPC endpoints), the `agentic-payments` skill in
// stellar/stellar-dev-skill (USDC SAC addresses, x402 facilitators), HackMeridian Day 1 "Slip Onto
// Mainnet" (SDF does not run a public mainnet RPC: bring your own provider).

export const NETWORKS = {
  "stellar:testnet": {
    id: "stellar:testnet",
    enabled: true,
    passphrase: "Test SDF Network ; September 2015",
    horizonUrl: "https://horizon-testnet.stellar.org",
    rpcUrl: "https://soroban-testnet.stellar.org",
    friendbotUrl: "https://friendbot.stellar.org",
    explorer: "https://stellar.expert/explorer/testnet",
    usdc: {
      code: "USDC",
      issuer: "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5", // Circle, classic asset (trustlines)
      sac: "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA", // Stellar Asset Contract (SEP-41 calls)
      decimals: 7,
    },
    facilitatorUrl: "https://x402.org/facilitator",
  },
  "stellar:pubnet": {
    id: "stellar:pubnet",
    enabled: false, // never flip this during the hackathon: real money
    passphrase: "Public Global Stellar Network ; September 2015",
    horizonUrl: "https://horizon.stellar.org",
    rpcUrl: null, // pick a provider: https://developers.stellar.org/docs/data/apis/rpc/providers
    friendbotUrl: null,
    explorer: "https://stellar.expert/explorer/public",
    usdc: {
      code: "USDC",
      issuer: "GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN",
      sac: "CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75",
      decimals: 7,
    },
    facilitatorUrl: "https://channels.openzeppelin.com/x402", // needs an API key
  },
};

/** The active network. Throws for unknown ids and for any network not enabled in this MVP. */
export function networkConfig(id = process.env.STELLAR_NETWORK || "stellar:testnet") {
  const n = NETWORKS[id];
  if (!n) throw new Error(`Unknown network ${id}. Use one of: ${Object.keys(NETWORKS).join(", ")}`);
  if (!n.enabled) throw new Error(`${id} is disabled in this MVP. Testnet only.`);
  return n;
}

export function explorerTx(networkId, hash) {
  if (!hash) return null;
  const n = NETWORKS[networkId] ?? NETWORKS["stellar:testnet"];
  return `${n.explorer}/tx/${hash}`;
}

export function explorerAccount(networkId, account) {
  const n = NETWORKS[networkId] ?? NETWORKS["stellar:testnet"];
  return `${n.explorer}/account/${account}`;
}
