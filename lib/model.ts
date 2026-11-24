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
  live_scale: number; live_residual_scale: number; pre_residual_scale: number;
}
export const MODEL: ModelConstants = {
  tvl_weight: 0.22, growth_floor: -50, growth_cap: 100,
  growth_weight: 0.6, age_floor: 0.65, age_cap_days: 1460,
  category_weight: 0.08, chain_weight: 0.04,
  live_scale: 0.2, live_residual_scale: 0.005, pre_residual_scale: 0.03,
};
export const MODEL_VERSION = 'radar-full-3';
const DAY_MS = 86400000;
const VERSIONED = /\s(v?\d+(?:\.\d+)?|V\d+(?:\.\d+)?)$/;
const DERIVED = /\b(wrapped|staked|staking|bridged)\b/i;

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
function isProduct(p: SnapshotProtocol): boolean {
  const c = (p.category || '').toLowerCase();
  return c === 'cex' || c.includes('bridge') || c.includes('staking') || c.includes('restak') || VERSIONED.test(p.name) || DERIVED.test(p.name);
}
function signals(p: SnapshotProtocol, asOf: string, model: ModelConstants) {
  const age = ageDays(asOf, p.listed_at);
  const growth = Math.min(model.growth_cap, Math.max(model.growth_floor, p.change_7d ?? 0));
  const ageDaysUsed = age ?? 365;
  const agePart = model.age_floor + Math.min(Math.max(ageDaysUsed, 0), model.age_cap_days) / model.age_cap_days * (1 - model.age_floor);
  const chainScale = 1 + Math.min(p.chains.length, 5) * model.chain_weight;
  return { age, growth, agePart, chainScale };
}
export function impliedValue(p: SnapshotProtocol, asOf: string, model: ModelConstants = MODEL) {
  const s = signals(p, asOf, model);
  const raw = p.tvl_usd * model.tvl_weight *
    (1 + s.growth / 100 * model.growth_weight) *
    s.agePart * categoryFactor(p.category) * s.chainScale * (isProduct(p) ? model.pre_residual_scale : 1);
  return { implied: Math.max(1, Math.round(raw)), age: s.age, growth: s.growth };
}
export function tradingValue(p: SnapshotProtocol, asOf: string, ceiling: number, model: ModelConstants = MODEL) {
  const s = signals(p, asOf, model);
  const scale = isProduct(p) ? model.live_residual_scale : model.live_scale;
  const raw = Math.sqrt(p.tvl_usd) * scale *
    (1 + s.growth / 100 * model.growth_weight * 0.25) *
    s.agePart * categoryFactor(p.category) * s.chainScale;
  return { implied: Math.max(1, Math.min(Math.max(1, ceiling), Math.round(raw))), age: s.age, growth: s.growth };
}

export interface BoardRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
  token_status: 'pre-token' | 'already-trading'; age_days: number | null; implied_value_usd: number;
  model: { tvl_weight: number; growth_pct: number; age_days: number | null; category_factor: number; chain_factor: number };
  farm_steps: string[];
}
export interface RadarRow {
  rank: number; slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; age_days: number | null; implied_value_usd: number;
  token_status: 'pre-token' | 'already-trading';
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
  const status = isPreToken(p)
    ? 'The snapshot records no token for this protocol, so a launch is unconfirmed.'
    : `The snapshot records a token${p.symbol ? ` (${p.symbol})` : ''}${p.mcap_usd ? ` at about $${Math.round(p.mcap_usd / 1e6)}M market cap` : ''}, so this is a live position, not a pending launch.`;
  return [
    stepText(`Use a fresh wallet containing only the funds for this activity and keep the seed phrase offline. ${status}`, 'under $3 of network gas', '5 minutes'),
    stepText(actionFor(p, capital, chain), `$${capital} of capital and about $${capital >= 150 ? 8 : 4} of gas`, '15 minutes'),
    stepText(`Repeat one qualifying deposit, borrow, swap or vote on ${chain} in each weekly snapshot, only if the protocol's own dashboard requests it.`, 'about $2 of gas per week', '10 minutes per week'),
    stepText(`Hold the position for at least ${hold} days and verify its receipt after each chain snapshot.`, `$${capital} remains committed`, `${hold} days`),
    stepText(`Open ${p.name}'s official rewards or points page, then verify the destination before a claim or withdrawal; watch ${p.category || 'its'} activity and ${p.chains.length} chain${p.chains.length === 1 ? '' : 's'} for changes.`, 'no fee to check; never pay to claim', '10 minutes'),
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
  const early = snapshot.protocols.filter(isPreToken).map(p => ({ p, ...impliedValue(p, snapshot.as_of, model), token_status: 'pre-token' as const }));
  const ceiling = Math.max(1, Math.min(...early.map(e => e.implied)) - 1);
  const trading = snapshot.protocols.filter(p => !isPreToken(p)).map(p => ({ p, ...tradingValue(p, snapshot.as_of, ceiling, model), token_status: 'already-trading' as const }));
  const scored = [...early, ...trading].sort((a, b) =>
    b.implied - a.implied ||
    (a.token_status === b.token_status ? 0 : a.token_status === 'pre-token' ? -1 : 1) ||
    (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1, slug: s.p.slug, name: s.p.name, category: s.p.category,
    chains: s.p.chains, tvl_usd: s.p.tvl_usd, change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd, listed_at: s.p.listed_at, gecko_id: s.p.gecko_id,
    symbol: s.p.symbol, token_status: s.token_status, age_days: s.age,
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
    board_size: board.length, early_size: board.filter(r => r.token_status === 'pre-token' && !snapshot.watchlist.includes(r.slug)).length,
    live_size: live.length,
    rows: board.map(r => ({
      rank: r.rank, slug: r.slug, name: r.name, category: r.category, chains: r.chains,
      tvl_usd: r.tvl_usd, change_7d: r.change_7d, mcap_usd: r.mcap_usd,
      listed_at: r.listed_at, age_days: r.age_days, implied_value_usd: r.implied_value_usd,
      token_status: r.token_status,
    })),
    live,
  };
  return { board, radar };
}
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map(r => r.slug));
  const missing = snapshot.watchlist.filter(s => !slugs.has(s));
  if (missing.length) return `missing watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  if (board.length !== snapshot.protocols.length || slugs.size !== board.length) return `board covers ${slugs.size} of ${snapshot.protocols.length} distinct protocols`;
  if (board.length < 100 || board.length > 4000) return `board has ${board.length} rows`;
  let seenTrading = false;
  for (let i = 0; i < board.length; i++) {
    if (board[i].rank !== i + 1) return `invalid rank at row ${i + 1}`;
    if (i && board[i].implied_value_usd > board[i - 1].implied_value_usd) return 'board is not descending';
    if (board[i].token_status === 'already-trading') seenTrading = true;
    else if (seenTrading) return `pre-token row ${board[i].slug} ranks below a token that trades`;
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
