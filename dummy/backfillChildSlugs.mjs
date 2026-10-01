/**
 * One-off backfill: give every existing season and episode a slug.
 *
 * Seasons are scoped to their parent film ("tuko-pamoja-season-2") so two
 * series can both have a season 1 without colliding, and so a shared segment
 * link is self describing. Episodes use their own title.
 *
 * Needed because MongoDB treats every missing field as the same value under a
 * unique index, so the index on season.slug / episode.slug cannot be built
 * until each record owns a distinct value.
 * Safe to re-run: records that already have a slug are skipped.
 *
 * Usage: node --import ./scripts/register-alias.mjs dummy/backfillChildSlugs.mjs
 */
import prisma from '../src/utils/db.mjs';
import { ensureUniqueSlug, buildSeasonSlug } from '../src/utils/slugify.js';

const main = async () => {
    let seasonsCreated = 0;
    let episodesCreated = 0;
    const failures = [];

    const films = await prisma.film.findMany({
        select: { id: true, slug: true, title: true },
    });
    const filmById = new Map(films.map((f) => [f.id, f]));

    // ---- seasons -------------------------------------------------------
    const seasons = await prisma.season.findMany({
        select: { id: true, title: true, season: true, slug: true, filmId: true },
    });

    for (const season of seasons) {
        if (season.slug) continue;

        try {
            const film = filmById.get(season.filmId);
            const base = buildSeasonSlug(
                film?.slug || film?.title || 'series',
                season.season
            );
            const slug = await ensureUniqueSlug(base, prisma, { model: 'season' });

            await prisma.season.update({
                where: { id: season.id },
                data: { slug },
            });

            seasonsCreated += 1;
            console.log(
                `season  "${season.title}" (S${season.season}) -> ${slug}`
            );
        } catch (error) {
            failures.push(`season "${season.title}": ${error.message}`);
            console.error(`season  "${season.title}": ${error.message}`);
        }
    }

    // ---- episodes ------------------------------------------------------
    const episodes = await prisma.episode.findMany({
        select: { id: true, title: true, slug: true, seasonId: true },
    });

    for (const episode of episodes) {
        if (episode.slug) continue;

        try {
            const slug = await ensureUniqueSlug(episode.title, prisma, {
                model: 'episode',
            });

            await prisma.episode.update({
                where: { id: episode.id },
                data: { slug },
            });

            episodesCreated += 1;
            console.log(`episode "${episode.title}" -> ${slug}`);
        } catch (error) {
            failures.push(`episode "${episode.title}": ${error.message}`);
            console.error(`episode "${episode.title}": ${error.message}`);
        }
    }

    // ---- report --------------------------------------------------------
    const seasonTotal = await prisma.season.count();
    const seasonSlugs = await prisma.season.count({
        where: { slug: { not: null } },
    });
    const episodeTotal = await prisma.episode.count();
    const episodeSlugs = await prisma.episode.count({
        where: { slug: { not: null } },
    });

    console.log(
        `\ndone. seasons created=${seasonsCreated} episodes created=${episodesCreated} failures=${failures.length}`
    );
    console.log(`seasons : ${seasonSlugs}/${seasonTotal} have a slug`);
    console.log(`episodes: ${episodeSlugs}/${episodeTotal} have a slug`);

    if (failures.length > 0) {
        console.error('\nfailures:\n' + failures.map((f) => `  - ${f}`).join('\n'));
        process.exitCode = 1;
    }
};

main()
    .catch((error) => {
        console.error(error);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
