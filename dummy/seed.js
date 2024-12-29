import { PrismaClient } from '@prisma/client';
import moviesAndSeries from './dummyData.js';

const prisma = new PrismaClient();

async function main() {
    for (const item of moviesAndSeries) {
        if (item.type === 'movie') {
            // Insert movies directly
            await prisma.film.create({
                data: {
                    title: item.title,
                    overview: item.overview,
                    plotSummary: item.plotSummary,
                    releaseDate: item.releaseDate,
                    genre: item.genre,
                    tags: item.tags,
                    runtime: item.runtime,
                    audioLanguages: item.audioLanguages,
                    subtitleLanguage: item.subtitleLanguage,
                    cast: item.cast,
                    directors: item.directors,
                    producers: item.producers,
                    visibility: item.visibility,
                    access: item.access,
                    type: item.type,
                },
            });
        } else if (item.type === 'series') {
            // Insert series and its related seasons and episodes
            await prisma.film.create({
                data: {
                    title: item.title,
                    overview: item.overview,
                    plotSummary: item?.plotSummary,
                    releaseDate: item.releaseDate,
                    genre: item.genre,
                    tags: item.tags,
                    runtime: item.runtime,
                    audioLanguages: item.audioLanguages,
                    subtitleLanguage: item.subtitleLanguage,
                    cast: item.cast,
                    directors: item.directors,
                    producers: item.producers,
                    visibility: item.visibility,
                    access: item.access,
                    type: item.type,
                    season: {
                        create: item.seasons.map((season) => ({
                            title: season.title,
                            season: season.season,
                            createdAt: season.createdAt,
                            episodes: {
                                create: season.episodes.map((episode) => ({
                                    title: episode.title,
                                    overview: episode.overview,
                                    plotSummary: episode.plotSummary,
                                    releaseDate: episode.releaseDate,
                                    runtime: episode.runtime,
                                    audioLanguages: episode.audioLanguages,
                                    subtitleLanguage: episode.subtitleLanguage,
                                })),
                            },
                        })),
                    },
                },
            });
        }
    }
}

main()
    .then(async () => {
        console.log('Data seeded successfully!');
        await prisma.$disconnect();
    })
    .catch(async (error) => {
        console.error('Error seeding data:', error);
        await prisma.$disconnect();
        process.exit(1);
    });
