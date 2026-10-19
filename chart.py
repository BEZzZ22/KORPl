"""График нетворса игрока против оппонента по линии."""
import io

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402

BG = "#15171c"
GRID = "#2a2e36"
TEXT = "#c9ced8"
PLAYER = "#4fc3f7"
OPPONENT = "#ef6c57"


def networth_chart(timeline: dict) -> bytes:
    player = timeline["player"]
    minutes = list(range(len(player)))

    fig, ax = plt.subplots(figsize=(8, 4.2), dpi=130)
    fig.patch.set_facecolor(BG)
    ax.set_facecolor(BG)

    ax.plot(minutes, [v / 1000 for v in player], color=PLAYER, linewidth=2.4, label=timeline["hero"])
    if timeline.get("opponent"):
        opp = timeline["opponent"][: len(player)]
        ax.plot(range(len(opp)), [v / 1000 for v in opp], color=OPPONENT, linewidth=2,
                label=timeline["opponent_name"], alpha=0.9)

    for t in timeline["deaths"]:
        m = min(int(t // 60), len(player) - 1)
        ax.scatter(t / 60, player[m] / 1000, marker="x", color="#ff5252", s=40, zorder=5, linewidths=2)
    if timeline["deaths"]:
        ax.scatter([], [], marker="x", color="#ff5252", label="твои смерти")

    ax.set_title("Нетворс по минутам", color=TEXT, fontsize=12, loc="left", pad=10)
    ax.set_xlabel("минута", color=TEXT)
    ax.set_ylabel("тыс. золота", color=TEXT)
    ax.tick_params(colors=TEXT)
    ax.grid(color=GRID, linewidth=0.8)
    for spine in ax.spines.values():
        spine.set_visible(False)
    ax.legend(facecolor=BG, edgecolor=GRID, labelcolor=TEXT, loc="upper left")
    fig.tight_layout()

    buf = io.BytesIO()
    fig.savefig(buf, format="png", facecolor=BG)
    plt.close(fig)
    return buf.getvalue()
