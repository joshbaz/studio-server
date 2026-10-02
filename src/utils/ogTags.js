/**
 * Social preview metadata for shared film, season and episode links.
 *
 * The consumer app is a client only Vite SPA, so anything set from React after
 * load is invisible to WhatsApp, Facebook and Instagram, which read the raw
 * HTML. These tags have to be injected server side into the shell document.
 *
 * Everything here is pure so it can be unit tested without a database.
 */

/**
 * Fallback card image path, resolved against the public app origin by the
 * caller. A raster format matters: Facebook, WhatsApp and most other crawlers
 * ignore an SVG for og:image and render a blank card, so the brand logo has to
 * be the PNG that the consumer app ships in public/.
 */
export const OG_FALLBACK_PATH = '/logo.png';

/** Fallback site name for og:site_name. */
export const DEFAULT_SITE_NAME = 'Nyati Motion Pictures';

/**
 * @name escapeHtml
 * @description Escape a value for use in an HTML attribute or text node.
 * Titles in this catalogue contain &, ' and ", for example
 * "Lado Enclave: Lugbara, Nubian, Kakwa & Madi", and an unescaped ampersand
 * truncates the tag and silently drops everything after it.
 * @param {string} value
 * @returns {string}
 */
export const escapeHtml = (value) =>
    String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

/**
 * @name truncate
 * @description Shorten to a word boundary within max characters.
 * Crawlers cut off descriptions around 200 characters anyway, and cutting on a
 * space avoids a card that ends mid word.
 * @param {string} value
 * @param {number} max
 * @returns {string}
 */
export const truncate = (value, max = 200) => {
    const text = String(value ?? '').replace(/\s+/g, ' ').trim();
    if (text.length <= max) return text;

    const cut = text.slice(0, max);
    const lastSpace = cut.lastIndexOf(' ');
    return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trim()}…`;
};

/**
 * @name pickOgImage
 * @description Choose the best available poster. A backdrop is a wide image and
 * looks right in a link card, a cover is square, and anything beats nothing.
 * @param {{url?: string, isBackdrop?: boolean, isCover?: boolean}[]} posters
 * @param {string} fallback absolute url used when a record has no poster yet
 * @returns {string}
 */
export const pickOgImage = (posters, fallback) => {
    const list = Array.isArray(posters) ? posters.filter((p) => p?.url) : [];

    const chosen =
        list.find((p) => p.isBackdrop) ||
        list.find((p) => p.isCover) ||
        list[0];

    return chosen?.url || fallback;
};

/**
 * @name buildOgTags
 * @description Build the head fragment injected into the SPA shell.
 *
 * og: tags are what WhatsApp, Facebook and Instagram read. twitter: tags are
 * included because X and iOS Safari messages prefer them, and many crawlers
 * look at twitter:card first to decide whether to render a large image.
 *
 * @param {{
 *   title?: string,
 *   description?: string,
 *   image: string,
 *   url: string,
 *   kind?: 'film'|'series'|'season'|'episode'
 * }} input
 * @returns {string} html to place inside <head>
 */
export const buildOgTags = ({ title, description, image, url, kind = 'film' }) => {
    const safeTitle = escapeHtml(truncate(title || DEFAULT_SITE_NAME, 120));
    const safeDescription = escapeHtml(
        truncate(description || `Watch ${title || 'this title'} on Nyati.`, 200)
    );
    const safeImage = escapeHtml(image);
    const safeUrl = escapeHtml(url);
    const safeSiteName = escapeHtml(DEFAULT_SITE_NAME);

    // seasons and episodes are not standalone movies, and a series is a show
    const ogType =
        kind === 'season' || kind === 'episode' ? 'video.episode' : 'video.movie';

    return [
        `<title>${safeTitle}</title>`,
        `<link rel="canonical" href="${safeUrl}">`,
        `<meta name="description" content="${safeDescription}">`,
        `<meta property="og:type" content="${ogType}">`,
        `<meta property="og:site_name" content="${safeSiteName}">`,
        `<meta property="og:title" content="${safeTitle}">`,
        `<meta property="og:description" content="${safeDescription}">`,
        `<meta property="og:image" content="${safeImage}">`,
        `<meta property="og:url" content="${safeUrl}">`,
        `<meta property="og:locale" content="en">`,
        `<meta name="twitter:card" content="summary_large_image">`,
        `<meta name="twitter:title" content="${safeTitle}">`,
        `<meta name="twitter:description" content="${safeDescription}">`,
        `<meta name="twitter:image" content="${safeImage}">`,
    ].join('\n    ');
};
