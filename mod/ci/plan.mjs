// Decide per quali versioni di Minecraft compilare Nexus Companion.
//
// Legge le versioni stabili da Fabric, assegna ognuna alla sua era (eras.json: l'era più
// recente non ha massimo, quindi le versioni nuove ci finiscono da sole), trova la Fabric API
// adatta e confronta con l'indice già pubblicato: si ricompila tutto se il codice della mod è
// cambiato, altrimenti solo le versioni nuove. Scrive `matrix` e `count` in GITHUB_OUTPUT.
import { appendFileSync, readFileSync } from "node:fs";

const { SOURCE_HASH = "", REPO = "TiclyMusic/nexus-client", FORCE = "", GITHUB_OUTPUT } = process.env;

const parse = (v) => v.split(".").map((n) => parseInt(n, 10) || 0);
const cmp = (a, b) => {
	const x = parse(a), y = parse(b);
	for (let i = 0; i < Math.max(x.length, y.length); i++) {
		const d = (x[i] ?? 0) - (y[i] ?? 0);
		if (d) return d;
	}
	return 0;
};

const { eras } = JSON.parse(readFileSync(new URL("../eras.json", import.meta.url)));
const eraOf = (mc) => eras.find((e) => cmp(mc, e.min) >= 0 && (e.max == null || cmp(mc, e.max) <= 0));

const games = await (await fetch("https://meta.fabricmc.net/v2/versions/game")).json();
const stable = games.filter((g) => g.stable).map((g) => g.version);

const metadata = await (await fetch("https://maven.fabricmc.net/net/fabricmc/fabric-api/fabric-api/maven-metadata.xml")).text();
const apiVersions = [...metadata.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]);
// l'ultima Fabric API pubblicata per quella versione esatta (formato x.y.z+<mc>)
const fabricApiFor = (mc) => apiVersions.filter((v) => v.endsWith(`+${mc}`)).pop();

let index = {};
try {
	const res = await fetch(`https://github.com/${REPO}/releases/download/companion/companion.json`);
	if (res.ok) index = await res.json();
} catch {}
const rebuildAll = FORCE === "true" || index.sourceHash !== SOURCE_HASH;

const matrix = [];
for (const mc of stable) {
	const era = eraOf(mc);
	if (!era) continue; // più vecchia della prima era supportata
	const fabricApi = fabricApiFor(mc);
	if (!fabricApi) {
		console.log(`${mc}: Fabric API non ancora disponibile, riprovo al prossimo giro`);
		continue;
	}
	if (!rebuildAll && index.versions?.[mc]) continue;
	matrix.push({ mc, fabric_api: fabricApi, era: era.name });
}

console.log(rebuildAll ? "Codice della mod cambiato: ricompilo tutto" : "Solo versioni nuove");
console.table(matrix);
if (GITHUB_OUTPUT) {
	appendFileSync(GITHUB_OUTPUT, `matrix=${JSON.stringify({ include: matrix })}\n`);
	appendFileSync(GITHUB_OUTPUT, `count=${matrix.length}\n`);
}
