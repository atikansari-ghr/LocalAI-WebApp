import { existsSync, lstatSync, readFileSync, readlinkSync, symlinkSync, renameSync, unlinkSync, openSync, writeFileSync, fsyncSync, closeSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';

function atomicFile(path,content,mode) {
  const temporary=join(dirname(path),'.localai-'+randomUUID());
  const fd=openSync(temporary,'wx',mode);
  try {writeFileSync(fd,content);fsyncSync(fd);}finally{closeSync(fd);}
  try {chmodSync(temporary,mode);renameSync(temporary,path);}
  finally {if(existsSync(temporary))unlinkSync(temporary);}
}
function linkTarget(path) {
  try {if(!lstatSync(path).isSymbolicLink())throw new Error('Activation path is not a symbolic link');return readlinkSync(path);}
  catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function atomicLink(path,target) {
  linkTarget(path); // Never replace an unexpected real directory or file.
  if(target===null){try{unlinkSync(path);}catch(error){if(error.code!=='ENOENT')throw error;}return;}
  const temporary=join(dirname(path),'.localai-link-'+randomUUID());
  symlinkSync(target,temporary);
  try{renameSync(temporary,path);}finally{try{unlinkSync(temporary);}catch(error){if(error.code!=='ENOENT')throw error;}}
}
export function applyActivation({base,unit,deployment,runtime,unitSource,journal}) {
  if(existsSync(journal))throw new Error('Pending activation must be recovered first');
  let previousUnit=null;
  if(existsSync(unit)){const stat=lstatSync(unit);if(!stat.isFile())throw new Error('Invalid service unit path');previousUnit={data:readFileSync(unit).toString('base64'),mode:stat.mode&0o777};}
  const snapshot={schemaVersion:1,base,unit,current:linkTarget(join(base,'current')),node:linkTarget(join(base,'node')),previousUnit};
  // The durable journal exists before the first activation mutation and survives process termination.
  atomicFile(journal,JSON.stringify(snapshot),0o600);
  try {
    atomicLink(join(base,'node'),runtime);
    atomicLink(join(base,'current'),deployment);
    atomicFile(unit,readFileSync(unitSource),0o644);
  }catch(error){restoreActivation(journal);throw error;}
}
export function restoreActivation(journal) {
  if(!existsSync(journal))return false;
  const snapshot=JSON.parse(readFileSync(journal,'utf8'));
  if(snapshot.schemaVersion!==1)throw new Error('Unknown activation journal');
  atomicLink(join(snapshot.base,'node'),snapshot.node);
  atomicLink(join(snapshot.base,'current'),snapshot.current);
  if(snapshot.previousUnit)atomicFile(snapshot.unit,Buffer.from(snapshot.previousUnit.data,'base64'),snapshot.previousUnit.mode);
  else {try{unlinkSync(snapshot.unit);}catch(error){if(error.code!=='ENOENT')throw error;}}
  unlinkSync(journal);return true;
}
export function commitActivation(journal){unlinkSync(journal);}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const [,,action,...args]=process.argv;
    if(action==='apply'){const [base,unit,deployment,runtime,unitSource,journal]=args;applyActivation({base,unit,deployment,runtime,unitSource,journal});}
    else if(action==='restore')restoreActivation(args[0]);
    else if(action==='commit')commitActivation(args[0]);
    else throw new Error();
  }catch{console.error('Deployment activation failed; inspect protected activation journal before retrying.');process.exitCode=1;}
}
