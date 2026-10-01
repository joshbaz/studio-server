const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

/**
 * @name isObjectId
 * @description
 * @param {string} value
 * @returns {boolean}
 */
export const isObjectId = (value) => OBJECT_ID_PATTERN.test(value);

/**
 * @name resolveFilmId
 * @description Resolve a public identifier to a film id. Public urls carry the
 * slug (e.g. /film/the-last-lagoon) while the studio and older links carry the
 * ObjectId, so both have to resolve.
 *
 * The ObjectId guard matters: handing a slug to a `where: { id }` lookup makes
 * Prisma throw a cast error that surfaces as a 500. Retired slugs are matched
 * through slugHistory so links shared before an admin renamed a slug still land
 * on the right film.
 *
 * Only the id is selected, so this stays cheap and callers can then run a
 * single full query keyed on the result.
 *
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} identifier an ObjectId or a slug
 * @returns {Promise<string|null>} the film id, or null when nothing matches
 */
export const resolveFilmId = async (prisma, identifier) => {
    if (!identifier) return null;

    if (isObjectId(identifier)) {
        const byId = await prisma.film.findUnique({
            where: { id: identifier },
            select: { id: true },
        });
        return byId?.id ?? null;
    }

    const bySlug = await prisma.film.findFirst({
        where: {
            OR: [{ slug: identifier }, { slugHistory: { has: identifier } }],
        },
        select: { id: true },
    });

    return bySlug?.id ?? null;
};
