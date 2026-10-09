// A fixed, local example. This is not generated from the user's prompt.
export const mockPreview = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Daylight — a little more focus</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#fbfaf7;color:#28382e;font-family:Arial,Helvetica,sans-serif;font-size:14px}button,input{font:inherit}button{cursor:pointer}button:focus-visible,input:focus-visible{outline:3px solid #97b79f;outline-offset:3px}.app{max-width:760px;margin:auto;padding:32px 36px}.nav{display:flex;align-items:center;justify-content:space-between;gap:16px}.brand{font-size:21px;font-weight:700;letter-spacing:-.8px;display:flex;align-items:center;gap:9px}.sun{color:#8a9b57;font-size:27px}.date{font-size:11px;color:#879087}.eyebrow{margin:50px 0 14px;text-transform:uppercase;letter-spacing:2px;font-size:10px;font-weight:700;color:#819171}h1{font-size:44px;font-weight:500;line-height:1.12;letter-spacing:-2px;margin:0}h1 span{color:#8d9e78}.intro{color:#839083;line-height:1.7;margin:18px 0 26px;font-size:13px}.summary{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:32px}.stat{border:1px solid #e3e7dc;border-radius:12px;padding:17px 20px;background:#f1f3eb}.stat:last-child{background:#faf9f4}.stat strong{font-size:25px;font-weight:500;display:block;margin-bottom:5px}.stat small{color:#84917f;font-size:11px}.section-heading{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px}.section-heading h2{font-size:14px;font-weight:600;margin:0}.pill{font-size:10px;color:#7b896b;background:#edf1e7;padding:5px 9px;border-radius:20px}.tasks{display:grid;gap:9px}.task{display:flex;align-items:center;gap:12px;background:white;border:1px solid #e8ebe3;border-radius:10px;padding:16px 14px}.check{width:19px;height:19px;flex-shrink:0;border:1.5px solid #ccd4c5;background:white;border-radius:6px;display:grid;place-items:center;padding:0;color:white}.done .check{background:#829573;border-color:#829573}.task-text{flex:1;font-size:12px;overflow-wrap:anywhere}.done .task-text{text-decoration:line-through;color:#a1a99b}.tag{font-size:9px;color:#8c9a78;background:#f2f5ec;padding:4px 7px;border-radius:4px}.delete{border:0;background:transparent;color:#a4ad9f;font-size:17px;padding:0 3px}.delete:hover{color:#8d4b4b}.add-form{display:flex;gap:8px;margin-top:14px}.add-form input{min-width:0;flex:1;border:1px solid #e4e8de;border-radius:8px;padding:11px 12px;background:transparent;font-size:12px;color:#28382e}.add-form button{background:#354c3b;color:white;border:0;border-radius:8px;padding:10px 13px;font-size:12px}.footer{margin-top:32px;text-align:center;font-size:10px;color:#a0a996}.empty{padding:18px;text-align:center;color:#84917f;font-size:12px}.completion{margin:0 0 20px;font-size:11px;color:#7c8e6a;min-height:15px}@media(max-width:480px){.app{padding:24px 22px}.date{font-size:9px}.eyebrow{margin-top:38px}h1{font-size:36px}.tag{display:none}.summary{margin-bottom:24px}}
</style>
</head>
<body>
<main class="app">
<nav class="nav"><div class="brand"><span class="sun" aria-hidden="true">☼</span>daylight</div><span class="date">YOUR PERSONAL FOCUS SPACE</span></nav>
<p class="eyebrow">Small steps. Good days.</p>
<h1>Make room for<br><span>what matters.</span></h1>
<p class="intro">A little clarity for your day.<br>One task at a time, you've got this.</p>
<div class="summary"><div class="stat"><strong id="remaining">2</strong><small>Tasks to focus on</small></div><div class="stat"><strong id="finished">1</strong><small>Little wins today</small></div></div>
<p class="completion" id="completion" aria-live="polite"></p>
<div class="section-heading"><h2>Your tasks</h2><span class="pill">Today</span></div>
<div class="tasks" id="tasks"></div>
<div class="add-form"><input id="task-input" aria-label="New task" placeholder="What's your next small step?" maxlength="120" autocomplete="off"><button type="button" id="add-task">+ Add task</button></div>
<p class="footer">Less noise. More intention. ✧</p>
</main>
<script>
const tasks=[{id:1,text:'Sketch out the next big idea',done:false,tag:'Creative'},{id:2,text:'Take a screen-free coffee break',done:false,tag:'Wellbeing'},{id:3,text:'Make a little space to focus',done:true,tag:'Personal'}];
let nextId=4;
function render(){
 const list=document.getElementById('tasks');list.replaceChildren();
 tasks.forEach(task=>{
  const row=document.createElement('div');row.className='task'+(task.done?' done':'');
  const check=document.createElement('button');check.className='check';check.textContent=task.done?'✓':'';check.setAttribute('aria-label',(task.done?'Mark incomplete: ':'Complete: ')+task.text);check.setAttribute('aria-pressed',String(task.done));check.addEventListener('click',()=>{task.done=!task.done;render()});
  const text=document.createElement('span');text.className='task-text';text.textContent=task.text;
  const tag=document.createElement('span');tag.className='tag';tag.textContent=task.tag;
  const remove=document.createElement('button');remove.className='delete';remove.textContent='×';remove.setAttribute('aria-label','Delete: '+task.text);remove.addEventListener('click',()=>{tasks.splice(tasks.findIndex(item=>item.id===task.id),1);render()});
  row.append(check,text,tag,remove);list.append(row);
 });
 if(!tasks.length){const empty=document.createElement('p');empty.className='empty';empty.textContent='A fresh start. Add your first task below.';list.append(empty)}
 const done=tasks.filter(task=>task.done).length;document.getElementById('remaining').textContent=String(tasks.length-done);document.getElementById('finished').textContent=String(done);document.getElementById('completion').textContent=tasks.length&&done===tasks.length?'All done. Take a moment to enjoy it.':'';
}
function addTask(){const input=document.getElementById('task-input');const text=input.value.trim();if(!text)return;tasks.push({id:nextId++,text,done:false,tag:'Personal'});input.value='';render();input.focus()}
document.getElementById('add-task').addEventListener('click',addTask);
document.getElementById('task-input').addEventListener('keydown',event=>{if(event.key==='Enter'&&!event.isComposing){event.preventDefault();addTask()}});
render();
</script>
</body></html>`;
