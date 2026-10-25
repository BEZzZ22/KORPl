# Кемпы для docs/dotamap.js (CAMPS) из разметки реплеев (tools/mapdata.out.json — артефакт workflow «Разметка карты»).
# Каждое убийство нейтрала — точка героя-убийцы. Густые места = кемпы, тир — по тому, каких крипов там били чаще.
# Запуск: python tools/camps.py mapdata.out.json
import json, re, sys
from collections import Counter

import numpy as np


def tier(name):
    if re.search(r"ancient_frog|black_d|granite|rock_golem|thunder_lizard|prowler|frostbitten|ice_shaman", name): return "ancient"
    if re.search(r"centaur_khan|satyr_hellcaller|polar_furbolg|wildkin|dark_troll|warpine|grown_frog", name): return "large"
    if re.search(r"centaur_outrunner|satyr_(trickster|soulstealer)|ogre|mud_golem|giant_wolf|alpha_wolf|froglet", name): return "medium"
    if "roshan" in name: return None
    return "small"


data = json.load(open(sys.argv[1]))
pts = [(x - 64, 192 - y, tier(n)) for m in data.values() for x, y, n, _ in m["kills"] if tier(n)]
G = 4  # точек сетки на клетку
grid = np.zeros((128 * G, 128 * G))
for x, y, _ in pts:
    i, j = int(y * G), int(x * G)
    if 0 <= i < 128 * G and 0 <= j < 128 * G:
        grid[i, j] += 1
s = 2.2 * G
r = int(3 * s)
k = np.exp(-(np.arange(-r, r + 1) ** 2) / (2 * s * s))
k /= k.sum()
b = np.apply_along_axis(lambda m: np.convolve(m, k, "same"), 0, grid)
b = np.apply_along_axis(lambda m: np.convolve(m, k, "same"), 1, b)
R = int(3.5 * G)
camps = []
for i, j in zip(*np.nonzero(b >= 0.02)):
    if b[i, j] >= b[max(0, i - R):i + R + 1, max(0, j - R):j + R + 1].max():
        x, y = j / G, i / G
        near = Counter(t for px, py, t in pts if (px - x) ** 2 + (py - y) ** 2 < 16)
        camps.append([round(x, 1), round(y, 1), near.most_common(1)[0][0]])
for c in sorted(camps, key=lambda c: (c[1], c[0])):
    print(json.dumps(c, ensure_ascii=False) + ",")
