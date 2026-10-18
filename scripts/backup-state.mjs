import { DatabaseSync, backup } from 'node:sqlite';
import { openSync, closeSync, unlinkSync } from 'node:fs';
// Recovery helper intentionally opens read-only without applying new migrations.
process.umask(0o077);
let source, reserved=false;
try {
  const [,,path,destination]=process.argv;
  if(!path||!destination)throw new Error();
  source=new DatabaseSync(path,{readOnly:true});
  closeSync(openSync(destination,'wx',0o600));reserved=true;
  await backup(source,destination);
  const restored=new DatabaseSync(destination,{readOnly:true});
  try {if(restored.prepare('PRAGMA integrity_check').get().integrity_check!=='ok')throw new Error();}
  finally {restored.close();}
} catch {
  if(reserved)unlinkSync(process.argv[3]);
  console.error('Pre-install backup failed; installation must not continue.');process.exitCode=1;
} finally {source?.close();}
