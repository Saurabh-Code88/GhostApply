import { useState, useEffect, useCallback, useRef } from "react";
import "./index.css";

const API = import.meta.env.VITE_API_URL || "";

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function getToken() { return localStorage.getItem("ga_token"); }
function setToken(t) { localStorage.setItem("ga_token", t); }
function clearToken() { localStorage.removeItem("ga_token"); }

function apiFetch(path, opts = {}) {
  const token = getToken();
  const headers = { ...(opts.headers || {}) };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  if (opts.body && !headers["Content-Type"] && !(opts.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  return fetch(`${API}${path}`, { ...opts, headers }).then(async r => {
    if (r.status === 401) { clearToken(); window.location.reload(); }
    return r.json();
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const scoreColor = s => s >= 70 ? "var(--green)" : s >= 52 ? "var(--amber)" : "var(--red)";
const STATUS_CFG = {
  MATCHED:  { label: "Matched",  cls: "status-matched"  },
  SELECTED: { label: "Selected", cls: "status-selected" },
  SENT:     { label: "Sent",     cls: "status-sent"     },
  REPLIED:  { label: "Replied",  cls: "status-replied"  },
  GHOSTED:  { label: "Ghosted",  cls: "status-ghosted"  },
  SKIPPED:  { label: "Skipped",  cls: "status-skipped"  },
  PENDING:  { label: "Pending",  cls: "status-pending"  },
};

// ─── ScoreRing ────────────────────────────────────────────────────────────────
function ScoreRing({ score, size = 44 }) {
  if (!score) return (
    <div style={{ width: size, height: size, flexShrink: 0, borderRadius: "50%",
      border: "2px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <span style={{ fontSize: 10, color: "var(--text-4)", fontWeight: 600 }}>—</span>
    </div>
  );
  const c = scoreColor(score), r = (size / 2) - 4, circ = 2 * Math.PI * r, dash = (score / 100) * circ;
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="var(--border)" strokeWidth="2.5" />
        <circle cx={size/2} cy={size/2} r={r} fill="none" stroke={c} strokeWidth="2.5"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round"
          style={{ transition: "stroke-dasharray 0.7s ease" }} />
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center",
        justifyContent: "center", fontSize: size > 40 ? 12 : 10, fontWeight: 700, color: c }}>
        {score}
      </span>
    </div>
  );
}

function StatusBadge({ status }) {
  const cfg = STATUS_CFG[status] || STATUS_CFG.PENDING;
  return <span className={`badge ${cfg.cls}`}>{cfg.label}</span>;
}

function Logo({ size = "normal", white = false }) {
  const fs = size === "large" ? 28 : 20;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8, userSelect: "none" }}>
      <div style={{ width: fs + 4, height: fs + 4, background: white ? "rgba(255,255,255,0.15)" : "var(--accent)",
        borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <span style={{ fontSize: fs - 8 }}>👻</span>
      </div>
      <span style={{ fontSize: fs, fontWeight: 800, letterSpacing: "-0.04em",
        color: white ? "#fff" : "var(--text)" }}>
        GhostApply
      </span>
    </div>
  );
}

// ─── AUTH SCREEN ──────────────────────────────────────────────────────────────
const SECURITY_QUESTIONS = [
  "What is your pet's name?",
  "What city were you born in?",
  "What is your mother's maiden name?",
  "What was the name of your first school?",
  "What is your favourite movie?",
  "What is your favourite food?",
];

function AuthScreen({ onAuth }) {
  const [tab, setTab] = useState("login"); // login | register | forgot
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [securityQuestion, setSecurityQuestion] = useState(SECURITY_QUESTIONS[0]);
  const [securityAnswer, setSecurityAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  // Forgot password state
  const [forgotStep, setForgotStep] = useState(1); // 1=email, 2=answer, 3=new password
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotQuestion, setForgotQuestion] = useState("");
  const [forgotAnswer, setForgotAnswer] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isDirectReset, setIsDirectReset] = useState(false);
  const [directSecQ, setDirectSecQ] = useState(SECURITY_QUESTIONS[0]);
  const [directSecA, setDirectSecA] = useState("");

  const resetForgot = () => {
    setForgotStep(1); setForgotEmail(""); setForgotQuestion(""); setForgotAnswer("");
    setNewPassword(""); setConfirmPassword(""); setIsDirectReset(false);
    setDirectSecQ(SECURITY_QUESTIONS[0]); setDirectSecA("");
  };

  const switchTab = (t) => { setTab(t); setError(""); setSuccess(""); if (t === "forgot") resetForgot(); };

  // ── Login / Register submit ──
  const submit = async (e) => {
    e.preventDefault();
    setError(""); setSuccess(""); setLoading(true);
    try {
      if (tab === "register") {
        if (!securityAnswer.trim()) throw new Error("Security answer is required");
        const data = await fetch(`${API}/auth/register`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password, name, securityQuestion, securityAnswer }),
        }).then(r => r.json());
        if (data.error) throw new Error(data.error);
        setToken(data.token);
        onAuth(data.user);
      } else {
        const data = await fetch(`${API}/auth/login`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        }).then(r => r.json());
        if (data.error) throw new Error(data.error);
        setToken(data.token);
        onAuth(data.user);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Forgot password: Step 1 – verify email ──
  const forgotVerifyEmail = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      const data = await fetch(`${API}/auth/forgot-password/verify-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: forgotEmail }),
      }).then(r => r.json());

      if (data.error && data.noQuestion) {
        // Legacy account — no security question set, allow direct reset
        setIsDirectReset(true);
        setForgotStep(3);
      } else if (data.error) {
        throw new Error(data.error);
      } else {
        setForgotQuestion(data.securityQuestion);
        setForgotStep(2);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Forgot password: Step 2 – verify answer → Step 3 ──
  const forgotVerifyAnswer = (e) => {
    e.preventDefault();
    if (!forgotAnswer.trim()) { setError("Please enter your answer"); return; }
    setForgotStep(3);
  };

  // ── Forgot password: Step 3 – reset password ──
  const forgotResetPassword = async (e) => {
    e.preventDefault();
    setError(""); setLoading(true);
    try {
      if (newPassword.length < 6) throw new Error("Password must be at least 6 characters");
      if (newPassword !== confirmPassword) throw new Error("Passwords don't match");

      const endpoint = isDirectReset ? "/auth/forgot-password/direct-reset" : "/auth/forgot-password/reset";
      const body = isDirectReset
        ? { email: forgotEmail, newPassword, securityQuestion: directSecQ, securityAnswer: directSecA || undefined }
        : { email: forgotEmail, securityAnswer: forgotAnswer, newPassword };

      const data = await fetch(`${API}${endpoint}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).then(r => r.json());

      if (data.error) throw new Error(data.error);
      setToken(data.token);
      onAuth(data.user);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ── Shared input style ──
  const inputStyle = {
    width: "100%", boxSizing: "border-box", padding: "10px 14px",
    background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)",
    borderRadius: 10, color: "#fff", fontSize: 14, outline: "none", transition: "border-color 0.2s",
  };
  const labelStyle = { fontSize: 12, fontWeight: 600, color: "rgba(255,255,255,0.5)", display: "block", marginBottom: 6 };
  const selectStyle = {
    ...inputStyle, cursor: "pointer", appearance: "none",
    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath d='M2 4l4 4 4-4' fill='none' stroke='rgba(255,255,255,0.4)' stroke-width='1.5'/%3E%3C/svg%3E")`,
    backgroundRepeat: "no-repeat", backgroundPosition: "right 14px center",
    paddingRight: 36,
  };
  const focusHandler = e => e.target.style.borderColor = "rgba(99,102,241,0.6)";
  const blurHandler = e => e.target.style.borderColor = "rgba(255,255,255,0.1)";

  return (
    <div style={{
      minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg, #0a0a0f 0%, #0f0f1a 40%, #0a0f0f 100%)",
      padding: 24, position: "relative", overflow: "hidden",
    }}>
      {/* Background glow blobs */}
      <div style={{ position: "absolute", top: "15%", left: "20%", width: 400, height: 400,
        borderRadius: "50%", background: "radial-gradient(circle, rgba(99,102,241,0.08) 0%, transparent 70%)",
        pointerEvents: "none" }} />
      <div style={{ position: "absolute", bottom: "15%", right: "15%", width: 350, height: 350,
        borderRadius: "50%", background: "radial-gradient(circle, rgba(16,185,129,0.06) 0%, transparent 70%)",
        pointerEvents: "none" }} />

      <div className="fade-in" style={{ width: "100%", maxWidth: 420, position: "relative", zIndex: 1 }}>
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <Logo size="large" white />
          <p style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", marginTop: 10, letterSpacing: "0.02em" }}>
            You sleep. It hunts.
          </p>
        </div>

        {/* Card */}
        <div style={{
          background: "rgba(255,255,255,0.04)", backdropFilter: "blur(20px)",
          border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "32px 36px",
          boxShadow: "0 20px 60px rgba(0,0,0,0.4)",
        }}>
          {/* Tab toggle — only show login/register when not in forgot mode */}
          {tab !== "forgot" ? (
            <div style={{ display: "flex", background: "rgba(255,255,255,0.05)", borderRadius: 10,
              padding: 4, marginBottom: 28 }}>
              {["login", "register"].map(t => (
                <button key={t} onClick={() => switchTab(t)}
                  style={{
                    flex: 1, padding: "8px 0", borderRadius: 8, border: "none", cursor: "pointer",
                    fontWeight: 600, fontSize: 13, transition: "all 0.2s",
                    background: tab === t ? "rgba(255,255,255,0.1)" : "transparent",
                    color: tab === t ? "#fff" : "rgba(255,255,255,0.4)",
                    boxShadow: tab === t ? "0 2px 8px rgba(0,0,0,0.2)" : "none",
                  }}>
                  {t === "login" ? "Sign In" : "Create Account"}
                </button>
              ))}
            </div>
          ) : (
            <div style={{ marginBottom: 24 }}>
              <button onClick={() => switchTab("login")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(255,255,255,0.4)",
                  fontSize: 13, padding: 0, display: "flex", alignItems: "center", gap: 6, marginBottom: 12 }}>
                ← Back to Sign In
              </button>
              <h3 style={{ fontSize: 18, fontWeight: 700, color: "#fff", margin: 0 }}>Reset Password</h3>
              <p style={{ fontSize: 12, color: "rgba(255,255,255,0.35)", marginTop: 4 }}>
                {forgotStep === 1 && "Enter your email to get started"}
                {forgotStep === 2 && "Answer your security question"}
                {forgotStep === 3 && "Set your new password"}
              </p>
              {/* Step indicator */}
              <div style={{ display: "flex", gap: 6, marginTop: 14 }}>
                {[1, 2, 3].map(s => (
                  <div key={s} style={{
                    flex: 1, height: 3, borderRadius: 99,
                    background: forgotStep >= s ? "rgba(99,102,241,0.8)" : "rgba(255,255,255,0.08)",
                    transition: "background 0.3s",
                  }} />
                ))}
              </div>
            </div>
          )}

          {/* ════ LOGIN FORM ════ */}
          {tab === "login" && (
            <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={labelStyle}>Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" autoComplete="email" required
                  style={inputStyle} onFocus={focusHandler} onBlur={blurHandler} />
              </div>
              <div>
                <label style={labelStyle}>Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Min. 6 characters" autoComplete="current-password" required
                  style={inputStyle} onFocus={focusHandler} onBlur={blurHandler} />
              </div>

              {error && (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(239,68,68,0.1)",
                  border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontSize: 13 }}>
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading}
                style={{
                  marginTop: 4, padding: "12px", borderRadius: 10, border: "none", cursor: "pointer",
                  background: loading ? "rgba(99,102,241,0.5)" : "linear-gradient(135deg, #6366f1, #4f46e5)",
                  color: "#fff", fontSize: 14, fontWeight: 700, transition: "all 0.2s",
                  boxShadow: loading ? "none" : "0 4px 16px rgba(99,102,241,0.35)",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}>
                {loading ? <><div className="spinner" style={{ filter: "invert(1)", width: 16, height: 16, borderWidth: 2 }} /> Signing in…</> :
                  "Sign In →"}
              </button>

              <button type="button" onClick={() => switchTab("forgot")}
                style={{ background: "none", border: "none", cursor: "pointer", color: "rgba(99,102,241,0.7)",
                  fontSize: 12, fontWeight: 600, padding: "4px 0", textAlign: "center", transition: "color 0.2s" }}
                onMouseEnter={e => e.target.style.color = "rgba(99,102,241,1)"}
                onMouseLeave={e => e.target.style.color = "rgba(99,102,241,0.7)"}>
                Forgot password?
              </button>
            </form>
          )}

          {/* ════ REGISTER FORM ════ */}
          {tab === "register" && (
            <form onSubmit={submit} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <div>
                <label style={labelStyle}>Your Name</label>
                <input value={name} onChange={e => setName(e.target.value)}
                  placeholder="Saurabh Pramanik" autoComplete="name"
                  style={inputStyle} onFocus={focusHandler} onBlur={blurHandler} />
              </div>
              <div>
                <label style={labelStyle}>Email</label>
                <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                  placeholder="you@example.com" autoComplete="email" required
                  style={inputStyle} onFocus={focusHandler} onBlur={blurHandler} />
              </div>
              <div>
                <label style={labelStyle}>Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                  placeholder="Min. 6 characters" autoComplete="new-password" required
                  style={inputStyle} onFocus={focusHandler} onBlur={blurHandler} />
              </div>

              {/* Security Question */}
              <div>
                <label style={labelStyle}>
                  Security Question <span style={{ color: "rgba(239,68,68,0.7)" }}>*</span>
                </label>
                <select value={securityQuestion} onChange={e => setSecurityQuestion(e.target.value)}
                  style={selectStyle} onFocus={focusHandler} onBlur={blurHandler}>
                  {SECURITY_QUESTIONS.map(q => <option key={q} value={q} style={{ background: "#1a1a2e", color: "#fff" }}>{q}</option>)}
                </select>
              </div>
              <div>
                <label style={labelStyle}>
                  Your Answer <span style={{ color: "rgba(239,68,68,0.7)" }}>*</span>
                </label>
                <input value={securityAnswer} onChange={e => setSecurityAnswer(e.target.value)}
                  placeholder="Answer (case-insensitive)" autoComplete="off"
                  style={inputStyle} onFocus={focusHandler} onBlur={blurHandler} />
                <p style={{ fontSize: 10, color: "rgba(255,255,255,0.25)", marginTop: 4 }}>
                  You'll need this to reset your password if you forget it.
                </p>
              </div>

              {error && (
                <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(239,68,68,0.1)",
                  border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontSize: 13 }}>
                  {error}
                </div>
              )}

              <button type="submit" disabled={loading}
                style={{
                  marginTop: 4, padding: "12px", borderRadius: 10, border: "none", cursor: "pointer",
                  background: loading ? "rgba(99,102,241,0.5)" : "linear-gradient(135deg, #6366f1, #4f46e5)",
                  color: "#fff", fontSize: 14, fontWeight: 700, transition: "all 0.2s",
                  boxShadow: loading ? "none" : "0 4px 16px rgba(99,102,241,0.35)",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                }}>
                {loading ? <><div className="spinner" style={{ filter: "invert(1)", width: 16, height: 16, borderWidth: 2 }} /> Creating…</> :
                  "Create Account →"}
              </button>
            </form>
          )}

          {/* ════ FORGOT PASSWORD FLOW ════ */}
          {tab === "forgot" && (
            <>
              {/* Step 1: Enter email */}
              {forgotStep === 1 && (
                <form onSubmit={forgotVerifyEmail} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div>
                    <label style={labelStyle}>Email Address</label>
                    <input type="email" value={forgotEmail} onChange={e => setForgotEmail(e.target.value)}
                      placeholder="you@example.com" autoComplete="email" required autoFocus
                      style={inputStyle} onFocus={focusHandler} onBlur={blurHandler} />
                  </div>

                  {error && (
                    <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(239,68,68,0.1)",
                      border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontSize: 13 }}>
                      {error}
                    </div>
                  )}

                  <button type="submit" disabled={loading}
                    style={{
                      marginTop: 4, padding: "12px", borderRadius: 10, border: "none", cursor: "pointer",
                      background: loading ? "rgba(99,102,241,0.5)" : "linear-gradient(135deg, #6366f1, #4f46e5)",
                      color: "#fff", fontSize: 14, fontWeight: 700, transition: "all 0.2s",
                      boxShadow: loading ? "none" : "0 4px 16px rgba(99,102,241,0.35)",
                      display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                    }}>
                    {loading ? <><div className="spinner" style={{ filter: "invert(1)", width: 16, height: 16, borderWidth: 2 }} /> Checking…</> :
                      "Continue →"}
                  </button>
                </form>
              )}

              {/* Step 2: Answer security question */}
              {forgotStep === 2 && (
                <form onSubmit={forgotVerifyAnswer} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  <div style={{ padding: "12px 16px", borderRadius: 10, background: "rgba(99,102,241,0.08)",
                    border: "1px solid rgba(99,102,241,0.2)" }}>
                    <p style={{ fontSize: 11, color: "rgba(99,102,241,0.6)", fontWeight: 600, marginBottom: 4 }}>
                      YOUR SECURITY QUESTION
                    </p>
                    <p style={{ fontSize: 14, color: "#fff", fontWeight: 600 }}>{forgotQuestion}</p>
                  </div>

                  <div>
                    <label style={labelStyle}>Your Answer</label>
                    <input value={forgotAnswer} onChange={e => setForgotAnswer(e.target.value)}
                      placeholder="Enter your answer (case-insensitive)" autoComplete="off" autoFocus
                      style={inputStyle} onFocus={focusHandler} onBlur={blurHandler} />
                  </div>

                  {error && (
                    <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(239,68,68,0.1)",
                      border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontSize: 13 }}>
                      {error}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" onClick={() => { setForgotStep(1); setError(""); }}
                      style={{ flex: 1, padding: "12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)",
                        cursor: "pointer", background: "transparent", color: "rgba(255,255,255,0.5)",
                        fontSize: 13, fontWeight: 600, transition: "all 0.2s" }}>
                      ← Back
                    </button>
                    <button type="submit"
                      style={{
                        flex: 2, padding: "12px", borderRadius: 10, border: "none", cursor: "pointer",
                        background: "linear-gradient(135deg, #6366f1, #4f46e5)",
                        color: "#fff", fontSize: 14, fontWeight: 700, transition: "all 0.2s",
                        boxShadow: "0 4px 16px rgba(99,102,241,0.35)",
                      }}>
                      Continue →
                    </button>
                  </div>
                </form>
              )}

              {/* Step 3: Set new password */}
              {forgotStep === 3 && (
                <form onSubmit={forgotResetPassword} style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                  {isDirectReset && (
                    <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(251,191,36,0.08)",
                      border: "1px solid rgba(251,191,36,0.2)", marginBottom: 2 }}>
                      <p style={{ fontSize: 12, color: "rgba(251,191,36,0.8)", lineHeight: 1.5 }}>
                        ⚠️ Your account has no security question. Set one below for future resets.
                      </p>
                    </div>
                  )}

                  <div>
                    <label style={labelStyle}>New Password</label>
                    <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                      placeholder="Min. 6 characters" autoComplete="new-password" required autoFocus
                      style={inputStyle} onFocus={focusHandler} onBlur={blurHandler} />
                  </div>
                  <div>
                    <label style={labelStyle}>Confirm Password</label>
                    <input type="password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter password" autoComplete="new-password" required
                      style={{
                        ...inputStyle,
                        borderColor: confirmPassword && confirmPassword !== newPassword ? "rgba(239,68,68,0.5)" :
                          confirmPassword && confirmPassword === newPassword ? "rgba(16,185,129,0.5)" : "rgba(255,255,255,0.1)",
                      }}
                      onFocus={focusHandler} onBlur={blurHandler} />
                    {confirmPassword && confirmPassword !== newPassword && (
                      <p style={{ fontSize: 11, color: "rgba(239,68,68,0.7)", marginTop: 4 }}>Passwords don't match</p>
                    )}
                  </div>

                  {/* Optional: set security question for legacy accounts */}
                  {isDirectReset && (
                    <>
                      <div style={{ height: 1, background: "rgba(255,255,255,0.06)", margin: "4px 0" }} />
                      <div>
                        <label style={labelStyle}>Security Question <span style={{ fontSize: 10, color: "rgba(255,255,255,0.25)" }}>(recommended)</span></label>
                        <select value={directSecQ} onChange={e => setDirectSecQ(e.target.value)}
                          style={selectStyle} onFocus={focusHandler} onBlur={blurHandler}>
                          {SECURITY_QUESTIONS.map(q => <option key={q} value={q} style={{ background: "#1a1a2e", color: "#fff" }}>{q}</option>)}
                        </select>
                      </div>
                      <div>
                        <label style={labelStyle}>Your Answer</label>
                        <input value={directSecA} onChange={e => setDirectSecA(e.target.value)}
                          placeholder="Answer (case-insensitive)" autoComplete="off"
                          style={inputStyle} onFocus={focusHandler} onBlur={blurHandler} />
                      </div>
                    </>
                  )}

                  {error && (
                    <div style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(239,68,68,0.1)",
                      border: "1px solid rgba(239,68,68,0.3)", color: "#f87171", fontSize: 13 }}>
                      {error}
                    </div>
                  )}

                  <div style={{ display: "flex", gap: 8 }}>
                    <button type="button" onClick={() => { setForgotStep(isDirectReset ? 1 : 2); setError(""); }}
                      style={{ flex: 1, padding: "12px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.1)",
                        cursor: "pointer", background: "transparent", color: "rgba(255,255,255,0.5)",
                        fontSize: 13, fontWeight: 600, transition: "all 0.2s" }}>
                      ← Back
                    </button>
                    <button type="submit" disabled={loading || (confirmPassword && confirmPassword !== newPassword)}
                      style={{
                        flex: 2, padding: "12px", borderRadius: 10, border: "none", cursor: "pointer",
                        background: loading ? "rgba(99,102,241,0.5)" : "linear-gradient(135deg, #6366f1, #4f46e5)",
                        color: "#fff", fontSize: 14, fontWeight: 700, transition: "all 0.2s",
                        boxShadow: loading ? "none" : "0 4px 16px rgba(99,102,241,0.35)",
                        display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                      }}>
                      {loading ? <><div className="spinner" style={{ filter: "invert(1)", width: 16, height: 16, borderWidth: 2 }} /> Resetting…</> :
                        "Reset Password →"}
                    </button>
                  </div>
                </form>
              )}
            </>
          )}
        </div>

        <p style={{ textAlign: "center", marginTop: 24, fontSize: 12, color: "rgba(255,255,255,0.25)" }}>
          Your data is processed locally. No tracking.
        </p>
      </div>
    </div>
  );
}


// ─── ONBOARDING SCREEN ────────────────────────────────────────────────────────
const STATUS_OPTIONS = [
  { value: "fresher",       label: "🎓 Fresher",         sub: "Final year / recently graduated" },
  { value: "student",       label: "📚 Student",          sub: "Still studying, looking for internships" },
  { value: "working-junior",label: "💼 Working (< 1 yr)", sub: "Just started your career" },
  { value: "working-mid",   label: "🚀 Working (1–3 yr)", sub: "Some experience, leveling up" },
  { value: "working-senior",label: "⭐ Working (3+ yr)",  sub: "Experienced, targeting senior roles" },
];

function OnboardingScreen({ user, onComplete }) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState(user.name || "");
  const [status, setStatus] = useState("");
  const [location, setLocation] = useState("");
  const [jobInput, setJobInput] = useState("");
  const [targetJobs, setTargetJobs] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadedProfile, setUploadedProfile] = useState(null);
  const [saving, setSaving] = useState(false);
  const fileRef = useRef();

  const addJob = (e) => {
    if (e.key === "Enter" && jobInput.trim()) {
      e.preventDefault();
      if (!targetJobs.includes(jobInput.trim())) setTargetJobs(j => [...j, jobInput.trim()]);
      setJobInput("");
    }
  };

  const goToStep2 = async () => {
    setSaving(true);
    try {
      await apiFetch("/auth/onboard", {
        method: "PATCH",
        body: JSON.stringify({ name, status, location, targetJobs }),
      });
      setStep(2);
    } catch (err) {
      console.error(err);
    } finally { setSaving(false); }
  };

  const handleFile = async (file) => {
    if (!file || !file.name.endsWith(".pdf")) { setUploadError("PDF only"); return; }
    setUploading(true); setUploadError("");
    try {
      const fd = new FormData();
      fd.append("resume", file);
      const data = await apiFetch("/api/jobs/resume/upload", { method: "POST", body: fd });
      if (data.error) throw new Error(data.error);
      setUploadedProfile(data.profile);
    } catch (err) {
      setUploadError(err.message);
    } finally { setUploading(false); }
  };

  const finish = async () => {
    // Mark onboarded if not done in step 1 somehow
    await apiFetch("/auth/onboard", {
      method: "PATCH",
      body: JSON.stringify({ name, status, location, targetJobs }),
    });
    onComplete({ ...user, name, status, location, targetJobs, isOnboarded: true });
  };

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex",
      flexDirection: "column", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div className="fade-in" style={{ width: "100%", maxWidth: 540 }}>
        <div style={{ marginBottom: 32 }}>
          <Logo />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 20 }}>
            {[1, 2].map(s => (
              <div key={s} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{
                  width: 28, height: 28, borderRadius: "50%", display: "flex",
                  alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700,
                  background: step >= s ? "var(--accent)" : "var(--bg-subtle)",
                  color: step >= s ? "#fff" : "var(--text-4)",
                  border: step >= s ? "none" : "1px solid var(--border)",
                  transition: "all 0.3s",
                }}>
                  {step > s ? "✓" : s}
                </div>
                <span style={{ fontSize: 12, fontWeight: 600,
                  color: step >= s ? "var(--text-2)" : "var(--text-4)" }}>
                  {s === 1 ? "About You" : "Your Resume"}
                </span>
                {s < 2 && <div style={{ width: 40, height: 1, background: step > s ? "var(--accent)" : "var(--border)" }} />}
              </div>
            ))}
          </div>
        </div>

        <div className="card" style={{ padding: "32px 36px" }}>
          {step === 1 ? (
            <>
              <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Let's personalise your hunt</h2>
              <p style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 28, lineHeight: 1.6 }}>
                Tell us a bit about yourself — we'll use this to find the right jobs for you.
              </p>

              {/* Name */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-3)", display: "block", marginBottom: 6 }}>
                  Your name <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <input value={name} onChange={e => setName(e.target.value)} placeholder="Saurabh Pramanik"
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px",
                    border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                    background: "var(--bg-subtle)", color: "var(--text)", fontSize: 14, outline: "none" }}
                  onFocus={e => e.target.style.borderColor = "var(--accent)"}
                  onBlur={e => e.target.style.borderColor = "var(--border)"}
                />
              </div>

              {/* Status */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-3)", display: "block", marginBottom: 10 }}>
                  Where are you right now? <span style={{ color: "var(--red)" }}>*</span>
                </label>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {STATUS_OPTIONS.map(opt => (
                    <button key={opt.value} onClick={() => setStatus(opt.value)}
                      style={{
                        padding: "12px 16px", borderRadius: "var(--radius-sm)", cursor: "pointer",
                        border: status === opt.value ? "2px solid var(--accent)" : "1px solid var(--border)",
                        background: status === opt.value ? "var(--accent-bg, rgba(99,102,241,0.06))" : "var(--bg-subtle)",
                        display: "flex", alignItems: "center", gap: 10, textAlign: "left",
                        transition: "all 0.15s",
                      }}>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{opt.label}</div>
                        <div style={{ fontSize: 11, color: "var(--text-4)", marginTop: 1 }}>{opt.sub}</div>
                      </div>
                      {status === opt.value && (
                        <div style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--accent)",
                          display: "flex", alignItems: "center", justifyContent: "center", fontSize: 10, color: "#fff", flexShrink: 0 }}>
                          ✓
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>

              {/* Location */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-3)", display: "block", marginBottom: 6 }}>
                  Location
                </label>
                <input value={location} onChange={e => setLocation(e.target.value)}
                  placeholder="Bangalore, India"
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px",
                    border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                    background: "var(--bg-subtle)", color: "var(--text)", fontSize: 14, outline: "none" }}
                  onFocus={e => e.target.style.borderColor = "var(--accent)"}
                  onBlur={e => e.target.style.borderColor = "var(--border)"}
                />
              </div>

              {/* Target jobs */}
              <div style={{ marginBottom: 28 }}>
                <label style={{ fontSize: 12, fontWeight: 600, color: "var(--text-3)", display: "block", marginBottom: 4 }}>
                  Specific roles you're targeting
                </label>
                <p style={{ fontSize: 11, color: "var(--text-4)", marginBottom: 8 }}>
                  Press Enter to add. Leave empty — we'll figure it out from your resume.
                </p>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
                  {targetJobs.map(j => (
                    <span key={j} style={{ padding: "4px 10px", borderRadius: 99, fontSize: 12, fontWeight: 500,
                      background: "var(--green-bg)", color: "var(--green)", border: "1px solid var(--green-border)",
                      display: "flex", alignItems: "center", gap: 6 }}>
                      {j}
                      <button onClick={() => setTargetJobs(tj => tj.filter(x => x !== j))}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "var(--green)",
                          padding: 0, lineHeight: 1, fontSize: 13 }}>×</button>
                    </span>
                  ))}
                </div>
                <input value={jobInput} onChange={e => setJobInput(e.target.value)} onKeyDown={addJob}
                  placeholder="e.g. Backend Developer, SDE-1, Fullstack Engineer…"
                  style={{ width: "100%", boxSizing: "border-box", padding: "10px 14px",
                    border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                    background: "var(--bg-subtle)", color: "var(--text)", fontSize: 13, outline: "none" }}
                  onFocus={e => e.target.style.borderColor = "var(--accent)"}
                  onBlur={e => e.target.style.borderColor = "var(--border)"}
                />
              </div>

              <button onClick={goToStep2} disabled={!name.trim() || !status || saving}
                className="btn btn-primary btn-lg" style={{ width: "100%" }}>
                {saving ? "Saving…" : "Continue →"}
              </button>
            </>
          ) : (
            <>
              <h2 style={{ fontSize: 20, fontWeight: 800, marginBottom: 6 }}>Upload your resume</h2>
              <p style={{ fontSize: 13, color: "var(--text-3)", marginBottom: 28, lineHeight: 1.6 }}>
                We'll extract your skills and use them to generate smart search queries.
                {targetJobs.length > 0 && " We'll combine these with the roles you just listed."}
              </p>

              {!uploadedProfile ? (
                <div
                  style={{ border: "2px dashed var(--border)", borderRadius: "var(--radius-md)",
                    padding: "40px 24px", textAlign: "center", cursor: "pointer",
                    transition: "all 0.2s", background: "var(--bg-subtle)" }}
                  onClick={() => fileRef.current?.click()}
                  onDragOver={e => { e.preventDefault(); e.currentTarget.style.borderColor = "var(--accent)"; }}
                  onDragLeave={e => e.currentTarget.style.borderColor = "var(--border)"}
                  onDrop={e => { e.preventDefault(); e.currentTarget.style.borderColor = "var(--border)"; handleFile(e.dataTransfer.files[0]); }}
                >
                  <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }}
                    onChange={e => handleFile(e.target.files?.[0])} />
                  {uploading ? (
                    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                      <div className="spinner" style={{ width: 28, height: 28, borderWidth: 3 }} />
                      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>Analysing your resume…</p>
                      <p style={{ fontSize: 12, color: "var(--text-3)" }}>Extracting skills, roles & search keywords</p>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontSize: 44, marginBottom: 12 }}>📄</div>
                      <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>Drop your PDF here</p>
                      <p style={{ fontSize: 12, color: "var(--text-3)" }}>or click to browse</p>
                    </>
                  )}
                </div>
              ) : (
                <div style={{ padding: "20px", borderRadius: "var(--radius-md)",
                  background: "var(--green-bg)", border: "1px solid var(--green-border)", marginBottom: 20 }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: "var(--green)", marginBottom: 12 }}>
                    ✅ Resume analysed!
                  </p>
                  {uploadedProfile.roles?.length > 0 && (
                    <div style={{ marginBottom: 10 }}>
                      <p style={{ fontSize: 11, color: "var(--green)", fontWeight: 600, marginBottom: 6 }}>TARGET ROLES</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {uploadedProfile.roles.map(r => (
                          <span key={r} style={{ padding: "3px 10px", borderRadius: 99, fontSize: 11,
                            background: "rgba(16,185,129,0.1)", color: "var(--green)", border: "1px solid var(--green-border)" }}>
                            {r}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {uploadedProfile.skills?.length > 0 && (
                    <div>
                      <p style={{ fontSize: 11, color: "var(--green)", fontWeight: 600, marginBottom: 6 }}>SKILLS DETECTED</p>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                        {uploadedProfile.skills.slice(0, 8).map(s => (
                          <span key={s} style={{ padding: "2px 8px", borderRadius: 99, fontSize: 11,
                            background: "rgba(16,185,129,0.08)", color: "var(--green)", border: "1px solid var(--green-border)" }}>
                            {s}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {uploadError && (
                <p style={{ fontSize: 12, color: "var(--red)", marginTop: 10 }}>{uploadError}</p>
              )}

              <div style={{ display: "flex", gap: 10, marginTop: 24 }}>
                {!uploadedProfile && (
                  <button onClick={finish} className="btn btn-secondary" style={{ flex: 1 }}>
                    Skip for now
                  </button>
                )}
                <button onClick={finish} disabled={!uploadedProfile && false}
                  className="btn btn-primary" style={{ flex: 2 }}>
                  {uploadedProfile ? "Enter GhostApply →" : "Continue without resume →"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── JOB DETAIL PANEL ─────────────────────────────────────────────────────────
function JobDetailPanel({ job, onClose, onStatusChange, onJobUpdate }) {
  const [enriching, setEnriching] = useState(false);
  const [enriched, setEnriched] = useState(!!job.draftMessage);
  const [draftMsg, setDraftMsg] = useState(job.draftMessage || "");
  const [channel, setChannel] = useState("linkedin");
  const [emailInput, setEmailInput] = useState(job.founderEmail || "");
  const [copied, setCopied] = useState(false);
  const [currentJob, setCurrentJob] = useState(job);
  const pollRef = useRef();

  const fitData = currentJob.fitData || {};

  const handleReachOut = async () => {
    setEnriching(true);
    await apiFetch(`/api/outreach/enrich/${currentJob.id}`, { method: "POST" });
    pollRef.current = setInterval(async () => {
      const data = await apiFetch(`/api/outreach/enrich/${currentJob.id}/status`);
      if (data.ready) {
        clearInterval(pollRef.current);
        setCurrentJob(j => ({ ...j, ...data }));
        setDraftMsg(data.draftMessage || "");
        setEnriched(true);
        setEnriching(false);
        if (onJobUpdate) onJobUpdate(currentJob.id, data);
      }
    }, 3000);
  };

  useEffect(() => () => clearInterval(pollRef.current), []);

  const handleSave = async () => {
    await apiFetch(`/api/outreach/draft/${currentJob.id}`, {
      method: "PATCH", body: JSON.stringify({ draftMessage: draftMsg }),
    });
  };

  const handleSend = async () => {
    await handleSave();
    const payload = { jobId: currentJob.id, channel };
    if (channel === "email") {
      const email = emailInput.trim() || currentJob.founderEmail;
      if (!email) return;
      payload.founderEmail = email;
    }
    await apiFetch("/api/outreach/send", { method: "POST", body: JSON.stringify(payload) });
    onStatusChange(currentJob.id, "SENT");
    onClose();
  };

  const copy = () => {
    navigator.clipboard.writeText(draftMsg).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <>
      <div className="panel-overlay" onClick={onClose} />
      <div className="panel">
        <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: "var(--text)", lineHeight: 1.3,
              overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {currentJob.title}
            </p>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4, flexWrap: "wrap" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>{currentJob.company}</span>
              {currentJob.location && <>
                <span style={{ color: "var(--border-strong)" }}>·</span>
                <span style={{ fontSize: 12, color: "var(--text-3)" }}>{currentJob.location}</span>
              </>}
              <StatusBadge status={currentJob.status} />
            </div>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ flexShrink: 0 }}>✕</button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "24px" }}>
          <div style={{ display: "flex", gap: 16, marginBottom: 20, alignItems: "flex-start" }}>
            <ScoreRing score={currentJob.fitScore} size={52} />
            <div style={{ flex: 1 }}>
              {fitData.reason && <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, marginBottom: 10 }}>{fitData.reason}</p>}
              {(fitData.matchedSkills?.length > 0 || fitData.missingSkills?.length > 0) && (
                <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
                  {fitData.matchedSkills?.map(s => <span key={s} className="skill-match">✓ {s}</span>)}
                  {fitData.missingSkills?.map(s => <span key={s} className="skill-miss">✗ {s}</span>)}
                </div>
              )}
            </div>
          </div>

          {fitData.talkingPoint && (
            <div style={{ padding: "10px 14px", borderRadius: "var(--radius-sm)", marginBottom: 16,
              background: "var(--amber-bg)", border: "1px solid var(--amber-border)" }}>
              <p style={{ fontSize: 12, color: "var(--amber)", fontWeight: 600 }}>💡 Talking point</p>
              <p style={{ fontSize: 12.5, color: "var(--text-2)", marginTop: 2, lineHeight: 1.5 }}>{fitData.talkingPoint}</p>
            </div>
          )}

          {fitData.vectorScore !== undefined && (
            <div style={{ display: "flex", gap: 16, fontSize: 11, color: "var(--text-4)",
              marginBottom: 20, padding: "8px 12px", background: "var(--bg-subtle)",
              borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
              <span>Vector <b style={{ color: "var(--text-3)" }}>{fitData.vectorScore}</b></span>
              {fitData.groqScore && <span>LLM <b style={{ color: "var(--text-3)" }}>{fitData.groqScore}</b></span>}
              {fitData.calibration?.rolePenalty > 0 && <span style={{ color: "var(--red)" }}>Penalty −{fitData.calibration.rolePenalty}</span>}
            </div>
          )}

          {currentJob.companyNews && (
            <div style={{ padding: "10px 14px", borderRadius: "var(--radius-sm)", marginBottom: 20,
              borderLeft: "3px solid var(--border-strong)", background: "var(--bg-subtle)" }}>
              <p style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginBottom: 4 }}>📰 NEWS</p>
              <p style={{ fontSize: 12, color: "var(--text-2)", lineHeight: 1.5 }}>{currentJob.companyNews}</p>
            </div>
          )}

          {currentJob.description && (
            <div style={{ marginBottom: 24 }}>
              <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
                color: "var(--text-3)", marginBottom: 10 }}>Job Description</p>
              <div style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.7, whiteSpace: "pre-wrap",
                maxHeight: 220, overflowY: "auto", padding: "12px 14px", background: "var(--bg-subtle)",
                borderRadius: "var(--radius-sm)", border: "1px solid var(--border)" }}>
                {currentJob.description.slice(0, 1500)}
                {currentJob.description.length > 1500 && "…"}
              </div>
            </div>
          )}

          <div style={{ borderTop: "1px solid var(--border)", paddingTop: 24 }}>
            <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase",
              color: "var(--text-3)", marginBottom: 16 }}>Outreach</p>

            {currentJob.founderName && (
              <div style={{ padding: "12px 14px", borderRadius: "var(--radius-sm)", marginBottom: 16,
                background: "var(--blue-bg)", border: "1px solid var(--blue-border)",
                display: "flex", alignItems: "center", gap: 10 }}>
                <span style={{ fontSize: 20 }}>👤</span>
                <div>
                  <p style={{ fontSize: 13, fontWeight: 600, color: "var(--blue)" }}>{currentJob.founderName}</p>
                  <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                    {currentJob.founderLinkedIn && currentJob.founderLinkedIn !== "#" && (
                      <a href={currentJob.founderLinkedIn} target="_blank" rel="noreferrer"
                        className="btn btn-sm" style={{ fontSize: 11, padding: "2px 10px",
                          background: "var(--blue-bg)", color: "var(--blue)", border: "1px solid var(--blue-border)",
                          textDecoration: "none", borderRadius: 99 }}>LinkedIn ↗</a>
                    )}
                    {currentJob.founderEmail && (
                      <span style={{ fontSize: 11, color: "var(--text-3)" }}>{currentJob.founderEmail}</span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {!enriched && !enriching && (
              <div style={{ textAlign: "center", padding: "28px 0" }}>
                <button className="btn btn-primary btn-lg" onClick={handleReachOut}>
                  ✨ Reach Out — Generate Message
                </button>
                <p style={{ fontSize: 12, color: "var(--text-4)", marginTop: 8 }}>
                  Finds founder · drafts personalised message
                </p>
              </div>
            )}

            {enriching && (
              <div style={{ textAlign: "center", padding: "28px 0" }}>
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
                  <div className="spinner" style={{ width: 24, height: 24 }} />
                  <p style={{ fontSize: 13, color: "var(--text-2)", fontWeight: 500 }}>Finding founder · drafting message…</p>
                  <p style={{ fontSize: 12, color: "var(--text-4)" }}>Layer 1: JD → Layer 2: Hunter.io → Layer 3: Website → Layer 4: LinkedIn</p>
                </div>
              </div>
            )}

            {enriched && (
              <div>
                {!currentJob.founderName && (
                  <p style={{ fontSize: 12, color: "var(--text-3)", marginBottom: 12 }}>
                    Founder not found — message addressed generically. Edit below.
                  </p>
                )}
                <textarea className="textarea" value={draftMsg}
                  onChange={e => setDraftMsg(e.target.value)} rows={8} />

                <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                  {["linkedin", "email"].map(ch => (
                    <button key={ch} onClick={() => setChannel(ch)}
                      className={`btn btn-sm ${channel === ch ? "btn-primary" : "btn-secondary"}`}
                      style={{ textTransform: "capitalize" }}>
                      {ch === "linkedin" ? "💼 LinkedIn" : "📧 Email"}
                    </button>
                  ))}
                </div>

                {channel === "email" && (
                  <div style={{ marginTop: 10 }}>
                    <input type="email" placeholder="Recipient email address"
                      value={emailInput} onChange={e => setEmailInput(e.target.value)}
                      style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px",
                        borderRadius: "var(--radius-sm)", fontSize: 13, background: "var(--bg-subtle)",
                        color: "var(--text)", outline: "none",
                        border: emailInput.trim() ? "1px solid var(--green)" : "1px solid var(--red)" }}
                    />
                    {!emailInput.trim() && (
                      <p style={{ fontSize: 11, color: "var(--red)", marginTop: 5 }}>
                        ⚠️ No email found. Enter manually or switch to LinkedIn.
                      </p>
                    )}
                  </div>
                )}

                <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap", alignItems: "center" }}>
                  <button className="btn btn-secondary btn-sm" onClick={copy}>{copied ? "✓ Copied!" : "📋 Copy"}</button>
                  {currentJob.founderLinkedIn && currentJob.founderLinkedIn !== "#" && (
                    <a href={currentJob.founderLinkedIn} target="_blank" rel="noreferrer"
                      className="btn btn-sm" style={{ textDecoration: "none",
                        background: "var(--blue-bg)", color: "var(--blue)", border: "1px solid var(--blue-border)" }}>
                      Open LinkedIn ↗
                    </a>
                  )}
                  <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
                    <button className="btn btn-ghost btn-sm" onClick={handleSave}>Save Draft</button>
                    <button className="btn btn-primary btn-sm" onClick={handleSend}
                      disabled={channel === "email" && !emailInput.trim()}>
                      Send via {channel}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        <div style={{ padding: "16px 24px", borderTop: "1px solid var(--border)", flexShrink: 0,
          display: "flex", gap: 8, alignItems: "center" }}>
          <a href={currentJob.url} target="_blank" rel="noreferrer"
            className="btn btn-secondary btn-sm" style={{ textDecoration: "none" }}>
            View Job Post ↗
          </a>
          {currentJob.status === "MATCHED" && (
            <button className="btn btn-sm" onClick={() => { onStatusChange(currentJob.id, "SELECTED"); onClose(); }}
              style={{ background: "var(--blue-bg)", color: "var(--blue)", border: "1px solid var(--blue-border)" }}>
              ✓ Select
            </button>
          )}
          {currentJob.status === "SENT" && (
            <button className="btn btn-sm" onClick={() => { onStatusChange(currentJob.id, "REPLIED"); onClose(); }}
              style={{ background: "var(--purple-bg)", color: "var(--purple)", border: "1px solid var(--purple-border)" }}>
              🎉 Mark Replied
            </button>
          )}
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-4)" }}>
            {currentJob.source} · {currentJob.salary || "salary not listed"}
          </span>
        </div>
      </div>
    </>
  );
}

// ─── JOB CARD ─────────────────────────────────────────────────────────────────
function JobCard({ job, onClick }) {
  const fitData = job.fitData || {};
  return (
    <div onClick={onClick} className="card" style={{ padding: "16px 18px", cursor: "pointer",
      transition: "box-shadow 0.15s, border-color 0.15s", display: "flex", alignItems: "center", gap: 14 }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = "var(--shadow-md)"; e.currentTarget.style.borderColor = "var(--border-strong)"; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = "var(--shadow-sm)"; e.currentTarget.style.borderColor = "var(--border)"; }}>
      <ScoreRing score={job.fitScore} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.title}</p>
          {job.draftMessage && (
            <span className="badge" style={{ background: "var(--green-bg)", color: "var(--green)",
              border: "1px solid var(--green-border)", flexShrink: 0, fontSize: 10 }}>draft ready</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-3)", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 500, color: "var(--text-2)" }}>{job.company}</span>
          {job.location && <><span>·</span><span>{job.location}</span></>}
          <span>·</span>
          <span style={{ textTransform: "uppercase", fontSize: 10, letterSpacing: "0.05em", fontWeight: 600 }}>{job.source}</span>
        </div>
        {fitData.matchedSkills?.length > 0 && (
          <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
            {fitData.matchedSkills.slice(0, 4).map(s => <span key={s} className="skill-match" style={{ fontSize: 10 }}>{s}</span>)}
            {fitData.missingSkills?.slice(0, 2).map(s => <span key={s} className="skill-miss" style={{ fontSize: 10 }}>{s}</span>)}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
        <StatusBadge status={job.status} />
      </div>
    </div>
  );
}

// ─── CRON PRESETS ─────────────────────────────────────────────────────────────
const CRON_PRESETS = [
  { label: "Every day at 6:00 AM",        cron: "0 6 * * *",     desc: "Runs once daily at 6 AM" },
  { label: "Every day at 9:00 AM",        cron: "0 9 * * *",     desc: "Runs once daily at 9 AM" },
  { label: "Twice a day (9 AM & 6 PM)",   cron: "0 9,18 * * *",  desc: "Runs at 9 AM and 6 PM" },
  { label: "Every 6 hours",               cron: "0 */6 * * *",   desc: "Runs every 6 hours" },
  { label: "Weekdays at 9:00 AM",         cron: "0 9 * * 1-5",   desc: "Mon–Fri at 9 AM" },
  { label: "Every 12 hours",              cron: "0 */12 * * *",  desc: "Runs every 12 hours" },
];

function cronToHumanReadable(expr) {
  const preset = CRON_PRESETS.find(p => p.cron === expr);
  if (preset) return preset.label;
  return `Custom: ${expr}`;
}

// ─── PROFILE & RESUME SECTION ─────────────────────────────────────────────────
function ProfileSection({ resume, onResumeUpdated }) {
  const [isOpen, setIsOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [roleInput, setRoleInput] = useState("");
  const [editRoles, setEditRoles] = useState([]);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const fileRef = useRef();

  useEffect(() => {
    if (resume?.targetRoles) setEditRoles(resume.targetRoles);
  }, [resume?.targetRoles]);

  const handleFile = async (file) => {
    if (!file || !file.name.endsWith(".pdf")) { setUploadError("PDF only"); return; }
    setUploading(true); setUploadError("");
    try {
      const fd = new FormData();
      fd.append("resume", file);
      const data = await apiFetch("/api/jobs/resume/upload", { method: "POST", body: fd });
      if (data.error) throw new Error(data.error);
      if (onResumeUpdated) onResumeUpdated();
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setUploadError(err.message);
    } finally { setUploading(false); }
  };

  const addRole = (e) => {
    if (e.key === "Enter" && roleInput.trim()) {
      e.preventDefault();
      if (!editRoles.includes(roleInput.trim())) setEditRoles(r => [...r, roleInput.trim()]);
      setRoleInput("");
    }
  };

  const saveRoles = async () => {
    setSaving(true);
    try {
      const data = await apiFetch("/api/jobs/resume", {
        method: "PATCH",
        body: JSON.stringify({ targetRoles: editRoles }),
      });
      if (data.error) throw new Error(data.error);
      if (onResumeUpdated) onResumeUpdated();
      setIsEditing(false);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setUploadError(err.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="card" style={{ padding: "18px 22px", marginBottom: 16 }}>
      <button className="collapsible-trigger" onClick={() => setIsOpen(!isOpen)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16 }}>📄</span>
          <div style={{ textAlign: "left" }}>
            <p style={{ fontSize: 13, fontWeight: 700 }}>Profile & Resume</p>
            <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
              {resume?.hasResume
                ? `${resume.targetRoles?.length || 0} roles · ${resume.searchKeywords?.length || 0} search queries`
                : "No resume uploaded yet"}
            </p>
          </div>
          {saved && <span style={{ fontSize: 11, color: "var(--green)", fontWeight: 600 }}>✓ Saved!</span>}
        </div>
        <span className={`collapsible-arrow ${isOpen ? "open" : ""}`}>▼</span>
      </button>

      <div className={`collapsible-body ${isOpen ? "open" : ""}`}>
        <div style={{ paddingTop: 16 }}>
          {/* Resume Upload */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>Resume</p>
              <input ref={fileRef} type="file" accept=".pdf" style={{ display: "none" }}
                onChange={e => handleFile(e.target.files?.[0])} />
              <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}
                disabled={uploading} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                {uploading ? <><div className="spinner" style={{ width: 12, height: 12 }} />Uploading…</> :
                  resume?.hasResume ? "📄 Re-upload" : "📄 Upload Resume"}
              </button>
            </div>
            {uploadError && <p style={{ fontSize: 11, color: "var(--red)", marginTop: 4 }}>{uploadError}</p>}
            {resume?.hasResume && (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 4 }}>
                {resume.targetSkills?.slice(0, 6).map(s => (
                  <span key={s} className="skill-match" style={{ fontSize: 10 }}>{s}</span>
                ))}
              </div>
            )}
          </div>

          {/* Target Roles */}
          {resume?.hasResume && (
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text-2)" }}>Target Roles</p>
                {!isEditing ? (
                  <button className="btn btn-ghost btn-sm" onClick={() => setIsEditing(true)}
                    style={{ fontSize: 11 }}>✏️ Edit</button>
                ) : (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn btn-ghost btn-sm" onClick={() => {
                      setIsEditing(false);
                      setEditRoles(resume.targetRoles || []);
                    }} style={{ fontSize: 11 }}>Cancel</button>
                    <button className="btn btn-primary btn-sm" onClick={saveRoles} disabled={saving}
                      style={{ fontSize: 11 }}>
                      {saving ? "Saving…" : "Save Roles"}
                    </button>
                  </div>
                )}
              </div>

              <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginBottom: isEditing ? 8 : 0 }}>
                {editRoles.map(r => (
                  <span key={r} className="profile-tag">
                    {r}
                    {isEditing && (
                      <button className="remove-btn" onClick={() => setEditRoles(rl => rl.filter(x => x !== r))}>×</button>
                    )}
                  </span>
                ))}
              </div>

              {isEditing && (
                <input value={roleInput} onChange={e => setRoleInput(e.target.value)} onKeyDown={addRole}
                  placeholder="Type a role and press Enter…"
                  style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", marginTop: 6,
                    border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                    background: "var(--bg-subtle)", color: "var(--text)", fontSize: 12, outline: "none" }}
                  onFocus={e => e.target.style.borderColor = "var(--accent)"}
                  onBlur={e => e.target.style.borderColor = "var(--border)"} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SCHEDULER SECTION ────────────────────────────────────────────────────────
function SchedulerSection({ schedules, onScheduleChange }) {
  const [isOpen, setIsOpen] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [formName, setFormName] = useState("Daily Hunt");
  const [selectedCron, setSelectedCron] = useState(CRON_PRESETS[0].cron);
  const [customCron, setCustomCron] = useState("");
  const [useCustom, setUseCustom] = useState(false);
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    const cronExpr = useCustom ? customCron.trim() : selectedCron;
    if (!cronExpr) return;
    setCreating(true);
    try {
      await apiFetch("/api/schedules", {
        method: "POST",
        body: JSON.stringify({ name: formName || "Daily Hunt", cronExpr }),
      });
      setShowForm(false);
      setFormName("Daily Hunt");
      setSelectedCron(CRON_PRESETS[0].cron);
      setCustomCron("");
      setUseCustom(false);
      if (onScheduleChange) onScheduleChange();
    } catch (err) {
      console.error(err);
    } finally { setCreating(false); }
  };

  const handleToggle = async (id, enabled) => {
    await apiFetch(`/api/schedules/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled: !enabled }),
    });
    if (onScheduleChange) onScheduleChange();
  };

  const handleDelete = async (id) => {
    await apiFetch(`/api/schedules/${id}`, { method: "DELETE" });
    if (onScheduleChange) onScheduleChange();
  };

  const activeCount = schedules.filter(s => s.enabled).length;

  return (
    <div className="card" style={{ padding: "18px 22px", marginBottom: 20 }}>
      <button className="collapsible-trigger" onClick={() => setIsOpen(!isOpen)}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 16 }}>⏰</span>
          <div style={{ textAlign: "left" }}>
            <p style={{ fontSize: 13, fontWeight: 700 }}>Scheduler</p>
            <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
              {schedules.length === 0
                ? "No schedules — run hunts manually or set up automation"
                : `${activeCount} active schedule${activeCount !== 1 ? "s" : ""}`}
            </p>
          </div>
          {activeCount > 0 && <div className="schedule-active-dot" />}
        </div>
        <span className={`collapsible-arrow ${isOpen ? "open" : ""}`}>▼</span>
      </button>

      <div className={`collapsible-body ${isOpen ? "open" : ""}`}>
        <div style={{ paddingTop: 16 }}>
          {/* Existing schedules */}
          {schedules.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 14 }}>
              {schedules.map(s => (
                <div key={s.id} className={`schedule-card ${!s.enabled ? "disabled" : ""}`}>
                  <label className="toggle-switch">
                    <input type="checkbox" checked={s.enabled} onChange={() => handleToggle(s.id, s.enabled)} />
                    <div className="toggle-track" />
                    <div className="toggle-knob" />
                  </label>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)" }}>{s.name}</p>
                    <p style={{ fontSize: 11, color: "var(--text-3)", marginTop: 1 }}>
                      {cronToHumanReadable(s.cronExpr)}
                      {s.lastRunAt && (
                        <span style={{ marginLeft: 8, color: "var(--text-4)" }}>
                          · Last run: {new Date(s.lastRunAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" })}
                        </span>
                      )}
                    </p>
                  </div>
                  <button className="btn btn-ghost btn-sm" onClick={() => handleDelete(s.id)}
                    style={{ color: "var(--red)", fontSize: 12, padding: "4px 8px" }}>🗑</button>
                </div>
              ))}
            </div>
          )}

          {/* Add schedule form */}
          {showForm ? (
            <div style={{ padding: "16px", borderRadius: "var(--radius-sm)",
              border: "1px solid var(--border)", background: "var(--bg-subtle)" }}>
              <p style={{ fontSize: 12, fontWeight: 700, color: "var(--text)", marginBottom: 12 }}>
                New Schedule
              </p>

              {/* Name */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", display: "block", marginBottom: 4 }}>
                  Schedule Name
                </label>
                <input value={formName} onChange={e => setFormName(e.target.value)}
                  placeholder="e.g. Morning Hunt"
                  style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px",
                    border: "1px solid var(--border)", borderRadius: "var(--radius-sm)",
                    background: "var(--bg)", color: "var(--text)", fontSize: 13, outline: "none" }}
                  onFocus={e => e.target.style.borderColor = "var(--accent)"}
                  onBlur={e => e.target.style.borderColor = "var(--border)"} />
              </div>

              {/* Frequency presets */}
              <div style={{ marginBottom: 12 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", display: "block", marginBottom: 6 }}>
                  Frequency
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
                  {CRON_PRESETS.map(p => (
                    <button key={p.cron} className={`cron-option ${!useCustom && selectedCron === p.cron ? "selected" : ""}`}
                      onClick={() => { setSelectedCron(p.cron); setUseCustom(false); }}>
                      <div style={{ fontSize: 12, fontWeight: 600 }}>{p.label}</div>
                      <div style={{ fontSize: 10, color: "var(--text-4)", marginTop: 1 }}>{p.desc}</div>
                    </button>
                  ))}
                </div>

                {/* Custom cron */}
                <div style={{ marginTop: 8 }}>
                  <button className={`cron-option ${useCustom ? "selected" : ""}`}
                    onClick={() => setUseCustom(true)} style={{ marginBottom: useCustom ? 6 : 0 }}>
                    ⚙️ Custom cron expression
                  </button>
                  {useCustom && (
                    <input value={customCron} onChange={e => setCustomCron(e.target.value)}
                      placeholder="e.g. 30 8 * * 1-5"
                      style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px",
                        border: "1px solid var(--accent)", borderRadius: "var(--radius-sm)",
                        background: "var(--bg)", color: "var(--text)", fontSize: 12, outline: "none",
                        fontFamily: "monospace" }} />
                  )}
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setShowForm(false)}>Cancel</button>
                <button className="btn btn-primary btn-sm" onClick={handleCreate} disabled={creating}>
                  {creating ? "Creating…" : "✓ Create Schedule"}
                </button>
              </div>
            </div>
          ) : (
            <button className="btn btn-secondary btn-sm" onClick={() => setShowForm(true)}
              style={{ width: "100%" }}>
              + Add Schedule
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── HUNT & MATCH SCREEN ──────────────────────────────────────────────────────
function HuntAndMatchScreen({ jobs, setJobs, stats, lastRun, pipelineRunning, resume, onHunt, onMatch, schedules, onScheduleChange, onResumeUpdated }) {
  const [filter, setFilter] = useState("MATCHED");
  const [selectedJob, setSelectedJob] = useState(null);
  const [pipelineStarting, setPipelineStarting] = useState(false);

  const handleRunPipeline = async () => {
    setPipelineStarting(true);
    await apiFetch("/api/jobs/pipeline/run", { method: "POST" });
    setTimeout(() => setPipelineStarting(false), 3000);
    if (onHunt) onHunt();
  };

  const counts = ["ALL", "MATCHED", "SELECTED", "SENT", "SKIPPED"].reduce((acc, s) => {
    acc[s] = s === "ALL" ? jobs.length : jobs.filter(j => j.status === s).length;
    return acc;
  }, {});

  const filtered = filter === "ALL" ? jobs : jobs.filter(j => j.status === filter);

  const updateStatus = async (id, status) => {
    try { await apiFetch(`/api/jobs/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); } catch {}
    setJobs(p => p.map(j => j.id === id ? { ...j, status } : j));
  };
  const handleJobUpdate = (id, data) => setJobs(p => p.map(j => j.id === id ? { ...j, ...data, fitData: j.fitData } : j));

  return (
    <div className="fade-in">
      {/* Stats bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 24 }}>
        {[
          { label: "Total Jobs", value: stats.total || 0 },
          { label: "Matched",    value: stats.matched || 0, color: "var(--green)"  },
          { label: "Sent",       value: stats.sent || 0,    color: "var(--amber)"  },
          { label: "Replies",    value: stats.replied || 0, color: "var(--purple)" },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ padding: "16px 18px" }}>
            <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.04em",
              color: s.color || "var(--text)", lineHeight: 1 }}>{s.value}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginTop: 4 }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Profile & Resume section */}
      <ProfileSection resume={resume} onResumeUpdated={onResumeUpdated} />

      {/* Scheduler section */}
      <SchedulerSection schedules={schedules} onScheduleChange={onScheduleChange} />

      {/* Pipeline controls — single button */}
      <div className="card" style={{ padding: "22px 24px", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 2 }}>
              🔍 Hunt & Match Pipeline
            </p>
            <p style={{ fontSize: 12, color: "var(--text-3)" }}>
              {resume?.searchKeywords?.length > 0
                ? `Using ${resume.searchKeywords.length} search queries · Hunts jobs → scores fit → shows matches`
                : "Upload a resume to generate personalised search queries"}
            </p>
          </div>
          <button className="btn btn-primary" onClick={handleRunPipeline}
            disabled={pipelineStarting || pipelineRunning}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 24px", fontSize: 14, fontWeight: 700 }}>
            {pipelineStarting || pipelineRunning ? (
              <><div className="spinner" style={{ filter: "invert(1)", width: 16, height: 16 }} />
              {pipelineRunning ? "Finding best fit jobs…" : "Starting…"}</>
            ) : "▶ Run Pipeline"}
          </button>
        </div>

        {(pipelineRunning || lastRun) && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)",
            display: "flex", alignItems: "center", gap: 8 }}>
            {pipelineRunning ? (
              <><div className="dot dot-green dot-pulse" />
              <span style={{ fontSize: 12, color: "var(--green)", fontWeight: 600 }}>Finding best fit jobs…</span></>
            ) : lastRun ? (
              <><div className="dot dot-green" />
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                Last run · {lastRun.duration}min · {lastRun.scraped} scraped · {lastRun.matched} matched
              </span></>
            ) : null}
          </div>
        )}
      </div>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {[
          { key: "MATCHED",  label: "Matched"  },
          { key: "SELECTED", label: "Selected" },
          { key: "SKIPPED",  label: "Skipped"  },
          { key: "ALL",      label: "All"      },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setFilter(key)}
            className={`filter-chip ${filter === key ? "active" : ""}`}>
            {label}
            {counts[key] > 0 && (
              <span style={{ marginLeft: 5, fontSize: 11, color: filter === key ? "var(--accent)" : "var(--text-4)" }}>
                {counts[key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Job list */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: 32, marginBottom: 12 }}>🔍</p>
          <h3>{filter === "MATCHED" ? "No matches yet" : `No ${filter.toLowerCase()} jobs`}</h3>
          <p>{filter === "MATCHED" ? "Run Hunt → Score to find matches." : "Switch to another filter."}</p>
        </div>
      ) : (() => {
        const isToday = (dateString) => {
          if (!dateString) return false;
          return new Date(dateString).toDateString() === new Date().toDateString();
        };
        const todayJobs = filtered.filter(j => isToday(j.createdAt));
        const earlierJobs = filtered.filter(j => !isToday(j.createdAt));

        return (
          <div>
            <p style={{ fontSize: 12, color: "var(--text-4)", marginBottom: 16 }}>
              {filtered.length} job{filtered.length !== 1 ? "s" : ""} · sorted by fit score
            </p>

            {todayJobs.length > 0 && (
              <div style={{ marginBottom: 24 }}>
                <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-3)", marginBottom: 10 }}>
                  Today
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {todayJobs.map(job => (
                    <JobCard key={job.id} job={job} onClick={() => setSelectedJob(job)} />
                  ))}
                </div>
              </div>
            )}

            {earlierJobs.length > 0 && (
              <div>
                <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-3)", marginBottom: 10, marginTop: todayJobs.length > 0 ? 24 : 0 }}>
                  Earlier
                </h4>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {earlierJobs.map(job => (
                    <JobCard key={job.id} job={job} onClick={() => setSelectedJob(job)} />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}

      {selectedJob && (
        <JobDetailPanel
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onStatusChange={(id, status) => { updateStatus(id, status); setSelectedJob(j => j?.id === id ? { ...j, status } : j); }}
          onJobUpdate={handleJobUpdate}
        />
      )}
    </div>
  );
}

// ─── SOURCE BADGE ─────────────────────────────────────────────────────────────
function SourceBadge({ source }) {
  const config = {
    wellfound: { label: "Wellfound", cls: "source-wellfound", icon: "🟠" },
    "linkedin-post": { label: "LI Post", cls: "source-linkedin-post", icon: "🔵" },
    indeed: { label: "Indeed", cls: "source-indeed", icon: "" },
    linkedin: { label: "LinkedIn", cls: "source-linkedin", icon: "" },
  };
  const cfg = config[source] || { label: source, cls: "", icon: "" };
  return <span className={`source-badge ${cfg.cls}`}>{cfg.icon} {cfg.label}</span>;
}

// ─── STARTUP JOB CARD ─────────────────────────────────────────────────────────
function StartupJobCard({ job, onClick }) {
  const fitData = job.fitData || {};
  return (
    <div onClick={onClick} className="card" style={{ padding: "16px 18px", cursor: "pointer",
      transition: "box-shadow 0.15s, border-color 0.15s", display: "flex", alignItems: "center", gap: 14 }}
      onMouseEnter={e => { e.currentTarget.style.boxShadow = "var(--shadow-md)"; e.currentTarget.style.borderColor = "var(--border-strong)"; }}
      onMouseLeave={e => { e.currentTarget.style.boxShadow = "var(--shadow-sm)"; e.currentTarget.style.borderColor = "var(--border)"; }}>
      <ScoreRing score={job.fitScore} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 3 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text)",
            overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{job.title}</p>
          <SourceBadge source={job.source} />
          {job.draftMessage && (
            <span className="badge" style={{ background: "var(--green-bg)", color: "var(--green)",
              border: "1px solid var(--green-border)", flexShrink: 0, fontSize: 10 }}>draft ready</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-3)", flexWrap: "wrap" }}>
          <span style={{ fontWeight: 500, color: "var(--text-2)" }}>{job.company}</span>
          {job.location && <><span>·</span><span>{job.location}</span></>}
        </div>
        {job.source === "linkedin-post" && job.founderName && (
          <div style={{ marginTop: 5 }}>
            <span className="poster-badge">👤 Posted by {job.founderName}</span>
          </div>
        )}
        {fitData.matchedSkills?.length > 0 && (
          <div style={{ display: "flex", gap: 4, marginTop: 6, flexWrap: "wrap" }}>
            {fitData.matchedSkills.slice(0, 4).map(s => <span key={s} className="skill-match" style={{ fontSize: 10 }}>{s}</span>)}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 6, flexShrink: 0 }}>
        <StatusBadge status={job.status} />
      </div>
    </div>
  );
}

// ─── STARTUP HUNT SCREEN ──────────────────────────────────────────────────────
function StartupHuntScreen({ jobs, setJobs, startupHuntStatus, onRun }) {
  const [filter, setFilter] = useState("ALL");
  const [selectedJob, setSelectedJob] = useState(null);
  const [huntStarting, setHuntStarting] = useState(false);

  const startupJobs = jobs.filter(j => j.source === "wellfound" || j.source === "linkedin-post");
  const wellfoundCount = startupJobs.filter(j => j.source === "wellfound").length;
  const liPostCount = startupJobs.filter(j => j.source === "linkedin-post").length;
  const matchedCount = startupJobs.filter(j => j.status === "MATCHED").length;

  const handleRunStartupHunt = async () => {
    setHuntStarting(true);
    await apiFetch("/api/jobs/startup-hunt", { method: "POST" });
    setTimeout(() => setHuntStarting(false), 3000);
    if (onRun) onRun();
  };

  const counts = ["ALL", "MATCHED", "SELECTED", "SKIPPED"].reduce((acc, s) => {
    acc[s] = s === "ALL" ? startupJobs.length : startupJobs.filter(j => j.status === s).length;
    return acc;
  }, {});

  const filtered = filter === "ALL" ? startupJobs : startupJobs.filter(j => j.status === filter);

  const updateStatus = async (id, status) => {
    try { await apiFetch(`/api/jobs/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); } catch {}
    setJobs(p => p.map(j => j.id === id ? { ...j, status } : j));
  };
  const handleJobUpdate = (id, data) => setJobs(p => p.map(j => j.id === id ? { ...j, ...data, fitData: j.fitData } : j));

  const isRunning = startupHuntStatus?.running || huntStarting;
  const lastRun = startupHuntStatus?.lastRun;

  return (
    <div className="fade-in">
      {/* Stats bar */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 24 }}>
        {[
          { label: "Total Startups", value: startupJobs.length },
          { label: "Wellfound",      value: wellfoundCount, color: "#e5533e" },
          { label: "LinkedIn Posts", value: liPostCount,    color: "#2563eb" },
          { label: "Matched",        value: matchedCount,   color: "var(--green)" },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ padding: "16px 18px" }}>
            <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.04em",
              color: s.color || "var(--text)", lineHeight: 1 }}>{s.value}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginTop: 4 }}>{s.label}</span>
          </div>
        ))}
      </div>

      {/* Startup Hunt card */}
      <div className="startup-hunt-card" style={{ padding: "22px 24px", marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <div>
            <p style={{ fontSize: 13, fontWeight: 700, color: "var(--text)", marginBottom: 2, display: "flex", alignItems: "center", gap: 6 }}>
              🚀 Startup Hunt
            </p>
            <p style={{ fontSize: 12, color: "var(--text-3)" }}>
              Scrapes Wellfound for startup listings · Finds founder hiring posts on LinkedIn
            </p>
          </div>
          <button className="btn btn-startup btn-lg" onClick={handleRunStartupHunt}
            disabled={isRunning}
            style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 24px", fontSize: 14, fontWeight: 700 }}>
            {isRunning ? (
              <><div className="spinner" style={{ filter: "invert(1)", width: 16, height: 16 }} />
              Hunting startups…</>
            ) : "🚀 Run Startup Hunt"}
          </button>
        </div>

        {(isRunning || lastRun) && (
          <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--border)",
            display: "flex", alignItems: "center", gap: 8 }}>
            {isRunning ? (
              <><div className="dot dot-green dot-pulse" />
              <span style={{ fontSize: 12, color: "var(--green)", fontWeight: 600 }}>Scraping Wellfound & LinkedIn posts…</span></>
            ) : lastRun ? (
              <><div className="dot dot-green" />
              <span style={{ fontSize: 12, color: "var(--text-3)" }}>
                Last run · {lastRun.duration}min · {lastRun.wellfound || 0} Wellfound · {lastRun.linkedInPosts || 0} LI Posts · {lastRun.saved || 0} saved
              </span></>
            ) : null}
          </div>
        )}
      </div>

      {/* Filter chips */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 16 }}>
        {[
          { key: "ALL",      label: "All" },
          { key: "MATCHED",  label: "Matched" },
          { key: "SELECTED", label: "Selected" },
          { key: "SKIPPED",  label: "Skipped" },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setFilter(key)}
            className={`filter-chip ${filter === key ? "active" : ""}`}>
            {label}
            {counts[key] > 0 && (
              <span style={{ marginLeft: 5, fontSize: 11, color: filter === key ? "var(--accent)" : "var(--text-4)" }}>
                {counts[key]}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Job list */}
      {filtered.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: 32, marginBottom: 12 }}>🚀</p>
          <h3>{startupJobs.length === 0 ? "No startup jobs yet" : `No ${filter.toLowerCase()} startup jobs`}</h3>
          <p>{startupJobs.length === 0 ? "Run Startup Hunt to find jobs from Wellfound and LinkedIn founder posts." : "Switch to another filter."}</p>
        </div>
      ) : (
        <div>
          <p style={{ fontSize: 12, color: "var(--text-4)", marginBottom: 16 }}>
            {filtered.length} startup job{filtered.length !== 1 ? "s" : ""} · sorted by fit score
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {filtered.map(job => (
              <StartupJobCard key={job.id} job={job} onClick={() => setSelectedJob(job)} />
            ))}
          </div>
        </div>
      )}

      {selectedJob && (
        <JobDetailPanel
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onStatusChange={(id, status) => { updateStatus(id, status); setSelectedJob(j => j?.id === id ? { ...j, status } : j); }}
          onJobUpdate={handleJobUpdate}
        />
      )}
    </div>
  );
}

// ─── OUTREACH SCREEN ──────────────────────────────────────────────────────────
function OutreachScreen({ jobs, setJobs }) {
  const inbox = jobs
    .filter(j => ["SELECTED", "SENT", "REPLIED", "GHOSTED"].includes(j.status))
    .sort((a, b) => {
      const o = { REPLIED: 0, SENT: 1, SELECTED: 2, GHOSTED: 3 };
      return (o[a.status] ?? 9) - (o[b.status] ?? 9);
    });

  const [selectedJob, setSelectedJob] = useState(null);

  const updateStatus = async (id, status) => {
    try { await apiFetch(`/api/jobs/${id}`, { method: "PATCH", body: JSON.stringify({ status }) }); } catch {}
    setJobs(p => p.map(j => j.id === id ? { ...j, status } : j));
  };

  const replyCount = jobs.filter(j => j.status === "REPLIED").length;
  const sentCount = jobs.filter(j => j.status === "SENT").length;

  return (
    <div className="fade-in">
      {/* Outreach stats */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 10, marginBottom: 24 }}>
        {[
          { label: "Tracked",  value: inbox.length },
          { label: "Sent",     value: sentCount,   color: "var(--amber)"  },
          { label: "Replied",  value: replyCount,  color: "var(--purple)" },
        ].map(s => (
          <div key={s.label} className="stat-card" style={{ padding: "16px 18px" }}>
            <span style={{ fontSize: 26, fontWeight: 800, letterSpacing: "-0.04em",
              color: s.color || "var(--text)", lineHeight: 1 }}>{s.value}</span>
            <span style={{ fontSize: 11, fontWeight: 600, color: "var(--text-3)", marginTop: 4 }}>{s.label}</span>
          </div>
        ))}
      </div>

      {inbox.length === 0 ? (
        <div className="empty-state">
          <p style={{ fontSize: 32, marginBottom: 12 }}>📭</p>
          <h3>Outreach inbox empty</h3>
          <p>Select matched jobs and click "Reach Out" to start outreach.</p>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {inbox.map(job => (
            <div key={job.id} className="card" onClick={() => setSelectedJob(job)}
              style={{ padding: "16px 18px", cursor: "pointer", display: "flex", alignItems: "center", gap: 14,
                transition: "box-shadow 0.15s" }}
              onMouseEnter={e => e.currentTarget.style.boxShadow = "var(--shadow-md)"}
              onMouseLeave={e => e.currentTarget.style.boxShadow = "var(--shadow-sm)"}>
              <div style={{ width: 40, height: 40, borderRadius: "var(--radius-sm)", flexShrink: 0,
                background: "var(--bg-subtle)", border: "1px solid var(--border)",
                display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>
                {{ SELECTED: "📝", SENT: "✈️", REPLIED: "🎉", GHOSTED: "👻" }[job.status] || "📧"}
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 14, fontWeight: 600, color: "var(--text)" }}>{job.company}</p>
                <p style={{ fontSize: 12, color: "var(--text-3)", marginTop: 2 }}>
                  {job.title}
                  {job.founderName && <span style={{ color: "var(--text-2)" }}> · {job.founderName}</span>}
                </p>
                {job.status === "REPLIED" && (
                  <p style={{ fontSize: 12, color: "var(--purple)", fontWeight: 600, marginTop: 4 }}>
                    ← They replied! Check LinkedIn / Gmail.
                  </p>
                )}
              </div>
              <StatusBadge status={job.status} />
            </div>
          ))}
        </div>
      )}

      {selectedJob && (
        <JobDetailPanel
          job={selectedJob}
          onClose={() => setSelectedJob(null)}
          onStatusChange={(id, status) => { updateStatus(id, status); setSelectedJob(j => j?.id === id ? { ...j, status } : j); }}
          onJobUpdate={(id, data) => setJobs(p => p.map(j => j.id === id ? { ...j, ...data, fitData: j.fitData } : j))}
        />
      )}
    </div>
  );
}

// ─── HEADER ───────────────────────────────────────────────────────────────────
function Header({ screen, setScreen, tabs, user, onLogout }) {
  return (
    <div style={{ position: "sticky", top: 0, zIndex: 50, background: "rgba(255,255,255,0.92)",
      backdropFilter: "blur(12px)", borderBottom: "1px solid var(--border)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "0 32px",
        display: "flex", alignItems: "center", justifyContent: "space-between", height: 56 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 32 }}>
          <Logo />
          <nav style={{ display: "flex", gap: 4 }}>
            {tabs.map(t => (
              <button key={t.id} onClick={() => setScreen(t.id)}
                className={`nav-tab ${screen === t.id ? "active" : ""}`}
                style={{ background: "none", border: "none", display: "flex", alignItems: "center", gap: 6 }}>
                {t.label}
                {t.badge > 0 && (
                  <span className="badge" style={{ background: screen === t.id ? "var(--text)" : "var(--bg-hover)",
                    color: screen === t.id ? "#fff" : "var(--text-3)", fontSize: 10, padding: "1px 6px" }}>
                    {t.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ width: 30, height: 30, borderRadius: "50%",
              background: "linear-gradient(135deg, #6366f1, #4f46e5)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 13, fontWeight: 700, color: "#fff", flexShrink: 0 }}>
              {(user?.name || user?.email || "?")[0].toUpperCase()}
            </div>
            <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>
              {user?.name || user?.email?.split("@")[0]}
            </span>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={onLogout} style={{ fontSize: 12 }}>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function GhostApply() {
  const [authState, setAuthState] = useState("loading"); // loading | auth | onboarding | app
  const [user, setUser] = useState(null);
  const [screen, setScreen] = useState("hunt");
  const [jobs, setJobs] = useState([]);
  const [stats, setStats] = useState({ total: 0, matched: 0, selected: 0, sent: 0, replied: 0, ghosted: 0 });
  const [startupHuntStatus, setStartupHuntStatus] = useState({ running: false, lastRun: null });
  const [pipelineRunning, setPipelineRunning] = useState(false);
  const [lastRun, setLastRun] = useState(null);
  const [resume, setResume] = useState(null);
  const [schedules, setSchedules] = useState([]);

  // Check token on mount
  useEffect(() => {
    const token = getToken();
    if (!token) { setAuthState("auth"); return; }
    apiFetch("/auth/me")
      .then(data => {
        if (data.error) { clearToken(); setAuthState("auth"); return; }
        setUser(data.user);
        setAuthState(data.user.isOnboarded ? "app" : "onboarding");
      })
      .catch(() => { clearToken(); setAuthState("auth"); });
  }, []);

  const fetchAll = useCallback(async () => {
    if (!getToken()) return;
    try {
      const [jr, sr, pr, rr, scr, shr] = await Promise.all([
        apiFetch("/api/jobs?limit=500"),
        apiFetch("/api/jobs/stats"),
        apiFetch("/api/jobs/pipeline/status"),
        apiFetch("/api/jobs/resume"),
        apiFetch("/api/schedules"),
        apiFetch("/api/jobs/startup-hunt/status"),
      ]);
      setJobs((jr.jobs || []).map(j => ({
        ...j,
        fitData: (() => { try { return JSON.parse(j.fitReason || "{}") } catch { return {} } })()
      })));
      setStats(sr);
      setPipelineRunning(pr.running);
      if (pr.lastRun) setLastRun(pr.lastRun);
      if (rr.resume) setResume(rr.resume);
      setSchedules(scr.schedules || []);
      if (shr) setStartupHuntStatus(shr);
    } catch (e) { console.error("API:", e); }
  }, []);

  useEffect(() => {
    if (authState !== "app") return;
    fetchAll();
    const interval = setInterval(fetchAll, 8000);
    return () => clearInterval(interval);
  }, [authState, fetchAll]);

  const handleLogout = () => { clearToken(); setUser(null); setAuthState("auth"); };

  const matchedCount = jobs.filter(j => j.status === "MATCHED" && j.source !== "wellfound" && j.source !== "linkedin-post").length;
  const startupCount = jobs.filter(j => (j.source === "wellfound" || j.source === "linkedin-post")).length;
  const outreachCount = jobs.filter(j => ["SELECTED", "SENT", "REPLIED"].includes(j.status)).length;

  const tabs = [
    { id: "hunt",     label: "🔍 Hunt & Match", badge: matchedCount  },
    { id: "startups", label: "🚀 Startups",     badge: startupCount  },
    { id: "outreach", label: "📬 Outreach",      badge: outreachCount },
  ];

  // ── State gates ──────────────────────────────────────────────────────────────
  if (authState === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
        background: "var(--bg)" }}>
        <div className="spinner" style={{ width: 28, height: 28 }} />
      </div>
    );
  }

  if (authState === "auth") {
    return <AuthScreen onAuth={u => {
      setUser(u);
      setAuthState(u.isOnboarded ? "app" : "onboarding");
    }} />;
  }

  if (authState === "onboarding") {
    return <OnboardingScreen user={user} onComplete={u => { setUser(u); setAuthState("app"); }} />;
  }

  // ── Main App ─────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <Header screen={screen} setScreen={setScreen} tabs={tabs} user={user} onLogout={handleLogout} />

      <div style={{ maxWidth: 1100, margin: "0 auto", padding: "32px 32px" }}>
        {screen === "hunt" && (
          <HuntAndMatchScreen
            jobs={jobs} setJobs={setJobs}
            stats={stats} lastRun={lastRun}
            pipelineRunning={pipelineRunning}
            resume={resume}
            onHunt={fetchAll} onMatch={fetchAll}
            schedules={schedules}
            onScheduleChange={fetchAll}
            onResumeUpdated={fetchAll}
          />
        )}
        {screen === "startups" && (
          <StartupHuntScreen
            jobs={jobs} setJobs={setJobs}
            startupHuntStatus={startupHuntStatus}
            onRun={fetchAll}
          />
        )}
        {screen === "outreach" && (
          <OutreachScreen jobs={jobs} setJobs={setJobs} />
        )}
      </div>
    </div>
  );
}
