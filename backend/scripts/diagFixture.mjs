// One-off diagnostic: dump score + goal events for a fixture to expose the
// own-goal attribution that detectInconsistency() may be mis-counting.
//   node scripts/diagFixture.mjs 1524947
import "dotenv/config";
import axios from "axios";

const fid = process.argv[2] || "1524947";
const key = process.env.API_FOOTBALL_KEY;
const base = "https://v3.football.api-sports.io";

if (!key) {
  console.error("API_FOOTBALL_KEY missing from env (.env not loaded?)");
  process.exit(1);
}
const h = { "x-apisports-key": key };

async function get(path, params) {
  const { data } = await axios.get(base + path, { headers: h, params });
  if (data.errors && Object.keys(data.errors).length) {
    console.error("API errors:", JSON.stringify(data.errors));
  }
  return data.response || [];
}

try {
  const [fx] = await get("/fixtures", { id: fid });
  if (!fx) {
    console.log("NO FIXTURE RETURNED for id", fid);
    process.exit(0);
  }
  const homeId = fx.teams.home.id;
  const awayId = fx.teams.away.id;
  console.log("status:", fx.fixture.status.short, fx.fixture.status.long);
  console.log("home:", homeId, fx.teams.home.name, "| away:", awayId, fx.teams.away.name);
  console.log("goals:", JSON.stringify(fx.goals), "| ft:", JSON.stringify(fx.score.fulltime), "| ht:", JSON.stringify(fx.score.halftime));
  console.log("league:", fx.league.id, fx.league.name, fx.league.season);

  const events = await get("/fixtures/events", { fixture: fid });
  console.log("\nEVENTS total:", events.length);
  let rawHome = 0, rawAway = 0;          // counted by raw event.team
  let credHome = 0, credAway = 0;        // counted by beneficiary (own-goal flipped)
  for (const e of events) {
    if (String(e.type).toLowerCase() !== "goal") continue;
    const isOwn = String(e.detail || "").toLowerCase().includes("own");
    const evSide = e.team.id === homeId ? "HOME" : e.team.id === awayId ? "AWAY" : "??";
    const credSide = isOwn ? (evSide === "HOME" ? "AWAY" : evSide === "AWAY" ? "HOME" : "??") : evSide;
    if (evSide === "HOME") rawHome++; else if (evSide === "AWAY") rawAway++;
    if (credSide === "HOME") credHome++; else if (credSide === "AWAY") credAway++;
    console.log(`GOAL evTeam=${evSide}(${e.team.name}) own=${isOwn} player="${e.player?.name}" detail="${e.detail}" comments="${e.comments || ""}"`);
  }
  console.log("\nTally by RAW event.team   :", rawHome, "-", rawAway);
  console.log("Tally by CREDITED (flip)  :", credHome, "-", credAway);
  console.log("Actual final score        :", fx.goals.home, "-", fx.goals.away);
  console.log("\n=> RAW matches score?     :", rawHome === fx.goals.home && rawAway === fx.goals.away);
  console.log("=> CREDITED matches score?:", credHome === fx.goals.home && credAway === fx.goals.away);
} catch (err) {
  console.error("FAILED:", err?.response?.status, err?.message);
  process.exit(1);
}
