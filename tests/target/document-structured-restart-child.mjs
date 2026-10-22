import assert from 'node:assert/strict';
import {join} from 'node:path';
import {openVault} from '../../packages/auth/crypto.mjs';
import {openStructuredJobStore} from '../../services/documents/structured-jobs.mjs';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const directory=process.argv[2];assert.match(directory,/^\/root\/localai-structured-restart-[A-Za-z0-9]+$/);
const store=openStructuredJobStore(join(directory,'jobs.sqlite'),{vault:openVault(join(directory,'master.key'))});
const receipt=JSON.parse(process.env.TARGET_STRUCTURED_PROOF_RECEIPT??'null');
const claim=store.claimOwned(receipt);assert.ok(claim);assert.equal(claim.report.units[0].text,'Private invoice INV-42');
process.kill(process.pid,'SIGKILL');
