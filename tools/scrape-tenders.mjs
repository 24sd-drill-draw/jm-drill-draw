#!/usr/bin/env node
/**
 * NAHL tender tracker — scrapes NAPHL/T1ER tender announcements into data/tenders.json
 *
 * Usage:
 *   node tools/scrape-tenders.mjs                 # incremental: only stories not already stored
 *   node tools/scrape-tenders.mjs --all           # re-fetch every tender story (slow, ~500 requests)
 *   node tools/scrape-tenders.mjs --since 2026-06-01
 *   node tools/scrape-tenders.mjs --limit 40
 *   node tools/scrape-tenders.mjs --dry-run
 *
 * Running total: the JSON store is MERGED, never replaced. Hand-entered fields
 * (jersey, epUrl, notes, watch, tags) survive every future run.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STORE = path.join(ROOT, 'data', 'tenders.json');

// The current season lives on top-stories.cfm; everything older is behind
// ?archives=true. Neither page alone is complete, so both are crawled.
const SOURCES = [
  { host: 'https://naphl.com',  url: 'https://naphl.com/news/top-stories.cfm',                league: 'NAPHL' },
  { host: 'https://naphl.com',  url: 'https://naphl.com/news/top-stories.cfm?archives=true',  league: 'NAPHL' },
  { host: 'https://nat1hl.com', url: 'https://nat1hl.com/news/top-stories.cfm',               league: 'T1ER'  },
  { host: 'https://nat1hl.com', url: 'https://nat1hl.com/news/top-stories.cfm?archives=true', league: 'T1ER'  },
];
const GAPFILL_CAP = 300;

const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const THROTTLE_MS = 350;

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const flagVal = (f) => { const i = args.indexOf(f); return i === -1 ? null : args[i + 1]; };

const OPT = {
  all: hasFlag('--all'),
  reparse: hasFlag('--reparse'),
  gapfill: !hasFlag('--no-gapfill'),
  dryRun: hasFlag('--dry-run'),
  since: flagVal('--since') ? new Date(flagVal('--since')) : null,
  limit: flagVal('--limit') ? parseInt(flagVal('--limit'), 10) : Infinity,
};

/* ---------------------------------------------------------------- helpers */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, tries = 3) {
  for (let i = 1; i <= tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9' }, redirect: 'follow' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.text();
    } catch (err) {
      if (i === tries) throw new Error(`${url} failed after ${tries} tries: ${err.message}`);
      await sleep(600 * i);
    }
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', ldquo: '“', rdquo: '”', ndash: '–', mdash: '—' };
function unescapeHtml(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}
const stripTags = (html) => unescapeHtml(html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();

// Articles mix digits and spelled-out numbers ("six games", "12 games").
const WORDS = { zero:0, one:1, two:2, three:3, four:4, five:5, six:6, seven:7, eight:8, nine:9, ten:10,
  eleven:11, twelve:12, thirteen:13, fourteen:14, fifteen:15, sixteen:16, seventeen:17, eighteen:18,
  nineteen:19, twenty:20, thirty:30, forty:40, fifty:50, sixty:60, seventy:70, eighty:80, ninety:90,
  first:1, second:2, third:3, fourth:4, fifth:5, sixth:6, seventh:7, eighth:8, ninth:9, tenth:10, no:0, none:0 };

function num(token) {
  if (token == null) return null;
  const t = String(token).trim().toLowerCase().replace(/,/g, '');
  if (/^\d+$/.test(t)) return parseInt(t, 10);
  if (WORDS[t] != null) return WORDS[t];
  const m = t.match(/^(twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)[\s-](\w+)$/);
  if (m && WORDS[m[1]] != null && WORDS[m[2]] != null) return WORDS[m[1]] + WORDS[m[2]];
  return null;
}
const TENS = 'twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety';
const NUM = `\\b([0-9]+|(?:${TENS})[\\s-][a-z]+|[a-z]+)`;

/** First occurrence whose captured token is actually a number.
 *  Guards against "...leads his team in points and goals scored..." where a
 *  plain first-match regex captures the word "and". */
function firstNum(text, suffix) {
  const re = new RegExp(NUM + suffix, 'gi');
  let m;
  while ((m = re.exec(text))) {
    const v = num(m[1]);
    if (v != null) return v;
  }
  return null;
}

/** The sentence that carries the season stat line, so a one-game highlight
 *  ("his highest point game was six assists") can't be read as a season total. */
function statSentence(text) {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const hasCombo = (x) => /\b[\w-]+\s+goals?\s+and\s+[\w-]+\s+assists?/i.test(x) || /\b[\w-]+\s+assists?\s+and\s+[\w-]+\s+goals?/i.test(x);
  const isSeason = (x) => !/highest|single[- ]game|best game|against the|in one game/i.test(x);
  // Strongest signal first: a sentence that splits goals and assists, and that
  // isn't describing one standout game.
  return sentences.find((x) => hasCombo(x) && isSeason(x))
      || sentences.find((x) => /\b(laced up|played in|appeared in|suited up)\b/i.test(x) && /game/i.test(x) && isSeason(x))
      || sentences.find((x) => /(recorded|registered|posted|tallied|notched|scored)/i.test(x) && /(game|point)/i.test(x) && isSeason(x))
      || '';
}

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
function parseDate(str) {
  const m = String(str).match(/([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})/);
  if (!m) return null;
  const mi = MONTHS.indexOf(m[1].toLowerCase());
  if (mi === -1) return null;
  return `${m[3]}-${String(mi + 1).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
}

const slug = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ------------------------------------------------------- archive listing */

/** Pull every "<date> -> [ {id, title} ]" pair out of a listing page.
 *  Returns tender stories plus every story id seen, so gaps can be detected. */
function parseArchive(html, host, league) {
  const out = [];
  const seenIds = new Set();
  // Archive markup: <li>Month D, YYYY <ul> <li><a href="/news/story.cfm?id=N">Title</a></li> ... </ul></li>
  const blocks = html.split(/<li>\s*(?=[A-Z][a-z]+\s+\d{1,2},\s*\d{4})/);
  for (const block of blocks) {
    const dm = block.match(/^([A-Z][a-z]+\s+\d{1,2},\s*\d{4})/);
    if (!dm) continue;
    const date = parseDate(dm[1]);
    const re = /<a\s+href="([^"]*story\.cfm\?id=(\d+))"[^>]*>([\s\S]*?)<\/a>/gi;
    let m;
    while ((m = re.exec(block))) {
      const title = stripTags(m[3]);
      seenIds.add(m[2]);
      if (!/signs?\s+(an?\s+)?NAHL\s+tender/i.test(title)) continue;
      out.push({ storyId: m[2], url: host + unescapeHtml(m[1]).replace(/&amp;/g, '&'), title, announced: date, league });
    }
  }
  return { tenders: out, seenIds };
}

/** Story ids no listing page mentioned, between the lowest and highest seen. */
function findGaps(seenIds) {
  const nums = [...seenIds].map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (nums.length < 2) return [];
  const have = new Set(nums);
  const gaps = [];
  for (let i = nums[0]; i <= nums[nums.length - 1]; i++) if (!have.has(i)) gaps.push(String(i));
  return gaps;
}

/* -------------------------------------------------------- article parsing */

// Typos and spelling drift in the source releases.
const NAHL_TEAM_FIX = {
  'shreveport mubugs': 'Shreveport Mudbugs',
  'farbanks ice dogs': 'Fairbanks Ice Dogs',
  'topeka roadrunners': 'Topeka RoadRunners',
  'wilkes barre/scranton knights': 'Wilkes-Barre/Scranton Knights',
  'springfield jr blues': 'Springfield Jr. Blues',
  'danbury jr. hat tricks': 'Danbury Hat Tricks',
  'north american hockey league': '',
  'expansion': '',
  'generals nahl\u2019s': '',
  'wenatchee\u2019s nahl': 'Wenatchee Wild',
  'kenai rover brown bears': 'Kenai River Brown Bears',
};

const POS_RE = '(forward|defenseman|defenceman|goaltender|goalie|center|centre|winger|left wing|right wing)';
const NAME_RE = "([A-Z][\\w'’.-]+(?:\\s+[A-Z][\\w'’.-]+){0,3})";
const SEASON_RE = '([0-9]{4}[–—-]+[0-9]{2,4})';
const AGEGRP_RE = '(1[0-9]U|[0-9]{2}U)';
const NAHL_RE = '(?:NAHL|North\\s+American\\s+Hockey\\s+League)';

/** Each template returns a partial record, or null if it doesn't apply.
 *  They run in order; the first that matches wins. Order matters — the
 *  current T1ER wording is first because it is the one being added to. */
const TEMPLATES = [
  // A. "…announce that [<club>] [<18U>] <pos> <Name> has signed a NAHL tender
  //     agreement with the <NAHL team>…".  The club is optional: plenty of
  //     releases are written by the club itself and name it only in the lead.
  (t) => {
    const m = t.match(new RegExp(
      `announce\\s+that\\s+(?:the\\s+)?(?:(.+?)\\s+)?${AGEGRP_RE}?\\s*${POS_RE}\\s+${NAME_RE}\\s+has\\s+signed\\s+(?:an?\\s+)?${NAHL_RE}\\s*(?:\\([^)]*\\)\\s*)?tender\\s+agreement\\s+(?:for\\s+the\\s+${SEASON_RE}\\s+season\\s+)?with\\s+(?:the\\s+)?([A-Z][\\w'’.&/-]*(?:\\s+[A-Z][\\w'’.&/-]*)*)`, 'i'));
    if (!m) return null;
    return { template: 'A', club: m[1] || null, ageGroup: m[2] || null, position: m[3], name: m[4], tenderSeason: m[5] || null, nahlTeam: m[6] };
  },

  // B. "…the tender agreement signed between the <NAHL team> of the NAHL and
  //     the <club> <18U> AAA <pos> <Name>."
  (t) => {
    const m = t.match(new RegExp(
      `tender\\s+agreement\\s+signed\\s+between\\s+(?:the\\s+)?(.+?)\\s+of\\s+the\\s+NAHL\\s+and\\s+(?:the\\s+)?(.+?)\\s+${AGEGRP_RE}?\\s*(?:AAA\\s+)?${POS_RE}\\s+${NAME_RE}\\s*[.,]`, 'i'));
    if (!m) return null;
    return { template: 'B', nahlTeam: m[1], club: m[2], ageGroup: m[3] || null, position: m[4], name: m[5] };
  },

  // C. NAHL club announces: "…pleased to announce that they have signed <pos>
  //     <Name> to a tender agreement for the <season> season."
  (t) => {
    const m = t.match(new RegExp(
      `The\\s+(.+?),\\s*proud\\s+members\\s+of\\s+the\\s+North\\s+American\\s+Hockey\\s+League[^,]*,?\\s*(?:are|is)\\s+pleased\\s+to\\s+announce\\s+that\\s+(?:they\\s+have\\s+)?signed\\s+${POS_RE}\\s+${NAME_RE}\\s+to\\s+a\\s+tender\\s+agreement`, 'i'));
    if (!m) return null;
    const cm = t.match(/suited\s+up\s+for\s+(.+?)\s+(?:this|last)\s+season/i);
    return { template: 'C', nahlTeam: m[1], position: m[2], name: m[3], club: cm ? cm[1] : null };
  },

  // D. "<Name> has signed a tender with the <NAHL team>" — loosest shape that
  //     still names both sides explicitly.
  (t) => {
    const m = t.match(new RegExp(
      `${AGEGRP_RE}?\\s*${POS_RE}\\s+${NAME_RE}\\s+has\\s+(?:signed|committed|agreed)\\s+(?:to\\s+)?(?:an?\\s+)?(?:${NAHL_RE}\\s*(?:\\([^)]*\\)\\s*)?)?tender\\s+(?:agreement\\s+)?(?:for\\s+the\\s+${SEASON_RE}\\s+season\\s+)?with\\s+(?:the\\s+)?([A-Z][\\w'’.&/-]*(?:\\s+[A-Z][\\w'’.&/-]*)*)`, 'i'));
    if (!m) return null;
    return { template: 'D', ageGroup: m[1] || null, position: m[2], name: m[3], tenderSeason: m[4] || null, nahlTeam: m[5] };
  },
];

/** The club is often only in the lead: "The Sioux Falls Power of the NAPHL…" */
function clubFromLead(t) {
  const m = t.match(/\bThe\s+(.{2,60}?)\s*(?:,\s*proud\s+members\s+of|\bof)\s+the\s+(?:T1ER\s+)?(?:North\s+American\s+Prospects\s+Hockey\s+League|NAPHL|NAT1HL)/i)
         || t.match(/\bThe\s+(.{2,60}?)\s+(?:hockey\s+)?organization\s+of\s+the\s+(?:NAPHL|NAT1HL)/i);
  return m ? m[1] : null;
}

/** Season appears in several shapes depending on who wrote the release. */
function seasonFrom(t) {
  // Only phrasings that describe the TENDER. A bare "<season> season" is
  // usually the player's current year ("The 2020-21 season is his second
  // with the Knights") and reading that as the tender year is simply wrong.
  const m = t.match(new RegExp(`tender[^.]{0,80}?\\bfor\\s+the\\s+${SEASON_RE}\\s+season`, 'i'))
         || t.match(new RegExp(`\\bcarry\\s+through\\s+the\\s+end\\s+of\\s+the\\s+${SEASON_RE}\\s+season`, 'i'))
         || t.match(new RegExp(`\\b(?:beginning|starting|commencing)\\s+(?:in|with)\\s+the\\s+${SEASON_RE}\\s+season`, 'i'))
         || t.match(new RegExp(`\\bjoin[^.]{0,60}?\\bfor\\s+the\\s+${SEASON_RE}\\s+season`, 'i'));
  return m ? m[1] : null;
}

function parseStory(text, stub) {
  const rec = {
    storyId: stub.storyId, storyUrl: stub.url, headline: stub.title,
    announced: stub.announced, sourceLeague: stub.league,
    template: null,
    name: null, firstName: null, lastName: null,
    position: null, isGoalie: false,
    club: null, ageGroup: null,
    nahlTeam: null, tenderSeason: null,
    age: null, hometown: null, homeState: null,
    seasonInferred: false, seasonAmbiguous: false,
    heightIn: null, weightLb: null,
    gp: null, g: null, a: null, pts: null, gaa: null, svpct: null,
    note: null, statsNote: null,
  };

  if (!rec.announced) rec.announced = parseDate(text.slice(0, 60));

  for (const tpl of TEMPLATES) {
    let hit = null;
    try { hit = tpl(text); } catch { hit = null; }
    if (!hit) continue;
    rec.template = hit.template;
    rec.club = hit.club ? cleanClub(hit.club) : null;
    rec.ageGroup = hit.ageGroup || null;
    rec.position = hit.position ? normalizePos(hit.position) : null;
    rec.name = hit.name ? hit.name.trim() : null;
    rec.nahlTeam = hit.nahlTeam ? (cleanTeam(hit.nahlTeam) || null) : null;
    rec.tenderSeason = hit.tenderSeason ? hit.tenderSeason.replace(/[–—]/g, '-') : null;
    break;
  }

  if (!rec.tenderSeason) rec.tenderSeason = seasonFrom(text);
  if (rec.tenderSeason) rec.tenderSeason = String(rec.tenderSeason).replace(/[\u2013\u2014]/g, '-');
  if (!rec.club) { const c = clubFromLead(text); if (c) rec.club = cleanClub(c); }

  // No release stated the season. Tenders activate on November 1 for the
  // following season, so the announcement month implies it — correct on ~92%
  // of the releases that do state it, with October-December the ambiguous
  // edge. Inferred values are marked, never presented as quoted.
  if (!rec.tenderSeason && rec.announced) {
    const y = parseInt(rec.announced.slice(0, 4), 10);
    const mo = parseInt(rec.announced.slice(5, 7), 10);
    const st = mo >= 10 ? y + 1 : y;
    rec.tenderSeason = `${st}-${String(st + 1).slice(2)}`;
    rec.seasonInferred = true;
    rec.seasonAmbiguous = mo >= 10;
  }

  if (!rec.template) {
    // Nothing matched. Take what is safely takeable and say it is unverified.
    const nm = text.match(new RegExp(`${NAME_RE}\\s+has\\s+signed`));
    if (nm) rec.name = nm[1].trim();
    const tm = text.match(/tender\s+(?:agreement\s+)?with\s+(?:the\s+)?([A-Z][\w.'’-]*(?:\s+[A-Z][\w.'’-]*){0,3})/);
    if (tm) rec.nahlTeam = cleanTeam(tm[1]);
    const sm = text.match(new RegExp(`(?:for|of|through the end of)\\s+the\\s+${SEASON_RE}\\s+season`, 'i'));
    if (sm) rec.tenderSeason = sm[1].replace(/[–—]/g, '-');
    const pm = text.match(new RegExp(POS_RE, 'i'));
    if (pm) rec.position = normalizePos(pm[1]);
    rec.note = 'no template matched — verify against the story before using';
  }

  // Normalise a two-digit season end: 2026-2027 -> 2026-27
  if (rec.tenderSeason) {
    const sp = rec.tenderSeason.split('-');
    if (sp.length === 2 && sp[1].length === 4) rec.tenderSeason = `${sp[0]}-${sp[1].slice(2)}`;
  }

  if (!rec.name) {
    const hm = stub.title.match(/\b([A-Z][\w'’.-]+)\s+[Ss]igns?\s+(?:an?\s+)?NAHL/);
    if (hm) rec.name = hm[1];
  }
  if (rec.name) {
    const parts = rec.name.split(/\s+/);
    rec.firstName = parts.length > 1 ? parts[0] : null;
    rec.lastName = parts[parts.length - 1];
  }
  if (!rec.position) {
    const pm = stub.title.match(new RegExp(POS_RE, 'i'));
    if (pm) rec.position = normalizePos(pm[1]);
  }
  if (!rec.ageGroup) {
    const gm = stub.title.match(/\b(1[0-9]U|\d{2}U)\b/) || text.match(/\b(1[0-9]U|U1[0-9])\b/);
    if (gm) rec.ageGroup = gm[1].replace(/^U(\d+)$/, '$1U');
  }
  rec.isGoalie = rec.position === 'G';

  // Age: ", 17, is in his" / "17-year-old"
  const am = text.match(/,\s*(1[2-9]|2[0-2])\s*,\s*(?:is|a|the|who|who's)\b/)
          || text.match(/\b(1[2-9]|2[0-2])[-\s]year[-\s]old\b/i);
  if (am) rec.age = parseInt(am[1], 10);

  if (!rec.club) {
    const cm = text.match(/season\s+with\s+the\s+(.+?)\s+program/i)
            || text.match(/suited\s+up\s+for\s+(.+?)\s+(?:this|last)\s+season/i);
    if (cm) rec.club = cleanClub(cm[1]);
  }

  // Hometown: "out of Magog, Quebec" / "a native of St. Louis, MO" / "from Canonsburg, PA"
  const hm2 = text.match(/(?:out\s+of|a\s+native\s+of|hails\s+from|,\s*from)\s+([A-Z][A-Za-z.'’ -]{1,30}),\s*([A-Z][A-Za-z.]{1,24}(?:\s+[A-Z][a-z]+)?)/);
  if (hm2) { rec.hometown = hm2[1].trim(); rec.homeState = hm2[2].trim().replace(/\.$/, ''); }

  // Size: (6'0" / 165 lbs.)
  const sz = text.match(/(\d)\s*['’]\s*(\d{1,2})\s*["”]?\s*[/,]\s*(\d{2,3})\s*lbs?/i);
  if (sz) { rec.heightIn = parseInt(sz[1], 10) * 12 + parseInt(sz[2], 10); rec.weightLb = parseInt(sz[3], 10); }

  /* ----- stat line ----- */
  const sent = statSentence(text);

  // "In 69 games, he tallied 29 goals and 30 assists for 59 points"
  const full = text.match(new RegExp(
    `In\\s+${NUM}\\s+games?,?\\s+(?:he|she)?\\s*(?:tallied|recorded|had|posted|scored|registered|put up|notched)\\s+${NUM}\\s+goals?\\s+and\\s+${NUM}\\s+assists?\\s+for\\s+${NUM}\\s+points?`, 'i'));
  if (full) {
    rec.gp = num(full[1]); rec.g = num(full[2]); rec.a = num(full[3]); rec.pts = num(full[4]);
  } else {
    rec.gp = firstNum(text, '\\s+games?\\b');
    rec.pts = firstNum(text, '\\s+total\\s+points?\\b');
    if (rec.pts == null) rec.pts = firstNum(sent || text, '\\s+points?\\b');

    const combo = (sent || text).match(new RegExp(`${NUM}\\s+goals?\\s+and\\s+${NUM}\\s+assists?`, 'i'));
    const comboRev = (sent || text).match(new RegExp(`${NUM}\\s+assists?\\s+and\\s+${NUM}\\s+goals?`, 'i'));
    if (combo) { rec.g = num(combo[1]); rec.a = num(combo[2]); }
    else if (comboRev) { rec.a = num(comboRev[1]); rec.g = num(comboRev[2]); }
    else if (sent) { rec.g = firstNum(sent, '\\s+goals?\\b'); rec.a = firstNum(sent, '\\s+assists?\\b'); }
  }

  if (/yet\s+to\s+(record|register|score)/i.test(text)) {
    if (rec.pts == null) rec.pts = 0;
    if (rec.g == null) rec.g = 0;
    if (rec.a == null) rec.a = 0;
  }
  if (rec.g == null && rec.a != null && rec.pts != null && rec.pts === rec.a) rec.g = 0;
  if (rec.a == null && rec.g != null && rec.pts != null && rec.pts === rec.g) rec.a = 0;
  if (rec.pts == null && rec.g != null && rec.a != null) rec.pts = rec.g + rec.a;

  const gaa = text.match(/([0-9]\.[0-9]{1,2})\s*(?:GAA|goals[- ]against)/i)
           || text.match(/goals[- ]against\s+average\s+of\s+([0-9]\.[0-9]{1,2})/i);
  if (gaa) rec.gaa = parseFloat(gaa[1]);
  const sv = text.match(/\.([0-9]{3})\s*(?:save\s*percentage|SV%)/i)
          || text.match(/save\s*percentage\s+of\s+\.?([0-9]{3})/i);
  if (sv) rec.svpct = parseFloat('0.' + sv[1]);

  // G + A must equal P. If it doesn't, the sentence was misread — drop the
  // split rather than publish a wrong one, and say so.
  if (rec.g != null && rec.a != null && rec.pts != null && rec.g + rec.a !== rec.pts) {
    rec.statsNote = `article gave G${rec.g}/A${rec.a} against P${rec.pts} — split discarded`;
    rec.g = null; rec.a = null;
  }
  if (rec.gp != null && (rec.gp > 90 || rec.gp === 0)) rec.gp = null;
  if (rec.pts != null && rec.pts > 250) rec.pts = null;
  if (rec.isGoalie) { rec.g = null; rec.a = null; rec.pts = null; }

  return rec;
}

function cleanClub(c) {
  return stripTags(c)
    .replace(/^the\s+/i, '')
    .replace(/\s*,?\s*(proud members.*)$/i, '')
    .replace(/\s*AAA\s+Hockey\s+Club$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.,]$/, '')
    .trim();
}

function normalizePos(p) {
  const s = p.toLowerCase();
  if (s.startsWith('goal')) return 'G';
  if (s.startsWith('defen')) return 'D';
  if (s.startsWith('cent')) return 'C';
  if (s.includes('left')) return 'LW';
  if (s.includes('right')) return 'RW';
  return 'F';
}

const ABBREV = /^(St|Jr|Sr|Mt|Ft|Dr)$/i;

function cleanTeam(t) {
  let v = stripTags(t).replace(/\s+/g, ' ').trim()
    .replace(/^the\s+/i, '')
    .replace(/^NAHL[’']s\s+/i, '');
  const w = v.split(' ');
  const out = [];
  for (let i = 0; i < w.length; i++) {
    const x = w[i];
    // The templates run case-insensitively, so a capitalised-word capture can
    // run on past the team ("… Brahmas. The Brahmas are pleased…").
    if (i > 0 && /^[a-z]/.test(x)) break;
    out.push(x);
    if (/\.$/.test(x) && !ABBREV.test(x.replace(/\.$/, ''))) break;   // sentence ended
  }
  v = out.join(' ').replace(/[.,;:]$/, '').trim();
  return NAHL_TEAM_FIX[v] || NAHL_TEAM_FIX[v.toLowerCase()] || v;
}

/** Fold truncated team names into the fullest form actually seen.
 *  "Lone Star" -> "Lone Star Brahmas" when the longer name is well attested. */
function canonicaliseTeams(players) {
  const count = new Map();
  for (const p of players) if (p.nahlTeam) count.set(p.nahlTeam, (count.get(p.nahlTeam) || 0) + 1);
  // Same name, different capitalisation -> the most common spelling wins.
  const byLower = new Map();
  for (const [n, c] of count) {
    const k = n.toLowerCase();
    const cur = byLower.get(k);
    if (!cur || c > cur[1]) byLower.set(k, [n, c]);
  }
  for (const p of players) {
    if (!p.nahlTeam) continue;
    const win = byLower.get(p.nahlTeam.toLowerCase());
    if (win && win[0] !== p.nahlTeam) p.nahlTeam = win[0];
  }
  const names = [...count.keys()].sort((a, b) => b.length - a.length);
  const map = new Map();
  for (const short of names) {
    let best = null;
    for (const long of names) {
      if (long === short || !long.startsWith(short + ' ')) continue;
      if (!best || count.get(long) > count.get(best)) best = long;
    }
    if (best && count.get(best) >= count.get(short)) map.set(short, best);
  }
  // Descriptor prefixes: "Alaska-based Fairbanks Ice Dogs" -> "Fairbanks Ice Dogs".
  for (const long of names) {
    if (map.has(long)) continue;
    let best = null;
    for (const short of names) {
      if (short === long || !long.endsWith(' ' + short)) continue;
      if (count.get(short) > count.get(long) && (!best || count.get(short) > count.get(best))) best = short;
    }
    if (best) map.set(long, best);
  }

  // Resolve chains (A -> B -> C).
  let changed = 0;
  for (const p of players) {
    if (!p.nahlTeam) continue;
    let v = p.nahlTeam, hops = 0;
    while (map.has(v) && hops++ < 5) v = map.get(v);
    if (v !== p.nahlTeam) { p.nahlTeam = v; changed++; }
  }
  return changed;
}

const epSearch = (name) => `https://www.eliteprospects.com/search/player?q=${encodeURIComponent(name || '')}`;

/* ------------------------------------------------------------------ store */

async function loadStore() {
  if (!existsSync(STORE)) return { schema: 1, updated: null, players: [] };
  try {
    const j = JSON.parse(await readFile(STORE, 'utf8'));
    if (!Array.isArray(j.players)) j.players = [];
    return j;
  } catch (err) {
    console.error(`! could not read ${STORE} (${err.message}) — starting a new store`);
    return { schema: 1, updated: null, players: [] };
  }
}

// Fields a human edits in the board. Never overwritten by a scrape.
const MANUAL = ['jersey', 'epUrl', 'notes', 'watch', 'tags', 'grade'];

function merge(store, fresh) {
  const byId = new Map(store.players.map((p) => [p.storyId, p]));
  let added = 0, updated = 0;
  for (const rec of fresh) {
    const prev = byId.get(rec.storyId);
    if (!prev) {
      byId.set(rec.storyId, { ...rec, id: `${slug(rec.name || 'unknown')}-${rec.storyId}`, jersey: '', epUrl: '', notes: '', watch: false, tags: [], grade: '', firstSeen: new Date().toISOString() });
      added++;
    } else {
      const keep = {};
      for (const f of MANUAL) if (prev[f] !== undefined) keep[f] = prev[f];
      const next = { ...prev, ...rec, ...keep };
      if (JSON.stringify(next) !== JSON.stringify(prev)) updated++;
      byId.set(rec.storyId, next);
    }
  }
  const players = [...byId.values()].sort((x, y) => String(y.announced || '').localeCompare(String(x.announced || '')) || Number(y.storyId) - Number(x.storyId));
  for (const p of players) p.epSearchUrl = epSearch(p.name);
  return { players, added, updated };
}

/* ------------------------------------------------------------------- main */

async function main() {
  const store = await loadStore();

  // Re-run the parser over text already on disk. No network, no extra load on
  // their servers — use this after changing a regex.
  if (OPT.reparse) {
    let changed = 0;
    for (const p of store.players) {
      if (!p.excerpt) continue;
      const re = parseStory(p.excerpt, { storyId: p.storyId, url: p.storyUrl, title: p.headline, announced: p.announced, league: p.sourceLeague });
      const keep = {}; for (const f of MANUAL) if (p[f] !== undefined) keep[f] = p[f];
      const next = { ...p, ...re, excerpt: p.excerpt, ...keep };
      if (JSON.stringify(next) !== JSON.stringify(p)) changed++;
      Object.assign(p, next);
    }
    const folded = canonicaliseTeams(store.players);
    store.updated = new Date().toISOString();
    store.counts = countBy(store.players);
    if (folded) console.log(`canonicalised ${folded} truncated team name(s)`);
    await writeFile(STORE, JSON.stringify(store, null, 2) + '\n', 'utf8');
    console.log(`reparsed ${store.players.length} records · ${changed} changed`);
    return;
  }
  const known = new Set(store.players.map((p) => p.storyId));

  let stubs = [];
  const allSeen = new Set();
  let listingsOk = 0;
  for (const src of SOURCES) {
    try {
      process.stdout.write(`listing: ${src.url} … `);
      const html = await get(src.url);
      const { tenders, seenIds } = parseArchive(html, src.host, src.league);
      console.log(`${tenders.length} tenders / ${seenIds.size} stories`);
      stubs.push(...tenders);
      for (const id of seenIds) allSeen.add(id);
      listingsOk++;
    } catch (err) {
      console.error(`\n! ${src.url} failed: ${err.message}`);
    }
    await sleep(THROTTLE_MS);
  }
  if (!listingsOk) throw new Error('every listing page failed — nothing scraped, store left untouched');

  // Dedupe across the sites (the same story id appears on more than one).
  const seen = new Set();
  stubs = stubs.filter((s) => (seen.has(s.storyId) ? false : seen.add(s.storyId)));

  // Story ids that no listing mentions — the seam between the live page and
  // the archive. Probe them so a tender can't hide in the crack.
  if (OPT.gapfill && !OPT.since) {
    const gaps = findGaps(allSeen).filter((id) => !known.has(id));
    if (gaps.length > GAPFILL_CAP) {
      console.log(`gapfill: ${gaps.length} unlisted ids — over the ${GAPFILL_CAP} cap, skipping (run with --all later)`);
    } else if (gaps.length) {
      process.stdout.write(`gapfill: probing ${gaps.length} unlisted story ids … `);
      let hits = 0;
      for (const id of gaps) {
        const url = `https://naphl.com/news/story.cfm?id=${id}`;
        try {
          const html = await get(url, 1);
          const t = (html.match(/<title>([\s\S]*?)<\/title>/i) || [])[1] || '';
          const title = stripTags(t).split('|')[0].trim();
          if (/signs?\s+(an?\s+)?NAHL\s+tender/i.test(title)) {
            stubs.push({ storyId: id, url, title, announced: null, league: 'NAPHL' });
            hits++;
          }
        } catch { /* a missing id is normal */ }
        await sleep(THROTTLE_MS);
      }
      console.log(`${hits} extra tender(s)`);
    }
  }

  if (OPT.since) stubs = stubs.filter((s) => s.announced && new Date(s.announced) >= OPT.since);
  let queue = OPT.all ? stubs : stubs.filter((s) => !known.has(s.storyId));
  if (queue.length > OPT.limit) queue = queue.slice(0, OPT.limit);

  console.log(`${stubs.length} tender stories known · ${known.size} already stored · fetching ${queue.length}`);
  if (OPT.dryRun) { queue.slice(0, 20).forEach((s) => console.log(`  ${s.announced}  ${s.title}`)); return; }

  const fresh = [];
  for (let i = 0; i < queue.length; i++) {
    const stub = queue[i];
    try {
      const html = await get(stub.url);
      const bm = html.match(/<!-- InstanceBeginEditable name="body" -->([\s\S]*?)<!-- InstanceEndEditable/);
      const text = stripTags(bm ? bm[1] : html);
      const rec = parseStory(text, stub);
      rec.excerpt = text.split(/A tender is a contract/i)[0].trim().slice(0, 2000);
      fresh.push(rec);
      process.stdout.write(`\r  [${i + 1}/${queue.length}] ${(rec.name || '?').padEnd(24)}`);
    } catch (err) {
      console.error(`\n! story ${stub.storyId}: ${err.message}`);
    }
    await sleep(THROTTLE_MS);
  }
  console.log('');

  const { players, added, updated } = merge(store, fresh);
  canonicaliseTeams(players);
  const out = {
    schema: 1,
    updated: new Date().toISOString(),
    sources: SOURCES.map((s) => s.url),
    counts: countBy(players),
    players,
  };
  await mkdir(path.dirname(STORE), { recursive: true });
  await writeFile(STORE, JSON.stringify(out, null, 2) + '\n', 'utf8');
  console.log(`${added} new · ${updated} updated · ${players.length} total → ${path.relative(ROOT, STORE)}`);
}

function countBy(players) {
  const bySeason = {}, byTeam = {};
  for (const p of players) {
    if (p.tenderSeason) bySeason[p.tenderSeason] = (bySeason[p.tenderSeason] || 0) + 1;
    if (p.nahlTeam) byTeam[p.nahlTeam] = (byTeam[p.nahlTeam] || 0) + 1;
  }
  return { total: players.length, bySeason, byTeam };
}

main().catch((err) => { console.error(err); process.exit(1); });
