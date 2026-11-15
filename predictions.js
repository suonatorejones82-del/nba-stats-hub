/* Analisi statistica gratuita, senza quote. */
let predictionArchive=null, predictionLoading=false, predictionError=false;
const predDate=s=>new Date(s).toLocaleString('it-IT',{timeZone:'Europe/Rome',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
async function refreshPredictionArchive(){
 if(predictionLoading)return; predictionLoading=true;
 try{const r=await fetch('data/predictions.json?ts='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('Archivio');const d=await r.json();if(!Array.isArray(d.runs))throw Error('Formato');predictionArchive=d;predictionError=false;}catch(e){predictionError=true;}finally{predictionLoading=false;if(state.tab==='predictions'&&document.querySelector('[data-tab="predictions"].active'))render();}
}
function renderPredictions(){
 if(!predictionArchive&&!predictionLoading&&!predictionError)queueMicrotask(refreshPredictionArchive);
 const e=escapeHtml, now=Date.now(), runs=predictionArchive?.runs||[], run=[...runs].sort((a,b)=>String(b.updated).localeCompare(String(a.updated)))[0];
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const cs=run?.candidates||[], current=run?.day===today, byId=new Map(cs.map(c=>[String(c.id),c]));
 const pick=c=>`${e(c.name)} (${e(teamName(c.team))}) — ${e(c.metric)} ${e(c.side)} ${e(c.line)}`;
 const details=c=>`<div class="card"><strong>${pick(c)}</strong><p class="muted">Indice statistico: ${e(c.score)}/100 · Media stagione ${e(c.avg)} · Ultime 10: ${e(c.avg10)} · Ultime 5: ${e(c.avg5)}<br>Soglia rispettata: ${e(c.hits10)}/10 · Minuti medi recenti: ${e(c.minutes)}</p></div>`;
 const groups=current?(run?.combinations||[]).map(ids=>ids.map(id=>byId.get(String(id))).filter(Boolean)).filter(g=>g.length>=3&&g.every(c=>Date.parse(c.start)>now)):[];
 const upcoming=state.games.filter(g=>g.status==='Scheduled'&&Date.parse(g.startTime)>now&&Date.parse(g.startTime)<=now+86400000).sort((a,b)=>Date.parse(a.startTime)-Date.parse(b.startTime));
 const sample=(team,venue)=>state.games.filter(g=>g.status==='Final'&&(g.home===team||g.away===team)&&(!venue||g[venue]===team)).sort((a,b)=>Date.parse(b.startTime)-Date.parse(a.startTime)).slice(0,10);
 const stats=(arr,t)=>{if(!arr.length)return '—';const wins=arr.filter(g=>g.home===t?g.homeScore>g.awayScore:g.awayScore>g.homeScore).length;return `${wins}V – ${arr.length-wins}S`;};
 const cards=upcoming.map(g=>{const h=sample(g.home),a=sample(g.away);const picks=current?cs.filter(c=>String(c.game)===String(g.id)&&Date.parse(c.start)>now):[];return `<article class="card"><span class="label">${predDate(g.startTime)}</span><h3>${e(teamName(g.home))} – ${e(teamName(g.away))}</h3><p>Ultime 5: ${e(teamName(g.home))} ${stats(h.slice(0,5),g.home)} · ${e(teamName(g.away))} ${stats(a.slice(0,5),g.away)}</p><p class="muted">Casa: ${stats(sample(g.home,'home'),g.home)} · Trasferta: ${stats(sample(g.away,'away'),g.away)}</p>${picks.length?picks.map(details).join(''):'<p class="muted">Nessuna selezione statistica disponibile.</p>'}</article>`;});
 return `<h2>Pronostici NBA</h2><p class="muted">${run?'Ultima analisi: '+predDate(run.updated):predictionError?'Archivio analisi non disponibile.':'Caricamento analisi…'}${run&&!current?' · Analisi precedente, non utilizzata per nuove selezioni.':''}</p><h3>Selezioni statistiche</h3>${groups.length?groups.map((g,i)=>`<article class="card"><h3>${i===0?'Selezione principale':'Alternativa'}</h3>${g.map(details).join('')}</article>`).join(''):'<div class="card">Nessuna combinazione di almeno 3 selezioni supera i filtri disponibili per le partite non iniziate.</div>'}<p class="muted">Soglie statistiche interne, non quote reali né probabilità di vincita. ${run?e(run.status):''}</p><h3>Prossime 24 ore</h3>${cards.join('')||'<p>Nessuna partita futura nell’archivio per le prossime 24 ore.</p>'}`;
}
