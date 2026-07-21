const { YoutubeTranscript } = require('youtube-transcript');

/**
 * Fetches and concatenates the full transcript for a YouTube video.
 * Returns null if no transcript is available (caller should skip the video).
 *
 * @param {string} videoId - YouTube video ID
 * @returns {Promise<{ text: string, lang: string } | null>}
 */
async function getTranscript(videoId) {
  try {
    // youtube-transcript auto-selects the best available caption track
    const entries = await YoutubeTranscript.fetchTranscript(videoId);

    if (!entries || entries.length === 0) return null;

    const text = entries.map((e) => e.text).join('\n');
    const lang = entries[0]?.lang || 'en';

    return { text, lang };
  } catch {
    // No transcript available (disabled, private, or unavailable)
    return null;
  }
}

module.exports = { getTranscript };
