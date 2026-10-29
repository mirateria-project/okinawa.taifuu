// 沖縄 台風・交通アプリ用のデータ作り（GitHub Actions で10分ごとに実行）
// status.json と typhoon.json を作って、GitHub Pages で公開します。
// /status.json  … バス（沖縄県バス協会）とゆいレールの運行状況
// /typhoon.json … 気象庁の台風情報（実況と1〜5日目の予報）
// /past.json    … 直近に終わった台風3つの進路（デジタル台風の公開データ）
// どちらも無料の公開ページ・公開データだけを使います。

const JMA = "https://www.jma.go.jp/bosai/typhoon/data/";
const BUS = "https://www.bus-okinawa.or.jp/";
const YUI = "https://www.yui-rail.co.jp/";
const HDR = { "User-Agent": "Mozilla/5.0 (okinawa-taifuu app; +https://github.com/mirateria-project/okinawa.taifuu)", "Accept-Language": "ja" };
const iso = () => new Date().toISOString();

/* ---------- 共通 ---------- */
async function get(url) {
  const r = await fetch(url, { headers: HDR, signal: AbortSignal.timeout(9000) });
  if (!r.ok) throw new Error("HTTP " + r.status + " " + url);
  return r;
}
async function getJSON(url) { return (await get(url)).json(); }
async function getText(url) {
  const r = await get(url);
  const buf = new Uint8Array(await r.arrayBuffer());
  let cs = (/charset=([\w-]+)/i.exec(r.headers.get("content-type") || "") || [])[1];
  if (!cs) {
    const head = new TextDecoder("latin1").decode(buf.slice(0, 3000));
    cs = (/charset=["']?([\w-]+)/i.exec(head) || [])[1] || "utf-8";
  }
  try { return new TextDecoder(cs.toLowerCase()).decode(buf); } catch { return new TextDecoder("utf-8").decode(buf); }
}
export function htmlLines(html) {
  const t = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/h\d|\/li|\/dt|\/dd|\/tr|\/section|\/article|\/header|\/a)\b[^>]*>/gi, "\n")
    .replace(/<img\b[^>]*alt=["']([^"']*)["'][^>]*>/gi, " $1 ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
  return t.split("\n").map((s) => s.replace(/[\s　]+/g, " ").trim()).filter(Boolean);
}

/* 文面から状態を判定：ok 平常 / part 一部運休 / stop 全面運休 / unk 不明 */
export function classify(t) {
  if (!t) return "unk";
  const s = t.replace(/\s/g, "");
  if (/(全路線|全線|全便|全ての路線|すべての路線|全区間|全面|終日)[^。]{0,20}(運休|見合わせ|見合せ|中止|休止|停止)/.test(s) ||
      /(運休|見合わせ|見合せ|運行中止|運転中止)[^。]{0,10}(全路線|全線|全便|全区間)/.test(s)) return "stop";
  if (/(運休|見合わせ|見合せ|中止|休止|遅延|遅れ|一部|迂回|う回|間引|減便|運転取りやめ|運行取りやめ)/.test(s) &&
      !/(運休|遅延|見合わせ)(は|の予定は)?(ありません|なし)/.test(s)) {
    // 「全路線・全便」と書かれていない運休・遅れは「一部運休」あつかい（協会の文面も一緒に表示）
    if (/(運休|見合わせ|見合せ|運転を?中止|運行を?中止)/.test(s) && /^(本日は?)?(終日)?(運休|運転見合わせ|運行見合わせ)/.test(s)) return "stop";
    return "part";
  }
  if (/(平常|通常|通り運行|どおり運行|運行して|運行中|運転して|運転中|運行しております)/.test(s)) return "ok";
  return "unk";
}

/* ---------- バス・ゆいレール ---------- */
export function busFromLines(L) {
  let i = L.findIndex((l) => /運行情報\s*[（(]\s*本島\s*[）)]/.test(l));
  if (i < 0) i = L.findIndex((l) => /(運行情報|運行状況)/.test(l) && /本島/.test(l));
  if (i < 0) return { text: "", cat: "unk" };
  const out = [];
  const rest = L[i].replace(/^.*運行情報\s*[（(]\s*本島\s*[）)]\s*/, "");
  if (rest) out.push(rest);
  for (let k = i + 1; k < L.length && out.length < 4; k++) {
    if (/離島|運行状況\s*[（(]/.test(L[k])) break;
    if (L[k].length < 2) continue;
    out.push(L[k]);
  }
  const text = out.join(" ").slice(0, 200).trim();
  return { text, cat: classify(text) };
}
export function yuiFromLines(L) {
  const stopWords = /^(重要なお知らせ|臨時ダイヤのご案内|お知らせ|点検|駅|時刻|発車|運賃|乗車券|路線図|English|MENU)/;
  for (let i = 0; i < L.length; i++) {
    if (!/運行情報/.test(L[i]) || L[i].length > 20) continue;
    const out = [];
    const rest = L[i].replace(/^.*運行情報\s*/, "");
    if (rest) out.push(rest);
    for (let k = i + 1; k < L.length && out.length < 3; k++) {
      if (stopWords.test(L[k])) break;
      out.push(L[k]);
    }
    const text = out.join(" ").slice(0, 160).trim();
    const cat = classify(text);
    if (cat !== "unk") return { text, cat };
  }
  // 見出しが見つからない場合：短い行から運行の言葉を探す
  const l = L.find((x) => x.length < 70 && /(運行中|運転中|平常運行|平常運転|運休|見合わせ|遅延)/.test(x) && !/ありません/.test(x));
  return l ? { text: l, cat: classify(l) } : { text: "", cat: "unk" };
}
async function status() {
  const [b, y] = await Promise.allSettled([getText(BUS), getText(YUI)]);
  const bus = b.status === "fulfilled" ? busFromLines(htmlLines(b.value)) : { text: "", cat: "unk" };
  const yui = y.status === "fulfilled" ? yuiFromLines(htmlLines(y.value)) : { text: "", cat: "unk" };
  // ゆいレールは1路線なので、「一部」「区間」とない見合わせ・運休は全面停止あつかい
  if (yui.cat === "part" && /(見合わせ|見合せ|運休|運転を?中止)/.test(yui.text) && !/(一部|区間|間で|遅れ|遅延)/.test(yui.text)) yui.cat = "stop";
  return {
    bus: bus.cat, text: bus.text, uncertain: !/平常通り運行/.test(bus.text),
    yui: yui.cat, ytext: yui.text, yunc: yui.cat === "unk",
    error: b.status !== "fulfilled" && y.status !== "fulfilled",
    checked: iso(),
  };
}

/* ---------- 台風（気象庁） ---------- */
const num = (v) => { const n = parseFloat(String(v ?? "").replace(/[^\d.\-]/g, "")); return isFinite(n) ? n : null; };
const txt = (v) => { v = typeof v === "object" && v ? (v.jp ?? v.en ?? "") : (v ?? ""); v = String(v).trim(); return v && v !== "-" && v !== "－" ? v : null; };
function latlon(v) {
  if (!v) return null;
  let a = Array.isArray(v) ? v : v.deg || v.center || null;
  if (a && !Array.isArray(a)) a = a.deg || null;
  if (!Array.isArray(a) || a.length < 2) return null;
  if (Array.isArray(a[0])) a = a[0];
  let la = +a[0], lo = +a[1];
  if (!isFinite(la) || !isFinite(lo)) return null;
  if (Math.abs(la) > 90) [la, lo] = [lo, la];
  return [la, lo];
}
const posOf = (e) => latlon(e.position) || latlon(e.center) || latlon(e.probabilityCircle && e.probabilityCircle.center);
function km(v) { // 数値 or {km:…} or メートル
  if (v == null) return null;
  if (typeof v === "object") v = v.km ?? v.radius ?? v["km"];
  const n = num(v);
  if (n == null) return null;
  return n > 3000 ? Math.round(n / 1000) : Math.round(n);
}
function maxRange(a) {
  if (!a) return null;
  const arr = Array.isArray(a) ? a : [a];
  const v = arr.map((x) => km(x && x.range ? x.range : x)).filter((x) => x != null);
  return v.length ? Math.max(...v) : null;
}
export function buildTc(t, spec, fcst) {
  const items = (spec || []).filter((e) => e && typeof e.part === "object");
  const title = (spec || []).find((e) => e && typeof e.part !== "object") || {};
  const an = items.find((e) => +e.advancedHours === 0) || items[0];
  if (!an) throw new Error("no analysis");
  const c = posOf(an);
  if (!c) throw new Error("no position");
  const sp = an.speed && typeof an.speed === "object" ? an.speed["km/h"] : an.speed;
  const spn = num(sp);
  const now = {
    c, hpa: num(an.pressure),
    wind: num(an.maximumWind && an.maximumWind.sustained && an.maximumWind.sustained["m/s"]),
    gust: num(an.maximumWind && an.maximumWind.gust && an.maximumWind.gust["m/s"]),
    spd: spn, spdnote: spn == null ? txt(sp) : null,
    course: txt(an.course), scale: txt(an.scale), int: txt(an.intensity), loc: txt(an.location),
    storm: maxRange(an.stormWarning), gale: maxRange(an.galeWarning),
  };
  // 予報点：specifications を基本に、forecast.json の予報円で補う
  const pts = [];
  items.filter((e) => +e.advancedHours > 0).forEach((e) => {
    const p = posOf(e); if (!p) return;
    pts.push({ h: +e.advancedHours, c: p, r: km(e.probabilityCircleRadius ?? (e.probabilityCircle && e.probabilityCircle.radius)), sw: maxRange(e.stormWarning), cat: txt(e.category && (e.category.en || e.category.jp)) || txt(e.category), int: txt(e.intensity) });
  });
  (fcst || []).filter((e) => e && typeof e.part === "object" && +e.advancedHours > 0).forEach((e) => {
    const h = +e.advancedHours, r = km(e.probabilityCircle && e.probabilityCircle.radius);
    const hit = pts.find((p) => p.h === h);
    if (hit) { if (hit.r == null) hit.r = r; if (hit.sw == null) hit.sw = maxRange(e.stormWarning); }
    else { const p = latlon(e.center) || latlon(e.probabilityCircle && e.probabilityCircle.center); if (p) pts.push({ h, c: p, r, sw: maxRange(e.stormWarning), cat: txt(e.category && (e.category.en || e.category.jp)) }); }
  });
  // 1〜5日目（24・48・72・96・120時間に一番近い予報点）に並べ直す
  const fc = [], used = new Set();
  for (let d = 1; d <= 5; d++) {
    let best = null;
    pts.forEach((p, i) => { const g = Math.abs(p.h - 24 * d); if (!used.has(i) && g <= 12 && (!best || g < best.g)) best = { g, i, p }; });
    if (best) { used.add(best.i); const f = { h: 24 * d, c: best.p.c, r: best.p.r || 0, vh: best.p.h }; if (best.p.sw) f.sw = best.p.sw; if (best.p.cat) f.cat = best.p.cat; if (best.p.int) f.int = best.p.int; fc.push(f); }
  }
  const cat = txt(t.category) || txt(an.category && an.category.en) || "";
  return {
    id: t.tropicalCyclone || "", number: String(t.typhoonNumber || title.typhoonNumber || ""),
    name: txt(title.name && title.name.jp) || null, nameEn: (title.name && title.name.en) || null,
    cat, issue: (title.issue && title.issue.JST) || t.issue || null, fc, now,
  };
}
async function typhoon() {
  const list = await getJSON(JMA + "targetTc.json");
  const arr = Array.isArray(list) ? list : [];
  const out = []; let bad = 0;
  await Promise.all(arr.map(async (t, i) => {
    const id = t && t.tropicalCyclone; if (!id) return;
    try {
      const [spec, fcst] = await Promise.all([
        getJSON(JMA + id + "/specifications.json"),
        getJSON(JMA + id + "/forecast.json").catch(() => null),
      ]);
      out[i] = buildTc(t, spec, fcst);
    } catch (e) { bad++; }
  }));
  const typhoons = out.filter(Boolean);
  return { typhoons, checked: iso(), error: arr.length > 0 && typhoons.length === 0 && bad > 0, partial: bad > 0 };
}


/* ---------- 過去の台風の進路（デジタル台風／国立情報学研究所の公開GeoJSON。元データは気象庁） ---------- */
// 直近に終わった台風3つの進路を past.json に書き出す。前回の past.json は公開中のサイトから読んで使い回す（6時間ごとに取り直し）。
const DT = "https://agora.ex.nii.ac.jp/digital-typhoon/geojson/wnp/";
const SITE = (() => { const r = process.env.GITHUB_REPOSITORY || "mirateria-project/okinawa.taifuu"; const [o, n] = r.split("/"); return "https://" + o.toLowerCase() + ".github.io/" + n + "/"; })();
async function dtTrack(n4) { // n4 = "2630"
  const r = await fetch(DT + "20" + n4 + ".en.json", { headers: HDR, signal: AbortSignal.timeout(9000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("HTTP " + r.status);
  const j = await r.json();
  const p = (j.features || []).map((f) => { const c = f.geometry && f.geometry.coordinates, t = f.properties && f.properties.time; return c && isFinite(+t) ? [+t * 1000, +c[1], +c[0]] : null; })
    .filter((x) => x && isFinite(x[1]) && isFinite(x[2])).sort((a, b) => a[0] - b[0]);
  if (p.length < 2) return null;
  return { k: "TC" + n4, n: n4, name: (j.properties && j.properties.name) || null, p: p.map((x) => [x[0], +x[1].toFixed(2), +x[2].toFixed(2)]), end: p[p.length - 1][0], got: Date.now() };
}
async function past(active) {
  let prev = null;
  try { const r = await fetch(SITE + "past.json?t=" + Date.now(), { signal: AbortSignal.timeout(9000) }); if (r.ok) prev = await r.json(); } catch {}
  const old = {}; ((prev && prev.tracks) || []).forEach((t) => { if (t && t.n) old[t.n] = t; });
  const act = new Set(active.map((x) => String(x)).filter((x) => /^\d{4}$/.test(x)));
  let last = Math.max(0, ...[...act].map(Number), Number(prev && prev.last) || 0);
  // 新しく番号がついた台風があるか確かめる（台風がない時期も、次の番号を1つだけ見に行く）
  for (let i = 0; i < 3 && last && !act.size; i++) { const nx = String(last + 1).padStart(4, "0"); if (act.has(nx) || old[nx]) { last++; continue; }
    try { const t = await dtTrack(nx); if (t) { old[nx] = t; last++; continue; } } catch {} break; }
  if (!last) return { tracks: [], last: null, checked: iso() };
  const yy = Math.floor(last / 100), out = [];
  for (let k = last; k > yy * 100 && out.length < 3; k--) {
    const n4 = String(k).padStart(4, "0");
    if (act.has(n4)) continue; // 今も続いている台風は「過去」に入れない
    let t = old[n4];
    if (!t || !t.got || Date.now() - t.got > 6 * 3600000) { try { t = (await dtTrack(n4)) || t; } catch {} }
    if (t && t.p && t.p.length >= 2) out.push(t);
  }
  return { tracks: out, last: String(last).padStart(4, "0"), checked: iso(), src: "Digital Typhoon (NII) / JMA" };
}

/* ---------- 実行：3つのファイルを書き出す ---------- */
import { writeFileSync } from "node:fs";
const save = (name, obj) => writeFileSync(new URL("./" + name, import.meta.url), JSON.stringify(obj));
try { save("status.json", await status()); }
catch (e) { console.error(e); save("status.json", { bus: "unk", text: "", uncertain: true, yui: "unk", ytext: "", yunc: true, error: true, checked: iso() }); }
let TY = null;
try { TY = await typhoon(); save("typhoon.json", TY); }
catch (e) { console.error(e); save("typhoon.json", { typhoons: null, error: true, checked: iso() }); }
try { save("past.json", await past(((TY && TY.typhoons) || []).map((t) => t.number))); }
catch (e) { console.error(e); save("past.json", { tracks: [], error: true, checked: iso() }); }
console.log("done", iso());
