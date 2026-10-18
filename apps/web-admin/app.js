const dictionaries={
en:{private:'PRIVATE AI PLATFORM',scene:'Your documents.\nYour infrastructure.',sceneBody:'A private workspace for your family and the applications you trust.',login:'Welcome back',loginText:'Sign in to your Local AI workspace.',passkey:'Sign in with a passkey',or:'or use your password',username:'Username',password:'Password',code:'Authenticator code',recovery:'Recovery code',useRecovery:'Use a recovery code',useCode:'Use an authenticator code',signIn:'Sign in',setup:'Create your administrator',setupText:'Use the one-time code from your installation console. There is no default administrator password.',setupCode:'One-time setup code',passwordHelp:'At least 12 characters. Use a unique password.',continue:'Continue',mfa:'Protect your account',mfaText:'Add this secret to your authenticator app, then enter its six-digit code. Keep the secret private.',secret:'Authenticator secret',activate:'Verify and create account',saveRecovery:'Save your recovery codes',recoveryText:'Each code can be used once with your password if you lose your authenticator. Store them somewhere safe. They will not be shown again.',download:'Download recovery codes',openWorkspace:'Open workspace',workspace:'Workspace',admin:'Admin',docs:'Documentation',profile:'Your account',logout:'Sign out',welcome:'Your private workspace',notReady:'AI services are not available yet',notReadyText:'Account security is available. Chat and document tools will become available after the AI services are configured.',applications:'Applications',appsText:'Give each application its own access key and permissions.',appName:'Application name',capabilities:'Allowed tools',networks:'Allowed IP addresses or subnets',networksHelp:'Optional. Separate addresses with commas. Leave empty to permit any source that can reach the gateway.',scopes:'Document access scopes',scopesHelp:'Explicit scopes are required for document and RAG access. Separate them with commas.',createApp:'Create application',keyTitle:'Save this application key',keyText:'This key is shown once. Rotating it immediately invalidates the previous key.',rotate:'Rotate key',revoke:'Revoke access',enabled:'Enabled',disabled:'Disabled',noApps:'No applications registered yet.',security:'Account security',verify:'Verify identity',verifyText:'A fresh identity check is needed for sensitive changes.',passkeys:'Passkeys',passkeyText:'Use your device, biometrics or a security key to sign in.',addPasskey:'Add a passkey',remove:'Remove',noPasskeys:'No passkeys registered.',guides:'Guides for this version',installation:'Installation',configuration:'Configuration',securityGuide:'Security',help:'Learn more',pending:'Setup is already in progress. Continue in the original tab, or ask the installer operator to issue a new setup code.',unsupported:'This browser does not support passkeys. Use password and authenticator instead.',failed:'The request could not be completed. Check your details. After repeated sign-in attempts, wait 15 minutes.',saved:'Saved.',signedOut:'Signed out.',confirmRevoke:'Revoke this application? Its key will stop working immediately.',confirmRotate:'Rotate this key? The previous key will stop working immediately.',confirmRemove:'Remove this passkey?',chat:'Chat',models:'Model list',embeddings:'Embeddings',ocr:'OCR',extract:'Extraction',rag:'Document Q&A',ingest:'Document ingestion',loading:'Loading…',copy:'Copy',copied:'Copied.',session:'Session expires',verifyFirst:'Verify your identity again before making this change.',newSetup:'First visit? Set up Local AI',language:'Change language',appearance:'Change appearance',apiInfo:'Applications share one /v1 API base URL.'},
ar:{private:'منصة ذكاء اصطناعي خاصة',scene:'مستنداتك.\nبنيتك التحتية.',sceneBody:'مساحة عمل خاصة لعائلتك والتطبيقات التي تثق بها.',login:'مرحباً بعودتك',loginText:'سجّل الدخول إلى مساحة العمل الخاصة بك.',passkey:'الدخول باستخدام مفتاح مرور',or:'أو استخدم كلمة المرور',username:'اسم المستخدم',password:'كلمة المرور',code:'رمز تطبيق المصادقة',recovery:'رمز الاسترداد',useRecovery:'استخدام رمز استرداد',useCode:'استخدام تطبيق المصادقة',signIn:'تسجيل الدخول',setup:'إنشاء حساب المسؤول',setupText:'استخدم رمز الإعداد لمرة واحدة من شاشة التثبيت. لا توجد كلمة مرور افتراضية.',setupCode:'رمز الإعداد لمرة واحدة',passwordHelp:'١٢ حرفاً على الأقل. استخدم كلمة مرور فريدة.',continue:'متابعة',mfa:'حماية حسابك',mfaText:'أضف المفتاح إلى تطبيق المصادقة ثم أدخل الرمز المكون من ستة أرقام. احتفظ بالمفتاح سرياً.',secret:'مفتاح تطبيق المصادقة',activate:'التحقق وإنشاء الحساب',saveRecovery:'احفظ رموز الاسترداد',recoveryText:'يمكن استخدام كل رمز مرة واحدة مع كلمة المرور عند فقدان تطبيق المصادقة. احفظها في مكان آمن. لن تظهر مرة أخرى.',download:'تنزيل رموز الاسترداد',openWorkspace:'فتح مساحة العمل',workspace:'مساحة العمل',admin:'الإدارة',docs:'المساعدة',profile:'حسابك',logout:'تسجيل الخروج',welcome:'مساحة العمل الخاصة بك',notReady:'خدمات الذكاء الاصطناعي غير متاحة بعد',notReadyText:'إعدادات أمان الحساب متاحة. ستتاح المحادثة وأدوات المستندات بعد تهيئة خدمات الذكاء الاصطناعي.',applications:'التطبيقات',appsText:'امنح كل تطبيق مفتاح وصول وصلاحيات مستقلة.',appName:'اسم التطبيق',capabilities:'الأدوات المسموحة',networks:'عناوين IP أو الشبكات المسموحة',networksHelp:'اختياري. افصل العناوين بفواصل. اترك الحقل فارغاً للسماح بالمصادر التي يمكنها الوصول إلى البوابة.',scopes:'نطاقات الوصول للمستندات',scopesHelp:'تحتاج المستندات والبحث إلى نطاقات صريحة. افصلها بفواصل.',createApp:'إنشاء تطبيق',keyTitle:'احفظ مفتاح التطبيق',keyText:'يظهر المفتاح مرة واحدة فقط. استبداله يلغي المفتاح السابق فوراً.',rotate:'استبدال المفتاح',revoke:'إلغاء الوصول',enabled:'مفعّل',disabled:'معطّل',noApps:'لا توجد تطبيقات مسجلة بعد.',security:'أمان الحساب',verify:'التحقق من الهوية',verifyText:'يلزم تحقق حديث لإجراء تغييرات حساسة.',passkeys:'مفاتيح المرور',passkeyText:'استخدم جهازك أو بصمتك أو مفتاح أمان للدخول.',addPasskey:'إضافة مفتاح مرور',remove:'حذف',noPasskeys:'لم تُسجّل مفاتيح مرور بعد.',guides:'أدلة هذا الإصدار',installation:'التثبيت',configuration:'الإعدادات',securityGuide:'الأمان',help:'معرفة المزيد',pending:'الإعداد قيد التنفيذ. تابع في علامة التبويب الأصلية أو اطلب من مسؤول التثبيت إصدار رمز إعداد جديد.',unsupported:'هذا المتصفح لا يدعم مفاتيح المرور. استخدم كلمة المرور وتطبيق المصادقة.',failed:'تعذر إكمال الطلب. تحقق من بياناتك. بعد محاولات دخول متكررة انتظر ١٥ دقيقة.',saved:'تم الحفظ.',signedOut:'تم تسجيل الخروج.',confirmRevoke:'إلغاء وصول التطبيق؟ سيتوقف المفتاح فوراً.',confirmRotate:'استبدال المفتاح؟ سيتوقف المفتاح السابق فوراً.',confirmRemove:'حذف مفتاح المرور؟',chat:'محادثة',models:'قائمة النماذج',embeddings:'التضمينات',ocr:'قراءة النصوص',extract:'استخراج البيانات',rag:'أسئلة المستندات',ingest:'إضافة المستندات',loading:'جارٍ التحميل…',copy:'نسخ',copied:'تم النسخ.',session:'انتهاء الجلسة',verifyFirst:'تحقق من هويتك مجدداً قبل إجراء هذا التغيير.',newSetup:'الزيارة الأولى؟ إعداد المنصة',language:'تغيير اللغة',appearance:'تغيير المظهر',apiInfo:'تستخدم التطبيقات عنوان API موحداً ضمن /v1.'}
};
let language=localStorage.getItem('localai.language')==='ar'?'ar':'en',theme=localStorage.getItem('localai.theme')||'light',csrf='',session=null,stage=null,useRecovery=false;
const $=id=>document.getElementById(id),t=key=>dictionaries[language][key]||dictionaries.en[key]||key;
function notice(message){$('notice').textContent=message;setTimeout(()=>{$('notice').textContent='';},8000);}
async function api(path,body){
 const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const value=await response.json();if(!response.ok){const error=new Error(t('failed'));error.status=response.status;throw error;}
 if(value.csrf)csrf=value.csrf;return value;
}
function preferences(){
 document.documentElement.lang=language;document.documentElement.dir=language==='ar'?'rtl':'ltr';document.documentElement.dataset.theme=theme;
 $('language').textContent=language==='ar'?'English':'العربية';$('language').setAttribute('aria-label',t('language'));$('theme').setAttribute('aria-label',t('appearance'));
}
function form(id,action){
 const element=$(id);element.addEventListener('submit',async event=>{event.preventDefault();const button=element.querySelector('button[type=submit]');button.disabled=true;
 try{await action(new FormData(element));}catch(error){notice(error.message||t('failed'));}finally{button.disabled=false;}});
}
const field=(name,label,type='text',extra='')=>'<label>'+t(label)+'<input name="'+name+'" type="'+type+'" '+extra+' required></label>';
function authLayout(title,description,content){
 $('app').innerHTML='<div class="auth-layout"><aside class="scene" aria-hidden="true"><div class="eyebrow">'+t('private')+'</div><h2>'+t('scene').replace('\n','<br>')+'</h2><p>'+t('sceneBody')+'</p></aside><section class="auth-panel"><h1>'+t(title)+'</h1><p>'+t(description)+'</p>'+content+'</section></div>';
}
function renderAuth(){
 if(stage?.kind==='recovery'){
  authLayout('saveRecovery','recoveryText','<ul class="recovery" id="codes"></ul><button id="download" class="secondary wide">'+t('download')+'</button><div class="toolbar"><button id="finish" class="primary wide">'+t('openWorkspace')+'</button></div>');
  for(const code of stage.codes){const item=document.createElement('li');item.className='secret';item.textContent=code;$('codes').append(item);}
  $('download').onclick=()=>{const url=URL.createObjectURL(new Blob(['Local AI recovery codes\n\n'+stage.codes.join('\n')],{type:'text/plain'}));const a=document.createElement('a');a.href=url;a.download='localai-recovery-codes.txt';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  $('finish').onclick=()=>{stage=null;location.assign('/workspace');};return;
 }
 if(stage?.kind==='mfa'){
  authLayout('mfa','mfaText','<label>'+t('secret')+'<span id="totp-secret" class="secret"></span></label><div class="toolbar"><button id="copy-secret" class="secondary">'+t('copy')+'</button></div><form id="mfa">'+field('code','code','text','inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" maxlength="6"')+'<button class="primary" type="submit">'+t('activate')+'</button></form>');
  $('totp-secret').textContent=stage.secret;$('copy-secret').onclick=()=>navigator.clipboard.writeText(stage.secret).then(()=>notice(t('copied')));
  form('mfa',async data=>{const value=await api('/auth/setup/complete',{code:data.get('code')});session=value;stage={kind:'recovery',codes:value.recoveryCodes};render();});return;
 }
 if(stage?.kind==='setup'){
  authLayout('setup','setupText','<form id="setup">'+field('code','setupCode','text','autocomplete="off" spellcheck="false"')+field('username','username','text','autocomplete="username" minlength="3" maxlength="64" pattern="[-a-zA-Z0-9_.]+"')+field('password','password','password','autocomplete="new-password" minlength="12"')+'<small>'+t('passwordHelp')+'</small><button class="primary" type="submit">'+t('continue')+'</button></form>');
  form('setup',async data=>{const value=await api('/auth/setup/begin',Object.fromEntries(data));stage={kind:'mfa',secret:value.totpSecret};render();});return;
 }
 if(stage?.kind==='pending'){authLayout('setup','pending','<a href="/login">'+t('login')+'</a>');return;}
 authLayout('login','loginText','<button id="passkey-login" class="secondary wide">'+t('passkey')+'</button><div class="or">'+t('or')+'</div><form id="login">'+field('username','username','text','autocomplete="username"')+field('password','password','password','autocomplete="current-password"')+field(useRecovery?'recoveryCode':'code',useRecovery?'recovery':'code','text',useRecovery?'autocomplete="off" spellcheck="false"':'inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" maxlength="6"')+'<button class="primary" type="submit">'+t('signIn')+'</button></form><div class="toolbar"><button id="switch-factor" class="secondary">'+t(useRecovery?'useCode':'useRecovery')+'</button></div><a href="/setup">'+t('newSetup')+'</a>');
 $('switch-factor').onclick=()=>{useRecovery=!useRecovery;renderAuth();};
 $('passkey-login').onclick=async()=>{try{if(!window.PublicKeyCredential)throw new Error(t('unsupported'));const options=await api('/auth/passkeys/login/options',{});const credential=await navigator.credentials.get({publicKey:decodeOptions(options.options,false)});await api('/auth/passkeys/login/verify',{id:options.id,response:serialize(credential)});location.assign('/workspace');}catch(e){notice(e.name==='NotAllowedError'?t('failed'):e.message);}};
 form('login',async data=>{await api('/auth/login',Object.fromEntries(data));location.assign('/workspace');});
}
function shell(){
 const page=location.pathname==='/admin'?'admin':location.pathname==='/docs'?'docs':location.pathname==='/profile'?'profile':'workspace';
 $('app').innerHTML='<div class="shell"><aside class="sidebar"><nav><a href="/workspace" '+(page==='workspace'?'aria-current="page"':'')+'>'+t('workspace')+'</a>'+(session.user.role==='admin'?'<a href="/admin" '+(page==='admin'?'aria-current="page"':'')+'>'+t('admin')+'</a>':'')+'<a href="/docs" '+(page==='docs'?'aria-current="page"':'')+'>'+t('docs')+'</a><a href="/profile" '+(page==='profile'?'aria-current="page"':'')+'>'+t('profile')+'</a></nav><div class="user"><strong id="user-name"></strong><p class="muted" id="role"></p><button id="logout" class="secondary">'+t('logout')+'</button></div></aside><section class="content" id="content"></section></div>';
 $('user-name').textContent=session.user.username;$('role').textContent=session.user.role==='admin'?t('admin'):t('workspace');
 $('logout').onclick=async()=>{try{await api('/auth/logout',{});location.assign('/login');}catch(e){notice(e.message);}};
 if(page==='admin')renderAdmin();else if(page==='profile')renderProfile();else if(page==='docs')renderDocs();else $('content').innerHTML='<h1>'+t('welcome')+'</h1><section class="panel"><span class="badge">'+t('notReady')+'</span><p class="muted">'+t('notReadyText')+'</p><a href="/docs">'+t('help')+' →</a></section>';
}
async function renderAdmin(){
 $('content').innerHTML='<h1>'+t('applications')+'</h1><p class="muted">'+t('appsText')+'</p><p class="muted">'+t('apiInfo')+'</p><div class="columns"><section class="panel"><h2>'+t('createApp')+'</h2><form id="app-create">'+field('name','appName')+'<label>'+t('capabilities')+'</label><div class="choices">'+['models','chat','embeddings','ocr','extract','rag','ingest'].map(c=>'<label><input type="checkbox" name="capability" value="'+c+'"> '+t(c)+'</label>').join('')+'</div><label>'+t('networks')+'<input name="networks" dir="ltr" placeholder="192.168.10.0/24"><small class="hint">'+t('networksHelp')+'</small></label><label>'+t('scopes')+'<input name="scopes" dir="ltr"><small class="hint">'+t('scopesHelp')+'</small></label><a href="/docs?guide=security">'+t('help')+'</a><button class="primary" type="submit">'+t('createApp')+'</button></form></section><section class="panel"><h2>'+t('applications')+'</h2><div id="app-list"></div><div id="new-key"></div></section></div><p><a href="/profile">'+t('verifyFirst')+' →</a></p>';
 form('app-create',async data=>{const split=value=>String(value).split(',').map(v=>v.trim()).filter(Boolean);const app=await api('/admin/api/apps/create',{name:data.get('name'),capabilities:data.getAll('capability'),networks:split(data.get('networks')),scopes:split(data.get('scopes'))});showKey(app.key);await appList();});
 try{await appList();}catch(e){notice(e.message);}
}
function showKey(key){$('new-key').innerHTML='<hr><h3>'+t('keyTitle')+'</h3><p class="muted">'+t('keyText')+'</p><div class="secret" id="key-value"></div><div class="toolbar"><button class="secondary" id="key-copy">'+t('copy')+'</button></div>';$('key-value').textContent=key;$('key-copy').onclick=()=>navigator.clipboard.writeText(key).then(()=>notice(t('copied')));}
async function appList(){
 const {applications}=await api('/admin/api/apps');$('app-list').replaceChildren();
 if(!applications.length){$('app-list').textContent=t('noApps');return;}
 for(const app of applications){
  const section=document.createElement('article');section.className='application';
  const heading=document.createElement('h3');heading.textContent=app.name;section.append(heading);
  const info=document.createElement('p');info.className='muted';info.textContent=(app.enabled?t('enabled'):t('disabled'))+' · '+app.capabilities.map(t).join(', ');section.append(info);
  const id=document.createElement('code');id.textContent=app.id;section.append(id);
  const actions=document.createElement('div');actions.className='toolbar';
  for(const action of ['rotate','revoke']){const button=document.createElement('button');button.className=action==='revoke'?'danger':'secondary';button.textContent=t(action);button.disabled=!app.enabled;button.onclick=async()=>{if(!confirm(t(action==='rotate'?'confirmRotate':'confirmRevoke')))return;try{const result=await api('/admin/api/apps/'+action,{id:app.id});if(result.key)showKey(result.key);await appList();}catch(e){notice(t('verifyFirst'));}};actions.append(button);}
  section.append(actions);$('app-list').append(section);
 }
}
async function renderProfile(){
 $('content').innerHTML='<h1>'+t('security')+'</h1><p class="muted" id="session-expiry"></p><div class="columns"><section class="panel"><h2>'+t('verify')+'</h2><p class="muted">'+t('verifyText')+'</p><form id="step-up">'+field('code','code','text','inputmode="numeric" pattern="[0-9]{6}" autocomplete="one-time-code" maxlength="6"')+'<button class="primary" type="submit">'+t('verify')+'</button></form></section><section class="panel"><h2>'+t('passkeys')+'</h2><p class="muted">'+t('passkeyText')+'</p><button class="primary" id="add-passkey">'+t('addPasskey')+'</button><div id="passkey-list" class="toolbar"></div><a href="/docs?guide=security">'+t('help')+'</a></section></div><button id="mobile-logout" class="secondary">'+t('logout')+'</button>';
 $('session-expiry').textContent=t('session')+': '+new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'short'}).format(new Date(session.expires));
 $('mobile-logout').onclick=async()=>{try{await api('/auth/logout',{});location.assign('/login');}catch(e){notice(e.message);}};
 form('step-up',async data=>{await api('/auth/step-up',{code:data.get('code')});notice(t('saved'));});
 $('add-passkey').onclick=async()=>{try{if(!window.PublicKeyCredential)throw new Error(t('unsupported'));const options=await api('/auth/passkeys/register/options',{});const credential=await navigator.credentials.create({publicKey:decodeOptions(options.options,true)});await api('/auth/passkeys/register/verify',{id:options.id,response:serialize(credential)});notice(t('saved'));await passkeyList();}catch(e){notice(e.message||t('failed'));}};
 try{await passkeyList();}catch(e){notice(e.message);}
}
async function passkeyList(){
 const {passkeys}=await api('/auth/passkeys');$('passkey-list').replaceChildren();
 if(!passkeys.length){$('passkey-list').textContent=t('noPasskeys');return;}
 for(const credential of passkeys){const item=document.createElement('div');item.className='application';const code=document.createElement('code');code.textContent=credential.id;item.append(code);const button=document.createElement('button');button.className='danger';button.textContent=t('remove');button.onclick=async()=>{if(!confirm(t('confirmRemove')))return;try{await api('/auth/passkeys/remove',{id:credential.id});await passkeyList();}catch(e){notice(t('verifyFirst'));}};item.append(button);$('passkey-list').append(item);}
}
async function renderDocs(){
 const guide=['installation','configuration','security'].includes(new URLSearchParams(location.search).get('guide'))?new URLSearchParams(location.search).get('guide'):'installation';
 $('content').innerHTML='<h1>'+t('guides')+'</h1><nav class="toolbar">'+['installation','configuration','security'].map(g=>'<a class="secondary" href="/docs?guide='+g+'">'+t(g==='security'?'securityGuide':g)+'</a>').join('')+'</nav><article class="panel doc"><pre id="guide-content"></pre></article>';
 try{const result=await api('/docs/content?guide='+guide);$('guide-content').textContent=result.content;}catch(e){notice(e.message);}
}
function decodeOptions(options,registration){
 if(registration&&PublicKeyCredential.parseCreationOptionsFromJSON)return PublicKeyCredential.parseCreationOptionsFromJSON(options);
 if(!registration&&PublicKeyCredential.parseRequestOptionsFromJSON)return PublicKeyCredential.parseRequestOptionsFromJSON(options);
 const decode=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
 const result={...options,challenge:decode(options.challenge)};
 if(registration){result.user={...options.user,id:decode(options.user.id)};result.excludeCredentials=options.excludeCredentials?.map(c=>({...c,id:decode(c.id)}));}
 else result.allowCredentials=options.allowCredentials?.map(c=>({...c,id:decode(c.id)}));
 return result;
}
function serialize(credential){
 if(!credential)throw new Error(t('failed'));if(credential.toJSON)return credential.toJSON();
 const encode=value=>btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
 const response={clientDataJSON:encode(credential.response.clientDataJSON)};
 for(const key of ['attestationObject','authenticatorData','signature','userHandle'])if(credential.response[key])response[key]=encode(credential.response[key]);
 if(credential.response.getTransports)response.transports=credential.response.getTransports();
 return {id:credential.id,rawId:encode(credential.rawId),type:credential.type,response,clientExtensionResults:credential.getClientExtensionResults()};
}
function render(){preferences();if(session&&stage?.kind!=='recovery')shell();else renderAuth();}
$('language').onclick=()=>{language=language==='ar'?'en':'ar';localStorage.setItem('localai.language',language);render();};
$('theme').onclick=()=>{theme=theme==='dark'?'light':'dark';localStorage.setItem('localai.theme',theme);preferences();};
async function initialize(){
 preferences();
 try{session=await api('/auth/session');}catch{
  try{const boot=await api('/auth/bootstrap');stage=boot.status==='new'?{kind:'setup'}:boot.status==='pending'?{kind:'pending'}:null;}catch(e){$('app').textContent=t('failed');return;}
 }
 render();
}
initialize();
