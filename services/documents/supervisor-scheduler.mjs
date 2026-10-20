// An unclean interactive lease survives supervisor restarts and stops new
// document claims until inference cleanup has been separately verified.
export function createDocumentSupervisorScheduler({runner,admission,barrier}={}){
 if(!runner||typeof runner.prepare!=='function'||typeof runner.step!=='function'||!admission||typeof admission.runBackground!=='function'||!barrier||typeof barrier.isClear!=='function')throw new TypeError('invalid_document_scheduler');
 return Object.freeze({prepare:()=>runner.prepare(),step:()=>barrier.isClear()?admission.runBackground(signal=>runner.step({signal})):Promise.reject(new Error('interactive_recovery_required'))});
}
