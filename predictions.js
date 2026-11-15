/* Analisi statistica gratuita, senza quote. */
let predictionArchive=null, predictionLoading=false, predictionError=false;
const predDate=s=>new Date(s).toLocaleString('it-IT',{timeZone:'Europe/Rome',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'});
async function refreshPredictionArchive(){
 if(predictionLoading)return; predictionLoading=true;
 try{const r=await fetch('data/predictions.json?ts='+Date.now(),{cache:'no-store'});if(!r.ok)throw Error('Archivio');const d=await r.json();if(!Array.isArray(d.runs))throw Error('Formato');predictionArchive=d;predictionError=false;}catch(e){predictionError=true;}finally{predictionLoading=false;if(state.tab==='predictions'&&document.querySelector('[data-tab="predictions"].active'))render();}
}
// Independent descriptive team analysis; never counted as a verified player pick.
function teamTrend(g, finals){
 const rows=(t,venue)=>finals.filter(f=>(f.home===t||f.away===t)&&(!venue||f[venue]===t));
 const win=(f,t)=>f.home===t?f.homeScore>f.awayScore:f.awayScore>f.homeScore;
 const rate=(a,t)=>a.filter(f=>win(f,t)).length/a.length;
 const h=rows(g.home), a=rows(g.away), hv=rows(g.home,'home'), av=rows(g.away,'away');
 if(h.length<5||a.length<5||hv.length<4||av.length<4)return null;
 const hr=rate(h.slice(0,5),g.home), ar=rate(a.slice(0,5),g.away), home=rate(hv,g.home), away=rate(av,g.away);
 const diff=.5*(hr-ar)+.3*(home-away)+.2*(rate(h,g.home)-rate(a,g.away));
 if(Math.abs(diff)<.20)return null;
 const t=diff>0?g.home:g.away, o=diff>0?g.away:g.home;
 const r=diff>0?h:a, other=diff>0?a:h, v=diff>0?hv:av, ov=diff>0?av:hv;
 const fmt=(x,t)=>`${x.filter(f=>win(f,t)).length}/${x.length}`;
 return {team:t,reason:`Ultime 5: ${fmt(r.slice(0,5),t)} vittorie contro ${fmt(other.slice(0,5),o)}. Rendimento nella sede prevista: ${fmt(v,t)} contro ${fmt(ov,o)}.`};
}
function playerWatch(g,finals){
 const hist=new Map();
 for(const f of finals)for(const r of (state.boxscores?.[String(f.id)]||[])){
  if(!(r.minutes>0))continue; const id=String(r.id); if(!hist.has(id))hist.set(id,[]);hist.get(id).push(r);
 }
 const mean=a=>a.reduce((x,y)=>x+y,0)/a.length;
 const out=[];
 for(const p of state.players){if(![g.home,g.away].includes(p.team))continue;
  const h=hist.get(String(p.id))||[]; if(h.length<5||h.slice(0,5).some(r=>r.team!==p.team))continue;
  const recent=h.slice(0,5), mins=mean(recent.map(r=>r.minutes));if(mins<20)continue;
  const metrics=[['Punti','pts'],['Rimbalzi','reb'],['Assist','ast'],['Triple','tpm']].filter(([_,k])=>recent.every(r=>Number.isFinite(r[k]))).map(([label,k])=>({label,avg:mean(recent.map(r=>r[k]))}));
  if(metrics.length)out.push({name:p.name,team:p.team,mins,metrics});
 }
 return [g.home,g.away].flatMap(t=>out.filter(p=>p.team===t).sort((a,b)=>b.mins-a.mins).slice(0,2));
}
function renderPredictions(){
 if(!predictionArchive&&!predictionLoading&&!predictionError)queueMicrotask(refreshPredictionArchive);
 const e=escapeHtml, now=Date.now(), runs=predictionArchive?.runs||[], run=[...runs].sort((a,b)=>String(b.updated).localeCompare(String(a.updated)))[0];
 const today=new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const cs=run?.candidates||[], current=!!run&&Date.parse(run.updated)<=now&&now-Date.parse(run.updated)<24*3600000, byId=new Map(cs.map(c=>[String(c.id),c]));
 const pick=c=>`${e(c.name)} (${e(teamName(c.team))}) — ${e(c.metric)} ${e(c.side)} ${e(c.line)}`;
 const details=c=>`<div class="card"><strong>${pick(c)}</strong><p class="muted">Indice statistico: ${e(c.score)}/100 · Media stagione ${e(c.avg)} · Ultime 10: ${e(c.avg10)} · Ultime 5: ${e(c.avg5)}<br>Soglia rispettata: ${e(c.hits10)}/10 · Minuti medi recenti: ${e(c.minutes)}</p></div>`;
 const groups=current?(run?.combinations||[]).map(ids=>ids.map(id=>byId.get(String(id))).filter(Boolean)).filter(g=>g.length>=3&&g.every(c=>Date.parse(c.start)>now)):[];
 const upcoming=state.games.filter(g=>g.status==='Scheduled'&&Date.parse(g.startTime)>now&&Date.parse(g.startTime)<=now+86400000).sort((a,b)=>Date.parse(a.startTime)-Date.parse(b.startTime));
 const sample=(team,venue)=>state.games.filter(g=>g.status==='Final'&&(g.home===team||g.away===team)&&(!venue||g[venue]===team)).sort((a,b)=>Date.parse(b.startTime)-Date.parse(a.startTime)).slice(0,10);
 const stats=(arr,t)=>{if(!arr.length)return '—';const wins=arr.filter(g=>g.home===t?g.homeScore>g.awayScore:g.awayScore>g.homeScore).length;return `${wins}V – ${arr.length-wins}S`;};
 const fresh=state.updated&&now-Date.parse(state.updated)<36*3600000&&!(state.errors||[]).length;
 const finals=state.games.filter(f=>f.status==='Final'&&Date.parse(f.startTime)<now&&Number.isFinite(f.homeScore)&&Number.isFinite(f.awayScore)).sort((a,b)=>Date.parse(b.startTime)-Date.parse(a.startTime));
 const trendHtml=g=>{const t=fresh?teamTrend(g,finals):null;return t?`<p><strong>Indicazione: vittoria ${e(teamName(t.team))}</strong></p><p>${e(t.reason)}</p><p class="muted">Tendenza storica; assenze non verificate.</p>`:'<p class="muted">Nessun vantaggio di squadra sufficientemente chiaro o dati non aggiornati.</p>';};
 const watchHtml=g=>{const ps=fresh?playerWatch(g,finals):[];return ps.length?`<details><summary>Giocatori da osservare</summary><p class="muted">Medie ultime 5 gare giocate; non sono pronostici. Disponibilità da verificare.</p>${ps.map(p=>`<p><strong>${e(p.name)} (${e(teamName(p.team))})</strong><br>${p.metrics.map(m=>e(m.label)+': '+m.avg.toFixed(1)).join(' · ')}<br>Minuti: ${p.mins.toFixed(1)}</p>`).join('')}</details>`:'';};
 const cards=upcoming.map(g=>{const h=sample(g.home),a=sample(g.away);const picks=current?cs.filter(c=>String(c.game)===String(g.id)&&Date.parse(c.start)>now):[];return `<article class="card"><span class="label">${predDate(g.startTime)}</span><h3>${e(teamName(g.home))} – ${e(teamName(g.away))}</h3><p>Ultime 5: ${e(teamName(g.home))} ${stats(h.slice(0,5),g.home)} · ${e(teamName(g.away))} ${stats(a.slice(0,5),g.away)}</p><p class="muted">Casa: ${stats(sample(g.home,'home'),g.home)} · Trasferta: ${stats(sample(g.away,'away'),g.away)}</p>${trendHtml(g)}${watchHtml(g)}${picks.length?picks.map(details).join(''):'<p class="muted">Nessuna selezione giocatore supera i filtri.</p>'}</article>`;});
 return `<h2>Pronostici NBA</h2><p class="muted">${run?'Ultima analisi: '+predDate(run.updated):predictionError?'Archivio analisi non disponibile.':'Caricamento analisi…'}${run&&!current?' · Analisi precedente, non utilizzata per nuove selezioni.':''}</p><h3>Selezioni statistiche</h3>${groups.length?groups.map((g,i)=>`<article class="card"><h3>${i===0?'Selezione principale':'Alternativa'}</h3>${g.map(details).join('')}</article>`).join(''):'<div class="card">Nessuna combinazione di 3 selezioni verificata. Le indicazioni sulle squadre sono disponibili nelle singole partite quando i dati lo consentono.</div>'}<p class="muted">Soglie statistiche interne, non quote reali né probabilità di vincita. ${run?e(run.status):''}</p><h3>Prossime 24 ore</h3>${cards.join('')||'<p>Nessuna partita futura nell’archivio per le prossime 24 ore.</p>'}`;
}
