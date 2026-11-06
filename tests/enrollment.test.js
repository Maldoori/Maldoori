import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateInvitation} from '../lib/enrollment.mjs';
const base = 'https://mesh.example.com/customer/';
test('accepts absolute and relative token links within the configured MeshCentral domain', () => {
  for (const link of ['agentinvite?c=token', '/customer/agentinvite?c=token', base + 'agentinvite?c=token']) {
    assert.equal(validateInvitation(link, base), base + 'agentinvite?c=token');
  }
});
test('rejects cross-domain, credential-bearing, unencrypted, malformed and tokenless destinations', () => {
  for (const link of [null, {}, '', 'https://other.example/agentinvite?c=token', 'http://mesh.example.com/customer/agentinvite?c=token', 'https://user:password@mesh.example.com/customer/agentinvite?c=token', '/customer/agentinvite?c=token#fragment', '/agentinvite?c=token', 'agentinvite', 'agentinvite?c=', 'control.ashx?c=token']) {
    assert.throws(() => validateInvitation(link, base), /MeshCentral/);
  }
});
