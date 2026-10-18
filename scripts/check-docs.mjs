import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import registry from '../packages/shared/settings.json' with {type:'json'};
const config=readFileSync(new URL('../docs/configuration.md',import.meta.url),'utf8');
const errors=[];
for(const setting of registry) {
 if(!setting.help?.trim()||!setting.anchor||!config.includes('Anchor: '+setting.anchor+'.')||!config.includes(setting.env)) errors.push('Missing setting documentation: '+setting.env);
}
for(const file of ['README.md','docs/installation.md','docs/configuration.md','docs/architecture.md']) {
 const text=readFileSync(file,'utf8');
 for(const [,link] of text.matchAll(/\]\(([^)]+)\)/g)) {
  if(/^(https?:|#)/.test(link))continue;
  const [path,anchor]=link.split('#'),target=resolve(file,'..',path);
  if(!existsSync(target))errors.push('Broken link in '+file+': '+link);
  else if(anchor){
   const headings=[...readFileSync(target,'utf8').matchAll(/^#+ (.+)$/gm)].map(([,h])=>h.toLowerCase().replace(/[^\w -]/g,'').replace(/ /g,'-'));
   if(!headings.includes(anchor))errors.push('Missing anchor: '+link);
  }
 }
}
if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log('Settings/help and documentation links pass');
