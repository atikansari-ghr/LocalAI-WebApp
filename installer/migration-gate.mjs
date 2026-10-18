import { existsSync,readdirSync,readFileSync,realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { readInstallationConfig } from './lifecycle.mjs';

function manifest(directory){
 const files=readdirSync(directory).filter(name=>name.endsWith('.sql')).sort();
 if(!files.length)throw new Error('Missing migration history');
 return files.map((name,index)=>{
  if(Number(name.match(/^(\d+)-[\w-]+\.sql$/)?.[1])!==index+1)throw new Error('Invalid migration history');
  return createHash('sha256').update(readFileSync(join(directory,name),'utf8').replace(/\r\n/g,'\n')).digest('hex');
 });
}

// Code-only rollback is safe only when the persisted schema is already supported
// by both versions. Schema transitions require a separately qualified recovery flow.
export function verifyRollbackCompatibility(config,currentDirectory,candidateDirectory){
 const path=join(config.stateDir,'platform.sqlite');
 if(!existsSync(path))return true;
 const current=manifest(currentDirectory),candidate=manifest(candidateDirectory);
 const db=new DatabaseSync(path,{readOnly:true,timeout:5000,allowExtension:false});
 try{
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw new Error('Invalid state history');
  const applied=db.prepare('SELECT version,checksum FROM schema_migrations ORDER BY version').all();
  if(!applied.length||applied.length!==current.length||applied.some((row,i)=>row.version!==i+1||row.checksum!==current[i]))throw new Error('Installed migration history does not match state');
  if(candidate.length!==current.length||candidate.some((hash,i)=>hash!==current[i]))throw new Error('Update blocked: schema migration recovery is not yet qualified');
  return true;
 }finally{db.close();}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(realpathSync(process.argv[1])).href){
 try{
  if(process.argv.length!==5)throw new Error('Invalid migration gate invocation');
  verifyRollbackCompatibility(readInstallationConfig(process.argv[2]),process.argv[3],process.argv[4]);
  console.log('Database rollback compatibility passed.');
 }catch(error){console.error('Installation blocked: '+error.message);process.exitCode=1;}
}
