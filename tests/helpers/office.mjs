import {makeZip} from './zip.mjs';
export const R='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
export const S='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
export const P='http://schemas.openxmlformats.org/presentationml/2006/main';
export const A='http://schemas.openxmlformats.org/drawingml/2006/main';
export function officeFixture(format,main,xml,parts=[],relationships=[]){
 const type={xlsx:'spreadsheetml.sheet',pptx:'presentationml.presentation'}[format];
 return {name:'fixture.'+format,bytes:makeZip([{name:'[Content_Types].xml',bytes:`<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/${main}" ContentType="application/vnd.openxmlformats-officedocument.${type}.main+xml"/></Types>`},{name:'_rels/.rels',bytes:`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="main" Type="${R}/officeDocument" Target="${main}"/></Relationships>`},{name:main,bytes:xml},{name:main.replace(/([^/]+)$/,'_rels/$1.rels'),bytes:`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relationships.map(([id,type,target])=>`<Relationship Id="${id}" Type="${R}/${type}" Target="${target}"/>`).join('')}</Relationships>`},...parts.map(([name,bytes])=>({name,bytes}))])};
}
