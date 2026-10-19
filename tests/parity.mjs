// Прогоняет JS-движок на фикстуре и печатает оценки и находки для сверки с Python
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { analyze, createDictionary } from "../docs/engine.js";

const load = (path) => JSON.parse(gunzipSync(readFileSync(new URL(path, import.meta.url))).toString());
const constants = load("./fixtures/constants.json.gz");
const match = load("./fixtures/match_9052987576.json.gz");
const knowledge = JSON.parse(readFileSync(new URL("../docs/knowledge.json", import.meta.url)));
const od = createDictionary(constants);

const result = match.players.map((p) => {
  const a = analyze(match, p, od, knowledge);
  return { scores: a.scores, findings: a.findings };
});
process.stdout.write(JSON.stringify(result));
