"""График нетворса игрока против оппонента по линии — в тёмной «адской» палитре."""
import io

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

BG = "#0b0606"
PANEL = "#140909"
GRID = "#2a1414"
TEXT = "#c9b8a6"
TITLE = "#e0b15c"
PLAYER = "#ff6a2a"
OPPONENT = "#9b3b5a"
DEATH = "#ff2a2a"
ADV_UP = "#ff8a3d"
ADV_DOWN = "#7a1020"


def networth_chart(timeline: dict) -> bytes:
    player = [v / 1000 for v in timeline["player"]]
    minutes = list(range(len(player)))
    adv = [v / 1000 for v in (timeline.get("team_gold_adv") or [])][: len(player)]

    fig, (ax, ax2) = plt.subplots(
        2, 1, figsize=(8, 5.6), dpi=130, sharex=True, gridspec_kw={"height_ratios": [3, 1.3], "hspace": 0.12}
    )
    fig.patch.set_facecolor(BG)

    for a in (ax, ax2):
        a.set_facecolor(PANEL)
        a.tick_params(colors=TEXT, labelsize=9)
        a.grid(color=GRID, linewidth=0.8)
        for spine in a.spines.values():
            spine.set_visible(False)

    # Свечение линии игрока: несколько полупрозрачных слоёв под основной линией
    for width, alpha in ((9, 0.06), (6, 0.1), (3.5, 0.18)):
        ax.plot(minutes, player, color=PLAYER, linewidth=width, alpha=alpha, solid_capstyle="round")
    ax.plot(minutes, player, color=PLAYER, linewidth=2.2, label=timeline["hero"])
    ax.fill_between(minutes, player, color=PLAYER, alpha=0.07)

    if timeline.get("opponent"):
        opp = [v / 1000 for v in timeline["opponent"][: len(player)]]
        ax.plot(range(len(opp)), opp, color=OPPONENT, linewidth=2, label=timeline["opponent_name"])

    for t in timeline["deaths"]:
        m = min(int(t // 60), len(player) - 1)
        ax.scatter(t / 60, player[m], marker="x", color=DEATH, s=46, zorder=5, linewidths=2.2)
    if timeline["deaths"]:
        ax.scatter([], [], marker="x", color=DEATH, label="твои смерти")

    ax.set_title("Нетворс по минутам", color=TITLE, fontsize=13, loc="left", pad=10, fontweight="bold")
    ax.set_ylabel("тыс. золота", color=TEXT)
    ax.legend(facecolor=BG, edgecolor=GRID, labelcolor=TEXT, loc="upper left", fontsize=9)

    if adv:
        ax2.fill_between(range(len(adv)), adv, where=[v >= 0 for v in adv], color=ADV_UP, alpha=0.55, interpolate=True)
        ax2.fill_between(range(len(adv)), adv, where=[v < 0 for v in adv], color=ADV_DOWN, alpha=0.8, interpolate=True)
        ax2.axhline(0, color=TEXT, linewidth=0.6, alpha=0.5)
        ax2.set_ylabel("команда", color=TEXT)
    ax2.set_xlabel("минута", color=TEXT)

    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor=BG, bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()
