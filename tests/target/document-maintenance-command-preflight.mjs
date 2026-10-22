import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

assert.equal(process.env.TARGET_TEST_LXC,'disposable');assert.equal(process.getuid(),0);
const root=fileURLToPath(new URL('../..',import.meta.url));
const pid=unit=>execFileSync('/usr/bin/systemctl',['show',unit,'--property=MainPID','--value'],{encoding:'utf8'}).trim();
const before=['localai.service','localai-chat.service','localai-embedding.service'].map(pid);
const result=spawnSync('/bin/bash',[join(root,'installer/recover-interactive-documents.sh'),'--recover'],{encoding:'utf8',timeout:10000});
assert.notEqual(result.status,0);
assert.match(result.stderr,/installed Local AI source is required/);
const direct=spawnSync(process.execPath,[join(root,'installer/recover-interactive-documents.mjs'),'--recover'],{encoding:'utf8',timeout:10000});
assert.notEqual(direct.status,0);
assert.match(direct.stderr,/interactive_maintenance_installed_source_required/);
assert.deepEqual(['localai.service','localai-chat.service','localai-embedding.service'].map(pid),before);
process.stdout.write(JSON.stringify({gate:'production-recovery-entrypoint-preflight',rejectedCheckout:true,rejectedDirectBypass:true,livePidsUnchanged:true})+'\n');
