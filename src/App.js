import { useState, useEffect, useRef } from "react";

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
  { id: 'naranja_x', label: 'Naranja X', owner: 'toba', accent: '#A5278E', bg: '#FFE9F3' },
  { id: 'galicia',   label: 'Galicia',   owner: 'toba', accent: '#7B2060', bg: '#FFE9F3' },
  { id: 'cordobesa', label: 'Cordobesa', owner: 'gri',  accent: '#7B5BD8', bg: '#EFEAFA' },
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

const KEY = 'gastos-toba-gri-v3';
const loadData = async () => { try { const r = await window.storage.get(KEY); return r ? JSON.parse(r.value) : null; } catch { return null; } };
const saveData = async d  => { try { await window.storage.set(KEY, JSON.stringify(d)); } catch {} };

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
  bg: '#F7F7F7', card: '#FFFFFF',
  primary: '#E23756', toba: '#A5278E', gri: '#7B5BD8',
  text: '#222222', muted: '#717171', border: '#DDDDDD',
  dark: '#60698E', success: '#008A05', danger: '#C13515',
  selected: '#60698E',
  warn: '#D97706',
};
const R = { sm: 16, md: 16, lg: 16, pill: 100 };
const shadow = { sm: '0 1px 2px rgba(0,0,0,0.08)', md: '0 2px 8px rgba(0,0,0,0.10)', lg: '0 6px 20px rgba(0,0,0,0.12)' };

const S = {
  screen:  { background: C.bg, minHeight: '100vh', fontFamily: "'Plus Jakarta Sans', system-ui, sans-serif", paddingBottom: 96 },
  card:    { background: C.card, borderRadius: R.md, padding: 20, border: `1px solid ${C.border}`, marginBottom: 14, boxShadow: shadow.sm },
  cardLg:  { background: C.card, borderRadius: R.lg, padding: 24, boxShadow: shadow.lg, marginBottom: 14 },
  label:   { fontSize: 11, fontWeight: 700, color: C.muted, marginBottom: 8, display: 'block', textTransform: 'uppercase', letterSpacing: '0.05em' },
  input:   { border: `1px solid ${C.border}`, borderRadius: R.sm, padding: '14px 16px', fontSize: 15, width: '100%', outline: 'none', background: '#fff', color: C.text, fontFamily: 'inherit', boxSizing: 'border-box' },
  h1:      { fontSize: 24, fontWeight: 800, color: C.text, margin: 0, letterSpacing: '-0.02em' },
  h2:      { fontSize: 16, fontWeight: 700, color: C.text, margin: 0 },
  divider: { height: 1, background: C.border },
  badge:   col => ({ background: col+'14', color: col, borderRadius: R.sm, padding: '4px 10px', fontSize: 11, fontWeight: 700, display: 'inline-block' }),
  chip:    (active, col = C.selected) => ({ padding: '8px 16px', borderRadius: R.pill, border: `1.5px solid ${active ? col : C.border}`, background: active ? col : C.card, color: active ? '#fff' : C.muted, cursor: 'pointer', fontSize: 13, fontWeight: active ? 700 : 500, whiteSpace: 'nowrap', flexShrink: 0, fontFamily: 'inherit', transition: 'all 0.15s' }),
  btn:     (bg = C.primary, col = '#fff') => ({ background: bg, color: col, border: bg === C.card ? `1.5px solid ${C.border}` : 'none', borderRadius: R.sm, padding: '15px 20px', fontWeight: 700, fontSize: 15, cursor: 'pointer', width: '100%', fontFamily: 'inherit' }),
};

// ─── SHARED COMPONENTS ───────────────────────────────────────────────────────

function Toggle({ options, value, onChange, colors = {} }) {
  return (
    <div style={{ display: 'flex', gap: 8 }}>
      {options.map(o => {
        const isOn = value === o.value;
        const activeBg = colors[String(o.value)] || C.selected;
        return (
          <button key={String(o.value)} onClick={() => onChange(o.value)}
            style={{ flex: 1, padding: '12px 8px', border: `1.5px solid ${isOn ? activeBg : C.border}`, borderRadius: R.sm, cursor: 'pointer', fontSize: 13, fontWeight: isOn ? 700 : 500, fontFamily: 'inherit', background: isOn ? activeBg : C.card, color: isOn ? '#fff' : C.muted, transition: 'all 0.15s' }}>
            {o.icon && <span style={{ marginRight: 4 }}>{o.icon}</span>}{o.label}
          </button>
        );
      })}
    </div>
  );
}

function MonthNav({ month, setMonth, children }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
      <button onClick={() => setMonth(advanceMonth(month,-1))} style={{ border:`1px solid ${C.border}`, background:C.card, borderRadius:R.pill, width:36, height:36, cursor:'pointer', fontSize:16, color:C.text, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:shadow.sm }}>‹</button>
      {children || <span style={{ ...S.h1, fontSize:20 }}>{monthLabel(month)}</span>}
      <button onClick={() => setMonth(advanceMonth(month, 1))} style={{ border:`1px solid ${C.border}`, background:C.card, borderRadius:R.pill, width:36, height:36, cursor:'pointer', fontSize:16, color:C.text, display:'flex', alignItems:'center', justifyContent:'center', boxShadow:shadow.sm }}>›</button>
    </div>
  );
}

// ─── QUICK ADD SHEET ─────────────────────────────────────────────────────────

// ─── CHOICE SHEET ────────────────────────────────────────────────────────────

function ChoiceSheet({ onQuick, onFull, onClose }) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.45)', zIndex:300, display:'flex', alignItems:'flex-end' }} onClick={onClose}>
      <div style={{ background:'#F5F5F5', borderRadius:'24px 24px 0 0', padding:'14px 20px 40px', width:'100%', boxSizing:'border-box', position:'relative' }} onClick={e=>e.stopPropagation()}>

        {/* Handle */}
        <div style={{ width:40, height:4, background:'#D1D1D1', borderRadius:99, margin:'0 auto 12px' }} />

        {/* X button */}
        <button onClick={onClose}
          style={{ position:'absolute', right:20, top:14, width:38, height:38, borderRadius:'50%', background:'#E8E8E8', border:'none', cursor:'pointer', display:'flex', alignItems:'center', justifyContent:'center' }}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path d="M12 4L4 12M4 4l8 8" stroke="#666" strokeWidth="2" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Spacer para que la X no tape la card */}
        <div style={{ height:42 }} />

        {/* Opción Carga rápida */}
        <button onClick={onQuick}
          style={{ display:'flex', alignItems:'center', gap:16, width:'100%', background:'#fff', border:'none', borderRadius:16, padding:'18px 18px', marginBottom:12, cursor:'pointer', fontFamily:'inherit', textAlign:'left', boxShadow:'0 1px 3px rgba(0,0,0,0.06)', boxSizing:'border-box' }}>
          <div style={{ width:60, height:60, borderRadius:16, background:'#FFE9F3', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
              <path d="M9 2L4 14h7l-2 10 11-14h-8z" fill="#A5278E" opacity="0.12"/>
              <path d="M9 2L4 14h7l-2 10 11-14h-8z" stroke="#A5278E" strokeWidth="1.6" strokeLinejoin="round"/>
              <path d="M2 14h3M21 12h3" stroke="#A5278E" strokeWidth="1.6" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize:18, fontWeight:700, color:'#1C1C1E', marginBottom:4, letterSpacing:'-0.01em' }}>Carga rápida</div>
            <div style={{ fontSize:14, color:'#8E8E93', fontWeight:400 }}>Solo el nombre y la categoría</div>
          </div>
        </button>

        {/* Opción Gasto completo */}
        <button onClick={onFull}
          style={{ display:'flex', alignItems:'center', gap:16, width:'100%', background:'#fff', border:'none', borderRadius:16, padding:'18px 18px', cursor:'pointer', fontFamily:'inherit', textAlign:'left', boxShadow:'0 1px 3px rgba(0,0,0,0.06)', boxSizing:'border-box' }}>
          <div style={{ width:60, height:60, borderRadius:16, background:'#EFEAFA', flexShrink:0, display:'flex', alignItems:'center', justifyContent:'center' }}>
            <svg width="24" height="26" viewBox="0 0 24 26" fill="none">
              <rect x="2" y="1" width="20" height="24" rx="4" fill="#7B5BD8" opacity="0.12"/>
              <rect x="2" y="1" width="20" height="24" rx="4" stroke="#7B5BD8" strokeWidth="1.5"/>
              <path d="M7 8h10M7 13h10M7 18h6" stroke="#7B5BD8" strokeWidth="1.8" strokeLinecap="round"/>
            </svg>
          </div>
          <div>
            <div style={{ fontSize:18, fontWeight:700, color:'#1C1C1E', marginBottom:4, letterSpacing:'-0.01em' }}>Gasto completo</div>
            <div style={{ fontSize:14, color:'#8E8E93', fontWeight:400 }}>Con todos los detalles</div>
          </div>
        </button>

      </div>
    </div>
  );
}

// ─── QUICK ADD SHEET ─────────────────────────────────────────────────────────

function QuickAddSheet({ onSave, onClose, lastUsed }) {
  const [amount,   setAmount]   = useState('');
  const [category, setCategory] = useState(lastUsed?.category || 'super');
  const [paidBy,   setPaidBy]   = useState(lastUsed?.paidBy   || 'toba');
  const [saved,    setSaved]    = useState(false);
  const [error,    setError]    = useState('');

  const handleSave = () => {
    const amt = parseAmount(amount);
    if (isNaN(amt) || amt <= 0) { setError('Ingresá un monto'); return; }
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

  const cat = CATS.find(c => c.id === category);

  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.5)', zIndex:300, display:'flex', alignItems:'flex-end' }} onClick={onClose}>
      <div style={{ background:C.card, borderRadius:'24px 24px 0 0', padding:'24px 20px 32px', width:'100%', boxSizing:'border-box' }} onClick={e=>e.stopPropagation()}>
        <div style={{ width:40, height:4, background:C.border, borderRadius:R.pill, margin:'0 auto 20px' }} />

        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
          <div>
            <div style={{ fontSize:18, fontWeight:800, color:C.text }}>⚡ Carga rápida</div>
            <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>Efectivo · Compartido · Hoy</div>
          </div>
          <button onClick={onClose} style={{ border:'none', background:'none', fontSize:20, color:C.muted, cursor:'pointer', padding:4 }}>✕</button>
        </div>

        {/* Monto grande */}
        <div style={{ position:'relative', marginBottom:20 }}>
          <div style={{ position:'absolute', left:16, top:'50%', transform:'translateY(-50%)', fontSize:24, fontWeight:800, color:C.muted }}>$</div>
          <input
            style={{ ...S.input, fontSize:32, fontWeight:800, paddingLeft:40, letterSpacing:'-0.02em', border:`2px solid ${C.border}`, borderRadius:R.md }}
            type="text" value={amount} onChange={e=>setAmount(e.target.value)}
            placeholder="0" inputMode="decimal" autoFocus />
        </div>

        {/* Quién pagó */}
        <div style={{ marginBottom:16 }}>
          <Toggle options={[{value:'toba',label:'Toba',icon:'●'},{value:'gri',label:'Gri',icon:'●'}]}
            value={paidBy} onChange={setPaidBy} colors={{toba:C.selected,gri:C.primary}} />
        </div>

        {/* Categorías — scroll horizontal */}
        <div style={{ marginBottom:20 }}>
          <div style={{ display:'flex', gap:8, overflowX:'auto', paddingBottom:4 }}>
            {CATS.map(c => (
              <button key={c.id} onClick={()=>setCategory(c.id)}
                style={{ ...S.chip(category===c.id), padding:'7px 12px', fontSize:12, flexShrink:0 }}>
                {c.icon} {c.label}
              </button>
            ))}
          </div>
        </div>

        {/* Preview */}
        {parseAmount(amount) > 0 && (
          <div style={{ background:C.selected+'1A', border:`1px solid ${C.selected}30`, borderRadius:R.sm, padding:'10px 14px', marginBottom:16, display:'flex', alignItems:'center', gap:10 }}>
            <span style={{ fontSize:22 }}>{cat?.icon}</span>
            <div>
              <div style={{ fontSize:14, fontWeight:700, color:C.text }}>{fmt(parseAmount(amount))}</div>
              <div style={{ fontSize:12, color:C.muted }}>pagó {paidBy==='toba'?'Toba':'Gri'} · {cat?.label}</div>
            </div>
          </div>
        )}

        {error && <div style={{ color:C.danger, fontSize:13, fontWeight:600, marginBottom:12 }}>{error}</div>}

        <button style={S.btn(saved ? C.success : C.primary)} onClick={handleSave}>
          {saved ? '✓ Guardado' : 'Agregar gasto'}
        </button>
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
      <div style={{ background:C.card, borderRadius:'24px 24px 0 0', padding:'28px 20px 36px', width:'100%', boxSizing:'border-box', maxHeight:'90vh', overflowY:'auto' }} onClick={e=>e.stopPropagation()}>
        <div style={{ width:40, height:4, background:C.border, borderRadius:R.pill, margin:'0 auto 24px' }} />
        <div style={{ fontSize:20, fontWeight:800, color:C.text, marginBottom:4 }}>Registrar pago</div>
        <p style={{ fontSize:14, color:C.muted, marginBottom:24, marginTop:6 }}>
          {Math.abs(currentNet) > 100 ? `Balance actual: ${fmt(Math.abs(currentNet))} — debe ${currentNet>0?'Gri':'Toba'}` : 'Actualmente están a mano'}
        </p>
        <div style={{ marginBottom:18 }}>
          <label style={S.label}>¿Quién transfirió?</label>
          <Toggle options={[{value:'toba',label:'Toba',icon:'●'},{value:'gri',label:'Gri',icon:'●'}]} value={from} onChange={setFrom} colors={{toba:C.toba,gri:C.gri}} />
        </div>
        <div style={{ marginBottom:18 }}>
          <label style={S.label}>Monto ($)</label>
          <input style={{ ...S.input, fontSize:24, fontWeight:800 }} type="text" value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0" inputMode="decimal" />
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

// ─── DASHBOARD ───────────────────────────────────────────────────────────────

function Dashboard({ expenses, config, month, setMonth, settlements, onAddSettlement, onDeleteSettlement, recurringExpenses }) {
  const [showSettlement, setShowSettlement] = useState(false);
  const p = calcPcts(config.salaryToba, config.salaryGri);

  const mExps   = expenses.filter(e => e.month === month);
  const mSetts  = settlements.filter(s => s.month === month);
  const { griOwesToba, tobaOwesGri, net } = calcNetBalance(mExps, config, mSetts);

  const tobaTotal    = mExps.filter(e => e.paidBy==='toba').reduce((s,e)=>s+e.amount,0);
  const griTotal     = mExps.filter(e => e.paidBy==='gri' ).reduce((s,e)=>s+e.amount,0);
  const personalExps = mExps.filter(e => e.split==='personal');
  const loansExps    = mExps.filter(e => e.split==='prestamo');

  const byCat = {};
  mExps.filter(e=>e.split==='compartido').forEach(e=>{byCat[e.category]=(byCat[e.category]||0)+e.amount;});
  const topCats = Object.entries(byCat).sort((a,b)=>b[1]-a[1]).slice(0,5);

  const historyMonths = [...new Set(expenses.map(e=>e.month))].filter(m=>m!==month).sort().reverse().slice(0,8);

  const debtor   = net> 100?'Gri':net<-100?'Toba':null;
  const creditor = net> 100?'Toba':net<-100?'Gri':null;
  const dColor   = net>0?C.gri:C.toba;

  // Gastos fijos proyectados este mes
  const mRecurring = mExps.filter(e => e.recurringId);

  return (
    <div style={{ padding:'24px 16px 8px' }}>
      <MonthNav month={month} setMonth={setMonth} />

      {/* Balance card */}
      <div style={{ ...S.cardLg, marginBottom:16 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:20 }}>
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'0.06em' }}>Balance del mes</div>
            <div style={{ fontSize:13, color:C.muted, marginTop:2 }}>{monthLabel(month)}</div>
          </div>
          {debtor && <div style={{ background:dColor+'14', color:dColor, padding:'5px 12px', borderRadius:R.pill, fontSize:12, fontWeight:700 }}>Debe {debtor}</div>}
        </div>

        {debtor ? (<>
          <div style={{ fontSize:48, fontWeight:800, color:C.text, letterSpacing:'-0.03em', lineHeight:1, marginBottom:20 }}>{fmt(Math.abs(net))}</div>
          <div style={S.divider} />
          <div style={{ display:'flex', marginTop:18, marginBottom:18 }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:11, fontWeight:600, color:C.muted, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:6 }}>Gri debe</div>
              <div style={{ fontSize:20, fontWeight:800, color:C.gri }}>{fmt(griOwesToba)}</div>
            </div>
            <div style={{ width:1, background:C.border, margin:'0 20px' }} />
            <div style={{ flex:1 }}>
              <div style={{ fontSize:11, fontWeight:600, color:C.muted, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:6 }}>Toba debe</div>
              <div style={{ fontSize:20, fontWeight:800, color:C.toba }}>{fmt(tobaOwesGri)}</div>
            </div>
          </div>
        </>) : (<>
          <div style={{ display:'flex', flexDirection:'column', alignItems:'center', textAlign:'center', marginBottom:18 }}>
            <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAmQAAAEyCAYAAABULszLAAC56ElEQVR4nOx9eXxU1fn+mS2TZLJMAoQlKkZtpBqx0Wq0xg0XtBqX1CUutEWsxmrRihtqsVJUXHGj+HVFLe67ggpWxQWtRRRkUWTfsiez7zPP74/5PTdvboMEiUzA83w+z4eQzNw5986597znXZ7XAkBpaGhoaGhoaGhkDtZMD0BDQ0NDQ0ND4+cObZBpaGhoaGhoaGQY2iDT0NDQ0NDQ0MgwtEGmoaGhoaGhoZFhaINMQ0NDQ0NDQyPD0AaZhoaGhoaGhkaGoQ0yDQ0NDQ0NDY0MQxtkGhoaGhoaGhoZhjbINDQ0NDQ0NDQyDG2QaWhoaGhoaGhkGNog09DQ0NDQ0NDIMLRBpqGhoaGhoaGRYWiDTENDQ0NDQ0Mjw9AGmYaGhoaGhoZGhqENMg0NDQ0NDQ2NDEMbZBoaGhoaGhoaGYY2yDQ0NDQ0NDQ0MgxtkGloaGhoaGhoZBjaINPQ0NDQ0NDQyDC0QaahoaGhoaGhkWFog0xDQ0NDQ0NDI8PQBpmGhoaGhoaGRoahDTINDQ0NDQ0NjQxDG2QaGhoaGhoaGhmGNsg0NDQ0NDQ0NDIMbZBpaGhoaGhoaGQY2iDT0NDQ0NDQ0MgwtEGmoaGhoaGhoZFhaINMQ0NDQ0NDQyPD0AaZhoaGhoaGhkaGoQ0yDQ0NDQ0NDY0MQxtkGhoaGhoaGhoZhjbINDQ0NDQ0NDQyDG2QaWhoaGhoaGhkGNog09DQ0NDQ0NDIMLRBpqGhoaGhoaGRYWiDTENDQ0NDQ0Mjw9AGmYaGhoaGhoZGhqENMg0NDQ0NDQ2NDEMbZBoaGhoaGhoaGYY2yDQ0NDQ0NDQ0MgxtkGloaGhoaGhoZBjaINPQ0NDQ0NDQyDC0QaahoaGhoaGhkWFog0xDQ0NDQ0NDI8PQBpmGhoaGhoaGRoahDTINDQ0NDQ0NjQxDG2QaGhoaGhoaGhmGNsg0NDQ0NDQ0NDIMbZBpaGhoaGhoaGQY2iDT0NDQ0NDQ0MgwtEGmoaGhoaGhoZFhaINMQ0NDQ0NDQyPD0AaZhoaGhoaGhkaGoQ0yDQ0NDQ0NDY0MQxtkGhoaGhoaGhoZhjbINDQ0NDQ0NDQyDG2QaWhoaGhoaGhkGNog09DQ0NDQ0NDIMLRBpqGhoaGhoaGRYWiDTENDQ0NDQ0Mjw9AGmYaGhoaGhoZGhqENMg0NDQ0NDQ2NDEMbZBoaGhoaGhoaGYY2yDQ0NDQ0NDQ0MgxtkGloaGhoaGhoZBjaINPQ0NDQ0NDQyDC0QaahoaGhoaGhkWFog0xDQ0NDQ0NDI8PQBpmGhoaGhoaGRoahDTINDQ0NDQ0NjQxDG2QaGhoaGhoaGhmGNsg0NDQ0NDQ0NDIMbZBpaGhoaGhoaGQY2iDT0NDQ0NDQ0MgwtEGmoaGhoaGhoZFhaINMQ0NDQ0NDQyPD0AaZhoaGhoaGhkaGoQ0yDQ0NDQ0NDY0MQxtkGhoaGhoaGhoZhjbINDQ0NDQ0NDQyDG2QaWhoaGhoaGhkGNog09DQ0NDQ0NDIMLRBpqGhoaGhoaGRYWiDTENDQ0NDQ0Mjw9AGmYaGhoaGhoZGhqENMg0NDQ0NDQ2NDEMbZBo/e0Sj0fKOjo5R/H8kEqlIJpNu/j+ZTLrj8XgpAIdSSqVSKVcymXSnUilXBoaroaGhobETwp7pAWhoZBpOp3O5zWbzJJNJdzQa3TsSiVTk5+d3WCyWuNVqDVqt1qDNZvOY32e1WoMZGK6GhoaGxk4IC4BMj0FDI2Nob28fU1hY+LLVag1aLJY4AIfFYokrlfaM8WdpfPH32iDT0NDQ0OgtaA+Zxs8a2dnZi/mzDEmmUilXLBYry8rKWi3/Rlgsltj2HamGhoaGxs4M7SHT0FBpgyuVSrkSiURJMpksslqtQRprABwAslKplMtiscToTcv0mDU0NDQ0dh5og0zjZ414PF4ajUb3djgcG+x2ezNzxaLRaHkqlXLl5OR8JV8vQ5ryZw0NDQ0NjW2BNsg0ftaIx+OlDodjo1JK+Xy+mng8XlpUVPQ0vWLhcLgyJyfnK7vd3qxUOpypVDpkqY0xDQ0NDY3egpa90PhZg8bYihUr5o0dO/aNQYMGTbPZbIGCgoKO3Xbbram9vf3CYDBYzRyyZDLpTiQSJQCyMjtyDQ0NDY2dCVYuNJFIpMLv94+MxWJlmR6UhkZvAYAjHo+Xtra2jo3H46VKKRUOhyv/vwfMoZRSDz74IIYPH37ok08+qa688kr1/vvvq7/85S8qFoupPfbY44yysrKXQ6FQVTQaLXc4HBuj0Wg5Kyy9Xm+tUkrJ4zc2Nk5SqtObpqGxo4JzWqnOYhel0vdVNBotV0qpQCAwwu/3j+Tf2tvbx8hjAHAkEokS/j2VSrnC4XBlJBKpCIfDlUqlUwTk57W1tdVvj/PT2LnBZz3/n0qlXOYCrWg0Wu7z+Wo4BzOKUChUCUBJRqPRskAgUB2NRsvMf9PU3JHo8XhqAahwOFwBQMXj8ZKWlpaxAFR7e/uoiy66CEop/O53v0NHR0ddMpl0tbe3jwKgWlpaxr7xxhtQSkEphcsvvxyxWKw0EAhUA1AdHR11ANSqVatmxWKxUv4MQKVSKYfP5xuZ6fPX1NwWJhIJdzKZdCWTSVc8Hi9JJBJu/i2ZTLpSqZQDSM93+b5YLFba0NAwCYD65ptvfLfffjuOO+44DBkyBPvssw/uueceJJNJFwC1Zs2aFwGoUChU6fV6a3gM3ruamj+WqVTKkUqlHMlk0pVIJNyJRMItfxcMBqs4D8lYLFYaiUTKI5FI+fYerwKgAoFA9fr16x9uamoabx6cpuaOTm4sIpFIOY2oFStWzK2rq0N+fj4uvfRSrF27dgbQdZEB0vcGAHXaaadBKYXCwkIsXLgwuXHjxil8PY2xpUuXrpOflenz1tTsLXIRM//e4/HU0nBau3btjFAoVBmPx0v8fv+IZ555BkopWCwWKKVgtVpRXFyMgQMHIjs729jodHR01PH+4zEjkUh5d5+nqbm1TCQS7lgsVtqdbcNndzKZdPn9/hGce5kaq6LFyF+kUilHIBCo9vv9IzJ9ITU1e4PBYLAKgKIR5fF4ak855RS4XC5MnDgRnP9r1qx5MZVKOUKhUOW33367LJlMujweT208Hi9JJpOuQCBQnZubi7y8PJSVlYGeZPPntbW1jeGOLNPnrqnZ26SngZ4zID3n+ffHH38cFosFFosF+++/P+bMmQMgfR9u2LBhaiqVcrS2tta/8cYbsNlsUErBZrOhubl5HI+l7x3N3qKcp939n5R2UCwWK5VzenvR+CEcDleEw+EKLiTxeLwk0xdSU3NbSY8Y6fV6a0aNGgWHw4EpU6aArmu/3z+Ci0AqlXLIDcmGDRumAukbORQKVd57773o168f7HY7brzxRvA9jY2NE+gtaG1trc/0uWtqbiulx5jeYOlt4Jrh9XprIpFIuVIKWVlZOOaYYxAKhSoTiYQ7Go2W+f3+Ed2lxwBQb731FnbbbTdkZ2fj+++/n8f0Auk109TsDcZisdJwOFxBzxjDk+FwuKIv2DzK6/XWMDeAgwTSu6DN3UCamjsK6R0D0nP6kksugVIKN998M2iA8UaMxWKl0oCjR427eoYjuXmpqamBzWZDTk4OmC8DwMjLZK6apuaOShpenP9yjZB86KGHoJSC0+nE3LlzEYvFSqXHgZt8bmra2trGtLe3j6KXORaLlTKE+dprrwHoTDXQ1Pyx7G4Obi4UnkwmXT6fb2Rra2u9z+cbmQkvrZoyZQrmz59vJFjSnafj95o7C0OhUKXH46m9++67UVRUhIsuughA2hDjTcedP39mHgH/3tTUND6RSLjl7qqhoWFSQ0PDJKUUcnNzsffeeyMajZbR66bzMTV3dMo5LI2sWCxWyhBjbm4u7HY7jjzySMhisPb29lG8xzbnfYjH4yXxeLyEnuUzzzwTSim89NJLkAn+mpo/hrRlzHMwHo+XtLa21geDwapoNFrGELz5vdt7vIq7EqUUhg4diltuuQWNjY0TAChdJaa5ozMUClUmk0nX559/DqfTiSOPPBJAZ7I+DafuDCjewOvXr39Y/j8SiZTLih0A6vbbbwcNsxkzZoCVmpqaOzKll0ouaA0NDZM+//xzOBwO2Gw2zJw509jU+3y+kVwIpQHHRP1UKuUIh8MVvAfpxWbu8jHHHAOlFD788ENk+vw1dw7G4/ES6d3dsGHD1I8//hiHHHIIhgwZYuQxnnTSSXjxxReRqZQTBUD5/f4Rc+bMQWlpqVEVs2jRogjQWYXAHQxzaxKJhFtXkmn2BUaj0TKfzzcyGAxWcQHgpoJ5LEop7LLLLpA7od7agdP4isVipXvssQeKiopgtVoh7xV62mQYUy5w4XC4QnqldZWZ5vai1+utSaVSDs5Hj8dTy+c+Nx2hUKiSxlkqlXIcddRRUErh4IMPNtYKn883kjllQOfasaXP5r3BsL/H46l1u92wWq3o6OioY05ZJBIp57E7Ojrq+kLOj2ZmKW0QaUQxDM4cRv6+sbFxwi233NKl+vfggw/GWWedhcrKSiilkJ2dDZvNhvr6egCdNg/nngxlMj0lkUi4A4FAtUyD4fwMh8MVXq+3Rt4PMg+TxQMrV66cYyxKfr9/RDKZdIXD4YqioiIopXDFFVcA6PSUtba21vMC6MVCsy+QCfecj93tvJVScDgckA/wFStWzO2Nz+eC1d7ePoqG14cffoh+/frBYrHg9NNPRyQSKZfVmK2trfV+v38Ew5/yBm9qahrPn3UOjeZPTWk8Sa8uNw7mKuL169c/rJTCHnvsgUmTJoEaYtFotEwuTlu7PvA+5vGA9H2blZVlVF8yFYDrkU4J0ATS84LGWDgcrpD5vEDaCFu/fv3Dixcvbuvfvz+sViuOP/54o7re6/XWSAN/06ZNdxx//PHIycmBUgpA+j6IRCLldEzR42vOUebPzFWTxWEy5M+5SyNu6dKl684444zOP7S1tY3hwf/zn//gr3/9K/Lz83HttdcaAwK6Jkl3V/Kvqbk9KY0Wem39fv+I5ubmcaFQqJI7eS4Szc3N4zjne0vaxVzJGY/HS7777ruF9fX1yM7Oxp577omZM2eCCwnvG449kUi4maMGpHd95oeKpuZPQeqGyXUgFApV+ny+kVw8eC/dfvvtsFqt2G233fD666+Dx0gmk66NGzdOoSfL6/XW8OctceXKlXN4DPPvVqxYMZdpBlwIpVjst99+uyzT108zs6TXiY6laDRaxrnU1NQ0nkbWxIkT4Xa7oZQCxbvNz/9IJFLOTcXGjRunxOPxEqZzLVmypIHHBzqjInKTHwqFKnkMzn/+K0WPvV5vDQvGbr75ZlitViNtTHEB40G5Q4nFYqW//e1v4XQ6sXjx4jbgfy1RrRWj2RfY3Nw8zlwlDEC9+uqrsFqtuPPOOwF0uoZTqZSDeWHbSt4DoVCokkr/8u9+v3+EUgp2ux0nnXQSWltb68PhcAUXFmnMyYeJDsdobi96PJ7a7nLF1qxZ8yJ/HjZsGJRSOP300yHvM7/fP0Lu/JkfBvQsZAmk71+gM1cT6DS2nn76aSilMG3aNPD4kUiknIuq5s+b0vCX0QWPx1NLpYhTTz0VSin86U9/Ap+3XAs8Hk+tTF3hnG1qahrPjXP//v2hlMKnn34KoDPvOBQKVdLDZdZylfeT2VM2efJkFBQUGGLJBxxwAN5//33E4/ES4w1cCILBYJXP5xsZj8dLNm3adEdubi6UUojH4yUyzMObSFMzk0wkEm452akntnHjxilKKRx22GHg31KplGPFihVz2Qamt0KC0sAi169f/3AwGKziDT59+nRjF3THHXeAYwDSCx/fv2HDhqn0pOnWMZo/NblARSKR8u+//34e0Bn+T6VSjg8++AAM+f/73/8G0BlmCQQC1eYNiGxF09MNOxdVv98/or29fRSr4uglppeb9zm9GHIB1vz5kgYVo3c07JPJpOvkk09GSUkJrrvuOqNqd/Xq1a9JQ07mem2u0tLlckEpZRRrmaMirNYE0htrbnISiYT7zTffxOGHH97pBVMK++67Lx5++GG0t7eP6ujoqOOcN1xwwWCwionQQOdNGYvFSh0OB/7v//4P/JvP5xspXdqampmivIEikUi5z+cbGY1Gy/bff384HA6Ew+EKn883ctOmTXeYDbDe0AlLpVKO1atXv8b/r1q1apb0bvn9/hHc1QNQp59+OqxWK2w2G5YsWdJgvrF5T+n8Mc3txYULFyb586ZNm+4Ih8MVmzZtuuP000+Hw+HA8OHD4fV6a6jRBHR6EuLxeInX661hy5lYLFbKhagnn835z3APk6HlghkMBquUUsjLyzMqOXVBmSYZiUTK+bxMJpOuTZs23QFA/fnPf0ZeXh4mT55shLwbGxsncO6y4IvRPhp0PB7XEm6QBwwYgP322w/r1q2bDqTvlUAgUB0MBqv4zA+FQpVPP/00jj76aBQWFhoGmMViwciRI/HJJ58ASG9WOGaZ+qWArrHUcDhc0djYOIHCaLFYrPToo482ktt8Pt9InpxOqtTMNLkI8IEOQL3yyiv/UzYvK7kCgUC12RD6seTNGgqFKmVCMh8KHBNvulQq5fB6vTUMY55wwgmgQbdq1apZdKXznDJ9fTV/HpRhy3nz5iErKwsWiwXXX399l8pkoKsnobsel+YQzZYoW9QwuR9I31v0gn3xxRdQSuG2224DK5K1Q0BT6qcC6edmIpFwP/jgg1BK4a9//Wu3EhasLKZnS87Z7nLjg8Fg1SOPPILBgwejoaFhktxwPPnkk9h///0N48tms6Ffv34YPnw4Zs2ahe48uXLuhsPhCo7B6F1pXgBkTs5nn32Gfv36Qcbtda9Lzb5EGliNjY0TlFI47bTTwFJjs0ub87o35rA5eZO5BfJzZAsYJnMmEgn3PffcA6UU+vfvj1tvvRV8TTQaLZOitZqaPxXZ8gtI3x9VVVUoKiqCw+EANxPNzc3j5L3Duc58SCA9n1tbW+tl+Kcnn897xefzjeRiyg0/5z8r3I466ihYLBYAac+c9iJrAp2bYnqduAYccsghkJ5UWXQCdEpj8O80xJgLLKOHQHquWq1W7LfffjjqqKOQm5uLrKwsKKWQk5OD0aNH4z//+Q9k+FJuZMzPdP5N5g6r7pog8ybhjeHz+UYqpfDKK6/g008/xQ033NBFx8Nms8HhcBgW4qBBg/CHP/wBTz75JBiyAdI38+aSlc1eNxk+1fz5UmoiMc4u/24WYGWyJNDzRSHTHD58OHJycpCbm4u1a9fOkNWWbFdDjxs3Sj/UAkRTk5Ttvvi7VCrl4D3FBaupqWm80+mEUgrPPfcc+kr0g54D5pM5nU4UFRWB58Q+hHLN4rntKPf/zkDq2PV2MRKfcTKiITW8gLTNwM9ub28fRaHXnhyfz9FkMuni89Y8bzZt2nTHd999t/Dss8+GUgoDBgyAUgrnn38+vv/++3lyDZKdjn7M89kY1Pr16x+WJ8nEuFgsVvr6668bxheT20pKSnD11Vfj0UcfxfTp0/H444/j1ltvRW1tLXbddVfY7XbDdWe32zF69GjQUyCbmEvvAXN6zG1rNDWZh0X3rmxvFAwGq9rb20fdd999KC4uxsyZM7EjhftSqZRj5syZyMnJwaBBg1BfX4+mpqbx5jyZeDxewnJsQKcMaG6ZNE6i0WgZjRv+jR6BN998E9nZ2V3SUqSnN5OUY/D5fCPfe+89KKVw3333wXyeMjTE4oBMj39np8yfMn8fvRVFi8fjJYFAoJpGn7mQS85rpoJsTY4hPWzSW9bS0jKWChR77rkn8vPzjUpNWWDS1tY2xlxRyX9/jHGqYrFYaUtLy1iz92HDhg1T8/LyYLFYsNtuu0EphXPOOQe8iSkky5YEMqeAiyYA9eyzz6KystLQ2rDZbLj66qsh9cz8fv8Iuu0osgloL5lmmslk0iWThbn7SCaTLuYHrFu3brpSCoceeii6q/7qq+QOjTfyOeecg+zsbBQWFmLt2rUzKFpozmvw+/0j5D2kqflDlMr7nDfxeLzkm2++8e22225wOBwAOr3Q3PxketzRaLRs3bp100OhUCXPga2VgPSzgWuNVFTXOn7b/3tisV9vF1w0NzePk3pjtDEYKaDiw5577gm73Y5vv/12WU/HIMOdwWCwyuv11lBN4u233waLSZ588klD7kUphY8++gjffvvtMrnOyOe4WfqipzS8UMlk0uXxeGqbmprG77LLLsZAZsyYgW+//XbZ0KFD8cwzz4BvbG1trZe6TlJckL/jz7w5li5duu7II4+EUgoDBw7EkCFDsGDBAkOJORqNltE1KT0gmj9fMizRnbeUc2zRokWR8vJyDB06FMwjCAQC1TuSllcwGKySorXc6b333nsA0g8iblqSyaRLizJr9pSy7RHQWXASCASqmQMjn7Ver7emL907smUTN2R0FjCEz8WSmmjmsJbmT8OfOool5635uSeV8uvq6pCVlYW33nrLcBrJApEt0ez8efHFF6GUwj777AP5uYlEwp2VlYXzzjsP3V0L6ZjqqQ6fpHGQ9evXP7xixYq5paWlcDgc+PTTT8Ed0rx582CxWMCQoizZpKfCLIzG5E+5y6IrHIB67LHHjDy0oqIizJs3DzJ3Ru/+NYH/FUiVD2DO3YcffhhWqxXTp0+HfO2O8EAOBALVUphQhmh+8YtfICsrC7y/gsFglcyl2BHOTzPzpDeB/2c47/HHH++Sa7N+/fqHWVDCVmCZHjuQXpQZNWERwscff4z+/fvjxRdfBJDe0MRisVKpj6kLz356BoPBKpl7xehYb+WTcaOwYcOGqcwzl0r3ANT9998PpRRuuukmoyPL1nhIm5qaxstOFa2trfUulwvDhw9HMpl0cU51dHTUdXR01JWWluLuu+8Ge6vKiI35/1t7vsZFBaAYVuTkp9E1aNAgWCwWmF3YHo+nlrsW6j1RuZmvMTep5UnTuHv11VeN/DSlFBYsWAB+bl/IYdDMLM1VKlIVHEjP3ezsbFRXV0PONVlK39fJm555cqFQqPK+++5DQUEBnE4n2tvbR5nvvVgsVqq9ZJpbIo2qVCrloAAlkN4IDB8+HP369cP69esfZui/o6Ojjs/fvhCh4GYlmUy6Ojo66mTC/pAhQ+BwOIy2NolEws0Q1I50/+9M/Cny9mRqimR7e/soNgofM2YMQqFQpcwj7O49ZrJ1GJC+J9jHUobEga59KJVSeO+99xAKhSq7c0bRMPtRBhnd02xRwcHxRp47dy6ysrIwY8YM8CRbWlrGSm9Wd18Ck/p4vFQq5WA7A54odzDhcLiio6Ojbo899kBeXh6UUnj77beR6cmlmXlyFyK9skB6fra0tIwtLS2F2+02VJilXEtfCrtsjuYWShdddJHRVuPXv/416EqXlcraGNPsKaWXSxpkkUikfNCgQdh7770h76v29vZRnJN9JQ9LepDNEjZKKZx33nlGTjKjM70h+qzZs/klnTKBQKCa+X694WGlgQ2kn330jC1evLjtoosugtVqxejRowF0VtyHQqFKirduidzotrW1jeF4lVKYMGEC+PnSaLv++usxcOBAyLVlc1p8P7rKMhQKVU6ePBlOpxM8GBPmHA4HrFYrupMckIOijpn0jtFalDobrJDjlwl0ajd1dHTUffzxx1BKwel0YtiwYcj0hNPMLGXelJx/q1evfu3dd9+Fw+EwwhZcQOgy3xF0iugVGzNmDJRSyM/PR1VVFXgeQGdfP3oJAO0h0+w5pbECdG4CTjzxRMMTIMv9GW7qKyHxZDLpModdWVDG1Jd33nkHFDPna/T9sX343XffLXz44YdxySWX4E9/+hPuu+8+fP31170mnRKPx0tk+Pm9997DAQccAKUUJk6cCL/fP4J/l7nnPfXwUlwcgProo49QXFwMVnbK13V0dNTl5uZiyJAhALoWBPSWAaqAtJU4f/58KKWwevXq15LJpGvDhg1Ti4qKkJubCylHIat0fkzSmplSQI0hykgkUj5lyhSUlJTAZrPhsssug0ySY8yXBiFjvFyEORF0DsHOQTnxuWhs3LhxisvlwrHHHovly5fPB3pnPv4UZGm4DDvy54kTJ0IphcLCQvzpT38Cz5UimzynZDLp4u6Quy95vhTm5LF/bFLp9qY5+dqci8Fzk5s3WcVtJp8j8rliXhhkfguvpTns0JeU4OXCwCozOYdaWlrGMlTDkDdfa/YSUywZgPryyy+RlZWFOXPmQL5Gej0yfe5bYjKZdA0cOBBKKXDTxu+7L1SJ7izknJI5eqlUyjF8+HAjqiW1Se12u/H7U089FZ9//jmA9Hrf1tY2ZmsMfnq7Vq5cOScnJwdKKeyyyy5GG6JtocyFj0ajZQsWLDA2KbFYrJQb4GQy6br66qthtVrxwQcf4KeaX11CIdTaOP30040+TO+++y74RdAlyIH0hgdCnpS583ooFKo899xz4XA4YLfb8cEHHxhtEPivbMAs9Ul0/tnOQdlKCOhcTA899FAopUC9vFAoVClbX/j9/hF94YEs9ZBSqZSjpaVlLOcmdf1OOOEEfP/99/OkAXLdddfh17/+tfGgGz58OO688060tbWNkW78jo6OOukZoK6fTHrty+yumS8NMOkV5S5Z7noZxqbxJvNU5bEp4xAMBqu68+LLz5cGYV8wSGKxWGljY+ME826f5yZFKeV3Ls+LxVTyXuLPxcXFxgJED3NvtRXbXmT4dZ999gF/tzX9NDU3Tz5r/H7/CG4MIpFIucfjqXW73bBarbj33nuN684NwMqVK+c89NBDqKys7NLTMScnB2eccQbeeOMNrFmz5sXuKhNZvNTS0jL2mWeewemnn26kcVitVrz22mvGc39bycgeK48BqPz8fNxwww1GgUBHR0fdtddeC6UULrvsMvAa/BQbXuXz+Ubypm5vbx919NFHo1+/fhg8eHCXOKnMP+jNXpas0uD/pcYIf9fY2DiBX+r+++9vJG/zARKJRMppdXOM7e3to8wq7po7JplHFY/HS1paWsa+8MILUErh9ddfB5BecDdt2nSHORTeV8icBkrLrFu3brrb7Ub//v3x7bffLpMPA6UUuEhmZWXh2GOPxX777YdBgwYZ3TCcTiemTZsGvofny50kF6MdIWQrSaOK4o/mMnf+TlZ2m8NY/Jn6RJu7BmyK3Zc8YT90XYD0c45VuWzvkkqlHGvXrp3BEv/GxsYJZqN09OjR6N+/P+x2O5RScDgcqKmpAbXGsrKycMYZZ4DXBUgvVLJVXl8lpZKmTZuGAQMG4OOPP0YymXTpZ3/vzT25AWxoaJi0YsWKuUx8X7FixVxuhLkOy+cwReBDoVDlK6+8Am6kSavVCqvVCpvNBrvdjqysLDidTjidTkOsWCmF2tpaLF26dB0T6Tds2DC1NzcOrBBtamoaT527M888E1dddRUsFgvsdjvq6urA1/9U94aSYUAg7ZFgon4kEinv6OioM0tQSAG+3hhEJBIpl5IYqVTKEQqFKoPBYBV3/MFgsOrll182vqSnn34aQGczUSB9cwaDwSotmbHzkCEtmYNYWFiI/Px8JJNJF0Mw0hvCRVh6WzPFYDBYJY2Kd99913jIyF38nXfeCYvFgtLSUtx///3ge4G0d7qtrW1MKpVyvP3229h7773hdrthsVjwxBNP4NNPP4X8PJlWsCNxc9VJsVis1OfzjTTnrNLwYJ5qOByu6E4mhf96PJ5aPt+6+3zOHSYn94WUB7kYyiIpoNNQo8eVepD/+Mc/0L9/f0OImyGkZ599FqFQqPKJJ56AUgrZ2dlYuXLlnFmzZkEphSeffNKYRzLysCOwubl5HNcGXrMdbUPSV9na2lofCASq6TxZu3btjNzcXLz22msA0uv3D0Uj6O0y944MhUKVr732GqZNm4arrroKo0aNwgUXXICJEyfipZdewn/+8x/wtfJe7M1nWzAYrPL5fCPNc+XCCy80xOwPOOAArFmz5kW2V+Ln97RwYGuogLSrW+ZpmB9E3Il1dHTUSe9Db0x4+RCWoQrza+RnDhs2zOj9B6QfHh6Pp1Y2eAa6Psw0d0zSbRwMBqv8fv+IQw45BPn5+QDS3gA5N+hK56LVV75/nsO7776LIUOGoLi4GEDnPK2trYXD4cChhx4KhuZ480vXvMzf+Oabb3wVFRVwOp1GEcDKlSvnAJ1pADtClSnwwzlb5kRtqoHL31EHicdiki939+aGvjI/je/tq71BvV5vDZ+L5mcvn9OUGxozZoyRw7PXXnvBYrHg97//Pc477zxkZWUhLy8Pf/rTnwy9x2HDhsFut+OTTz7BBRdcAKUUvvnmGx/nWV9J6v8hytZ7GzdunDJ48GCceOKJ6Es6ajsyuzO0aOgnEgk3WxoBabuhqalpPEW5/X7/CDaN53uDwWAV+42a78XuuGbNmhf5c3t7+yhZ8Si/+x9LeV8lEgn3F198AfO5r1+//uFAIFDNFk0yT7O3qVKplIOWXmtraz0XMfmBDCPKlhu9tXv0+XwjzS52tmHggyEQCFQHAoFqLjixWKz0s88+MzqtL1y4MAl0zaFgorfmjs9AIFCdSCTc8+bNQ15eHu6++26ju4M01mRrpUyPmZQeaO645L1VW1sLm82GKVOmAOjs5yqVo7kr4wLJ+7C1tbX+rbfeMjxuDOWx9ceOwO6EpUkW7sg8Ml7PYDBYNWvWLNx4440455xzcNhhh+Gwww7Daaedhuuvvx5z5syBVNc2G3Bmbxo3hKzSooc+09eH4+d5+/3+ETI8HwqFKr/99ttl9HjZbDaw08qKFSvm0hsYCoUq//73v8Nms8HhcBiakhdddBGUUpg1axZGjBiBwsJCLFu2bAXbyGT63HtC6Xm56667oJTC3Llz0ZeeAzsq5Zrf3t4+asWKFXMHDhyIOXPmGFWUMkolo1wsAuSmR7a/k6/lz9FotIy5WebNgNxcNzU1je+te5NpEg0NDZPM8yUWi5Vu7h7YtGnTHT+FB9b4YPMgGbakNWsW4+xNlzZjzIwPy7/JcI8MlbLx5/Dhw6GUwmmnnQa+TmvQ7DyUN/3gwYONBGSZ22D2rgQCgerGxsYJfaGwg3ORuTupVMpBY3LcuHGwWCy46qqrkEqlHFLM0uzdS6VSDnpLGhoaJsl71uPx1A4ePBg2m62LHtuOEHbqzjPGhzPDr/z9W2+9hcrKSkMexO12GyE5MisrC9nZ2XA6ncbfiouLUVdXh3feecfIP43H4yXdCTv2RcqqUW5OgLTR/sc//hH9+vVDeXm5kXt4yimnQM4PmZAdCoUq6UWjEOapp56K/fffH3PmzMGgQYOw6667YvXq1a9l+rx7em2kpxCAKioqMqouMz2+HZ2yyAVI9xHdddddIT1XsmiJBpWUjWCuZ3ceS6ZEdZemwHCilM7qbSOIGxN2euDP0nBkbpnH46mV2nw/xfwyBiRVjvkgl5oetCSlgdQbF4dyAHK3Kh8g/NLMX750Mz766KNGTgTLa+lizPSE1tx2tre3j7riiisMY4zzkz0rgfTNIY2YvlBhSe6yyy6wWq2QvdX+9a9/wW6349xzzwXQOa/pHQbSC4ycwzTYWGkqS8eDwWCVUgqjRo2C3+8fYfYK7UikqHR7e/uo+vp6uN1uwwgrKCjAiBEj8MILL6ChoWGSfG4wpACkvYfz58/Htddei4MPPrhLOT6Nt+zsbPzyl7/EoYceirq6Otx000144YUXsHDhwqSsju0rlEUMixYtihx22GHIzc3FL3/5SyNZf968eaCHQcrEUIg7EAhUt7W1jRkyZIhxP0UikfLy8nKjPZ7D4YDFYtmhPExMu+H8ycrKwq9+9Stkelw7Orn+s/DI6XSioqKiy3U1V0ry9zSgzCkD9HSbPdR8pnX33OJr6Rnj5rQ3zjEQCFTzPGkI8lzM+aaUx/ipJIUy/oVvK6lLBECxCu2OO+4wmkx7PJ5aTopkMunihZRFBJqZpdQ8ovEt8xU3btw4JSsrC5dccgmAznD6T5FUubWU7TnkgykUClWmUinHAw88YFSESq+MUgp77LEHeuv6dXR01F1yySVdPAPc6XFs5ntAGnvdear4d3MOiNw58gHK71CGjc3HZ0iChiTHSWP6008/xaWXXgp6QrOysuBwOLD33nvjrrvuMlq68f3ygSyNU5ayd3et2tvbR33yySe46667MGbMGFRVVWHo0KFdKrqkweZ0OnHYYYdh6tSpRpk+j8WHNc+TiwbHwQe9bF9k1jtjmy8ZguRxuPGQhhWNbebxHH300bBarTjxxBMNKQDKe8jnG4tf+DmLFy9uGzBgAH7xi18Y80UphaKiIjQ2Nk7gNeBY+Pk8Z2rrZfr+Y76lnOeRSKT81VdfhVIKr7zySpd7jOevWyv1/NnCgr9kMumy2Wz47LPP0Fe6OOxszPgAeosbN26cEovFSi+55BJYLBYj4R/ofFAyCdDc2V0zc5Q7KBphLS0tY7lIeL3eGi7OiUTC3d7ePqqjo6NOuswzzQ0bNkzlrkpqRnHsxx9/fJdSfJZ698Zny7zJF154AQMHDkRDQ8MkaST4/f4RMnxplooguXOVRkcikXB3dHTUyRCwz+cbScN5zZo1L0otQxm+YMWzuYXa559/jquvvhoHH3ywISZZUFAAij4OHDgQ1113HRYuXJg0G1c+n2+kx+Op7W4zZRabDIVClR988AEef/xxXHHFFTj55JNxxBFH4Mgjj8QxxxyD448/HldffTX+9re/4emnn4ZMEl64cGHyueeew1FHHQWGwJxOJywWCywWC2prazF37lyw+pMeKLORKH8OhUKV0jgLBALVNCxpsJorKaUIN+fVgAEDkJeXh7POOgt2ux1XXXUVvv3222Xm3N5IJFJOg1D2gOR4HnroISilcP311xtzkZ5IztOCggLjb19//bXhNesr+XWcw2zLx+9/2bJlK+rq6lBYWAgKhnON6Eve8x2BXq+3JhwOV3z44YewWq2Qjd4zPbadjRkfwLaSVXVyUX/vvfeMHe+CBQsAdOaftbS0jOViJUNImpkjDTD5oORCcs8992D33XdHY2PjBC5gQNpQ6As6SfT6UKqFv/f7/SPoZeGCG4lEyi+99FIopUDNnm39fHpPPB5P7fTp040wVHche1mJ6PV6a+gllg9WLl68n2QYWLrv6SHhwhwOhyvoLaSxAUAxbMgQGQ0b5ndddNFFuPnmmzFnzhyYC4V4TZmXEg6HK+QYGH7jnPjqq69w2mmnGZ+Tn5+PvLw84/PsdjtycnJQWFiIoqIiw9DKzc1FSUmJIT6plMLuu++Ok046Cf/9738h21X9+9//xmmnndZFTqJfv3448cQT8c4774DXiYZyMBisam1trZdzg2K+PAdz6IUK4bKqFkgbGRzfRx99BKUULr74YsMzJruX8PjS4APSRqoMY9KrumrVqll8DT9j0aJFkcLCQuy+++5Gr8hoNFrG77kvRBiCwWAVeyGbz3Xx4sVt/C7lJoTht540n/65k5u1aDRa9pe//MV4vnAuZHp8OxszPoDeoEziD4fDFXzA8eE/fvx4AJ1aawDUjlSJtjMzkUi4pZdHVtCEw+EKpRT22Wcf0JBOpVKOvmCIdUcuUI2NjRNuuOEG5OfnGzmNANQrr7wCm82GO++8E+bFdlvIHSsFDYGu7ZVoNMq8TKnV1J12F8Nb7e3to5iTxOpENnwHOotu6FlraGiYdPnllxvdNbi477bbbrjqqqswf/78LoLTXq+3Ro6LiytDvt3Nl3A4XEEv3eTJk1FWVmZ42pxOJ4YPH46JEyfigw8+QHNz8zimLXR3LCC9qLMLwMaNG6c88cQTOPLII7sYdmzXMm3aNKMZdyAQqH7nnXcwevToLq91uVzYf//98dBDD3UxMtvb20dJI5zacmbZH7OBnEqlHLfeeiuUUkYfvYEDB8Jms4EGqjTyksmkS4oNS0MNSBtlvMdWr1792tChQ1FQUNBlTjIn7aWXXkJWVhbOPPNMcDw0LvuCl4znJT3CchPx1FNPwW634+2330Zra2s9Peu9mYO0M5PfdSwWKx02bBiysrLAv2lPY+8z4wPoDXKXzwqzZDLp4sPl1FNPNcTd+Hp6D3rafFRz+7KxsXFCS0vL2AMPPNAInwBd2xD1Fe+mNPJl8UlWVhZ++9vfAujMdbNYLBgwYACA9MLRG1WQrFBqaGiYpJTCrbfe+j/5HdJzJf/GRGiZZCtDjubFDuha9cxFf968eTjttNOQnZ1tSNHss88++Oc//wmgM7mXxkcoFKqUHrzNhT74nkAgUN3e3j7qm2++8d16663Yb7/9kJ2djaKiItjtdrjdbtx4442GnEhHR0dda2trvTR+KJbr8XhqZVhQ6pBJYViOKR6Pl3zzzTe+P//5zxgwYACcTiccDgfy8vIwfPhwzJ492/jcRCLhfv/99/H73//e8MrxehQWFuK8887Du+++a8hxMAdP5r7JkHdHR0ddIBCo3nPPPWGxWHDllVeCwpxKKUgPDz2WUiVdtp/i9yznKv/f1NQ0XimFX/ziF2hraxtDdfW8vDwMGjQITz/9NPLy8nDttdca96LU++sLlOFi5inyPGiwy9d3p3ep+b+UlYdZWVk48sgjwftCG7S9z4wPYFtJ74As05bhyWQy6XrwwQdhtVrhcrm6yA7oxM7Mkw/1tra2MatXr36Nu66PP/4YAwcOxJNPPonVq1e/Jlti8TV9RSdJSnB4vd6a3NxcYydJL8KQIUOQn59vhH7MC+SPJReVY489FkVFRUaOD3NqFixYgBNPPBFPPPEEeL0Z3jEfi+1DpAI+/6WHjCG2devWTX/++edhtVpRXFyMgoICjBw5EvPmzTM+J5lMujo6OurMTdClh42fSx05/s7j8dQuWrQocvrpp+MXv/iFEX6kF+r3v/893n77bfC1NGLM/S7b2trGBIPBqq3Jd2F4VHoA5DHeffdd1NbWorS0tEsRwJFHHom33noL8rxaWlrG3nXXXaioqEBWVpZR7Wm1WlFYWIjKykqMHj0as2bNgtxwLF26dN2ECROM0Oinn34KPq8ee+wxOJ1OdCdSKTcFoVCoUuo80tMpq8do1L366qsYMGAAXn75ZUM6hUb+sGHDcPnllyM3NxdvvvkmpOGT6XuPkiBer7eG45GGKA3VnJwclJaWghuo5ubmcToHasuUGoAOhwMTJ07EjtoJZEdgxgewrZS7QibrM89B7sznz59v5K+sWrVqljbG+gaZMCoX6PXr1z/McJeUWpEVa9SpyvT46XGicTV37lwopfDuu++CY54wYYKxqHLsvTmGJ598Ekop/N///Z9hkHHTMXHiRCNZnmGop556Crz2GzdunCIr1OR3QS+DTCjfsGHD1Msuu8zoq7nvvvviqaeegvwu/H7/CPP9xfZo8txlaGn16tWv3XXXXdh///27GDkOhwO77rorxo0bh8WLF7eZQ6zmOSCND3NfR6Br2T3DuWxvJdMd5LnwZ3PRAg2XWbNm4dxzz0VJSYkx7pycHAwaNAiXXXaZEbZmCJm5aBdeeCGGDRuGwsJCo5+f2+1GeXm5EYadMGEC+F3wXO+7777/yeWh8cgqTSlyK6WCZFNkabz7/f4Rhx56KCwWi5GTFgqFKpuamsZnZWXhkEMOwZFHHon8/Hx89913C+WczyRlsQgLI3w+30jOY/7+2WefRW5uLl566SWwm0Omx74jkPdrJBIpdzqdePfdd2GWpdLsPWZ8AL3BaDRaZs7JMU8YWdptsVjw8ssvoy/s8DQ7FwYaZ+zrKLtG0AvAhUd6cjJN6UGy2Wz49a9/bXgZPB5PrWxMK0MAvTH+RCLhdrlcKC8vB68hFxuPx1MbDAarqqurYbFY0K9fP5SWlhrJ7OXl5XjjjTfADhhA10WWm5klS5Y01NbWGhsapRROPPFEsMckX29uBC7/lefa1NQ0/pFHHsHJJ59sGC+5ubmG1MXvfvc7zJkzxzAupZdHKvvLBtLSKOF3wtfLnLjNtUjiws3j08siJVmA9MIkDRoZ+mJHkUWLFkVuuukmlJSUIC8vzzBeyby8PPzyl7/EscceixNOOAFlZWVG0QGLkRwOB3bZZRds2LBhqhRApgGplMKbb77ZxeNqbgMjf5baSub8P4bOA4FANfP9mBIQCoUqv/zySyilMHr0aOy7775d8hQzfe/xu6axzJ9lGJjnts8++yA3N1f3utwKslJ348aNU5RSXQSDfyotrp8zMz6An5rmm6+xsXECO9VfcMEFYDcCGXYCui4k8Xi8ROaaAJ2h0p6Q4Sm/3z9ic4rFfJhHIpHyJ598ErNmzTKSn2W+lKyQ2hli+NIz5vF4ar1eb012dnaXzguZpPTAULaADyKzJMMpp5xiLFYMP1E9XeYsSc2pLX0+F83uvIEej6eWlYEytGB+bzQaLXvwwQeNxf7yyy/H7bffjkMPPdRIhqcxVFxcjKKiIsOIYLsnpRQqKysNXSfOY26EaPDI68O5n0wmXffffz8GDBhgfI7FYoHL5cIxxxyDe+65BytXrpwjF9S+stj3xvxuaWkZ+/nnn+ORRx7BX/7yFxx33HHYZ599sMsuu2DXXXfFscceiyuvvBIvvPCCYSxMnToV+fn5KC4uxuDBgxGNRsuk7IiUp5AbS4Ygt+b5JN+3aNGiCKtf6ZFOJBLuf/3rX8jKykJ9fT2cTifsdrtR3EBPI8fGc+grC7asPLVarRg+fDi8Xm8Nx8ywNtC1P+KOkmPW1tY2Rt7/XK/MFdOy8GFrVO87OjrqXn75ZVgsFvD92pj9aZjxAWwvUr8KSCcjjx07FsXFxSgpKYHc2cvwGJC+KWVehjknZkvk8XijAOkbiMYdtbeSyaRLegko/OhwOECNI6AzjMCfM31dt5X0WDDEdcIJJxhGjawUyyRl43o5bi48GzdunELNsRtuuMGorLvuuuuglDJCVnIebU3IhHMoEAhUNzQ0TOLiSa8VpV1kHg0rj6UB2NbWNubKK680DLDhw4fj0UcfxRNPPIG77roL9fX1OPnkk/Hb3/4WF198Me666y4jT4tkvo78fjgeGT4KhUKVEydOhFLKUNp3Op246qqrsGTJkobW1tb61tbWelnYwNym7oRldxZycyY9OKxclN8frzW7kOTm5uKpp54yPK/ffPONTymFyZMnA0h7HeU86emCS103ubmjmPGSJUsaZCeXa6+9Fna7Hbfddhuys7MxcOBAAJ3hcWkEtrW1jekLIU2OjffbG2+8AaUUPv74Y/D8ga7PUqnVlunxb4kMv8uepX6/f4T07La3t4+KRCLlTU1N4+V86+lnRCKR8rvvvtt4LnMO7yybpr7EjA/gp6Zs0cB2LEB6Ir/33nvIzc2F0+nE22+/bTTclTIa3JnK3Qb7aPZ0B9VdHguPDUDNmDHDMMBWrlw5h39/++23De/ElClTusgFMM9jRyfPKZFIuOfPn4+SkhLcdtttyPS4JGWydSAQqJYViHzoORwOFBcXG5pVVDs/77zzAKSNF1m519OHvQzNysX6T3/6E4qKivDnP/8Zcj7wuOZNAxXhGYacMWMGysvLDS2t3NxcDBw4EAcddBD++Mc/4v7778fs2bPR1NQ0vrGxcUIwGKziRqChoWESF7K1a9fOkNeisbFxwoUXXmjkrVVXV+PZZ5/tkh4gFePJSCRSbjZ8dwYPMGU9pKFpfo08z1gsVtra2lovw5QAFHt4XnDBBQDShsQRRxxhGEUA1KpVq2b92OcCP6ehoWHSl19+aXgzOf/5HR900EFQSuGWW25BTk4ODj/8cACd1caMJPSVghuypaVlLKMh9FqzPyKQXhtkvpQ5VN2XybkSiUTK33zzTQwfPhwWiwVnnXUWZNRHFumwonhLx+b9ePbZZxvzgSka2iDrfWZ8ANuDclKymSnQNa9s9913x5FHHmlU4dBrI2UCpHbN1oRV+D62sqHYJQD16aefQimFk046CUD6wUadJR7/lFNOQX5+Pl5//XXQKJRNdXdkUmWb34MMv0mPUqYo3fORSKScxjrnUCgUqnzppZeglMLChQuTDLtlZWUhJycHzOnivGKV4tZ4gDjXOBdTqZRj0KBB2GOPPcBQOI9v7gkbj8dLGhsbJ0hPFEV4uWguXry47ZZbbsGxxx6LPffcE4WFhcZGICsrCwUFBbDZbKiqqoLUjGM+Cc9j6dKl6/i+iRMngmF4oFPxX85rIL3Yd3cdzELBOxMZ6qZUg1nwlkwkEu5vv/12Gf9PZf0TTzzRyB3j9ZbPuE2bNt3R05AlPdP8fNkOKi8vD0cddZQh67Fo0aIIkO4UoJTC888/D3rpmI7Bz+f8y/S1lhW4cu4VFBTg17/+NYC0scax857YUfKLZbEHpVlcLheGDRuG0tJS5Ofnd9kkmgWst0R+h3vssQecTic4L4G+k0O4MzHjA/ipKXfiMlQQCoUquZuMxWKlN998MwYOHAillFGJw/e1trbW86aVrtqeVPl1F96k8GVra2s9K7Ok9wTonOysANt1112hlILsIbcz3RAPPfQQsrOzsWnTpjv6UsI+3fOsXOP8aW1treeu2mKx4OCDDwY1s+69914ccMABeP755yGP1dzcPE4m9ffk82UeD+eOUqpLSxteq6ampvGyj6X5WF6vt0a2VWKbqu4MH87zUChU+cILL+Cmm24yjDTKKQDphTsWi5VS7+/oo482FnBzA2GgUzOQP3d3vrLfZaa//20llfFlj0/5d1kB6fF4altaWsbSC8vXsKqxpaVl7DPPPAOllNGUHkgbZSeffLKhRs/3Sk//lsYIdHqC29raxni93pp//OMfcLvd+OijjwCkjRvmWCmlMHToUNx0003Iz8/HG2+8AfnZCxcuTGb62svx0DvG85w4cSIGDBiA119/HdITRuNlc8LEfZGhUKhyyZIlDUopnH/++eAG7vvvv5+nlMJxxx3XpXCHRnhPDDMapna7HQceeCBYKSyvrWbvMeMD+KnJHTobGDPxmJOJUhltbW1j2traxuy7777Izs7GrrvuitWrV79mXtgYquTxtvT5fA1L/qWX7Y9//GOX8nU+7OhO5mIWj8dLWAHV2Ng4IRaLlTY0NEzaEXIctkTu5JVSOOigg5BKpRxmGYxMksYQH0zxeLzE6/XWSO9lUVEReC6pVMpBYVSgUxbD7/eP4Fww5xH1dA53dHTUHXPMMXC73Vi3bt10j8dTS88YW8hwrstFRvZQBLo+SOXPFGBta2sbw4c1d8i8T6xWK+655x5DOiAej5cce+yxcLlcuP766yFzI3ncYDBY5fV6a8wNqRkyCoVClR0dHXXd5ert7Oxuw8ZFj4apDEN7vd6a2267DTabDa+++ioCgUA1W2Y9/PDDADq9PD2dX5QCkXOB42K+oXzWNTQ0TFq+fPn87OxsPPLIIzjppJOglMLGjRunSA9qX8hxTaXSPVV5bnIzQqOSz2QphLy54qu+xlWrVs2Kx+MlQ4YMQUFBAShVw7/fe++96NevH4DOvrb8bnvqBWTHlGuuuQbmRu6ZPv+djRkfwPaguW0MwyfSrc92I4lEwv3UU0+BYcz6+nrINktSmb2npOdEluZv2LBhqsViwZ/+9CcAnW1UmNwr37t48eK2eDxeUlRU1KUJcl8xWraVJ5xwAqxWK2SlazgcrugLD3Q+tPgQa29vH0XPw5w5c5Cbm4tLL73UaDszZswYw8iWGmXdJfT3xEsmw+vTpk1DUVERpk6dCvkaGujm9/j9/hEyPM6/0eClnEh3nizOQ5l7FggEqp1OJx5//HEA6fuovLwcdrsdjzzyCDgfeY+wz6TZGJQSFPy9eS4zLJ/p77835g9FZs1eMv4bCoUqzcYoFz52YmCiNnObhgwZguzsbCM3b+TIkVBKoa2tbYxMu+jpODk/mQDO+RONRssKCgpw4oknQlbQRiKR8quvvho5OTmYN2+eIVvCOdaXQn7t7e2jOJc2bdp0B89h/fr1DzMfTq4RMq0g02PfEmkcsXoa6JrPx7/NmTMHkUikXD6Herp+rFmz5kVqkLEKGtAG2U/BjA/gp6Y5Abu5uXkc/88Hh8xzATrDhn/+85+hlEJRURHOOuss0OWdTCZdPW1Mywcq0LljbG5uHjdx4kQUFhaCv5eTmwaZFNikh4yq9TuLJ4Fq4BMnTgR/xwdJX3ggynJ+uSC1t7ePysnJMUrBAaiVK1fOUUph0qRJXc6Fng7ZZLqnxgavQWtra31OTg4qKirAOUpPLQ08eifMvQvlbl/OM2kQUvGdYVl6TOTCeuCBB8LhcIDHPOaYY5Cbm4vp06eDx+MxZWseWRBDo0KOQeaQMaeqr0gm/JRk+Jbfo2xzZE6aloVA3BAwdE3v5dChQ7t43Hu64PIZI4stZAPx66+/HiUlJXj//fch74loNFqmlMJee+2FUChUyU0s/9YXvkOZx2b20MZisdKTTjrJkA+R3p8dKfrQ0tIy1uVyYdasWZCeQD5zdtttN9xyyy3GvAiFQpU97aWbSCTc//3vf5GXl4e1a9fOkM+WncUh0JeY8QH0daZSKcc555xj5M8ccsgh+P777+eZXyc9OrJCRy5o8meLxYJdd90VQGeIkj/LPCCGyI466qguCZrbyyCTGmjyJpaq+fIcuvN6yIXf4/HU8vdtbW1jXC4XsrKyjApSJjj3Je9IdwvLtGnTYLVasXTp0nUcM6u3+J6ePNRTqZRD7trl58nr1q9fP9jtdgC9W+xg1rDivOL3xLk8a9YsWCwWvPHGGwgGg1XXXXcdcnJyMGvWLKxatWqWFMc150NqbhtppMl8M+YDWq1WXHnllUYxklIKgwYNguw6IL36VLEHev4MaW1trS8oKIDVagXbXtHAplF2xRVXgF7/Bx98EHI+swsC0LXdWV8w2JLJpIvVwIyY7GieH4/HUztkyBDMmzcPsVisVBZqJBIJt9Vqxbhx42DejCWTSZf0wEuZIValAlAXX3yx8VyT97c2yHqfGR/AjsJAIFB9++23gy19BgwYgGuvvRZtbW1jZJKjWegUSD942tvbR/l8vpGBQKCafcHeeuutLg9OIP2QlDplQGeD9HvuuQdAp3dlexktyWTSxQdpc3PzOJkIbq6Q48Na5qQw/MWbPxaLlW7YsGHqK6+8AqvViiVLljSwPyKP0xfaInEcTLYG0nl+iUTCnZeXh2HDhhnimM888wxsNhvmzZuHrRXl5PxpaWkZS48Rd/bhcLiCCfWffvopZIJ/b4SFGCaW85aetmAwWMVKwJKSEjidTiSTSRc9gWeccQZkIQHQtShlZ/HiZpKy1ZO8zrFYrDQQCFRfe+21cDqdYLrF119/DerhNTc3j6On69tvv13GebY1hjLv++XLl8+3Wq246KKLIP8eDAar/vGPf8But6OlpWXs5ZdfDqUUvF5vTXNz8zgWTpmlhPqKrEQymXTdeuutcLvdaGhomMRx+v3+ET31IvUFKqXw9NNPd9HUlCHLe+65BzKXjnOBXlkacT6fb6T8rpLJpCs/Px/77bcfWGAmv/tMn/fOxowPoK+zvb19FB+E4XC4IhgMVs2ZMwd77723IdxaXl6Ou+66ywhpyp59fK/54aOUgtyRtLe3j5LSBK2trfUffPABlFLYc889cemll4J/Y3HC9jh/PtDNeS+8Hjw35iqZQy2xWKxUtm3x+Xwj+ZBXSmHIkCHgdSJZsNBXbnhz6O6MM87ooskTi8VKbTYbBg0aBKlzx1DSD1F6ROX3T4MsEomU5+XlGXpmclHtrX5y0Wi0TBrR69evfziRSLiZz7fHHnsY59vc3DxOKYXf/e53MB+Hlajy/5n+7nZ00nAxX1vS4/HUqv/faglI50Wxd+qSJUsa+P3K77on81Kyubl5XDQaLbv00kvhdruN40rPl8PhQE5ODthFwGazga8BOsOiQKe2Xl9ISWCXAaXSLa04Z2VOZl8mr2tOTg722msv8PeUKInH4yVOpxPz5s2DDMfKoiI+22QrrWg0WkbHgFIKL774IvheYOeWpckkMz6Avk5pUMkd05o1a14EoK6//nrssssuhhK52+1GdXU1/vnPf2LJkiUNNCq8Xm8NNalSqZRj7733xooVK+bKh1IkEil/5ZVXwCa/drsdBQUF+Oijj9DR0VGXSnU2NN6ezV03bNgwVS4G69atm84KuTvvvBNnnHEGBg8ebLThsdlsRoh3jz32wLhx4zBz5kzDZZ5MJl1/+ctfjEWelUG81pk4x82RY6CoMPsI3n333aBg8O23394ld0fOj55QdoVIiR6N69atm67+f/si/o6yBFvrhdsS2W6F85HHf+CBB1BYWIjZs2dDtoJqa2sbwypLFquYvaV9YcHdWSg3LOa/hcPhCqvVijPPPNO4x/Lz843qSHp5zffTqlWrZm3pc+UmgV6y/fffH3Iczc3N4wKBQLXFYsGkSZMQCASqBw4ciBNOOAFAelMnBVj72rxIpVIObn4/+ugj49z6UtrElnjuueca+awMUa9du3bG7Nmz4XQ6wY4wQPp5I6t3ZRU55TH4/8svvxxFRUWG7h1zYrUx9tMw4wPo65Tl0DLZtruHysyZM3HooYfCbrcbSuVZWVlwOByw2WxgmOvII4+EUgq/+tWvkJuba4RB5c/nnHMOFi9e3CZlO2QuyfaK37NMmh6wVCrlmD17NqiLxrL4QYMG4eSTT8Z1112HG264AX/4wx9w3HHHobi4GFlZWUZPRIfDAbZmuf322wF0GmB8+MsG2X2Ne+yxB+x2O6TMhM1mw2GHHYZgMFglDaeeqpXLIgbpQbzttttQVFSE1atXvyYTrmn49MaCIRd5c+7Xt99+u0wphWOOOQZ+v3/EZZddBrvdDoaWNxcypVdH55j0HvnMkYaZbOt2/vnnw2KxYOPGjVNaWlrGJpNJV3Z2NnbZZRcAnZ4UztGtKSqJRqNl/K5nzpxpSGxIb1I8Hi9hq7Cmpqbxt9xyC4qKivD22293q/PVl8jqw7322gs5OTlGxXRfCKluiTRwQ6FQpcPhMNJaaJSdcMIJcLlcCIVClXxuSGNKGunLly+fz599Pt/IeDxeopQyojNmD1umz31nZMYH0NcZj8dLzLkEFN5bu3btDK/XWyMToOVkX7du3fQXX3wR11xzDU488UTstddeGDhwIHJzc7HXXntBKYXjjz8eF198MW666SbMmjXLyAFgnoWUgiC9Xm/N9lrsaBykUinHxx9/bHi+lFJ48sknAfyv7hWTu4PBYJVMIn7ggQfwm9/8BqwO+/Wvf42FCxcmW1tb683eFYaHM/39A52tY+bNmwe73Y5XX33VeGgff/zxyM7Ohpwv/LknwpzcnZoN/E8++QROpxOHHHJIF20h9tDsrZCPPA6TgDnuQw45BFarFZyPJSUlqKurQzAYrGLSb3fVgDuLqGtfoDS+pFFm1scDoPLy8pCVlQXK+vB+ZYWd9HZ19//NUaZgpFIpx9FHH214hKUnuLGxcUJBQQEOPfRQNDY2TrDb7dh7773B5wHfvzlPXybI8Xu93ponnngCNpsNn3zyCfqaF++HyG4Xv/71rw2RcRpkTqcTp556KuQGyVzFznxEzjfZOWX48OFg2orZiO8r3+HOxIwPYEegLPMG/rf5rGyvw//LRH9pUKVSKcfXX3+NOXPmICsrC1z82FKJr6ExIkNTK1eunCPdztsrpPfFF1/gpJNOgt1uR1FRkaF9RJkE6VkJBoNVoVCokjerlBgJBoNVa9eunWGxWFBXV4fs7GwjR+7555+HuVihL1RhySpTl8uFwsJCtLS0jOWCmJ+fjwsuuAA8v1gsVur3+0fI9/V0fvG7b2homHT44YcbeUG8hvSUAb0X+pG7XllI8sILL0Aphc8++wx+v38EPaHmnTF7F1LmQDcd7l2apTDkPOGzIBqNlrW2ttZv3LhxSn5+Po4//njwdVdccQWsVitWr179GsWsueD2xAPE13i93poNGzZM5ffsdDpx7LHHAkjf2ywMmTNnDpRS+PDDD418sgceeADUu5NzJtPXluTzvKmpaXxBQQGys7Oxo/RqlM4CilIPHjwYANTnn38Oq9WKd999F/I9Mg9VyljE4/ESam6y9RtzxwKBQDWlbLgh7EtaczsLMz6Avk7qTwGdVSXSSJIuePnQMUtf0PPA33EHeddddxneFq/XW8MHFZNNKSorHw7si7k9zj8Wi5U6HA7Y7XY888wz8Hq9NaFQqFIm6vNf845Jtt/hdZFaRZFIpHzRokURhmntdjvee+89mA3gTLO5uXncrFmzUFRUhGeeeQY83+OOOw5Op7PbEMfWtH+SXlWv11szd+5cOBwOPPfcc5C7V/P30lvfr7zWzFW0WCwYOnQogHR+isvl6pJHYvaCmb9//cDuPW4uBGz2TANQl156KbKzs7F8+fL53CAwtQDoNO57em8lEgm3DMNzA3b11VfDYrGgqalpPI/Jjefw4cNht9sRi8VKDz30UOTk5ADoDI/1FdFnkgLJ0Wi07N///jeUUli2bNmKTI9ra0gVfuadVlZW4sQTT4TD4TC6Z3C+yHnE74Fi40D6Ge10OvHvf//b+N7ke+R8yPR572zM+AB+DpTGEx9a69atm37BBRcYrn+ZdCkrq7bH+GTugLlnI8OTTPZkGfvWyBokk0lXc3PzuMmTJ8PpdIKdBxiWTCQS7k2bNt3hcDiglMJuu+3W5YHIPn9AVy9lb7jMGd7h/6U7n54feoiGDh1qGCUdHR11DocDd9xxB+gNk6FkWWL+Q5SGG/POZO7PT01ZNcV2PQ888AAGDBiAdevWTW9raxvD8+Qmga/dmutPpX9pCJilU1j9x0pb+X5plPr9/hGtra3133333UKPx1MrK06pbs97TQrnyt/xu5fzgN+/rAzu65SaUOz24Xa74XK5wOvd0tIyNi8vD2effTZ4vXgtGAbdHHlduCnke+mNY7ie3yEXb7vdjmuuuQZA+hny17/+Ffzu+Pq+sOHihoTtuzhe5oTKeWNuOdRXDBJeRz5//vOf/xjRh4kTJ4LfG4twpOivjLSwld+AAQPQV3qR/tyY8QH8HCiV+Jubm8fxhl6+fPn8goIC7L333gDSNxa9LdvLu8BxrVu3bro0TDweT63FYjF2t0BnBc7WlM1v2LBhKh9cOTk5OProowF0VZNn94FEIuF+7rnnwMrCc88915ASSaVSDiaT80HZWw902d+Ngpfy748//jgKCgqwYMECrFy5ck48Hi9h/z5ZqSZFFremKKGxsXECjeAzzzwT/fr1Q2Nj44Se5vhsC5kYzlxB7rB/+ctfAugUGpUacTRWe7Igmb27ZjIfTY5HGqmBQKD6qaeewr777mvkLmZlZYFVhJwrSikMHDgQhx9+OO68804jrCxFUOV8kaX+9CCYizD6Qsh8SzTreUWj0bJFixZFpG5hNBotu/baa6GUwvr16x8OBALV3BhuySCTiz3QVaZlxowZKC4uNjo18Ho1NTWNP/fcczFw4ED4/f4RY8aMQVZWFoDOat5MXzd5vfgzPfp/+9vfjHQBr9dbw+eiueilL1Qadrdx93q9NXV1deAGd+jQoXjwwQe7pBukUuletAsXLkzyWbbnnnvi4osvBvPqtibtQrN3mPEB7Oxk6EZ6duQD6eabb0ZRURH+9a9/dRH12xrZhG2hDKMCncUEhYWFsFqthsGxevXq1/gaGgo9bR/17bffLquoqIBSylDwpgdE5o1JL8XEiRORk5MDl8uFt956CzRwKDDb2yEPJkhLrw91lmiUyNfbbDZce+21xu/oOeKxeprft27duunSWC8tLcV5552H7R3S4cP6mWeegcvlAgB19NFHIy8vr4u3sqOjo84cwugpk8l0/0yPx1MrE8XN7XoAqHnz5mHPPfc0dvpKKfzxj3/E66+/jvfffx/ffffdwlgsVrps2bIVn376Ke68805UV1cbrx04cCAcDgdOOeUUYw4z1Epvx+aEUleuXDlna7W6MknqRnEeAmm5AlY8Mh9KKQW32w1+DzRAfoh8VkkDTm42eL2TyaRLpnLw804++WTwdWeddZZxvzQ0NEzqCwYNkH4mm2VklFKGbAfvZc4Z3pt9Jamd300ymXSxwbtSClOnTsWHH34Il8sFi8WCvLw8o5pfyhMNHjwYo0aNQnt7+yg6BPpiNezPgRkfwM7OzZUKh8PhCk763XbbDQ6HA7yxKLy4vSh3gdFotGyPPfZATk4Ovv3222UA1NKlS9fRaKAhJYUet3T+sVistKioCLfddhuATq/c+vXrH2boy5x/1NHRUbd27doZubm5yM7OxoUXXgi/3z9CGjo9NQh/iDIswYVL6oI99dRTcDgc2LRp0x3ssnDwwQd3aZHEJt7ynLfWe8eecxaLxZgHMpT8U5F6Yhy3Ugq/+c1vAKQrtO677z50d70pddCTz2ArrM15yuh9aWlpGfv2228bO3suKrwe1NPi55pFcuXGYvbs2TjxxBMNfUClFG688cYuEgxsns1z53fMv/cVg6EnlBuCdevWTY/FYqWsZGZVODX0DjvsMACd+YI9CVn6/f4RvE+j0WiZbIGmlMJVV10FIL2x4vdTX19v5LNNmjQJ+fn5WL9+/cN9JdQHdPZOlfMagJoyZYrhUeS14rWQ55hpspCKKRJsBcX8TwDqq6++QjKZdC1evLht4sSJGD9+PP7+979j9uzZ4PcpvcHcnO4Ish87GzM+gJ2dskWF1+utkRUtQHr3tXHjxiksWeei5/V6a7aHa1/20QwEAtUXXXQRnE4nPvjgAwBdq3hCoVClzNXpyfEjkUh5UVERlFJoaWkZy+RSGR7ig729vX2UHA+Q3v1ffPHFYM9LGlC91dbEfI2Tyc7G8dTh2X///SHPuaioCDfddJNRfCB1vKQ+WU920MzHeu+992C32/Hhhx8C2L5tSRg+Xrx4cZtSColEwk2DaNWqVbMoBinbNskuEz9E5q90J4siH/rffvvtMmrb5eXl4fPPPwffD6RzlujFaGtrG/PNN9/4vvjiCyxatChCgzIWi5WaczEBqA8//BCHHHKIIbb829/+1thsyO+IOVU7UoNpXpNkMumSnkufzzdy9uzZhtgp59QNN9yA/Px8Iyy1JYOMn0MjxBza93g8teeddx7y8vLAayY3m/n5+TjyyCPh9/tH5OXlGeK19FRm+vqZv+fW1tZ6bq6sVit+//vfA/hfCZu+kgMHdBqRXq+35rbbbkNubi4+++wzsMWdrHRnKzTqjJkFv+PxeElfqnL/uTHjA9jZyV2lWTPILHUQiUTK6UIG0ovO9rohYrFYaUtLy9hvvvnG53A4cMkll0Dm3DQ0NExqamoaLxOIga7Vpj9EpRSeffZZyM+LxWKlDD+aw3synEUuX758vs1mg8ViMbw2vbHTlto8Ho+nlg+oeDxeQgHbr7/+2gghHnXUUVBKobuHsbndU0/yyGjksCsDF1WpB/RTUhq2Rx11FAoLC7FixYq5ytTai0YmG4lL46ynDIVClVKXDkgvAuPGjTM8Yl999ZVxDXg9fT7fyJtvvhkDBgwwxIXz8vKQk5ODfv36GaGXAw88EC+++CJYnGD+fPZ+ZEjz6KOPBrsMpFIpB8OUvO92BA+ZuVBC3rMA1ODBg5Gfnw/pdVf/v2XZypUr52zJIDPnfEl9RN4/DOsfcMABkGMLBoNVN998M4qLi+H1emv+9re/GeFNoO8kxQcCgWqv11sjxxMMBqtqampgtVqNe59FN31t/LFYrHTNmjUvtrW1jSkoKMAhhxxi6Khx7GwmLt/HTVFfOQ9NbZBtFzJcIye+3+8f4fF4altbW+ulV4gJytsroTKRSLj9fv+ISCRSrpRCaWkpgPRNnkwmXXJnuGHDhqky36cnN/KkSZPgcrnAMAfQtVJTLuotLS1jpRHS3Nw8zuPx1Mpw6vHHHw+bzYZDDz0UvXX+QPrhRA8dAPX999/PGzJkCA4++GDwda2trfU5OTm44YYbwGvABZ3JznK33VMPwGWXXdal9RKvz/bw0MiedIWFhbjqqquQnZ2NAw44AAxlLF26dB3QtXdhPB4vofjkD5HzyLywezye2q+++grDhw+HUgpXXnkleF8w12v58uXz3W630ZZr9913x3333YcFCxZg48aNUwKBQPXixYvb3n33XVx00UVGdwyr1Yqqqip88sknkKF1LkgbNmyYeu2118Jms8HpdOKBBx4wrn1HR0fdjmCISZq9qTQsA4FANcOUDzzwgPFM8Xg8tYWFhbj66qvRkxwy+b3J/DP2sAWg7rzzTuTk5GDVqlWzzMUR7DwCQNntdlxwwQUA+oasjczvTSQSbhnF4NhfeuklAOn7mbI/mR43ScPb7/ePKCgowO677254P6UhyTUoHo+XeDyeWob/gfTGQ7ari8VipXymZfr8fm7M+AB+DpSl1dKrJHWEZDsapRT69++P5557DttjfBs2bJhKuQmO06ynRm8Py+v5ty0d+9RTT+1ibNAbFgwGqxi+NHvEPB5PrXzoMRQIpI2VadOmoX///v/TP/LHMJlMuii9AaQNjY0bN0557733jJAdDeZzzjkHBQUFMMsiyOtAgdWeepC8Xm9Nfn4+jj76aMjz3l6VaFIQVimFTz/9FLm5uXjkkUcMT0Y8Hi+hUUzD9Md8Dq/TypUr57CXqVIKNCC4+LMXIv/+yiuvQB7D3D6I84kG8H333Qel0g2uLRYLHn30UQBdK2j52gMPPNDwujFMCkDtKGX/XEh9Pt9I2TOSns9UKuX4/e9/30XUN5FIuM8880zYbLYtGmSyI4C52lBuZrxeb43dbjdCl9IomzBhAhwOBzweT+0VV1wBpRS21/zuCaUBzmvE0LXFYsGIESPQ2Ng4QSb3y/zDTDOZTLp+85vfwGKxdCnAYToEvy8pVSPTLXhe/L7N8h6a248ZH8DPnVJ4kVy1atWsc845B0opHHLIIeDv5QPAnFS/uXYkMn+AP7PqzO/3j5g7dy4KCwu7VWHvjTymAw88EE6nE1IrSj70enJ9gM6HIBeIr776yuijycVHjl8aQ6lUp2Yad5SyFYx88PAYTqfTSIyll5CVfnxfT3bKMqcsFouV8vODwWBVNBotO+GEE4xrzzFL43B7zMFwOFwxbdo0FBcX46mnnupSsGBW8pdzUXpIgLR3yev11jBHSHqkeF5ffvklbDYb+vXrhwsvvBD8PQVHzzrrLEPSgnmMPaGc/wz3rlu3bnpRURHy8/Phcrlw2223gV0k+NpQKFS5bNmyFfRMjx8/Hrw35BylfhPf19Oilr5CpRSqqqog88Bo8Mq5KouPehIyl8bZq6++iqysLHz++ecwVywrpXDUUUcZ+Ynjxo0D0LnoS20sWckp7135vGhvbx/VG1WOskKRqRQyVeSaa67pco0ikUi51B38qb833l8dHR11fB7TMx0KhSrD4XAFw/CUH9GerR2XGR+AZvphL5u/JpNJ13//+1889NBDcDqdKCoqwiOPPIJAIFAtE6HXrl07IxgMVpkfflwQ+bqNGzdO4d/4GWvWrHmRpfFFRUWQr+MDpzdyCy677DKjH2IqlXLwYbd06dJ1PTm+FPoEunoSAaiCggIwrMBj0/CjlIYs4eZDlIsyH2p8XyqVcjz++ONQSnVJfB47dizy8vJA+Y+tze+i98VczaSUwuTJk8EqNmD75i6xVcoll1wCpRSoAwekvSxyLNxtMymf8yscDlfI68HwrQzZRiKR8uOPP97oY8rvke9raGiYRAPhL3/5C2KxWGlPQ77SkyPnDY+9evXq14YOHQq32w2r1Wp4nnkv0KC/8sorjYpMGlycZ7wnwuFwxY4kicF7Z+bMmbBarfjyyy+N3qgffvgh+vXrhylTphiVrLw/tsYLyuuRSCTcNGx57Rl+njx5Mux2O+LxeMmVV14JpZQhZSONW6ZCcJ7x+wXSRhg3r4lEwt2TkHlP5g5zDs1tvyKRSPlHH31ktFKSecCyg8tPTZkmwOcHrzmrQadMmYKWlpaxvKa6SnLHZMYH8HMnd6Pt7e2jeLPL8moAiuG5gQMH4rnnnsOWHpbSOJOq6nyYvfHGG1BKobi4GGPHjjXUu6XHg4rl23p+bN3yj3/8A0D64StDJz29RrJ3IxeZVatWzYrH4yVFRUVwu90YNGgQ9t13X9x0002Qx/d4PLXyQcu+ofxdY2PjBGl4UKdHXkullNEjUOZSbYnmRvCtra31fGjuvvvuKCwsBPOmOGZzGfpPzZaWlrHDhg3DkCFD8OCDD8Jms/1P7lV7e/so6SEi2d+OnoXW1tZ6LurUHJszZw5KSkpgs9nwt7/9zTDGWDRAY7C0tHSrcyfl4k0vm/k+4Hfl9XprXC6XsQn58ssvjXCp3+8f0dzcPG7lypVz3G43+vfvj//7v/8Dz4Nzid5SGerpy+S91tzcPI4VrEBnQU5JSQmys7ONEOLq1atfk1IXWzo+NzvJZNK1YsWKuRs2bJhaXFyMF198EdJ44T10xBFHwOfzjdxzzz1x2WWXAYBimC2VSjlkkQnvA7kho6Hdm9deJryHw+EKn883ks9Bj8dT63Q6sXTp0nXydb0hudMTchycd8FgsIpe9n/+858oKCjA6aefDrnpNgvYau44zPgAfu7kw4YeklgsVsoWKCwfb29vH8WFwmKxIDc3FzU1Nfj6668BpI0emYTJkvK2trYx9PJ4PJ7av/71r8jNzYVSCoWFhVi+fPl8Llbff//9PI4pmUy6qB6/refX3t4+6g9/+IORNyJDPj15qEovid/vH8HFvqGhYdLkyZONPCMu+FlZWXA4HLBYLPj9738PeoBkOTd1sWjoSSPjySefhN1ux8KFC5P0vDz22GPIysoy8jN4XXoinig9RdLw++STT6CUwsMPP9wln4aLoGzQ/lOSxtF+++2HqqoqBAKBagqKhkKhSnNCN68f891kyNLsyVy4cGGS7XUKCwu7dDWIRqNlzJccOnQoRo8eDRp1DFtt7bmweMBsmDU0NEySc/mzzz4zBDHPPvvs/8ln8ng8tUcccQSUUhg2bJjh7WGYlp7VviIMuiXSuG9raxujlMLrr79ueJPppf3d734Hfoc8r56G5MzhW96T1PjifXTrrbfCarWio6OjjoUs5rQIc4hceoc8Hk+tlBHqDQ+ZTOqXuXNSyDsnJwcff/yxoWEnc8m2x/dHjTkaXR0dHXX33HMPlFL47W9/CyD93JAb+Z6mVGj2LWZ8AD93MnQmdzPm5s0yz2Ht2rUz6urqjBYy3PVWVlaivr4e9913Hx588EHccMMNGDNmDPbdd184HA7YbDYUFhZiv/32wyeffAJ+ls/nG0mjTVY/9mZzXa/XWzN06FAopRAKhSrZgqmnbG1trZcPv2Qy6aK22cUXX2ycy1133YWcnBwcfPDBuPfee0HdIy6o5kTccDhcweNSo6ekpASFhYUAOvvyKaWw7777gteLJfI9MVhZuSkrnoB0tZnT6QSvD9BVpHJ7hhxCoVDl7rvvjn322Qc+n28kZSRSqZRDGsRSlJVkGF169R599FFkZWUhLy8PVqsV06dP75JQ3tjYOOGdd95BXl4eHA4H5s6di3A4XNHS0jJWLiI/JkeHSck0ymRBCpD2qtI7xNybrKwszJ07F9IzEgwGqz744AM4HA6UlJRg48aNU6ThsSMZZOzHmkqlHL/61a+Qn58PSrx0dHTUXXjhhbDZbEYRRyAQqO6pzh+vLV/f1NQ0fsOGDVNLS0tx9913g6/jdzt48GBcfvnlaG5uHldQUICjjz4aoVCosrW1tV4axtww0TCTXR1kTua2Xhvej9FotEzON1bBL1q0KOJ0Og0JGFngsj0MMnpw5XPh/PPPh1IKV199NczfEw1cs26a5o7BjA9As/PhLh/wMpTJhVouVrFYrHTTpk13XH/99TjppJMgq9IkBw0ahFGjRmHmzJldEseBzps3HA5XcNfX1tY2xlyJtq30eDy1CxYswODBg40eiWZx2M0xEAhUezye2kgkUs6WSaeccoohfsgHKo3KL7/8EkopVFZWgj/fcssthm4YPTMMc3GXnUqlHMuXL58/ZMgQTJ8+3QgL//e//4XT6cTHH39sfJYUW9wSZSiSns+33noLNpsNixcvbpMeQ1ndZJZJ+Snp9/tHmKthOX/OPvtsI7k+lUo5Wltb66WngvP35ZdfRnl5udFXsqioCDNnzgTPXRrCBx10EFwulyGxIgtOgHQuo8w3/CHyezSHKnldOZeXL18+3zyfmQs3aNAguFwuHHjggcb50/jy+XwjeS1effVVAOnczR0lHCRDa16vt2bt2rUzrFYrbrzxRsMAa29vH+VyuQwPKZB+vnCD9kOkcStzCMPhcMX+++9v5InxuRWNRssuvPBCY57dfvvtcLvdXfTumNMpPf4UoOXf+XNvtfehx5PnTTkbAOr888+H3W435oWMaGyv75CRk3A4XOFyuWC1WvH4448b3kV29PixLc00+w4zPoCfO+k9oZeMnjEm6/N10Wi0jA9Lhoz4t0AgUC0TOs00L2wy/6m1tbW+o6OjTt7I3JX1Rlk3d2rxeLyEUhL0QPVkUZO7dlakMhGer2GiPduyfPrppygsLMTf//53nHHGGSgtLYW8XlKclAuW3+8fUVhYaDRBJpVS2GWXXWCuho1EIuU9qbSLRqNlVI+n1ys7OxsDBw4E0LmocKcrPQDbw0PGOTNv3jy4XC589913C2m41NfXQyll6HsxvHjQQQeBqvqkzWaD1WrFDTfcgEAgUM3zklWlb775Jux2O5RSuPfeeyEbere3t4+SYZet2eHLZGeSBholVaRQZjKZdFEolfcbC2iUUpgzZw54bZi8feyxx0IpherqavB8dpR+f8yL4v+PPPJIwyiiUXrnnXciKysLa9asedGcVP9DZIoF7yU+S2KxWKnVasUll1wC5qPyO8rKysLxxx+PVCrd77K8vBxffvklZFN5pmysXbt2BgD1yCOPYM899zRyX9k4fVtJYWq5GeJzdvny5fOVUrjwwgsRDocreF7A9qmwlNd41qxZRm/fJUuWNDQ3N4/jBomvk88QYMerBNbUBlnGydAKwyt0z5sTwYH0w0OGymS+g8yD4A6Tx+AO1Pz+7mQWZPJobxkEXJRTqZRj3rx5Rq/CnryXu75YLFYaCASqzz//fBQUFBhJrNwlDhw4EBaLxQjjKpXug8hk5u4aCNPwoZfM4XBgypQpRq5be3v7KLfbjXvvvRdyPFLXpyfnIBea2267DUoprFu3bjq/H9loubm5eRwN1e1RbUnvABfH0tJSSLFYhsmfeuopnHvuuRg2bBiKi4tRXl6OU089Fddeey3eeust4/pw4Te3ZHG73bDb7dh1110N5XMZHgQ6vSzcnPR0t9+dkKVZp4xGsUwPkIsZ7xFqkt18883gcbhI33///SguLjbCuTuCwjnb5PA68Vrn5eWhrq7OyIuigOzee+8Nc27glig3i1SzB6DOPfdc4z7n5jISiZRfcsklsNls4NxQSuHDDz8Ew6qySAPoLEI66KCD8Oqrr6KyshI5OTl488030dMx/tDYgc6cNRo1DQ0Nk/bYY48unVP4Hv68PbxRkUikfMSIEVBK4Re/+EUXb6Kc37KQRv6ruWMx4wPQ3LkpE6xZQffFF18YGmJ8UDOnJZVKObgrlrt0GpmFhYU4+eSTuyRiK5VWZ3/zzTexdOnSdbNmzcJ7772HVCrlaGlpGTtkyJBue0RKw4NCpTL5v7a2Flar1SjPp0Er37+l8zcnvdvtdhx66KHoK7tXenlaW1vrv/rqK9hsNvzqV78CvzuzYURvB1W/pXEqpQACgUD1okWLIr/85S+hlOpStQh0huIzff5A1z6Z33333cLRo0ejuLgYLpcLMtza0dFRt3z58vls17RgwQJjHspk80yfjyS/J15znseoUaMwYMAAAGkjOplMut5++20opfD999/PM0vpyHSHZDLdkLonHm6lFGpra8G5I39fX1+PZDLpqq6u7rJB4/Wmx23YsGFQSoFVvuFwuKK4uBg2mw3MF6QBx5/lGMzeLI6D9yYrZplrB0D169cPSil8+eWX4HWTyf7y/dQyZLs5swSR+ZnR3e/4XOJ3AUDdeuutUEqhX79+mDx5smE8b0/JDc3ty4wPQHPnZzQaLaPnjVWPQGebKGp0yZCr3+8fQfFU/i4QCFRnZWXh7rvvBqvxVq9e/Zrb7cb3338/j2FBetR8Pt/I9evXP8yKLzkmKYDp9XprLBZLlx5wXq+3xul0oq6uDvI8+LNUwN4Sm5qaxsfj8ZLRo0cjJyfHyNPpa4t3IpFw33PPPdhll126KORvrupRVsDxd2+++SYOO+wwKKUMo1u2JmppaRnblxTAu1MsTyQS7mnTpmHXXXeFy+XC6tWrX+PcZDVyTk4OCgoKMG3aNEM6g9eot2UZtpU+n28kx8/NTjAYrLJarUZrsHg8XtLe3j7K4XAgPz/fMDRZ6djdfO9JSsOVV16Jfv36Yf369Q8nEgk3++JeccUVhmA0u0RQfiMWi5VKb7ZSna2XeK2ff/55Q99QXnsaoCwyoUebYrPm54AsmOI5Z2dnQ6l0L1cZjQiFQpUyvMm50t29QU8sxyEjIfRssQCFRVxA+hl38803G2kCp59+uiEFs3r16te4geouTK+54zPjA9DcucmHnPQINTY2Tkgmk64NGzZMtdlsGD58OB5//HEAaUNHKvmzjRN3xkopvPHGG2BO2b///W9DrV8+lGnssCIVSHsGpHQDkN7lfv/99/OUUpg/fz744P7yyy9RUFBgJLTLELDc0W6JTU1N4/lQz83NxYUXXgiv11vDvLdMM5VKOZqamsZz0QCgFixYYMijWCwWDBw4EDU1Nbjrrrvw+uuvY+bMmZg+fTomT56MUaNGGQUlDofD4DnnnIMvv/wSDKfLqlHmTfaF1jMMdXLxlmOSumVvvPGGIZ7K1xx66KFQSuHwww8Hf789w809oTnnSYbH6+vrYbVau6j3v/322xgwYABWr179Go0iaXDLgpaeeMgikUi51WrFhAkTwPnGcVksFlx33XWIRqNlS5YsabBYLDjppJPA91JnkGLCvP5r166dEYvFSrOysuD3+0e0t7eP6ujoqPshQ59dJxoaGia9/fbbmD59OubOnYt58+Zh5syZmDlzJmbMmGE0que58nkg73cK69L4o2eO11EafZvz2rFQizqFjY2NE0aNGmWIF7PApLvQI0PPfWljo9k7zPgANHduyhwWmXtBg8Tn842k2v6rr76K5ubmcebihLa2tjFSoPXuu+8G856i0WhZbm4uLrroItCTQ0/ZO++8A6UU7rnnHpgfbPyMeDxecumllxpCsED6gXfVVVdBKWVUZ3Knzc/o6cOQnpLDDz8cZk9dX9nhymsjVegDgUB1bW0tKisrMWDAAOTm5hpVlGRBQQFKS0txzjnnYNasWWBy/uY8RDSye6MtV2/OUekJYZUrkA5nVlVVweVyGcaCDIFRXiUnJwecT33F2Aa6GoY8x1gsVsqqZIvFgoMPPhihUKiS56WUMiRZzMcIBoNV/O564iFOpVKOgw46yLiXKLIbj8dLqE/Iz5g8eTKcTifGjh0LeYxPP/0UDocDF1xwAZhT+vnnn0MpBRkCDAQC1Z988gmuueYa7L///oaXyeVyGYaWUmmB7by8vC7z2O12G7mtHC8Leg4++GBMmDABS5YsaaAntaOjo475uuYQJb1i5jxDeuFYLR4Ohyv++te/gs8/pZQhlivzedevX/8wvwNZvNVbVfCafYcZH4Dmzk+66GV1I9AZ/tmwYcPUk046CUop3HTTTUZIjzt0WalptVpx2GGHAej0ct14441QSuHMM8/E559/jkWLFkXGjBmD/v37o6KiAn6/fwQLC2SyOh+WSinU1NRAKrIPHjzYyLGRXjt+5tYkdDNh+sEHHzSqNftKuJIGpwwRNTU1jQ+HwxXM2fF6vTXMWzEvMg0NDZO6M65oeMleqps2bbpDLiJ9wUNmbmLPn8PhcAX18pqbm8dddtllKC4uxq677or29vZR0ou7aNGiCBdUSkVsbWL8T0neP9TQk+c9fvx4uN1uAGlDM5FIuF966SXYbDYsW7ZsBXW3ZL7V1vSiBdI5o0opyDlG8erc3FxccMEF4O//8Ic/IDc3F2eccQba2trG8H7785//bFRoH3/88YYHd9CgQcbPkkVFRfjFL36BP/7xj5gwYQJmzpyJtWvXzli+fPl8Pl9kgYPD4cCdd94Jj8dT+9lnn+H555/HtGnTsNdeexnVt1arFVarFS6XC8cccwwmT56ML774AsuXL59PA8187vF4vCQYDFYtW7ZsxcMPP4xTTz0VAwcONI5FA3D+/PngvSc3MxRu5ncWDocrmK+W6Xml2fvM+AA0d27SGEulUo5gMFjFMnlWNvIhnUwmXUysr6mpMZLepVp8W1vbmMMOOwwFBQWQxwagbr75ZuOBzZ3xH//4R1Cjh5QPu3A4XPHtt98uU0p1UfSPRqNlSimMHTsW8Xi8RHrDuvM4/BDj8XjJAQccgOzsbEjjRSqiZ5Kyaksm2svFxdy03SxjQDKU8kOGFoVh+4pwpewPy4IOqee0cePGKczbef7556GUQn5+Phh2TSQSbn6XXNjfffddANtXq2pLlMUHspAGSG9IKioqwNc2NjZOKCkpMTQD+X5pePc0qZye7NzcXEyaNAk+n2+kzEc7++yzYbfbISUlxo0bB6UU9tprLwDp0CXn5NVXX23c33vttRf22WcfnHXWWXj88cchddNCoVAlvzePx1PLjQA/NxAIVC9dunQdq7L/85//GOfKxHyz6GpjY+OExx9/HEcccYRRzW2z2WC322Gz2YycSRpvfE12drYxZovFgqqqKkydOtXolWvW6aMGH8fPTRyvTywWK+0r949m7zLjA9DcuUnZBKBzMebfaKDwYeTz+UY++eSTsFqtGDRoEICuxkAsFit98cUXkZeXh6+++gpA+uElCwXWrl07w1zB2NjYOCESiZR7vd4aGaoEoK666ioUFhZCNg4G0kr6V155JcwPSy7cPVXqX7Zs2QqlFB577DHwd16vt8ZcsZlJbtq06Q6q7cuQDAWDN2c80tCmEWPOKaIEAnNrNtcmpy/Q3Fg6EAhU06sKQC1atCjCMSuVbtW1YcOGqTxn6puVlJRAKYU//elP2B7j3hJ5L0jjoqGhYZL0+D7wwAMYNGgQmpubx0UikfKWlpaxDz74oFFxyffJnrA9DTnTu1xSUoI99tgDckNEgyMrKwvXXHMNpBdbeh1/+ctf4pZbbsG9996LsrIyKKUMeRr5/dFolPNVboC4+Vi9evVrY8aMMSoYzXpysoJYitQyRUJ2/PB6vTVr1qx58ZNPPsELL7yAhx56CPfeey/uu+8+PPDAA5g5cyaWLFnSwLHG4/ESea/IJuxNTU3jeVxZ0cpNYDQaLZPPNrOMj+aOz4wPQHPnJh8wXBBSqZRDGmV8MMkF+4033jAERIH0Q0mKHiqVbhtifjjxIRaJRMr5sJL5PtK7xTEole5XKNXx/X7/iKKiIowZMwb8TLOXzLyAb46FhYVwu91gb1DmupjHkylKrwKvldmzw9w5Lnpc7Kj/JY01WUXW3eclEgk3Q6CZPnfOFRaN0EsjPTh+v38EvyfpTWT+HLsRyDl1yimnwOFw4Nxzz8VPOfatpez2wXwmel2UUjj//PONKuOWlpaxTqcTN910k+F5kt9ZT0VxebxDDjkEubm5oLEjK3Srq6tRWFgIKRnBv99xxx1GbhcLTD744AMjX5QVilu6F3n/rlq1atZee+0F5qLKvrTJZNIl81zlBkN2+DAfk5uzzW3Q5N/5fnl8j8dTKwuGpGByd5sWc8cVzZ2HGR+ApiYp26J8+umnKCgogNVqRSwWK5XVihdccEGXBHlW7LFikMfjscxJyPy3tbW1XillCEzKEFxBQYHRUYAitBs2bJgqFeDlos3PkVVt77//PpRSWLBgAYDOhz4fxH3JQ6TZPaUcAucMkFZx32effaCUwvPPPw/OK3rN7r//fiiVVqEHOptj4//PS5nLaP68zUkp/FRcu3btjFtvvdWQoaA3+ayzzjI2RS0tLWPlmGiQ8d7i+8xV0vz36quvNo7l8/lGMjWABmJWVhYuv/xytLa21sv7ektjN7fOYlcCc+useDxeMnnyZCN0uGTJkoYdpf2V5s+HGR+A5s+boVCo0tzAmg/X5cuXz8/OzobVasUHH3xgNKjm7v24444D0BmS5DHoqZD6PkB6EeFC0tbWNubBBx9EcXExQqFQJQ25jo6OOr/fP+K1116DxWLBypUr5ySTSZf0GskwFXNkuABI6QOLxYIDDjgAixYtikjdM9k3L9PXX3PLlOFpyq0AUCtXrpxDzbW//e1vxgaBIfqnn37a0HTjsZg3xFDv5oRDu5NK+ClIA7O1tbWezb6lMeNwODB79mxj/LLvKEWDaVh116KNHrETTjgBTqcT3SW/RyKR8jPPPNO4Tl6vt8ac+7k50qMlQ5P8G/W7gsFgVVVVFZRS+O1vf2ucy/Zsf6Sp2RNmfACamjJ0wr6c/Fs8Hi/JyclBfn4+Jk6caPSkfOKJJ2DOzdq4ceMULooyLJpIJNwy7wNIG14MV/J3yWTSxbBUIBCottvtKC4uhmxntG7duukMn8qwAf9OL9jo0aPhdDrx9ddfA+iaJO/1emtkzzzNvksmWLP5eyQSKW9oaJgk59Lvfvc7DBgwAJdddpnR0osVmjNnzoTT6URBQYEhICv1vaTxZRYO3V5FH9Touu666wwvGaUbWMTADYWc8zwPv98/QhpplHXg6zweT+0BBxxgNJNfs2bNix0dHXWyDyb1xi6//HJDyqInY5ev4zUPBALV/PyvvvrKSLR/55134PV6a8hMzy1NTTMzPgDNnze5y2ZJN39vbt5NWYzjjz/ekKc4++yzoZTCxx9/DL4uGAxWyZ6ITLaW//f5fCMjkUi5UgovvPACzAn2XFw2bNgwVal0DzkeW+YXceFoaGiY1NzcPI5GJftCjh492hhXS0vLWO7edahyxyG9tzIcDaS9P16vt4ZVwPX19XA4HBg5cqSRbC7zgFgIwCIR5nNJ40saZdvz/GRjbaUURowYYXjJ2EdS9sNkrh0Fdbubz7wGzLd0uVw49NBDIe9xGk3RaLSso6Oj7vrrr4fVagVFT3uaZ5hIJNz0cCcSCTcrZy+++GIopTB48GAAaUkJXtvGxsYJfSWPUVOTzPgANH/elA9oWX3EBydL3gGou+++G/n5+XC73Ua1lsvlQklJCfiwZU9MLpZSwqC9vX0UF0lKbPDYfr9/xJtvvonXX38dixcvbqNR98knnyAnJwfFxcWGh4NJ6ebFKBqNlrGVU15eHvx+/4jW1tZ6uWMHOkOVOmTZ9ylD4TRG+H+z4TR9+nQopZCbmwvOB6rKA+l2S5xz5nA68L8N0bcneZ/97W9/g91uRyQSKff7/SP8fv8Il8uFc889F9FotKy1tbXe5/ONNIceI5FIOe8ZIH0/tbW1jYlGo2VPPfUULBaLURzA46RSKQfzvRjeVErhwgsvRE/HHY/HS2RhCr3XZWVlsFqtOO+88+D1emv4HZgrvTU1+xIzPgBNTZKhm0AgUM0HNtAZGmlubh63bt266QyjMDzE/zN3J5lMuhi+ANIPbakOz1DM+PHj4ff7R+yyyy7Iz8/vos6dnZ2N0aNHG4afUgqlpaW49NJLIcecTCZdq1atmsVF9Prrr0deXh7efvtt8LPl6ykBQQ9Lpq+55pZJQyyRSLg9Hk+tFCzld9jW1jZm3bp107/88ktQ+oLvp0Cux+Opzc7OhsVigZRqkaSsyvZK7GcOmQw5WiwWQy0/HA5X3HDDDV26VsjrwjGzTyT7UMrNhtVqxbBhwyBD/czl5H3j9/tHxGKx0muuuQY5OTmIRqNlzAHbEikjE4lEymfPnm3cx9QWY/suIJ2Xah6/pmZfYcYHoPnzZiKRcLe0tIw151MxWZ7hByD9YKVRZbFYYLfb8c9//hNA2mDq378/vvrqK6NNkuyfKI/7j3/8A3vuuSc6OjrqLBYL8vPz8eyzzxpK4hs3bpxyyCGHQCmFrKwsVFdXA0gbW/3794dSCr/5zW/w9ddfQ3YT+P3vfw8aelwAotFoGUVEW1tb62Uz60xfe82ezc9gMFgl55HZiyU9Q7FYrHTevHmGUUCdPdlHlRIOCxcuTJqbVTMcyFD+9jhHdmFgisD5558PpZSRr7l69erXCgoKcMUVV2DTpk130JsFpO8nKQ3CzQaQNn7YukheHymb0tHRUcdrTJ0vpdJNtXsydmm0nXzyyYbyPZ8n3LRRE4/XGOi5lpqm5vZixgeg+fMmk6aB9O68vb19lAznmKvNEomEmw/Z2tpaKKWw7777AoAaMGAAnE4nxo8fD6BzB0zvWDgcrojFYqX5+fk44ogjMGjQINhsNpjDR3zIh0Khyn/+85/G4rr77rtj0qRJqK+vBw3CvLw8DBs2DIMGDYLD4cCrr74K5gExn4XHlR4Fs4yAZt+k1JqiJwZIL+qsqOX3LTXmfD7fSNmommS1LnspNjQ0TGLLIn7OD2la/RSkIcYK0mQy6bJarXjjjTdAb93VV18Ni8ViGGk8D3nvyiT9TZs23bHbbruhf//++Oijj4zcMeZt0TMHdBq9/D9FaT/88ENsaez0htPIve2220DvojR0zRu7vtLWSlNTMuMD0NTcFn744YewWCxwOBx455138OijjxoG1IcffmhIZdAzNXToUCilMHz4cDidTjApe3PikjQGH3/8cZSVlcFiscDlchnCtbJVCn/ea6+9MHnyZJir8aRhyQWICyBfx0VEhlk0d1xS1FRWEtMYoBHBZuTS09bTcN22kmOSVcipVMphs9kwZMgQAJ33jjQwWVhDw4w9FpPJpGv9+vUP89xWrlw5p62tbQwNTNnpgu+TPwNp44n5djSsqDNILxrva7ZM+8UvfmHo/elkfc0dlRkfgKbmtpCLxfHHHw+lFPbcc0+8/fbbOOyww2C1WlFUVITdd98dv/zlL6GUQnFxMY499lhkZWXh2WefBVsGbS5nR+7kya+++grTpk3Dvffei5dfftlIVl64cGHywgsvNPLR2Nvw8MMPx8aNG6fIpuLSOJOJ41QEz/R11ew9ulwuKKXw9ddfw1xpS8Nj3rx5ANJGCY2c7WVYSK8fZV8uvvhiZGVlwZxKYLVaUVZWhqVLl67j32gcff3116isrIRSyii88Xg8teaNhVmgORaLlTY3N48ze5QdDgfsdruh4M9rEwwGqyhLwzZVvAdlZbYsCNLU3BGY8QFoam4r4/F4SUtLy9iGhoZJrHL71a9+hYcffhgXX3wx/vCHP6CmpgYzZswAwyFnn302+N7uRDhlu6BkMunyeDy1XChZdMD3A/+r6N7Y2Djh448/xllnnWV406xWKz777DNwkZJhmkgkUs5FhTpQWkl8xye7R2RnZ2Pw4MF47LHHDFkM2dxbKYW2trYxUqZle5HzOpVKOZh4/8UXXyArKwuUkwiFQpWcnxxvfn4+9thjDwwYMMBQwM/Pz8e//vUvyI4Zm2MymXTJFkyUAqF234oVK+aygffZZ5+Nr776Cv/5z3/AXDH22jT3rt3enQ40NXuLGR+Apua2kDtqWbH48ssvIz8/HxaLBVarFWeddRb++Mc/Gg/xCy+8EAybyLYrJH9P+Qz+XhpIrOqSOTStra31bW1tY7ig8rgej6f2zTffREVFhTEm7t7NCeLUdwJ08+CdgfwOV69e/dree++NoqIi3HXXXfD7/SOSyaSLhn1ubi6UUpBtuLanQc7CEyA9B9va2sbk5eXhjTfegMzF4v3w73//GyNHjkRJSQkKCgpQV1eHr776Cu3t7aPC4XCF7EsJdN8SSlZY8v7h32iUAVDnnHMO6GVUSsHpdP5Pn1CPx1NLA5fFAjpPTHNHY8YHoKm5reQOWRpHbW1tY77//vt5V1xxBZRSyM7OxpFHHokvv/wSQNem2mZ21yCbHq1IJFIuDbHukq/Z1096FTo6Ouqi0WjZggUL4HQ6kZubi6qqKlARneGphoaGSWw3oysxdw6mUilHMBisamtrG1NbW4usrCxcddVVADoLTqjBZbVaQaOnpw28t3VsQNpDK0OlHM8LL7wAcyPypUuXruP4fmiOUgNQdiMwC+DymPQW85ixWKx006ZNd7S2ttbH4/EShjSTyaSLRm5HR0cdPXo8RiAQqNbeMc0dlRkfgKbmtpAGDasv165dO6O7/Kz29vZRTOBnnow51CHJBaOjo6NO9i+Un8udvc/nGylzZcxq6/TipVIpRyQSKW9sbJxw2223obCwENnZ2fjiiy9AtXFWkHKMmjs2Y7FYqUzWX7Vq1azbb78dSimjF6vMsbJYLMjOzsb2SuoHOkOWQFrNnj8rpXDvvfdCvkYWoHi93hp6hCnCzPOR3imzgSQ3O7yv6FWLx+MlvAfM9xwrpfl/2YSchhg9fTTOMv39a2puDTM+AE3N3qBsaQRAff/99/P4f3PoRyp3bw2j0WiZfMhvTpogFouVUqm8ubl5HI3CNWvWvMjPbW5uHkeh0Ly8PPzjH/8wKkI57nXr1k3P9HXV3Ha2t7ePkqHs5ubmcdOnT0d+fj7Ky8sNLTvODZvNhqKioh7lYW0rE4mEW1Y6cpOyatWqWTabDUuWLGmIRCLlMt8xmUy6li1btoI/8708Fn/m680bFHrN+C8NMJnPyd6ZbHUWDocrAoFAdSAQqA6HwxUdHR11Xq+3RsrHeL3emsbGxgla8FVzR2XGB6CpuS3kQxvo9ILJv0cikXKGftiPUO7Kt3T8VCrloEgt0FW4kyFM/t7n842U3gZzDg2PIRfacDhcccEFF0Ap1aXXny7d3znIucfvnp4vv98/YsaMGcjKykJJSYlRfRkOhyva29tHsUr3px4fvV3SYAyHwxV///vfkZWVBbnRYSsk2d8TSBew8Hg0LqWXjEUqzCGjwcX7MBqNltGLyD6zPI409vheymtIL5ssqDEbmZqaOwozPgBNzZ8zGWZ5/PHHoZTC/vvvD5lTBnR6LaSAJhd2NqqWQrp8DXt7AulFkcbiY489htNPPx0nnHACampq8NxzzxnJ5N3JbsiFjaFaacxK2QT+ThqmfZk8V9nzVI6dYq+ycTy/s95Iuv/oo49gs9ngcrnQ3t4+igbSwoULk2zXJY01+V4ZCv2xpKHEY0uNtAEDBiDT34+m5s+JGR+ApubPmalUyrFx48YpiUTC/f7770MphcLCQgDpdkx83fr16x+mUUDvAY02GgnSkIjFYqWyQvTZZ5+F2+2GxWKBUgoHHnigUeyglEK/fv1w4okngq/fuHHjFOmB4MItx05jRlajNjY2TuC4dpQmzvF4vIReS4qdygR0KZ7K76ShoWFSb312Y2PjBNliiMf+7LPPoJTCAQccgLa2tjE0jJmz2Fvnn0wmXTyvYDBYNWvWLOTm5uKtt95Cb32GpqbmlpnxAWhq/pxpFs3873//C6UUBg0aBBpENHbovejo6KhjhRrDpmZNM/78+eefQymFgQMHon///nj66adBWQCg02i6/vrrDR0pIL1It7W1jWlqahovVdY7Ojrq2PtQjnv9+vUPSw/ZjpRQvWbNmheBzupC/p7GWSqVcjQ2Nk6QfwuHwxWywm9bGAqFKsPhcAWV8KPRaBkN4jlz5sBqtWLEiBHgdeb7esNDJw3LFStWzI3H4yWDBg36n5ZPmpqaPz0zPgBNzZ8zKYYZi8VKaUjNnj3bqMJrbGycIKvJ6K2R3ie2sQHShQCsDqVu03777YdFixZF6LkyG1MrVqyYy8/me6677jrI10iJgkgkUj5//nw88sgjuP/++/H8888br122bNkKfs6O0HGAY6Sxe9lll2HOnDlobW2tTyaTLhosyWTS5ff7R0QikfLuujf8WDKh3ev11lBqwmazQRpKkydPRm5uLk477TRIbbveGkMikXDzeEOGDIFSCrIYRVNTc/sw4wPQ1Pw5k2FG6pbR6/L0009DKWU0Sm9paRkbj8dLpDYV2z4BXQ20K6+8ErvuuiuUUkZnANm8OhQKVUaj0TKzhpPX660JBALVo0aNMpTXDz/8cBx33HH4zW9+g8GDB8NmsxlhTzPz8/PxwQcfgMfcEYRtZeVsaWkplFLIycmBy+UyjJ/vv/9+ntmTKfPKtpUrV66cw+8zmUy6GEKePXu2kds3efJkKKVwzTXXgFp4vdGAnMeIxWKlVMD/6quvoCsVNTW3PzM+AE3NnzupT8b/Nzc3j0smk667774bSincc8894OsoBwB0VpfRu9PS0jK2rKwMSimcddZZ4OuBTrHcRx55BEcddRRyc3NRU1ODDz/80KjslLpsH330EU477TQMGjQILpcLDocDv/jFL/DXv/4Vn376KcwJ5tOmTUNhYSGysrJwyCGHYO3atTMyfV17ymAwWNXa2lqvlMIf//hH0LuYnZ2NxYsXtwFQ33zzjY/fEc+9J1W6W6KsNpQhX3rKHn30UfB3U6dOhVIKV1xxBbb1c8lYLFYai8VKx44dC6UUXn75ZUOYlk3PNTU1tw8zPgBNzZ8z2SwZ6GxkzgU6EomUH3744XC5XFi+fPl8mcMkE/YTiYT7scceMxL0lyxZ0gCkF3uqxFdXVxueLIvFgkMOOQRWqxV5eXk45ZRTwB6Kzc3N46LRaJkMjZkNDynhQYMvFApVer3emhdeeMGoGtwRQl5SluKoo46Cy+UCf0dvmdSOA3ovoZ/0+XwjzT1V4/F4yRFHHAGlFG644QZQO++uu+6CUgr/+Mc/0Fuh09tuuw05OTm48cYbjVCp2SOoqan50zPjA9DU1OwqbQGkvTY0ppRSGD58OFKplIP5Wax6TCQS7sMPPxw5OTnYb7/9QGOJVYMXXXSRYYhNnjwZQNorwjDdjTfeiPz8fHz//ffzeFyOg58Vi8VK5QKdSqUc0Wi0jL+jYUDhTjZ5P+aYY5Dp67o1fPTRR41kdoYRGZ7laxiGZdhwWz+T1Y1SEJVCqABUXV0dcnJycPHFF4Mq9JdffjksFsv/5Pn9GL777rvo168fDj74YEOYmIanrPLV1NT86ZnxAWhqav4wp0+fjuzsbKxYsWKuFPD0er01OTk5sNvtuO222yANo5UrV86x2+1QSuGqq64Cc8woaCvDZLm5ufjtb38L6YEzGxs0zhYvXtxWW1sLq9UKSjVUVFRg7dq1M2ikRSKR8qlTp8Jut2P+/PngMegJTCQSbnYzyPS1lQwEAtUOhwNnnXUWKEQaCoUqlVIYNmwYgHSYMh6Pl3i93hrpyZRCpLIQYFvHFI/HSyZOnAilFI444gjjWp511llwuVy4/fbbIcWOWYzAsUSj0TLp9ZLCyY2NjRPsdjscDgeY1C89r9pLpqm5fZnxAWhqam6e1Cmjp4bhtHXr1k0vLCyE1WrFggULwNfH4/GSO+64w0jql/ITXq+3xhzqDAQC1XvuuSf22WcfAF2r97xebw2Nivnz54PNr5VSOProo3H11VfjjDPOMDxwRx99tDGOaDRappTCLrvsAlZ+JpNJVyAQqJZVoZmmVHkPh8MVN954I5RSoOESCASq//3vf8NqteKUU05BQ0PDJGnwsEqS145epk2bNt3RW4nx0Wi07Omnn4bdbseuu+5qtFr6wx/+YBjc5p6Z5rZLlEqR3SWsViscDofxnbFV1/Lly+frpH5Nze3PjA9AU1Nzy5w7dy6UUvjvf/+L5ubmcdSsCgaDVfQ0rVmz5sXa2lrk5eXh6KOPhlygKe4qj8lmzb/+9a+Rl5dnhMS4YHMBP+aYYwyji2Esfia9XjNmzEB+fj6GDRuG5cuXzwegHnnkESilID1FfD0rCjN9XWl4SCV+nqt83RNPPAGlFM444wxw/PRItrS0jGUCvPQs9oZOGNAp3Dp79mzYbDaUlpaCY77sssuQn5+Pa665BvI8ksmkq6Ojoy4cDle0tbWNkdW5qVTK4XA4YLPZjCbmK1eunMPvxtwNQlNTc/sw4wPQ1NTcPBOJhHvp0qXrUqmU47TTToNSCnvuuWcXgyESiZQ3NDRM+sMf/oDCwkLU19cbCfVtbW1jZJiKbXLMBsh5550HhjOBTg+LUgpZWVn45z//aUgwhMPhCnq72traxvCY06ZNQ35+Pj799FPQE+Z0OrFw4cIkFfz5uYFAoLqveMlY/EDv4YoVK+ZmZWXhtNNOQygUqmS4l1WO559/vnHtN2zYMJWGF0OC7N3YW2OT1Y7vvvsu8vLyuhi6o0ePhtVqxcknn4yFCxcm+VpzL0dq3v3qV7+CUsowxr799ttlfE1DQ8OkRCLh7i3RW01NzZ4z4wPQ1NTcPOWi2tTUNJ5Np6WQLADlcrmglMKdd94JGhjdHYcCr7IVks1mw4cffggWEtBooqdIVm3yeFJjjAaDz+cbecABB3QxFinbIXtz0nuT6WsLdA05ki0tLWNvueUW5OfnY9q0aeB1a2lpGXv//fdDKYXq6mrQ6OL1ATqrNmWu37ZQhpzpefziiy9QUlICi8Vi5P1df/31KCoqwsEHHwyGuaPRaBmLRTZt2nQHAFVfX49BgwbhmWeeQTKZdG3atOkOfq/t7e2jmAsnjXhNTc3tw4wPQFNTc/Ok0USPRW5uLpRSeO655xAOhytef/11KKUwePBgfPfddwu5ALPlj8fjqfV6vTWUteBxqVHGpuaUt6AmGnW4+HoaYLJl0Nq1a2dIIy2RSLjZ+oljzsnJwX333QfzOYVCoUqz0Zgp0tuXTCZd9EYCULvuuitcLlcXLTAA6r777oNSCr/61a9AQ2fFihVzzdeqN4oWaPTRm8X54PF4ailzEo1Gy2KxWOnHH38MFnJ88cUX4PcMpEOZRx99NPr3749TTjkFMpcwEAhUU88uHA5XbK6Zuaam5k/LjA9AU1Nz86SnYsWKFXPpBWPieXZ2NnJzczFw4EAAnQuoz+cb2V3IKRqNlvn9/hGyInDgwIGGAcVke1ZP0oDz+/0jaHilUimH1OGiAejz+UZyrAUFBXjiiScApD1kM2fORFNT0/jW1tb6vlZZGY/HS8weu0Qi4aaw7d57742cnBzcf//9ANLes2Qy6aK30mq1gteFRlNvdyhob28fFQgEqqX2G3P5nE4nsrKyEIlEyumF3GeffYycv3322QfMAXS5XIbIcCKRcLe0tIyVnjApDGzuTaqpqfnTM+MD0NTU3DyZk9TS0jJWKYUFCxYglUo5VqxYMffpp58GPTMtLS1jzZVxPp9vZCAQqGYI0yws+9133y1USuGTTz4BKwRzc3Nht9vBBuKUfwC6qsrLUBpzrFKplMPv94+w2Wx46qmnsHDhwqQMqwGdmmbxeLykL3hgEomEm8bm2rVrZ0gDJRQKVQYCgWoKxl566aUA0knvjY2NE9rb20fR8OH3wPCtPO62UH6n1HkD/lfVPy8vD6tWrZoVDAarfD7fyFWrVs064YQTkJWVZfQmZQ4Zvyt5DdgzNRqNlvWVcLKm5s+NGR+ApqbmDzMQCFTvs88+sFgsANKLaU/Dfcwzk9pjlKAwVxMedthhUEoZVZI9MZi4eLMFD5A2ED744AOccMIJxvEDgUB1NBotk945qTQfDocr6FliyKw3yApF/n/Tpk138Dr05PySyaTL6/XWXH755cjLy8P+++8PIG28AWnv1YABA4w2R5FIpJxewHg8XkLvopTKMEtUbCtXr1792i677ILs7GwEAoFqhiP7gsGrqanZc2Z8AJqampsnPRoOhwN/+ctfAHQaWTJR/ofo9XpraOSkUilHa2tr/csvv4ysrCwsXbp03aZNm+645pproJTCk08+CaAzCbynY5QVkwxTKqXwz3/+E2aPiwy5yVCc5IYNG6bKPKcfS3qUWltb6/mZyWTStbUVnslk0nXrrbeCOXzybw0NDZMqKiqQlZWFY445BuZjNzU1jed3JYsIpJfxx1Im7TOnLNNzVlNT88cx4wPQ1NTcPKloLz1XDIX1xANCA8Dn841kqBBIi4Lut99+CAQC1c3NzePcbjd+97vfQSro98Tgi0Qi5evXr38YSOe5NTQ0TBo8eDBycnKQl5cHVm0yrPn+++/j/vvvx8cff4wPP/wQMkTY0dFRJ8VVe5M0fmgMplIpR08MIl5jFkGsX7/+YYYBb7vtNsjrdM8998Bms8Fut6O5uXkchXfN5/P1118D6D0lfBplX3zxBex2O1555RVs2rTpjp4a7Jqamn2DGR+Apqbm5plKpRzvvfceHA4HmMMViUTKtyas19LSMpZetUQi4R42bNj/SFP069cPMpS4NQndNFYAqCeffBIWiwV2u71LdeUhhxwCaprl5+cbSeeFhYUYOHAggsFgFQ0k+fO2sq2tbUwqlXK0t7ePoqGZSCTcW+N9k14t/nzOOecYhRVApySF1+utYU7XP/7xD0MPLh6Pl8hiCObnbev58Tj0aLrdbhQVFUEn5Gtq7njM+AA0NTU3z201yMLhcIU0RP785z9DKYU1a9a86PV6a2w2GwYMGAAgbTTQa5NMJl099ZDR6GhpaRl73HHHGeK1ANTNN99sGGITJkwwemoy+X3y5Mlwu92w2+1488034fV6a2T7od64htKgktetp1pbVOWXnq6Wlpax77zzDpRSKC4uxr/+9S/IKtbjjjsOxcXFcDqdhnEUDocreH17S3hVHqetrW3M6aefbhjbMkdPU1Oz7zPjA9DU1Nw8tzVkydeFQqHKt956C1arFQ8++CBSqZRjxIgRUEqBBst//vMfAGljbGsSwqlhBkBRRd7v949455134Ha7ccUVVwBIGwjUOaNhGQgEqsPhcAW7D7CLgJRg2FbSsFy+fPn8UChUyeKDnoQM2bFAyn6w5yMFVH/5y1/Cbrdjzz33BK9DPB4vefbZZ+F0OuFwOPDSSy8hGAxWxWKxUhqCvXWOPGY4HK6grpz0Wmpqau4YzPgANDU1N89tTeqngbBy5co5SilUVlaitbW1/v/+7/+glML06dMhtcFWrVo1i5/bk7BXMpl00cC5/fbb0b9/fzzwwAMAoObMmWOEJpVSGDBgAKqqqgyNMpKenMLCwi4N1HvDYGE144knnoi99toL9MxtzbGTyaSL14hh3XXr1k1nyLGtrW3MSy+9BLvdDovFgv/7v/8DkPZIxmKx0mHDhsFqteLAAw8Ej5dIJNy9EVak3AYrb08++WSd2K+puYMy4wPQ1NT8YW6L7AUAxdDakCFDkEwmXW1tbWN23XVXHHTQQaAx5fF4aun5oSHRE4OBMhZffvmloRKfTCZd9D6FQqHK9957DxdeeCFoLFCMdvny5fPpKaNKvsPhwMcff4zumqH/WH755ZdwuVywWCxQSuHPf/4zgE79tC2RBiINMGnAmosFampqjOvA10Sj0bJXX30VDocDSil8/fXXiEQi5b3dqSAUClUqpXDYYYchlUo5+kqvUE1NzZ4x4wPQ1NT8YUYikfLvv/9+nt1ux4wZM8A8qFgsVsoQINBpMEjx1qlTp8LlcqF///4IBALVsVistF+/fj32onBhl+GvaDRa1tTUNJ4G26ZNm+7IyspCQUEBjjzySNBIoReI42RodOHChUlWKn7++eddhGOVUjjooIMA9J4e2SuvvAKr1YpEIuH+29/+BpvN1kWxHugMTaZSKQe9ij3pKsBrIHO5/vWvfxkN4G+66SbwOwSgeN6/+93vjNwyVqmmUimHPA6NtkAgUC2vhcz1o6evo6OjLhaLlRYWFmLatGnQvSg1NXc8ZnwAmpqamyc9L6FQqPI3v/kNlFJgiI/6X2wKDnQu7gDUWWedhcLCwi65TTU1NUb/w55WGsr+iWYjha2W3G43bDYbGCIMhUKV8vgNDQ2TYrFYKUOiQLptU3FxMeS4x4wZA6UUekODDEgbjx999BF23313NDc3j/N4PLUjR46E0+nEhg0bpkpjMBwOV0gjqCceLHr4gLQBRS/j6tWrX6urqzPCmEC6AhOAmjZtGpRSyM/Px4IFCwCkjc81a9a8CHR67sxjMDeU5/E6OjrqqJNGD6VW29fU3PGY8QFoampumfTglJSUwOl04pVXXukSGvT5fCMZfpw1axaUUrDb7fj73/9uhK/+9a9/oV+/frjtttvQ06R9c8VjMpl00evV2Ng4QSmF/v37w2KxICcnp8txQ6FQJY1Fes1kz8e1a9fOUEph/PjxhiH3t7/9DXl5eb1mkNGgUUrhm2++8QFpI8pmsyEnJwcA1HfffbcwHo+X0KvEc+hJT0p6q2iYSQOqsbFxwvvvv49BgwbBZrNh0qRJ2LRp0x00lpRSKCgowAUXXGCIycZisdJEIuHmZ4dCocq2trYx8nqw/RT/z2ubl5eHvffeG+YQq6am5o7BjA9AU1Nz85R6XGzXY7PZsMsuu6CoqAgPPfQQFixYgKampvEXX3yxYYgNGDAAUk+MvTDZiDyRSLh7YpS1t7ePolFG7w8Nj6qqKthsNjz77LNQSmHevHkA0p6b9vb2UWzRREORRl0ikXB/9913CwGo8847r0v4dPTo0SgrKwPQaQxuC2m4MJzK3y9YsABKKZx55pkAOismGVbtaWsjegxjsVgpjajGxsYJK1eunMPXbNy4ccrZZ5+N3NxcDB48GPRoAVB1dXVwuVwoKCjAokWLIjQKaZTJPL5oNFomDTH2OY3H4yWnnnpql+uYSqUcPc2R09TU7BvM+AA0NTV/mPQoAelcpWg0WnbvvfciNzfXaOXjdDpRXFyMoUOH4qOPPjK8Z1zQnU4nCgsLAXSGunqaZ9Tc3DyOYdJgMFgVDAarrrvuOkPPbN999zWOTePLLOxKKQtpYKxdu3bGxIkTYbFYDA/RH/7wB8Ow6I2kd0ps8LiyE8Gjjz4KpRTuvPNOAGmDh9dNhoG3ROZ3yZAn0Bl6pCDs559/DqUUcnJyMGXKFDQ2Nk6IxWKly5YtW8Hcsr/85S+gMSuLCGRFrWwSHolEyh988MEuba+amprGa8kLTc0djxkfgKam5ubZ1tY2hp4sLuw0dgKBQDW1vRim4mLt8XhqWS05ffp02Gw2/Pvf/wa9VD1VwqfxIo231157DUopPPTQQwgGg1VKKbz77rtIJBJuaTy2tbWNoQHH39Hzw/G+/PLL6N+/vxGiPPTQQ2Gz2dBbFZaRSKScPSyVUnjssccQCASqKfZ60EEHITc3FytWrJhrbvotz2VzZBcAqQ3HsUej0TJZhclrWVNTA4vFgmHDhhmJ/YFAoPrSSy81JELGjx8P+TmyOTk/NxKJlN96663IycnB+eefj3g8XvL1118bRRIMc2tqau4YzPgANDU1t0wmc0sPU1tb2xj2SwTSBoA0KPhapRT22WcfAGnDipV89Gb9EGOxWCmNpaampvFr166d4Xa7ceyxxyKVSjmUUigvLwer/cxVgfF4vIRj8vl8I2VBgt/vH/HZZ59BKYV4PF4SDocrLBYLTjnlFCQSCXdvyULEYrHSpqam8RdccIFR0CD/Tu8Ur2EymXQtWrQo0pNj09hLpVKOYDBYFYlEyv1+/wieMz8rEAhU8zq2trbWz54925DH+Oqrr7qM6cQTT8TgwYOhlMKpp55qhIL9fv+Ijo6Oumg0WvbYY4+huLi4S9hVHoN6a5qamjsOMz4ATU3NH6ZUf2erolAoVEmDhQsxDSy/3z+CBtxNN90Ei8ViSGVII2dr+kXSO0cPDgB1xx13wO12Y8mSJQ1A1x6YMkkd6Nq+SLb0uf/++5GdnW14iiwWC2644Qb0ljEmz9vj8dTm5ubiqKOOAvO9GAp0u91dcrBisVhpTwxWvpbeLxkqlHpuqVTKwc+SXrP+/fvDarVi3LhxRpg5HA5X0IC02WywWq2G58zhcKCgoMAIVXd0dNSxpRbQabgDPStK0NTU7DvM+AA0NTV/PLkAM4Gevw8Gg1WUpDj00EO7VGRGo9EyGhuJRMJNL488XjKZdMnG2ACU1WpFVlaWoeyvlMKoUaPABHZpAHRn7MkEf1Yljh492pCFiMfjJUopzJo1C0BnmJQGKf8156Jt6frwM5PJpOu5556Dw+HALbfcAr6GYVwaOTQGY7FYqTSGaVBRDFcaPz+WiUTCPXr0aCilcMIJJ3Q5bxpyq1atmvXEE0/goosuQn19PZ5++mn0JJyqqam5YzHjA9DU1PzxpPFgNsiAtACrw+HA3LlzAaST+ROJhFtqiVH0leSxZPgrFouVnnDCCcjOzjY00MrLy2G327v015Q5SwzPJZNJl9k7xzAmQ55HHHEEaOTYbDZ8/vnnxv+l3EM8Hi+Rhl5PE9dpPIXD4YrGxsYJ5513Hux2u3FdeI6RSKTc6XQayf80SnlezDHr7V6bANQTTzwBq9WK3XbbzfBmNjU1jWdxQSKRcHu93hqfzzeS17E3DEJNTc2+w4wPQFNTc9to1puiHMKf//xnIwwXiUTKacAwxCUV+MPhcAUNtWg0WsafN27cOOXOO++ExWLBlClTkEqlHIsWLYoopfDMM8+An8lQKt8vqwJlFaJUmQeg+vfvjxtvvNFQlmflJo/D95t1uJqbm8f11CAzN2P3+/0jDjzwQCil8OyzzwJIG5AMy9JTNnv2bOP8pH6Y1+ut6a3WRLxWLS0tY1955RUMHDgQ119/Pbxebw0rRPlac8ssXUmpqblzMeMD0NTU3DYyEZ0eMhpfxcXFKC0tRTQaLaNHRxoniUTCTcNJLu5SIX727NkYMGAARo0aBfaczMnJQVZWFlgt6ff7R/Czk8mkKx6Pl0iDxZyLlUwmXYFAoPrKK6/skrfV1NQ03uVyYdy4cYaXSHrEqOZvbuX0Q/R4PLXs3wmkjVXmcw0bNgw5OTmYNGkS5LXs6OioGzZsGBwOByZNmgSpek9JCvPYtoU0tILBYNVZZ50Fi8WCr776ChxPLBYrjcfjJcxrozBsT8V9NTU1dwxmfACamprbRgqGmnXFlFKora0F88ni8XhJe3v7KPaY5Otkg2+GCpPJpIsVkEOHDjVkKU455RTk5+cbqvfJZNIlDS/pyZKeNpJ/93g8tbvuuisGDx6MRCLhptFDsdlAIFA9efJk/PrXv0Zubi4OOOAAzJ492+iTGYlEynvSHkganRs3bpwiBXF9Pt/Io446CkVFRfj9738PmW8WCoUqR44cCYvFgrPOOguhUKhSGqq9Jbrq8/lGSi9YU1PT+OLiYgwbNgw6JKmp+fNixgegqan540njyuw18vv9I5xOp5HQD6S9YvSMAV29YuFwuEJ6fJ555hnk5+fD6XSCfwegdt99d5x++ulIJBLu7nSu5PFlmDQUClXSMwak9ceUUkYvR7/fPyIcDle89NJLyMvLQ3Z2tlFZeMQRR8BmsxkCuG+99RZ6en1kgj5DkjJZ3+v11lx66aVwOp1GKyVp6D399NNGdaPUKetpBWZPyCrNlpaWsfF4vOSee+6BUsrwEjIPz+fzjfT5fCNlha2mpubOw4wPQFNT88eTeVY0umgoNDY2Tvjtb38Lq9VqhNzMSf/sk2g+3nPPPYcDDjgAVqsVfF8wGKyyWCxQShlVlj6fbyR1seQxGF6TTcmlkbNp06Y7SktL4XA4wL8DaQkMGmFKKaOSkKHKjo6OOqUUBg0aBLPn7YfY0tIylqE//uv1emvoUWxvbx81d+5cFBUVQSmFFStWzG1qahpPgd0NGzZMzcrKQklJCd577z3w2m3NGDbHSCRSLg1hFhIUFxfjqaeeQiAQqO5OJDcWi5VKwV1NTc0dnxkfgKam5o+nDLHJCspUKuV44YUXYLVasWbNmhcZKmTYjcYIPS0M7c2YMQNKKeTl5UEKzV5zzTXIzc3F4sWL24B0on08Hi+RhqDf7x9Bj5g0/miM0UvF5ufszZlIJNyHH344cnJyUFdXBwBq0KBBsNvtoDdIetpsNhtqamrQE4OExkwqlXLQC2juB8mfA4FAdVFRESwWC/76178iGo2WSQ9bdnY2nE4nrr/+eshrt62kAUvBXiAdbr755pshXyfzBM3XWFNTc8dnxgegqan501EphezsbMTj8RJKVqRSKYf0jDGUN3LkSCilMHLkSEhDpbm5eZzD4cC5554LJu0DPUtql1pifK/VasVee+0Fvmbo0KHIy8vDI488gv/X3tnH1lmXffw6L/dpT09P23W1ZXRbaEa6bGmIdYah1oDdlj1/WI08Gie6CNuiA2EyfVIEdMQnQ3FBh9P5gj6mQZ8MxbfwsmwsaBhDZCEwfJzF0Vnd2rX09PS0p+f9fvk+fxyv09/qJkUpN2zfT/IN5+V++Z27BL65rut3XeY5unlAj0un0+td143deuutCIfD0EhXoVBoN3dkAmWTY+721IkGpmE0a9/0vFwu13nHHXcgGo1CRKCtJvTaH/nIR1BdXY329vZKKnh26lafZyqV2qD1eP/MvGmNn9bwOY7TUFdXhy996Us43zkURV148n0BFEXNr0QE4XAY/f39A2Z3/0wm05XL5TqffvrpSprw0KFD/2BCFixYgLe97W0wC9m1O/9cpG0s8vl8R1dXV2Vn5cTExMZbbrkF8Xgcv/nNb6BRPqBsjJ599lmICO69916YzV01vaiNaM2Gs7r70NxcoMfoa62l0/uYdWFqWo8cOYKFCxdCRHDffffBvNajjz4KEUEgEMBLL73UD5RTj2bDWnMHpJoyldb7OY7ToPeenp7u1p2pL774omvW11EUdXHI9wVQFDV/KhQK7cPDw7uXLVsGrQG74oorsGLFCnR1dVU+i8fjmJqa6tFUJAAZGBh4UtOLTzzxBFzXjWn0ByhHzl7t/lqMPjY29vlTp071LVq0CLfddhtKpVLrQw89dNYgbcdxGrT4X43jqlWr0NTUBDWIOg9TRHDy5MlDp0+fvl93I+pOUb23Gq/x8fGt2jvMTPuZY57UKJn3T6VSG6677jpEIhHU19dDNx4A5eigZVmwLAuf+9znAMxE9nQ9WvumdWFmChSY2VQxODj4azPyuHbtWsRiMfj97w5FUW+sfF8ARVHzK63vev7556FtHpYuXQoRwU033QRzx6C2s1DzIiK48sorAcwYGI0iDQwMPPla1mHOwVRT9dGPfhRA2WjN7pWWSCS2ff/73z+ruW2hUGj/05/+dErnOOq1Ne0HlFOF5+vRNbvTv/6WycnJazUCaE4dyOVynfv27UM0GkU4HEZfX1+lBYht281r1qypDPnW+jxzrJFZV6e1cGZjXtNAZjKZrpMnTx4KhUL47Gc/+7rN86Qo6q0h3xdAUdT8SSNDwMysSbNmynXdmEad9BwdWfStb30LjY2N0LQaMGNc5rrDz3Xd2Ojo6I73vve9FWOlRq+xsfEfdkvqddX0HDx4sDLrUqNzvb29CAaDcBynQXuLFQqFdm2wqvVkWjdm1sPpiCRzVJRZ5G++1hmdupZrrrkGIoKVK1dibGzs857nWaVSqfX3v/89Fi5ciGg0WinETyaTm3VGpmp21/3p6enudDq93txpuWTJkspzmkufNYqiLhz5vgCKouZXs5uoTk1N9ZjzGYGyWRgZGdlpRmVCoRCWLFkCnTs5MTGxUY8vFArt5nik88l13Zju3Hz55Zd/d+rUqT7tkK8RKdO46GeaDr3//vshIpiYmNioxioWi+Gyyy47q3FqNptd7bpuTM8rFott5simRCKxzdxgYA5CN8cwjYyM7BwcHPy1GTUsFArtet2HH364kuL92c9+hnQ6vV6N4jve8Q5YlgURwY9//GPoOsw1ptPp9bN7mNm23ZzNZldrBJEtLSjq4pTvC6Aoan6lnfyB8o5AjdRoI1KzUSpQNiDHjx8fCYVC6O/vH1CzopEi7es1l3u/9NJL/S0tLeju7gYAueOOOyo1acDZLTFmz7nM5/MdmzdvRjweh65hdHR0h4hgz5490AiYXuPEiRPPXX755aiqqsLb3/529Pf3DwwPD+/W65n30teJRGKbfm9G0mYPMlepkVu7di1EBJs2bYI+s0wm0zUyMrKzsbERwWAQIoKDBw9iYGDgyXPNvdRdlb29vaiursby5cvPKuSfS40eRVEXjnxfAEVR8yfP8yxNOWq9kr53HKfBjIiZxqy3txfhcLhSp6X/zGazq/WcucyT1O76xWKx7cSJE881Njbik5/8JMxWEeZ8yGw2u1pryQqFQnt9fT3q6+sBlM3k3r17UVtbC6CcFtRr5HK5zq985SsQEXzsYx9DNBqFZVloamqqDAmfmprq0Wdgdrs3i+1zuVyn/kZNhaqZMhvUJhKJbV//+tchIliyZEnFMGq93pEjR7B48WKICOrr63HllVeit7cXjz76KB5//HH09vZixYoV0EHmH/rQh2A+W4qiLj75vgCKovyT2Y4BmDE5q1atqtQymekzM02Zz+c7NKKltWA6L9PzPKuxsRG1tbXQlGQ8Hq8Uv+t52p/MvE+pVGrVyJWI4K677qrUsUUikUrTWtNIua4be/DBBxEKhSopP22bEQwGcfPNN1fmYI6Pj281jY+mSXO5XKe5U3Mu45EOHDiAUCiEmpoaaJG+WcQ/PDy8+9Zbb630NYtGo5UxUKFQCHfffTc0imfW6rF+jKIuPvm+AIqi/JOm6bTpqhb5RyIRdHR0/EMkS18XCoX2iYmJjdrPTL/XaNIHP/hBiAiefvppZDKZLq2v0u785jB0NWU6iknvcfjwYdTU1FQGmT/zzDOIRqP41a9+BaBs4NTE2LbdPDIysrO+vh5Lly4FMGNqNm7cCN1EYNbJaWsLvZ/ZlX+uXfBzuVznU089hVAohFWrVgGA6G80n5WZ/szn8x1a/2buVNVaPWBuTXcpirqw5PsCKIryTxrNMXc7Tk1N9SxatAgrV64EMBM50tdTU1M956uJKpVKrevWrYOIoK+vD0C5aL+pqQl33XUXbNtu1oiZFt6btVtmMf4VV1wBEUE6nV7veZ61bt06hEIhmOvW15pq/cEPfgARwY4dOwDMRJ2OHj1aKcbft28fgHI0UHdcajrScZwGM1I31+f43e9+FyKChx9+GEDZdKXT6fXa8NV8PqYhNH+DuUlhLulgiqIuLPm+AIqi/FUymdys5kAL97/61a9CRGB2tAdmTIWOLAJmeojZtt38gQ98AJZlYefOnQDKxkJ3D2qEzTxXI0HFYrFNTaGmTePxOD71qU9B1ykiuP7662F2uNd1mUbni1/8IkQEu3btgm3bzfr59PR09/ve9z6ICJqbm6Ed83Wdmko918D0V3t+AOQ973lPZZfk7FqwfD7fkUqlNpjmU/ulTUxMbNTnbJo2zqqkqItLvi+Aoih/ZTZk1RReMpncHIlEsH37dmin+ePHj4+YI4z0HKBsOHTU0I9+9CPod/feey8ikQjU9JmTACYnJ68150nqMZ7nWffccw9EpNIaQ8cJnT59+n41O5OTk9dqrZk2ZXVdNzY8PLz7E5/4BCzLwpe//GVoSvTMmTO78vl8x+HDhyvRsgceeAB/+ctf9gOQl19++Xf6TCYmJjbOJUpl9m8bHBz8tTnySDcIzI4mzjZrZo2eGTE8VxSSoqgLV74vgKIo/2T+T1/NmEbJbrvtNogIvvOd70CP0U755oDya665BvX19aipqYEapGQyublYLLbV1NTgqquuQiaT6RoeHt6thk5r07QJrV5fTZCIoL29Hbquz3zmMwgGgwBmomLmDEqNhGnkbWhoaO+nP/1pRKNRtLa2VrrrqxkaHx/fetlllyESiWDdunWVBrXDw8O7NVo115RlKpXaoC0qdPam+Vy12N913Vgmk+lKJBLbUqnUBjM6p8fqcPHXcn+Koi4M+b4AiqL8k7kjUNOHmUymq1Qqtf7tb3/73+7ubogILr30Uvz0pz+FnpdOp9fffPPNqK2tRUtLC7q6uqDNY9X0fPvb30Y4HK5EoIAZs2cO4s5ms6vVVBUKhfbHHnsMIoIXXngBQDmd2dnZiYaGBkxPT3dPTk5eq/MmHcdpUBOonxWLxTY1Mw8++CAWLFiA+vp67NixA2bBvuu6sQceeAAigrq6OvT39w+YZmguhsh13dixY8cAlFOidXV1OHz4MKanp7vVOOoGhtkRN52fWSgU2nVdZvTstaRNKYp668v3BVAU5a9SqdQGNSkaKdJ6L8/zrJ///OeVdg1VVVXQmrDq6mp0dXVB6570erZtNycSiW01NTVYsGABgLNbZGgxvd5b76N90VpaWiAi0OO1H9nChQuh99CNBXpfbR2hMyLN3zI9Pd29atUq1NbW4tJLL8WZM2d26egkz/OsRCKxTUQQi8Vwyy23wHXd2GvtlD86OrrjzjvvhIjALOI368AKhUJ7Pp/v0O/Pl8pUY8qUJUVdXPJ9ARRFvXllGq1Tp071/fa3v8Xjjz+OP//5zy+qYXAcp0HTfJ7nWTrnsbq6Gvfdd99ZxspsAAuc3R3fcZyGo0ePIhqN4oc//CH0/p7nWWvWrKnMtDQ3BLiuG8vlcp2u68bMHY1AOS1ptrX4xS9+URlttHfvXnieZ2lftVdeeeX2m266CdrINpVKbThfCwozmqip1+Hh4d21tbW47rrroEPE/f7bURT11pLvC6Ao6s0rc8dgPp/vSCaTm8fHx7eahee5XK5z9lxLHb0ElFNvOuZIm7kWCoV2rQHLZrOrz5w5syudTq9vaWlBXV0dzGt5nmd94QtfgGVZKJVKrblcrtNs7prJZLrUHGrx/ux038mTJw9p9OyGG26AiKCtrQ3ATC+wdDq9/tixY5WC/xtuuAFmTVcymdxstgfR9SeTyc0aNdRjbdtuNs0mRVHUq8n3BVAU9eaVdp4/V/rsXDVW4+PjW4vFYtu+ffsgIpiamupRE2MWy+tn2gcMgDzyyCMIh8PYv38/jh07Bk1hnjp1qg+ABAIBXH755dB7TUxMbDRnUWrtm74305j6mW5EOHDgQCX1CpSbuSYSiW1q8jZt2lTpqN/b21uJ8mUyma6pqakejZD19PRA051AeTOBromGjKKo1yLfF0BR1JtbWt+ldVcqLXw3jYdGyp555pmKSQHKdVylUqnVjCBNTU31qEnTOq53vvOdmJ3u01YQP/nJTxAMBnHjjTfi+PHjI/q91qzp+8nJyWvNiN2ZM2d2vfLKK7eXSqVW07Sl0+n1wWAQwWAQZjsPjZi5rhtbu3YttJ2HiGDx4sXo6OiozKBsbm7Gpk2bKkX8moo1xyBRFEXNRb4vgKKoN6/MmiytFTNrwYCzzYf2AhsZGdkpIrjnnntgHmPWmqnxGh8f3xoKhbBs2bKzRjWNj49v1T5fQ0NDez3Ps7Zv3w4RQWtrK6anp7s1cjU5OXnt7B2UjuM0DA0N7dXrmcbR7B8mIrAsC4VCoX12Sw2g3F9s//792LJlC1paWlBVVYWrrroKu3btwujo6A7zvmrsOPqIoqjXKt8XQFHUm1e2bTfP7hivzVtnF+jrsclkcrPjOA1XX301ampqKt3+tV0FMFMMn0gkttXV1SEYDELryPRaej9NPWqa87nnnkNDQwNEBFdffTX6+/sH9NiRkZGd+trsSaaRObP+TU3X9PR0t2VZ+MMf/lDQSJt27gdmmuBmMpkuHeOkRlCfQTqdXq9r1ro6v/92FEW9tRQUQgg5D8FgMAvA8jwvpp8FAgHbcZzmQqHQkcvlVjuO02we39jY+D+hUGjye9/73slcLifxePz/fvnLX6Kuru6R8fHxbSIi1dXVf9y4cSOWLl36zXQ6LY7jRJqamr4Zj8cPiohkMpluvWZdXd0jIiKWZQ3lcrnVbW1tW0ZHR5d/7Wtfk6NHj8q73vWuZcFgEHfffTf0nEwm021Z1rCIyKJFi3pDodDk5OTkBhGRaDT6gohILBY74rpuw/bt25+wbVsuueSSO5uamvaIiCQSif+KxWJHcrnc6lKp1CYiEgqFJsPh8FggELAtyxrSZ5FOp3vi8fhBfR6hUGgyGo2+YD4XQgh5NQIAXv0oQshFjRqyYDCYFREBYAGI6HsREdu2W9UEnT59um/JkiXXe54Xq62tzTQ2NsrY2JiEw2HJ5/MSjUYln8/Lhz/8YXnooYcCY2Njt8fj8QPV1dV/TCaTNzY1Ne3JZrNd4XB4zLKs4UKh0FFdXf3HYDCY9TwvBsDS+/b19aW2bNki9fX1EgwGJZVKiWVZsmbNGlmxYoXU1dXJ8uXLJRqNSiqVkr/+9a/y1FNPSX9/v0xMTEgwGJSPf/zjsnfv3uWWZQ0nEonPt7S0/Hcul1tdU1PzbCaT6Y5Go8+HQqFJ/e3T09P/EY/HD9i2vTgSiQzatt0aCATscDg8Nj4+vq2pqWlPsVhsr6qqOvGG/qEIIW9ZaMgIIfOK53mxkydPPnno0KFVR48elfr6enn/+98v69atC/y7185ms12RSGQwHA6PTU1N/eexY8f2PfbYY3LgwAE5fvy46H/fAoGZW4VCIbEsS0KhkHzjG9+Qd7/73RMrV668JBAI2ACsQCBgi5xtMAkhZL6hISOEzDue58U0hadpUMdxmjV9+Hpi23ar3su8vkb1AoFASU3X2NjY7U1NTXuCwWDWtu1WABFNR3qeF9OoGCGEzDc0ZISQecdxnGYAltZgvV7XLRaL7bZtL7Ztu1VEJBwOj0UikUFNFTqO0xwIBEoiZYMFIKLnBgKBkkbAXNdtcF13QTgcHtP3wWAwS0NGCHmjoCEjhMwb2Wy2KxaLHdH36XS6x7bt1qqqqhM1NTXPmjVo/wpqnEyT5zhOc6lUanMcp1k3BJyPXC63+u8msRQKhSa1Rs1xnGbLsoZeT/NICCH/DBoyQsi8MXszgIlZr/WvYkbAAoGAPfs+xWKxXb/TVGUgEChppCwYDGb1HNd1G3Q9f09XpmjICCFvFDRkhJB5xXGc5lwut9rzvJhlWUORSGTw9S6Wd123wbbtxSJlkxUKhVIi5VYVcznf87xYqVRqi0Qig2arD6YsCSFvFDRkhJB5I5/Pd0YikUHT2BQKhQ6tJ/t3jVmhUOiwLGvoXMZJ05lm7djsth2lUqnNsqwhLfY3a8oARLSmjBBC5hsaMkLIvOI4TrOmAF/viJPjOM1qmrQ/mZow13UXRCKRQY12nSulaZ4vUjZqxWJxOQBrPnaAEkLI+aAhI4QQQgjxGY5OIoQQQgjxGRoyQgghhBCfoSEjhBBCCPEZGjJCCCGEEJ+hISOEEEII8RkaMkIIIYQQn6EhI4QQQgjxGRoyQgghhBCfoSEjhBBCCPEZGjJCCCGEEJ+hISOEEEII8RkaMkIIIYQQn6EhI4QQQgjxGRoyQgghhBCfoSEjhBBCCPEZGjJCCCGEEJ+hISOEEEII8RkaMkIIIYQQn6EhI4QQQgjxGRoyQgghhBCfoSEjhBBCCPEZGjJCCCGEEJ+hISOEEEII8RkaMkIIIYQQn6EhI4QQQgjxGRoyQgghhBCfoSEjhBBCCPEZGjJCCCGEEJ+hISOEEEII8RkaMkIIIYQQn6EhI4QQQgjxGRoyQgghhBCfoSEjhBBCCPEZGjJCCCGEEJ+hISOEEEII8RkaMkIIIYQQn6EhI4QQQgjxGRoyQgghhBCfoSEjhBBCCPEZGjJCCCGEEJ+hISOEEEII8Zn/B0cJyyoUKAVUAAAAAElFTkSuQmCC" style={{ width:200, opacity:0.85, display:'block', margin:'0 auto 16px' }} alt="" />
            <div style={{ fontSize:20, fontWeight:800, color:C.text, marginBottom:4 }}>¡Están a mano!</div>
            <div style={{ fontSize:14, color:C.muted }}>Sin deudas este mes</div>
          </div>
        </>)}

        {/* Pagos realizados */}
        {mSetts.length > 0 && (<>
          <div style={S.divider} />
          <div style={{ marginTop:16, marginBottom:16 }}>
            <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'0.05em', marginBottom:12 }}>Pagos realizados</div>
            {mSetts.map(s => {
              const sColor = s.from==='gri'?C.gri:C.toba;
              return (
                <div key={s.id} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 0', borderTop:`1px solid ${C.border}` }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <div style={{ width:32, height:32, borderRadius:R.pill, background:sColor+'14', display:'flex', alignItems:'center', justifyContent:'center', fontSize:15 }}>↗</div>
                    <div>
                      <div style={{ fontSize:13, fontWeight:600, color:C.text }}>{s.from==='gri'?'Gri':'Toba'} → {s.from==='gri'?'Toba':'Gri'}</div>
                      <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{shortDate(s.date)}{s.note?` · ${s.note}`:''}</div>
                    </div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:12 }}>
                    <div style={{ fontSize:15, fontWeight:800, color:sColor }}>{fmt(s.amount)}</div>
                    <button onClick={()=>onDeleteSettlement(s.id)} style={{ border:'none', background:'none', cursor:'pointer', color:C.muted, fontSize:18, padding:4, lineHeight:1 }}>×</button>
                  </div>
                </div>
              );
            })}
            <div style={{ paddingTop:10, borderTop:`1px solid ${C.border}`, display:'flex', justifyContent:'space-between' }}>
              <span style={{ fontSize:12, color:C.muted, fontWeight:600 }}>Total pagado</span>
              <span style={{ fontSize:12, fontWeight:700, color:C.text }}>{fmt(mSetts.reduce((a,s)=>a+s.amount,0))}</span>
            </div>
          </div>
        </>)}

        <button onClick={()=>setShowSettlement(true)}
          style={{ display:'flex', alignItems:'center', justifyContent:'center', gap:8, width:'100%', padding:'11px 16px', border:`1.5px solid ${C.border}`, borderRadius:R.sm, background:C.card, cursor:'pointer', fontFamily:'inherit', fontSize:14, fontWeight:700, color:C.text }}>
          <span>💸</span> Registrar pago / transferencia
        </button>
      </div>

      {/* Proporcional */}
      {config.salaryToba > 0 && (
        <div style={S.card}>
          <div style={{ ...S.h2, marginBottom:14 }}>Proporcional {monthLabel(month)}</div>
          <div style={{ display:'flex', gap:10 }}>
            <div style={{ flex:1, background:'#FFE9F3', border:`1px solid ${C.toba}30`, borderRadius:R.sm, padding:'14px 16px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:C.toba, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:6 }}>Toba</div>
              <div style={{ fontSize:28, fontWeight:800, color:C.toba }}>{fmtPct(p.t)}</div>
            </div>
            <div style={{ flex:1, background:'#EFEAFA', border:`1px solid ${C.gri}30`, borderRadius:R.sm, padding:'14px 16px' }}>
              <div style={{ fontSize:11, fontWeight:700, color:C.gri, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:6 }}>Gri</div>
              <div style={{ fontSize:28, fontWeight:800, color:C.gri }}>{fmtPct(p.g)}</div>
            </div>
          </div>
        </div>
      )}

      {/* Pagado */}
      <div style={S.card}>
        <div style={{ ...S.h2, marginBottom:14 }}>Pagado este mes</div>
        <div style={{ display:'flex', gap:10 }}>
          <div style={{ flex:1, borderRadius:R.sm, padding:'14px 16px', background:'#FFE9F3', border:`1px solid ${C.toba}30` }}>
            <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:6 }}>Toba</div>
            <div style={{ fontSize:22, fontWeight:800, color:C.toba }}>{fmt(tobaTotal)}</div>
          </div>
          <div style={{ flex:1, borderRadius:R.sm, padding:'14px 16px', background:'#EFEAFA', border:`1px solid ${C.gri}30` }}>
            <div style={{ fontSize:11, fontWeight:700, color:C.muted, textTransform:'uppercase', letterSpacing:'0.04em', marginBottom:6 }}>Gri</div>
            <div style={{ fontSize:22, fontWeight:800, color:C.gri }}>{fmt(griTotal)}</div>
          </div>
        </div>
      </div>

      {/* Gastos fijos proyectados */}
      {mRecurring.length > 0 && (
        <div style={S.card}>
          <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:14 }}>
            <div style={{ ...S.h2 }}>🔁 Gastos fijos</div>
            <div style={{ ...S.badge(C.warn), fontSize:10 }}>Auto-proyectados</div>
          </div>
          {mRecurring.map((e,i) => {
            const cat = CATS.find(c=>c.id===e.category)||{icon:'📦'};
            const col = e.paidBy==='toba'?C.toba:C.gri;
            return (
              <div key={e.id}>
                {i>0 && <div style={{ ...S.divider, margin:'10px 0' }} />}
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                    <span style={{ fontSize:20 }}>{cat.icon}</span>
                    <div>
                      <div style={{ fontSize:14, fontWeight:600, color:C.text }}>{e.description}</div>
                      <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>
                        <span style={{ color:col }}>● {e.paidBy==='toba'?'Toba':'Gri'}</span> · {cat.label}
                      </div>
                    </div>
                  </div>
                  <div style={{ fontSize:15, fontWeight:800, color:C.text }}>{fmt(e.amount)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Categorías */}
      {topCats.length > 0 && (
        <div style={S.card}>
          <div style={{ ...S.h2, marginBottom:4 }}>Categorías</div>
          <div style={{ fontSize:13, color:C.muted, marginBottom:16 }}>Solo gastos compartidos</div>
          {topCats.map(([catId,amount],i) => {
            const cat = CATS.find(c=>c.id===catId)||{icon:'📦',label:catId};
            return (
              <div key={catId}>
                {i>0 && <div style={{ ...S.divider, margin:'12px 0' }} />}
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:8 }}>
                  <span style={{ fontSize:14, color:C.text }}>{cat.icon}&nbsp;{cat.label}</span>
                  <span style={{ fontSize:14, fontWeight:700, color:C.text }}>{fmt(amount)}</span>
                </div>
                <div style={{ height:4, background:'#EBEBEB', borderRadius:R.pill }}>
                  <div style={{ height:'100%', width:`${(amount/topCats[0][1])*100}%`, background:C.primary, borderRadius:R.pill }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Personales */}
      {personalExps.length > 0 && (
        <div style={S.card}>
          <div style={{ ...S.h2, marginBottom:14 }}>Gastos personales</div>
          {['toba','gri'].map(who => {
            const exps = personalExps.filter(e=>e.paidBy===who);
            if (!exps.length) return null;
            const color = who==='toba'?C.toba:C.gri;
            return (
              <div key={who} style={{ marginBottom:12 }}>
                <div style={{ display:'flex', justifyContent:'space-between', marginBottom:10 }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <div style={{ width:8, height:8, borderRadius:'50%', background:color }} />
                    <span style={{ fontSize:13, fontWeight:700, color:C.text }}>{who==='toba'?'Toba':'Gri'}</span>
                  </div>
                  <span style={{ fontSize:13, fontWeight:700, color }}>{fmt(exps.reduce((s,e)=>s+e.amount,0))}</span>
                </div>
                {exps.map(e => {
                  const cat = CATS.find(c=>c.id===e.category)||{icon:'📦'};
                  return (
                    <div key={e.id} style={{ display:'flex', justifyContent:'space-between', padding:'8px 0', borderTop:`1px solid ${C.border}` }}>
                      <span style={{ fontSize:13, color:C.muted }}>{cat.icon}&nbsp;{e.description}</span>
                      <span style={{ fontSize:13, fontWeight:600, color:C.text }}>{fmt(e.amount)}</span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {/* Préstamos */}
      {loansExps.length > 0 && (
        <div style={S.card}>
          <div style={{ ...S.h2, marginBottom:4 }}>Préstamos</div>
          <div style={{ fontSize:13, color:C.muted, marginBottom:16 }}>Este mes</div>
          {loansExps.map((e,i) => {
            const lColor = e.paidBy==='toba'?C.toba:C.gri;
            return (
              <div key={e.id}>
                {i>0 && <div style={{ ...S.divider, margin:'12px 0' }} />}
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                  <div>
                    <div style={{ fontSize:14, fontWeight:600, color:C.text }}>{e.description}</div>
                    <div style={{ fontSize:12, color:C.muted, marginTop:3 }}>{e.paidBy==='toba'?'Gri':'Toba'} le debe a {e.paidBy==='toba'?'Toba':'Gri'}</div>
                  </div>
                  <div style={{ fontSize:18, fontWeight:800, color:lColor }}>{fmt(e.amount)}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Historial */}
      {historyMonths.length > 0 && (
        <div style={{ marginBottom:12 }}>
          <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:12 }}>Historial</div>
          <div style={{ display:'flex', gap:10, overflowX:'auto', paddingBottom:4 }}>
            {historyMonths.map(m => {
              const mE = expenses.filter(e=>e.month===m);
              const mS = settlements.filter(s=>s.month===m);
              const { net:mNet } = calcNetBalance(mE, config, mS);
              const mDebtor = mNet>100?'Gri':mNet<-100?'Toba':null;
              const mColor  = mNet>100?C.gri:mNet<-100?C.toba:C.success;
              return (
                <button key={m} onClick={()=>setMonth(m)}
                  style={{ flexShrink:0, background:C.card, border:`1px solid ${C.border}`, borderRadius:R.md, padding:'14px 16px', cursor:'pointer', textAlign:'left', minWidth:120, fontFamily:'inherit', boxShadow:shadow.sm }}>
                  <div style={{ fontSize:11, color:C.muted, marginBottom:8, fontWeight:600, textTransform:'uppercase', letterSpacing:'0.04em' }}>{monthLabel(m)}</div>
                  <div style={{ fontSize:18, fontWeight:800, color:mColor }}>{mDebtor?fmt(Math.abs(mNet)):'🤝'}</div>
                  <div style={{ fontSize:11, color:mColor, marginTop:3, fontWeight:600 }}>{mDebtor?`Debe ${mDebtor}`:'Saldado'}</div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {mExps.length===0 && (
        <div style={{ textAlign:'center', padding:'56px 20px', color:C.muted }}>
          <img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAPIAAADDCAYAAAC4TkysAABoxUlEQVR4nO29e5RcV3kn+p33OVV16t3V1dUvtdSSJaEXfkS2ZRviMDDAMsQrkOXJ+PK4DsuLSSbDZRLyZLg3ZEHGYZhAQjJOQuLk+gYnwHLACxNM8GCDjI0laBvJaqv17Ed1d3V1vc/7df+o/ZV2H1VLsi1b6lJ9a/Xq7qrz2Gef/dvf+/uYIAigT33q08Ym9koPoE996tNrpz6Q+9SnHqA+kPvUpx6gPpD71KceoD6Q+9SnHqA+kPvUpx6gPpD71KceoD6Q+9SnHqA+kPvUpx6gPpD71KceoD6Q+9SnHqA+kPvUpx6gPpD71KceoD6Q+9SnHqA+kPvUpx6gPpD71KceoD6Q+9SnHqA+kPvUpx6gPpD71KceoD6Q+9SnHqA+kPvUpx6gPpD71KceoD6Q+9SnHqANAWTbtnOO46Tx/yAIuG7H4TFBEHBBEHCu68bfqDH2KuFce54X9X1futLj6VN3uuqB7Pu+JIpiSRCECkB7Qbmum8AFZtt2zrKsoSAIOIZhXPyMYRiP5/nGlRx7LxDDMB757bIsa3meF11cXLzXNM3RKz22Pp2jqx7InudF8e8gCDiO4zRBECq4wERRLEmStMgwjMdxnIafhc/t06snIuHwAACapm2fmZn541KpdHd/fq8euuqBjOD0fV/CxQTQBmkQBBwtcnueF/U8L4og74vWr53Cakyr1dq1vLw83Gw2962n4vTpjaerHsgsy1pBEHC+70soOiNgAQAEQai4rhv3PC/K83yD1uUkSVq8kmPvBWIYxkNpJwgCzjCMiSAIIAgCjmVZ60qPr09tuuqBDNAGLs/zDYZhPOSyoiiWkPOeOXPmE9PT039mmuaoIAirDMO4fbHv8hDNdR3HyTSbzX2SJIHjOBncWPt05Ym/+CFXnnzflwGgAQAQBAGPRqxqtXrHqVOnPnnmzJm3SZIEg4ODXxUEocJxnIYcBMHep1dHDMN4OI+e50WbzeY+nudB1/Wt/bm9emhDAJllWRP/RrHZNM3Rqampb+i6nozFYjA6OvrX2Wz228iJfd+XfN+X+pbr105BEPAMw3gsy5qu6yZ4ngfbtnNXelx9OkdXXLRGYNILw3XduOu68bm5uf80NTX1L9PT039WLpffSZ/z8ssv/0/HcZIAAI7jwMjIyIMAbeOY53lRlmWtvg53cSJGRA7/pn/j55TFeodhGEmO4xw8PwgCzrKsIQCAWq12K30+bWxEOwd9vz5dProqOLLneVF0GQG0RenZ2dnfOH369O/qus4KggDNZnNfJBKZiUQiJ3Rdn1xaWvolwzBAEATYtWvXJ+Lx+GHHcdI8z9dZljU9z4uixbtP61MQBDzLsla1Wr0jlUo9TQJpEmQe12yEBITg+74gCIIJ0Ba90agYi8WOoKvK931AaQiBizp1XyS//HTFOTIGGQCcs0ZzHKc1m819tVqNVRQFGIaBpaWlPcVi8UOO46RrtdqBRqMBsVjMGRoa+s6mTZv+BKC9UND91DfEXDpZljU0PT39Z6VS6RcZhvEEQVhlWdZCzopz6ThOxvd98DwPEOS+70uu68ZpNYbjOM113YRpmqPETcgjV++D+PWhKw5kgHO+YozOYlnWVBTltCAIYNs28Dzvy7IMAG3duNls7mNZFgRBWL3uuus+BtBejDzPN3zfl9E10vcjX5xYljWbzea+lZWVPTMzM//dNM1RBBsFPgRyOggC8DwPeJ6vk/MtnucbCGzCjaXZ2dnfOHTo0P9GcZpcZw2I+yL25aMrLlq7rhvHnRx/27adi8ViRyKRCHAcZwAAWJalnDx58vfPnDnzCc/zhFQq1czn849Eo9FpgDa3kCRpkeM4zfd9meM4ra8jX5wYhvEikciMoih+s9ncduLEiT/atm3bbzEM42JYLFquXddNAAAEQQD4HcDad+i6bmJxcfHe+fn5+2u1WvbKPNW1R1ecIyPYwoaRbDb7+MTExH+PRCIzPM/XJUkCnucNy7KEVqsFhmGoc3NzvzY/P38/AICiKKcdx0lzHKcxDOPatp3rA/nSSJblObIBwuzs7Ad835foBBQ8jhgRAeBcGCwAgGVZBfy7Vqvdevr06d81DCM7MjLyfYZh3L6q8/rTVQNkhmE81LdEUSzJsjy3efPmT+/bt+8XBwYGHkNxLpfL/TAWiwHDMOC6rnDq1KlPLiws3EcWooRiNe2y6tP6RGwKrqIopz3PA8dxYGlp6R7KUNWR2sjcAsMwIAjCKn6OUpFt27mzZ8/+10qlknVdFzKZzBP4Lvq68etLVxzIAACGYUygKIwRXGj0IgssapompFKpp/ft2/feiYmJz8my3GQYBur1+vBLL730V6ZpjkqStOg4TgagLab3fZ0XJzQOjo6O/gXHcSDLMkxPTz9ADFZxGsgAAAhktGug68nzvGij0bhheXn5tkgkAvF4fElV1SnkyN3u3Qf35aMrDmTXdeOKopwGaO/4mB7num781KlTn/zxj3/8zOrq6tuj0SgsLS398urq6ttHRkYenJiY+KzruhCJRAzXddmjR4/+reM4aVEUSygW0uLf1Ur4vHTeL8A5X+zrTYIgrAZBwA0ODn5VkiTDddsS8MLCwn1ouCLjkQnoged5GBwc/Brt4mNZ1vzZz372j0EQAMuykEqlns5ms9++HGBdL9z2QmG46Ld+rffeKHTFgczzfAOTHhiG8WRZntM0bfupU6c+efz48T+s1+v7HcdJu64Luq5DqVS6m4QJ1vP5/L+5rqtYlgX1en1/vV7fD9C2stLW0quZZFmeQ9/rwsLCfYZhTAC0n4HO7Hq9iE6KGBkZeTAIAgBoG60w3BWg7VmQJGnR931AsHMcp6EIvrCw8KuO4yQVRXFc14XR0dEvXa54d4wL8Dwvatt2zrbtHNHXzXCgCZVg411LNpIrDmSA9mLiOE7DhVssFj+0vLz8ftu2QdM0dnx8/PNvetOb/lsqlVqanZ395WKx+CHf9+V8Pv+IKIo1juNA0zS1Vqsd8H1fon2gG4EQvHNzc79WKpXubrVauwBgjWX49SaGYdyRkZEHeZ4H0zRheXn5fZhxhimjLMuavu+DKIo+AhzBOjs7+xuiKJbr9bowPDz89Xg8fvhy2Sl835dZljU5jtNEUSyJolgiRk0PAcuyrIX/E7/1NeXauuLuJ8dx0rhgXddNMAzjVqvVO0zTzEajUSORSDy3efPmT/M834hEIjNTU1NfWVpaener1dqVy+UeFUWxpChK1DRNATcCopfxG2FHXlhYuG9lZeUu13UTq6urb960adMDsVjsCEAb4Kh2vF7kum6cJJjw0Wh0enx8/C8XFhZ+1TTNMdqjwLKsRJJXIJFIPCfL8qzjOGnf9yXLsoYcx0lblpVlGAY2bdr0J77vS5cjsm696ziOk/Y8LyrL8hxuOCjGE07NX0s6+BXnyIIgVHD35Hm+zvN8wzCMCV3Xgef5+s6dOz+C0V/5fP6R66677vdkWa4tLCyMz8zMfEzTtG2+7wuiKAKpHLKh3B2RSGRGluW52dnZtzqOA+Vy+Z0Ys/xGhJgiF2MYxg2CgBseHv6yJEnFarWaXF5efh9A+x3xPF93XTduWRbIsjzH83wDs8wWFxfvDYKANwwD9u3b99/o0kyXYXwuwNqYbhwTrZbQeejXmlgNcBVwZIA2JyYW67pt2znDMPKCIMDExMRnJUlaJFFaku/7UqFQeIgspD8ql8vjvu+DLMugquqLxErqbaSk91Qq9bSqqlOVSuVOURRLrVZr9+Li4r2SJC2+3twY4NxmwTCMp+v6ZDweP5xIJJ5rNBrj9Xp9/8DAwGP0XHpem8mhJBUEAV+pVH5hdXU1OzEx8Z3Nmzd/+nJ6C1BXZxjGQ+Ol7/sSeilwMwFogx11Zzr98nKN5WqmqwLIyA0A2gskm81+XxTF0tjY2BdN0xxFo4pt2zlJkhbz+fxXZFmeXV5efr9pmqOiKJZisdiRdDr9JMC5l78RXiSJU5YHBwe/OjQ09DDLspYoiqU3SsenLc/IRbdv3/6fh4aGHo7H44dwHCzLWqqqvpDP588mk8mDnudFBUGoWJY1VK/X98diMdi+ffuvB0HAXU5vAYaCArQ3G8dx0sePH/9cpVK5M5PJPJFMJg8ODAw8Rtdxo0NMr/b3f9mIlG25Yj++73MkflfCz1qt1vZqtXor/u84Ttx13aht2+kgCMCyrJzrutEgCMB13ahlWTn6fF3XJ8LXvNp/LMvK0f+bpjn0Rr8Dx3HiOMee50n4t23bad/3OdM0h+bn5+9zXTeK81+r1fZ/5StfCRYXF+/xfZ/TNG3yco/P8zzJcZx4EASgadrkD3/4w5f/9V//NTh16tTvfve737XPnDnz8W7rCD+7Fn6YIAiu9F7ymgkt1QAAzz777E/y+fxXSICDhsacbqJW2EhiWdYQpuSRkrouhnyGzwM4V08sINk9tF6+nmgfnEvpu+KcAsceHiuOEb/D4y4U3NGN6PfyWseJ99V1fbJYLH5ofn7+/kqlkh0eHn5+dHT0S/l8/hG0pYSScK74PL8R1BNARvJ9X3r66afnJUkq7tu37xdlWZ4Nv8gweNFIgmJlvV7fb5rmqKqqU5FI5ARGN2EVTyzHi9e6EGCx1tjr/dyXi+i0RZwf3NBYlrW6Gd+CkJvn1QD+YhQGpGmao61Wa5dlWYVoNHqMuLosgE48uIkhvxvFVvJa6arQkS8HIdB4nq+vrKzs0TRtuyzLs+HjSLCIjC+bXpye50V//OMfP9NoNNhoNAqKoixls9lvDwwMfHNgYOAxGvz0AsZroqsEfZo8zzdCx3k0twNYn3O/UURvbFQqIofPSOu7QTvYQqbPXwfclzX3OAxKWZbnZFmeu9CzAFz5uX0jqec48smTJ/+f6enp3960adM/7tq16wMA5+KJaZELxUaaI3ueFz106ND/rtfrNwmCUAMAMAwj6bouMAwD8Xh8KZ/PP5LP5x9RVXUKA0/oBYPcIwgCDo1zV2QyQhTeUOjPuwEO5wifbz1QrMf11hPbXy1R5Yd4HDNuxlTAyjVb3qmngOx5XlTX9cmf/vSn36pWq8O33nrrewYGBh7rtqi66aqWZQ0tLi7ee+zYsQcMwwBJkkAURd91Xdb3fQiCABDUqqo2k8nkM/F4/BD5OSxJUrGbKB9QiQeEY1xW0fNSaD0g4xhxnOFsJcdx0rRYjXMZunYHXJfb9x3eaLo9R7d3GebOvU49AWR82bgzz8zM/PGhQ4c+et111/3o+uuv//e0nkq/YPo8TIP0fV/60Y9+9GKtVhvP5/M/3Llz50eWl5ffv7i4eK+maduINRQQ2L7vg6IovqqqL6iqOhWNRo+pqjoVi8WOdOPGtHEsCALuSujQYWNWt2NISmkCXWGGYUxYllXAXlyxWOxIeGP0fV9GffpyjpUG7KVw+WsNxAA9AmSAcyKeZVlDpmmOHT58+LumaaqbN2/+84GBgW+m0+knUdcKAxl1Qqwu8tJLL/3V7Ozsr8iybNxwww1vi8ViR3ieb2iatr1cLr+rUqncWa1W72g2m2o8Hq+Zppm0bRs4jgNBEEAUxVo0Gj0Wi8WODA4OfpXn+YYkSUVRFEtvtOjXTXRG0KE4iptKQCKkTNMc1TRth2mao6VS6W7HcTKGYQzjM6qqejaTyTxBgkeeFQShQj/bq7VyX2z8GNdNx3nTEk43Y921QhseyPiisdyMruuTkUjkBCml+yXP82Dr1q1/t2XLlk9hSB+9MJCD4Pm+70utVmvXkSNH/mFxcXHnjTfe+F8HBwe/ijG9GAhh23auVqvdWiqV7q7Vagd0Xd9CxgOmaQKpIgkcx0EkEimnUqmnUqnU0xinTPKuLyv3utD8hD8jtgG5Xq/v13V9a71e399qtXYZhjFh27biui6QNFFgWdYHAPB9n8XILo7jgOM4J51OP5lKpZ4aGBh4DGPE17vvq6ELWZ7p94f3BDgnYl9LVusND2T6ZdE+xHq9vn95efl9x48f/02GYWBgYOBHW7Zs+VQ6nX4Sd3ZarLVtOyeKYsmyrCHXdRPLy8vvn5qa+sN0Ol2+5ZZb9tAhgvTxaCzTdX3r6urq25eXl99XrVb3OE679HMkEvGDIGA9z8PqkxCNRpeSyeRBVVVfIHnARbRw04sfwyDDomI3jhfWXenvXNeNa5q2o9ls7mu1Wrvwt2VZSTKHgOsACweg2uB5HoIWyH3w+sCyLDiOA0EQgCRJfjab/XahUHgok8k8QVvs6WfCSLZwud0wt0WpATOoXu2mgO+J/kzTtO1Y1QTvFb4+qmkbxX244YGM4O3mt9U0bfuZM2c+MTc39+HV1VWIx+MwPDz8nWw2+3gikXguEonM4GJyHCdNuzQqlcqdBw8e/B7HcbB3795fzefzj+DuH66ZjZwaXU+WZQ1VKpVfqNfr+2dnZ3+dYRifBpzv+yxG5DiOA8lkcgHFf1VVp2RZnqMt4t0MTOtxGtd146SU8AFN07ZXKpVf8Dwv6jhO0nXdTqw0wzAAACBJku95Hut5Hlb+AEmSyqIolnier0ej0WlFUU5Ho9FjoiiWbNvOVavVt5TL5Xc2Go0tAAA83x6abdsQBAEkEomFsbGxLwwNDT1M17YOG8NInnmC5/n6ekkWlyuABr0IdA41/R5xQ2YYxt0o4KVpwwOZXuzo46QXC1qiSVXHLbhgSbaUkclknkgkEs/F4/FDPM83ZFmeJQn00tGjR//21KlTvzI0NPSjffv2/SLt7kAjEC3e0eByXTfuOE5GUZTTpATO+8vl8jubzeYe27bB8zzwfR8SiUTTtm3Vtm1gGAYkSYJEIvH8wMDAY4lE4lnU7elnxiAVjuM0TdO2t1qt3ZVK5c5arXaAiMYCisayLAP9jlmWBZ7nfcxowoIB0Wj0WDQanSbSQR2j1NBuQMd+k40h47pufHFx8V5d17fqup4lddWA4zgMrYTx8fG/Gxwc/Cp5DpfuAtJtQ8T70NF4AK8NyHSqrGmao7Isz3Xj1GGiq4Ne7bThgRx+0ciZAdpcCxdMtVq9Y3Fx8d7l5eX367oukLrYgFxKlmUQRbG8ZcuWT+Xz+UcEQagUi8UPvvjiiw95ngc/93M/955sNvs41gTDQggsy1qkA6TneV7UMIwJ3/clWZbnUPRGoAftUkZj1Wr1jpWVlbvq9frN9Xp9GCtuCILQAQEBnMPzfD2ZTB4cHBz8WiKReNZxnEy5XH7n8vLy+5vN5k4UbfEcQRBAEIQmqTVtYoVMUtBwNhKJnJAkqYhjxiJ6aOhyXTeBnIllWYvUsu6EoNKGQtw4DcOYaDab+5rN5j5i3U66rgu+76MqUcPNEm0FYcMYvi/63WJ4Lf1+X836cBwng6ClPRQoPVFBPG54HfWB/AYRrUt1e9lhg4dhGBOrq6tvLxaLHyyXy7cAAALZ1zSNlWUZksnkT7dv3/7ryWTymR//+MfPzM/P3zI5OfnPu3fv/hXbtnOCIFSw1hb9oukxoF+W1r+6GbdWVlbuqlard9RqtQOmaY45jpNEjo2SA7k2sCzr+L4voHjMsiwMDg5+A0VTzOcmgJ2RJGmRtlBjEIXv+7LjOGnHcdIMlbtN+5LJtepoFCP9uBI413i/Wq12wHXdhK7rk/V6/eZGo7HNcRy03huO4yhoL1AUxVFVdYoA+mkSBjtzIb82Zj+9WiDTXBU3Xtd145IkLdISAW5eeN5Gs3pveCAjrWehxEVBN0anjWMYhF+v1/evrq7e4rouiKIIo6Ojf71t27bfnJ+fv//o0aMPCIIA+/fvv1mSpKIkSUVN03bQorbfbplSx+sT7hbHnZ7iQDy6fVAfQz+t4zhpXde31mq1A5VK5c5Wq7WFYRjwPK+d4cIwHd2WZVngOM7J5XKPYiofXcSQtHeRyI8M0N5IMAkExWWSC25SC1rG6hv4I8vyHNoTLMsaajQaNzabzX2WZQ2RDShvWRawLAuyLDssy5qWZamGYUAymWxiZB0AAKnkAqqqOplM5omhoaGHUaxHuwCK32j7IGN/zToyQLuRwcsvv/w/h4eHv5xOp5/UdX1SEIQKraNfrnu+kdQzQAY4B1qay6wXPkiOlzFDynXdRKlUuvv48eOfq9frQjKZNG644Ya3SZK0ODU19S/Ly8t7tm/f/uejo6NfwtI4CF5yzU5iBQKU5/m6ZVkFeqenxEiTYRgPW90IgrBK64WmaY5ZljVUKpXuRouzYRjDqFsTDg2O44AkSaAoyllFUU5HIpGZRCLxXCqVeioSiZwwDGOCZVkT/cW4wWBPJtRbafuCIAirWHjPtu2cZVmFVqu1q9Fo3ID+ZdwYHcdR0cJNqQQ+VhBB/zOxbIMgCE2yWQi+74PjOJBOpxeGhoYeHhgY+Cb67MPv6nL5o23bzr3wwgtfd103vn379v985MiRfxgdHf0SbZijDWAbpRHghgdy2GhxKQEQYaMULXodO3bsL1dWVu7SdV257rrrPrdt27bfOnbs2F+8/PLLH81msyf37t37S77vy7Isz5K6ViYd9xseX3ghMu0iCjz9HXJx2oiFACO1utOtVmuXrutbNU3bTprY3WgYhiAIQifSDN1biqI4sVjsiCzLs+l0+slIJDJDAFJHPRjHgoDEzS8IAp6U9Ck4jpPRdX1S1/WtjUbjRl3XhzFEleO4jnRAJIWOr5l2ZxH1wCD6dhJBTSQKYBgGTNMEz/MgGo3C4ODgN/L5/CPJZPKgKIol3ARfLZDp1FTDMCZ4nq8bhjHxzDPPHHJdF7LZ7E937tz5kXg8fjh8fN/YdYWI9rdebDelAUZbNWdmZv74+PHjvx0EAQwMDDx/4403/rxt27kf/OAHpxzHgTe/+c0fikQiMwhm3CDQIITXR8MQ3oP+PHSMF/4s9Ewd/R+v6fu+bJrmqGVZhaWlpXt0Xd9K/MIKiuAIbgCAwcHB51mWtQYGBr4ZjUanGYZxU6nU041G4wayiZjIrYjr6lYiOhd0Xc9SY+v8xh80tJE57agARGLwXdftBJGIogixWOwldGWxLGuZpjmK4jlAu9e153mQTqfPFgqFh3K53KModpPv05SKQLv05HA8eLcIL9M0R59//vkfkGKHyRtvvPET2M2TlA86L15+I9CGBzIdE0zvpgAXrkJJA5neABYWFu77yU9+8jeKojiKopw+cODAda7rxqenp//sxIkTHxgbG/vO5OTk75NyQqsXqt18IQBf6JgwmGkQo0Thum7ctu2coiinLcsqoBtK07TtxIK80zCMDudzXRc4joNEInE2nU4/uXXr1t9xXTdOXEdbsS64pmlbXNcFekNADozBImTeAQDAdd2OmI/f4bl4nCRJTYxFx15eqEK4rpuwLKtgGMaEYRgTmqZt13Vd9X2/E/Kay+W+USgUHkqlUk+H/c3d4qrDUhmqKn674mdhYWHhvng8frjZbO7VNG3H9u3b/3MikXiOvu5GEqsBegTI+Dfu2ghomtOGCYGMVloU0ZeXl9/37LPPflVV1aYoiqXbbrttEiO3nn766Z8BAOzfv//teD9KNL2gCPhagYzjDQc04KJFoGMRd9M0x2zbzq2urr691Wrt8n1fqtVqec/zIJlMNkdHR/+CBHfcQYCkoNgsCALwPN8Rl8k8dYJY6DUjiqJBxHEBwc3zPIiiWOZ5vj44OPg1QRBWiZjsoQGNfk6O4zR03dm2nXMcJ6Np2vZGozHOMAy21oWBgYHnR0dHv5TJZJ5AdYrmyuH5xMb3tCfB933Jtu1cJBI5YVnW0Pz8/P2FQuHvFUU5HQ7f7QP5DSTc1Y8fP/65nTt3fgRFZd/3pQvlAuOLR18hvvRTp0598ujRo5/ieR5yudz39+3b916Atpvp0KFD/3t+fv6tO3bs+NN4PH5YFMVlx3EyNLcM3YNnQ0Xaw8DtBlr6e/xN+3LRwIaBGQTcdQzwoMV19PEyDOOWy+V3nTx58sPE1+zoui4QwHas4Hgvz/ME2lqOHJfWh8n1WYa0kREEwUF9XFXVKUVRTuM40Bruum4CQx95nq+3Wq1dqAsjeDCWnXDnrYZhTJimmXccBxiGgVgstjQ0NPRwPp9/hM7CCod5AnQP0USidWA6jh7/30hx2hu+QgjDMJ6u61uPHTv2YZZlzR07dvwnQRAqmqZtfyVJ/egbXllZeY8gCGAYBqTT6SfR+AQAMDIy8mCtVjswPz9//6ZNmx4QRXEZAUb8s2uuicBbb9xhvZp8ToN3DbelPueJlVzGKihBEPC2befQ+oyWakVRTqMons1mHz99+vSHiagtSJIELMv6IUOXgs9B68RIRPdmUQdXFMWXJGkxFosdiUajx0iD+gpGhxmGMYHXx8AL1GFDwJHxNzYaUBTltCiKJVVVp1zXTZimOdZoNG6o1+v5Vqv1mwsLC78ai8WO5HK5R4eGhh7uBlg6EIS4xQrob6eDUmgPBPWsGwbMGx7IAO0XPjw8/GK1Wn0LfiZJUvFSXgS9e1cqlTsbjcabsSthNpt9nOqCEU+n009mMpknTp069e5Go3GjqqpTCDbMxQ1fnxb9Eby05RrdZdQxa0RwNOLQQKYWvbReDWlihONbrdYuhmFc13UTkiQVo9FozbbtJNMOBy3rup5lWZZlGEYAANqFZGD0muu6rOM4gHqrJEl+JBI5IYpiKZ/Pf4W4mlqUHzhmmuYobRBE1xy5B48iNl36lyU9nrDfMsuylizLc9hSh9TnOmSa5milUvmFZrOZrNVqt62urt62vLz8voGBgceSyeRBWZbnBEFYpS3OqEfT/axwgyMBMJ2Y8AsFGF2ttOFFayTCTe8aHR39i0txG4R1Kl3XJ48ePfp35XL5NoZhIJPJ/PCGG254G24EaDgrFosf/MlPfvJQKpU6PjIy8iAd4ojX7qYDr6cjh7l2+FwUN2nwo7hOSwtdnq/j4kJxm+M4bX5+/v6ZmZlfFwQBAAA4jutwZICOHtnRh5E7syzbMVolEolnE4nEc4qinEZRGcEalgiw4RodNYbfMQzj0k3S6bHj+8FEBzRKIuhRKkE7QL1eFwAAVFWFgYGBb42NjX0hk8l8F116GGBCp6t2mz+0im8UtxPShufIqNvIsjw3Ojr6F7jwL9VYgWJeq9XatbKychvP82BZVqdJt2VZQ7Q/M5VKPZ1KpY6TjhgTpC0pTy8+hmE64KQATocASjTA1xPBiS5Zp5JCOi1OEcy4ICmutiZmGI/HRZxKpZ7yPO/XY7FYzXGcJBGT2SAIBFoXJvcHVVUXIpHITDweP6Sq6guSJBUB2gBrNBo3UuWCaYlBoo1aqMPjWIinoePXx+fA3l/43jCkEr8HaIvKGKiiadoOSZKKg4ODX81ms1HDMCaq1eqeubm5d+Oxqqq+QM+p4zgZSqzuiNY4X7Rx9FISK64W6hmOvF4EEIqfqBfhZ+Gg/eeff/4HlUrlJgCAdDr9/P79+3+OArHneV602WzuNU1zrFgsfmhhYeEdkUjEiMfjh9Pp9PeQ46GoiGGXyE1YljXRwAPQ1tnQhUXGwWOCBYqq5LgYea7OxoDA6Qb+sJiO4iNubizLWsePH/9ctVrdyXEcKIqyVKvV8rFYzGg0GoqiKBCJRBZQ383lco/i5kCrCTje0KYi47h80k+ZnuNu9gA0ctFiN96HRIZN4HPgBkUH+DiOk2FZ1nRdN6Fp2g4Uw4Mg4FRVfWH//v034XXD9+62XjYqbXiOjLTeC2EYxkUugkQHF/A8Xy+Xy+9cWlq6SRAEIKl49ePHj/8Jy7LW6urq20lk1RbTNEFRFPA8D0Mji9Vq9TYMWVQU5XQsFjsiCMJqJBI5EY/HD6O4iX5fupgdcnOySD1ab6bjtynDGGYKdXynYbEcr4HGMpwbvA9A26bQarV2ep4HjUYjL0kSEK7bSKVST8Xj8UOSJC1iFFS3eQ0D41LfDUoQ9DjRTkBZ+DtJE8lk8qBlWQWqJ7KFerRpmqPE2DmpaZqKbir8wee/FqhngHwhQpeUaZqjrusmPM+Lapq2o9Fo3NBoNG702/WoIR6Pn0R3zfT09NuYdglc9Is24/H4XCqVekrTtB0LCwtvbTabW4IggFarNU6qbmY1TdvOsqwVi8WOoNUVG41h6iABJIfuIzoWmoiW6M7qlPLFZwmL7wzD0Iv1PMOZT6pxoIXY87yoqqpTJPgjm8vlni8UCg+xbLvnFElxrODGQ923wzHXs8R3ozCYUKTF61EZVh2AE6nE4jhOq9VqB1C9cF03QUJFt6JU1Wq1khjskkwmDVmW51qt1ragnQ/dCdYJb3KXOv6NQj0LZFxAL7/88p+apjmKEUwYrO+6LliWBaqqdmJ+V1dXt8Tj8Vo0Gp2+6aabnkUfJWY1YU7v0tLSf6jX6/td11UURVkg/tudJAlAtSxLbTabbw2C4K3RaNSQZXmOds3QIZf4N20oQncWiq+UWNnNKr6mYHyIQ2PVSdN13QTRkxOKopyWJKnYbDazgiBUstnst03THOV5vo73dBwng6I+NafniccXI2rj6mwE9DiJz7/zDLjBEVdYnGEYF2PLHccRUH+3bRssy1Ky2WwtEonMYEM327Zzx44d+0vbtpX1xOlepJ4FMtLi4uK91Wo16ZP2qwzDgCzLhqqqUzzPN+bn59/BkBDEiYmJvx4fH/889vcNu6/QKEIMOYrv+yAIwipacC3LKpBEhzTR2YRWq6Xour6tXq9v4zgORFGsYZaSLMuzYWMKCXCJB0GQ9qlWNuS7MFdc07GxmziNz4A6ueu6cdyUGIaBRqNxg2VZQwhSTGvEH0yweLVE/OsdH3GYQ6PEgRua4zhpEq652XGcdK1WG8egFcz8UhTFHx0d/XYymTyYSCSeE0WxFI1GjzEM49VqtVsty1KYdpDKGr8wSiu9KHL3NJCDIOBJSl5yaGjo+xMTE58hvsRVRVFOa5q2o16v77csK2lZFoyMjDwoSVKRrnGNhjIseUN8snEM7vd9X0bfJHJR3PkjkcgOBA+W8zFNM9lqtd4sCMKbeZ53IpHIDAHWMgZSkBahGu1Cop5pTdsWOnKMYZjzXGBBEPBY5YMEjEgcx2myLM9JkuS7rpswDGNzPB4/hIYntCyH5hINVq8IBHSmFY41rCqgvmsYxmYC4iQWI8B6YLIsl9Pp9JMDAwOPpVKpp3CDoz0TlE8fRFEMuwRplcPrNTD3LJCRwziOk3EcB2Kx2JFMJvNdmqsuLCzcZ1lWUtM0GBwcPBmPxw8jh8Aey1gN0nXdhOM4aVw4oiiu8b8yDOMiFw9IZQs6b5mMI23bdo78sJZlCaZp7iThjYYgCBWs7oHWcuSoyLFoMbUbhVxcaLVO8DxfR27r+74ciURmotHodLVa3bmysnKXqqpTaFzDMaOYTc3pK178lJW9E8OM9cxIYYetuq5PtlqtvGVZEAQBCIIA0WjUURTldDabfTwejx9OpVJPYXHEkNSxZmMjXgLgeb6Jm1E3Q2ivgblngYzE83zd9/0kJtNbljUUiUROcByn6bq+VZblcqvVyo6MjDwIsDZEEjkYQGdBdhqdWZbFOo7DqqraqSmFxiQ0EomiWCLgsUiRuyKlg6Ydx8lYljXk+75s27aiadowy7LDkiTtlyRpkeM4jfSYMrEGF24eCI5Q5FhXSzUdQUWAykmSVFQU5XS9Xt+padp2stmkqeALGaOeXsv80+41LAmE5XhN01RRXOZ5HlKpVA3LAKXT6e+tV2QAnw//DqUvciR769ppcg49AmTaoY9/k1zXnOu6CVmWAZMbIpHIiVartSsWix1pNpv76vV6UlVVUFV1CqBtVcVAAE3TCuGgEnQNMaTiJbqdbNvOoaFGluVZ13UTCOiwkYiIz6sMw0xbllVACzG6WDzPY1ut1rDv+9BsNrex7RI6C7FY7IgoisuYyigIwiod4kmL9Xg/jFQyTXOUlhBIBtAM0ZP34L3Rwm7bdg6L8gN0ysXKxKqOYn9nYwjaUVIt6nm5gJSgxTTJRqOxxzRNCIKg4yJSFKWWSCSey+Vyj6bT6e9hKeBu77kbMDHYBSUX8u6AxIzjJty1WH4vAb0ngPxKCbmE67pxVVUNlmWtSCRyArkSitN0HDDAeWGYa65Jc3Janw5ZZMPNzzisaEkVu5dpP7KmaVs8zwNN04YNwxjmed5AYxWeh5b1cFICAZdGEhxkLLaH98bn8H0fNE3bkUgknkW1A11iVIE+jy6EhwEflmUV0LVGpyNiRZN6vb7ftm2WKtgP6XT6+9ls9nHskYVlgcJzg/e61PeK5wQ9EuT0SuiaAHIYdJQxi/V9X2EYRkFfJUMitEzTHEWdF2Bt/C993VCgRic4Hw1feC7GLIe5M0oP6McFWBMQIsuyPIe6pKZpScuyFFEUh1ECQD81ghsLy9OxzLQojmPE0EpVVV+qVCo7FxcX700mkwcxcSEIAt4wjAlRFEtoI0DDFbVpmGitR3GZFDfYZppmp55YJBJpFgqFp9Pp9JPxePwQluhFuwLRcztJFZcjYeFaA3PPA5mIngDQ4YgWQNuaKklSWdO0LABAs9ncl06nn0RR0XGcNFnEHcsxAaT8SnyphEMiF/T8dj2rDphd1+0YZCgduKOLY04vWfC3WpalchznE7GVtW07z7RjpLfwPO8IgrAqSdIiWt+RU4ZDQ3FTSqVST2FlDsqnLeMmhpFomO+MOj6qBKurq29HDoy5yYqiOLlc7oiiKKcKhcLfo5fgIvnha0CM830xHT3sG36lfu5eoZ5/aM/zlOBcIbhOsTme5+u5XO7RhYWF+1zXZZeWlu5RVXUK43vxfOS4tEuGcA9MuDfRqowGlhD384IgQL0VM4zowIhOpBcdq0wszoBVNnE85J4W4aoquS547d5Sgm3bedM08xzH7WJJ/WmaU9MSA0lTzBB7QhJjwx3HyUSj0WNo6cbxuK6baDab+1ZXV99eqVTu1HVdQUOVoijNfD5/JJFIPJdMJg/G4/HDsizP0qI8XRmEBihKQfR7ww0FyMa7HnUL8rjWuDHANQBkn1SXpCy4WKXSKxQKDy0uLt7ruq5SLpffNTw8/GUMMECLNcWJsdQuJvYDwLluFnToIRqDKJ2ND1uY/XPpgRYVnsjRC7Nb0IfXLlyv8DxvsCzbqeCBHSrI/cBxHCEIAqHVaqkcx42T8j1NnrR4xdY4KCY7jpOsVqtvKRQKD6GbR9O07UEQ8OhvbzQaN+i6nnccB0jOtl8oFP4es6PCPaEpw2Bn4yDjw26Qa3pboXUfz7+U7LWQT/oVR571CvX8Q+Nip3yKHW6pquoLmUzmCcuy3qvr+vDi4uK9vu9LqVTqaVKsTUY3Tvi6tN6NHIvcr8OhAToZQZ5PalGjZZn8Hda5O9Zn/AwzplAftixLJVUpFTRUMaQED0van5JrsEG7lrRBNiKBFI1XW63WMM/zN/E83xwaGnqYuKKGGo3Gjfl8/hEAgHq9fvPKyspdpDpnwbIsgYjNtaGhoaeIlflJFLvDIjDlT+/qPkLr+Hrv7VJF6z61qeeBzPN8MwgCNcQNO6Detm3bb+q6vrVare48derUrxuGMZFIJJ7DCpXdqmRSFuo17U1oyzVtWKK/IyJ4GMBu6LeH17QsK4OLmlh3OyVjOY4Dnuf9IAiwljQbUBUsGYYB13UV6j5r8o09z4vOzMx8NBaLNUVRLK2srNzGsuwfGYYxUa/Xt2iaBrFYDGKx2MLIyMijg4ODXyV+bYs8yxqQIZdF0Rmt2Ph/2ICF6gTOC/092gpeybu+lmnDAxl9hOG4aIC2QctxHFUUxa6ZMOhX3rp16++cOHHijxYXFzEp/euFQuEhrD6JyQZ0TjPHcVj6RovFYkeI8SchCEKFtGidbTQaN6Kri9zzPDGQHhftqkIuj3oqaWuyCnCuo6LjOCwAsOT486zzYaKPCdoVQFhZloEY0NRYLLZQKpXeZts2jIyM/Nvw8PCXRVEsJRKJ57pV0gjPdzcueyGuS+vGaCegvwNYm9yPmwTaFfA4uogEWQdr9GR8d3geVXVlTU3zcPG+9fzPVyOxV3oAbwTRLxUXAv62LGsolUo9tXnz5k8PDw8/z7IsnDp16t3T09N/Vq/X9zMM46K7RNf1rc1mcy/hjo7jOEA6MqTRMozBFizLWqlU6inkTChuoz5NGbRM+ntaTKfG2ykby/N8kzwTy7Kv/fWxLOsAtAvDW5Y1xJBAF0mSivF4/FA6nX6SNCeXANolkegG7K95AISQA+MPuqTQl09qgNGVVTzq73Wzmsi7wuokHXEfz0UQB6QkEoIY3X+X6/leb9rwHLkb4U5K7/BhPZdeEKZpjmUymSei0ej09PT0ny0tLb212Wzmp6amvlAoFL6fz+cfiUajx7CgH+U7BixagNwTuTeWfqV2dz688IMg8NDYQ4nTa+Kp0eCF1xdFsYT9li7GgS91rlC6cF2X5TgOTNOEM2fOfKDZbO7btWvXB2Kx2BHkfHTk1YUAdDmJJUX48H2SjUXuVoYHDZE4N9i8AOD8WtUo2mOWFwa3KIpy+lIMbVcT9SSQkWjw0sEZtAXZ931JUZTThmFMBEHA7d2795ey2ex9x48ff8A0TZidnX1rpVJ5ayaT+bfBwcGvKYpyigCOReMVBlDg7h+JRGbwvlgwAF1PofGF63qha4q2dneOYVnWkiRpkbRfFWhL9asl0zRZSZI6OdmZTObfAACWlpbetry8vCcIgn/ct2/feyORyAnabUR1mrwsXRLDhBwXwYciMTH+NQDgvOJ49AaIRG+eKE7T40fA0h0ZsWUuWu83AvU8kIkll8UFgy8WgyJkWZ5rNpt7MSmh2WzuSyaTB6+//vp3LS4u3lur1Q7U6/XxM2fOvK1SqdyZSqWeJr5Vn+d5FndwSZIWm83mXoyk4nm+LsvyHNZoBuiIyRxDFedDQjGZcOdOpQx64+E4ziVlXuuO42ThMhDP88BxnOG6rmJZFgiCUMGKIaVS6d2NRmPnyy+//KfXXXfdxyKRyAld1yeJT7phWdbQep08XgnRrjqATgFBD6Cji2OjPIt0hxwCAKBbsVIbJkdzZFR3aAMk5RJb0+gcz8ew19f6XG8kbXgg40Lv9llYtKZ8wh19qV6v708kEs9ZljWEVRkB2oanTZs2PVCr1Q5omrajUqncWa1Wd87Pz79VFEUQBMHneR4wtphvt0atoB/VNM1RugsFQLtiBxMq0UOPn2GYNe4WHC9DFb7jeb4uSVLRtu3sa+XG5Ho+0w4uAdd1wfd9SVXVKdI7eOvq6uq2YrH4bt/3pS1btnwqmUw+A3CuQ8flKDywnv8XRWpMfZQkaZFklMXxe+I1kH3f7/jj8XyyoTborC4sRIibI74vus42nh/uJXY104YH8noUAvGa79DYFQQBL4piqdFo3CBJUlFV1Sks6CaKYknX9UlFUU5Ho9HpdDr9vUql8gulUulu0zSHSZw2rKys3GTb9p9Go9FpRVFOYV8iNNTgogM4x3WpcXme53UivEJFAjpNzuhCB6Io1rFou+M46mudJ9u2WYZhVFmWm5FIRCUbxWKhUHgoEonMHDly5B9c140vLi6+jWEYb/fu3b+CXTmwX9JruX83gxIBpgwAMD8/f//S0tI9lUpl58DAwPM7d+78iKqqL3ieF221WrtIAfyOCxB15ND1JNoyjZ6H+fn5++fn5++3bTuXTCYPTkxMfBaTV0illw0BYoAeBjJAdx0ZOSSCGYP3MW+Y5/kGFumTJGnRp8raDg0NPRyPxw8tLy+/v1wuv1PXdVaWZajX6+OVSmUcACASidwvimIpHo8f3rRp0wMISIor0wEha0rMAqwpPt9xkSGXJoYZC+OnLweQBUEAy2oLAb7vQ6vV2o0un2w2+/jWrVt/hyz2N5dKpXccPXr0bycnJ/8gFosd0TRt+2sVrWm/M/0ZWo2np6f/UFGUmiAIUKlUbjp9+vTvbdmy5VNokKLAu6a2OMC5oovd1oFt27mzZ89+PB6PH9q7d+8vMQzjHj9+/HMMw7i7d+/+j6IolkzTHN0oenLPABkXAi5+1IFc12VJ2Re6qBvGNHN0AgFaQ8n1TFwEaBBBQBNOy8qyDJlM5keTk5N/UK/X9+u6vrVSqdyJOcCYeIE7POrOAOeCJ3ABUkEqHiVuehhUQbWuSbAsa0Wj0WnTNPPEN+xblsUGQQCKojie5wmu64IkSY7necKF5o1hGF8URdZxHJXjOMDnQ7F+ZGTkQdRLW61WvlgsvjcIAn5iYuIz8Xj8sGmao5FI5ASRZFxMykAD4sUKvFNGSI9lWRPVFJZlrdnZ2f+CahDLsj7P81a1Wr2DvNcEzmkoxNVjzgW+uBezPmOTOKadsz0WBAGn6/rWWCx2BI1s+F4uvgqvHPUMkLtRN/cTvWsjgPAzTIwIiWnnVYCkDSo8zzcSicRz8Xj8EM/zDezzi/5n9CmH3ElrQhAp63WHC2MsNu2+wvFyHOcSEbis63qW53mW53mMKxfIeeD7/gVBTK7b1RnNUMX7Nm/e/OkgCLiZmZlP+b4PtVrtwNmzZz8+Pj7+eUmSFkul0i+mUqmnMXc5FosdaTQaNySTyWfWq4sdGgOPzx5+T5hg4vs+i0bAgAoewTFS6aadnGRqfjvrHDd8URRLExMTnz169Oj/+vGPf/y453mgKIozOjr6Jdx8NpILqmeAjLtx6LNwIj+9SPgwaPF/kqrYFcDU+QDQ5uJ0fyHMMkLxkNZ7aUs0vcBC16Wjvzq6fBAEnuu6HWOOIAiVaDQ6rev6baSovs+yLIs1njmO8z3PYy/maw5C/Y7DhAt/bGzsiwAAMzMzn6rVakkA+AXf9+Vt27b9JtY6I/WwE41G4waWZa1Go3HDxcCAz0fPEc4HeQ/g+75AYtU7qaSUuoHGLjpvHJ9rjacCA27Qyl0oFB4aGRl5sFqt3oGhudFodBrgnM/5tdoA3ijqGSAj0W4dAhyg/+/CgTudDUPBHue1MKGBiNfECprYpJthGBfdF/SCI+evqTmNEV7UGGTkTCzLYkKES64FqBOiyCjL8qyiKDVd15Oe57GCIBhYppfjOI9hmFcU+rUeoNF6u2XLlv/bsqzC2bNnP6LrelLX9XdzHKcRW4ALcM61g0XwLxY0QrhsZ74RmNS11hyPGyRD1SfDdxm+VxC0K4fSmyldEJ/n+YbneVHs5xxqKbSmr/XVThseyN0WCh3iB3BOzMIFg4ClxTFKlD6Pi3fhnFxwLo3R5Hm+EY1Gp/EeWOoHx0f5iOlWKZ0i9PgdrRsTDkRzEwufFQMZeJ6vJxKJ50zTfIfruiAIAnAch2mbHMuyvu/7rxTMHP0b9Xxsr7Njx46PCoJQmZmZ+W3f96FYLP6y67qJ7du3/zqmfsZisSPYIeJiYY6Ur5zuBtkJ1uE4DliWdXzfF0J+4E6CCc3FyWcdPzJ6D/CZmHbJogaRotaEZdJzDdDewDZKE7cND2SkYB1/cpfjuC5A5ikwr1tuNvw5wzBgWVaBLBDknJ0ysmQhaigiEwkAz8VmZ2tAHbRDNF1KpEZjS9e60JFIZCYSiexttVp5z/MUhmF8hmFY3/dZjuMcuEg8PdMuV3TeHOGmQwVK8I7jZERRLI2NjX0hCAJufn7+/kajoVYqlTvn5uZ+bWBg4DFBEFZJrfAC1um+0P2pzWpNu9SAGCfX48jsuUoiLnLxkBrTmWf8jE6WQOkGCyfgvNKqgCRJi33R+goRLvLwLk191vlBcYxePCGuSYvp59XrAmjnCwOcq+aI32PcNcmo6cRTk2PP8ymTe3TCMekx0UEX4c2KZVlTVdUXSKywQqLNfM/z2EsxduGz0GCm5kdCnzGWPdJ1fTISiZzYvHnzpxmG8WZmZn7bdV3h2LFjH/M8L5rL5R5FvyxW5rzY/SmLPVqgO2oP6sio8wbtlM0OcMkx4U25c130wePchQHfzX2GKtLliFp7o6jngExTyIhCG5TClk8uBJ7zdGE8lwY3EeFcNI4BdGKrOxFZtPhMc9XgnIX6vJBN5DSEI0q0Hk1vCABtLhOJRGZIp4adQbvUrOb7vup5XtcNgyaGYXyguDY9PwDtbKdIJHICo6sURTmNQNq6devvAACcPXv24yzLCmfOnPmI53nR0dHRL2matgOljkt9T/RvfD/E/YQx6NiAveNqQgkLrf/UO8XMpwaVLGHhnNHeA5xb3Ig3ijhNU88CGUXdIAiAZVk6nG9N9wFapMbzaBDjOUScsxzHydi2PYi6aNgwQl+H/KZdH0Adx6PIjcEptKGHOZfOh4sR46077ijU9Zh2XvWMaZqjmqapnuepgiD4HMd5oQXP4nwQEdxDrk3rlDQX5ThOI+mNHgmwyOB3tm3nNm3a9IAkScUTJ078UblcVpeWlu4BAEin009GIpGZi4Vw0sZGfC7XdRP4rJjMgQUVRFH0MZQSvQXkOST02WMyCc4VSyqD4vPg56gDh4sahNbRVe0/RupZICOhmBXe7fF7yliyxtiFAA/5lMPcuKseTl33vGAC5MChYzsGMVyUtLhIc3IcG/72PC8ajUanJUkqmqY5ZprmmwEAfN9nMS2RYRiWBEn49AbmeV6nu+E6c7deYffOPLAsa2Wz2cf9dtzyrzYajW3FYvFXXNdN5PP5RzhStP4C91jjEsR5pt8FuWfX88PqT/h9YHQWgheDdUjtsg2jA1+MrgkgU/pVV+NXF5FuDYCRK1Nc1mVCFTmQM4SvHxYtQxbsNRU2UQzH6Cj0j+L4aM6B44xGo9Po+orFYj9jWdZsNBo3ep4nRKPRMiZXBCSAhbIOC/hZtzm51Pm1bTsnSdLi0NDQwwzDeC+//PL/qNfroCjKvnw+/8jFrNaoguD80hZr/JuaS3ruOuoLfkb7k/Ez9AXjvIUj6y5mjNso1PNADoOt2wK4AMjR39wB03rHhu65ptk4/kbwkut09GDk3vg9ZfCR6Gug3ohjA2iHjaIvVJbl2Xq9fjPpqyTwPB/lOM4goGCDIGCxPDDTjkpzwgYx+tnWe04aGNjHimVZKx6PH4pEIicNw9iCft5L2RSoZ8efjpREnr/bOZ3vaU8Bmc/O3DPtUNlMQFxNVKmmDRO1dSl0TQB5vYUAcG4RhEVucq5L6W5caJHT/ul1xetun2PCBM2V8W/MhsJr0t0RwxwaoF3A3nXdRKvV2rW6uvp2nufr+Xz+kUqlcufS0tKWWCzWmQccN1rNidX3PMs2ff0wR6U3QHp8nufxVNcLCIi76lI4XshzsEa0pt9d+D3Smx09N/Q7DxchIGDn0BffF603CIU4MocWZnRFdANiaFHx1HG0r/nVjGUNp6ZFa7/dS4lHYxO10cgk6MQCgAYdfQbQrj3darV2NxqNGwAABgYGHksmkweJ6+seTdPyATFwkdxjQKPXhcReWgK52HNRwHAdx8nQvvKLSS94L+TeoTlGGwOW+T3Puk5HdNEcnDyfVC6X30mi4OZkWZ6lgz/CIbQbmXoeyAFl7MJdm+hjXtgNQXNm5IDhLCW87nqc/mJE+7lDLic3IMYrkpHFEyt5p5wsOS9q23bOcZy053nRM2fOfERV1bP5fP4R7HHcarV2sSxrTUxMfHZ2dvY3sDRQEAQssVYDAJyXVIESxit5HhoMRIxNA5yr7x3Wc9eZE9c/V/+7E67aRRroGBEvpOKg1OG6buLFF1/8J47jtEgkciKdTn8vlUo9HY1Gj2EYbZ8jbyCiROAOQFFs5jguHJ/LUQDuiGuU2IbuotdU/A65FaVDc6jnoasExT86Z1rX9cl6vX4zKSukbtmy5U+xqommadsB2hFJLCkoNzAw8FilUrmzXq/vcV0XWGJtI+P3gy7ZT9248XpqApbopfzcPFrzw3HO68xDJ8QS3w9uauTvdc+l3seauuBkPICRbq7rqqZp5svl8m0Mw0A8Hn9pbGzsi8PDw39zobFtJOp5IDMMA57ngSzLq1hPi3zuol8Ud/cwaAHaYEKuiBE/zLnQyrDu3LXOEx6DXDUkYnsAAJZlFUgdbZlU3uh0Q2QYxm21WruKxeKHarXaTlmWm7lc7lGsN41jVhTlNHVPnuM4DbN5GIbx6vX6m7GwPUC7OggpVwSyLDcBQMXSt4IgVLCeFT5Dt2fDDQ/zt5l2QoeAnPliVmtKP+4kPmCu8cDAwGOWZd1v27bg+z5Eo9FaJpN5wm+3iM0gt8cwUtwA8L0H7Z5YLMkGcwBA8Ns9p3eeOHHij+bn5++/+eabryfzP4TuKIaUBKK7ZFzt1PNABlgrMtK/uxi3vOCcFXnd6K5XKn4yXbom4MLlOE7TNG27ZVkF7LyIG04ymTxYKpXuLhaLH1pdXd0myzIUCoVvJJPJg5IkLXIc18KAi1CWFU9vSKRBekkQhNXV1dW3kSJ7oChKE6uMECmk062RJfW3LwWItMuI3BtVmYuK1SzVOof+jb7zoaGhh7HgA3Z1pCuDkONpqz9tte64+2g1wvd9sG0767pu4mc/+9n/t2vXrg9gWR/KTbVhQAxwjQAZKQxOyjhyXs+lixlqgnNB+a8q8ochAfqYVeS6bgJ7MouiWKpUKne+/PLLf1qpVHYqimKMj49/fWBg4DGszEkXUKekjE4sNwCs8YOLolhKp9NPSpJUxF7GmqappHoK+L4vEINYJ5UPx3cp8xqEyv3S9oZLmIs1vmD8DHVb8l3nOmjnQCnHD7WqJed3VAfaMEk2DnBdF4IgEE6ePPkrw8PDX06n00/ShfdRv98o1TR7Hsioy9K6VJi6GU4uYEhBQwt9j0uJJ+6qb+q6vpXn+XosFjsSiURmFhcX7z1z5swnNE0bliSpOTY29s+JROI5EuxhBUHAC4JQYdulXAvo/uny3B0DGaoPgiBUMpnMd6PR6HS5XH5XpVK5DY9HS7MgCKt0SOPFKPzsZJ6F8OayHhE9uLPBoo6MxjI0SIb8/nzo/I5q1OX69BrAMdKWbVhYWLhPVdUpPAc3po0CYoBrCMhhojlGl7/paK81f7+GcXRCNmkXkqqqU7Va7cDS0tI99Xr95lqtdqvjOOrg4OB3RkZG/hcRtz3btnOmaY4xDONKklTEKiRUDHkncYNwM2yc5mKWkO/7EtaEzmazj2ez2ceLxeKHLMsasm1bdRwHixt04p0vtpiDUGcMen7paLj1CPViBCNtAKTSQtf0VaYNaGjhp7k0OZaee2BZtsOdA+KO4zjO4XkearXaATrTaSP6l3seyGGixT3UUwHOgYsGGS2aslRLVPp6l8KNqWM7bWps2044jpMul8vvqlardywuLr7XMAwYHBw8/qY3ven/xI6QqC8LglBRFOW0bds5Xde3AgBgCxuG1Mim70PGZWGyB3HtdHzUoiiWZFmeHRgY+KZlWYVqtfqWarU6jJwYjYGXoueGXEYSiuq0e+9C74OMX8Jxo00hIP5pnxTgI8evUY3Cf1PvFoK2u21NMAxpSYvzxFmWxSYSiU6lTMMwJnDzRMPXxZ7/aqCeB3JARWAh1wovPHLceTW8qEXR0QHpHZ8S1brq093E6SBoV2msVqtvaTabe0+ePPlRURQhn89/a2xs7AvY2bHZbO5jWdYkdbkmDcOYwK6CkiQVXdeNI+hoXT+sQjBMu7IlwzAe6t9oFdY0bYeiKKexfWyr1Rqm/b+0IesC1EnbpJ83uEjUW2ieOrHk+EN/Ts9f2L9MWb3Pq/CCnBdBjf8jkZxtGBkZeRA/o7kx2WT6QL4aKFgbStnRpXCR4osPAfg88Zr8Po8jr3PPzk5OA9jzvKiu61tLpdLd8/Pz95fL5ezk5OQ3MBoL4FzTMZ7n64ZhTLRarV2SJBVFUSwhh0bfMnaywHF10yWxphiODTczLFHUarV2KYpymtyzowKgMe1SiudRGwhP/kZOeNGNgFY5EDi08ZGSKNDt14nMo98F2i5C77yjC+PfHMd10jc9z4N4PF4eGhp6GPOuMRUSN7SLveurhTY8kCnAnFfNg223LPWJiNUxpuDioI+lxWpavKZ35BBQgL4vAX2nZ1HY8uk4Tubs2bMfP3369G87jgOjo6P/fP311z+AulkXkd2LRCInsFNFELTzj4Mg0HCDoetPhzkinkOHe+J9BEGo4PGYRG9ZVkHTNJBlOYr+a1piWY/I85m+78u2befIvKMYu0ZMp7jnmjGz7cYAdYy0IjnWHr0RoPgdfhaG+J1d102oqvoCqUoCnud1LNc8z3uGYQgAADzPY242KIpSvu2227ZgVwnc4DdiQsWGB/LFyCdxxTSFwLdGhAuDgdbZyP/YwxcYhgHHcTJ06VTDMCaIj1fDAIlTp0598syZM58IgoAbGRn569HR0S9h1Y0wUMKiKOUz7SRXoIUZxxeQYn30ZuC3EyPM9a5LXx/LEpGCA+e5kS48w2vnLTx/9DXWmVs0ynU4bGjzXNMcnpaccGOQJKkYBAHXaDRuaDab+3ieB0mSDM/zFNM0WZZlWUVRHEEQVi3LypumCblc7qfXXXfdx0L3fUPaxL4e1JNApg0VtGiN36+nz3YD9sVIVdUpXIgAAOj39DwvWi6X3/XSSy/9laqqU5s3b/50Lpd7NBaLHQE4F7SP7qNuojxDumUEoQwpWi8kx6+pakLOXVOCiP6c/p8AGJutd+ZnPfCtR6FzOvcK665h0GDgyXpVOtDQSI0fN1WLIbHdGHGHxkDXdcGyLEUURZAkCaUDwbbtPMuyMDIy8p3x8fH/geoMfe1LedarkXoGyGHDBCWaIZC7FeIL58FyITCsiQOmFzcuVl3Xt2IlRixUt7KychdpyXrLtm3bPqGq6lQikXgOOwNigAZV/wrdR+cZd8jf4eQKzGu2Asp4F+LIcrgyZ7d5I+LkGq5Hc75XMv/knPNit7ttMpRrDPVfL3wcwNpWQOFr4pyTbosuxqazLAuO43SMkfi3JElOLpd7dNu2bb8py/Ic6sWX+oxXM/UMkC+FgnOW63C45qvixgAAjUbjBtQzi8XiB8vl8rt0Xd+aSCSevf766/89LlBckKgTE59uQZKkIsUJ19T7Co8nZEA7r5AcdQ7dNA5Lxq4XarmmeAF9z/Ws8aF7rZnDgDIsXeC6XhjE+D1eh9yb43m+QW921Fx0ODvHcZrruomFhYX7dF3fKgiCwbKsEgQBGIYBLMtCoVD4/vj4+OcTicRz+L42UpXMi1FPA5ksEgBY615Co0Z4kYYNRpQ1dl0dmTQ+jx87duwvS6XS3YVC4aHdu3d/SlGU02GrJ3VvD3Nkw2I0tLlsB0iXEmFF6/zr6Xnr6cso1pLf3cI9L1aqh27vcl6eNqXm0MkqXTcqWjJiSF0zEkq5RjSnn9c0zTF0zbVarW22bQPLsuB5HoiiCAMDA8czmcwThULhoXg8fpgeWx/IVyGRF70GOAQcnfBDGsxdKlpetIRPN2o0Gjfour51fHz885OTk3+A3QwB2oXeKB2YZ5h20TdyzzVtTghnccPPEVroXPgztBjjNcLjY9qulq5jR4AhZwzPEX3P9YiWZJAjU9x4TbP5sJHRP1eAIMzV13SewHNxc8HEDpLWubVWq23DjC7SbcPneb6Ry+UeHRoaejiVSj3FkOg4FMfx2hvJxXQh6hkgr0c0R6YXChCwdNOdwxzjQjqyZVnZI0eO/EMkEpm57rrr/i+il0sh3a8jCuP5yJVpq3WY2wCs6ca4Jp44LKZeZA7CwSxrsryocXWkBsyquti1wxwVr0PPe3gcFzhvTdRd+NnIuHKmaY7qur7Vsqws2kAYhgFN00BRFBgdHf2LgYGBb2Yyme/iuVhCF6/jOE6aTlu80DNuBNrwQMaFje6fIOhkxEhBO7ABAM7VtkKHv+M4aTRS0WIbx3Gu67oJ/D4IAl7TtO2e5ymWZYFpmqCqKkQikXK9Xs/GYjGjXC7vdBxn5/z8/Hvj8fhCJpN5YnBw8KuZTOYJHCcZS6dlCcC5FiYIHlLOB4/nqeM75YDCHAufF6iNKVjHRRWEyswSbgwM0861DoIALMvKEi6O7W4uuEao8FUs2kBnGMXD6ZXUmDp6MR1RhxsgserHJEkqoitP07QdhmFMEEArKEbLsuzE4/FDW7du/XY6nf5eLBY7Ek5DpH3DLMta4bTFjU4bHsghIHrhxUKKyIPrunEMWEDwI+Adx0mbpjlmWVaBpAgqaLTxPA+wVWk+n/9hLBb7WbFY/FC5XM5ms9kyaXIGktRmrK1Wa7her394fn7+w9Fo9GShUPj7ZDJ5MJlMHsTFRQdK4DjQlUIWs4nNvumEiJCe6DEkGCI0Hx65JgBApxdVmLMi+Cj3j8W2C/L5qDNfjBvjdehSP0woSaXbNQh4ZYB2JJsgCKso7uLcYGx5vV6/GSUEy7KGTNNUbdvGKC0YGRn5eiKReC6dTj8ZjUanUdXoFU57qdQLQF73ZTEM48qy7Pi+L2CeKXaotyyrgFFTvu/LrusKxLACPM+DKIoGz/P1wcHBr6H7SFGU00tLS/fMzs5+dGBgYOmWW27Za9t2rlQq3b28vPw+Xde3siwrcRzHuq4LtVpti6Zpf8jzvKGq6tTg4ODXBgYGvkm7PLASBUNioXEB4uIl4iAdz9ypphGqObZmA6PdORT367iu6AASGrSvdPF3uz8SShXEVmFSojI2huMikUiJLm9EuLGMBizLsgokO4tFMToWiznDw8N/UygU/h6LDVDPiC1keqKo3qXShgfyhYiIZAjQnVi0znEcliExuLZtgyzLEIvFTqqqOhWPxw/H4/FDqqq+QMIUOwaRYrH4waNHj/4Ny7L+xMTEZwEAYrHYkVgsdmRkZOTBZrO5d2Vl5T0rKyt3GYYxDgCg6zoEQaBomnZLrVa75ezZsx9XVXUql8s9ms1mH0cRD6ANaqrNSUfEBFiTX9zhsgDQGRtZ5Oe9TzoBgRaxEeRdbAQdvzSed6E5Rq5OSQ6dgBD6fMqvveZ+2IoV3UhBEPAkaWSvaZqqLMtN13VZ9AEPDw//TTKZfAZ95HSoLRoPeZ6vX0vcGKCHgYwLQ1GUsq7rWdu2wXGcrO/7IIoiqKp6XJKk4qZNmx7ArCCyAOjgBA4XimEYE2fOnPmEruuwe/fuT4+NjX0RuQj22k2lUk9nMpnvjo2NfWF5efn9lUrlTo7jDtAGLSJ6D5dKpXdHIpGz6XT6ycHBwa9ms9lvY8BIELTTDAVBqHTJcHIBzvUwosEYBjPNjWk3EHLl4FyjOBPFYvrc9TaHMHmehzHdGOO+5h1Q11ujIuDmgs9i23auXq/vbzQaed/3QRAE4Hm+sWnTpj8ZGRl5EI1V2POJ2kAkgPPL82DFj1eybjYq9QSQQwt2Ta9bQRAqsVjMkiSpqKrqVCQSmYnH44eTyeRBUmVjCCOCwvocwzCeruuTgiBUTp069cmVlZWduVzupXQ6/WQQtDsXkKgijSQ0cLh4JiYmPjsxMfFZwzAmyuXyOxcXF++t1+v7UbdzXRfq9fq4aZofLBaLH5RleS6Xyz1aKBQeUlX1BYBzfYtwPPSiRb0WjVoU5z3PoLXevKGYi9diuhRgeCWE7j6WZX0cI32vbmPxfV/WNG0HdsfwfR8kSYJsNvtvmUzmifHx8c8DtKucYDIHAtayrCHSg7lrfa1rBcQAPQRk6FLBkuM47eabb74e9dBQOp+ElRND16KzoeRIJHLizJkzv3X27NkPx+PxGib9Y8IDLhbaUIWWblIO1hocHPza8PDwl03THF1dXX37ysrKeyqVyp2apgmGYbCks+P4mTNnPnbq1KmPRaPRhbGxsS+MjY190TTNUZ7n62j8wrETsHZSFyl3EhbhPy/gJawz43OGQUa4JofFFC409+Hzwu8F9XgSOtkZP6ZJViqVO1utluI4DqiqCoODg99AWwINUEEQVsObbfjdoa5N+4qvFeoJIAOszQFGonVK1MPwc5ZlLToNEHVhXGzo+11cXLx3enr6AYZhYOvWrb9DWoXGURy0LGuI5/kGKb0jY8VH4uIoontJ1/WtnudFifj9BMk13r26uvr2er2+X9f1JHEFQaPRGD569OgDMzMzfzw8PPxlVVWnsLA66s7dQBoGNAIpfFxY/KbEXvB9n0UduZu1O0y0sQvFcd/3WYDz+hDzKIJbllUwTXPUdd2EYRhKLBYziP775WQyeZAhEW20e44W02mphDaS0S1Tg3Y6ZOJaAXRPAJnmtN2MHPgyKW6LwQYd/ZFlWQtFWdT3bNvOHT169G8Nw4DJycl/LBQKDwF0FqiHHJle7Pg/DWocI70QBUGoxOPxQ9ls9nHDMCYqlcqdKysr72m1Wtt4ngeO43yO47RTp059hGEYkGXZyGQyT5BIpafREIf+3rBfljyXS3+Pz82ybB0twoIgrKLrCwCAZVkfs7LwNz5bN+5M69FErQB0D/m+L0mStEq+y+i6vlXTtG2kUD4IgmDs2bPnvyQSiefi8fgh2vJMc+Nw9BX9/3q5w+gF6PZdL1JPAPm1km3bOVLDag4Xvuu68VOnTn2yXq8LmzZt+rdu5WAuhWNdiDAQQ5blueHh4S/ncrlHW63W7nq9vr9SqdzZaDTGsdG3bdtKsVh8b6lUem88Hv9pLpd7NJlMHkyn00/6vi+hjxzzixHQkUjkBG5K9AYUBAGPXSIoGwEEQcDSwRndYq1pEdrzvDTDMB4WBsCAEEmSDFmW52q12gH0d+u6Pux5HiQSiZNjY2NfHBoaehgNe3g9WnLq06XTNQ9kElFVp7iVBQCwuLh47+nTpz8QiURgbGzsi6lU6mkU9QDOdSagLdJItCW5mxgcJrTC+r4vKYpySpbl2Uwm84TjOOlSqXS3aZpjuq5POo7Duq4L1Wr1zaurq2/2fR9yudzzmUzmiXw+/wjmOqN1mud5q9Vq7RIEYZXWJ7GSJtbTpoHsU4XuUN8Pj5d+JrSsU6I9PpPSaDRuILXBhn3fh2w2+/ymTZseGBwc/BpAm4PTYZNUaOs15Tq6HHRNAbnbAiFAbui6PomVPVZXV//dsWPHvgQAsH379t+Lx+OHaPcKwFp3EIqt+Hk4SOICOi1PCgfwdOsVyg3mFgqFv/d9XzJNcxTL5RqGoQK0EwSq1epN1Wr1ptnZ2d9IpVJPDw4OfhVFb4C2nxugLXUEpLQPbkCGYUyQGtnnBU/QbqLwM9PE83ydDmfF8EzHcaBer+/xPA9GR0f/efPmzZ+mx4IeBXpe6Y20T6+Mrikg04SLBzks6rDVavWOl1566a9rtRps3779nzdt2vQAVp1EURQBEb7meoC9EEdGwPI8D0EQdHyuqMN6nhdVFOV0Npv9di6Xe9QwjIlarXagXq/frOv6pGmaeZZlfcdx1Lm5uXefPXv23aqqGvl8/pGBgYFvxuPxw7Isz6FhD+uVYS0vWm/3fR84juvooOF6X/S8IWEmEp0AwjAMKIpipFKppycmJj4jCEJFluVZPAfnDl14F3o/fe58aXTNAhmJIeltKHrOzMz8cbFYHC8UCmc3bdr0AAaHoOHEtu0c6caANaMxzjicSdSJ/6b/J59hxclOOR6aI3Mcp0mSVMRAFV3XJ1HXlCSpiHHFpmmOOo6TIT2SdzEMkwdoi7Vnzpz58MzMzIfj8XhzaGjo4aGhoYexbxJa5ymOSPudO5bobmpD+PmwRC8GdPjtLogQi8XmJicnfx9zgEnIaSeQgzbQha7L4Tz0QXzpdM0DGaC9eGzbzs3Nzf2ncrl8SzKZhMnJyT/AfsO0uEcvMBSrL3Ddrv5tmtC4hgElGENNQkkzmqZtF0WxpKrqFBnnoGVZBTQS8TzfiEajxzKZzBOapu0grqytDMMIkiQ5nudFZ2ZmPjozM/PRbDb7UqFQeCiTyTyBagRapunILhLqiMkX65Xa6Tw3vSHwPO/bts26rhuPxWJHUH+mXXs456iGoEEtlHzRB/EroJ4Hcjf/MvUdHwQBL0nS4vLy8vuOHj36KUEQYHx8/M8HBga+CXDOV2nbdkIQhFW6ydlr1efQ94luIrpNiyiKJXQxYYM3HA+mYtKZTzzPNxKJxHORSGTGMIwJkq9b0HV9Ev3ThmFMHD9+/AHXdR9IJpMvDQ0NPZzP5x+huHQnJxk5Zpgrr+OCkkzTHPU8L0qazI3btp1Dizz9LqgAFC+0IbrU/x69AbyWOb5WqOeBDHA+mHFB4SJBvZjneRgcHPzOxMTEZ2jrKVaaBDhnXaV1S9Q1MQDFNM1RNKLhPWkDGEPCRwHallsq7c5lGIYj4JGo489b0CypBY33p7iaFYlEZrCMEBa1NwxjwjTNMdL8GxqNxs5ms/mZl19++TODg4PfIplbvt8uH8zjBoLjxjGgRZ4GJOrIJKJtHPVscvyaYv3h9+BTRfCxnjVLmsihXo/nXs410WvU80Cmgwzoz/Bz13Xjx48f/1yz2UzKsgzXXXfdx7Dboeu6cXTPUEapTqgkhn76vt9x6aD+182IczHD0etBiqKcliRpMRKJzDiOk8GoKjSkOY4jFIvFd5MgFEcUxQYWs8PysjhO5M74HLRVPvRcl5RsAdDeJMPhriQgpE7bIPp0Yep5ICOhmEgvOtu2cy+++OI/1ev1m5LJ5MLOnTs/Eo1GpwHa1lie5xtEx/zjVqu1C4MYAM5l1jiOk6bCPTvzifHE64mGbwSI8TkwykkQhIokSUVZlmdN0xzDIBFN07bpug6CIAiSJEXRUq7r+iRVY+y84neh5+mWj3zRZ6SroKysrNzVbDb3pdPp7yWTyWds2070gXxp1PNApoM4aFDZtp1rNpt7y+XyWy3LgiAIhh3HybRarV2xWOwIRncJglAZHx///OLi4r0zMzN/fPz48T/J5/OPFAqFhxAc9P2Q0/tUuVuAc/p4+LjXm7A/FP6P1mq0jBOpou667k2pVOpFwzAm5ufn75+YmPgMEfk1Mt6OG43Klcbui12tz5fClVmWNUnwze8GQcA3m81tkiR9/Od+7uduiUaj02/UhrfR6bxi4tca8TzvMAwDPM8bU1NT/++LL774Ty+++OI/6bo+iXp0LBY7snXr1t+54447RrZt2/ZbtVrtwE9/+tNvHT58+LsrKyt3USWE5GazuZe4grx4PH6YLHZc8NwbvTCJga6OQESpBMFtmuZYrVa7aXh4+Ou7du36QKFQ+PtarSacPXv249j/CXV62oKNz4Q/4Y3qUikIAr5er+8vFos7K5XKNoZhIBaLHUGD3uWej14lJgjVIe5lohaxB9Dmyq1Wa1exWPzgysrKe+r1ejIIAhBFERKJxElJkhZHRkYezOVyj2J8NVahWFlZuWt2dva/rKys3JbNZn80NDT0cDab/baiKKcB2vqz4zgZ+v7dDDeY/ogcDEFBndMp7RO61nltYOn70En8aHTCsTMM4xJdeQzTKX/+53/+xng8fljX9ckzZ858YmZm5iPxeLyWSqWekmV5ThCEVXSN0WNFkOP15+bmPgwAwHGcf/vtt2+SJKl4Aa8Bh1lOS0tL/6HZbO6VJGlxfHz886IolgzDmMBAkr6x68J0zQA5bOzCvzFholar3Wqa5tj09PSftVqtbKvVglQqBa7rgqqqC8PDw38zPDz8ZUysQMu1aZpjpEnbh4MggOHh4W+NjY19IZVKPc2yrIXcGhd/mGu93kB2HCeDHJlKT+R0Xd/aarV26bq+ZXBw8Ot79+59H8aPB0HAHT169G+PHz/+gUwms6Sq6gvRaPRYEEqLpHONcUxzc3MfZtrFE5zbb799XBTF0oWAjLYLqhEej75t3IDC76xP51PPA7nbQghzKvwOEwyKxeKHlpaW7qlUKntEUfRN02R934d4PF7L5/NfGRwc/Fo8Hj+EpXkw+aBYLH7o5MmT/3er1VLz+fyPJiYmPovVRGiQIjgB2pFRryeQfd+XMRsK0ypJU/NdjUbjBgCAm2+++XosFyzL8hxGrx06dOj7i4uLt6XT6ZOJROI5LK1Du6JoG0QQBNz8/PwHEMh33HHHCEmTvCCQ8dkxiYK4tOIYJBN+f306n3oeyK+E6EXpum5c07QdL7300l/V6/U9tm2DIAiYfwsDAwPPj42NfTGXyz0KcG7D8Dwv2mg0bjxz5swn5ubmbsvlciczmcwTmUzmiUgkcgJdUxi9JYpiCUMtkQthKCM1lgSdQI8gJvc9r+laeFNAdULX9cloNDrtOE761KlTvxkEAdx0003vUlV1CkNUacu+7/vyM888c5QEpCRzudy/RSKRGRTRMXgFpRPbtnPlcvldrusqkiSVb7nllj0YV90H4utLfSBTREdrYbRSJBI5sbCwcN/CwsJ9mqbtIIESiuM44Ps+pFKpswMDA48NDw//DdbaCoKA0zRth2mao8ePH/8c1poaGhp6OJPJPIFVHnmerxMpoEJzTVIgP0O7ZlhSaxrgXKICgnQ9IOP3lmUVMEqMYRh3fn7+fl3X86lU6qe7d+/+FbpPFT0HAQkoeeaZZ15yHCdJVId/YBjGazab+xKJxLN08oVlWYVyufxOz/NYWZbLt95665sw0aQP5NeXrnkg06I1/TdAmyv7vi8jV6lWq3fMzs7+xsrKyntM0xQC0qqEoSp45HK5R9Pp9JMYmuj7vtRoNG44e/bsx2dnZ3/JcRzI5/MvjY6OfimZTB4krVVl0zRHDcOYIJU/T2NQBgaaUKL0mvar64nXNLCx8EA2m3389OnTv7e8vHxTJBJxdu7c+ZHBwcGvhdvShH3fhmFM/OAHPzjFcZzhOI6STqd/pKrqlGEYm0VRXEYgm6Y5Vi6X3+F5HiiKUj5w4MB1WGGkD+TXl/pA7hK+2U2fRk6Fou/CwsKvzs/P31+r1bb5pJIlx3HA8zxEo9Hjg4ODXx0YGHgsHo8fchwnw7Ksia0/T548+SnLskBV1XIymTyYzWa/nU6nv4dcjTKA8WgRJtbdGMDa+lyEM59nSEP9GNMvLcsqsCxrnT179uOtVkvYvn37n09OTv5+uIUNHQ6Kz4yW5R/+8IcnTNNUeZ6HgYGBb2GmFkA71ts0zdHl5eX3uq4LkUikdtttt23pA/mNoWseyGEKAxmNWfRn6IJhGMarVqt3LC0t3bO4uHivZVksx3GY0+uwLGuqqvrC6OjolzKZzBN0Y7RSqXT3mTNnPtFsNodlWTbS6fSTuVzuUVVVpxhSGodw0kE6oAPjvl3XTZDugp3KmeHnQAMSibvmjx079j9IAoX/lre8ZYiOZSbnrOHGdBw5KZo39JOf/ORfNU3bomkaTExMfAvHQ3T9saWlpV92HAcURWnefvvtm/pAfmOoD+QQ0Qsb4NwCxIZk6MbBdMaAVGtstVq7SqXS3QsLC/fVajWVZVlQFAXjjiGRSLw0Ojr6pVwu9yjP8w1sV1OtVt9SLBY/VCqV3hEEAcTj8ePpdPp76XT6yXg8fhhjnR3HyWCBPASH4ziZbpZufI4gCHjbtnPxePxwsVj84MLCwtsAAPbs2fOJsbGxL9IbRDeg0VZlx3EyoiiWLMsaeuqpp4ocxxmapimDg4PPC4JQIbHc6aWlpXts22b7HPmNpT6QYf1UR9rPCbAmN7fDAamsKNlxnLRhGBPVavUtS0tL96yuru6MRqNN13VVx3EAAEBV1QUUu6PR6DEUf5vN5r7FxcV7FxcX32GaJiSTSSOTyTwxMDDwGBqMHMfJYFYVS5qVoYV7PSCjuHz8+PFPse3OhUu33377pnCK4YUIXUEAbX2Z5/n6888//4NqtbpTEARQFOVsIpF4LggCrlQq3e04DhuJRMq33377Jrrwwqt8PX26BOoDGc6P+KKJdkldjOgNodls7q1Wq2+Zm5v7tXK5vM22bYjH48DzvGFZlqIoSm1gYOCbWK8ay/CSxt0HlpaW7llZWRlXVdXPZrPfJn2iisghPc+LOY6TRl0ZgUz9z6FYfPbs2Y8bhjHearXg9ttvf08qlXoqnOhPPwMtcdBtV+i5wNTPUqm0LRqNQjqd/j7Lstbq6uq/c12XjUQiS3fccccIXrcP5NeX+kB+nYmEH94zOzv7G6urq3s8zwNRFIHj2hK8aZowODj4/ODg4FdJS5sTgiCsNpvNfeVy+V2k3vVNruvC0NDQ8/l8/hF0VWGdLDR4ka6OHf2aYRiXSAfvNk0TJicn/3H37t3/Eet3ryeJ0NRtk8NILN/3pYMHD75sWZbK87zveR6L60mSpOadd94Zfz3ntk/nqA/k15mwOifLsmaj0bixWCx+cHl5+f2apmV93wee58FxHAiCACKRiJ/L5R7N5XL/Eo/HDwmCULFtO7eysnLX4uLivbVabafruhCNRo1cLvcoGtAikcgMwzCupmk7sEJlEAS8aZqjtVrtwOrq6s54PL60d+/eX5JleU6W5TlaXL4QrQdk1Msdx0k/88wzL9m2LbAsC9Fo9Gy1Wh1PJBJLxI98zRSJv5LUB/IbRGGxe2lp6T+srKzcVavVdjIMA4IgOAzDuKZpKgzDQD6f/87o6OiXHMdJx+Pxw6IolhqNxg3lcvld9Xp9v6Zp2w3DUDdt2vR3sVjsCM/zdWLFdgVBqGC1zUql8lbLsmDPnj3/dXx8/POGYUwoinL6UjsVdguRRLEdoG03qNfr+6empv6l2WzmRVEEWZYXDMMYfsc73vHausL16ZKpD+Q3gJCDYaYQwDldFINF5ufn3+v7PsiyDCzLOp7nCQAAmUzm+4lE4rlYLHYEwyKR27ZarV2VSuUXGIZxo9HodDabfTyZTB60LKswPz9/f7FYfCvDMJBOp4/v37//JuTAr6bdKG3Np0GNiRatVmvX97///Z8pimLUajVlcHDw5K233vqmfs2tN4b6QH6dKSzC0v2P8Xt0X5XL5XctLy+/r16v54MgAEEQwHEckGUZ4vH4i4lE4rlEIvGcLMuzaCVnWdYqlUp3r6ys3BUEAR+JRGawcglJVUzu27fv/xgaGnoYjVWXE8gA7QwyPObJJ58sEn3++/v27XvvpYjvfXrt1AfyG0Tohw7HMdOtXHzfl1qt1i50X5XL5ZtQh/ZJ429FUcqqqk4lEonnotHoNMdxLRJtlmi1WruazeY+TdO2N5vNLZqmwfj4+A9vuumm223bzmFSxqsZ/4WykBqNxg1Yv7pWq9169uzZj4+MjDyYyWS+++pmq0+vlPpAfp0JC8itF8+Nn2F9LwQa6rinTp36pOM4adM0s7ZtAwCAKIoQjUbPyrI8l0gknlVV9YVIJDJjWdbQ8vLy+0nVEpXneWfPnj2/nMvl/oVuUYphppfCLS/kYwdoZ2ahUY5OWQw3ae/T60t9IL/OdCnBJjSXdF03jqCjgzAWFxfvLRaLH2w2m1swWQO5tCAItUwm84SqqlO1Wu1AsVh8N8dxkM/nv7Fv375f1HV9MhKJnKDvdan+8fWMXeQ3T5f9xc0Bf78aEb5Pr476QL7KiQaD4zjpYrH4oWKx+MFarbbHtm3gOA4EQQDXdUGWZUOSpGK1Wt2STCbPHjhw4DoMw+wHZPQ29YG8AQiDPrAogWVZQ9Vq9S31en3/0tLSPZZl5V3XBabd3xhkWW5u2rTpTzZv3vzpC+m2feod6gN5AxCdhUR/jrHdS0tL92DL1VarxW7evPnru3fv/o/9mlfXDvWBfJVTWM8kLWYknucbCGzDMCbQ4t1sNvcRf/IzlmUN9UvtXBvUB/IGJNqAFrY+0wYttCQD9IHc63TNF6jfKNQtICMIAo6u5mHbdg6L4bmuG+/WjL1PvUl9IF/lRFcjATjXMByramLVEew/hX+TAn397KNrhPqi9QYgTFJYL2ca47bpHGQ6ggygL1r3OvWB3Kc+9QD1Res+9akHqA/kPvWpB6gP5D71qQeoD+Q+9akHqA/kPvWpB6gP5D71qQeoD+Q+9akHqA/kPvWpB6gP5D71qQeoD+Q+9akHqA/kPvWpB6gP5D71qQeoD+Q+9akHqA/kPvWpB6gP5D71qQeoD+Q+9akHqA/kPvWpB6gP5D71qQfo/weRZtX0pDkEQgAAAABJRU5ErkJggg==" style={{ width:240, marginBottom:16, opacity:0.75, display:'block', margin:'0 auto 16px' }} alt="" />
          <div style={{ fontWeight:700, fontSize:17, color:C.text }}>Sin gastos en {monthLabel(month)}</div>
          <div style={{ fontSize:14, marginTop:6 }}>Tocá el + para agregar el primero</div>
        </div>
      )}

      {showSettlement && (
        <SettlementSheet currentNet={net} onSave={s=>{onAddSettlement(s);setShowSettlement(false);}} onClose={()=>setShowSettlement(false)} />
      )}
    </div>
  );
}

// ─── EXPENSE FORM ─────────────────────────────────────────────────────────────

function ExpenseForm({ onSave, onAddRecurring, initialValues, isEdit = false }) {
  const [quickMode, setQuickMode] = useState(false);
  const [form, setForm] = useState(() => ({
    description:     initialValues?.description             || '',
    amount:          String(initialValues?.amount           || ''),
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
              value={form.amount} onChange={e=>set('amount',e.target.value)} placeholder="0" inputMode="decimal" autoFocus />
          </div>

          <div style={{ marginBottom:20 }}>
            <label style={S.label}>¿Quién pagó?</label>
            <Toggle options={[{value:'toba',label:'Toba',icon:'●'},{value:'gri',label:'Gri',icon:'●'}]}
              value={form.paidBy} onChange={v=>set('paidBy',v)} colors={{toba:C.selected,gri:C.primary}} />
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
              <input style={{ ...S.input, fontSize:24, fontWeight:800, height:58 }} type="text" value={form.amount} onChange={e=>set('amount',e.target.value)} placeholder="0" inputMode="decimal" />
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
            <Toggle options={[{value:'toba',label:'Toba',icon:'●'},{value:'gri',label:'Gri',icon:'●'}]}
              value={form.paidBy} onChange={v=>set('paidBy',v)} colors={{toba:C.selected,gri:C.primary}} />
          </div>

          <div style={{ marginBottom:20 }}>
            <label style={S.label}>Forma de pago</label>
            <Toggle options={[{value:'efectivo',label:'Efectivo',icon:'💵'},{value:'tarjeta',label:'Tarjeta',icon:'💳'}]}
              value={form.paymentType} onChange={v=>set('paymentType',v)} />
          </div>

          {form.paymentType==='tarjeta' && (
            <div style={{ marginBottom:20 }}>
              <label style={S.label}>¿Qué tarjeta?</label>
              <div style={{ display:'flex', gap:8 }}>
                {CARDS.map(c=>(
                  <button key={c.id} onClick={()=>handleCardSelect(c.id)}
                    style={{ flex:1, padding:'12px 8px', borderRadius:R.sm, border:`2px solid ${form.card===c.id?c.accent:C.border}`, background:form.card===c.id?c.bg:C.card, cursor:'pointer', fontFamily:'inherit' }}>
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
            <div style={{ marginBottom:24, padding:'12px 14px', background:'#F7F7F7', borderRadius:R.sm, border:`1px solid ${C.border}` }}>
              <div style={{ fontSize:13, color:C.muted }}>Cuota <strong style={{ color:C.text }}>{initialValues.installments.current}/{initialValues.installments.total}</strong> — Las otras cuotas no se modifican</div>
            </div>
          )}
        </>
      )}

      {error && <div style={{ background:'#FFF1F0', border:`1px solid ${C.danger}30`, color:C.danger, borderRadius:R.sm, padding:'12px 14px', marginBottom:16, fontSize:13, fontWeight:600 }}>{error}</div>}

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
              <div style={{ width:44, height:44, borderRadius:R.sm, background:'#F7F7F7', border:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:22, flexShrink:0, position:'relative' }}>
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
          <div style={{ background:C.card, borderRadius:'24px 24px 0 0', padding:'28px 20px 36px', width:'100%', boxSizing:'border-box' }} onClick={e=>e.stopPropagation()}>
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
            <div style={{ background:card.bg, padding:'18px 20px', borderBottom:`1px solid ${card.accent}20` }}>
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
                        <div style={{ height:4, background:'#EBEBEB', borderRadius:R.pill }}>
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

function Settings({ config, onSave, expenses, settlements, recurringExpenses, onDeleteRecurring, onImport }) {
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
          <div style={{ background:'#F7F7F7', borderRadius:R.sm, padding:'14px 16px', marginBottom:20 }}>
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
                  <div style={{ width:40, height:40, borderRadius:R.sm, background:'#F7F7F7', border:`1px solid ${C.border}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:20 }}>{cat.icon}</div>
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

      <div style={{ ...S.card, background:'#F7F7F7', border:'none' }}>
        <div style={{ fontSize:13, color:C.muted }}>
          <strong style={{ color:C.text }}>{expenses.length}</strong> gastos · <strong style={{ color:C.text }}>{recurringExpenses.length}</strong> fijos · <strong style={{ color:C.text }}>{settlements.length}</strong> pagos
        </div>
      </div>
    </div>
  );
}

// ─── BOTTOM NAV ──────────────────────────────────────────────────────────────

const NavHome     = ({a}) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a?C.primary:'#B0B0B0'} strokeWidth={a?2.5:2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 9.5L12 3l9 6.5V20a1 1 0 01-1 1H4a1 1 0 01-1-1V9.5z"/><path d="M9 21V12h6v9"/></svg>;
const NavList     = ({a}) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a?C.primary:'#B0B0B0'} strokeWidth={a?2.5:2} strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M7 9h10M7 13h7"/></svg>;
const NavCard     = ({a}) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a?C.primary:'#B0B0B0'} strokeWidth={a?2.5:2} strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/></svg>;
const NavSettings = ({a}) => <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={a?C.primary:'#B0B0B0'} strokeWidth={a?2.5:2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;

function BottomNav({ view, setView, onFabPress }) {
  const left  = [{id:'dashboard',label:'Inicio',Icon:NavHome},{id:'list',label:'Gastos',Icon:NavList}];
  const right = [{id:'cards',label:'Tarjetas',Icon:NavCard},{id:'settings',label:'Config',Icon:NavSettings}];
  const isFormOpen = view==='add'||view==='edit';

  const Tab = ({id,label,Icon}) => {
    const active = view===id;
    return (
      <button onClick={()=>setView(id)} style={{ flex:1, display:'flex', flexDirection:'column', alignItems:'center', gap:4, border:'none', background:'none', cursor:'pointer', padding:'10px 0 6px', fontFamily:'inherit' }}>
        <Icon a={active} />
        <span style={{ fontSize:10, fontWeight:active?700:500, color:active?C.primary:'#B0B0B0', letterSpacing:'0.01em' }}>{label}</span>
      </button>
    );
  };

  return (
    <nav style={{ position:'fixed', bottom:0, left:0, right:0, background:C.card, borderTop:`1px solid ${C.border}`, display:'flex', alignItems:'flex-end', zIndex:100, paddingBottom:14 }}>
      {left.map(t=><Tab key={t.id} {...t} />)}
      <div style={{ flex:1, display:'flex', justifyContent:'center', alignItems:'flex-end', paddingBottom:2 }}>
        <button onClick={onFabPress}
          style={{ width:56, height:56, borderRadius:R.pill, border:'none', cursor:'pointer',
            background: isFormOpen ? C.selected : C.primary,
            boxShadow: isFormOpen ? shadow.md : '0 4px 16px rgba(226,55,86,0.40)',
            transform:'translateY(-16px)', display:'flex', alignItems:'center', justifyContent:'center',
            fontSize:26, color:'#fff', fontFamily:'inherit', transition:'all 0.2s' }}>
          {isFormOpen ? '✕' : '+'}
        </button>
      </div>
      {right.map(t=><Tab key={t.id} {...t} />)}
    </nav>
  );
}

// ─── APP ─────────────────────────────────────────────────────────────────────

export default function App() {
  const [view,              setView]             = useState('dashboard');
  const [expenses,          setExpenses]         = useState([]);
  const [settlements,       setSettlements]      = useState([]);
  const [recurringExpenses, setRecurringExpenses]= useState([]);
  const [projectedMonths,   setProjectedMonths]  = useState([]);
  const [config,            setConfig]           = useState({salaryToba:0,salaryGri:0});
  const [month,             setMonth]            = useState(curMonth());
  const [loading,           setLoading]          = useState(true);
  const [editingExpense,    setEditingExpense]    = useState(null);
  const [showChoice,        setShowChoice]        = useState(false);
  const [showQuickForm,     setShowQuickForm]     = useState(false);
  const [lastUsed,          setLastUsed]          = useState(null);

  useEffect(() => {
    loadData().then(data => {
      if (data) {
        setExpenses(data.expenses          || []);
        setSettlements(data.settlements    || []);
        setRecurringExpenses(data.recurringExpenses || []);
        setProjectedMonths(data.projectedMonths || []);
        setConfig(data.config              || {salaryToba:0,salaryGri:0});
      }
      setLoading(false);
    });
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
    setView('dashboard');
  };

  const handleQuickAdd = base => {
    const updated = [...expenses, base];
    setExpenses(updated);
    setLastUsed(base);
    persist(updated, config, settlements, recurringExpenses, projectedMonths);
    setShowQuickForm(false);
  };

  const handleEdit = upd => {
    const e = expenses.map(x=>x.id===upd.id?upd:x);
    setExpenses(e); persist(e, config, settlements, recurringExpenses, projectedMonths);
    setEditingExpense(null); setView('list');
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
        body{margin:0;background:#F7F7F7;}
        input[type=number]::-webkit-inner-spin-button,input[type=number]::-webkit-outer-spin-button{-webkit-appearance:none;}
        input[type=date]::-webkit-calendar-picker-indicator{opacity:0.4;}
        input:focus{border-color:#222222!important;}
        ::-webkit-scrollbar{display:none;}
        button:active{opacity:0.8;}
      `}</style>
      <div style={S.screen}>
        {view==='dashboard' && <Dashboard expenses={expenses} config={config} month={month} setMonth={setMonth} settlements={settlements} onAddSettlement={handleAddSettlement} onDeleteSettlement={handleDeleteSettlement} recurringExpenses={recurringExpenses} />}
        {view==='add'       && <ExpenseForm onSave={handleAdd} onAddRecurring={handleAddRecurring} />}
        {view==='edit' && editingExpense && <ExpenseForm onSave={handleEdit} onAddRecurring={handleAddRecurring} initialValues={editingExpense} isEdit />}
        {view==='list'      && <ExpenseList expenses={expenses} month={month} setMonth={setMonth} config={config} onEdit={e=>{setEditingExpense(e);setView('edit');}} onDelete={handleDelete} />}
        {view==='cards'     && <CardsView expenses={expenses} month={month} setMonth={setMonth} config={config} />}
        {view==='settings'  && <Settings config={config} onSave={handleConfig} expenses={expenses} settlements={settlements} recurringExpenses={recurringExpenses} onDeleteRecurring={handleDeleteRecurring} onImport={handleImport} />}
      </div>
      <BottomNav view={view} setView={setView} onFabPress={()=>{ if(view==='add'||view==='edit'){setView('dashboard');} else { setShowChoice(true); } }} />
      {showChoice && (
        <ChoiceSheet
          onClose={()=>setShowChoice(false)}
          onQuick={()=>{ setShowChoice(false); setTimeout(()=>setShowQuickForm(true), 80); }}
          onFull={()=>{ setShowChoice(false); setTimeout(()=>setView('add'), 80); }}
        />
      )}
      {showQuickForm && (
        <QuickAddSheet onSave={e=>handleQuickAdd(e)} onClose={()=>setShowQuickForm(false)} lastUsed={lastUsed} />
      )}
    </>
  );
}
