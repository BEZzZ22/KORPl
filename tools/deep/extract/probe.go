package main

// Отладка: DEEP_PROBE=1 печатает в stderr, откуда в этом патче брать имена героев, предметов и способностей.
// Нужна после обновлений игры, когда имена перестают находиться. В обычном прогоне не работает.

import (
	"encoding/binary"
	"fmt"
	"os"
	"regexp"
	"sort"
	"strings"

	"github.com/dotabuff/manta"
	"github.com/dotabuff/manta/dota"
)

// MurmurHash2 со стандартным для Source 2 зерном: так движок превращает имя в число (CUtlStringToken)
func token(s string) uint32 {
	const m = 0x5bd1e995
	data := []byte(strings.ToLower(s))
	h := uint32(0x31415926) ^ uint32(len(data))
	for len(data) >= 4 {
		k := binary.LittleEndian.Uint32(data)
		k *= m
		k ^= k >> 24
		k *= m
		h *= m
		h ^= k
		data = data[4:]
	}
	switch len(data) {
	case 3:
		h ^= uint32(data[2]) << 16
		fallthrough
	case 2:
		h ^= uint32(data[1]) << 8
		fallthrough
	case 1:
		h ^= uint32(data[0])
		h *= m
	}
	h ^= h >> 13
	h *= m
	h ^= h >> 15
	return h
}

var probeRe = regexp.MustCompile(`(?i)name|subclass|m_pEntity|label|unitname`)

func (x *extractor) probeSetup() {
	x.p.Callbacks.OnCSVCMsg_CreateStringTable(func(m *dota.CSVCMsg_CreateStringTable) error {
		fmt.Fprintln(os.Stderr, "таблица строк:", m.GetName(), m.GetNumEntries())
		return nil
	})
}

func (x *extractor) probeDump(title string, e *manta.Entity) {
	if e == nil {
		fmt.Fprintln(os.Stderr, "===", title, "нет сущности")
		return
	}
	fmt.Fprintln(os.Stderr, "===", title, e.GetClassName(), "индекс", e.GetIndex())
	m := e.Map()
	keys := make([]string, 0, len(m))
	for k := range m {
		if probeRe.MatchString(k) {
			keys = append(keys, k)
		}
	}
	sort.Strings(keys)
	for _, k := range keys {
		fmt.Fprintf(os.Stderr, "  %s = %v (%T)\n", k, m[k], m[k])
	}
	// известные имена из журнала боя: совпадает ли число сущности с хешем имени
	tokens := map[uint32]string{}
	for i := int32(0); i < 5000; i++ {
		s, ok := x.p.LookupStringByIndex("CombatLogNames", i)
		if !ok {
			break
		}
		tokens[token(s)] = s
	}
	for _, k := range keys {
		var v uint32
		switch n := m[k].(type) {
		case uint32:
			v = n
		case uint64:
			v = uint32(n)
		case int32:
			v = uint32(n)
		case int64:
			v = uint32(n)
		default:
			continue
		}
		if s, ok := tokens[v]; ok {
			fmt.Fprintf(os.Stderr, "  ХЕШ СОВПАЛ: %s → %s\n", k, s)
		}
		for _, table := range []string{"EntityNames", "CombatLogNames", "ModifierNames", "GenericPrecache", "EconItems"} {
			if s, ok := x.p.LookupStringByIndex(table, int32(v)); ok && s != "" && v > 0 && v < 100000 {
				fmt.Fprintf(os.Stderr, "  %s[%d] из %s = %s\n", k, v, table, s)
			}
		}
	}
}

func (x *extractor) probe() {
	if x.probed || x.players == nil || x.serverTime()-x.start < 300 || x.start <= 0 {
		return
	}
	x.probed = true
	pl := x.players[0]
	h := x.ents[pl.hero]
	x.probeDump("герой", h)
	if h != nil {
		for _, f := range []string{"m_hItems.0000", "m_hItems.0001", "m_hItems.0015", "m_vecAbilities.0000", "m_vecAbilities.0005"} {
			if v, ok := num(h, f); ok {
				x.probeDump(f, x.byHandle(v))
			}
		}
	}
	for _, e := range x.ents {
		if e.GetClassName() == "CDOTA_BaseNPC_Tower" {
			x.probeDump("вышка", e)
			break
		}
	}
}
