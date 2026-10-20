// Мост для бота: читает JSON из stdin, запускает движок разбора (docs/engine.js) и печатает результат.
// Вход: { match, slot, pro_items, hero_bench, constants: { heroes, items, abilities } }
import { readFileSync } from "node:fs";
import { analyze, createDictionary } from "./docs/engine.js";

const docs = (name) => JSON.parse(readFileSync(new URL(`./docs/${name}`, import.meta.url), "utf8"));
const knowledge = docs("knowledge.json");
const texts = docs("texts.json");
let norms = {};
try { norms = docs("rank_norms.json"); } catch { /* нормы по рангам ещё не собраны */ }

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks).toString("utf8"));

const player = input.match.players.find((p) => p.player_slot === input.slot);
if (!player) {
  process.stderr.write(`player_slot ${input.slot} not in match\n`);
  process.exit(2);
}
const od = createDictionary(input.constants);
const result = analyze(input.match, player, od, knowledge, texts, input.pro_items || {}, input.hero_bench || {}, norms, input.matchups || []);
process.stdout.write(JSON.stringify(result));
