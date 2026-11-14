// ─── SUPABASE: auth + datos compartidos ─────────────────────────────────────
// La clave publishable es pública por diseño: la seguridad la dan las políticas RLS
// (solo los mails de public.allowed_users pueden leer/escribir public.items).
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://ddtwsknyiznolipdtade.supabase.co';
const SUPABASE_KEY = 'sb_publishable_xK6Ww26Ed8rYTkrBSbypIw_N6tntYVt';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});

const CACHE_KEY = 'gastos-toba-gri-cache-v1';

export const signInWithGoogle = () =>
  supabase.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin, queryParams: { prompt: 'select_account' } },
  });

export const signOut = async () => {
  try { localStorage.removeItem(CACHE_KEY); } catch {}
  snapshot = new Map();
  await supabase.auth.signOut();
};

// Devuelve 'toba' | 'gri' | null (null = cuenta sin acceso)
export const getMember = async () => {
  const { data, error } = await supabase.from('allowed_users').select('person').maybeSingle();
  if (error) throw error;
  return data?.person || null;
};

// ── Mapeo estado <-> filas ──
// Cada gasto / pago / gasto fijo es una fila. config y projectedMonths son filas "meta".
const rowId = (kind, id) => `${kind}:${id}`;

const stateToRows = d => {
  const rows = new Map();
  (d.expenses || []).forEach(e => rows.set(rowId('expense', e.id), { kind: 'expense', data: e }));
  (d.settlements || []).forEach(s => rows.set(rowId('settlement', s.id), { kind: 'settlement', data: s }));
  (d.recurringExpenses || []).forEach(r => rows.set(rowId('recurring', r.id), { kind: 'recurring', data: r }));
  rows.set('meta:monthlyConfigs', { kind: 'meta', data: d.monthlyConfigs || {} });
  rows.set('meta:projectedMonths', { kind: 'meta', data: { list: d.projectedMonths || [] } });
  return rows;
};

const rowsToState = rows => {
  const st = { expenses: [], settlements: [], recurringExpenses: [], projectedMonths: [], monthlyConfigs: {}, _legacyConfig: null };
  rows.forEach(r => {
    if (r.kind === 'expense')    st.expenses.push(r.data);
    if (r.kind === 'settlement') st.settlements.push(r.data);
    if (r.kind === 'recurring')  st.recurringExpenses.push(r.data);
    if (r.id === 'meta:monthlyConfigs') st.monthlyConfigs = r.data || {};
    if (r.id === 'meta:config')  st._legacyConfig = r.data;   // solo para migración
    if (r.id === 'meta:projectedMonths') st.projectedMonths = r.data?.list || [];
  });
  return st;
};

// Última versión sincronizada de cada fila (id -> JSON) para mandar solo los cambios.
let snapshot = new Map();

export const loadCache = () => {
  try { const raw = localStorage.getItem(CACHE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
};
const saveCache = d => { try { localStorage.setItem(CACHE_KEY, JSON.stringify(d)); } catch {} };

export const loadRemote = async () => {
  const { data, error } = await supabase.from('items').select('id, kind, data').eq('deleted', false);
  if (error) throw error;
  snapshot = new Map(data.map(r => [r.id, JSON.stringify({ kind: r.kind, data: r.data })]));
  const st = rowsToState(data);
  saveCache(st);
  return st;
};

export const saveRemote = async d => {
  saveCache(d);
  const rows = stateToRows(d);
  const upserts = [];
  rows.forEach((v, id) => {
    const json = JSON.stringify(v);
    if (snapshot.get(id) !== json) upserts.push({ id, kind: v.kind, data: v.data, deleted: false });
  });
  const removed = [...snapshot.keys()].filter(id => !rows.has(id));
  if (upserts.length) {
    const { error } = await supabase.from('items').upsert(upserts);
    if (error) throw error;
    upserts.forEach(u => snapshot.set(u.id, JSON.stringify({ kind: u.kind, data: u.data })));
  }
  if (removed.length) {
    const { error } = await supabase.from('items').update({ deleted: true }).in('id', removed);
    if (error) throw error;
    removed.forEach(id => snapshot.delete(id));
  }
};

// Avisa cuando el otro (o este mismo) dispositivo cambia algo.
export const subscribeChanges = onChange => {
  let t = null;
  const ch = supabase
    .channel('items-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, () => {
      clearTimeout(t); t = setTimeout(onChange, 400);   // agrupa ráfagas de cambios
    })
    .subscribe();
  return () => { clearTimeout(t); supabase.removeChannel(ch); };
};
