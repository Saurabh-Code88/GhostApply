import { useState, useEffect, useCallback } from "react";

const API = "http://localhost:3001/api";
const WEEKLY = [{ day:"Mon",applied:8,matched:5 },{ day:"Tue",applied:12,matched:7 },{ day:"Wed",applied:6,matched:4 },{ day:"Thu",applied:15,matched:9 },{ day:"Fri",applied:6,matched:3 }];
const S = {
  MATCHED:  { label:"Matched",    color:"#00ff88", bg:"rgba(0,255,136,0.08)"  },
  APPROVED: { label:"Approved",   color:"#00ccff", bg:"rgba(0,204,255,0.08)"  },
  SENT:     { label:"Sent",       color:"#ff9500", bg:"rgba(255,149,0,0.08)"  },
  REPLIED:  { label:"Replied 🎉", color:"#ff3cac", bg:"rgba(255,60,172,0.08)" },
  GHOSTED:  { label:"Ghosted 👻", color:"#555",    bg:"rgba(85,85,85,0.08)"   },
  SKIPPED:  { label:"Skipped",    color:"#333",    bg:"rgba(40,40,40,0.08)"   },
};
const sc = s => s>=80?"#00ff88":s>=60?"#ff9500":"#ff4444";

function ScoreRing({ score }) {
  const c=sc(score),r=18,circ=2*Math.PI*r,dash=(score/100)*circ;
  return (
    <div style={{position:"relative",width:48,height:48,flexShrink:0}}>
      <svg width="48" height="48" style={{transform:"rotate(-90deg)"}}>
        <circle cx="24" cy="24" r={r} fill="none" stroke="#1a1a1a" strokeWidth="4"/>
        <circle cx="24" cy="24" r={r} fill="none" stroke={c} strokeWidth="4"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{filter:`drop-shadow(0 0 4px ${c})`}}/>
      </svg>
      <span style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",
        fontSize:11,fontWeight:700,color:c,fontFamily:"monospace"}}>{score}</span>
    </div>
  );
}

function Pill({ label, type }) {
  const color=type==="match"?"#00ff88":"#ff4444";
  return <span style={{fontSize:10,padding:"2px 8px",borderRadius:99,fontFamily:"monospace",
    background:type==="match"?"rgba(0,255,136,0.1)":"rgba(255,68,68,0.1)",
    color,border:`1px solid ${color}33`}}>{label}</span>;
}

function Btn({ children, color="#00ff88", textColor, onClick, style={} }) {
  return <button onClick={onClick} style={{background:color+"15",border:`1px solid ${color}44`,
    color:textColor||color,padding:"6px 14px",borderRadius:6,fontSize:11,cursor:"pointer",
    fontFamily:"monospace",...style}}>{children}</button>;
}

function DraftModal({ job, onClose, onSend }) {
  const [msg, setMsg] = useState(job?.draftMessage||"");
  const [channel, setChannel] = useState("linkedin");
  const [sending, setSending] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!job) return null;
  const copy=()=>{ navigator.clipboard.writeText(msg).catch(()=>{}); setCopied(true); setTimeout(()=>setCopied(false),2000); };
  const handleSend=async()=>{ setSending(true); if(onSend) await onSend(job.id,channel,msg); setSending(false); onClose(); };
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.85)",zIndex:100,
      display:"flex",alignItems:"center",justifyContent:"center",padding:20}} onClick={onClose}>
      <div style={{background:"#0d0d0d",border:"1px solid #00ff8844",borderRadius:12,
        padding:28,maxWidth:560,width:"100%",maxHeight:"80vh",overflowY:"auto"}} onClick={e=>e.stopPropagation()}>
        <div style={{fontSize:13,fontWeight:700,color:"#00ff88",marginBottom:4}}>📬 {job.title} @ {job.company}</div>
        <div style={{fontSize:11,color:"#555",marginBottom:14}}>To: {job.founderName||"Founder"} · Edit before sending</div>
        <textarea value={msg} onChange={e=>setMsg(e.target.value)}
          style={{width:"100%",minHeight:160,background:"#111",border:"1px solid #222",color:"#ccc",
            borderRadius:8,padding:14,fontSize:12,lineHeight:1.7,fontFamily:"monospace",
            resize:"vertical",outline:"none",boxSizing:"border-box"}}/>
        <div style={{display:"flex",gap:8,margin:"12px 0"}}>
          {["linkedin","email"].map(ch=>(
            <button key={ch} onClick={()=>setChannel(ch)} style={{fontSize:10,padding:"4px 12px",
              borderRadius:6,cursor:"pointer",fontFamily:"monospace",textTransform:"uppercase",
              background:channel===ch?"rgba(0,255,136,0.1)":"transparent",
              border:`1px solid ${channel===ch?"#00ff88":"#333"}`,
              color:channel===ch?"#00ff88":"#555"}}>{ch}</button>
          ))}
        </div>
        <div style={{display:"flex",gap:10,marginTop:4,flexWrap:"wrap"}}>
          <Btn onClick={copy}>{copied?"✓ Copied!":"📋 Copy"}</Btn>
          {job.founderLinkedIn&&job.founderLinkedIn!=="#"&&(
            <a href={job.founderLinkedIn} target="_blank" rel="noreferrer"
              style={{background:"rgba(0,204,255,0.1)",border:"1px solid #00ccff44",color:"#00ccff",
                padding:"6px 14px",borderRadius:6,fontSize:11,fontFamily:"monospace",textDecoration:"none"}}>
              🔗 LinkedIn ↗</a>
          )}
          <Btn onClick={handleSend} style={{marginLeft:"auto"}}>{sending?"Sending...":` ▶ Send via ${channel}`}</Btn>
          <Btn color="#333" textColor="#666" onClick={onClose}>Close</Btn>
        </div>
      </div>
    </div>
  );
}

function JobCard({ job, onApprove, onSkip, onViewDraft, onStatusChange }) {
  const [expanded, setExpanded] = useState(false);
  const cfg=S[job.status]||S.SKIPPED;
  const fd=job.fitData||{};
  return (
    <div onClick={()=>setExpanded(!expanded)}
      style={{background:"#0d0d0d",border:`1px solid ${cfg.color}22`,borderLeft:`3px solid ${cfg.color}`,
        borderRadius:8,padding:"14px 16px",marginBottom:10,cursor:"pointer",transition:"border-color 0.2s"}}
      onMouseEnter={e=>e.currentTarget.style.borderColor=cfg.color+"55"}
      onMouseLeave={e=>e.currentTarget.style.borderColor=cfg.color+"22"}>
      <div style={{display:"flex",alignItems:"center",gap:12}}>
        <ScoreRing score={job.fitScore||0}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:13,fontWeight:700,color:"#f0f0f0",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{job.title}</div>
          <div style={{fontSize:11,color:"#666",marginTop:2}}>
            {job.company} · {job.location} ·{" "}
            <span style={{color:cfg.color,fontSize:10,textTransform:"uppercase",letterSpacing:1}}>{job.source}</span>
          </div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
          <span style={{fontSize:10,color:cfg.color,background:cfg.bg,padding:"3px 8px",borderRadius:4}}>{cfg.label}</span>
          <span style={{color:"#333",fontSize:11}}>{expanded?"▲":"▼"}</span>
        </div>
      </div>
      {expanded&&(
        <div style={{marginTop:14,borderTop:"1px solid #1e1e1e",paddingTop:14}} onClick={e=>e.stopPropagation()}>
          {(fd.matchedSkills?.length>0||fd.missingSkills?.length>0)&&(
            <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:10}}>
              {fd.matchedSkills?.map(s=><Pill key={s} label={s} type="match"/>)}
              {fd.missingSkills?.map(s=><Pill key={s} label={s} type="miss"/>)}
            </div>
          )}
          {fd.reason&&<p style={{fontSize:11,color:"#777",lineHeight:1.6,marginBottom:10}}>{fd.reason}</p>}
          {job.founderName&&(
            <div style={{fontSize:11,color:"#555",marginBottom:8}}>
              👤 <span style={{color:"#00ccff"}}>{job.founderName}</span>
              {job.founderLinkedIn&&job.founderLinkedIn!=="#"&&<a href={job.founderLinkedIn} style={{color:"#444",marginLeft:8,fontSize:10}}>LinkedIn ↗</a>}
              {job.founderTwitter&&job.founderTwitter!=="#"&&<a href={job.founderTwitter} style={{color:"#444",marginLeft:8,fontSize:10}}>Twitter ↗</a>}
            </div>
          )}
          {job.companyNews&&<div style={{fontSize:11,color:"#444",fontStyle:"italic",marginBottom:12}}>📰 {job.companyNews}</div>}
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {(job.status==="MATCHED"||job.status==="APPROVED")&&(
              <Btn onClick={()=>onViewDraft(job)}>📬 {job.status==="MATCHED"?"View Draft":"Edit & Send"}</Btn>
            )}
            {job.status==="MATCHED"&&<>
              <Btn color="#00ccff" onClick={()=>onApprove(job.id)}>✅ Approve</Btn>
              <Btn color="#444" textColor="#888" onClick={()=>onSkip(job.id)}>✕ Skip</Btn>
            </>}
            {job.status==="SENT"&&<Btn color="#ff3cac" onClick={()=>onStatusChange(job.id,"REPLIED")}>🎉 Mark Replied</Btn>}
          </div>
        </div>
      )}
    </div>
  );
}

function JobsScreen({ jobs, setJobs, onViewDraft }) {
  const [filter, setFilter] = useState("ALL");
  const filtered=filter==="ALL"?jobs:jobs.filter(j=>j.status===filter);
  const updateStatus=async(id,status)=>{
    try{ await fetch(`${API}/jobs/${id}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({status})}); }catch{}
    setJobs(p=>p.map(j=>j.id===id?{...j,status}:j));
  };
  return (
    <div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:20}}>
        {["ALL","MATCHED","APPROVED","SENT","REPLIED","GHOSTED","SKIPPED"].map(f=>{
          const count=f==="ALL"?jobs.length:jobs.filter(j=>j.status===f).length;
          const cfg=S[f]||{color:"#555"};
          const active=filter===f;
          return <button key={f} onClick={()=>setFilter(f)} style={{
            fontSize:10,padding:"5px 12px",borderRadius:6,cursor:"pointer",fontFamily:"monospace",
            letterSpacing:0.5,textTransform:"uppercase",
            background:active?(cfg.bg||"rgba(255,255,255,0.05)"):"transparent",
            border:`1px solid ${active?cfg.color:"#222"}`,
            color:active?cfg.color:"#444"}}>{f}{count>0&&` (${count})`}</button>;
        })}
      </div>
      {filtered.length===0?(
        <div style={{textAlign:"center",padding:"60px 20px",color:"#2a2a2a",fontSize:12}}>
          <div style={{fontSize:32,marginBottom:12}}>👻</div>No jobs here. Run the pipeline!
        </div>
      ):filtered.map(job=>(
        <JobCard key={job.id} job={job}
          onApprove={id=>updateStatus(id,"APPROVED")}
          onSkip={id=>updateStatus(id,"SKIPPED")}
          onStatusChange={updateStatus}
          onViewDraft={onViewDraft}/>
      ))}
    </div>
  );
}

function InboxScreen({ jobs, onViewDraft }) {
  const inbox=jobs.filter(j=>["APPROVED","SENT","REPLIED","GHOSTED"].includes(j.status))
    .sort((a,b)=>({REPLIED:0,APPROVED:1,SENT:2,GHOSTED:3}[a.status]||9)-({REPLIED:0,APPROVED:1,SENT:2,GHOSTED:3}[b.status]||9));
  const icon={APPROVED:"📝",SENT:"✈️",REPLIED:"🎉",GHOSTED:"👻"};
  return (
    <div>
      <div style={{fontSize:11,color:"#444",marginBottom:20}}>{inbox.length} tracked · {jobs.filter(j=>j.status==="REPLIED").length} replies received</div>
      {inbox.length===0?(
        <div style={{textAlign:"center",padding:"60px 20px",color:"#2a2a2a",fontSize:12}}>
          <div style={{fontSize:28,marginBottom:12}}>📭</div>Approve some matches to start outreach.
        </div>
      ):inbox.map(job=>{
        const cfg=S[job.status]||S.SENT;
        return (
          <div key={job.id} style={{background:"#0d0d0d",border:"1px solid #1a1a1a",
            borderRadius:8,padding:"14px 16px",marginBottom:8,display:"flex",alignItems:"center",gap:14}}>
            <div style={{fontSize:22,flexShrink:0}}>{icon[job.status]||"📧"}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:13,fontWeight:600,color:"#f0f0f0",marginBottom:2}}>{job.company}</div>
              <div style={{fontSize:11,color:"#555"}}>{job.title}{job.founderName&&` · ${job.founderName}`}</div>
              {job.status==="REPLIED"&&<div style={{fontSize:11,color:"#ff3cac",marginTop:4}}>← They replied! Check LinkedIn/Gmail.</div>}
            </div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8,flexShrink:0}}>
              <span style={{fontSize:10,padding:"2px 8px",borderRadius:4,background:cfg.bg,color:cfg.color,fontFamily:"monospace"}}>{cfg.label}</span>
              <div style={{display:"flex",gap:6}}>
                {job.draftMessage&&job.status!=="GHOSTED"&&(
                  <Btn onClick={()=>onViewDraft(job)} style={{fontSize:10,padding:"3px 10px"}}>View</Btn>
                )}
                {job.founderLinkedIn&&job.founderLinkedIn!=="#"&&(
                  <a href={job.founderLinkedIn} target="_blank" rel="noreferrer"
                    style={{fontSize:10,padding:"3px 10px",borderRadius:6,border:"1px solid #00ccff44",
                      color:"#00ccff",background:"rgba(0,204,255,0.08)",textDecoration:"none",fontFamily:"monospace"}}>LI ↗</a>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function StatsScreen({ stats, jobs }) {
  const maxA=Math.max(...WEEKLY.map(d=>d.applied),1);
  const replyRate=stats.sent>0?Math.round((stats.replied/stats.sent)*100):0;
  const topJobs=[...jobs].filter(j=>j.fitScore).sort((a,b)=>b.fitScore-a.fitScore).slice(0,5);
  const missingMap={};
  jobs.forEach(j=>j.fitData?.missingSkills?.forEach(s=>{missingMap[s]=(missingMap[s]||0)+1;}));
  const topMissing=Object.entries(missingMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
  return (
    <div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,marginBottom:20}}>
        {[{l:"Scraped",v:stats.total,c:"#555"},{l:"Matched",v:stats.matched,c:"#00ff88"},{l:"Sent",v:stats.sent,c:"#ff9500"},
          {l:"Replies",v:stats.replied,c:"#ff3cac"},{l:"Reply rate",v:`${replyRate}%`,c:"#00ccff"},{l:"Ghosted",v:stats.ghosted,c:"#444"}]
          .map(item=>(
          <div key={item.l} style={{background:"#0d0d0d",border:"1px solid #1a1a1a",borderRadius:8,padding:"14px 16px"}}>
            <div style={{fontSize:24,fontWeight:700,color:item.c,fontFamily:"monospace"}}>{item.v}</div>
            <div style={{fontSize:10,color:"#333",textTransform:"uppercase",letterSpacing:1,marginTop:4}}>{item.l}</div>
          </div>
        ))}
      </div>
      <div style={{background:"#0d0d0d",border:"1px solid #1a1a1a",borderRadius:8,padding:"18px 20px",marginBottom:14}}>
        <div style={{fontSize:10,color:"#444",textTransform:"uppercase",letterSpacing:1,marginBottom:16}}>This week</div>
        <div style={{display:"flex",alignItems:"flex-end",gap:10,height:80}}>
          {WEEKLY.map(d=>(
            <div key={d.day} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
              <div style={{width:"100%",display:"flex",flexDirection:"column",justifyContent:"flex-end",height:70,gap:2}}>
                <div style={{width:"100%",height:`${(d.matched/maxA)*70}px`,background:"rgba(0,255,136,0.4)",borderRadius:"3px 3px 0 0",minHeight:2}}/>
                <div style={{width:"100%",height:`${((d.applied-d.matched)/maxA)*70}px`,background:"#1e1e1e",borderRadius:"3px 3px 0 0",minHeight:2}}/>
              </div>
              <div style={{fontSize:10,color:"#333"}}>{d.day}</div>
            </div>
          ))}
        </div>
        <div style={{display:"flex",gap:14,marginTop:10}}>
          <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"#444"}}>
            <div style={{width:8,height:8,borderRadius:2,background:"rgba(0,255,136,0.4)"}}/> Matched
          </div>
          <div style={{display:"flex",alignItems:"center",gap:5,fontSize:10,color:"#444"}}>
            <div style={{width:8,height:8,borderRadius:2,background:"#1e1e1e",border:"1px solid #333"}}/> Scraped
          </div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div style={{background:"#0d0d0d",border:"1px solid #1a1a1a",borderRadius:8,padding:"16px 18px"}}>
          <div style={{fontSize:10,color:"#444",textTransform:"uppercase",letterSpacing:1,marginBottom:14}}>Top matches</div>
          {topJobs.length===0?<div style={{fontSize:11,color:"#2a2a2a"}}>No matches yet</div>:
          topJobs.map(job=>(
            <div key={job.id} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
              <div style={{fontSize:12,fontWeight:700,color:sc(job.fitScore),fontFamily:"monospace",width:28}}>{job.fitScore}</div>
              <div style={{minWidth:0}}>
                <div style={{fontSize:11,color:"#ccc",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{job.company}</div>
                <div style={{fontSize:10,color:"#444",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{job.title}</div>
              </div>
            </div>
          ))}
        </div>
        <div style={{background:"#0d0d0d",border:"1px solid #1a1a1a",borderRadius:8,padding:"16px 18px"}}>
          <div style={{fontSize:10,color:"#444",textTransform:"uppercase",letterSpacing:1,marginBottom:14}}>Skill gaps</div>
          {topMissing.length===0?<div style={{fontSize:11,color:"#2a2a2a"}}>No data yet</div>:
          topMissing.map(([skill,count])=>(
            <div key={skill} style={{marginBottom:8}}>
              <div style={{display:"flex",justifyContent:"space-between",fontSize:10,color:"#666",marginBottom:3}}>
                <span style={{fontFamily:"monospace"}}>{skill}</span>
                <span style={{color:"#444"}}>{count} JDs</span>
              </div>
              <div style={{height:3,background:"#1a1a1a",borderRadius:99}}>
                <div style={{height:"100%",borderRadius:99,background:"#ff4444",width:`${(count/topMissing[0][1])*100}%`}}/>
              </div>
            </div>
          ))}
          <div style={{fontSize:10,color:"#2a2a2a",marginTop:12}}>Learn these to boost match rate ↑</div>
        </div>
      </div>
    </div>
  );
}

export default function GhostApply() {
  const [screen, setScreen] = useState("jobs");
  const [jobs, setJobs] = useState([]);
  const [stats, setStats] = useState({total:0,matched:0,approved:0,sent:0,replied:0,ghosted:0});
  const [draftJob, setDraftJob] = useState(null);
  const [pipeline, setPipeline] = useState({running:false,step:""});
  const [resumeUploaded, setResumeUploaded] = useState(false);
  const [gmailConnected, setGmailConnected] = useState(false);

  const fetchAll=useCallback(async()=>{
    try {
      const [jr,sr]=await Promise.all([fetch(`${API}/jobs?limit=200`),fetch(`${API}/jobs/stats`)]);
      if(jr.ok){
        const d=await jr.json();
        setJobs((d.jobs||[]).map(j=>({...j,fitData:(()=>{try{return JSON.parse(j.fitReason||"{}")}catch{return{}}})()})));
      }
      if(sr.ok) setStats(await sr.json());
    }catch(e){ console.error("API:",e); }
  },[]);

  useEffect(()=>{
    fetchAll();
    fetch(`${API}/outreach/gmail/status`).then(r=>r.json()).then(d=>setGmailConnected(d.connected)).catch(()=>{});
  },[fetchAll]);

  const handleSend=async(jobId,channel,message)=>{
    try{
      await fetch(`${API}/outreach/draft/${jobId}`,{method:"PATCH",headers:{"Content-Type":"application/json"},body:JSON.stringify({draftMessage:message})});
      await fetch(`${API}/outreach/send`,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({jobId,channel})});
    }catch{}
    setJobs(p=>p.map(j=>j.id===jobId?{...j,status:"SENT"}:j));
    fetchAll();
  };

  const triggerPipeline=async()=>{
    if(pipeline.running) return;
    setPipeline({running:true,step:"🔍 Hunting Indeed + LinkedIn..."});
    const steps=["🎯 Scoring with RAG...","🔬 Researching founders...","✍️ Drafting messages...","💬 Checking replies...","✅ Done!"];
    let i=0;
    const iv=setInterval(()=>{
      setPipeline({running:true,step:steps[i]});
      if(i===steps.length-1){ clearInterval(iv); setTimeout(()=>{ setPipeline({running:false,step:""}); fetchAll(); },1500); }
      i++;
    },900);
    try{ await fetch(`${API}/jobs/pipeline/run`,{method:"POST"}); }catch{}
  };

  const uploadResume=async(e)=>{
    const file=e.target.files?.[0]; if(!file) return;
    const fd=new FormData(); fd.append("resume",file);
    try{ const r=await fetch(`${API}/jobs/resume/upload`,{method:"POST",body:fd}); if(r.ok){ setResumeUploaded(true); fetchAll(); } }catch{}
  };

  const tabs=[
    {id:"jobs",  label:"Today's Hunts", count:jobs.filter(j=>j.status==="MATCHED").length},
    {id:"inbox", label:"Outreach Inbox",count:jobs.filter(j=>["APPROVED","SENT","REPLIED"].includes(j.status)).length},
    {id:"stats", label:"Stats",         count:null},
  ];

  return (
    <div style={{minHeight:"100vh",background:"#080808",color:"#e0e0e0",fontFamily:"'IBM Plex Mono','Courier New',monospace"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;700&display=swap');
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:4px}::-webkit-scrollbar-track{background:#111}::-webkit-scrollbar-thumb{background:#333;border-radius:2px}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.3}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
      `}</style>

      {/* Header */}
      <div style={{borderBottom:"1px solid #1a1a1a",padding:"16px 28px",display:"flex",
        alignItems:"center",justifyContent:"space-between",background:"#0a0a0a",flexWrap:"wrap",gap:12}}>
        <div>
          <div style={{fontSize:20,fontWeight:800,letterSpacing:-0.5}}>
            <span style={{color:"#00ff88"}}>Ghost</span><span style={{color:"#f0f0f0"}}>Apply</span>
            <span style={{fontSize:9,color:"#2a2a2a",marginLeft:8,letterSpacing:2}}>v1.0</span>
          </div>
          <div style={{fontSize:10,color:"#2a2a2a",marginTop:1}}>You sleep. It hunts.</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
          {/* Resume upload */}
          <label style={{cursor:"pointer"}}>
            <input type="file" accept=".pdf" onChange={uploadResume} style={{display:"none"}}/>
            <span style={{fontSize:10,padding:"5px 12px",borderRadius:6,fontFamily:"monospace",cursor:"pointer",
              background:resumeUploaded?"rgba(0,255,136,0.1)":"rgba(255,149,0,0.08)",
              border:`1px solid ${resumeUploaded?"#00ff8844":"#ff950044"}`,
              color:resumeUploaded?"#00ff88":"#ff9500"}}>
              {resumeUploaded?"✓ Resume uploaded":"📄 Upload Resume"}
            </span>
          </label>
          {/* Gmail */}
          <a href={`${API.replace('/api','')}/auth/gmail`} target="_blank" rel="noreferrer"
            style={{fontSize:10,padding:"5px 12px",borderRadius:6,fontFamily:"monospace",textDecoration:"none",
              background:gmailConnected?"rgba(0,255,136,0.1)":"transparent",
              border:`1px solid ${gmailConnected?"#00ff8844":"#2a2a2a"}`,
              color:gmailConnected?"#00ff88":"#444"}}>
            {gmailConnected?"✓ Gmail":"Connect Gmail"}
          </a>
          {/* Pipeline */}
          <div style={{display:"flex",alignItems:"center",gap:8}}>
            <div style={{width:7,height:7,borderRadius:"50%",
              background:pipeline.running?"#ff9500":"#00ff88",
              boxShadow:`0 0 6px ${pipeline.running?"#ff9500":"#00ff88"}`,
              animation:pipeline.running?"pulse 1s infinite":"none"}}/>
            <span style={{fontSize:10,color:"#444"}}>{pipeline.running?pipeline.step:"Idle · 6AM IST"}</span>
            <button onClick={triggerPipeline} disabled={pipeline.running}
              style={{background:"rgba(0,255,136,0.1)",border:"1px solid #00ff8844",color:"#00ff88",
                padding:"5px 12px",borderRadius:6,fontSize:10,cursor:pipeline.running?"not-allowed":"pointer",
                fontFamily:"monospace",opacity:pipeline.running?0.5:1}}>
              {pipeline.running?"...":"▶ Run"}
            </button>
          </div>
        </div>
      </div>

      {/* Stats bar */}
      <div style={{background:"#0a0a0a",borderBottom:"1px solid #1a1a1a",padding:"12px 28px",display:"flex",gap:24,flexWrap:"wrap"}}>
        {[{l:"Scraped",v:stats.total,c:"#444"},{l:"Matched",v:stats.matched,c:"#00ff88"},
          {l:"Sent",v:stats.sent,c:"#ff9500"},{l:"Replies",v:stats.replied,c:"#ff3cac"},
          {l:"Rate",v:stats.sent>0?`${Math.round((stats.replied/stats.sent)*100)}%`:"—",c:"#00ccff"}]
          .map(s=>(
          <div key={s.l} style={{display:"flex",alignItems:"baseline",gap:6}}>
            <span style={{fontSize:20,fontWeight:800,color:s.c,fontFamily:"monospace"}}>{s.v}</span>
            <span style={{fontSize:10,color:"#2a2a2a",textTransform:"uppercase",letterSpacing:1}}>{s.l}</span>
          </div>
        ))}
      </div>

      {/* Nav */}
      <div style={{background:"#0a0a0a",borderBottom:"1px solid #1a1a1a",padding:"0 28px",display:"flex"}}>
        {tabs.map(tab=>(
          <button key={tab.id} onClick={()=>setScreen(tab.id)} style={{
            fontSize:11,padding:"12px 16px",cursor:"pointer",fontFamily:"monospace",
            background:"transparent",border:"none",transition:"all 0.15s",
            borderBottom:`2px solid ${screen===tab.id?"#00ff88":"transparent"}`,
            color:screen===tab.id?"#00ff88":"#444"}}>
            {tab.label}
            {tab.count!==null&&tab.count>0&&(
              <span style={{marginLeft:6,fontSize:9,background:"rgba(0,255,136,0.12)",
                color:"#00ff88",padding:"1px 6px",borderRadius:99}}>{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {/* Content */}
      <div style={{maxWidth:800,margin:"0 auto",padding:"24px 20px",animation:"fadeIn 0.4s ease"}}>
        {screen==="jobs" &&<JobsScreen jobs={jobs} setJobs={setJobs} onViewDraft={setDraftJob}/>}
        {screen==="inbox"&&<InboxScreen jobs={jobs} onViewDraft={setDraftJob}/>}
        {screen==="stats"&&<StatsScreen stats={stats} jobs={jobs}/>}
      </div>

      <DraftModal job={draftJob} onClose={()=>setDraftJob(null)} onSend={handleSend}/>
    </div>
  );
}
