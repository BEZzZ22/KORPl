// Видеоразбор: моменты + сценарий под хронометраж. Ролик должен уложиться в 60–90 секунд:
// сначала убираем фразы «чем кончилось» (они остаются плашками), потом — самый слабый момент.
import { findMoments } from "./moments.mjs";
import { buildScript } from "./script.mjs";
import { buildTimeline } from "./timeline.mjs";

export const MAX_SECONDS = 90;

export function plan(data, me, { maxSeconds = MAX_SECONDS } = {}) {
  let best = null;
  for (let max = 5; max >= 3; max--) {
    const found = findMoments(data, me, { max });
    for (const cons of [true, false]) {
      const script = buildScript(data, found, { cons });
      const seconds = buildTimeline(data, found, script).duration;
      best = { found, script, seconds };
      if (seconds <= maxSeconds || !found.moments.length) return best;
    }
    if (found.moments.length < max) break; // моментов и так меньше: дальше резать нечего
  }
  return best;
}
