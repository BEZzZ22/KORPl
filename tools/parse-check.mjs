// Диагностика: почему реплеи не разбираются у OpenDota. Только числа и флаги.
const API = "https://api.opendota.com/api";
const acc = process.argv[2] || "801280038";
const get = async (p, opt = {}) => {
  const t0 = Date.now();
  try {
    const r = await fetch(API + p, { ...opt, signal: AbortSignal.timeout(30000) });
    const txt = await r.text();
    let j = null; try { j = JSON.parse(txt); } catch {}
    return { s: r.status, ms: Date.now() - t0, j, txt: txt.slice(0, 300), h: Object.fromEntries([...r.headers].filter(([k]) => /rate|limit|retry/i.test(k))) };
  } catch (e) { return { s: 0, ms: Date.now() - t0, err: String(e) }; }
};
const now = Date.now() / 1000;
const ms = await get(`/players/${acc}/matches?limit=25&significant=0&project=version&project=start_time&project=duration&project=game_mode&project=lobby_type`);
console.log("matches", ms.s, ms.ms, "ms", JSON.stringify(ms.h));
const list = Array.isArray(ms.j) ? ms.j : [];
for (const m of list) console.log(` ${m.match_id} age=${((now - m.start_time) / 3600).toFixed(1)}h version=${m.version} mode=${m.game_mode} lobby=${m.lobby_type} dur=${m.duration}`);
const unparsed = [];
for (const m of list.slice(0, 12)) {
  const d = await get(`/matches/${m.match_id}`);
  const p0 = d.j && d.j.players && d.j.players[0] || {};
  const info = { s: d.s, ms: d.ms, version: d.j && d.j.version, lh_t: p0.lh_t != null, replay_url: Boolean(d.j && d.j.replay_url), salt: Boolean(d.j && d.j.replay_salt), cluster: d.j && d.j.cluster, od: d.j && d.j.od_data };
  console.log("match", m.match_id, JSON.stringify(info));
  if (!info.lh_t) unparsed.push(m.match_id);
}
// Заявка на разбор и её статус
for (const id of unparsed.slice(0, 3)) {
  const r = await get(`/request/${id}`, { method: "POST" });
  console.log("request POST", id, r.s, r.ms, "ms", r.txt, JSON.stringify(r.h));
  const job = r.j && (r.j.job && r.j.job.jobId || r.j.jobId);
  if (!job) continue;
  for (let i = 0; i < 6; i++) {
    await new Promise((x) => setTimeout(x, 20000));
    const s = await get(`/request/${job}`);
    console.log("  job", job, i, s.s, s.txt);
    if (!s.j) break;
  }
  const d = await get(`/matches/${id}`);
  const p0 = d.j && d.j.players && d.j.players[0] || {};
  console.log("  after", id, "lh_t", p0.lh_t != null, "version", d.j && d.j.version);
}
// Отставание очереди OpenDota: последние разобранные матчи против свежих публичных
const pm = await get(`/parsedMatches`);
const pub = await get(`/publicMatches`);
const lastParsed = Array.isArray(pm.j) && pm.j[0] && pm.j[0].match_id;
const lastPub = Array.isArray(pub.j) && pub.j[0] && pub.j[0].match_id;
console.log("parsedMatches", pm.s, lastParsed, "publicMatches", pub.s, lastPub, "gap", lastPub - lastParsed);
if (Array.isArray(pub.j)) {
  let ok = 0, n = 0;
  for (const m of pub.j.slice(40, 52)) {
    const d = await get(`/matches/${m.match_id}`);
    const p0 = d.j && d.j.players && d.j.players[0] || {};
    n++; if (p0.lh_t != null) ok++;
    console.log(" pub", m.match_id, "age", ((now - m.start_time) / 3600).toFixed(1), "h replay_url", Boolean(d.j && d.j.replay_url), "parsed", p0.lh_t != null);
  }
  console.log("public parsed", ok, "/", n);
}
const st = await get(`/status`);
console.log("status", st.s, st.txt);
