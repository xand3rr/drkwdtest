import './navigation.js';
import {readInbox,saveMessage,deleteMessage} from './inbox.js';
import {initRemoteForms} from './forms.js';

initRemoteForms();

function feedback(el,message,error=false) {if(!el)return;el.className='notice '+(error?'notice-error':'notice-success');el.textContent=message;}
for(const form of document.querySelectorAll('[data-test-form]')) {
  const fields=form.querySelector('[data-form-fields]');
  const result=form.querySelector('[data-form-feedback]');
  form.addEventListener('submit',event=>{
    event.preventDefault();
    if(!form.reportValidity())return;
    const input=new FormData(form);
    try {
      saveMessage(window.localStorage,{id:crypto.randomUUID(),type:form.dataset.testForm,name:input.get('name'),email:input.get('email'),subject:input.get('subject'),message:input.get('message'),consent:input.get('consent')==='on',createdAt:new Date().toISOString()});
      form.reset();feedback(result,'Je testbericht is in deze browser bewaard. Er is niets gemaild.');
      const a=document.createElement('a');a.href=document.body.dataset.base+'/testinbox/';a.textContent='Bekijk de testinbox';result.append(document.createElement('br'),a);
    } catch(error) {feedback(result,'Bewaren is niet gelukt. Controleer de velden en of deze browser lokale opslag toestaat. Je invoer staat nog in het formulier.',true);}
  });
  fields.disabled=false;
}
const list=document.getElementById('inbox-list');
if(list) {
  const info=document.getElementById('inbox-feedback');
  const exportButton=document.getElementById('export-inbox');
  function node(tag,text,css){const n=document.createElement(tag);n.textContent=text;if(css)n.className=css;return n;}
  function render() {
    try {
      const d=readInbox(window.localStorage);list.replaceChildren();
      if(!d.messages.length)list.append(node('p','Er staan nog geen berichten in deze testinbox.','empty'));
      for(const m of d.messages) {
        const item=document.createElement('article');item.className='inbox-item';
        item.append(node('p',m.type==='idee'?'Idee':'Contactbericht','eyebrow'),node('h2',m.subject),node('p',`${m.name} · ${m.email} · ${new Intl.DateTimeFormat('nl-NL',{dateStyle:'medium',timeStyle:'short',timeZone:'Europe/Amsterdam'}).format(new Date(m.createdAt))}`,'inbox-meta'),node('p',m.message,'inbox-message'));
        const button=node('button','Verwijder testbericht','button button-outline');button.type='button';
        button.addEventListener('click',()=>{if(!confirm('Dit testbericht uit deze browser verwijderen?'))return;try{deleteMessage(window.localStorage,m.id);render();feedback(info,'Testbericht verwijderd.');}catch{feedback(info,'Verwijderen is niet gelukt. Het bericht is behouden.',true);}});
        item.append(button);list.append(item);
      }
      exportButton.disabled=false;
    } catch {feedback(info,'De testinbox kan niet worden gelezen. Controleer of deze browser lokale opslag toestaat.',true);}
  }
  exportButton.addEventListener('click',()=>{
    try {
      const blob=new Blob([JSON.stringify(readInbox(window.localStorage),null,2)],{type:'application/json'});
      const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='kwadendamme-testberichten.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch{feedback(info,'De testberichten konden niet worden geëxporteerd.',true);}
  });
  render();
}
