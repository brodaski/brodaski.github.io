const NSTP = new Set(["STM 1101","STM 1102","STC 1101","STC 1102","STL 1101","STL 1102"]);
// Non-numeric grade codes from the UE grading legend. None of these are counted.
const GRADE_CODES = {
  LFR:"Lacks final requirement", W:"Officially dropped/withdrawn", D:"Unofficially dropped",
  IP:"In progress", LOA:"Leave of absence", GRWH:"Grade withheld"
};
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = n => n.toFixed(3);

function parseCSV(text){
  const rows=[]; let row=[], cur="", q=false;
  text = text.replace(/^\uFEFF/, "");
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(q){
      if(c==='"'){ if(text[i+1]==='"'){cur+='"';i++;} else q=false; }
      else cur+=c;
    } else if(c==='"') q=true;
    else if(c===","){ row.push(cur); cur=""; }
    else if(c==="\n"||c==="\r"){ if(c==="\r"&&text[i+1]==="\n") i++; row.push(cur); rows.push(row); row=[]; cur=""; }
    else cur+=c;
  }
  if(cur!==""||row.length){ row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(x => x.trim()!==""));
}

function analyze(text, inc, dFail){
  const rows = parseCSV(text);
  const head = rows[0].map(h => h.trim().toLowerCase());
  const ix = name => head.findIndex(h => h === name);
  const iCode=ix("subject code"), iDesc=ix("description"), iGrade=ix("grade"), iRe=ix("re ex"), iUnits=ix("units");
  if([iCode,iDesc,iGrade,iUnits].some(i => i<0)) throw new Error("This doesn't look like a grades export. Expected columns: Subject Code, Description, Grade, Re Ex, Units.");

  const sems = []; let cur = null;
  for(const r of rows.slice(1)){
    const code=(r[iCode]||"").trim(), desc=(r[iDesc]||"").trim();
    const m = desc.match(/(FIRST|SECOND|THIRD|SUMMER|MID-?YEAR)[^\d]*(\d{4})\s*-\s*(\d{4})/i);
    if(!code && m){
      const t = m[1].toUpperCase();
      cur = { ay: m[2]+"-"+m[3], order: t==="FIRST"?1:t==="SECOND"?2:3,
              name: desc.replace(/\s*S\.?Y\.?.*$/i,"").toLowerCase().replace(/(^|\s)\S/g,c=>c.toUpperCase()),
              subjects: [] };
      sems.push(cur); continue;
    }
    if(!cur || !code) continue;
    const gradeRaw=(r[iGrade]||"").trim();
    const reRaw=(iRe>=0 ? r[iRe]||"" : "").trim();
    let grade = parseFloat(reRaw) || parseFloat(gradeRaw);
    const units = parseFloat(r[iUnits]);
    const nstp = NSTP.has(code.toUpperCase());
    const gcode = gradeRaw.toUpperCase(), isD = gcode==="D";
    let note = "";
    if(!isFinite(grade)){
      if(isD && dFail) grade = 5;
      else note = GRADE_CODES[gcode] || (gradeRaw ? "Unrecognized grade" : "No grade yet");
    }
    const counted = (inc || !nstp) && isFinite(grade) && isFinite(units) && units>0;
    cur.subjects.push({code, desc, grade, gradeRaw, units, nstp, counted, note, isD});
  }
  if(!sems.length) throw new Error("No semesters found. Each semester should start with a row like \"FIRST SEMESTER S.Y. 2024-2025\".");

  const calc = list => { let pts=0,u=0; list.forEach(s=>{ if(s.counted){pts+=s.grade*s.units;u+=s.units;} }); return {gwa:u?pts/u:null, units:u}; };
  sems.forEach(s => Object.assign(s, calc(s.subjects)));

  const byAY = {};
  sems.forEach(s => (byAY[s.ay] ||= []).push(s));
  const ays = Object.keys(byAY).sort().reverse().map(ay => {
    const list = byAY[ay].sort((a,b)=>b.order-a.order);
    return { ay, sems:list, ...calc(list.flatMap(s=>s.subjects)) };
  });
  const all = sems.flatMap(s=>s.subjects.map(x=>({...x, sem:s.name+", A.Y. "+s.ay})));
  const skipped = all.filter(x=>!x.nstp && (x.isD || (x.note && x.note!=="No grade yet")));
  return { overall: calc(all), ays, nstpFound: all.filter(x=>x.nstp), skipped, hasD: skipped.some(x=>x.isD) };
}

function render(d){
  const nstpList = d.nstpFound.map(s=>s.code).join(", ");
  const unitsWord = n => n + (n===1?" unit":" units");
  const skippedHTML = d.skipped.length ? `
  <div class="notice info" role="note"><b class="bang" aria-hidden="true">i</b>
    <div><p><strong>Some grades aren't numbers, so they aren't counted.</strong> Once a numeric grade is posted, upload a fresh CSV.</p>
    <ul class="skipped">${d.skipped.map(x=>`<li><strong>${esc(x.code)}</strong> ${esc(x.desc)}: ${esc(x.gradeRaw||"–")}${x.isD&&dFail?" (counted as 5.00)":x.note?" ("+esc(x.note.toLowerCase())+")":""}, ${esc(x.sem)}</li>`).join("")}</ul>
    ${d.hasD?`<label class="chk"><input type="checkbox" id="dfail" ${dFail?"checked":""}> Count unofficially dropped (D) as 5.00</label><small class="hint">Off by default. Ask the Registrar if you're unsure how D is treated.</small>`:""}</div>
  </div>` : "";
  let h = `
  <div class="notice${d.skipped.length?" tight":""}" role="note"><b class="bang" aria-hidden="true">!</b>
    <div><p><strong>${includeNstp ? "NSTP subjects are included in these numbers." : "NSTP subjects are automatically excluded"}</strong> ${includeNstp ? "They aren't part of the GWA requirement for honors, so don't use these figures to check honors eligibility." : "as they aren't part of the GWA requirement for honors."}
    <small>${nstpList ? (includeNstp?"Included from your file: ":"Excluded from your file: ")+esc(nstpList)+"." : "No NSTP subjects were found in your file."}</small></p>
    <label class="chk"><input type="checkbox" id="inc" ${includeNstp?"checked":""}> Include NSTP subjects in the GWA</label></div>
  </div>${skippedHTML}
  <div class="overall"><span class="lbl">Overall GWA</span><span class="big">${d.overall.gwa==null?"–":fmt(d.overall.gwa)}</span></div>
  <p class="meta">${unitsWord(d.overall.units)} counted across ${d.ays.reduce((n,a)=>n+a.sems.length,0)} semesters</p>
  <ul class="tree">`;
  for(const a of d.ays){
    h += `<li class="ay"><div class="ay-head"><span class="name">Academic Year GWA<small>A.Y. ${esc(a.ay)} · ${a.sems.length===1?"1 semester":a.sems.length+" semesters"}</small></span><span class="num">${a.gwa==null?"–":fmt(a.gwa)}</span></div><ul class="sems">`;
    for(const s of a.sems){
      h += `<li class="sem"><details><summary><span class="s-name">${esc(s.name)} GWA<small>${unitsWord(s.units)} counted</small></span><span class="s-num">${s.gwa==null?"–":fmt(s.gwa)}</span></summary>
      <div class="tbl"><table><thead><tr><th>Code</th><th>Subject</th><th class="n">Grade</th><th class="n">Units</th></tr></thead><tbody>`;
      for(const x of s.subjects){
        h += `<tr class="${x.counted?"":"skip"}"><td>${esc(x.code)}</td><td>${esc(x.desc)}${x.nstp?`<span class="tag">NSTP ${x.counted?"included":"excluded"}</span>`:(x.isD&&x.counted?'<span class="tag">D counted as 5.00</span>':(!x.counted?`<span class="tag">Not counted${x.note?": "+esc(x.note.toLowerCase()):""}</span>`:""))}</td><td class="n">${esc(x.gradeRaw)}</td><td class="n">${isFinite(x.units)?x.units:""}</td></tr>`;
      }
      h += `</tbody></table></div></details></li>`;
    }
    h += `</ul></li>`;
  }
  h += `</ul><button class="reset" id="reset" type="button">Check another file</button>`;
  $("out").innerHTML = h;
  $("inc").onchange = e => { includeNstp = e.target.checked; render(analyze(lastText, includeNstp, dFail)); $("inc").focus(); };
  if($("dfail")) $("dfail").onchange = e => { dFail = e.target.checked; render(analyze(lastText, includeNstp, dFail)); $("dfail").focus(); };
  $("reset").onclick = () => { $("out").innerHTML=""; $("file").value=""; $("drop").style.display="block"; $("howto").style.display="block"; window.scrollTo({top:0}); };
  $("drop").style.display = "none"; $("howto").style.display = "none";
}

let lastText = "", includeNstp = false, dFail = false;
function handle(file){
  $("err").textContent = "";
  if(!file) return;
  const fr = new FileReader();
  fr.onload = () => {
    try { lastText = fr.result; render(analyze(lastText, includeNstp, dFail)); }
    catch(e){ $("out").innerHTML=""; $("err").textContent = e.message; }
  };
  fr.onerror = () => { $("err").textContent = "Couldn't read that file. Try exporting it again."; };
  fr.readAsText(file);
}
$("file").addEventListener("change", e => handle(e.target.files[0]));
const drop = $("drop");
["dragenter","dragover"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add("over"); }));
["dragleave","drop"].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove("over"); }));
drop.addEventListener("drop", e => handle(e.dataTransfer.files[0]));
