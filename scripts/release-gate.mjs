import { readFileSync, realpathSync, statSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const REQUIRED_GATES=Object.freeze([
 'installation','authentication','application-isolation','inference','rag','ocr','file-security',
 'workspace','api','restart-recovery','backup-restore','migration-rollback','privacy',
 'ui-accessibility','documentation','regression','hardware-performance'
]);
const TARGET='debian13-proxmox-lxc-4vcpu-6gb-100gb';
const MAX_AGE=7*24*60*60*1000;
export function assessRelease(report,{commit,artifactRoot,now=new Date()}={}) {
  const failures=[];
  if(!/^[a-f0-9]{40}$/.test(commit??''))failures.push('Invalid expected commit');
  if(!report||report.schemaVersion!==1||!Array.isArray(report.gates))return [...failures,'Missing or invalid release evidence'];
  if(report.commit!==commit)failures.push('Evidence commit mismatch');
  const created=Date.parse(report.createdAt);
  if(!Number.isFinite(created)||created>+now||+now-created>MAX_AGE)failures.push('Evidence timestamp is invalid or stale');
  const seen=new Set();
  for(const gate of report.gates) {
    if(!gate||!REQUIRED_GATES.includes(gate.category)||seen.has(gate.category)) {failures.push('Unknown or duplicate category');continue;}
    seen.add(gate.category);
    const label=gate.category;
    if(gate.status!=='passed')failures.push(label+': not passed');
    if(gate.commit!==commit)failures.push(label+': commit mismatch');
    if(typeof gate.command!=='string'||!gate.command.trim())failures.push(label+': missing command');
    if(gate.environment!==TARGET)failures.push(label+': target environment not verified');
    const start=Date.parse(gate.startedAt),finish=Date.parse(gate.finishedAt);
    if(!Number.isFinite(start)||!Number.isFinite(finish)||finish<start||finish>created||start>+now||+now-start>MAX_AGE)failures.push(label+': invalid execution timestamps');
    if(!Array.isArray(gate.artifacts)||!gate.artifacts.length){failures.push(label+': missing artifacts');continue;}
    for(const artifact of gate.artifacts) {
      try {
        if(typeof artifact.path!=='string'||isAbsolute(artifact.path)||!artifact.path||!/^[a-f0-9]{64}$/.test(artifact.sha256))throw new Error();
        const root=realpathSync(artifactRoot),file=realpathSync(resolve(root,artifact.path)),rel=relative(root,file);
        if(!rel||rel==='..'||rel.startsWith('..'+(process.platform==='win32'?'\\':'/'))||isAbsolute(rel)||!statSync(file).isFile())throw new Error();
        if(createHash('sha256').update(readFileSync(file)).digest('hex')!==artifact.sha256)throw new Error();
      } catch {failures.push(label+': invalid artifact');}
    }
  }
  for(const category of REQUIRED_GATES)if(!seen.has(category))failures.push(category+': missing evidence');
  return failures;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href) {
  try {
    const [, ,reportFile,commit,artifactRoot]=process.argv;
    if(!reportFile||!commit||!artifactRoot)throw new Error('usage');
    const failures=assessRelease(JSON.parse(readFileSync(reportFile,'utf8')),{commit,artifactRoot});
    console.log(JSON.stringify({status:failures.length?'blocked':'evidence_valid',blockers:failures},null,2));
    if(failures.length)process.exitCode=1;
  } catch {console.error('Release blocked: provide report.json, expected commit and artifact directory');process.exitCode=1;}
}
