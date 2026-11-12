// Глубокий разбор, шаг 1: реплей .dem → сырые данные по секундам (JSON в stdout).
// Парсер готовый: github.com/dotabuff/manta. Здесь только выборка того, чего нет у парсера OpenDota:
// здоровье и мана каждую секунду, видит ли героя вражеская команда (туман войны из данных самой игры,
// поле m_bNPCVisibleState у CDOTA_DataRadiant / CDOTA_DataDire), готовность предметов и способностей,
// линейные крипы, варды, здания и журнал боя.
// Запуск: deep-extract replay.dem > raw.json
// Время в файле — секунды от горна (как на игровых часах), координаты — клетки карты ×100 (как x/y у OpenDota: 64..192).
package main

import (
	"bufio"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"sort"
	"strings"

	"github.com/dotabuff/manta"
	"github.com/dotabuff/manta/dota"
)

const (
	noHandle   = 16777215
	indexMask  = 0x3FFF
	creepStep  = 5
	teamLight  = 2
	teamDark   = 3
	maxPlayers = 10
)

type track struct {
	X     []int32 `json:"x"`
	Y     []int32 `json:"y"`
	HP    []int32 `json:"hp"`
	MaxHP []int32 `json:"mhp"`
	MP    []int32 `json:"mp"`
	MaxMP []int32 `json:"mmp"`
	Alive []int8  `json:"alive"`
	Vis   []int8  `json:"vis"`
	Lvl   []int16 `json:"lvl"`
	NW    []int32 `json:"nw"`
	LH    []int16 `json:"lh"`
	DN    []int16 `json:"dn"`
}

type player struct {
	Slot   int    `json:"slot"`
	Team   int    `json:"team"`
	HeroID int32  `json:"hero_id"`
	Hero   string `json:"hero"`
	Ranged bool   `json:"ranged"`
	res    int    // номер в CDOTA_PlayerResource
	hero   int32  // индекс сущности героя
	tslot  int    // место внутри команды в CDOTA_Data*
}

// inv: смена состояния предмета или способности. S: 1 — готов, 0 — на перезарядке, -1 — пропал.
type invEvent struct {
	T    float64 `json:"t"`
	Slot int     `json:"slot"`
	Kind string  `json:"k"` // i — предмет в инвентаре, n — нейтральный, t — свиток телепорта, a — способность
	Idx  int     `json:"i"` // номер ячейки
	Name string  `json:"n"`
	S    int     `json:"s"`
	Lvl  int32   `json:"l,omitempty"`
}

type ward struct {
	Kind  string  `json:"k"` // obs | sen
	T     float64 `json:"t"`
	T1    float64 `json:"t1"`
	Team  int     `json:"team"`
	Slot  int     `json:"slot"`
	X     int32   `json:"x"`
	Y     int32   `json:"y"`
	alive bool
}

type building struct {
	Name  string  `json:"n"`
	Team  int     `json:"team"`
	X     int32   `json:"x"`
	Y     int32   `json:"y"`
	T1    float64 `json:"t1"` // когда упало; 0 — дожило до конца
	alive bool
}

type creepFrame struct {
	T int     `json:"t"`
	L []int32 `json:"l"` // Свет: x, y, x, y...
	D []int32 `json:"d"` // Тьма
}

type logEvent struct {
	T   float64 `json:"t"`
	K   string  `json:"k"`
	A   string  `json:"a,omitempty"`    // кто (юнит)
	S   string  `json:"s,omitempty"`    // чей это юнит или урон (источник)
	V   string  `json:"v,omitempty"`    // цель
	I   string  `json:"i,omitempty"`    // чем
	N   int64   `json:"n,omitempty"`    // значение
	HP  int32   `json:"hp,omitempty"`   // здоровье цели после
	D   float64 `json:"d,omitempty"`    // длительность
	F   string  `json:"f,omitempty"`    // признаки: s — стан, r — корни, m — молчание, i — иллюзия цели, h — цель герой
	Slt *int    `json:"slot,omitempty"` // место игрока, если известно
}

type output struct {
	V        int          `json:"v"`
	MatchID  uint64       `json:"match_id"`
	GameMode int32        `json:"game_mode"`
	Winner   int32        `json:"winner"`
	T0       int          `json:"t0"`
	End      int          `json:"end"`
	Players  []*player    `json:"players"`
	Tracks   []*track     `json:"tracks"`
	Inv      []invEvent   `json:"inv"`
	Wards    []*ward      `json:"wards"`
	Build    []*building  `json:"buildings"`
	Creeps   []creepFrame `json:"creeps"`
	Log      []logEvent   `json:"log"`
}

type extractor struct {
	p        *manta.Parser
	ents     map[int32]*manta.Entity
	rules    *manta.Entity
	resource *manta.Entity
	data     [4]*manta.Entity
	players  []*player
	tracks   []*track
	secs     []int // серверные секунды каждой выборки
	lastSec  int
	inv      []invEvent
	invState map[string]int // "slot|kind|idx" → имя+состояние
	invName  map[string]string
	wards    map[int32]*ward
	wardList []*ward
	build    map[int32]*building
	buildLst []*building
	creeps   []creepFrame
	log      []logEvent
	hitSeen  map[string]bool
	probing  bool
	probed   bool
	start    float64 // серверное время горна
	out      output
}

func (x *extractor) serverTime() float64 {
	if x.rules == nil {
		return float64(x.p.NetTick) / 30
	}
	tick := int64(x.p.NetTick)
	if paused, ok := x.rules.GetBool("m_pGameRules.m_bGamePaused"); ok && paused {
		if ps, ok := x.rules.GetInt32("m_pGameRules.m_nPauseStartTick"); ok && ps > 0 {
			tick = int64(ps)
		}
	}
	if pt, ok := x.rules.GetInt32("m_pGameRules.m_nTotalPausedTicks"); ok {
		tick -= int64(pt)
	}
	return float64(tick) / 30
}

func (x *extractor) gameState() int32 {
	if x.rules == nil {
		return 0
	}
	if v, ok := x.rules.GetInt32("m_pGameRules.m_nGameState"); ok {
		return v
	}
	return 0
}

func num(e *manta.Entity, name string) (float64, bool) {
	switch v := e.Get(name).(type) {
	case int32:
		return float64(v), true
	case int64:
		return float64(v), true
	case uint32:
		return float64(v), true
	case uint64:
		return float64(v), true
	case float32:
		return float64(v), true
	case float64:
		return v, true
	case bool:
		if v {
			return 1, true
		}
		return 0, true
	}
	return 0, false
}

func numOr(e *manta.Entity, name string, def float64) float64 {
	if v, ok := num(e, name); ok {
		return v
	}
	return def
}

func pos(e *manta.Entity) (int32, int32, bool) {
	cx, ok1 := num(e, "CBodyComponent.m_cellX")
	cy, ok2 := num(e, "CBodyComponent.m_cellY")
	if !ok1 || !ok2 {
		return 0, 0, false
	}
	vx := numOr(e, "CBodyComponent.m_vecX", 0)
	vy := numOr(e, "CBodyComponent.m_vecY", 0)
	return int32(math.Round((cx + vx/128) * 100)), int32(math.Round((cy + vy/128) * 100)), true
}

func (x *extractor) entName(e *manta.Entity) string {
	// поле переименовали в одном из патчей 2026 года: пробуем новое имя, потом старое
	for _, f := range []string{"m_pEntity.m_nameStringTableIndex", "m_pEntity.m_nameStringableIndex"} {
		if idx, ok := e.GetInt32(f); ok && idx >= 0 {
			if s, ok := x.p.LookupStringByIndex("EntityNames", idx); ok && s != "" {
				return s
			}
		}
	}
	return ""
}

func (x *extractor) byHandle(h float64) *manta.Entity {
	if h == noHandle || h <= 0 {
		return nil
	}
	return x.ents[int32(uint32(h)&indexMask)]
}

// видит ли команда team сущность idx: бит в m_bNPCVisibleState
func (x *extractor) visibleTo(team int, idx int32) int8 {
	d := x.data[team]
	if d == nil {
		return 0
	}
	v, ok := d.GetUint64(fmt.Sprintf("m_bNPCVisibleState.%04d", idx/64))
	if !ok {
		return 0
	}
	return int8(v >> (uint(idx) % 64) & 1)
}

func (x *extractor) refreshPlayers() {
	if x.resource == nil {
		return
	}
	if x.players == nil {
		var ps []*player
		counts := map[int]int{}
		for i := 0; i < 24 && len(ps) < maxPlayers; i++ {
			team, ok := num(x.resource, fmt.Sprintf("m_vecPlayerData.%04d.m_iPlayerTeam", i))
			if !ok {
				break
			}
			if int(team) != teamLight && int(team) != teamDark {
				continue
			}
			pl := &player{res: i, Team: int(team), tslot: counts[int(team)]}
			if ts, ok := num(x.resource, fmt.Sprintf("m_vecPlayerTeamData.%04d.m_iTeamSlot", i)); ok {
				pl.tslot = int(ts)
			}
			counts[int(team)]++
			ps = append(ps, pl)
		}
		if len(ps) != maxPlayers {
			return
		}
		// порядок как в матче: сначала Свет, потом Тьма
		sort.SliceStable(ps, func(a, b int) bool { return ps[a].Team < ps[b].Team })
		for i, pl := range ps {
			pl.Slot = i
			pl.hero = -1
			pl.tslot = pl.tslot % 5
			x.tracks = append(x.tracks, &track{})
		}
		x.players = ps
	}
	for _, pl := range x.players {
		key := fmt.Sprintf("m_vecPlayerTeamData.%04d.", pl.res)
		if id, ok := num(x.resource, key+"m_nSelectedHeroID"); ok && id > 0 {
			pl.HeroID = int32(id)
		}
		if h, ok := num(x.resource, key+"m_hSelectedHero"); ok {
			if e := x.byHandle(h); e != nil {
				pl.hero = e.GetIndex()
				if n := x.entName(e); strings.HasPrefix(n, "npc_dota_hero_") {
					pl.Hero = n
				}
				pl.Ranged = numOr(e, "m_iAttackCapabilities", 1) == 2
			}
		}
	}
}

func (x *extractor) sample() {
	st := x.gameState()
	if st != 4 && st != 5 {
		return
	}
	now := x.serverTime()
	sec := int(math.Floor(now))
	if sec <= x.lastSec {
		return
	}
	x.refreshPlayers()
	if x.players == nil {
		return
	}
	// пропуск секунд (обрыв записи) заполняем повтором, чтобы массивы шли ровно по секундам
	rep := 1
	if x.lastSec > 0 && sec-x.lastSec > 1 && sec-x.lastSec < 600 {
		rep = sec - x.lastSec
	}
	for r := rep - 1; r >= 0; r-- {
		x.secs = append(x.secs, sec-r)
		for i, pl := range x.players {
			x.samplePlayer(i, pl)
		}
	}
	x.lastSec = sec
	x.sampleInventory(now)
	if sec%creepStep == 0 {
		x.sampleCreeps(sec)
	}
}

func (x *extractor) samplePlayer(i int, pl *player) {
	tr := x.tracks[i]
	var e *manta.Entity
	if pl.hero >= 0 {
		e = x.ents[pl.hero]
	}
	var px, py, hp, mhp, mp, mmp, nw int32
	var alive, vis int8
	var lvl, lh, dn int16
	if e != nil {
		px, py, _ = pos(e)
		hp = int32(numOr(e, "m_iHealth", 0))
		mhp = int32(numOr(e, "m_iMaxHealth", 0))
		mp = int32(numOr(e, "m_flMana", 0))
		mmp = int32(numOr(e, "m_flMaxMana", 0))
		lvl = int16(numOr(e, "m_iCurrentLevel", 0))
		if numOr(e, "m_lifeState", 1) == 0 {
			alive = 1
		}
		vis = x.visibleTo(teamLight+teamDark-pl.Team, pl.hero)
	}
	if d := x.data[pl.Team]; d != nil {
		key := fmt.Sprintf("m_vecDataTeam.%04d.", pl.tslot)
		nw = int32(numOr(d, key+"m_iNetWorth", 0))
		lh = int16(numOr(d, key+"m_iLastHitCount", 0))
		dn = int16(numOr(d, key+"m_iDenyCount", 0))
	}
	tr.X = append(tr.X, px)
	tr.Y = append(tr.Y, py)
	tr.HP = append(tr.HP, hp)
	tr.MaxHP = append(tr.MaxHP, mhp)
	tr.MP = append(tr.MP, mp)
	tr.MaxMP = append(tr.MaxMP, mmp)
	tr.Alive = append(tr.Alive, alive)
	tr.Vis = append(tr.Vis, vis)
	tr.Lvl = append(tr.Lvl, lvl)
	tr.NW = append(tr.NW, nw)
	tr.LH = append(tr.LH, lh)
	tr.DN = append(tr.DN, dn)
}

func skipAbility(name string) bool {
	return name == "" || strings.HasPrefix(name, "special_bonus") || strings.HasPrefix(name, "plus_") ||
		strings.HasPrefix(name, "ability_") || strings.HasSuffix(name, "_portal_warp") || name == "generic_hidden" ||
		strings.HasPrefix(name, "seasonal_") || strings.HasPrefix(name, "high_five")
}

func (x *extractor) invSet(now float64, slot int, kind string, idx int, name string, state int, lvl int32) {
	key := fmt.Sprintf("%d|%s|%d", slot, kind, idx)
	prevName := x.invName[key]
	prev, had := x.invState[key]
	if name == "" {
		if had && prev != -1 {
			x.inv = append(x.inv, invEvent{T: now, Slot: slot, Kind: kind, Idx: idx, Name: prevName, S: -1})
			x.invState[key] = -1
		}
		return
	}
	if had && prev == state && prevName == name {
		return
	}
	if had && prev != -1 && prevName != name {
		x.inv = append(x.inv, invEvent{T: now, Slot: slot, Kind: kind, Idx: idx, Name: prevName, S: -1})
	}
	x.inv = append(x.inv, invEvent{T: now, Slot: slot, Kind: kind, Idx: idx, Name: name, S: state, Lvl: lvl})
	x.invState[key] = state
	x.invName[key] = name
}

func (x *extractor) sampleInventory(now float64) {
	for i, pl := range x.players {
		if pl.hero < 0 {
			continue
		}
		e := x.ents[pl.hero]
		if e == nil {
			continue
		}
		items := []struct {
			idx  int
			kind string
		}{{0, "i"}, {1, "i"}, {2, "i"}, {3, "i"}, {4, "i"}, {5, "i"}, {15, "t"}, {16, "n"}}
		for _, it := range items {
			name, state := "", 0
			if h, ok := num(e, fmt.Sprintf("m_hItems.%04d", it.idx)); ok {
				if ie := x.byHandle(h); ie != nil {
					name = x.entName(ie)
					if numOr(ie, "m_fCooldown", 0) <= 0 {
						state = 1
					}
					// свиток телепорта без зарядов — всё равно что нет
					if it.kind == "t" && numOr(ie, "m_iCurrentCharges", 1) <= 0 {
						name = ""
					}
				}
			}
			x.invSet(now, i, it.kind, it.idx, name, state, 0)
		}
		for a := 0; a < 6; a++ {
			name, state := "", 0
			var lvl int32
			if h, ok := num(e, fmt.Sprintf("m_vecAbilities.%04d", a)); ok {
				if ae := x.byHandle(h); ae != nil {
					name = x.entName(ae)
					lvl = int32(numOr(ae, "m_iLevel", 0))
					if skipAbility(name) || lvl <= 0 || numOr(ae, "m_bHidden", 0) == 1 {
						name = ""
					}
					if numOr(ae, "m_fCooldown", 0) <= 0 {
						state = 1
					}
				}
			}
			x.invSet(now, i, "a", a, name, state, lvl)
		}
	}
}

func (x *extractor) sampleCreeps(sec int) {
	f := creepFrame{T: sec, L: []int32{}, D: []int32{}}
	// по порядку номеров сущностей: один и тот же реплей даёт один и тот же файл
	ids := make([]int32, 0, 64)
	for idx, e := range x.ents {
		if cn := e.GetClassName(); cn == "CDOTA_BaseNPC_Creep_Lane" || cn == "CDOTA_BaseNPC_Creep_Siege" {
			ids = append(ids, idx)
		}
	}
	sort.Slice(ids, func(a, b int) bool { return ids[a] < ids[b] })
	for _, idx := range ids {
		e := x.ents[idx]
		if numOr(e, "m_lifeState", 1) != 0 {
			continue
		}
		px, py, ok := pos(e)
		if !ok {
			continue
		}
		switch int(numOr(e, "m_iTeamNum", 0)) {
		case teamLight:
			f.L = append(f.L, px, py)
		case teamDark:
			f.D = append(f.D, px, py)
		}
	}
	x.creeps = append(x.creeps, f)
}

func (x *extractor) onEntity(e *manta.Entity, op manta.EntityOp) error {
	idx := e.GetIndex()
	cn := e.GetClassName()
	if op.Flag(manta.EntityOpDeleted) {
		if w := x.wards[idx]; w != nil && w.alive {
			w.alive = false
			w.T1 = x.serverTime()
		}
		delete(x.wards, idx)
		delete(x.build, idx)
		delete(x.ents, idx)
		return nil
	}
	x.ents[idx] = e
	switch cn {
	case "CDOTAGamerulesProxy":
		x.rules = e
		if gs, ok := num(e, "m_pGameRules.m_flGameStartTime"); ok && gs > 0 {
			x.start = gs
		}
	case "CDOTA_PlayerResource":
		x.resource = e
	case "CDOTA_DataRadiant":
		x.data[teamLight] = e
	case "CDOTA_DataDire":
		x.data[teamDark] = e
	case "CDOTA_NPC_Observer_Ward", "CDOTA_NPC_Observer_Ward_TrueSight":
		w := x.wards[idx]
		if w == nil && op.Flag(manta.EntityOpCreated) {
			px, py, _ := pos(e)
			w = &ward{Kind: "obs", T: x.serverTime(), Team: int(numOr(e, "m_iTeamNum", 0)), X: px, Y: py, alive: true,
				Slot: int(numOr(e, "m_nPlayerOwnerID", -2)) / 2}
			if cn != "CDOTA_NPC_Observer_Ward" {
				w.Kind = "sen"
			}
			x.wards[idx] = w
			x.wardList = append(x.wardList, w)
		}
		if w != nil && w.alive && numOr(e, "m_lifeState", 0) != 0 {
			w.alive = false
			w.T1 = x.serverTime()
		}
	case "CDOTA_BaseNPC_Tower", "CDOTA_BaseNPC_Barracks", "CDOTA_BaseNPC_Fort":
		b := x.build[idx]
		if b == nil && op.Flag(manta.EntityOpCreated) {
			px, py, _ := pos(e)
			b = &building{Name: x.entName(e), Team: int(numOr(e, "m_iTeamNum", 0)), X: px, Y: py, alive: true}
			x.build[idx] = b
			x.buildLst = append(x.buildLst, b)
		}
		if b != nil {
			if b.Name == "" {
				b.Name = x.entName(e)
			}
			if b.alive && numOr(e, "m_lifeState", 0) != 0 {
				b.alive = false
				b.T1 = x.serverTime()
			}
		}
	}
	return nil
}

func (x *extractor) name(i uint32) string {
	if s, ok := x.p.LookupStringByIndex("CombatLogNames", int32(i)); ok {
		return s
	}
	return ""
}

func isHeroName(s string) bool { return strings.HasPrefix(s, "npc_dota_hero_") }

var keepModifiers = map[string]bool{
	"modifier_smoke_of_deceit": true, "modifier_teleporting": true, "modifier_black_king_bar_immune": true,
	"modifier_item_glimmer_cape_fade": true, "modifier_aegis_regen": true, "modifier_item_aeon_disk_buff": true,
}

func (x *extractor) onCombatLog(m *dota.CMsgDOTACombatLogEntry) error {
	t := float64(m.GetTimestamp())
	attacker, source, target, infl := x.name(m.GetAttackerName()), x.name(m.GetDamageSourceName()), x.name(m.GetTargetName()), x.name(m.GetInflictorName())
	if infl == "dota_unknown" {
		infl = ""
	}
	owner := source
	if owner == "" || owner == "dota_unknown" {
		owner = attacker
	}
	switch m.GetType() {
	case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_DAMAGE:
		if m.GetValue() == 0 {
			return nil
		}
		if isHeroName(target) {
			f := ""
			if m.GetIsTargetIllusion() {
				f = "i"
			}
			x.log = append(x.log, logEvent{T: t, K: "dmg", A: attacker, S: owner, V: target, I: infl, N: int64(m.GetValue()), HP: m.GetHealth(), F: f})
		} else if isHeroName(owner) && !m.GetIsAttackerIllusion() {
			// удар героя по не-герою: нужен только факт «чем был занят»
			key := fmt.Sprintf("%d|%s|%s", int(t), owner, target)
			if !x.hitSeen[key] {
				x.hitSeen[key] = true
				x.log = append(x.log, logEvent{T: math.Floor(t), K: "hit", S: owner, V: target})
			}
		}
	case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_DEATH:
		f := ""
		if m.GetIsTargetIllusion() {
			f += "i"
		}
		if m.GetIsTargetHero() {
			f += "h"
		}
		if m.GetWillReincarnate() {
			f += "a"
		}
		x.log = append(x.log, logEvent{T: t, K: "death", A: attacker, S: owner, V: target, I: infl, F: f})
	case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_ABILITY:
		if m.GetIsAttackerHero() && !m.GetIsAttackerIllusion() && infl != "" {
			x.log = append(x.log, logEvent{T: t, K: "abil", A: attacker, V: target, I: infl, N: int64(m.GetAbilityLevel())})
		}
	case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_ITEM:
		if m.GetIsAttackerHero() && !m.GetIsAttackerIllusion() && infl != "" {
			x.log = append(x.log, logEvent{T: t, K: "item", A: attacker, V: target, I: infl})
		}
	case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_MODIFIER_ADD:
		if !isHeroName(target) || m.GetIsTargetIllusion() {
			return nil
		}
		f := ""
		if m.GetStunDuration() > 0 {
			f += "s"
		}
		if m.GetRootModifier() {
			f += "r"
		}
		if m.GetSilenceModifier() {
			f += "m"
		}
		if f == "" && !keepModifiers[infl] {
			return nil
		}
		d := float64(m.GetModifierDuration())
		if sd := float64(m.GetStunDuration()); sd > 0 {
			d = sd
		}
		x.log = append(x.log, logEvent{T: t, K: "mod", A: attacker, V: target, I: infl, D: math.Round(d*100) / 100, F: f})
	case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_MODIFIER_REMOVE:
		if isHeroName(target) && !m.GetIsTargetIllusion() && keepModifiers[infl] {
			x.log = append(x.log, logEvent{T: t, K: "modoff", V: target, I: infl})
		}
	case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_HEAL:
		if isHeroName(target) && !m.GetIsTargetIllusion() && m.GetValue() >= 50 && !m.GetHealFromRegen() {
			x.log = append(x.log, logEvent{T: t, K: "heal", S: owner, V: target, I: infl, N: int64(m.GetValue())})
		}
	case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_PURCHASE:
		x.log = append(x.log, logEvent{T: t, K: "buy", V: target, I: x.name(m.GetValue())})
	case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_BUYBACK:
		s := int(m.GetValue())
		x.log = append(x.log, logEvent{T: t, K: "buyback", Slt: &s})
	case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_TEAM_BUILDING_KILL:
		x.log = append(x.log, logEvent{T: t, K: "building", V: target, N: int64(m.GetValue())})
	case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_GAME_STATE:
		x.log = append(x.log, logEvent{T: t, K: "state", N: int64(m.GetValue())})
	case dota.DOTA_COMBATLOG_TYPES_DOTA_COMBATLOG_FIRST_BLOOD:
		x.log = append(x.log, logEvent{T: t, K: "firstblood"})
	}
	return nil
}

func round2(v float64) float64 { return math.Round(v*100) / 100 }

func main() {
	if len(os.Args) < 2 {
		fmt.Fprintln(os.Stderr, "запуск: deep-extract replay.dem > raw.json")
		os.Exit(2)
	}
	f, err := os.Open(os.Args[1])
	if err != nil {
		fmt.Fprintln(os.Stderr, "не открылся файл реплея:", err)
		os.Exit(2)
	}
	defer f.Close()
	p, err := manta.NewStreamParser(bufio.NewReaderSize(f, 1<<20))
	if err != nil {
		fmt.Fprintln(os.Stderr, "парсер не принял файл:", err)
		os.Exit(2)
	}
	x := &extractor{p: p, ents: map[int32]*manta.Entity{}, invState: map[string]int{}, invName: map[string]string{},
		wards: map[int32]*ward{}, build: map[int32]*building{}, hitSeen: map[string]bool{}}
	x.out.V = 1
	p.OnEntity(x.onEntity)
	p.Callbacks.OnCMsgDOTACombatLogEntry(x.onCombatLog)
	if os.Getenv("DEEP_PROBE") != "" {
		x.probing = true
		x.probeSetup()
	}
	p.Callbacks.OnCNETMsg_Tick(func(*dota.CNETMsg_Tick) error {
		x.sample()
		if x.probing {
			x.probe()
		}
		return nil
	})
	p.Callbacks.OnCDemoFileInfo(func(m *dota.CDemoFileInfo) error {
		if d := m.GetGameInfo().GetDota(); d != nil {
			x.out.MatchID = d.GetMatchId()
			x.out.GameMode = d.GetGameMode()
			x.out.Winner = d.GetGameWinner()
		}
		return nil
	})
	// реплей бывает обрезан в конце: что успели разобрать, то и отдаём
	if err := p.Start(); err != nil {
		fmt.Fprintln(os.Stderr, "разбор оборвался:", err)
	}
	if x.players == nil || len(x.secs) < 60 || x.start <= 0 {
		fmt.Fprintln(os.Stderr, "в реплее нет игроков или игра не началась")
		os.Exit(3)
	}
	for _, pl := range x.players {
		if pl.Hero == "" {
			// без имён героев журнал боя не привязать к игрокам: лучше не отдать ничего, чем отдать пустой разбор
			fmt.Fprintln(os.Stderr, "не нашлись имена героев: похоже, после патча поменялись поля, запусти проверку с probe")
			os.Exit(4)
		}
	}

	start := x.start
	rel := func(t float64) float64 { return round2(t - start) }
	x.out.T0 = int(math.Round(float64(x.secs[0]) - start))
	x.out.End = x.out.T0 + len(x.secs) - 1
	x.out.Players = x.players
	x.out.Tracks = x.tracks
	for i := range x.inv {
		x.inv[i].T = rel(x.inv[i].T)
	}
	x.out.Inv = x.inv
	end := float64(x.secs[len(x.secs)-1])
	for _, w := range x.wardList {
		if w.alive || w.T1 == 0 {
			w.T1 = end
		}
		w.T, w.T1 = rel(w.T), rel(w.T1)
		// место игрока в PlayerResource → место 0..9 (сначала Свет)
		w.Slot = x.slotOf(w.Slot)
	}
	x.out.Wards = x.wardList
	for _, b := range x.buildLst {
		if b.T1 > 0 {
			b.T1 = rel(b.T1)
		}
	}
	x.out.Build = x.buildLst
	for i := range x.creeps {
		x.creeps[i].T = int(math.Round(float64(x.creeps[i].T) - start))
	}
	x.out.Creeps = x.creeps
	for i := range x.log {
		x.log[i].T = rel(x.log[i].T)
		if x.log[i].Slt != nil {
			s := x.slotOf(*x.log[i].Slt)
			x.log[i].Slt = &s
		}
	}
	x.out.Log = x.log
	if x.out.Inv == nil {
		x.out.Inv = []invEvent{}
	}
	if x.out.Log == nil {
		x.out.Log = []logEvent{}
	}

	w := bufio.NewWriterSize(os.Stdout, 1<<20)
	defer w.Flush()
	enc := json.NewEncoder(w)
	if err := enc.Encode(&x.out); err != nil {
		fmt.Fprintln(os.Stderr, "не записался результат:", err)
		os.Exit(1)
	}
}

// номер игрока в PlayerResource (0..23) → место 0..9
func (x *extractor) slotOf(resIdx int) int {
	for i, pl := range x.players {
		if pl.res == resIdx {
			return i
		}
	}
	return -1
}
