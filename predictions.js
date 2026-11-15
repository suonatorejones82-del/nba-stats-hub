// V17: injury feed is informational, not an input to the prediction model.
let predictionInjuries={status:'idle',teams:{},updated:null};
const predictionCodes={GSW:'GS',NYK:'NY',NOP:'NO',SAS:'SA',UTA:'UTAH',WAS:'WSH'};
function predictionLogo(code){return `<img width="32" height="32" style="object-fit:contain;vertical-align:middle" alt="" src="https://a.espncdn.com/i/teamlogos/nba/500/${encodeURIComponent((predictionCodes[code]||code).toLowerCase())}.png" onerror="this.hidden=true">`;}
function predictionRest(game,team){
 const day=g=>String(g.date||g.startTime||'').slice(0,10);
 const prior=state.games.filter(g=>(g.home===team||g.away===team)&&Date.parse(g.startTime)<Date.parse(game.startTime)&&['Final','Scheduled'].includes(g.status)).sort((a,b)=>Date.parse(b.startTime)-Date.parse(a.startTime))[0];
 if(!prior)return 'Riposo non disponibile';
 const gap=Math.round((Date.parse(day(game))-Date.parse(day(prior)))/86400000);
 if(!Number.isFinite(gap)||gap<1)return 'Riposo non disponibile';
 return (gap===1?'Back-to-back · 0 giorni liberi':`${gap-1} giorni liberi`)+(prior.status==='Scheduled'?' (da calendario)':'');
}
function predictionInjuryText(code){
 const data=predictionInjuries;
 if(data.status==='loading')return 'Caricamento…';
 if(data.status!=='ok')return 'Dati assenze non disponibili';
 const rows=data.teams[code];
 if(!rows)return 'Nessun dato per questa squadra nella fonte';
 if(!rows.length)return 'Nessuna segnalazione nella fonte (non conferma tutti disponibili)';
 return rows.map(r=>`${escapeHtml(r.name)} — ${escapeHtml(r.status)}`).join('<br>');
}
async function refreshPredictionInjuries(){
 if(predictionInjuries.status==='loading')return;
 predictionInjuries={status:'loading',teams:{},updated:null}; if(state.tab==='predictions')render();
 try{
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),12000);
 let response;try{response=await fetch('https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries',{cache:'no-store',signal:controller.signal});if(!response.ok)throw Error('HTTP');const data=await response.json();
 if(!Array.isArray(data.injuries))throw Error('Formato non riconosciuto');
 const teams={};for(const group of data.injuries){const code=normalizeCode(group.team?.abbreviation||group.abbreviation||TEAMS.find(t=>t[1]===group.displayName)?.[0]);if(!TEAMS.some(t=>t[0]===code)||!Array.isArray(group.injuries))continue;teams[code]=group.injuries.filter(r=>r.athlete?.displayName).map(r=>({name:r.athlete.displayName,status:r.status||'Stato non indicato'}));}
 if(!Object.keys(teams).length)throw Error('Nessuna squadra riconosciuta');predictionInjuries={status:'ok',teams,updated:new Date()};}finally{clearTimeout(timer);}
 }catch(e){predictionInjuries={status:'error',teams:{},updated:null};}
 if(state.tab==='predictions')render();
}
async function refreshPredictions(){await load();await refreshPredictionInjuries();}
// V21: linee inserite dall'utente, non scaricate né verificate da SNAI.
const predictionManualKey='nba-hub-manual-lines-v21';
function predictionReadLines(){try{return JSON.parse(localStorage.getItem(predictionManualKey)||'{}')||{}}catch(e){return {}}}
const predictionHistoryKey='nba-hub-history-v22';
function predictionHistory(){try{return JSON.parse(localStorage.getItem(predictionHistoryKey)||'{}')||{}}catch(e){return {}}}
function predictionSave(key,id,home,away,p,diff,total,start){
 if(Date.parse(start)<=Date.now())return alert('Partita già iniziata.');
 const form=document.getElementById('market-'+key);if(!form.reportValidity())return;
 const item={};for(const field of ['homeOdds','awayOdds','total','spread','overOdds','underOdds','homeSpreadOdds','awaySpreadOdds']){const v=form.elements[field].value;if(v!=='')item[field]=Number(v);}
 const lines=predictionReadLines();lines[key]=item;
 const history=predictionHistory();
 const picks={};if(p!==50)picks.winner=p>50?'home':'away';
 if(Number.isFinite(item.total)&&Math.abs(total-item.total)>=3)picks.total=total>item.total?'over':'under';
 if(Number.isFinite(item.spread)&&Math.abs(diff+item.spread)>=2)picks.spread=diff+item.spread>0?'home':'away';
 history[id]={id,home,away,start,p,diff,total,lines:item,picks,saved:new Date().toISOString()};
 try{localStorage.setItem(predictionManualKey,JSON.stringify(lines));localStorage.setItem(predictionHistoryKey,JSON.stringify(history));}catch(e){return alert('Impossibile salvare nel browser.');}render();
}
function predictionLineInput(key,field,label,placeholder,odds=false){
 const v=predictionReadLines()[key]?.[field];
 return `<label style="display:block;flex:1;min-width:125px;font-size:.9rem">${label}<input name="${field}" type="number" step="${odds?'0.01':'0.5'}" ${odds?'min="1.01" max="1000"':field==='total'?'min="1" max="500"':'min="-100" max="100"'} inputmode="decimal" placeholder="${placeholder}" value="${Number.isFinite(v)?v:''}" style="display:block;width:100%;box-sizing:border-box;padding:9px;margin-top:5px;border-radius:8px;background:#0d1726;color:#fff;border:1px solid #475569"></label>`;
}
function predictionOutcome(r,g,k){
 if(!r.picks[k])return '—';if(!g||g.status!=='Final'||!Number.isFinite(g.homeScore)||!Number.isFinite(g.awayScore))return 'In attesa';
 const d=g.homeScore-g.awayScore,t=g.homeScore+g.awayScore;
 const x=k==='winner'?d:k==='total'?t-r.lines.total:d+r.lines.spread;
 if(x===0)return 'Rimborso';const actual=k==='total'?(x>0?'over':'under'):(x>0?'home':'away');return actual===r.picks[k]?'Corretto':'Errato';
}
function predictionHistoryHtml(){
 const rows=Object.values(predictionHistory()).sort((a,b)=>b.start.localeCompare(a.start));const keys=['winner','total','spread'];
 const outcomes=r=>keys.map(k=>predictionOutcome(r,state.games.find(g=>String(g.id)===String(r.id)),k));
 const stats=keys.map((k,i)=>{const o=rows.map(r=>outcomes(r)[i]),w=o.filter(x=>x==='Corretto').length,l=o.filter(x=>x==='Errato').length;return `${['Vincente','Over/Under','Handicap'][i]}: ${w}/${w+l} ${w+l?'('+ (100*w/(w+l)).toFixed(1)+'%)':'(—)'}`;});
 const pick=(r,k)=>{const v=r.picks[k];return !v?'—':k==='total'?`${v==='over'?'Over':'Under'} ${r.lines.total}`:k==='spread'?`${teamName(v==='home'?r.home:r.away)} ${v==='home'?r.lines.spread:-r.lines.spread}`:teamName(v==='home'?r.home:r.away);};
 return `<details class="card"><summary><strong>Storico pronostici (${rows.length})</strong></summary><p>${stats.join('<br>')}</p><p class="muted">Solo pronostici salvati prima della gara. Rimborsi e partite in attesa esclusi dalle percentuali. Archivio locale a questo browser.</p>${rows.map(r=>`<div style="border-top:1px solid #475569;padding:10px 0"><strong>${escapeHtml(teamName(r.home))} vs ${escapeHtml(teamName(r.away))}</strong><p class="muted">${new Date(r.start).toLocaleString('it-IT',{timeZone:'Europe/Rome'})}</p>${keys.map((k,i)=>`<div>${escapeHtml(pick(r,k))}: ${outcomes(r)[i]==='Corretto'?'🟢':outcomes(r)[i]==='Errato'?'🔴':''} ${outcomes(r)[i]}</div>`).join('')}</div>`).join('')||'<p>Nessun pronostico salvato.</p>'}</details>`;
}
// Stime esplorative basate solo sui risultati ESPN archiviati, non quote o consigli certi.
function renderPredictions(){
 if(predictionInjuries.status==='idle')queueMicrotask(refreshPredictionInjuries);
 const completed=state.games.filter(g=>g.status==='Final'&&Number.isFinite(g.homeScore)&&Number.isFinite(g.awayScore)).sort((a,b)=>String(b.startTime).localeCompare(String(a.startTime)));
 const now=Date.now();const upcoming=state.games.filter(g=>g.status==='Scheduled'&&Number.isFinite(Date.parse(g.startTime))&&Date.parse(g.startTime)>now).sort((a,b)=>Date.parse(a.startTime)-Date.parse(b.startTime)).slice(0,20);
 const safe=n=>Number.isFinite(n)?n.toFixed(1):'—';
 const sample=(team,venue)=>completed.filter(g=>g.home===team||g.away===team).filter(g=>!venue||(venue==='home'?g.home===team:g.away===team)).slice(0,10).map(g=>({pf:g.home===team?g.homeScore:g.awayScore,pa:g.home===team?g.awayScore:g.homeScore,win:(g.home===team?g.homeScore>g.awayScore:g.awayScore>g.homeScore)}));
 const avg=(arr,key)=>arr.reduce((s,x)=>s+x[key],0)/arr.length;
 const recent=(arr,key)=>.7*avg(arr,key)+.3*avg(arr.slice(0,5),key);
 const venueAdj=(all,venue,key)=>venue.length>=3?.25*(avg(venue,key)-avg(all,key)):0;
 const cards=upcoming.map(g=>{
  const h=sample(g.home),a=sample(g.away),hh=sample(g.home,'home'),aa=sample(g.away,'away');
  const date=new Date(g.startTime).toLocaleString('it-IT',{timeZone:'Europe/Rome',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
  if(h.length<5||a.length<5)return `<article class="card"><h3>${predictionLogo(g.home)} ${escapeHtml(teamName(g.home))} <span class="muted">VS</span> ${predictionLogo(g.away)} ${escapeHtml(teamName(g.away))}</h3><p class="muted">${date} · Dati insufficienti per una stima attendibile (almeno 5 gare per squadra).</p><p>Quote SNAI: non collegate</p></article>`;
  const hp=(recent(h,'pf')+recent(a,'pa'))/2+venueAdj(h,hh,'pf')+venueAdj(a,aa,'pa');
  const ap=(recent(a,'pf')+recent(h,'pa'))/2+venueAdj(a,aa,'pf')+venueAdj(h,hh,'pa');
  const diff=hp-ap; // La proiezione interna resta disponibile per futuri confronti con linee verificate.
  // Scala di incertezza ampia: stima indicativa, non probabilità calibrata.
  const p=100/(1+Math.exp(-diff/13));
  const winner=p>=50?g.home:g.away,confidence=Math.max(p,100-p);
  const level=confidence>=70?'Nettamente favorita':confidence>=60?'Favorita':confidence>=55?'Leggermente favorita':'Partita equilibrata';
  const recommendation=confidence===50?'Partita equilibrata: nessuna favorita':`<strong>${escapeHtml(teamName(winner))}</strong> · ${level}${confidence<55?' (vantaggio minimo)':''}`;
  const key=[g.home,g.away,String(g.startTime).replace(/[^0-9]/g,'')].join('_');
  const manual=predictionReadLines()[key]||{};
  const total=hp+ap;
  const ou=Number.isFinite(manual.total)?`Proiezione interna ${safe(total)} punti · differenza dalla linea inserita: <strong>${safe(total-manual.total)} punti</strong> (${total>manual.total?'sopra':total<manual.total?'sotto':'in linea'}). Non è una probabilità di vincita.`:'Inserisci una linea per confrontarla con la proiezione interna.';
  // Handicap espresso dal punto di vista della squadra di casa: es. -4.5.
  const spread=Number.isFinite(manual.spread)?`Margine modello per la squadra di casa: ${diff>=0?'+':''}${safe(diff)}; handicap inserito ${manual.spread>0?'+':''}${safe(manual.spread)}. Differenza rispetto alla soglia: <strong>${safe(diff+manual.spread)} punti</strong>.`:'Inserisci l’handicap della squadra di casa (es. -4,5).';
  const value=(prob,odds)=>Number.isFinite(odds)?`Quota equa indicativa ${(1/prob).toFixed(2)} · rendimento teorico ${((prob*odds-1)*100).toFixed(1)}% (non validato)`:'Inserisci la quota.';
  const markets=`<details style="margin:14px 0" ${Object.keys(manual).length?'open':''}><summary>Quote SNAI manuali e confronto</summary><p class="muted">Inserisci quote decimali e linee prepartita. Non verificate automaticamente.</p><form id="market-${key}" onsubmit="event.preventDefault();predictionSave('${key}','${String(g.id).replace(/[^a-zA-Z0-9_-]/g,'')}','${g.home}','${g.away}',${p},${diff},${total},'${g.startTime}')"><div style="display:flex;gap:12px;flex-wrap:wrap">${predictionLineInput(key,'homeOdds','Quota casa','2.10',true)}${predictionLineInput(key,'awayOdds','Quota trasferta','1.75',true)}${predictionLineInput(key,'total','Linea Over/Under','225.5')}${predictionLineInput(key,'overOdds','Quota Over','1.90',true)}${predictionLineInput(key,'underOdds','Quota Under','1.90',true)}${predictionLineInput(key,'spread','Handicap casa','-4.5')}${predictionLineInput(key,'homeSpreadOdds','Quota handicap casa','1.90',true)}${predictionLineInput(key,'awaySpreadOdds','Quota handicap trasferta','1.90',true)}</div><p><button type="submit">Salva quote e pronostico</button></p></form><p class="muted">Casa: ${value(p/100,manual.homeOdds)}<br>Trasferta: ${value(1-p/100,manual.awayOdds)}</p><p><strong>Over/Under:</strong> ${ou} ${Number.isFinite(manual.total)&&Math.abs(total-manual.total)>=3?' · Indicazione: '+(total>manual.total?'Over':'Under'):''}</p><p><strong>Handicap:</strong> ${spread} ${Number.isFinite(manual.spread)&&Math.abs(diff+manual.spread)>=2?' · Indicazione: '+escapeHtml(teamName(diff+manual.spread>0?g.home:g.away)):''}</p><p class="muted">Soglie esplorative: 3 punti sul totale, 2 sull’handicap. Non sono stime di valore economico per questi mercati. Salvataggio locale; un nuovo salvataggio prima della gara sostituisce il precedente.</p></details>`;
  const wins=arr=>arr.filter(x=>x.win).length;
  const form=(arr)=>`${wins(arr.slice(0,5))}-${Math.min(5,arr.length)-wins(arr.slice(0,5))}`;
  const record=arr=>arr.length?`${wins(arr)}-${arr.length-wins(arr)}`:'—';
  return `<article class="card"><span class="label">${date} · Orario italiano</span><h3>${predictionLogo(g.home)} ${escapeHtml(teamName(g.home))} <span class="muted">VS</span> ${predictionLogo(g.away)} ${escapeHtml(teamName(g.away))}</h3><p>Favorita dal modello: ${recommendation}</p><p class="muted">Forma ultime 5 (V-S): ${escapeHtml(teamName(g.home))} ${form(h)} · ${escapeHtml(teamName(g.away))} ${form(a)}. </p><p class="muted"><strong>Rendimento casa/trasferta (V-S)</strong><br>${escapeHtml(teamName(g.home))} (Casa): ${record(hh).replace("-", "V – ")}S<br>${escapeHtml(teamName(g.away))} (Trasferta): ${record(aa).replace("-", "V – ")}S</p><p>Probabilità indicativa: ${escapeHtml(teamName(g.home))} <strong>${safe(p)}%</strong> · ${escapeHtml(teamName(g.away))} <strong>${safe(100-p)}%</strong></p><div role="img" aria-label="Probabilità indicative casa e trasferta" style="display:flex;height:12px;border-radius:8px;overflow:hidden;background:#334155"><span style="width:${p}%;background:#fb923c"></span><span style="width:${100-p}%;background:#60a5fa"></span></div><p class="muted">Arancione: casa · Azzurro: trasferta</p>${hubOddsCard(g,p,diff,total)}${markets}<p>Margine stimato: <strong>${safe(Math.abs(diff))} punti</strong> ${diff===0?'· parità':'a favore di '+escapeHtml(teamName(winner))}</p><p class="muted">${escapeHtml(teamName(g.home))}: ${predictionRest(g,g.home)}<br>${escapeHtml(teamName(g.away))}: ${predictionRest(g,g.away)}</p><details><summary>Assenze e giocatori in dubbio (ESPN)</summary><p><strong>${escapeHtml(teamName(g.home))}</strong><br>${predictionInjuryText(g.home)}</p><p><strong>${escapeHtml(teamName(g.away))}</strong><br>${predictionInjuryText(g.away)}</p><p class="muted">Segnalazioni informative, non ancora incluse nel calcolo.</p></details><details><summary>Dettagli del modello e fonti</summary><p class="muted">Campione: ultime ${h.length} gare ${escapeHtml(teamName(g.home))} e ${a.length} gare ${escapeHtml(teamName(g.away))}. Le assenze non modificano ancora il calcolo. Quote SNAI automatiche se disponibili.</p></details></article>`;
 });
 return `<h2>Pronostici NBA</h2><button type="button" onclick="refreshPredictions()" ${predictionInjuries.status==='loading'?'disabled':''}>Aggiorna pronostici</button><p class="muted">Assenze ESPN: ${predictionInjuries.updated?predictionInjuries.updated.toLocaleString('it-IT',{timeZone:'Europe/Rome'}):predictionInjuries.status==='loading'?'caricamento…':'non disponibili'} (ora di acquisizione)</p><p class="muted">Stime automatiche sui risultati archiviati: ultime 10 gare con maggiore peso alle ultime 5 e correzioni offensive e difensive casa/trasferta. Aggiornate quando viene sincronizzato l'archivio. Non sono quote SNAI né probabilità validate. Il calcolo non include ancora infortuni, riposo, quintetti confermati o linee di mercato: non usare queste proiezioni da sole per scommettere.</p><p class="muted">Dati NBA: ${state.updated?new Date(state.updated).toLocaleString('it-IT',{timeZone:'Europe/Rome'}):'non disponibili'} · Quote: PropLine (se disponibili)</p>${hubOddsHeader()}${hubV25Html(upcoming)}${predictionHistoryHtml()}${cards.length?cards.join(''):'<div class="empty">Nessuna partita futura presente nell’archivio. Premi Aggiorna dopo la prossima sincronizzazione.</div>'}`;
}
