import { ensureUniqueSlug } from './slugify.js';

/**
 * @name applySlugChange
 * @description Resolve a requested slug rename against a mutable update payload.
 *
 * Shared by the film, season and episode update handlers so all three behave
 * identically:
 *  - retires the previous slug into slugHistory instead of dropping it, so links
 *    that were already shared keep resolving to the same record
 *  - falls back to a suffixed slug when the requested one is taken, and reports
 *    that so the admin is told which link they actually got
 *  - drops any history entry equal to the new slug, so reclaiming one of this
 *    record's own old slugs does not leave a stale entry behind
 *
 * @param {object} update mutable payload; `update.slug` is overwritten with the
 *   resolved slug and `update.slugHistory` is set when a rename happens
 * @param {object} record the existing record, needs `id`, `slug`, `slugHistory`
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {'film'|'season'|'episode'} model
 * @returns {Promise<{changed: boolean, adjusted: boolean, requested: string|null, final: string|null}>}
 */
export const applySlugChange = async (update, record, prisma, model) => {
    const unchanged = {
        changed: false,
        adjusted: false,
        requested: null,
        final: null,
    };

    if (typeof update.slug !== 'string' || update.slug.length === 0) {
        return unchanged;
    }
    if (update.slug === record.slug) return unchanged;

    // the caller usually passes an object that aliases req.data, so read the
    // requested value before overwriting it with the resolved slug
    const requested = update.slug;

    update.slug = await ensureUniqueSlug(requested, prisma, {
        model,
        excludeId: record.id,
    });

    const history = record.slugHistory ?? [];
    update.slugHistory = [
        ...new Set(
            [record.slug, ...history].filter(
                (entry) => entry && entry !== update.slug
            )
        ),
    ];

    return {
        changed: true,
        adjusted: update.slug !== requested,
        requested,
        final: update.slug,
    };
};

/**
 * @name slugAdjustedMessage
 * @description Human message for an update response, telling the admin when the
 * link they asked for was not the link they got.
 * @param {{changed: boolean, adjusted: boolean, requested: string|null, final: string|null}} outcome
 * @param {string} successMessage message to use when nothing was adjusted
 * @returns {string}
 */
export const slugAdjustedMessage = (outcome, successMessage) =>
    outcome.adjusted
        ? `Link "${outcome.requested}" was already in use, so the link is now "${outcome.final}"`
        : successMessage;
