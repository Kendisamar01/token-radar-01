export interface SnapshotProtocol {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
}
export interface Snapshot {
  as_of: string; source: string; floor_usd: number;
  protocols: SnapshotProtocol[]; watchlist: string[];
}
export interface ModelConstants {
  tvl_weight: number; growth_floor: number; growth_cap: number;
  growth_weight: number; age_floor: number; age_cap_days: number;
  category_weight: number; chain_weight: number;
}
export const MODEL: ModelConstants = {
  tvl_weight: 0.22, growth_floor: -50, growth_cap: 100,
  growth_weight: 0.6, age_floor: 0.65, age_cap_days: 1460,
  category_weight: 0.08, chain_weight: 0.04,
};
export const MODEL_VERSION = 'radar-tvl-2';
const DAY_MS = 86400000;
const VERSIONED = /\s(v?\d+(?:\.\d+)?|V\d+(?:\.\d+)?)$/;

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const a = Date.parse(asOf + 'T00:00:00Z'), b = Date.parse(listedAt + 'T00:00:00Z');
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}
function categoryFactor(category: string | null): number {
  const c = (category || '').toLowerCase();
  if (c.includes('lend') || c.includes('dex') || c.includes('yield')) return 1.12;
  if (c.includes('bridge') || c.includes('staking') || c.includes('restak')) return 1.08;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('rwa')) return 1.06;
  return 1;
}
export function impliedValue(p: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL) {
  const age = ageDays(asOf, p.listed_at);
  const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, p.change_7d ?? 0));
  const ageDaysUsed = age ?? 365;
  const agePart = model.age_floor + Math.min(Math.max(ageDaysUsed, 0), model.age_cap_days) / model.age_cap_days * (1 - model.age_floor);
  const chainScale = 1 + Math.min(p.chains.length, 5) * model.chain_weight;
  const raw = p.tvl_usd * model.tvl_weight *
    (1 + growth / 100 * model.growth_weight) *
    agePart * (categoryFactor(p.category) - 1 + 1) * chainScale;
  return { implied: Math.max(1, Math.round(raw)), age, growth };
}

export interface BoardRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
  token_status: 'pre-token'; age_days: number | null; implied_value_usd: number;
  model: { tvl_weight: number; growth_pct: number; age_days: number | null; category_factor: number; chain_factor: number };
  farm_steps: string[];
}
export interface RadarRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; age_days: number | null; implied_value_usd: number;
}
export interface RadarData {
  as_of: string; source: string; floor_usd: number; model: ModelConstants;
  model_version: string; watchlist_size: number; board_size: number;
  early_size: number; live_size: number; rows: RadarRow[];
  live: { slug: string; name: string; category: string | null; chains: string[]; tvl_usd: number; mcap_usd: number | null; change_7d: number | null }[];
}

function chainOf(p: SnapshotProtocol) { return p.chains[0] || 'its main chain'; }
function capitalFor(p: SnapshotProtocol) {
  if (p.tvl_usd >= 5e9) return 250;
  if (p.tvl_usd >= 1e9) return 150;
  if (p.tvl_usd >= 1e8) return 100;
  return 50;
}
function holdFor(age: number | null) { return age === null ? 30 : age < 180 ? 60 : age < 365 ? 45 : 30; }
function actionFor(p: SnapshotProtocol, capital: number, chain: string) {
  const c = (p.category || '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${p.name} on ${chain} and keep the position open.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm')) return `Provide $${capital} of liquidity in ${p.name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${p.name}, then use the bridged funds in its app.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${p.name} and retain the receipt.`;
  if (c.includes('perpetual') || c.includes('derivative')) return `Deposit $${capital} of USDC as margin on ${p.name} and open one small hedge.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one small market position on ${p.name}.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${p.name} vault on ${chain} and retain the shares.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${p.name} on ${chain}.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${p.name}'s yield asset on ${chain} and hold the receipt.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${p.name} on ${chain} and retain the policy.`;
  return `Deposit $${capital} of USDC into ${p.name} on ${chain} and keep the position open.`;
}
function stepText(text: string, cost: string, time: string) {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  return s.length > 600 ? s.slice(0, 596) + '...' : s;
}
export function farmSteps(p: SnapshotProtocol, age: number | null): string[] {
  const chain = chainOf(p), capital = capitalFor(p), hold = holdFor(age);
  return [
    stepText('Use a fresh wallet containing only the funds for this activity and keep the seed phrase offline.', 'under $3 of network gas', '5 minutes'),
    stepText(actionFor(p, capital, chain), `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, '15 minutes'),
    stepText("Repeat one qualifying deposit, borrow, swap or vote in each weekly snapshot, only if the protocol's dashboard requests it.", 'about $2 of gas per week', '10 minutes per week'),
    stepText(`Hold the position for at least ${hold} days and verify its receipt after each chain snapshot.`, `$${capital} remains committed`, `${hold} days`),
    stepText(`Open ${p.name}'s official rewards or points page, then verify the destination before a claim or withdrawal.`, 'no fee to check; never pay to claim', '10 minutes'),
    stepText('Record the wallet, chain, transaction hash, dates and earned points in a local farm log.', 'no capital beyond the transaction', '5 minutes'),
  ];
}

export function parseSnapshot(text: string): Snapshot {
  const o = JSON.parse(text);
  if (!o || typeof o !== 'object') throw new Error('snapshot.json is not an object');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.as_of) || !Array.isArray(o.protocols) || !Array.isArray(o.watchlist)) throw new Error('snapshot.json has an invalid shape');
  const protocols: SnapshotProtocol[] = o.protocols.map((p: any) => ({
    slug: p.slug, name: p.name, category: typeof p.category === 'string' ? p.category : null,
    chains: Array.isArray(p.chains) ? p.chains.filter((c: any) => typeof c === 'string') : [],
    tvl_usd: p.tvl_usd, change_7d: typeof p.change_7d === 'number' ? p.change_7d : null,
    mcap_usd: typeof p.mcap_usd === 'number' ? p.mcap_usd : null,
    listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
    gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
    symbol: typeof p.symbol === 'string' ? p.symbol : null,
  }));
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist };
}

export function buildBoard(snapshot: Snapshot, model: ModelConstants = MODEL): BoardRow[] {
  const bySlug = new Map(snapshot.protocols.map(p => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p) chosen.set(slug, p);
  }
  const extra = snapshot.protocols
    .filter(p => !chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .slice(0, 160);
  for (const p of extra) chosen.set(p.slug, p);
  const scored = [...chosen.values()].map(p => {
    const v = impliedValue(p, snapshot.as_of, model);
    return { p, ...v };
  }).sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1, slug: s.p.slug, name: s.p.name, category: s.p.category,
    chains: s.p.chains, tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd, listed_at: s.p.listed_at, gecko_id: s.p.gecko_id,
    symbol: s.p.symbol, token_status: 'pre-token', age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      tvl_weight: model.tvl_weight, growth_pct: s.growth, age_days: s.age,
      category_factor: categoryFactor(s.p.category),
      chain_factor: 1 + Math.min(s.p.chains.length, 5) * model.chain_weight,
    },
    farm_steps: farmSteps(s.p, s.age),
  }));
}
export function buildRadar(snapshot: Snapshot) {
  const board = buildBoard(snapshot);
  const live = snapshot.protocols.filter(p => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, 24).map(p => ({
      slug: p.slug, name: p.name, category: p.category, chains: p.chains,
      tvl_usd: p.tvl_usd, mcap_usd: p.mcap_usd, change_7d: p.change_7d,
    }));
  const radar: RadarData = {
    as_of: snapshot.as_of, source: snapshot.source, floor_usd: snapshot.floor_usd,
    model: MODEL, model_version: MODEL_VERSION, watchlist_size: snapshot.watchlist.length,
    board_size: board.length, early_size: board.filter(r => !snapshot.watchlist.includes(r.slug)).length,
    live_size: live.length,
    rows: board.map(r => ({
      rank: r.rank, slug: r.slug, name: r.name, category: r.category, chains: r.chains,
      tvl_usd: r.tvl_usd, change_7d: r.change_7d, mcap_usd: r.mcap_usd,
      listed_at: r.listed_at, age_days: r.age_days, implied_value_usd: r.implied_value_usd,
    })),
    live,
  };
  return { board, radar };
}
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map(r => r.slug));
  const missing = snapshot.watchlist.filter(s => !slugs.has(s));
  if (missing.length) return `missing watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `board has only ${board.length} rows`;
  for (let i = 0; i < board.length; i++) {
    if (board[i].rank !== i + 1) return `invalid rank at row ${i + 1}`;
    if (i && board[i].implied_value_usd > board[i - 1].implied_value_usd) return 'board is not descending';
  }
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has invalid implied value`;
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has invalid step count`;
    for (const s of r.farm_steps) if (s.length < 20 || s.length > 600) return `${r.slug} has invalid step length`;
  }
  return null;
}
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
