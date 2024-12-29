const moviesAndSeries = [
    {
        type: 'movie',
        title: 'Inception',
        overview:
            'A skilled thief is given a chance at redemption if he can successfully perform inception.',
        plotSummary:
            'Dom Cobb specializes in extracting secrets from the subconscious during the dream state.',
        releaseDate: new Date('2010-07-16'),
        genre: ['Sci-Fi', 'Thriller'],
        tags: ['dreams', 'heist', 'psychological'],
        runtime: '148',
        audioLanguages: ['English', 'French'],
        subtitleLanguage: ['English', 'Spanish'],
        cast: ['Leonardo DiCaprio', 'Joseph Gordon-Levitt', 'Ellen Page'],
        directors: ['Christopher Nolan'],
        producers: ['Emma Thomas', 'Christopher Nolan'],
        visibility: 'published',
        access: 'free',
    },
    {
        title: 'Mystic Falls',
        overview: 'A story of love, betrayal, and supernatural forces.',
        plotSummary:
            'Two families clash in a small town filled with mysterious happenings.',
        releaseDate: new Date('2021-05-20'),
        type: 'movie',
        genre: ['Drama', 'Fantasy'],
        tags: ['supernatural', 'drama', 'family feud'],
        runtime: '120',
        audioLanguages: ['English', 'French'],
        subtitleLanguage: ['French'],
        cast: ['Emily Clarke', 'Robert Green'],
        directors: ['Steven Miller'],
        producers: ['Karen White'],
        visibility: 'published',
        access: 'rent',
    },
    {
        type: 'series',
        title: 'Stranger Things',
        overview:
            'A group of kids uncover mysterious supernatural occurrences in their town.',
        plotSummary:
            'In the town of Hawkins, strange events reveal a secret government experiment and a dark alternate dimension.',
        releaseDate: new Date('2016-07-15'),
        genre: ['Sci-Fi', 'Horror'],
        tags: ['supernatural', 'mystery', 'adventure'],
        runtime: '102',
        audioLanguages: ['English', 'Spanish'],
        subtitleLanguage: ['English', 'French'],
        cast: ['Millie Bobby Brown', 'Finn Wolfhard', 'Winona Ryder'],
        directors: ['The Duffer Brothers'],
        producers: ['Shawn Levy', 'Dan Cohen'],
        visibility: 'published',
        access: 'rent',
        seasons: [
            {
                title: 'Season 1',
                season: 1,
                episodes: [
                    {
                        episode: 1,
                        title: 'The Vanishing of Will Byers',
                        overview:
                            'Will Byers vanishes, leaving his friends to uncover a series of dark secrets.',
                        plotSummary:
                            "The boys search for Will, while his mother believes he's communicating through the lights.",
                        releaseDate: new Date('2016-07-15'),
                        runtime: '47',
                        audioLanguages: ['English', 'Spanish'],
                        subtitleLanguage: ['English', 'French'],
                        access: 'rent',
                    },
                    {
                        episode: 2,
                        title: 'The Weirdo on Maple Street',
                        overview:
                            'The boys encounter a mysterious girl with extraordinary powers.',
                        plotSummary:
                            'Mike, Dustin, and Lucas hide Eleven as they learn more about her powers.',
                        releaseDate: new Date('2016-07-15'),
                        runtime: '55',
                        audioLanguages: ['English', 'Spanish'],
                        subtitleLanguage: ['English', 'French'],
                        access: 'rent',
                    },
                ],
            },
            {
                title: 'Season 2',
                season: 2,
                episodes: [
                    {
                        title: 'Madmax',
                        overview:
                            'A new girl in town causes a stir, while Will experiences unsettling visions.',
                        plotSummary:
                            'The boys meet Max, and Will struggles with his connection to the Upside Down.',
                        releaseDate: new Date('2017-10-27'),
                        runtime: '48',
                        audioLanguages: ['English', 'Spanish'],
                        subtitleLanguage: ['English', 'French'],
                        access: 'rent',
                    },
                    {
                        title: 'Trick or Treat, Freak',
                        overview:
                            "Halloween brings both fun and frights as Will's visions intensify.",
                        plotSummary:
                            'The gang goes trick-or-treating, but Will faces a terrifying encounter.',
                        releaseDate: new Date('2017-10-27'),
                        runtime: '56',
                        audioLanguages: ['English', 'Spanish'],
                        subtitleLanguage: ['English', 'French'],
                        access: 'free',
                    },
                ],
            },
        ],
    },
    {
        title: 'Galaxy Defenders',
        overview: 'Heroes uniting to save the galaxy from impending doom.',
        plotSummary:
            'A team of intergalactic warriors fights against a cosmic threat.',
        releaseDate: new Date('2020-03-15'),
        type: 'series',
        genre: ['Sci-Fi', 'Action'],
        tags: ['space', 'heroes', 'action-packed'],
        runtime: '90',
        audioLanguages: ['English', 'Japanese'],
        subtitleLanguage: ['Japanese'],
        cast: ['Chris Lee', 'Anna Wong'],
        directors: ['James Kent'],
        producers: ['Mia Chen'],
        visibility: 'published',
        access: 'free',
        seasons: [
            {
                title: 'Season 1',
                season: 1,
                episodes: [
                    {
                        episode: 1,
                        title: 'The Call',
                        overview: 'The team assembles for the first time.',
                        plotSummary:
                            'A group of heroes come together to face a cosmic threat.',
                        releaseDate: new Date('2020-03-16'),
                        runtime: '45',
                        audioLanguages: ['English'],
                        subtitleLanguage: ['Japanese'],
                        access: 'rent',
                    },
                    {
                        episode: 2,
                        title: 'The Battle Begins',
                        plotSummary: 'The heroes face their first challenge.',
                        overview: 'The heroes face their first challenge.',
                        releaseDate: new Date('2020-03-23'),
                        runtime: '50',
                        audioLanguages: ['English'],
                        subtitleLanguage: ['Japanese'],
                        access: 'rent',
                    },
                ],
            },
            {
                title: 'Season 2',
                season: 2,
                episodes: [
                    {
                        episode: 1,
                        title: 'New Allies',
                        overview: 'The team expands with new members.',
                        plotSummary:
                            'The heroes recruit new allies to face a greater threat.',
                        releaseDate: new Date('2021-04-10'),
                        runtime: '45',
                        audioLanguages: ['English'],
                        subtitleLanguage: ['Japanese'],
                        access: 'free',
                    },
                    {
                        episode: 2,
                        title: 'A Dark Threat',
                        overview: 'An old enemy returns with a vengeance.',
                        plotSummary:
                            "The team faces a new threat from the galaxy's past.",
                        releaseDate: new Date('2021-04-17'),
                        runtime: '50',
                        audioLanguages: ['English'],
                        subtitleLanguage: ['Japanese'],
                        access: 'free',
                    },
                ],
            },
        ],
    },
];

export default moviesAndSeries;
