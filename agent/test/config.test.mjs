import test from "node:test";
import assert from "node:assert/strict";
import { NETWORKS, networkConfig, explorerTx, explorerAccount } from "../config/networks.mjs";
import { explorerUrl } from "../ledger.mjs";

test("testnet is the default and carries every value the agent needs", () => {
  const n = networkConfig("stellar:testnet");
  assert.equal(n.passphrase, "Test SDF Network ; September 2015");
  for (const k of ["horizonUrl", "rpcUrl", "friendbotUrl", "explorer", "facilitatorUrl"]) assert.ok(n[k], k);
  assert.match(n.usdc.issuer, /^G[A-Z2-7]{55}$/);
  assert.match(n.usdc.sac, /^C[A-Z2-7]{55}$/);
});

test("mainnet is described for the migration but refused at runtime", () => {
  assert.equal(NETWORKS["stellar:pubnet"].enabled, false);
  assert.throws(() => networkConfig("stellar:pubnet"), /Testnet only/);
  assert.throws(() => networkConfig("stellar:futurenet"), /Unknown network/);
});

test("testnet and mainnet differ in exactly the values a migration must change", () => {
  const t = NETWORKS["stellar:testnet"], p = NETWORKS["stellar:pubnet"];
  for (const k of ["passphrase", "horizonUrl", "explorer", "facilitatorUrl"]) assert.notEqual(t[k], p[k], k);
  assert.notEqual(t.usdc.sac, p.usdc.sac);
  assert.notEqual(t.usdc.issuer, p.usdc.issuer);
});

test("explorer links come from the config and match the ledger's links", () => {
  assert.equal(explorerTx("stellar:testnet", "abc"), "https://stellar.expert/explorer/testnet/tx/abc");
  assert.equal(explorerTx("stellar:testnet", null), null);
  assert.equal(explorerAccount("stellar:testnet", "GX"), "https://stellar.expert/explorer/testnet/account/GX");
  assert.equal(explorerUrl("stellar:testnet", "abc"), explorerTx("stellar:testnet", "abc"));
});
