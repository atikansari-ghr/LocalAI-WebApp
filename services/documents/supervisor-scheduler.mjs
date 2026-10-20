// The root supervisor owns this admission instance. It is not yet a
// cross-process interactive lease shared with the gateway.
export function createDocumentSupervisorScheduler({runner,admission}={}){
 if(!runner||typeof runner.prepare!=='function'||typeof runner.step!=='function'||!admission||typeof admission.runBackground!=='function')throw new TypeError('invalid_document_scheduler');
 return Object.freeze({prepare:()=>runner.prepare(),step:()=>admission.runBackground(signal=>runner.step({signal}))});
}
