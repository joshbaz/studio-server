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
 * slug this film used to own as taken, so an old slug never silently moves to
 * a different film.
 * @param {string} base desired slug
 * @param {import('@prisma/client').PrismaClient} prisma
 * @param {string} [excludeFilmId] the film being updated, allowed to keep its own slug
 * @returns {Promise<string>} an available slug
 */
export const ensureUniqueSlug = async (base, prisma, excludeFilmId) => {
    const root = slugify(base) || 'film';

    const isTaken = async (candidate) => {
        // a candidate is unavailable if any *other* film currently owns it, or
        // if any film previously used it, so a shared link never silently
        // lands on a different film after a rename
        // findFirst rather than findUnique so this also works while the unique
        // index is still being built during a backfill
        const existing = await prisma.film.findFirst({
            where: {
                OR: [{ slug: candidate }, { slugHistory: { has: candidate } }],
                ...(excludeFilmId ? { NOT: { id: excludeFilmId } } : {}),
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
 * @name isValidSlug
 * @description Mirrors the zod rule on the film update schema
 * @param {string} value
 * @returns {boolean}
 */
export const isValidSlug = (value) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
