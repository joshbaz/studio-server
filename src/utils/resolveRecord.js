const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

/**
 * @name isObjectId
 * @description
 * @param {string} value
 * @returns {boolean}
 */
export const isObjectId = (value) => OBJECT_ID_PATTERN.test(value);

/**
 * @name resolveRecordId
 * @description Resolve a public identifier to a record id on the given model.
 * Public urls carry the slug (e.g. /film/the-last-lagoon, /segments/series-2)
 * while the studio and older links carry the ObjectId, so both have to resolve.
 *
 * The ObjectId guard matters: handing a slug to a `where: { id }` lookup makes
 * Prisma throw a cast error that surfaces as a 500. Retired slugs are matched
 * through slugHistory so links shared before an admin renamed a slug still land
 * on the right record.
 *
 * Only the id is selected, so this stays cheap and callers can then run a
 * single full query keyed on the result.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} identifier an ObjectId or a slug
 * @param {'film'|'season'|'episode'} [model]
 * @returns {Promise<string|null>} the record id, or null when nothing matches
 */
export const resolveRecordId = async (prisma, identifier, model = 'film') => {
    if (!identifier) return null;

    const delegate = prisma[model];

    if (isObjectId(identifier)) {
        const byId = await delegate.findUnique({
            where: { id: identifier },
            select: { id: true },
        });
        return byId?.id ?? null;
    }

    const bySlug = await delegate.findFirst({
        where: {
            OR: [{ slug: identifier }, { slugHistory: { has: identifier } }],
        },
        select: { id: true },
    });

    return bySlug?.id ?? null;
};

/**
 * @name resolveFilmId
 * @description Resolve a public identifier to a film id.
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} identifier an ObjectId or a slug
 * @returns {Promise<string|null>}
 */
export const resolveFilmId = (prisma, identifier) =>
    resolveRecordId(prisma, identifier, 'film');

/**
 * @name resolveSeasonId
 * @description Resolve a public identifier to a season id, used by /segments/:id
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} identifier an ObjectId or a slug
 * @returns {Promise<string|null>}
 */
export const resolveSeasonId = (prisma, identifier) =>
    resolveRecordId(prisma, identifier, 'season');

/**
 * @name resolveEpisodeId
 * @description Resolve a public identifier to an episode id
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} identifier an ObjectId or a slug
 * @returns {Promise<string|null>}
 */
export const resolveEpisodeId = (prisma, identifier) =>
    resolveRecordId(prisma, identifier, 'episode');
