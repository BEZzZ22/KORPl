"""Выгрузка громких цифр про-сцены из OpenDota explorer за последние 90 дней."""
import json, urllib.parse, urllib.request, sys

def q(sql):
    url = urllib.request.Request("https://api.opendota.com/api/explorer?sql=" + urllib.parse.quote(sql), headers={"User-Agent": "Mozilla/5.0"})
    for _ in range(3):
        try:
            with urllib.request.urlopen(url, timeout=120) as r:
                return json.load(r).get("rows", [])
        except Exception as e:
            err = e
    return [{"error": str(err)}]

BASE = """from player_matches pm join matches m using(match_id) join leagues l using(leagueid)
join notable_players np on np.account_id = pm.account_id
where l.tier in ('professional','premium') and m.start_time > extract(epoch from now()) - 90*86400"""

Q = {
 "kda": f"select np.name, count(*) g, round(avg(pm.kills),1) k, round(avg(pm.deaths),1) d, round(avg(pm.assists),1) a, round(sum(pm.kills+pm.assists)::numeric/greatest(sum(pm.deaths),1),2) kda, round(100.0*sum(case when (pm.player_slot<128) = m.radiant_win then 1 else 0 end)/count(*),0) wr {BASE} group by np.name having count(*)>=20 order by kda desc limit 12",
 "winrate": f"select np.name, count(*) g, round(100.0*sum(case when (pm.player_slot<128) = m.radiant_win then 1 else 0 end)/count(*),0) wr {BASE} group by np.name having count(*)>=20 order by wr desc limit 12",
 "kills_game": f"select np.name, pm.hero_id, pm.kills, pm.deaths, pm.assists, m.match_id {BASE} order by pm.kills desc limit 8",
 "fast_win": f"select m.match_id, m.duration, m.radiant_score+m.dire_score kills_total from matches m join leagues l using(leagueid) where l.tier in ('professional','premium') and m.start_time > extract(epoch from now()) - 90*86400 order by m.duration asc limit 8",
 "bloody": f"select m.match_id, m.duration, m.radiant_score+m.dire_score kills_total from matches m join leagues l using(leagueid) where l.tier in ('professional','premium') and m.start_time > extract(epoch from now()) - 90*86400 order by kills_total desc limit 8",
 "deaths_min": f"select np.name, count(*) g, round(avg(pm.deaths),2) d {BASE} group by np.name having count(*)>=20 order by d asc limit 10",
 "gpm": f"select np.name, count(*) g, round(avg(pm.gold_per_min)) gpm {BASE} group by np.name having count(*)>=20 order by gpm desc limit 10",
 "team_wr": "select t.name, count(*) g, round(100.0*sum(case when tm.radiant = m.radiant_win then 1 else 0 end)/count(*),0) wr from team_match tm join matches m using(match_id) join leagues l using(leagueid) join teams t on t.team_id = tm.team_id where l.tier in ('professional','premium') and m.start_time > extract(epoch from now()) - 90*86400 group by t.name having count(*)>=15 order by wr desc limit 10",
 "long": f"select m.match_id, m.duration, l.name league from matches m join leagues l using(leagueid) where l.tier in ('professional','premium') and m.start_time > extract(epoch from now()) - 90*86400 order by duration desc limit 4",
 "veterans": "select np.name, count(*) g, round(avg(pm.kills),1) k, round(avg(pm.deaths),1) d, round(avg(pm.assists),1) a, round(sum(pm.kills+pm.assists)::numeric/greatest(sum(pm.deaths),1),2) kda, round(100.0*sum(case when (pm.player_slot<128) = m.radiant_win then 1 else 0 end)/count(*),0) wr from player_matches pm join matches m using(match_id) join leagues l using(leagueid) join notable_players np on np.account_id = pm.account_id where l.tier in ('professional','premium') and m.start_time > extract(epoch from now()) - 180*86400 and np.name in ('Puppey','Dendi','KuroKy','Miracle-','N0tail','Topson','Ana','Arteezy','SumaiL','MinD_ContRoL','Cr1t-','Fly','Zai','Pure','33','Ceb','Xcalibur','Misery','Kuku','Yatoro','Collapse','Mira','TORONTOTOKYO','Nisha','Boxi','Insania','ATF','Ammar','Resolution','Silent','iceiceice','YapzOr','Ramzes666','Sneyking','Quinn','Matumbaman','Draskyl') group by np.name having count(*)>=10 order by kda desc",
 "hero_wr": f"select pm.hero_id, count(*) g, round(100.0*sum(case when (pm.player_slot<128) = m.radiant_win then 1 else 0 end)/count(*),0) wr {BASE} group by pm.hero_id having count(*)>=60 order by wr desc limit 8",
}
for k, s in Q.items():
    print("==", k)
    for r in q(s):
        print(json.dumps(r, ensure_ascii=False))
    sys.stdout.flush()
