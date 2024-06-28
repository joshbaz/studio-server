import mongoose from "mongoose";

const filmSchema = mongoose.Schema(
  {
    _id: mongoose.Schema.Types.ObjectId,
    createdBy: {
      type: String,
      required: true,
    },
    comingSoon: {
      type: Boolean,
      default: false,
    },
    title: {
      type: String,
      required: true,
    },
    YearOfProduction: { type: String, required: true },
    rated: {
      type: String,
    },
    released: {
      type: String,
    },
    runtime: { type: String, required: true },
    genre: { type: [String], required: true },
    tags: { type: [String] },
    plotSummary: {
      type: String,
      required: true,
    },
    overview: {
      type: String,
      required: true,
    },
    audioLanguages: [{ iso_639_1: String, name: String }],
    embeddedSubtitles: { type: Boolean },
    subtitlesLanguages: [
      {
        Language: { type: String },
        file: { type: String },
      },
    ],
    country: String,
    copyright: String,
    actors: { type: [String], required: true, default: [] },
    directors: { type: [String], required: true, default: [] },
    producers: { type: [String], required: true, default: [] },
    writers: { type: [String], required: true, default: [] },
    soundcore: { type: [String], required: true, default: [] },
    auidencetarget: { type: String },
    auidenceAgeGroup: { type: String },
    visibility: { type: String },
    filmType: { type: String, required: true },
    filmModel: {
      type: String,
      required: true,
    },
    trailer: [
      {
        trailerType: String,
        videoTrailerLink: String,
      },
    ],
    youtubeTrailer: String,
    localTrailer: String,
    fullVideoLink: String,
    posters: {
      type: [String],
    },
    backdrops: {
      type: [String],
    },
    inTheatres: [
      {
        Background: String,
        ImageLeftAlign: String,
      },
    ],
    status: {
      type: String,
      default: "offline",
    },
    views: {
      type: Number,
      default: 0,
    },
    averageRating: {
      type: Number,
      default: 0,
    },
    totalRatings: {
      type: Number,
      default: 0,
    },
    seasons: [
      {
        seasonTitle: { type: String },
        seasonCounter: { type: String },
        totalEpisodes: { type: String },
        episodes: [
          {
            episodeId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "episodes",
              
            },
          },
        ],
      },
    ],
  },
  { timestamps: true }
);

export default mongoose.model("film", filmSchema);
