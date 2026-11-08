import { useState, useEffect, useRef } from "react";
import { supabase, signInWithGoogle, signOut, getMember, loadCache, loadRemote, saveRemote, subscribeChanges } from "./sync";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const CATS = [
  { id: 'super',         label: 'Súper',            icon: '🛒' },
  { id: 'almacen',       label: 'Almacén',          icon: '🏪' },
  { id: 'comida',        label: 'Delivery / Resto', icon: '🍽️' },
  { id: 'nafta',         label: 'Nafta',            icon: '⛽' },
  { id: 'hogar',         label: 'Hogar',            icon: '🏠' },
  { id: 'alquiler',      label: 'Alquiler',         icon: '🔑' },
  { id: 'expensas',      label: 'Expensas',         icon: '🏢' },
  { id: 'suscripciones', label: 'Suscripciones',  icon: '📱' },
  { id: 'mascotas',      label: 'Mascotas',       icon: '🐾' },
  { id: 'salud',         label: 'Salud',          icon: '💊' },
  { id: 'ropa',          label: 'Ropa',           icon: '👗' },
  { id: 'regalos',       label: 'Regalos',        icon: '🎁' },
  { id: 'entreten',      label: 'Ocio',           icon: '🎬' },
  { id: 'prestamo',      label: 'Préstamo',       icon: '💸' },
  { id: 'peajes',        label: 'Peajes',         icon: '🛣️' },
  { id: 'otros',         label: 'Otros',          icon: '📦' },
];

const CARDS = [
  // accent: color de texto/realce sobre fondo oscuro (AA) · bg: fondo del header de la card
  { id: 'naranja_x',    label: 'Naranja X',    owner: 'toba', accent: '#FF8A50', bg: '#2B1D16' },
  { id: 'galicia',      label: 'Galicia',      owner: 'toba', accent: '#F5B544', bg: '#2A2214' },
  { id: 'cordobesa',    label: 'Cordobesa',    owner: 'gri',  accent: '#4FCB8D', bg: '#14271E' },
  { id: 'mercado_pago', label: 'Mercado Pago', owner: 'gri',  accent: '#4DB8F0', bg: '#122431' },
];

const MES = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

// ─── HELPERS ─────────────────────────────────────────────────────────────────

const fmt        = n => '$' + Math.abs(Math.round(n)).toLocaleString('es-AR');
const fmtPct     = n => (n * 100).toFixed(1) + '%';
const uid        = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const todayStr   = () => new Date().toISOString().slice(0, 10);
const curMonth   = () => new Date().toISOString().slice(0, 7);
const monthLabel = m => { if (!m) return ''; const [y, mo] = m.split('-'); return MES[+mo-1] + ' ' + y; };
const shortDate  = d => d ? d.slice(5).split('-').reverse().join('/') : '';
const advanceMonth = (m, n) => {
  let [y, mo] = m.split('-').map(Number);
  mo += n;
  while (mo > 12) { mo -= 12; y++; }
  while (mo < 1)  { mo += 12; y--; }
  return y + '-' + String(mo).padStart(2, '0');
};
const calcPcts = (t, g) => { const s = t + g; return s ? { t: t/s, g: g/s } : { t: 0.5, g: 0.5 }; };
const parseAmount = str => {
  if (!str) return NaN;
  return parseFloat(String(str).trim().replace(/\./g, '').replace(',', '.'));
};

// ─── STORAGE ─────────────────────────────────────────────────────────────────

// Datos compartidos en Supabase (ver src/sync.js). Cache local para arrancar rápido / sin señal.
const loadData = async () => {
  try { return await loadRemote(); } catch { return loadCache(); }
};
const saveData = d =>
  saveRemote(d).catch(err => { console.error('sync', err); window.dispatchEvent(new CustomEvent('sync-error')); });

// ─── FINANCIAL LOGIC ─────────────────────────────────────────────────────────

const calcBalance = (exps, cfg) => {
  const p = calcPcts(cfg.salaryToba, cfg.salaryGri);
  let gOwesT = 0, tOwesG = 0;
  exps.forEach(e => {
    if (e.split === 'compartido') { e.paidBy === 'toba' ? (gOwesT += e.amount * p.g) : (tOwesG += e.amount * p.t); }
    else if (e.split === 'prestamo') { e.paidBy === 'toba' ? (gOwesT += e.amount) : (tOwesG += e.amount); }
  });
  return { griOwesToba: gOwesT, tobaOwesGri: tOwesG, grossNet: gOwesT - tOwesG };
};

const calcNetBalance = (exps, cfg, settlements = []) => {
  const { griOwesToba, tobaOwesGri, grossNet } = calcBalance(exps, cfg);
  const totalPaid = settlements.reduce((acc, s) => acc + (s.from === 'gri' ? s.amount : -s.amount), 0);
  return { griOwesToba, tobaOwesGri, grossNet, net: grossNet - totalPaid };
};

const buildInstallments = base => {
  const { current, total } = base.installments;
  const groupId = uid();
  const cuotaAmount = Math.round(base.amount / total);
  return Array.from({ length: total - current + 1 }, (_, i) => {
    const month = advanceMonth(base.month, i);
    return { ...base, id: uid(), amount: cuotaAmount, installments: { current: current + i, total }, month, date: month + '-' + base.date.slice(8), installmentGroupId: groupId };
  });
};

// Proyecta gastos fijos en un mes dado (solo los que no existen ya)
const projectRecurring = (recurringExpenses, expenses, month) => {
  const existing = new Set(
    expenses.filter(e => e.month === month && e.recurringId).map(e => e.recurringId)
  );
  return recurringExpenses
    .filter(r => !existing.has(r.id) && r.createdMonth <= month)
    .map(r => ({
      id:          uid(),
      recurringId: r.id,
      description: r.description,
      amount:      r.amount,
      category:    r.category,
      paidBy:      r.paidBy,
      paymentType: r.paymentType,
      card:        r.card,
      split:       r.split,
      installments: null,
      installmentGroupId: null,
      date:  month + '-' + String(r.dayOfMonth).padStart(2, '0'),
      month,
    }));
};

// ─── DESIGN TOKENS ───────────────────────────────────────────────────────────

const C = {
  bg: '#0F0F0F', card: '#1C1C1E', card2: '#2C2C2E', card3: '#3A3A3C',
  primary: '#6E5FF0', primaryText: '#9D93FA', primarySoft: 'rgba(110,95,240,0.16)', toba: '#F28CCB', gri: '#4FD1C5',
  text: '#FFFFFF', textSec: '#EBEBF5', muted: '#8E8E93', mutedLight: '#636366',
  border: '#3A3A3C', borderLight: '#48484A',
  dark: '#636366', success: '#30D158', danger: '#FF453A',
  selected: '#636366', warn: '#FF9F0A',
};
const R = { sm: 14, md: 16, lg: 20, pill: 100 };
const shadow = { sm: '0 1px 3px rgba(0,0,0,0.4)', md: '0 4px 14px rgba(0,0,0,0.5)', lg: '0 8px 28px rgba(0,0,0,0.6)' };

const S = {
  screen:  { background: C.bg, minHeight: '100vh', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", paddingBottom: 'calc(110px + env(safe-area-inset-bottom, 0px))' },
  card:    { background: C.card, borderRadius: R.md, padding: 20, border: `1px solid ${C.border}`, marginBottom: 12, boxShadow: shadow.sm },
  cardLg:  { background: C.card, borderRadius: R.lg, padding: 24, boxShadow: shadow.lg, marginBottom: 14 },
  label:   { fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 8, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' },
  input:   { border: `1px solid ${C.border}`, borderRadius: R.sm, padding: '14px 16px', fontSize: 15, width: '100%', outline: 'none', background: C.card2, color: C.text, fontFamily: 'inherit', boxSizing: 'border-box' },
  h1:      { fontSize: 24, fontWeight: 800, color: C.text, margin: 0, letterSpacing: '-0.02em' },
  h2:      { fontSize: 16, fontWeight: 700, color: C.text, margin: 0 },
  divider: { height: 1, background: C.border },
  badge:   col => ({ background: col+'22', color: col, borderRadius: R.sm, padding: '4px 10px', fontSize: 11, fontWeight: 700, display: 'inline-block' }),
  chip:    (active, col = C.primaryText) => ({ padding: '7px 14px', borderRadius: R.pill, border: `1px solid ${active ? col+'66' : C.border}`, background: active ? col+'22' : 'transparent', color: active ? col : C.muted, cursor: 'pointer', fontSize: 13, fontWeight: active ? 700 : 500, whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'inherit', transition: 'all 0.15s' }),
  btn:     (bg = C.primary, col = '#fff') => ({ background: bg, color: col, border: 'none', borderRadius: R.sm, padding: '15px 20px', fontWeight: 700, fontSize: 15, cursor: 'pointer', width: '100%', fontFamily: 'inherit' }),
};

// ─── SHARED COMPONENTS ───────────────────────────────────────────────────────

function Toggle({ options, value, onChange, colors = {}, tint = false }) {
  return (
    <div role="radiogroup" style={{ display: 'flex', gap: 8 }}>
      {options.map(o => {
        const isOn = value === o.value;
        const col = colors[String(o.value)] || C.selected;
        // tint: fondo translúcido + borde y texto del color (dark theme). Sin tint: relleno sólido.
        const st = tint
          ? { border: `1.5px solid ${isOn ? col : C.border}`, background: isOn ? col + '1F' : C.card2, color: isOn ? col : C.muted }
          : { border: `1.5px solid ${isOn ? col : C.border}`, background: isOn ? col : C.card, color: isOn ? '#fff' : C.muted };
        return (
          <button key={String(o.value)} role="radio" aria-checked={isOn} onClick={() => onChange(o.value)}
            style={{ flex: 1, minHeight: 48, padding: '12px 8px', borderRadius: R.sm, cursor: 'pointer', fontSize: 14, fontWeight: isOn ? 700 : 500, fontFamily: 'inherit', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.15s', ...st }}>
            {o.dot && <span style={{ width: 8, height: 8, borderRadius: '50%', background: isOn ? col : C.mutedLight, flexShrink: 0 }} />}
            {o.icon && <span>{o.icon}</span>}{o.label}
          </button>
        );
      })}
    </div>
  );
}

// Formatea el monto mientras se escribe: 60000 -> 60.000 · admite decimales con coma (máx. 2)
const formatAmountInput = raw => {
  const clean = String(raw).replace(/[^\d,]/g, '');
  const [intRaw, ...rest] = clean.split(',');
  const intPart = intRaw.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  if (!rest.length) return intPart;
  return (intPart || '0') + ',' + rest.join('').slice(0, 2);
};
const amountFromNumber = n => (n || n === 0) && n !== '' ? formatAmountInput(String(n).replace('.', ',')) : '';

function MonthNav({ month, setMonth, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
      <button onClick={() => setMonth(advanceMonth(month,-1))} style={{ border:`1px solid ${C.border}`, background:C.card, borderRadius:R.pill, width:36, height:36, cursor:'pointer', fontSize:16, color:C.text, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:shadow.sm }}>‹</button>
      {children || <span style={{ ...S.h1, fontSize:20 }}>{monthLabel(month)}</span>}
      <button onClick={() => setMonth(advanceMonth(month, 1))} style={{ border:`1px solid ${C.border}`, background:C.card, borderRadius:R.pill, width:36, height:36, cursor:'pointer', fontSize:16, color:C.text, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:shadow.sm }}>›</button>
    </div>
  );
}


// ─── ADD SHEET (elegir tipo de carga → carga rápida expandida) ──────────────
// Tocar + abre este sheet. "Carga rápida" expande el mismo sheet con el formulario;
// "Carga completa" cierra el sheet y abre el formulario en pantalla completa.

const SHEET_EASE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

function SheetOption({ onClick, tone, icon, title, subtitle }) {
  return (
    <button onClick={onClick}
      style={{ display:'flex', alignItems:'center', gap:14, width:'100%', minHeight:84, background:C.card2, border:`1px solid ${C.border}`, borderRadius:18, padding:16, marginBottom:10, cursor:'pointer', fontFamily:'inherit', textAlign:'left', boxSizing:'border-box' }}>
      <div style={{ width:52, height:52, borderRadius:14, background:tone+'22', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>{icon}</div>
      <div style={{ flex:1, minWidth:0 }}>
        <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:3 }}>{title}</div>
        <div style={{ fontSize:13, color:C.muted }}>{subtitle}</div>
      </div>
      <svg width="8" height="14" viewBox="0 0 8 14" fill="none" aria-hidden="true"><path d="M1 1l6 6-6 6" stroke={C.mutedLight} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
    </button>
  );
}

function AddSheet({ onSave, onFull, onClose, lastUsed, me }) {
  const [step,     setStep]     = useState('choice');          // choice | quick
  const [amount,   setAmount]   = useState('');
  const [category, setCategory] = useState(lastUsed?.category || 'super');
  const [paidBy,   setPaidBy]   = useState(me || 'toba');          // por defecto, quien está logueado
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState('');
  const [height,   setHeight]   = useState('auto');
  const innerRef  = useRef(null);
  const amountRef = useRef(null);

  // Anima el alto del sheet cuando cambia el contenido
  useEffect(() => {
    const el = innerRef.current; if (!el) return;
    const measure = () => setHeight(el.offsetHeight);
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const openQuick = () => {
    setStep('quick');
    // Foco dentro del mismo toque para que iOS abra el teclado numérico
    requestAnimationFrame(() => amountRef.current?.focus());
  };

  const handleSave = () => {
    const amt = parseAmount(amount);
    if (isNaN(amt) || amt <= 0) { setError('Ingresá un monto'); amountRef.current?.focus(); return; }
    setError('');
    onSave({
      id: uid(), description: CATS.find(c => c.id === category)?.label || '', amount: amt, category, paidBy,
      paymentType: 'efectivo', card: null, split: 'compartido',
      installments: null, installmentGroupId: null, recurringId: null,
      date: todayStr(), month: curMonth(),
    });
    setSaved(true);
    setTimeout(() => { setSaved(false); setAmount(''); }, 1500);
  };

  const closeBtn = (
    <button onClick={onClose} aria-label="Cerrar"
      style={{ width:36, height:36, borderRadius:'50%', background:C.card2, border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M12 4L4 12M4 4l8 8" stroke="#8E8E93" strokeWidth="2" strokeLinecap="round"/></svg>
    </button>
  );

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:300, display:'flex', alignItems:'flex-end', animation:'fadeIn 0.2s ease' }} onClick={onClose}>
      <style>{`@keyframes fadeIn{from{opacity:0}to{opacity:1}} @keyframes sheetUp{from{transform:translateY(100%)}to{transform:translateY(0)}} @keyframes stepIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}`}</style>
      <div role="dialog" aria-modal="true" aria-label={step === 'quick' ? 'Carga rápida' : 'Agregar gasto'}
        style={{ width:'100%', background:C.card, borderRadius:'24px 24px 0 0', overflow:'hidden', height, maxHeight:'92vh', transition:`height 0.32s ${SHEET_EASE}`, animation:`sheetUp 0.32s ${SHEET_EASE}` }}
        onClick={e=>e.stopPropagation()}>
        <div ref={innerRef} style={{ padding:'14px 20px calc(24px + env(safe-area-inset-bottom, 0px))', boxSizing:'border-box' }}>
          <div style={{ width:36, height:4, background:C.border, borderRadius:99, margin:'0 auto 16px' }} />

          {step === 'choice' && (
            <div key="choice" style={{ animation:'stepIn 0.2s ease' }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
                <div style={{ fontSize:18, fontWeight:800, color:C.text }}>Agregar gasto</div>
                {closeBtn}
              </div>
              <SheetOption onClick={openQuick} tone="#9D93FA" title="Carga rápida" subtitle="Monto, quién pagó y categoría"
                icon={<svg width="24" height="24" viewBox="0 0 26 26" fill="none"><path d="M9 2L4 14h7l-2 10 11-14h-8z" fill="#9D93FA" opacity="0.2"/><path d="M9 2L4 14h7l-2 10 11-14h-8z" stroke="#9D93FA" strokeWidth="1.8" strokeLinejoin="round"/></svg>} />
              <SheetOption onClick={onFull} tone="#4DB8F0" title="Carga completa" subtitle="Tarjeta, cuotas, gasto fijo y más"
                icon={<svg width="22" height="24" viewBox="0 0 24 26" fill="none"><rect x="2" y="1" width="20" height="24" rx="4" fill="#4DB8F0" opacity="0.2"/><rect x="2" y="1" width="20" height="24" rx="4" stroke="#4DB8F0" strokeWidth="1.6"/><path d="M7 8h10M7 13h10M7 18h6" stroke="#4DB8F0" strokeWidth="1.8" strokeLinecap="round"/></svg>} />
            </div>
          )}

          {step === 'quick' && (
            <div key="quick" style={{ animation:'stepIn 0.22s ease' }}>
              <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:20 }}>
                <button onClick={() => { setStep('choice'); setError(''); }} aria-label="Volver"
                  style={{ width:36, height:36, borderRadius:'50%', background:C.card2, border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center', flexShrink:0 }}>
                  <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M7 1L1 7l6 6" stroke="#EBEBF5" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
                <div style={{ flex:1, minWidth:0 }}>
                  <div style={{ fontSize:18, fontWeight:800, color:C.text }}>Carga rápida</div>
                  <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>Efectivo · Compartido · Hoy</div>
                </div>
                {closeBtn}
              </div>

              <div style={{ position:'relative', marginBottom: error ? 8 : 20 }}>
                <div style={{ position:'absolute', left:16, top:'50%', transform:'translateY(-50%)', fontSize:24, fontWeight:800, color:C.muted }}>$</div>
                <input ref={amountRef} aria-label="Monto"
                  style={{ ...S.input, fontSize:32, fontWeight:800, paddingLeft:40, letterSpacing:'-0.02em', border:`2px solid ${error ? C.danger : C.border}`, borderRadius:R.md }}
                  type="text" value={amount} onChange={e=>{ setAmount(formatAmountInput(e.target.value)); setError(''); }}
                  placeholder="0" inputMode="decimal" />
              </div>
              {error && <div role="alert" style={{ color:C.danger, fontSize:13, fontWeight:600, marginBottom:14 }}>{error}</div>}

              <div style={{ marginBottom:16 }}>
                <Toggle options={[{value:'toba',label:'Toba',dot:true},{value:'gri',label:'Gri',dot:true}]} tint
                  value={paidBy} onChange={setPaidBy} colors={{toba:C.toba,gri:C.gri}} />
              </div>

              <div style={{ display:'flex', gap:8, overflowX:'auto', paddingBottom:4, marginBottom:20 }}>
                {CATS.map(c => (
                  <button key={c.id} onClick={()=>setCategory(c.id)}
                    style={{ ...S.chip(category===c.id), padding:'7px 12px', fontSize:12, flexShrink:0 }}>
                    {c.icon} {c.label}
                  </button>
                ))}
              </div>

              <button style={S.btn(saved ? C.success : C.primary)} onClick={handleSave}>
                {saved ? '✓ Guardado' : 'Agregar gasto'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}


// ─── SETTLEMENT SHEET ────────────────────────────────────────────────────────

function SettlementSheet({ currentNet, onSave, onClose }) {
  const suggested = currentNet > 100 ? 'gri' : 'toba';
  const [from,   setFrom]   = useState(suggested);
  const [amount, setAmount] = useState(Math.abs(Math.round(currentNet)) > 0 ? String(Math.abs(Math.round(currentNet))) : '');
  const [date,   setDate]   = useState(todayStr());
  const [note,   setNote]   = useState('');
  const [error,  setError]  = useState('');

  const handleSave = () => {
    const amt = parseAmount(amount);
    if (isNaN(amt) || amt <= 0) { setError('Ingresá un monto válido'); return; }
    onSave({ id:uid(), date, month:date.slice(0,7), amount:amt, from, note:note.trim() });
    onClose();
  };

  const toName   = from==='gri'?'Toba':'Gri';
  const fromName = from==='gri'?'Gri':'Toba';
  const fColor   = from==='gri'?C.gri:C.toba;

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:300, display:'flex', alignItems:'flex-end' }} onClick={onClose}>
      <div style={{ background:'#1C1C1E', borderRadius:'24px 24px 0 0', padding:'28px 20px 36px', width:'100%', boxSizing:'border-box', maxHeight:'90vh', overflowY:'auto' }} onClick={e=>e.stopPropagation()}>
        <div style={{ width:40, height:4, background:C.border, borderRadius:R.pill, margin:'0 auto 24px' }} />
        <div style={{ fontSize:20, fontWeight:800, color:C.text, marginBottom:4 }}>Registrar pago</div>
        <p style={{ fontSize:14, color:C.muted, marginBottom:24, marginTop:6 }}>
          {Math.abs(currentNet) > 100 ? `Balance actual: ${fmt(Math.abs(currentNet))} — debe ${currentNet>0?'Gri':'Toba'}` : 'Actualmente están a mano'}
        </p>
        <div style={{ marginBottom:18 }}>
          <label style={S.label}>¿Quién transfirió?</label>
          <Toggle options={[{value:'toba',label:'Toba',dot:true},{value:'gri',label:'Gri',dot:true}]} tint value={from} onChange={setFrom} colors={{toba:C.toba,gri:C.gri}} />
        </div>
        <div style={{ marginBottom:18 }}>
          <label style={S.label}>Monto ($)</label>
          <input style={{ ...S.input, fontSize:24, fontWeight:800 }} type="text" value={amount} onChange={e=>setAmount(formatAmountInput(e.target.value))} placeholder="0" inputMode="decimal" />
        </div>
        <div style={{ marginBottom:18 }}>
          <label style={S.label}>Fecha</label>
          <input style={S.input} type="date" value={date} onChange={e=>setDate(e.target.value)} />
        </div>
        <div style={{ marginBottom:24 }}>
          <label style={S.label}>Nota (opcional)</label>
          <input style={S.input} type="text" value={note} onChange={e=>setNote(e.target.value)} placeholder="Transferencia bancaria..." />
        </div>
        {parseAmount(amount) > 0 && (
          <div style={{ background:fColor+'0D', border:`1px solid ${fColor}25`, borderRadius:R.sm, padding:'12px 16px', marginBottom:20 }}>
            <div style={{ fontSize:13, fontWeight:700, color:fColor }}>{fromName} → {toName} · {fmt(parseAmount(amount))}</div>
            <div style={{ fontSize:12, color:C.muted, marginTop:3 }}>El balance se reducirá en {fmt(parseAmount(amount))}</div>
          </div>
        )}
        {error && <div style={{ color:C.danger, fontSize:13, fontWeight:600, marginBottom:14 }}>{error}</div>}
        <button style={S.btn(C.primary)} onClick={handleSave}>Registrar pago</button>
        <button style={{ ...S.btn(C.card,C.muted), border:'none', marginTop:10 }} onClick={onClose}>Cancelar</button>
      </div>
    </div>
  );
}

// ─── MONTH PICKER SHEET ─────────────────────────────────────────────────────

function MonthPickerSheet({ month, onChange, onClose }) {
  const [selectedYear, setSelectedYear] = useState(() => parseInt(month.split('-')[0]));
  const curYear = new Date().getFullYear();
  const years = [curYear, curYear-1, curYear-2, curYear-3, curYear-4];
  const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  const curM = parseInt(new Date().toISOString().slice(5,7));

  const isDisabled = (y, mIdx) => y === curYear && (mIdx+1) > curM;

  const handleSelect = (mIdx) => {
    if (isDisabled(selectedYear, mIdx)) return;
    onChange(selectedYear + '-' + String(mIdx+1).padStart(2,'0'));
    onClose();
  };

  const selMo = parseInt(month.split('-')[1]) - 1;
  const selYr = parseInt(month.split('-')[0]);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.6)', zIndex:400, display:'flex', alignItems:'flex-end' }} onClick={onClose}>
      <div style={{ background:'#1C1C1E', borderRadius:'24px 24px 0 0', padding:'14px 16px 48px', width:'100%', boxSizing:'border-box' }} onClick={e=>e.stopPropagation()}>
        <div style={{ width:36, height:4, background:'#3A3A3C', borderRadius:99, margin:'0 auto 20px' }} />
        <div style={{ fontSize:16, fontWeight:700, color:'#FFFFFF', textAlign:'center', marginBottom:20 }}>Seleccionar mes</div>

        {/* Años */}
        <div style={{ display:'flex', gap:8, overflowX:'auto', marginBottom:20, paddingBottom:4 }}>
          {years.map(y => (
            <button key={y} onClick={()=>setSelectedYear(y)}
              style={{ flexShrink:0, padding:'8px 16px', borderRadius:100, border:`1px solid ${y===selectedYear?C.primary:'#3A3A3C'}`, background:y===selectedYear?C.primarySoft:'transparent', color:y===selectedYear?C.primaryText:'#8E8E93', fontSize:14, fontWeight:y===selectedYear?700:500, cursor:'pointer', fontFamily:'inherit' }}>
              {y}
            </button>
          ))}
        </div>

        {/* Grid de meses */}
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3,1fr)', gap:8 }}>
          {months.map((m, i) => {
            const disabled = isDisabled(selectedYear, i);
            const isSelected = i === selMo && selectedYear === selYr;
            return (
              <button key={m} onClick={()=>handleSelect(i)}
                style={{ padding:'14px 8px', borderRadius:14, border:`1px solid ${isSelected?C.primary:disabled?'transparent':'#3A3A3C'}`,
                  background:isSelected?C.primarySoft:'transparent',
                  color:isSelected?C.primaryText:disabled?'#3A3A3C':'#FFFFFF',
                  fontSize:15, fontWeight:isSelected?700:500, cursor:disabled?'default':'pointer',
                  fontFamily:'inherit', transition:'all 0.1s' }}>
                {m}
              </button>
            );
          })}
        </div>

        <div style={{ marginTop:16, fontSize:12, color:'#636366', textAlign:'center' }}>
          Consejo: podés deslizar sobre cualquier lista para cambiar de mes
        </div>
      </div>
    </div>
  );
}

// ─── ACTIVITY SCREEN ─────────────────────────────────────────────────────────

function BarChart({ expenses, month }) {
  const [y, m] = month.split('-').map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const byDay = {};
  expenses.filter(e => e.month === month && e.split !== 'personal').forEach(e => {
    const d = parseInt(e.date.slice(8));
    byDay[d] = (byDay[d] || 0) + e.amount;
  });
  const vals = Array.from({length: daysInMonth}, (_, i) => byDay[i+1] || 0);
  const max = Math.max(...vals, 1);
  const chartH = 64;   // alto del área de barras
  const BASE_GAP = 1;  // las barras quedan 1px por encima de la línea punteada
  const today = new Date().getDate();
  const isCurrentMonth = month === new Date().toISOString().slice(0,7);
  const labels = [1, 8, 15, 22, daysInMonth];

  return (
    <div style={{ padding:'0 0 4px' }} aria-hidden="true">
      {/* Barras */}
      <div style={{ display:'flex', alignItems:'flex-end', gap:2, height:chartH, paddingBottom:BASE_GAP, boxSizing:'content-box' }}>
        {vals.map((v, i) => {
          const h = v === 0 ? 0 : Math.max(4, Math.round((v / max) * chartH));
          const isToday = isCurrentMonth && (i + 1) === today;
          return (
            <div key={i} style={{
              flex:1, minWidth:0, height:h, borderRadius:'3px 3px 1px 1px',
              background: isToday ? C.primaryText : '#8E8E93', transition:'height 0.3s ease',
            }} />
          );
        })}
      </div>
      {/* Línea base punteada */}
      <div style={{ height:0, borderTop:`1px dashed ${C.borderLight}` }} />
      {/* Etiquetas de días */}
      <div style={{ position:'relative', height:18, marginTop:4 }}>
        {labels.map(d => (
          <span key={d} style={{ position:'absolute', top:0, left:`${((d - 0.5) / daysInMonth) * 100}%`, transform:'translateX(-50%)', fontSize:11, lineHeight:'14px', color:C.muted, fontVariantNumeric:'tabular-nums' }}>{d}</span>
        ))}
      </div>
    </div>
  );
}

function ActivityScreen({ expenses, config, month, setMonth, settlements, onAddSettlement, onDeleteSettlement, recurringExpenses }) {
  const [showMonthPicker, setShowMonthPicker] = useState(false);

  const mExps = expenses.filter(e => e.month === month);
  const totalShared = mExps.filter(e => e.split !== 'personal').reduce((s,e) => s+e.amount, 0);

  // Agrupar por fecha
  const byDate = {};
  [...mExps].sort((a,b) => b.date.localeCompare(a.date)).forEach(e => {
    if (!byDate[e.date]) byDate[e.date] = [];
    byDate[e.date].push(e);
  });
  const dates = Object.keys(byDate).sort().reverse();

  const formatDate = (d) => {
    const date = new Date(d + 'T12:00:00');
    const today = new Date();
    const yesterday = new Date(today); yesterday.setDate(today.getDate()-1);
    if (d === today.toISOString().slice(0,10)) return 'Hoy';
    if (d === yesterday.toISOString().slice(0,10)) return 'Ayer';
    const months = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    return `${date.getDate()} ${months[date.getMonth()]}`;
  };

  const EmptySVG = () => (
    <svg width="96" height="96" viewBox="0 0 96 96" fill="none" xmlns="http://www.w3.org/2000/svg">
      <rect x="16" y="28" width="64" height="52" rx="8" fill="#2C2C2E"/>
      <rect x="24" y="20" width="48" height="12" rx="6" fill="#3A3A3C"/>
      <path d="M32 48h32M32 58h22" stroke="#636366" strokeWidth="2.5" strokeLinecap="round"/>
      <circle cx="68" cy="68" r="12" fill="#3A3A3C"/>
      <path d="M64 68h8M68 64v8" stroke="#8E8E93" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  );

  return (
    <div style={{ background: C.bg, minHeight: '100vh', paddingBottom: 100 }}>
      {/* Header sticky */}
      <div style={{ position:'sticky', top:0, zIndex:10, background: C.bg, paddingTop: 'env(safe-area-inset-top, 16px)' }}>
        <div style={{ padding:'16px 20px 0' }}>
          {/* Month selector */}
          <button onClick={()=>setShowMonthPicker(true)}
            style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:6, margin:'0 auto', minHeight:44, background:'transparent', border:'none', cursor:'pointer', padding:'4px 12px', fontFamily:'inherit' }}>
            <span style={{ fontSize:14, fontWeight:600, color:'#8E8E93' }}>
              {month === new Date().toISOString().slice(0,7) ? 'Este mes' : monthLabel(month)}
            </span>
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
              <path d="M2 4l4 4 4-4" stroke="#8E8E93" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>

          {/* Total amount */}
          <div style={{ fontSize: 46, fontWeight: 800, color: C.text, letterSpacing: '-0.03em', lineHeight: 1.1, marginTop: 0, marginBottom: 20, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
            {fmt(totalShared)}
          </div>

          {/* Bar chart */}
          <BarChart expenses={expenses} month={month} />
        </div>
      </div>

      {/* Transaction list */}
      <div style={{ padding:'8px 16px 0' }}>
        {dates.length === 0 ? (
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', paddingTop:60, gap:16 }}>
            <EmptySVG />
            <div style={{ fontSize:16, fontWeight:600, color:'#636366' }}>Sin gastos este mes</div>
            <div style={{ fontSize:14, color:'#48484A', textAlign:'center' }}>Tocá + para registrar tu primer gasto</div>
          </div>
        ) : (
          dates.map(date => {
            const dayTotal = byDate[date].reduce((s,e) => s+e.amount, 0);
            return (
              <div key={date} style={{ marginBottom:16 }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8, padding:'0 4px' }}>
                  <span style={{ fontSize:13, fontWeight:600, color:'#8E8E93' }}>{formatDate(date)}</span>
                  <span style={{ fontSize:13, fontWeight:600, color:'#8E8E93' }}>{fmt(dayTotal)}</span>
                </div>
                <div style={{ background: C.card, borderRadius:16, overflow:'hidden', border:`1px solid ${C.border}` }}>
                  {byDate[date].map((exp, idx) => {
                    const cat = CATS.find(c => c.id === exp.category);
                    return (
                      <div key={exp.id}
                        style={{ display:'flex', alignItems:'center', gap:12, padding:'14px 16px',
                          borderBottom: idx < byDate[date].length-1 ? `1px solid ${C.border}` : 'none' }}>
                        <div style={{ width:38, height:38, borderRadius:10, background:C.card2, flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center', fontSize:18 }}>
                          {cat?.icon || '📦'}
                        </div>
                        <div style={{ flex:1, minWidth:0 }}>
                          <div style={{ fontSize:15, fontWeight:600, color:C.text, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                            {exp.description || cat?.label}
                          </div>
                          <div style={{ fontSize:12, color:C.muted, marginTop:1 }}>
                            {exp.paidBy === 'toba' ? '● Toba' : '● Gri'}
                            {exp.split === 'compartido' ? ' · Compartido' : exp.split === 'personal' ? ' · Personal' : ' · Préstamo'}
                            {exp.installments ? ` · ${exp.installments.current}/${exp.installments.total}` : ''}
                          </div>
                        </div>
                        <div style={{ fontSize:15, fontWeight:700, color:C.text, flexShrink:0 }}>
                          {fmt(exp.amount)}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })
        )}
      </div>

      {showMonthPicker && (
        <MonthPickerSheet month={month} onChange={setMonth} onClose={()=>setShowMonthPicker(false)} />
      )}
    </div>
  );
}

// ─── RESUMEN SCREEN ───────────────────────────────────────────────────────────

function ResumedScreen({ expenses, config, month, setMonth, settlements, onAddSettlement, onDeleteSettlement, recurringExpenses }) {
  const [showSettlement, setShowSettlement] = useState(false);
  const [showMonthPicker, setShowMonthPicker] = useState(false);
  const p = calcPcts(config.salaryToba, config.salaryGri);

  const mExps   = expenses.filter(e => e.month === month);
  const mSetts  = settlements.filter(s => s.month === month);
  const { griOwesToba, tobaOwesGri, net } = calcNetBalance(mExps, config, mSetts);

  const tobaTotal = mExps.filter(e => e.paidBy==='toba').reduce((s,e)=>s+e.amount,0);
  const griTotal  = mExps.filter(e => e.paidBy==='gri' ).reduce((s,e)=>s+e.amount,0);
  const totalMes  = mExps.filter(e => e.split !== 'personal').reduce((s,e)=>s+e.amount,0);

  const byCat = {};
  mExps.filter(e=>e.split==='compartido').forEach(e=>{ byCat[e.category]=(byCat[e.category]||0)+e.amount; });
  const topCats = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,5);

  const debtor   = net > 100?'Gri':net<-100?'Toba':null;
  const dColor   = net>0?C.gri:C.toba;
  const absNet   = Math.abs(net);

  return (
    <div style={{ background:C.bg, minHeight:'100vh', paddingBottom:100 }}>
      <div style={{ padding:'calc(env(safe-area-inset-top, 16px) + 16px) 20px 0' }}>

        {/* Month selector */}
        <button onClick={()=>setShowMonthPicker(true)}
          style={{ display:'flex', alignItems:'center', gap:6, background:'transparent', border:'none', cursor:'pointer', padding:'4px 0 16px', fontFamily:'inherit' }}>
          <span style={{ fontSize:15, fontWeight:600, color:'#8E8E93' }}>
            {month === new Date().toISOString().slice(0,7) ? 'Este mes' : monthLabel(month)}
          </span>
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M2 4l4 4 4-4" stroke="#8E8E93" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>

        {/* Balance neto */}
        {debtor ? (
          <div style={{ background:C.card, borderRadius:20, padding:'20px', marginBottom:12, border:`1px solid ${C.border}` }}>
            <div style={{ fontSize:12, fontWeight:600, color:C.muted, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:12 }}>Balance neto</div>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between' }}>
              <div>
                <div style={{ fontSize:30, fontWeight:800, color:dColor, letterSpacing:'-0.02em' }}>{fmt(absNet)}</div>
                <div style={{ fontSize:14, color:C.muted, marginTop:4 }}>
                  {debtor} le debe a {debtor==='Gri'?'Toba':'Gri'}
                </div>
              </div>
              <div style={{ width:52, height:52, borderRadius:14, background:dColor+'22', display:'flex', alignItems:'center', justifyContent:'center' }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M17 10H7l4-4M7 14h10l-4 4" stroke={dColor} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
            </div>
            {/* Register settlement */}
            <button onClick={()=>setShowSettlement(true)}
              style={{ marginTop:14, width:'100%', padding:'12px', background:dColor+'18', border:`1px solid ${dColor}44`, borderRadius:12, color:dColor, fontSize:14, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>
              Registrar pago
            </button>
          </div>
        ) : (
          <div style={{ background:C.card, borderRadius:20, padding:'20px', marginBottom:12, border:`1px solid ${C.border}` }}>
            <div style={{ fontSize:12, fontWeight:600, color:C.muted, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:8 }}>Balance neto</div>
            <div style={{ fontSize:28, fontWeight:800, color:C.success }}>A mano ✓</div>
            <div style={{ fontSize:14, color:C.muted, marginTop:4 }}>Están parejos este mes</div>
          </div>
        )}

        {/* Pagado por persona */}
        <div style={{ background:C.card, borderRadius:20, padding:'20px', marginBottom:12, border:`1px solid ${C.border}` }}>
          <div style={{ fontSize:12, fontWeight:600, color:C.muted, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:14 }}>Pagaron este mes</div>
          <div style={{ display:'flex', gap:10 }}>
            <div style={{ flex:1, background:C.toba+'18', borderRadius:14, padding:'14px' }}>
              <div style={{ fontSize:11, color:C.toba, fontWeight:700, marginBottom:4 }}>TOBA</div>
              <div style={{ fontSize:20, fontWeight:800, color:C.text }}>{fmt(tobaTotal)}</div>
              <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>{fmtPct(p.t)} del total</div>
            </div>
            <div style={{ flex:1, background:C.gri+'18', borderRadius:14, padding:'14px' }}>
              <div style={{ fontSize:11, color:C.gri, fontWeight:700, marginBottom:4 }}>GRI</div>
              <div style={{ fontSize:20, fontWeight:800, color:C.text }}>{fmt(griTotal)}</div>
              <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>{fmtPct(p.g)} del total</div>
            </div>
          </div>
        </div>

        {/* Top categorías */}
        {topCats.length > 0 && (
          <div style={{ background:C.card, borderRadius:20, padding:'20px', marginBottom:12, border:`1px solid ${C.border}` }}>
            <div style={{ fontSize:12, fontWeight:600, color:C.muted, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:14 }}>Top categorías</div>
            {topCats.map(([catId, amt]) => {
              const cat = CATS.find(c => c.id === catId);
              const pct = totalMes > 0 ? amt / totalMes : 0;
              return (
                <div key={catId} style={{ marginBottom:12 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', marginBottom:5 }}>
                    <span style={{ fontSize:14, color:C.text, fontWeight:600 }}>{cat?.icon} {cat?.label}</span>
                    <span style={{ fontSize:14, color:C.muted, fontWeight:600 }}>{fmt(amt)}</span>
                  </div>
                  <div style={{ height:4, background:C.card2, borderRadius:2 }}>
                    <div style={{ height:'100%', background:C.primary, borderRadius:2, width:`${pct*100}%`, transition:'width 0.4s ease' }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Pagos registrados */}
        {mSetts.length > 0 && (
          <div style={{ background:C.card, borderRadius:20, padding:'20px', marginBottom:12, border:`1px solid ${C.border}` }}>
            <div style={{ fontSize:12, fontWeight:600, color:C.muted, textTransform:'uppercase', letterSpacing:'0.06em', marginBottom:14 }}>Pagos del mes</div>
            {mSetts.map(s => (
              <div key={s.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', paddingBottom:10, marginBottom:10, borderBottom:`1px solid ${C.border}` }}>
                <div>
                  <div style={{ fontSize:14, color:C.text, fontWeight:600 }}>
                    <span style={{ color: s.from==='gri'?C.gri:C.toba }}>{s.from==='gri'?'Gri':'Toba'}</span>
                    {' → '}
                    <span style={{ color: s.from==='gri'?C.toba:C.gri }}>{s.from==='gri'?'Toba':'Gri'}</span>
                  </div>
                  {s.note && <div style={{ fontSize:12, color:C.muted }}>{s.note}</div>}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                  <span style={{ fontSize:15, fontWeight:700, color:C.success }}>{fmt(s.amount)}</span>
                  <button onClick={()=>onDeleteSettlement(s.id)}
                    style={{ background:'none', border:'none', color:C.muted, cursor:'pointer', fontSize:16, padding:'2px 4px' }}>×</button>
                </div>
              </div>
            ))}
          </div>
        )}

      </div>

      {showSettlement && (
        <SettlementSheet currentNet={net} onSave={s=>{onAddSettlement(s);setShowSettlement(false);}} onClose={()=>setShowSettlement(false)} />
      )}
      {showMonthPicker && (
        <MonthPickerSheet month={month} onChange={setMonth} onClose={()=>setShowMonthPicker(false)} />
      )}
    </div>
  );
}

// ─── EXPENSE FORM ─────────────────────────────────────────────────────────────

function ExpenseForm({ onSave, onAddRecurring, initialValues, isEdit = false }) {
  const [quickMode, setQuickMode] = useState(false);
  const [form, setForm] = useState(() => ({
    description:     initialValues?.description             || '',
    amount:          amountFromNumber(initialValues?.amount),
    category:        initialValues?.category                || 'super',
    paidBy:          initialValues?.paidBy                  || 'toba',
    paymentType:     initialValues?.paymentType             || 'efectivo',
    card:            initialValues?.card                    || 'naranja_x',
    split:           initialValues?.split                   || 'compartido',
    hasInstallments: !isEdit && !!initialValues?.installments,
    installCurrent:  String(initialValues?.installments?.current || 1),
    installTotal:    String(initialValues?.installments?.total   || 1),
    isRecurring:     false,
    date:            initialValues?.date                    || todayStr(),
  }));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const set = (k,v) => setForm(f=>({...f,[k]:v}));

  const handleCardSelect = cardId => {
    const card = CARDS.find(c=>c.id===cardId);
    set('card',cardId); if(card) set('paidBy',card.owner);
  };

  const handleSubmit = () => {
    if (!quickMode && !form.description.trim()) { setError('Agregá una descripción'); return; }
    const amount = parseAmount(form.amount);
    if (isNaN(amount) || amount <= 0) { setError('Ingresá un monto válido'); return; }
    setError('');
    const base = {
      id:                 initialValues?.id || uid(),
      description:        form.description.trim() || '',
      amount,
      category:           form.category,
      paidBy:             form.paidBy,
      paymentType:        quickMode ? 'efectivo' : form.paymentType,
      card:               (!quickMode && form.paymentType==='tarjeta') ? form.card : null,
      split:              quickMode ? 'compartido' : form.split,
      installments:       (!quickMode && form.hasInstallments) ? {current:+form.installCurrent, total:+form.installTotal} : null,
      date:               form.date,
      month:              form.date.slice(0,7),
      installmentGroupId: initialValues?.installmentGroupId || null,
      recurringId:        null,
    };

    // Si es gasto fijo, guardar también en recurringExpenses
    if (!isEdit && !quickMode && form.isRecurring && !form.hasInstallments) {
      onAddRecurring({
        id:          uid(),
        description: base.description,
        amount:      base.amount,
        category:    base.category,
        paidBy:      base.paidBy,
        paymentType: base.paymentType,
        card:        base.card,
        split:       base.split,
        dayOfMonth:  +form.date.slice(8),
        createdMonth: base.month,
      });
    }

    onSave(base);
    if (!isEdit) { setSaved(true); setTimeout(()=>setSaved(false),2000); setForm(f=>({...f,description:'',amount:''})); }
  };

  const remaining = form.hasInstallments ? Math.max(0,+form.installTotal-+form.installCurrent+1) : 0;
  const cuotaAmt  = (form.hasInstallments && parseAmount(form.amount)>0) ? parseAmount(form.amount)/+form.installTotal : 0;

  return (
    <div style={{ padding:'24px 16px 16px' }}>
      {/* Header con modo toggle */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:28 }}>
        <h1 style={S.h1}>{isEdit?'Editar gasto':'Nuevo gasto'}</h1>
        {!isEdit && (
          <button onClick={()=>setQuickMode(q=>!q)}
            style={{ display:'flex', alignItems:'center', gap:6, padding:'8px 14px', borderRadius:R.pill, border:`1.5px solid ${quickMode?C.warn:C.border}`, background:quickMode?C.warn+'12':C.card, color:quickMode?C.warn:C.muted, fontFamily:'inherit', fontSize:12, fontWeight:700, cursor:'pointer' }}>
            ⚡ {quickMode?'Modo rápido':'Modo rápido'}
          </button>
        )}
      </div>

      {/* QUICK MODE — campos mínimos */}
      {quickMode ? (
        <>
          <div style={{ background:C.warn+'0D', border:`1px solid ${C.warn}25`, borderRadius:R.sm, padding:'10px 14px', marginBottom:20 }}>
            <div style={{ fontSize:12, color:C.warn, fontWeight:700 }}>⚡ Modo rápido activo</div>
            <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>Efectivo · Compartido · {shortDate(form.date)}</div>
          </div>

          <div style={{ marginBottom:20 }}>
            <label style={S.label}>Monto ($)</label>
            <input style={{ ...S.input, fontSize:28, fontWeight:800, letterSpacing:'-0.01em' }} type="text"
              value={form.amount} onChange={e=>set('amount',formatAmountInput(e.target.value))} placeholder="0" inputMode="decimal" autoFocus />
          </div>

          <div style={{ marginBottom:20 }}>
            <label style={S.label}>¿Quién pagó?</label>
            <Toggle options={[{value:'toba',label:'Toba',dot:true},{value:'gri',label:'Gri',dot:true}]} tint
              value={form.paidBy} onChange={v=>set('paidBy',v)} colors={{toba:C.toba,gri:C.gri}} />
          </div>

          <div style={{ marginBottom:24 }}>
            <label style={S.label}>Categoría</label>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {CATS.map(c=>(
                <button key={c.id} onClick={()=>set('category',c.id)} style={S.chip(form.category===c.id)}>{c.icon} {c.label}</button>
              ))}
            </div>
          </div>
        </>
      ) : (
        /* FULL MODE */
        <>
          <div style={{ marginBottom:20 }}>
            <label style={S.label}>Descripción</label>
            <input style={S.input} value={form.description} onChange={e=>set('description',e.target.value)} placeholder="¿En qué gastaron?" />
          </div>

          <div style={{ display:'flex', gap:10, marginBottom:20 }}>
            <div style={{ flex:1.5 }}>
              <label style={S.label}>Monto ($)</label>
              <input style={{ ...S.input, fontSize:24, fontWeight:800, height:58 }} type="text" value={form.amount} onChange={e=>set('amount',formatAmountInput(e.target.value))} placeholder="0" inputMode="decimal" />
            </div>
            <div style={{ flex:1 }}>
              <label style={S.label}>Fecha</label>
              <input style={{ ...S.input, fontSize:13, height:58 }} type="date" value={form.date} onChange={e=>set('date',e.target.value)} />
            </div>
          </div>

          <div style={{ marginBottom:20 }}>
            <label style={S.label}>Categoría</label>
            <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
              {CATS.map(c=>(
                <button key={c.id} onClick={()=>set('category',c.id)} style={S.chip(form.category===c.id)}>{c.icon} {c.label}</button>
              ))}
            </div>
          </div>

          <div style={{ marginBottom:20 }}>
            <label style={S.label}>¿Quién pagó?</label>
            <Toggle options={[{value:'toba',label:'Toba',dot:true},{value:'gri',label:'Gri',dot:true}]} tint
              value={form.paidBy} onChange={v=>set('paidBy',v)} colors={{toba:C.toba,gri:C.gri}} />
          </div>

          <div style={{ marginBottom:20 }}>
            <label style={S.label}>Forma de pago</label>
            <Toggle options={[{value:'efectivo',label:'Efectivo',icon:'💵'},{value:'tarjeta',label:'Tarjeta',icon:'💳'}]}
              value={form.paymentType} onChange={v=>set('paymentType',v)} />
          </div>

          {form.paymentType==='tarjeta' && (
            <div style={{ marginBottom:20 }}>
              <label style={S.label}>¿Qué tarjeta?</label>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:8 }}>
                {CARDS.map(c=>(
                  <button key={c.id} onClick={()=>handleCardSelect(c.id)}
                    style={{ minWidth:0, padding:'12px 8px', borderRadius:R.sm, border:`2px solid ${form.card===c.id?c.accent:C.border}`, background:form.card===c.id?c.bg:C.card, cursor:'pointer', fontFamily:'inherit' }}>
                    <div style={{ fontSize:13, fontWeight:700, color:form.card===c.id?c.accent:C.text }}>{c.label}</div>
                    <div style={{ fontSize:11, color:C.muted, marginTop:3 }}>{c.owner==='toba'?'Toba':'Gri'}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginBottom:20 }}>
            <label style={S.label}>División</label>
            <Toggle options={[{value:'compartido',label:'🤝 Compartido'},{value:'personal',label:'👤 Personal'},{value:'prestamo',label:'💸 Préstamo'}]}
              value={form.split} onChange={v=>set('split',v)} />
            <div style={{ fontSize:12, color:C.muted, marginTop:8 }}>
              {form.split==='compartido'&&'→ Se divide según el proporcional del mes'}
              {form.split==='personal'&&'→ No afecta el balance compartido'}
              {form.split==='prestamo'&&'→ El 100% lo debe quien lo recibió'}
            </div>
          </div>

          {!isEdit && (
            <div style={{ marginBottom:20 }}>
              <label style={S.label}>¿Tiene cuotas?</label>
              <Toggle options={[{value:false,label:'Sin cuotas'},{value:true,label:'En cuotas'}]}
                value={form.hasInstallments} onChange={v=>set('hasInstallments',v)} />
              {form.hasInstallments && (<>
                <div style={{ display:'flex', gap:10, marginTop:12 }}>
                  <div style={{ flex:1 }}>
                    <label style={{ ...S.label, marginBottom:6 }}>Cuota actual</label>
                    <input style={S.input} type="number" min={1} value={form.installCurrent} onChange={e=>set('installCurrent',e.target.value)} inputMode="numeric" />
                  </div>
                  <div style={{ flex:1 }}>
                    <label style={{ ...S.label, marginBottom:6 }}>Total cuotas</label>
                    <input style={S.input} type="number" min={1} value={form.installTotal} onChange={e=>set('installTotal',e.target.value)} inputMode="numeric" />
                  </div>
                </div>
                {remaining>0&&cuotaAmt>0 && (
                  <div style={{ marginTop:12, padding:'12px 14px', borderRadius:R.sm, background:C.selected+'1A', border:`1px solid ${C.selected}30` }}>
                    <div style={{ fontSize:13, fontWeight:700, color:C.selected }}>{fmt(cuotaAmt)} por cuota</div>
                    <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>Se crean {remaining} cuota{remaining!==1?'s':''} desde {monthLabel(form.date.slice(0,7))}</div>
                  </div>
                )}
              </>)}
            </div>
          )}

          {/* Gasto fijo toggle (solo en modo alta, sin cuotas) */}
          {!isEdit && !form.hasInstallments && (
            <div style={{ marginBottom:24 }}>
              <label style={S.label}>¿Repetir cada mes?</label>
              <Toggle options={[{value:false,label:'No'},{value:true,label:'🔁 Gasto fijo'}]}
                value={form.isRecurring} onChange={v=>set('isRecurring',v)} />
              {form.isRecurring && (
                <div style={{ marginTop:10, padding:'10px 14px', borderRadius:R.sm, background:C.warn+'0D', border:`1px solid ${C.warn}25` }}>
                  <div style={{ fontSize:12, color:C.warn, fontWeight:700 }}>🔁 Se va a proyectar automáticamente cada mes</div>
                  <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>Podés eliminarlo en cualquier momento desde Configuración</div>
                </div>
              )}
            </div>
          )}

          {isEdit && initialValues?.installments && (
            <div style={{ marginBottom:24, padding:'12px 14px', background:C.card2, borderRadius:R.sm, border:`1px solid ${C.border}` }}>
              <div style={{ fontSize:13, color:C.muted }}>Cuota <strong style={{ color:C.text }}>{initialValues.installments.current}/{initialValues.installments.total}</strong> — Las otras cuotas no se modifican</div>
            </div>
          )}
        </>
      )}

      {error && <div style={{ background:'rgba(255,69,58,0.12)', border:`1px solid ${C.danger}30`, color:C.danger, borderRadius:R.sm, padding:'12px 14px', marginBottom:16, fontSize:13, fontWeight:600 }}>{error}</div>}

      <button style={S.btn(isEdit?C.selected:saved?C.success:C.primary)} onClick={handleSubmit}>
        {isEdit?'Guardar cambios':saved?'✓ Gasto guardado':'Agregar gasto'}
      </button>
    </div>
  );
}

// ─── EXPENSE LIST ─────────────────────────────────────────────────────────────

function ExpenseList({ expenses, month, setMonth, config, onEdit, onDelete }) {
  const [filter,       setFilter]       = useState('all');
  const [personFilter, setPersonFilter] = useState('all');
  const [expandedId,   setExpandedId]   = useState(null);
  const [deleteModal,  setDeleteModal]  = useState(null);
  const p = calcPcts(config.salaryToba, config.salaryGri);

  const filtered = expenses
    .filter(e=>e.month===month)
    .filter(e=>filter==='all'||e.split===filter)
    .filter(e=>personFilter==='all'||e.paidBy===personFilter)
    .sort((a,b)=>b.date.localeCompare(a.date));

  const total = filtered.reduce((s,e)=>s+e.amount,0);
  const splitColors = { compartido:C.selected, personal:C.muted, prestamo:C.gri };
  const splitLabels = { compartido:'Compartido', personal:'Personal', prestamo:'Préstamo' };

  const handleDeleteTap = exp => {
    if (exp.installmentGroupId) setDeleteModal({exp});
    else { onDelete([exp.id]); setExpandedId(null); }
  };

  return (
    <div style={{ padding:'24px 16px 16px' }}>
      <MonthNav month={month} setMonth={setMonth} />

      <div style={{ display:'flex', gap:8, marginBottom:10, overflowX:'auto', paddingBottom:2 }}>
        {[['all','Todos'],['compartido','Compartidos'],['personal','Personales'],['prestamo','Préstamos']].map(([val,lbl])=>(
          <button key={val} onClick={()=>setFilter(val)} style={S.chip(filter===val)}>{lbl}</button>
        ))}
      </div>
      <div style={{ display:'flex', gap:8, marginBottom:16 }}>
        <button onClick={()=>setPersonFilter('all')}  style={S.chip(personFilter==='all')}>Todos</button>
        <button onClick={()=>setPersonFilter('toba')} style={S.chip(personFilter==='toba',C.toba)}>● Toba</button>
        <button onClick={()=>setPersonFilter('gri')}  style={S.chip(personFilter==='gri',C.gri)}>● Gri</button>
      </div>

      {filtered.length>0 && (
        <div style={{ fontSize:13, color:C.muted, marginBottom:14 }}>
          {filtered.length} gasto{filtered.length!==1?'s':''} · <strong style={{ color:C.text }}>{fmt(total)}</strong>
        </div>
      )}

      {filtered.length===0 ? (
        <div style={{ textAlign:'center', padding:'56px 20px', color:C.muted }}>
          <img src="data:image/png;base64,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" style={{ width:240, opacity:0.75, display:'block', margin:'0 auto 16px' }} alt="" />
          <div style={{ fontWeight:700, fontSize:17, color:C.text }}>Sin gastos aquí</div>
        </div>
      ) : filtered.map(exp => {
        const cat  = CATS.find(c=>c.id===exp.category)||{icon:'📦'};
        const card = CARDS.find(c=>c.id===exp.card);
        const oCol = exp.paidBy==='toba'?C.toba:C.gri;
        const isExp = expandedId===exp.id;
        let debtStr = '';
        if (exp.split==='compartido') debtStr = `${exp.paidBy==='toba'?'Gri':'Toba'} debe ${fmt(exp.amount*(exp.paidBy==='toba'?p.g:p.t))}`;
        else if (exp.split==='prestamo') debtStr = `${exp.paidBy==='toba'?'Gri':'Toba'} debe ${fmt(exp.amount)} (préstamo)`;

        return (
          <div key={exp.id} style={{ ...S.card, cursor:'pointer', padding:16 }} onClick={()=>setExpandedId(isExp?null:exp.id)}>
            <div style={{ display:'flex', alignItems:'flex-start', gap:14 }}>
              <div style={{ width:44, height:44, borderRadius:R.sm, background:C.card2, border:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, flexShrink:0, position:'relative' }}>
                {cat.icon}
                {exp.recurringId && <div style={{ position:'absolute', top:-5, right:-5, fontSize:10 }}>🔁</div>}
              </div>
              <div style={{ flex:1, minWidth:0 }}>
                <div style={{ display:'flex', justifyContent:'space-between', gap:8 }}>
                  <div style={{ fontSize:15, fontWeight:600, color:C.text }}>{exp.description || <span style={{ color:C.muted, fontStyle:'italic' }}>Sin descripción</span>}</div>
                  <div style={{ fontSize:16, fontWeight:800, color:C.text, flexShrink:0 }}>{fmt(exp.amount)}</div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:6, marginTop:8, flexWrap:'wrap' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:5 }}>
                    <div style={{ width:7, height:7, borderRadius:'50%', background:oCol }} />
                    <span style={{ fontSize:12, color:C.muted, fontWeight:500 }}>{exp.paidBy==='toba'?'Toba':'Gri'}</span>
                  </div>
                  {card&&<span style={{ fontSize:12, color:C.muted }}>· {card.label}</span>}
                  <span style={{ fontSize:12, color:C.muted }}>· {shortDate(exp.date)}</span>
                  {exp.installments&&<span style={{ ...S.badge('#717171'), marginLeft:2 }}>{exp.installments.current}/{exp.installments.total}</span>}
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:8, marginTop:8 }}>
                  <span style={S.badge(splitColors[exp.split]||C.muted)}>{splitLabels[exp.split]||exp.split}</span>
                  {debtStr&&<span style={{ fontSize:12, color:C.muted }}>{debtStr}</span>}
                </div>
              </div>
            </div>
            {isExp && (
              <div style={{ display:'flex', gap:10, marginTop:16, paddingTop:16, borderTop:`1px solid ${C.border}` }} onClick={e=>e.stopPropagation()}>
                <button onClick={()=>{onEdit(exp);setExpandedId(null);}} style={{ flex:1, background:C.card, border:`1.5px solid ${C.selected}`, borderRadius:R.sm, color:C.selected, padding:11, fontSize:14, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>Editar</button>
                <button onClick={()=>handleDeleteTap(exp)} style={{ flex:1, background:C.card, border:`1.5px solid ${C.border}`, borderRadius:R.sm, color:C.danger, padding:11, fontSize:14, fontWeight:700, cursor:'pointer', fontFamily:'inherit' }}>Eliminar</button>
              </div>
            )}
          </div>
        );
      })}

      {deleteModal && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:200, display:'flex', alignItems:'flex-end' }} onClick={()=>setDeleteModal(null)}>
          <div style={{ background:'#1C1C1E', borderRadius:'24px 24px 0 0', padding:'28px 20px 36px', width:'100%', boxSizing:'border-box' }} onClick={e=>e.stopPropagation()}>
            <div style={{ width:40, height:4, background:C.border, borderRadius:R.pill, margin:'0 auto 24px' }} />
            <div style={{ fontSize:19, fontWeight:800, color:C.text, marginBottom:6 }}>Eliminar cuota</div>
            <div style={{ fontSize:14, color:C.muted, marginBottom:24 }}>Cuota {deleteModal.exp.installments?.current}/{deleteModal.exp.installments?.total} · {deleteModal.exp.description}</div>
            <button style={{ ...S.btn(C.card,C.selected), border:`1.5px solid ${C.selected}`, marginBottom:10 }} onClick={()=>{onDelete([deleteModal.exp.id]);setDeleteModal(null);setExpandedId(null);}}>Eliminar solo esta cuota</button>
            <button style={S.btn(C.danger)} onClick={()=>{
              const ids = expenses.filter(e=>e.installmentGroupId===deleteModal.exp.installmentGroupId&&e.month>=deleteModal.exp.month).map(e=>e.id);
              onDelete(ids);setDeleteModal(null);setExpandedId(null);
            }}>Eliminar cuotas restantes ({expenses.filter(e=>e.installmentGroupId===deleteModal.exp.installmentGroupId&&e.month>=deleteModal.exp.month).length})</button>
            <button style={{ ...S.btn(C.card,C.muted), border:'none', marginTop:8 }} onClick={()=>setDeleteModal(null)}>Cancelar</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── CARDS VIEW (con cuotas activas) ─────────────────────────────────────────

function CardsView({ expenses, month, setMonth, config }) {
  const p = calcPcts(config.salaryToba, config.salaryGri);
  const mExps = expenses.filter(e=>e.month===month&&e.paymentType==='tarjeta');

  // Cuotas activas: grupos de cuotas con al menos una cuota futura o del mes actual
  const getActiveInstallments = (cardId) => {
    const groups = {};
    expenses
      .filter(e => e.card===cardId && e.installmentGroupId && e.month>=month)
      .forEach(e => {
        if (!groups[e.installmentGroupId]) groups[e.installmentGroupId] = [];
        groups[e.installmentGroupId].push(e);
      });
    return Object.values(groups).map(group => {
      const sorted = group.sort((a,b)=>a.month.localeCompare(b.month));
      const first  = sorted[0];
      const allInstallments = expenses.filter(e=>e.installmentGroupId===first.installmentGroupId);
      const maxInst = Math.max(...allInstallments.map(e=>e.installments?.total||0));
      const maxCurrent = Math.max(...allInstallments.map(e=>e.installments?.current||0));
      const remaining = sorted.length;
      return { ...first, remaining, totalInstallments: maxInst, currentInstallment: first.installments?.current||0 };
    }).sort((a,b)=>a.description.localeCompare(b.description));
  };

  return (
    <div style={{ padding:'24px 16px 16px' }}>
      <MonthNav month={month} setMonth={setMonth} />

      {CARDS.map(card => {
        const cardExps      = mExps.filter(e=>e.card===card.id).sort((a,b)=>b.date.localeCompare(a.date));
        const total         = cardExps.reduce((s,e)=>s+e.amount,0);
        const totalShared   = cardExps.filter(e=>e.split==='compartido').reduce((s,e)=>s+e.amount,0);
        const otherOwes     = card.owner==='toba'?totalShared*p.g:totalShared*p.t;
        const otherName     = card.owner==='toba'?'Gri':'Toba';
        const activeInstall = getActiveInstallments(card.id);

        return (
          <div key={card.id} style={{ ...S.card, overflow:'hidden', padding:0 }}>
            {/* Header */}
            <div style={{ background:card.bg, padding:'18px 20px', borderBottom:`1px solid ${card.accent}33` }}>
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div>
                  <div style={{ fontSize:16, fontWeight:800, color:card.accent }}>💳 {card.label}</div>
                  <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>Titular: {card.owner==='toba'?'Toba':'Gri'}</div>
                </div>
                <div style={{ textAlign:'right' }}>
                  <div style={{ fontSize:24, fontWeight:800, color:C.text }}>{fmt(total)}</div>
                  <div style={{ fontSize:11, color:C.muted }}>total del mes</div>
                </div>
              </div>
            </div>

            <div style={{ padding:'16px 20px' }}>
              {/* Deuda compartida */}
              {totalShared>0 && (
                <div style={{ background:card.accent+'0D', border:`1px solid ${card.accent}25`, borderRadius:R.sm, padding:'12px 14px', marginBottom:16 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:card.accent, marginBottom:4 }}>Compartidos: {fmt(totalShared)}</div>
                  <div style={{ fontSize:14, color:C.text }}>{otherName} debe <strong style={{ color:card.accent }}>{fmt(otherOwes)}</strong> <span style={{ fontSize:12, color:C.muted }}>({fmtPct(card.owner==='toba'?p.g:p.t)})</span></div>
                </div>
              )}

              {/* Cuotas activas */}
              {activeInstall.length > 0 && (
                <div style={{ marginBottom:16 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:12 }}>
                    ⏱ Cuotas activas ({activeInstall.length})
                  </div>
                  {activeInstall.map((inst, i) => {
                    const paidInstallments = inst.totalInstallments - inst.remaining;
                    const progress = inst.totalInstallments > 0 ? paidInstallments / inst.totalInstallments : 0;
                    const cat = CATS.find(c=>c.id===inst.category)||{icon:'📦'};
                    return (
                      <div key={inst.installmentGroupId} style={{ marginBottom: i<activeInstall.length-1?12:0 }}>
                        {i>0 && <div style={{ ...S.divider, marginBottom:12 }} />}
                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:8 }}>
                          <div style={{ flex:1, minWidth:0 }}>
                            <div style={{ fontSize:13, fontWeight:600, color:C.text, display:'flex', alignItems:'center', gap:6 }}>
                              <span>{cat.icon}</span>
                              <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{inst.description||'Sin descripción'}</span>
                            </div>
                            <div style={{ fontSize:11, color:C.muted, marginTop:3 }}>
                              Cuota {inst.currentInstallment}/{inst.totalInstallments} · {fmt(inst.amount)}/mes · {inst.remaining} cuota{inst.remaining!==1?'s':''} restante{inst.remaining!==1?'s':''}
                            </div>
                          </div>
                          <div style={{ ...S.badge(card.accent), marginLeft:10, flexShrink:0 }}>
                            {inst.currentInstallment}/{inst.totalInstallments}
                          </div>
                        </div>
                        {/* Progress bar */}
                        <div style={{ height:4, background:C.card3, borderRadius:R.pill }}>
                          <div style={{ height:'100%', width:`${progress*100}%`, background:card.accent, borderRadius:R.pill, transition:'width 0.3s' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Gastos del mes */}
              {cardExps.length===0 ? (
                <div style={{ textAlign:'center', padding:'20px 0', color:C.muted, fontSize:14 }}>Sin gastos este mes</div>
              ) : (<>
                <div style={{ fontSize:12, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:12 }}>Gastos del mes</div>
                {cardExps.map((exp,i) => {
                  const cat = CATS.find(c=>c.id===exp.category)||{icon:'📦'};
                  const isShared = exp.split==='compartido';
                  return (
                    <div key={exp.id} style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 0', borderTop:i===0?'none':`1px solid ${C.border}` }}>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontSize:14, color:C.text, fontWeight:isShared?600:400, display:'flex', alignItems:'center', gap:8 }}>
                          <span>{cat.icon}</span>
                          <span style={{ overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{exp.description||<em style={{ color:C.muted }}>Sin descripción</em>}</span>
                        </div>
                        <div style={{ display:'flex', gap:10, marginTop:4 }}>
                          <span style={{ fontSize:12, color:C.muted }}>{shortDate(exp.date)}</span>
                          {exp.installments&&<span style={{ fontSize:12, color:C.muted }}>Cuota {exp.installments.current}/{exp.installments.total}</span>}
                          {!isShared&&<span style={{ fontSize:12, color:C.muted }}>Personal</span>}
                        </div>
                      </div>
                      <div style={{ textAlign:'right', flexShrink:0, marginLeft:14 }}>
                        <div style={{ fontSize:15, fontWeight:700, color:C.text }}>{fmt(exp.amount)}</div>
                        {isShared&&<div style={{ fontSize:11, color:card.accent, marginTop:2 }}>{otherName}: {fmt(exp.amount*(card.owner==='toba'?p.g:p.t))}</div>}
                      </div>
                    </div>
                  );
                })}
              </>)}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── SETTINGS ────────────────────────────────────────────────────────────────

function Settings({ config, onSave, expenses, settlements, recurringExpenses, onDeleteRecurring, onImport, email, me, onSignOut }) {
  const [st, setSt] = useState(String(config.salaryToba||''));
  const [sg, setSg] = useState(String(config.salaryGri||''));
  const [saved, setSaved] = useState(false);
  const fileRef = useRef();

  const handleSave = () => { onSave({salaryToba:parseFloat(st)||0,salaryGri:parseFloat(sg)||0}); setSaved(true); setTimeout(()=>setSaved(false),2000); };
  const handleExport = () => { const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify({expenses,settlements,recurringExpenses,config},null,2)],{type:'application/json'})); a.download=`gastos-${curMonth()}.json`; a.click(); };
  const handleImport = e => { const f=e.target.files[0]; if(!f)return; const r=new FileReader(); r.onload=ev=>{try{onImport(JSON.parse(ev.target.result));}catch{alert('Archivo inválido');}}; r.readAsText(f); e.target.value=''; };

  const t=parseFloat(st)||0, g=parseFloat(sg)||0, p=calcPcts(t,g);

  return (
    <div style={{ padding:'24px 16px 16px' }}>
      <h1 style={{ ...S.h1, marginBottom:28 }}>Configuración</h1>

      {/* Cuenta */}
      <div style={{ ...S.card, marginBottom:14, display:'flex', alignItems:'center', gap:14 }}>
        <div style={{ width:44, height:44, borderRadius:'50%', background:(me==='gri'?C.gri:C.toba)+'26', color:me==='gri'?C.gri:C.toba, display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:17, flexShrink:0 }}>
          {me==='gri'?'G':'T'}
        </div>
        <div style={{ flex:1, minWidth:0 }}>
          <div style={{ fontSize:15, fontWeight:700, color:C.text }}>{me==='gri'?'Gri':'Toba'}</div>
          <div style={{ fontSize:12, color:C.muted, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{email}</div>
        </div>
        <button onClick={onSignOut} style={{ minHeight:40, padding:'0 14px', borderRadius:R.pill, border:`1px solid ${C.border}`, background:'transparent', color:C.text, fontSize:13, fontWeight:600, cursor:'pointer', fontFamily:'inherit', flexShrink:0 }}>
          Cerrar sesión
        </button>
      </div>

      {/* Sueldos */}
      <div style={{ ...S.card, marginBottom:14 }}>
        <div style={{ ...S.h2, marginBottom:18 }}>Sueldos del mes</div>
        <div style={{ marginBottom:14 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}><div style={{ width:8, height:8, borderRadius:'50%', background:C.toba }} /><label style={{ ...S.label, margin:0 }}>Sueldo Toba (en $ARS)</label></div>
          <input style={S.input} type="number" value={st} onChange={e=>setSt(e.target.value)} placeholder="0" inputMode="numeric" />
        </div>
        <div style={{ marginBottom:20 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}><div style={{ width:8, height:8, borderRadius:'50%', background:C.gri }} /><label style={{ ...S.label, margin:0 }}>Sueldo Gri (en $ARS)</label></div>
          <input style={S.input} type="number" value={sg} onChange={e=>setSg(e.target.value)} placeholder="0" inputMode="numeric" />
        </div>
        {(t>0||g>0) && (
          <div style={{ background:C.card2, borderRadius:R.sm, padding:'14px 16px', marginBottom:20 }}>
            <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:12 }}>Proporcional resultante</div>
            <div style={{ display:'flex', gap:20 }}>
              <div><div style={{ fontSize:11, color:C.muted, marginBottom:4 }}>Toba</div><div style={{ fontSize:22, fontWeight:800, color:C.toba }}>{fmtPct(p.t)}</div></div>
              <div><div style={{ fontSize:11, color:C.muted, marginBottom:4 }}>Gri</div><div style={{ fontSize:22, fontWeight:800, color:C.gri }}>{fmtPct(p.g)}</div></div>
            </div>
          </div>
        )}
        <button style={S.btn(saved?C.success:C.primary)} onClick={handleSave}>{saved?'✓ Guardado':'Guardar sueldos'}</button>
      </div>

      {/* Gastos fijos */}
      <div style={{ ...S.card, marginBottom:14 }}>
        <div style={{ ...S.h2, marginBottom:4 }}>🔁 Gastos fijos</div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:16 }}>Se proyectan automáticamente cada mes</div>
        {recurringExpenses.length === 0 ? (
          <div style={{ textAlign:'center', padding:'20px 0', color:C.muted }}>
            <div style={{ fontSize:32, marginBottom:8 }}>🔁</div>
            <div style={{ fontSize:13 }}>No hay gastos fijos configurados</div>
            <div style={{ fontSize:12, marginTop:4 }}>Activá "Repetir cada mes" al cargar un gasto</div>
          </div>
        ) : recurringExpenses.map((r, i) => {
          const cat   = CATS.find(c=>c.id===r.category)||{icon:'📦',label:'Otros'};
          const color = r.paidBy==='toba'?C.toba:C.gri;
          const card  = CARDS.find(c=>c.id===r.card);
          return (
            <div key={r.id}>
              {i>0&&<div style={{ ...S.divider, margin:'12px 0' }} />}
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <div style={{ width:40, height:40, borderRadius:R.sm, background:C.card2, border:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}>{cat.icon}</div>
                  <div>
                    <div style={{ fontSize:14, fontWeight:600, color:C.text }}>{r.description||'Sin descripción'}</div>
                    <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>
                      <span style={{ color }}>{r.paidBy==='toba'?'Toba':'Gri'}</span>
                      {card?` · ${card.label}`:''}
                      {` · Día ${r.dayOfMonth}`}
                    </div>
                  </div>
                </div>
                <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                  <div style={{ fontSize:15, fontWeight:800, color:C.text }}>{fmt(r.amount)}</div>
                  <button onClick={()=>onDeleteRecurring(r.id)} style={{ border:'none', background:'none', cursor:'pointer', color:C.danger, fontSize:18, padding:4, lineHeight:1 }}>×</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Backup */}
      <div style={{ ...S.card, marginBottom:14 }}>
        <div style={{ ...S.h2, marginBottom:8 }}>Backup</div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:16, lineHeight:1.5 }}>Exportá el JSON y guardalo en Google Drive para compartir con Gri.</div>
        <button style={{ ...S.btn(C.card,C.text), border:`1.5px solid ${C.border}`, marginBottom:10 }} onClick={handleExport}>⬇ Exportar datos</button>
        <button style={{ ...S.btn(C.card,C.text), border:`1.5px solid ${C.border}` }} onClick={()=>fileRef.current.click()}>⬆ Importar datos</button>
        <input ref={fileRef} type="file" accept=".json" style={{ display:'none' }} onChange={handleImport} />
      </div>

      <div style={{ ...S.card, background:C.card2, border:'none' }}>
        <div style={{ fontSize:13, color:C.muted }}>
          <strong style={{ color:C.text }}>{expenses.length}</strong> gastos · <strong style={{ color:C.text }}>{recurringExpenses.length}</strong> fijos · <strong style={{ color:C.text }}>{settlements.length}</strong> pagos
        </div>
      </div>
    </div>
  );
}

// ─── BOTTOM NAV ──────────────────────────────────────────────────────────────

const NavActivity = ({a}) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a?C.primaryText:'#8E8E93'} strokeWidth={a?2.2:1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h7"/></svg>;
const NavResumen  = ({a}) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a?C.primaryText:'#8E8E93'} strokeWidth={a?2.2:1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/></svg>;
const NavCards    = ({a}) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a?C.primaryText:'#8E8E93'} strokeWidth={a?2.2:1.8} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>;
const NavConfig   = ({a}) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a?C.primaryText:'#8E8E93'} strokeWidth={a?2.2:1.8} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;

function BottomNav({ view, setView, onFabTap }) {
  const Tab = ({id, label, Icon}) => {
    const active = view === id;
    return (
      <button onClick={()=>setView(id)} aria-current={active?'page':undefined} style={{ flex:1, minWidth:0, minHeight:56, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', gap:4, border:'none', background:'none', cursor:'pointer', padding:'12px 0 8px', fontFamily:'inherit' }}>
        <Icon a={active} />
        <span style={{ fontSize:11, lineHeight:'14px', whiteSpace:'nowrap', fontWeight:active?700:500, color:active?C.primaryText:'#8E8E93', letterSpacing:'0.01em' }}>{label}</span>
      </button>
    );
  };

  const isFormOpen = view === 'add' || view === 'edit';

  return (
    <nav style={{ position:'fixed', bottom:0, left:0, right:0, background:C.card, borderTop:`1px solid ${C.border}`, display:'flex', alignItems:'flex-end', zIndex:100, padding: '0 16px', paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 14px)' }}>
      <Tab id="activity" label="Actividad" Icon={NavActivity} />
      <Tab id="resumen"  label="Resumen"   Icon={NavResumen} />
      <div style={{ flex:1, display:'flex', justifyContent:'center', alignItems:'flex-end', paddingBottom:4 }}>
        <button
          onClick={onFabTap}
          aria-label={isFormOpen ? 'Cerrar' : 'Agregar gasto'}
          style={{ width:54, height:54, borderRadius:R.pill, border:'none', cursor:'pointer',
            background: isFormOpen ? C.selected : C.primary,
            boxShadow: isFormOpen ? shadow.md : '0 4px 20px rgba(110,95,240,0.45)',
            transform:'translateY(-14px)', display:'flex', alignItems:'center', justifyContent:'center',
            padding:0, color:'#fff', fontFamily:'inherit', transition:'all 0.2s',
            userSelect:'none', WebkitUserSelect:'none' }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ display:'block', transition:'transform 0.2s', transform: isFormOpen ? 'rotate(45deg)' : 'none' }}>
            <path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2.4" strokeLinecap="round"/>
          </svg>
        </button>
      </div>
      <Tab id="cards"    label="Tarjetas"  Icon={NavCards} />
      <Tab id="settings" label="Config"    Icon={NavConfig} />
    </nav>
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────

function MainApp({ me, email }) {
  const [view,              setView]             = useState('activity');
  const [expenses,          setExpenses]         = useState([]);
  const [settlements,       setSettlements]      = useState([]);
  const [recurringExpenses, setRecurringExpenses]= useState([]);
  const [projectedMonths,   setProjectedMonths]  = useState([]);
  const [config,            setConfig]           = useState({salaryToba:0,salaryGri:0});
  const [month,             setMonth]            = useState(curMonth());
  const [loading,           setLoading]          = useState(true);
  const [editingExpense,    setEditingExpense]    = useState(null);
  const [showQuickForm,     setShowQuickForm]     = useState(false);
  const [syncError,         setSyncError]         = useState(false);
  const [lastUsed,          setLastUsed]          = useState(null);

  const applyData = data => {
    if (!data) return;
    setExpenses(data.expenses          || []);
    setSettlements(data.settlements    || []);
    setRecurringExpenses(data.recurringExpenses || []);
    setProjectedMonths(data.projectedMonths || []);
    setConfig(data.config              || {salaryToba:0,salaryGri:0});
  };

  useEffect(() => {
    const cached = loadCache();
    if (cached) { applyData(cached); }
    loadData().then(data => { applyData(data); setLoading(false); });
    // Cambios hechos desde el otro teléfono
    const unsub = subscribeChanges(() => loadRemote().then(applyData).catch(() => {}));
    const onErr = () => { setSyncError(true); setTimeout(() => setSyncError(false), 4000); };
    window.addEventListener('sync-error', onErr);
    return () => { unsub(); window.removeEventListener('sync-error', onErr); };
  }, []);

  // Proyectar gastos fijos al navegar a un mes no proyectado
  useEffect(() => {
    if (loading) return;
    if (projectedMonths.includes(month)) return;
    if (recurringExpenses.length === 0) {
      const pm = [...projectedMonths, month];
      setProjectedMonths(pm);
      saveData({ expenses, settlements, recurringExpenses, projectedMonths: pm, config });
      return;
    }
    const newExps = projectRecurring(recurringExpenses, expenses, month);
    const updatedExps = [...expenses, ...newExps];
    const pm = [...projectedMonths, month];
    setExpenses(updatedExps);
    setProjectedMonths(pm);
    saveData({ expenses: updatedExps, settlements, recurringExpenses, projectedMonths: pm, config });
  }, [month, loading, recurringExpenses.length]);

  const persist = (exps, cfg, setts, recur, pm) =>
    saveData({ expenses:exps, settlements:setts, recurringExpenses:recur, projectedMonths:pm, config:cfg });

  const handleAdd = base => {
    const newExps = base.installments ? buildInstallments(base) : [base];
    const updated = [...expenses, ...newExps];
    setExpenses(updated);
    setLastUsed(base);
    persist(updated, config, settlements, recurringExpenses, projectedMonths);
    setView('activity');
  };

  const handleQuickAdd = base => {
    const updated = [...expenses, base];
    setExpenses(updated);
    setLastUsed(base);
    persist(updated, config, settlements, recurringExpenses, projectedMonths);
    setTimeout(() => setShowQuickForm(false), 700);   // deja ver el ✓ Guardado
  };

  const handleEdit = upd => {
    const e = expenses.map(x=>x.id===upd.id?upd:x);
    setExpenses(e); persist(e, config, settlements, recurringExpenses, projectedMonths);
    setEditingExpense(null); setView('activity');
  };

  const handleDelete = ids => {
    const u = expenses.filter(e=>!ids.includes(e.id));
    setExpenses(u); persist(u, config, settlements, recurringExpenses, projectedMonths);
  };

  const handleConfig = cfg => {
    setConfig(cfg); persist(expenses, cfg, settlements, recurringExpenses, projectedMonths);
  };

  const handleAddSettlement = s => {
    const u = [...settlements, s];
    setSettlements(u); persist(expenses, config, u, recurringExpenses, projectedMonths);
  };

  const handleDeleteSettlement = id => {
    const u = settlements.filter(s=>s.id!==id);
    setSettlements(u); persist(expenses, config, u, recurringExpenses, projectedMonths);
  };

  const handleAddRecurring = r => {
    const u = [...recurringExpenses, r];
    setRecurringExpenses(u); persist(expenses, config, settlements, u, projectedMonths);
  };

  const handleDeleteRecurring = id => {
    const u = recurringExpenses.filter(r=>r.id!==id);
    setRecurringExpenses(u); persist(expenses, config, settlements, u, projectedMonths);
  };

  const handleImport = data => {
    const eIds = new Set(expenses.map(e=>e.id));
    const sIds = new Set(settlements.map(s=>s.id));
    const rIds = new Set(recurringExpenses.map(r=>r.id));
    const ne = (data.expenses||[]).filter(e=>!eIds.has(e.id));
    const ns = (data.settlements||[]).filter(s=>!sIds.has(s.id));
    const nr = (data.recurringExpenses||[]).filter(r=>!rIds.has(r.id));
    const me=[...expenses,...ne], ms=[...settlements,...ns], mr=[...recurringExpenses,...nr];
    const cfg=data.config||config;
    setExpenses(me);setSettlements(ms);setRecurringExpenses(mr);setConfig(cfg);
    persist(me,cfg,ms,mr,projectedMonths);
    alert(`✓ ${ne.length} gastos, ${ns.length} pagos y ${nr.length} fijos importados.`);
  };

  if (loading) return (
    <div style={{ display:'flex', justifyContent:'center', alignItems:'center', height:'100vh', background:C.card }}>
      <div style={{ textAlign:'center', fontFamily:'system-ui' }}>
        <div style={{ fontSize:40, marginBottom:14 }}>💸</div>
        <div style={{ color:C.muted, fontWeight:600, fontSize:15 }}>Cargando...</div>
      </div>
    </div>
  );

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap');
        *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}
        body{margin:0;background:#0F0F0F;}
        input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;}
        input[type=date]::-webkit-calendar-picker-indicator{opacity:0.4;}
        input:focus{border-color:#6E5FF0!important;}
        ::-webkit-scrollbar{display:none;}
        button:active{opacity:0.8;}
      `}</style>
      <div style={S.screen}>
        {view==='activity'  && <ActivityScreen expenses={expenses} config={config} month={month} setMonth={setMonth} settlements={settlements} onAddSettlement={handleAddSettlement} onDeleteSettlement={handleDeleteSettlement} recurringExpenses={recurringExpenses} />}
        {view==='resumen'   && <ResumedScreen expenses={expenses} config={config} month={month} setMonth={setMonth} settlements={settlements} onAddSettlement={handleAddSettlement} onDeleteSettlement={handleDeleteSettlement} recurringExpenses={recurringExpenses} />}
        {view==='add'       && <ExpenseForm onSave={handleAdd} onAddRecurring={handleAddRecurring} />}
        {view==='edit' && editingExpense && <ExpenseForm onSave={handleEdit} onAddRecurring={handleAddRecurring} initialValues={editingExpense} isEdit />}
        {view==='cards'     && <CardsView expenses={expenses} month={month} setMonth={setMonth} config={config} />}
        {view==='settings'  && <Settings config={config} onSave={handleConfig} expenses={expenses} settlements={settlements} recurringExpenses={recurringExpenses} onDeleteRecurring={handleDeleteRecurring} onImport={handleImport} email={email} me={me} onSignOut={signOut} />}
      </div>
      {syncError && (
        <div role="alert" style={{ position:'fixed', left:16, right:16, bottom:'calc(96px + env(safe-area-inset-bottom, 0px))', zIndex:500, background:'#3A1D1B', border:`1px solid ${C.danger}55`, color:'#FFB4AE', borderRadius:R.sm, padding:'12px 14px', fontSize:13, fontWeight:600, fontFamily:"'Plus Jakarta Sans', system-ui, sans-serif" }}>
          No se pudo sincronizar. Revisá tu conexión: lo cargado queda guardado en este teléfono.
        </div>
      )}
      <BottomNav view={view} setView={setView}
        onFabTap={()=>{ if(view==='add'||view==='edit'){setView('activity');} else { setShowQuickForm(true); } }}
      />
      {showQuickForm && (
        <AddSheet onSave={e=>handleQuickAdd(e)} onFull={()=>{ setShowQuickForm(false); setView('add'); }} onClose={()=>setShowQuickForm(false)} lastUsed={lastUsed} me={me} />
      )}
    </>
  );
}


// ─── AUTH GATE ───────────────────────────────────────────────────────────────

const GoogleG = () => (
  <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
    <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
  </svg>
);

const authShell = { minHeight:'100vh', background:C.bg, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center', padding:'24px', boxSizing:'border-box', fontFamily:"'Plus Jakarta Sans', system-ui, sans-serif", textAlign:'center' };
const FONT_CSS = `@import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap'); body{margin:0;background:#0F0F0F;} *{box-sizing:border-box;-webkit-tap-highlight-color:transparent;}`;

function LoginScreen({ error }) {
  const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); const { error: e } = await signInWithGoogle(); if (e) setBusy(false); };
  return (
    <div style={authShell}>
      <style>{FONT_CSS}</style>
      <div style={{ width:72, height:72, borderRadius:22, background:C.primarySoft, display:'flex', alignItems:'center', justifyContent:'center', marginBottom:24 }}>
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="3" stroke={C.primaryText} strokeWidth="1.8"/><path d="M2.5 10h19M7 15h4" stroke={C.primaryText} strokeWidth="1.8" strokeLinecap="round"/></svg>
      </div>
      <h1 style={{ fontSize:26, fontWeight:800, color:C.text, margin:'0 0 8px', letterSpacing:'-0.02em' }}>Gastos Toba & Gri</h1>
      <p style={{ fontSize:15, color:C.muted, margin:'0 0 36px', lineHeight:1.5, maxWidth:300 }}>Los gastos de la casa, divididos según lo que gana cada uno.</p>
      <button onClick={go} disabled={busy}
        style={{ width:'100%', maxWidth:340, minHeight:54, display:'flex', alignItems:'center', justifyContent:'center', gap:12, background:'#fff', color:'#1F1F1F', border:'none', borderRadius:R.sm, fontSize:16, fontWeight:700, cursor:busy?'default':'pointer', fontFamily:'inherit', opacity:busy?0.7:1 }}>
        <GoogleG /> {busy ? 'Abriendo Google…' : 'Continuar con Google'}
      </button>
      {error && <div role="alert" style={{ marginTop:16, color:'#FFB4AE', fontSize:13, fontWeight:600, maxWidth:340 }}>{error}</div>}
      <p style={{ fontSize:12, color:C.mutedLight, marginTop:24 }}>Solo para cuentas habilitadas.</p>
    </div>
  );
}

function AccessDenied({ email }) {
  return (
    <div style={authShell}>
      <style>{FONT_CSS}</style>
      <div style={{ fontSize:20, fontWeight:800, color:C.text, marginBottom:8 }}>Esta cuenta no tiene acceso</div>
      <p style={{ fontSize:14, color:C.muted, margin:'0 0 28px', lineHeight:1.5, maxWidth:320 }}>
        Entraste como <strong style={{ color:C.text }}>{email}</strong>. La app es solo para Toba y Gri.
      </p>
      <button onClick={signOut} style={{ ...S.btn(C.primary), maxWidth:340 }}>Usar otra cuenta</button>
    </div>
  );
}

function Splash() {
  return (
    <div style={authShell}>
      <style>{FONT_CSS}</style>
      <div style={{ width:28, height:28, borderRadius:'50%', border:`3px solid ${C.card3}`, borderTopColor:C.primaryText, animation:'spin 0.8s linear infinite' }} />
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  );
}

export default function App() {
  const [session, setSession] = useState(undefined);   // undefined = todavía no sabemos
  const [member,  setMember]  = useState(undefined);   // 'toba' | 'gri' | null
  const [error,   setError]   = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setMember(session === null ? null : undefined); return; }
    setMember(undefined);
    getMember().then(setMember).catch(() => { setError('No pudimos verificar tu cuenta. Probá de nuevo.'); setMember(null); });
  }, [session?.user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (session === undefined || (session && member === undefined)) return <Splash />;
  if (!session) return <LoginScreen error={error} />;
  if (!member)  return <AccessDenied email={session.user.email} />;
  return <MainApp me={member} email={session.user.email} />;
}
