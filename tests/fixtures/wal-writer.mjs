import { openState } from '../../packages/database/index.mjs';
const state=openState(process.argv[2]);
state.setSetting('synthetic-recovery',{value:42});
console.log('committed');
setInterval(()=>{},1000);
