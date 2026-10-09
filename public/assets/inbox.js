export const STORAGE_KEY='kwadendamme-decap-testinbox-v1';
export function validateMessage(m) {
  if(!m||typeof m!=='object'||Array.isArray(m))throw new Error('Ongeldig testbericht.');
  const out={};
  for(const [k,max] of [['id',80],['type',20],['name',100],['email',254],['subject',150],['message',5000],['createdAt',40]]) {
    if(typeof m[k]!=='string'||!m[k].trim()||m[k].length>max)throw new Error('Vul alle velden in binnen de maximale lengte.');out[k]=m[k].trim();
  }
  if(!['idee','contact'].includes(out.type)||out.message.length<10||!/^\S+@[^\s@]+\.[^\s@]+$/.test(out.email)||!Number.isFinite(Date.parse(out.createdAt)))throw new Error('Controleer je e-mailadres en bericht.');
  if(m.consent!==true)throw new Error('Bevestig dat je voorbeeldgegevens gebruikt.');
  out.consent=true;
  return out;
}
export function readInbox(storage) {
  const raw=storage.getItem(STORAGE_KEY);
  if(!raw)return {version:1,messages:[]};
  const d=JSON.parse(raw);
  if(d?.version!==1||!Array.isArray(d.messages)||d.messages.length>200)throw new Error('De lokale testinbox is niet leesbaar.');
  return {version:1,messages:d.messages.map(validateMessage)};
}
export function saveMessage(storage,message) {
  const d=readInbox(storage);
  if(d.messages.length>=200)throw new Error('De testinbox is vol. Verwijder eerst oude testberichten.');
  d.messages.unshift(validateMessage(message));
  storage.setItem(STORAGE_KEY,JSON.stringify(d));
  return d;
}
export function deleteMessage(storage,id) {
  const d=readInbox(storage);d.messages=d.messages.filter(m=>m.id!==id);storage.setItem(STORAGE_KEY,JSON.stringify(d));return d;
}
