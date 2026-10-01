/**
 * @name slugify
 * @description Turn a human title into a URL-safe slug
 * @param {string} value
 * @returns {string} lowercase, a-z0-9 and hyphens only
 */
export const slugify = (value) =>
    String(value ?? '')
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/['’]/g, '')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
        .replace(/-+$/g, '');

/**
 * @name ensureUniqueSlug
 * @description Append a numeric suffix until the slug is free. Also treats any
 * slug this record used to own as taken, so an old shared link never silently
 * moves to a different record.
 * @param {string} base desired slug
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {{model?: 'film'|'season'|'episode', excludeId?: string}} [options]
 *   model is the prisma delegate to search, excludeId is the record being
 *   updated, which is allowed to keep its own slug
 * @returns {Promise<string>} an available slug
 */
export const ensureUniqueSlug = async (base, prisma, options = {}) => {
    const { model = 'film', excludeId } = options;
    const delegate = prisma[model];

    const root = slugify(base) || model;

    const isTaken = async (candidate) => {
        // a candidate is unavailable if any *other* record currently owns it, or
        // if any record previously used it, so a shared link never silently
        // lands on a different record after a rename
        // findFirst rather than findUnique so this also works while the unique
        // index is still being built during a backfill
        const existing = await delegate.findFirst({
            where: {
                OR: [{ slug: candidate }, { slugHistory: { has: candidate } }],
                ...(excludeId ? { NOT: { id: excludeId } } : {}),
            },
            select: { id: true },
        });

        return existing !== null;
    };

    if (!(await isTaken(root))) return root;

    for (let suffix = 2; suffix < 500; suffix += 1) {
        const candidate = `${root}-${suffix}`;
        if (!(await isTaken(candidate))) return candidate;
    }

    return `${root}-${Date.now()}`;
};

/**
 * @name buildSeasonSlug
 * @description Default slug for a season. Scoped to the parent film's slug so
 * that two series can each have a "season-1" without colliding, and so a shared
 * season link is self describing.
 * @param {string} filmSlug slug of the parent film
 * @param {number|string} seasonNumber
 * @returns {string} e.g. "tuko-pamoja-season-2"
 */
export const buildSeasonSlug = (filmSlug, seasonNumber) =>
    `${slugify(filmSlug) || 'series'}-season-${slugify(seasonNumber) || '1'}`;

/**
 * @name isValidSlug
 * @description Mirrors the zod rule on the slug-enabled update schemas
 * @param {string} value
 * @returns {boolean}
 */
export const isValidSlug = (value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
