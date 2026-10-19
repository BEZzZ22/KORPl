// Прогоняет JS-движок на фикстуре и печатает разбор для сверки с Python
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { analyze, createDictionary } from "../docs/engine.js";

const load = (path) => JSON.parse(gunzipSync(readFileSync(new URL(path, import.meta.url))).toString());
const json = (path) => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const constants = load("./fixtures/constants.json.gz");
const match = load("./fixtures/match_9052987576.json.gz");
const pro = load("./fixtures/pro_items.json.gz");
const knowledge = json("../docs/knowledge.json");
const texts = json("../docs/texts.json");
const od = createDictionary(constants);

const result = match.players.map((p) => {
  const a = analyze(match, p, od, knowledge, texts, pro[String(p.hero_id)] || {});
  return {
    scores: a.scores, findings: a.findings, phases: a.phases, moments: a.moments,
    pro_build: a.pro_build, verdict: a.verdict, killers: a.killers,
  };
});
process.stdout.write(JSON.stringify(result));
