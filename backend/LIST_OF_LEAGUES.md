League and competition IDs below are **API-Football** ([api-sports.io](https://www.api-football.com/)) `league.id` values from the `/v3/leagues` endpoint (verified by fetching the catalogue). Where the API uses a different display name than the colloquial title, it is noted in parentheses.

### Europe (Top 5)

- English Premier League — `39` (Premier League · England)
- La Liga — `140` (Spain)
- Serie A — `135` (Italy)
- Bundesliga — `78` (Germany)
- Ligue 1 — `61` (France)

### UEFA Competitions

- UEFA Champions League — `2`
- UEFA Europa League — `3`
- UEFA Europa Conference League — `848`

---

### Europe

- Primeira Liga (Portugal) — `94`
- Eredivisie (Netherlands) — `88`
- Belgian Pro League — `144` (Jupiler Pro League)
- Turkish Süper Lig — `203`
- Scottish Premiership — `179`
- Russia premier league — `235` (Premier League)
- Ukrain premier league — `333` (Premier League)
- Israel premier league — `383` (Ligat Ha'al)

## Europe (Domestic Cups)

- FA Cup (England) — `45`
- EFL Cup / Carabao Cup (England) — `48` (League Cup)
- Copa del Rey (Spain) — `143`
- Coppa Italia (Italy) — `137`
- DFB-Pokal (Germany) — `81` (DFB Pokal)
- Coupe de France (France) — `66`

### Americas

- Major League Soccer (USA) — `253`
- Liga MX (Mexico) — `262`
- Argentine Primera División — `128` (Liga Profesional Argentina)
- Campeonato Brasileiro Série A — `71` (Serie A)

### Asia / Middle East

- Saudi Pro League — `307` (Pro League)
- J1 League (Japan) — `98`
- Chinese Super League — `169` (Super League)
- King Cup (Saudi Arabia) — `504` (King's Cup)

---

### Africa

- Ethiopian Premier League — `363` (Premier League)
- Egyptian Premier League — `233` (Premier League)
- South African Premier Division — `288` (Premier Soccer League)
- Algeria league — `186` (Ligue 1)

### Europe (Lower Divisions)

- EFL Championship (England) — `40`
- League 1 (England) — `41` (League One)
- League 2 (England) — `42` (League Two)
- Serie B (Italy) — `136`
- Bundesliga 2  (Germany) — `79` 
- Segunda (Spain) — `141` (Segunda División)

### Scandinavia

- Allsvenskan (Sweden) — `113`
- Eliteserien (Norway) — `103`
- Danish Superliga — `119`

### Eastern Europe

- Ekstraklasa (Poland) — `106`
- Czech First League — `345` (Czech Liga)
- Croatian First Football League — `210` (HNL)
- Greek league — `197` (Super League 1)

---

## Others

- Indian Super League — `323`
- A-League (Australia) — `188`
- Qatar Stars League — `305` (Stars League)
- UAE Pro League — `301` (country: `United-Arab-Emirates` in the API)
- South Korean K League 1 — `292`

## International Competitions (National Teams)

### Global

- FIFA World Cup — `1`
- FIFA World Cup Qualification — `29` (Africa), `30` (Asia), `31` (CONCACAF), `32` (Europe), `33` (Oceania), `34` (South America), `37` (Intercontinental play-offs) — the API splits qualification by confederation; there is no single parent id for all qualifiers

### Continental (Including Qualifications)

- UEFA European Championship (EURO) — `4` (Euro Championship)
- Africa Cup of Nations (AFCON) — `6`
- Copa América — `9` (Copa America)
- AFC Asian Cup — `7` (Asian Cup)
- CONCACAF Gold Cup — `22`

### Nations League Competitions (Including Qualifications)

- UEFA Nations League — `5`

---

## Continental Club Competitions (Other Regions)

### South America

- Copa Libertadores — `13` (CONMEBOL Libertadores)
- Copa Sudamericana — `11` (CONMEBOL Sudamericana)

### Africa

- CAF Champions League — `12`
- CAF Confederation Cup — `20`

### Asia

- AFC Champions League — `17` (AFC Champions League Elite), `18` (AFC Champions League Two) — the API uses two tiers; there is no single legacy `AFC Champions League` id

---

## Friendly Matches

### International Friendlies

- International Friendly Matches (National Teams) — `10` (Friendlies)

### Club Friendlies

- Club Friendly Matches — `667` (Friendlies Clubs)
- Pre-season Tournaments — *no single league id* — many exhibition games map to `667` (Friendlies Clubs); the FIFA Intercontinental Cup is `1168` if you need a named annual event

---

## Women’s Football

### International

- FIFA Women's World Cup — `8` (World Cup - Women)
- UEFA Women's EURO — `743` (UEFA Championship - Women — national-team EURO in the API)
- Women's Africa Cup of Nations — `922` (Africa Cup of Nations - Women)

### Club

- UEFA Women's Champions League — `525` (UEFA Champions League Women)

