// Stime esplorative basate solo sui risultati ESPN archiviati, non quote o consigli certi.
function renderPredictions(){
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
  if(h.length<5||a.length<5)return `<article class="card"><h3>${escapeHtml(teamName(g.away))} @ ${escapeHtml(teamName(g.home))}</h3><p class="muted">${date} · Dati insufficienti per una stima attendibile (almeno 5 gare per squadra).</p><p>Quota SNAI: non disponibile</p></article>`;
  const hp=(recent(h,'pf')+recent(a,'pa'))/2+venueAdj(h,hh,'pf')+venueAdj(a,aa,'pa');
  const ap=(recent(a,'pf')+recent(h,'pa'))/2+venueAdj(a,aa,'pf')+venueAdj(h,hh,'pa');
  const total=hp+ap, diff=hp-ap;
  // Scala di incertezza ampia: stima indicativa, non probabilità calibrata.
  const p=100/(1+Math.exp(-diff/13));
  const winner=p>=50?g.home:g.away,confidence=Math.max(p,100-p);
  const level=confidence>=70?'Nettamente favorita':confidence>=60?'Favorita':confidence>=55?'Leggermente favorita':'Partita equilibrata';
  const recommendation=confidence===50?'Partita equilibrata: nessuna favorita':`<strong>${escapeHtml(teamName(winner))}</strong> · ${level}${confidence<55?' (vantaggio minimo)':''}`;
  const wins=arr=>arr.filter(x=>x.win).length;
  const form=(arr)=>`${wins(arr.slice(0,5))}-${Math.min(5,arr.length)-wins(arr.slice(0,5))}`;
  const record=arr=>arr.length?`${wins(arr)}-${arr.length-wins(arr)}`:'—';
  return `<article class="card"><span class="label">${date} · Orario italiano</span><h3>${escapeHtml(teamName(g.away))} @ ${escapeHtml(teamName(g.home))}</h3><p>Favorita dal modello: ${recommendation}</p><p class="muted">Forma ultime 5 (V-S): ${escapeHtml(teamName(g.home))} ${form(h)} · ${escapeHtml(teamName(g.away))} ${form(a)}. Casa/trasferta (ultime max 10, V-S): ${record(hh)} / ${record(aa)}.</p><p>Probabilità indicativa: ${escapeHtml(teamName(g.home))} <strong>${safe(p)}%</strong> · ${escapeHtml(teamName(g.away))} <strong>${safe(100-p)}%</strong></p><p>Proiezione punti: ${escapeHtml(teamName(g.away))} ${safe(ap)} – ${safe(hp)} ${escapeHtml(teamName(g.home))} · Totale stimato <strong>${safe(total)}</strong></p><p class="muted">Campione: ultime ${h.length} gare ${escapeHtml(teamName(g.home))} e ${a.length} gare ${escapeHtml(teamName(g.away))}. Over/Under e giocate sui giocatori richiedono linee e dati aggiornati sulle assenze.</p><p><strong>Quota SNAI: non disponibile</strong> · Ultimo aggiornamento quote: non disponibile</p></article>`;
 });
 return `<h2>Pronostici NBA</h2><p class="muted">Stime automatiche sui risultati archiviati: ultime 10 gare con maggiore peso alle ultime 5 e correzioni offensive e difensive casa/trasferta. Aggiornate quando viene sincronizzato l'archivio. Non sono quote SNAI né probabilità validate. Non includono ancora infortuni, quintetti confermati o linee di mercato: non usare queste proiezioni da sole per scommettere.</p><p class="muted">Dati NBA: ${state.updated?new Date(state.updated).toLocaleString('it-IT',{timeZone:'Europe/Rome'}):'non disponibili'} · Quote: fonte non collegata</p>${cards.length?cards.join(''):'<div class="empty">Nessuna partita futura presente nell’archivio. Premi Aggiorna dopo la prossima sincronizzazione.</div>'}`;
}
