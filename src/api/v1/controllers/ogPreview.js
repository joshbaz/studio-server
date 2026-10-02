import fs from 'fs';
import path from 'path';
import prisma from '@/utils/db.mjs';
import { env } from '@/env.mjs';
import {
    buildOgTags,
    pickOgImage,
    OG_FALLBACK_PATH,
    DEFAULT_SITE_NAME,
} from '@/utils/ogTags.js';
import { resolveRecordId } from '@/utils/resolveRecord.js';

/**
 * Social preview shell for shared links.
 *
 * The consumer app is a client only SPA, so a shared link has to return real
 * <head> metadata or WhatsApp, Facebook and Instagram all render a blank card.
 * These routes resolve the slug server side and inject og:/twitter: tags into
 * the built index.html, which the app's host then serves for these paths.
 */

/** How long a rendered shell is reused. Crawlers arrive in bursts. */
const CACHE_TTL_MS = 60_000;

/** @type {Map<string, {expires: number, html: string}>} */
const cache = new Map();

let shellCache = null;

/**
 * @name resolveShellPath
 * @description Locate the built index.html of the consumer app. SPA_SHELL_PATH
 * wins so deployment can point at wherever the assets are mounted, otherwise
 * fall back to the sibling directory in this repo.
 * @returns {string|null}
 */
const resolveShellPath = () => {
    if (env.SPA_SHELL_PATH) return env.SPA_SHELL_PATH;

    // src/api/v1/controllers -> repo root is three levels up from this file's
    // directory's parent chain, so walk to the studio-server sibling
    const here = path.dirname(new URL(import.meta.url).pathname);
    const guess = path.resolve(
        here,
        '../../../../Nyati Streaming/dist/index.html'
    );

    return fs.existsSync(guess) ? guess : null;
};

/**
 * @name loadShell
 * @description Read and memoise the SPA shell document.
 * @returns {string|null}
 */
const loadShell = () => {
    if (shellCache) return shellCache;

    const shellPath = resolveShellPath();
    if (!shellPath) return null;

    try {
        shellCache = fs.readFileSync(shellPath, 'utf8');
        return shellCache;
    } catch (error) {
        console.error('ogPreview: could not read shell', shellPath, error.message);
        return null;
    }
};

/**
 * @name injectTags
 * @description Replace the shell <title> and add the preview tags. The shell
 * already has a <title>, so it is removed first to avoid two of them, which
 * crawlers resolve inconsistently.
 * @param {string} shell
 * @param {string} tags
 * @returns {string}
 */
const injectTags = (shell, tags) =>
    shell
        .replace(/<title>[\s\S]*?<\/title>/i, '')
        .replace('</head>', `  ${tags}\n</head>`);

/**
 * @name publicUrl
 * @description Absolute url for a canonical / og:url value.
 * @param {string} pathname
 * @returns {string}
 */
const publicUrl = (pathname) => {
    const origin = (env.PUBLIC_APP_URL || '').replace(/\/$/, '');
    return `${origin}${pathname}`;
};

/** Poster and text fields per model, kept narrow to avoid heavy includes. */
const SELECT = {
    film: {
        slug: true,
        title: true,
        overview: true,
        plotSummary: true,
        type: true,
        posters: { select: { url: true, isCover: true, isBackdrop: true } },
    },
    season: {
        slug: true,
        title: true,
        overview: true,
        season: true,
        posters: { select: { url: true, isCover: true, isBackdrop: true } },
    },
    episode: {
        slug: true,
        title: true,
        overview: true,
        episode: true,
        posters: { select: { url: true, isCover: true, isBackdrop: true } },
    },
};

/**
 * @name renderPreview
 * @description Resolve a slug and build the tagged shell. Cached per url, and
 * a miss is not fatal: an unknown slug still returns a valid page with the
 * brand defaults, because a 404 here would break crawlers rather than help.
 *
 * @param {'film'|'season'|'episode'} model
 * @param {string} slug
 * @param {string} pathname canonical path, used for the cache key and og:url
 * @returns {Promise<string|null>} the html, or null when no shell is available
 */
const renderPreview = async (model, slug, pathname) => {
    const url = publicUrl(pathname);
    const hit = cache.get(url);
    if (hit && hit.expires > Date.now()) return hit.html;

    const shell = loadShell();
    if (!shell) return null;

    const fallbackImage = `${(env.PUBLIC_APP_URL || '').replace(
        /\/$/,
        ''
    )}${OG_FALLBACK_PATH}`;

    let tags;

    try {
        const id = await resolveRecordId(prisma, slug, model);
        const record = id
            ? await prisma[model].findUnique({ where: { id }, select: SELECT[model] })
            : null;

        if (record) {
            // episodes read as "1. Title", seasons as "Season 3"
            const decoratedTitle =
                model === 'episode'
                    ? `${record.episode}. ${record.title}`
                    : model === 'season'
                    ? `Season ${record.season}: ${record.title}`
                    : record.title;

            const kind =
                model === 'film' && String(record.type || '').toLowerCase().includes('series')
                    ? 'series'
                    : model;

            tags = buildOgTags({
                title: decoratedTitle,
                description: record.overview || record.plotSummary,
                image: pickOgImage(record.posters, fallbackImage),
                url,
                kind,
            });
        } else {
            tags = buildOgTags({
                title: DEFAULT_SITE_NAME,
                image: fallbackImage,
                url,
                kind: model,
            });
        }
    } catch (error) {
        console.error('ogPreview: resolve failed', slug, error.message);
        tags = buildOgTags({
            title: DEFAULT_SITE_NAME,
            image: fallbackImage,
            url,
            kind: model,
        });
    }

    const html = injectTags(shell, tags);
    cache.set(url, { expires: Date.now() + CACHE_TTL_MS, html });
    return html;
};

/**
 * @name sendShell
 * @description Reply with the tagged shell, or a plain 503 when the shell is
 * missing so the misconfiguration is obvious rather than serving a page with
 * no app in it.
 * @param {object} res
 * @param {string} slug
 * @param {'film'|'season'|'episode'} model
 * @param {string} pathname
 * @returns {Promise<void>}
 */
const sendShell = async (res, slug, model, pathname) => {
    const html = await renderPreview(model, slug, pathname);

    if (!html) {
        return res
            .status(503)
            .type('html')
            .send(
                '<!doctype html><html><body>Social preview shell unavailable. Set SPA_SHELL_PATH to the built consumer index.html.</body></html>'
            );
    }

    // crawlers cache aggressively, and an admin renaming a slug should not need
    // a purge to update the card
    res.set('Cache-Control', 'public, max-age=60');
    return res.status(200).type('html').send(html);
};

/** GET /preview/film/:slug — the public path is /film/:slug or /series/:slug */
export const previewFilm = async (req, res) =>
    sendShell(res, req.params.slug, 'film', req.path);

/** GET /preview/season/:slug — the public path is /segments/:slug */
export const previewSeason = async (req, res) =>
    sendShell(res, req.params.slug, 'season', req.path);

/**
 * GET /preview/episode/:slug/:seriesSlug/:seasonSlug
 * The public path carries all three so the episode page can fetch its film;
 * only the episode is previewed.
 */
export const previewEpisode = async (req, res) =>
    sendShell(
        res,
        req.params.slug,
        'episode',
        req.path.replace('/preview', '')
    );
