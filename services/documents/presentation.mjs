import {officeContext,OFFICE_REL,children,one,attr,fragments,literal,fail} from './office-xml.mjs';
const P='http://schemas.openxmlformats.org/presentationml/2006/main',A='http://schemas.openxmlformats.org/drawingml/2006/main';
export async function parsePresentationDocument(input,options={}){
 const ctx=await officeContext(input,options,'pptx'),presentation=ctx.read(ctx.pkg.mainPart),rels=ctx.relationships(ctx.pkg.mainPart),list=one(presentation,P,'sldIdLst');if(!list)fail('presentation_slide_list_missing');
 const slides=[],ids=new Set(),targets=new Set(),warnings=new Set(['presentation_source_order_not_rendered_layout','presentation_notes_masters_media_and_tables_not_extracted','presentation_fields_not_recalculated']);
 for(const entry of children(list,P,'sldId')){if(slides.length)ctx.add('\n',0);
  const id=attr(entry,'id'),rel=rels.get(attr(entry,'id',OFFICE_REL));if(!id||ids.has(id)||!rel||rel.type!==OFFICE_REL+'/slide'||targets.has(rel.target))fail('presentation_slide_reference_invalid');ids.add(id);targets.add(rel.target);
  const root=ctx.read(rel.target);if(root.ns!==P||root.local!=='sld')fail('presentation_slide_invalid');if(['0','false'].includes(attr(root,'show')))warnings.add('presentation_hidden_slides_included');
  const data=one(root,P,'cSld'),tree=data&&one(data,P,'spTree');if(!tree)fail('presentation_shape_tree_missing');const output=[],units=[];let shape=0,paragraph=0;
  const append=text=>{ctx.add(text,0);output.push(text);};
  function shapes(container){for(const node of container.children){
   ctx.check();if(node.ns!==P)continue;if(node.local==='grpSp'){shapes(node);continue;}if(node.local!=='sp')continue;shape++;
   const props=one(node,P,'nvSpPr'),nonvisual=props&&one(props,P,'cNvPr');if(nonvisual&&['1','true'].includes(attr(nonvisual,'hidden'))){warnings.add('presentation_direct_hidden_shapes_omitted');continue;}
   const body=one(node,P,'txBody');if(!body)continue;
   for(const para of children(body,A,'p')){paragraph++;for(const run of para.children){
    if(run.ns!==A)continue;if(run.local==='br'){append('\n');continue;}if(!['r','fld'].includes(run.local))continue;
    for(const text of children(run,A,'t'))for(const fragment of fragments(text)){
     ctx.add(fragment.text);output.push(fragment.text);units.push(Object.freeze({text:fragment.text,source:Object.freeze({...fragment.source,slide:slides.length+1,slideId:id,shape,paragraph})}));
    }
   }append('\n');}
  }}shapes(tree);
  slides.push(Object.freeze({index:slides.length+1,id,part:rel.target,text:output.join(''),units:Object.freeze(units)}));
 }
 return Object.freeze({document:ctx.pkg.document,parser:'presentation-source-text-v1+saxes-6.0.0',text:slides.map(s=>s.text).join('\n'),slides:Object.freeze(slides),warnings:Object.freeze([...warnings])});
}
