const titles={nodes:'节点系统',video:'视频工作台',stage3d:'3D 外框架',assets:'资产中心',panels:'右侧与 Agent',presets:'预设中心',modals:'大型弹窗',projects:'项目卡片'}
const nav=[...document.querySelectorAll('[data-view]')]
const pages=[...document.querySelectorAll('[data-page]')]
function showView(id){const next=titles[id]?id:'nodes';nav.forEach(b=>b.classList.toggle('active',b.dataset.view===next));pages.forEach(p=>p.classList.toggle('active',p.dataset.page===next));document.getElementById('viewTitle').textContent=titles[next];history.replaceState(null,'',`#${next}`)}
nav.forEach(b=>b.addEventListener('click',()=>showView(b.dataset.view)))
document.querySelectorAll('[data-tabs]').forEach(group=>group.addEventListener('click',e=>{const button=e.target.closest('[data-tab]');if(!button)return;group.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b===button));const shell=group.parentElement;shell.querySelectorAll('[data-panel]').forEach(p=>p.classList.toggle('active',p.dataset.panel===button.dataset.tab))}))
document.querySelectorAll('[data-modal-demo]').forEach(button=>button.addEventListener('click',()=>{document.querySelectorAll('[data-modal-demo]').forEach(b=>b.classList.toggle('active',b===button));document.querySelectorAll('[data-modal-panel]').forEach(p=>p.classList.toggle('active',p.dataset.modalPanel===button.dataset.modalDemo))}))
const dirtyDialog=document.getElementById('dirtyDialog')
const shortcutDialog=document.getElementById('shortcutDialog')
document.querySelectorAll('[data-action="close-dirty"]').forEach(b=>b.addEventListener('click',()=>dirtyDialog.hidden=false))
document.querySelectorAll('[data-dialog="cancel"]').forEach(b=>b.addEventListener('click',()=>dirtyDialog.hidden=true))
document.querySelectorAll('[data-dialog="discard"],[data-dialog="save"]').forEach(b=>b.addEventListener('click',()=>{dirtyDialog.hidden=true;document.querySelector('.dirty-state').textContent='所有更改已保存'}))
document.getElementById('savePreset').addEventListener('click',()=>document.querySelector('.dirty-state').textContent='所有更改已保存')
document.getElementById('shortcutBtn').addEventListener('click',()=>shortcutDialog.hidden=false)
document.querySelector('[data-dialog="shortcut-close"]').addEventListener('click',()=>shortcutDialog.hidden=true)
document.getElementById('motionBtn').addEventListener('click',e=>{document.body.classList.toggle('motion-paused');e.currentTarget.textContent=document.body.classList.contains('motion-paused')?'继续动效':'暂停动效'})
document.addEventListener('keydown',e=>{if(e.key==='Escape'){dirtyDialog.hidden=true;shortcutDialog.hidden=true}if(e.key==='?'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName))shortcutDialog.hidden=false})
showView(location.hash.slice(1)||'nodes')
