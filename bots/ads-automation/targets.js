// Field shapes and limits adapted from TeleAd's MIT-licensed inputs.py:
// https://github.com/Elimeshi1/TeleAd/blob/main/telead/inputs.py
// One explicit placement and one attribution unit per experiment.
const peer = (s) => /^@[A-Za-z0-9_]{5,32}$/.test(s);
const nonempty = (s) => typeof s === 'string' && s.trim().length > 0;
export const USER_FILTER_KEYS=['country_codes','location_ids','language_codes','topic_ids','intersect_topics',
  'exclude_topic_ids','channel_ids','exclude_channel_ids','device','exclude_political_channels','political_channels_only'];
export const USER_DEVICES=['ios','android','mobile','desktop'];

export function targetFor(candidate) {
  const {surface,value} = candidate;
  const spec = typeof candidate.target_json === 'string' ? JSON.parse(candidate.target_json) : candidate.target || {};
  if (surface === 'channels') {
    if (!peer(value)) throw new Error('channel must have a public @username');
    return {placement:'channel_post',target:{type:'channels',channel_ids:[value]}};
  }
  if (surface === 'bots') {
    if (!peer(value)) throw new Error('bot must have a public @username');
    return {placement:'bot_banner',target:{type:'bots',bot_ids:[value]}};
  }
  if (surface === 'search') {
    if (!nonempty(value) || value.length > 80) throw new Error('invalid search phrase');
    return {placement:'search_result',target:{type:'search',search_queries:[value.trim()]}};
  }
  if (surface === 'users') {
    if (Object.keys(spec).some(k=>!USER_FILTER_KEYS.includes(k))) throw new Error('unsupported users filter');
    if (!(spec.country_codes?.length || spec.location_ids?.length || spec.language_codes?.length || spec.topic_ids?.length || spec.channel_ids?.length)) throw new Error('users target needs a filter');
    if (spec.country_codes?.length > 8 || spec.language_codes?.length > 8 || spec.location_ids?.length > 20 || spec.topic_ids?.length > 20 || spec.channel_ids?.length > 100) throw new Error('users target limit');
    if (spec.location_ids?.length && spec.country_codes?.length !== 1) throw new Error('locations require one country');
    if (spec.political_channels_only && spec.exclude_political_channels) throw new Error('contradictory political filters');
    if (spec.device && !USER_DEVICES.includes(spec.device)) throw new Error('unknown device');
    return {placement:'channel_post',target:{type:'users',...spec}};
  }
  throw new Error('unknown targeting surface');
}

export function validateCreative(creative, candidate, project) {
  if (!creative || creative.project_id !== project.id || candidate.project_id !== project.id) throw new Error('cross-project creative');
  if (creative.status !== 'approved') throw new Error('creative needs QA approval');
  if (Array.from(creative.ad_text).length < 1 || Array.from(creative.ad_text).length > 160) throw new Error('ad text outside Telegram limit');
  if (candidate.surface === 'channels' && !creative.image_path) throw new Error('channel creative needs banner');
  if (candidate.surface !== 'channels' && creative.image_path) throw new Error('image variant only for channel in v1');
  if (!project.destination.startsWith('https://t.me/')) throw new Error('v1 destination must be Telegram deep link');
}
