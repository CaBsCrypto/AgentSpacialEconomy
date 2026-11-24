import test from 'node:test';
import assert from 'node:assert/strict';
import { xdr } from '@stellar/stellar-sdk';
import { xdr as one16Xdr } from '../dist/vendor/wallet/kit.mjs';
import { xdr as reservationsXdr } from '../dist/vendor/reservations-wallet/kit.mjs';

// Captured from the public Testnet getLatestLedger response at ledger 5892967.
const protocol30Header = [
  'AAAAHrl/8lkpv0BSzm1OUgYDaWANTJWYLy0D7LI7UqvTP/y0uuyTrMDx8JtdA7bwLg3ASgyedFsIjhBfgSLQN/',
  'a6FYkAAAAAawT63QAAAAAAAAADAAABogtz8RYAAAAAqCTNGLyddQZNKZpbW6ykO8OqLzJpOBU9jC+btctt8DMA',
  'AABAnsWlHzET7JaaUju2L+FDfyO1xyX+DBWtSkCz9Trjp5geoPNpdhXpK0Xoon5MtpTiomiaQHQpmsJmsy0vft',
  'QLAtEJmbPAc4ePPj27QLTNl3A9aco0zzgrRhOC+EZzYAM1fczGeYdJmyENFjr9aOdiiJoJGGYGhzwKn76Xr1qS',
  'O/gAWetnDeC2s6dkAAAAAC13zgEPJgAAAAAAAAAAAA9FpwAAAGQATEtAAAAAyGvGlBIcw7r9wFQNpg9TlB2ywT',
  'tGS7jnqIv3hJkSL59k6RuYIPqiQ5rU6Q+pLsvoChNyOG3GrFDWR03h9oI7sNGtur6+F7j9L/Hk5bBZpYxj3/so',
  'IND1+4ycG2AjiHErfUTAaAz0AcKXg+0YuEt37ZCofX9OhI4/zMdPViWaDD1oAAAAAA==',
].join('');

test('decodes the Protocol 30 Testnet ledger header used by getLatestLedger', () => {
  for (const [name, decoder] of [['server', xdr], ['ONE16', one16Xdr], ['reservations', reservationsXdr]]) {
    const header = decoder.LedgerHeader.fromXDR(protocol30Header, 'base64');
    assert.equal(header.ledgerVersion(), 30, name);
    assert.equal(header.ledgerSeq(), 5892967, name);
  }
});
