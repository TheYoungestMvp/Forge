import type { GeneratedApp } from "../src/lib/generation/schema";

// These are working applications, not recorded responses or mocked assertions.
// Every fixture is validated and exercised through the same preview as model output.
const css = `body{font-family:system-ui,sans-serif;color:#18212b;background:#f5f7fa}main{max-width:840px;min-height:100vh;margin:auto;padding:28px;background:#ffffff}main.dark{background:#17212d;color:#f4f6fa}h1{font-size:26px}label,button,input,select{font:inherit}button,input,select{padding:8px;margin:4px;border:1px solid #8c99a7;border-radius:5px}button{cursor:pointer}ul{padding:0;list-style:none}li{padding:12px;margin:8px 0;border:1px solid #8c99a7;border-radius:7px;overflow-wrap:anywhere}li span{margin-right:10px}button[aria-pressed=true]{background:#204ca1;color:white}.fields{display:flex;flex-wrap:wrap;align-items:center}.calculator{display:grid;grid-template-columns:repeat(4,70px);gap:4px}output{display:block;padding:16px;font-size:30px}[hidden]{display:none!important}`;

function todo(theme: boolean, filter: boolean, edit: boolean): GeneratedApp {
  return {
    title: "待办评测样例",
    css,
    html: `<main id="todo-root"><h1>待办</h1><label>新任务<input id="todo-input" aria-label="新任务"></label><button id="todo-add">添加任务</button>${theme ? '<button id="todo-theme" aria-pressed="false">深色主题</button>' : ""}${filter ? '<button id="todo-all">全部</button><button id="todo-pending">未完成</button>' : ""}<ul id="todo-list" aria-label="任务列表"></ul>${edit ? '<section id="todo-editor" hidden><label>编辑任务<input id="todo-edit-input" aria-label="编辑任务"></label><button id="todo-save">保存任务</button></section>' : ""}</main>`,
    javascript: `(()=>{
const hasTheme=${theme},hasFilter=${filter},hasEdit=${edit};
const root=document.getElementById('todo-root'),input=document.getElementById('todo-input'),list=document.getElementById('todo-list');
let tasks=[],nextId=1,pendingOnly=false,dark=false,editing=null;
function button(text,action){const b=document.createElement('button');b.textContent=text;b.addEventListener('click',action);return b}
function render(){list.replaceChildren();tasks.filter(t=>!pendingOnly||!t.done).forEach(t=>{
 const row=document.createElement('li');row.setAttribute('aria-label','任务：'+t.title);
 const box=document.createElement('input');box.type='checkbox';box.checked=t.done;box.setAttribute('aria-label','完成 '+t.title);box.addEventListener('change',()=>{t.done=box.checked;render()});
 const title=document.createElement('span');title.textContent=t.title;row.append(box,title);
 if(hasEdit)row.append(button('编辑 '+t.title,()=>{editing=t.id;document.getElementById('todo-edit-input').value=t.title;document.getElementById('todo-editor').hidden=false}));
 row.append(button('删除 '+t.title,()=>{tasks=tasks.filter(item=>item.id!==t.id);render()}));list.append(row);
})}
document.getElementById('todo-add').addEventListener('click',()=>{const title=input.value.trim();if(!title)return;tasks.push({id:nextId++,title,done:false});input.value='';render()});
if(hasTheme)document.getElementById('todo-theme').addEventListener('click',()=>{dark=!dark;root.classList.toggle('dark',dark);document.getElementById('todo-theme').setAttribute('aria-pressed',String(dark))});
if(hasFilter){document.getElementById('todo-all').addEventListener('click',()=>{pendingOnly=false;render()});document.getElementById('todo-pending').addEventListener('click',()=>{pendingOnly=true;render()})}
if(hasEdit)document.getElementById('todo-save').addEventListener('click',()=>{const title=document.getElementById('todo-edit-input').value.trim();if(!title)return;const t=tasks.find(item=>item.id===editing);if(t)t.title=title;document.getElementById('todo-editor').hidden=true;editing=null;render()});
render();
})();`,
  };
}

function calculator(history: boolean): GeneratedApp {
  const keys = ["7", "8", "9", "除", "4", "5", "6", "乘", "1", "2", "3", "减", "0", "小数点", "等于", "加", "清空"];
  return {
    title: "计算器评测样例",
    css,
    html: `<main><h1>计算器</h1><output id="calc-result" role="status" aria-label="计算结果">0</output><div class="calculator">${keys.map((key) => `<button data-key="${key}">${key}</button>`).join("")}</div>${history ? '<h2>历史</h2><button id="calc-clear-history">清空历史</button><ul id="calc-history" aria-label="计算历史"></ul>' : ""}</main>`,
    javascript: `(()=>{
const hasHistory=${history},result=document.getElementById('calc-result');
let display='0',left=null,operator=null,fresh=true,history=[];
const symbols={'加':'+','减':'-','乘':'*','除':'/'};
function show(){result.textContent=display;if(hasHistory){const list=document.getElementById('calc-history');list.replaceChildren();history.forEach(text=>{const row=document.createElement('li');row.textContent=text;list.append(row)})}}
function compute(a,b,op){if(op==='+')return a+b;if(op==='-')return a-b;if(op==='*')return a*b;return a/b}
function press(key){
 if(/^\\d$/.test(key)){display=fresh||display==='0'?key:display+key;fresh=false}
 else if(key==='小数点'){if(fresh){display='0.';fresh=false}else if(!display.includes('.'))display+='.'}
 else if(key==='清空'){display='0';left=null;operator=null;fresh=true}
 else if(symbols[key]){left=Number(display);operator=symbols[key];fresh=true}
 else if(key==='等于'&&left!==null&&operator!==null&&!fresh){const right=Number(display),value=compute(left,right,operator);display=Number.isFinite(value)?String(Number(value.toPrecision(12))):'错误';if(hasHistory&&Number.isFinite(value))history.unshift(String(left)+' '+operator+' '+String(right)+' = '+display);left=null;operator=null;fresh=true}
 show();
}
document.querySelectorAll('[data-key]').forEach(b=>b.addEventListener('click',()=>press(b.dataset.key)));
if(hasHistory)document.getElementById('calc-clear-history').addEventListener('click',()=>{history=[];show()});
show();
})();`,
  };
}

function board(channelFilter: boolean, overdue: boolean, edit: boolean): GeneratedApp {
  const statuses = ["待办", "进行中", "已完成"];
  const channels = ["公众号", "小红书", "视频号"];
  const options = (values: string[]) => values.map((value) => `<option value="${value}">${value}</option>`).join("");
  return {
    title: "内容看板评测样例",
    css,
    html: `<main><h1>内容发布看板</h1><div class="fields"><label>内容标题<input id="board-title" aria-label="内容标题"></label><label>状态<select id="board-status" aria-label="状态">${options(statuses)}</select></label><label>渠道<select id="board-channel" aria-label="渠道">${options(channels)}</select></label><label>发布日期<input id="board-date" type="date" aria-label="发布日期"></label><button id="board-add">添加内容</button></div>${channelFilter ? `<label>渠道筛选<select id="board-filter" aria-label="渠道筛选">${options(["全部", ...channels])}</select></label>` : ""}${overdue ? '<label><input id="board-overdue" type="checkbox" aria-label="仅看逾期">仅看逾期</label>' : ""}<ul id="board-list" aria-label="内容列表"></ul>${edit ? '<section id="board-editor" hidden><label>编辑内容标题<input id="board-edit-input" aria-label="编辑内容标题"></label><button id="board-save">保存内容</button></section>' : ""}</main>`,
    javascript: `(()=>{
const hasFilter=${channelFilter},hasOverdue=${overdue},hasEdit=${edit},statuses=['待办','进行中','已完成'];
const title=document.getElementById('board-title'),status=document.getElementById('board-status'),channel=document.getElementById('board-channel'),date=document.getElementById('board-date'),list=document.getElementById('board-list');
let items=[],nextId=1,selectedChannel='全部',onlyOverdue=false,editing=null;
function button(text,action){const b=document.createElement('button');b.textContent=text;b.addEventListener('click',action);return b}
function render(){const today=new Date().toISOString().slice(0,10);list.replaceChildren();items.filter(item=>(selectedChannel==='全部'||item.channel===selectedChannel)&&(!onlyOverdue||(item.date<today&&item.status!=='已完成'))).forEach(item=>{
 const row=document.createElement('li');row.setAttribute('aria-label','内容：'+item.title);
 const heading=document.createElement('span');heading.textContent=item.title;const meta=document.createElement('span');meta.textContent=item.channel+' · '+item.date;row.append(heading,meta);
 const select=document.createElement('select');select.setAttribute('aria-label','状态 '+item.title);statuses.forEach(s=>{const option=document.createElement('option');option.value=s;option.textContent=s;select.append(option)});select.value=item.status;select.addEventListener('change',()=>{item.status=select.value;render()});row.append(select);
 if(hasEdit)row.append(button('编辑 '+item.title,()=>{editing=item.id;document.getElementById('board-edit-input').value=item.title;document.getElementById('board-editor').hidden=false}));
 row.append(button('删除 '+item.title,()=>{items=items.filter(record=>record.id!==item.id);render()}));list.append(row);
})}
document.getElementById('board-add').addEventListener('click',()=>{const text=title.value.trim();if(!text||!date.value)return;items.push({id:nextId++,title:text,status:status.value,channel:channel.value,date:date.value});title.value='';render()});
if(hasFilter)document.getElementById('board-filter').addEventListener('change',event=>{selectedChannel=event.target.value;render()});
if(hasOverdue)document.getElementById('board-overdue').addEventListener('change',event=>{onlyOverdue=event.target.checked;render()});
if(hasEdit)document.getElementById('board-save').addEventListener('click',()=>{const text=document.getElementById('board-edit-input').value.trim();if(!text)return;const item=items.find(record=>record.id===editing);if(item)item.title=text;document.getElementById('board-editor').hidden=true;editing=null;render()});
render();
})();`,
  };
}

export const fixtureApps: Record<string, GeneratedApp> = {
  "todo-create": todo(false, false, false),
  "todo-theme": todo(true, false, false),
  "todo-filter": todo(true, true, false),
  "todo-edit": todo(true, true, true),
  "calculator-create": calculator(false),
  "calculator-history": calculator(true),
  "board-create": board(false, false, false),
  "board-channel": board(true, false, false),
  "board-overdue": board(true, true, false),
  "board-edit": board(true, true, true),
};
