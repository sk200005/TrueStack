// Regex patterns for description cleaning
const PATTERNS = {
  // Lines containing social/subscribe CTAs
  subscribeCta: /subscribe|hit the (bell|like|notification)|follow us|join (us|the channel)|turn on notifications/gi,
  // URLs (http, https, www)
  urls: /https?:\/\/\S+|www\.\S+/g,
  // Affiliate or referral tracking links text
  affiliate: /affiliate|referral|promo code|coupon|discount code|use code|check out my|buy (here|now|link)/gi,
  // Hashtags
  hashtags: /#\w+/g,
  // Timestamps like "0:00 Intro" or "00:00:00 Section"
  timestamps: /^\s*\d{1,2}:\d{2}(?::\d{2})?\s.*/gm,
  // Sponsor lines
  sponsors: /sponsor|brought to you by|this video is sponsored/gi,
  // Social media callouts
  socialMedia: /instagram|twitter|facebook|tiktok|discord|reddit|linkedin|snapchat/gi,
  // Repeated dashes or underscores used as visual separators
  separators: /^[-_=*]{3,}$/gm,
  // More than 2 consecutive blank lines → collapse to one
  excessiveBlankLines: /\n{3,}/g,
};

/**
 * Cleans a YouTube video description, stripping promotional and
 * non-informational content while preserving meaningful text.
 *
 * @param {string} raw - The raw description string
 * @returns {string} Cleaned description
 */
function cleanDescription(raw) {
  if (!raw || !raw.trim()) return '';

  let lines = raw.split('\n');

  lines = lines.filter((line) => {
    const lower = line.toLowerCase();
    // Drop lines that match CTA or promotional patterns
    if (PATTERNS.subscribeCta.test(lower)) { PATTERNS.subscribeCta.lastIndex = 0; return false; }
    if (PATTERNS.affiliate.test(lower)) { PATTERNS.affiliate.lastIndex = 0; return false; }
    if (PATTERNS.sponsors.test(lower)) { PATTERNS.sponsors.lastIndex = 0; return false; }
    if (PATTERNS.socialMedia.test(lower)) { PATTERNS.socialMedia.lastIndex = 0; return false; }
    if (PATTERNS.timestamps.test(line)) { PATTERNS.timestamps.lastIndex = 0; return false; }
    if (PATTERNS.separators.test(line)) { PATTERNS.separators.lastIndex = 0; return false; }
    PATTERNS.subscribeCta.lastIndex = 0;
    PATTERNS.affiliate.lastIndex = 0;
    PATTERNS.sponsors.lastIndex = 0;
    PATTERNS.socialMedia.lastIndex = 0;
    PATTERNS.timestamps.lastIndex = 0;
    PATTERNS.separators.lastIndex = 0;
    return true;
  });

  let cleaned = lines.join('\n');
  cleaned = cleaned.replace(PATTERNS.urls, '');
  cleaned = cleaned.replace(PATTERNS.hashtags, '');
  cleaned = cleaned.replace(PATTERNS.excessiveBlankLines, '\n\n');

  return cleaned.trim();
}

/**
 * Cleans a raw transcript string by removing duplicate consecutive lines
 * and collapsing excessive whitespace.
 *
 * @param {string} raw - The raw transcript string
 * @returns {string} Cleaned transcript
 */
function cleanTranscript(raw) {
  if (!raw || !raw.trim()) return '';

  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  const deduped = [];

  for (let i = 0; i < lines.length; i++) {
    // Skip if identical to the previous kept line (common in auto-generated captions)
    if (i === 0 || lines[i].toLowerCase() !== lines[i - 1].toLowerCase()) {
      deduped.push(lines[i]);
    }
  }

  return deduped.join(' ').replace(/\s{2,}/g, ' ').trim();
}

module.exports = { cleanDescription, cleanTranscript };
