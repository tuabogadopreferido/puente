import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
const url = process.env.NEXT_PUBLIC_SUPABASE_URL!, key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const service = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
const acme = createClient(url, key, { auth: { persistSession: false } });
const globex = createClient(url, key, { auth: { persistSession: false } });
const ownerId = '11111111-1111-4111-8111-111111111111', otherId = '22222222-2222-4222-8222-222222222222';
const bridgeId = randomUUID(), eventId = randomUUID();
async function main() {
 const a = await acme.auth.signInWithPassword({ email: 'acme@puente.demo', password: process.env.PUENTE_DEMO_PASSWORD! });
 const b = await globex.auth.signInWithPassword({ email: 'globex@puente.demo', password: process.env.PUENTE_DEMO_PASSWORD! });
 assert.ifError(a.error); assert.ifError(b.error);
 let own = false, leaked = false;
 const channelA = acme.channel('owner-proof-' + eventId).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'access_events', filter: 'company_id=eq.' + ownerId }, payload => { if (payload.new.id === eventId) own = true; });
 const channelB = globex.channel('isolation-proof-' + eventId).on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'access_events', filter: 'company_id=eq.' + ownerId }, payload => { if (payload.new.id === eventId) leaked = true; });
 const ready = (channel: typeof channelA) => new Promise<void>((resolve, reject) => { const timer = setTimeout(() => reject(new Error('Realtime subscription timeout')), 15000); channel.subscribe(status => { if (status === 'SUBSCRIBED') { clearTimeout(timer); resolve(); } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { clearTimeout(timer); reject(new Error(status)); } }); });
 try {
  await Promise.all([ready(channelA), ready(channelB)]);
  assert.ifError((await service.from('bridges').insert({ id: bridgeId, company_a_id: ownerId, company_b_id: otherId, expires_at: new Date(Date.now() + 60000).toISOString() })).error);
  assert.ifError((await service.from('access_events').insert({ id: eventId, company_id: ownerId, actor_company_id: otherId, bridge_id: bridgeId, action: 'realtime_verification', detail: { synthetic: true } })).error);
  for (let i = 0; i < 30 && !own; i++) await new Promise(r => setTimeout(r, 200));
  await new Promise(r => setTimeout(r, 1000));
  assert(own, 'Owner must receive its event through Realtime'); assert(!leaked, 'Another company must not receive the event');
  console.log('PASS: authenticated Realtime event delivered to owner and isolated from another company');
 } finally {
  await acme.removeAllChannels(); await globex.removeAllChannels();
  await service.from('access_events').delete().eq('id', eventId);
  await service.from('bridges').delete().eq('id', bridgeId);
 }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
