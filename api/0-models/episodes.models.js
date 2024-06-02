import mongoose from "mongoose";

const episodeSchema = mongoose.Schema(
  {
    _id: mongoose.Schema.Types.ObjectId,
    seriesId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "films",
      
    },
    seasonCounter: { type: String, required: true },
    episodeCounter: { type: String, required: true },
    episodeTitle: { type: String, required: true },
    YearOfProduction: { type: String },
    rated: { type: String },
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
    youtubeTrailer: { type: String },
    localTrailer: { type: String },
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
  },
  { timestamps: true }
);

export default mongoose.model("episodes", episodeSchema);
