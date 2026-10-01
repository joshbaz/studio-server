/**
 * One-off backfill: give every existing film a slug derived from its title.
 *
 * Needed because MongoDB stores a missing field differently from an explicit
 * null, and a unique index treats every missing slug as the same value, so the
 * index on film.slug cannot be built until each film owns a distinct value.
 * Safe to re-run: films that already have a slug are skipped.
 *
 * Usage: node --import ./scripts/register-alias.mjs dummy/backfillSlugs.mjs
 */
import prisma from '../src/utils/db.mjs';
import { ensureUniqueSlug } from '../src/utils/slugify.js';

const BATCH = 50;

const main = async () => {
    let created = 0;
    let skipped = 0;
    let cursor;

    while (true) {
        // filtered in JS: prisma's `slug: null` does not match documents that
        // predate the field, which is every film this script exists to fix
        const films = await prisma.film.findMany({
            select: { id: true, title: true, slug: true },
            take: BATCH,
            ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
            orderBy: { id: 'asc' },
        });

        if (films.length === 0) break;

        for (const film of films) {
            if (film.slug) continue;

            try {
                const slug = await ensureUniqueSlug(film.title, prisma);
                await prisma.film.update({
                    where: { id: film.id },
                    data: { slug },
                });
                created += 1;
                console.log(`slugged  "${film.title}" -> ${slug}`);
            } catch (error) {
                skipped += 1;
                console.error(`skipped  "${film.title}": ${error.message}`);
            }
        }

        cursor = films[films.length - 1].id;
        if (films.length < BATCH) break;
    }

    const total = await prisma.film.count();
    const withSlug = await prisma.film.count({ where: { slug: { not: null } } });

    console.log(`\ndone. created=${created} skipped=${skipped}`);
    console.log(`films: ${withSlug}/${total} have a slug`);
};

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
