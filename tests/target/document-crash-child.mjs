// Launched only by the disposable-LXC crash-recovery proof.
import {join} from 'node:path';
import {openVault} from '../../packages/auth/crypto.mjs';
import {openDocumentJobStore} from '../../services/documents/jobs.mjs';
import {createDocumentJobRunner} from '../../services/documents/job-runner.mjs';

if(process.env.TARGET_TEST_LXC!=='disposable'||process.getuid()!==0)throw Error('disposable_root_target_required');
const dir=process.argv[2],vault=openVault(join(dir,'master.key')),store=openDocumentJobStore(join(dir,'jobs.sqlite'),{vault});
try{const runner=createDocumentJobRunner({store,workerPath:'/opt/localai/documents/candidates/job-unit-proof/tests/target/document-slow-worker.mjs',timeoutMs:15000});await runner.step();}
finally{store.close();}
