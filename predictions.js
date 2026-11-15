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
  const wins=arr=>arr.filter(x=>x.win).length;
  const form=(arr)=>`${wins(arr.slice(0,5))}-${Math.min(5,arr.length)-wins(arr.slice(0,5))}`;
  const record=arr=>arr.length?`${wins(arr)}-${arr.length-wins(arr)}`:'—';
  return `<article class="card"><span class="label">${date} · Orario italiano</span><h3>${predictionLogo(g.home)} ${escapeHtml(teamName(g.home))} <span class="muted">VS</span> ${predictionLogo(g.away)} ${escapeHtml(teamName(g.away))}</h3><p>Favorita dal modello: ${recommendation}</p><p class="muted">Forma ultime 5 (V-S): ${escapeHtml(teamName(g.home))} ${form(h)} · ${escapeHtml(teamName(g.away))} ${form(a)}. Casa/trasferta (ultime max 10, V-S): ${record(hh)} / ${record(aa)}.</p><p>Probabilità indicativa: ${escapeHtml(teamName(g.home))} <strong>${safe(p)}%</strong> · ${escapeHtml(teamName(g.away))} <strong>${safe(100-p)}%</strong></p><div role="img" aria-label="Probabilità indicative casa e trasferta" style="display:flex;height:12px;border-radius:8px;overflow:hidden;background:#334155"><span style="width:${p}%;background:#fb923c"></span><span style="width:${100-p}%;background:#60a5fa"></span></div><p class="muted">Arancione: casa · Azzurro: trasferta</p><p class="muted">Casa: ${escapeHtml(teamName(g.home))} · Trasferta: ${escapeHtml(teamName(g.away))}</p><p><strong>Over/Under:</strong> in attesa della linea SNAI verificata. Nessuna giocata suggerita.</p><p><strong>Handicap:</strong> in attesa della linea SNAI verificata. Nessuna giocata suggerita.</p><p>Margine stimato: <strong>${safe(Math.abs(diff))} punti</strong> ${diff===0?'· parità':'a favore di '+escapeHtml(teamName(winner))}</p><p class="muted">${escapeHtml(teamName(g.home))}: ${predictionRest(g,g.home)}<br>${escapeHtml(teamName(g.away))}: ${predictionRest(g,g.away)}</p><details><summary>Assenze e giocatori in dubbio (ESPN)</summary><p><strong>${escapeHtml(teamName(g.home))}</strong><br>${predictionInjuryText(g.home)}</p><p><strong>${escapeHtml(teamName(g.away))}</strong><br>${predictionInjuryText(g.away)}</p><p class="muted">Segnalazioni informative, non ancora incluse nel calcolo.</p></details><p class="muted">Campione: ultime ${h.length} gare ${escapeHtml(teamName(g.home))} e ${a.length} gare ${escapeHtml(teamName(g.away))}. Over/Under e handicap non vengono consigliati senza linee di mercato verificate; le giocate sui giocatori richiedono anche dati aggiornati sulle assenze.</p><p><strong>Quote SNAI: non collegate</strong> · Ultimo aggiornamento quote: non disponibile</p></article>`;
 });
 return `<h2>Pronostici NBA</h2><button type="button" onclick="refreshPredictions()" ${predictionInjuries.status==='loading'?'disabled':''}>Aggiorna pronostici</button><p class="muted">Assenze ESPN: ${predictionInjuries.updated?predictionInjuries.updated.toLocaleString('it-IT',{timeZone:'Europe/Rome'}):predictionInjuries.status==='loading'?'caricamento…':'non disponibili'} (ora di acquisizione)</p><p class="muted">Stime automatiche sui risultati archiviati: ultime 10 gare con maggiore peso alle ultime 5 e correzioni offensive e difensive casa/trasferta. Aggiornate quando viene sincronizzato l'archivio. Non sono quote SNAI né probabilità validate. Il calcolo non include ancora infortuni, riposo, quintetti confermati o linee di mercato: non usare queste proiezioni da sole per scommettere.</p><p class="muted">Dati NBA: ${state.updated?new Date(state.updated).toLocaleString('it-IT',{timeZone:'Europe/Rome'}):'non disponibili'} · Quote: fonte non collegata</p>${cards.length?cards.join(''):'<div class="empty">Nessuna partita futura presente nell’archivio. Premi Aggiorna dopo la prossima sincronizzazione.</div>'}`;
}
