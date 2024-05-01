import mongoose from "mongoose";

const filmSchema = mongoose.Schema(
  {
    _id: mongoose.Schema.Types.ObjectId,
    createdBy: {
      type: String,
      required: true,
    },
    content: {
      title: { type: String, required: true },
      audioLanguage: { type: String, required: true },
      embeddedSubtitles: { type: Boolean },
      subtitlesLanguages: [
        {
          Language: { type: String },
          file: { type: String },
        },
      ],
      runtime: { type: String, required: true },
      YearOfProduction: { type: String, required: true },
      genre: { type: [String], required: true },
      tags: { type: [String] },
      plotSummary: {
        type: String,
        required: true,
      },
      plotSynopsis: {
        type: String,
        required: true,
      },
    },
    castandcrew: {
      cast: { type: [String], required: true, default: [] },
      directors: { type: [String], required: true, default: [] },
      producers: { type: [String], required: true, default: [] },
      writers: { type: [String], required: true, default: [] },
      soundcore: { type: [String], required: true, default: [] },
    },
    checksandvisibility: {
      auidencetarget: {type:String},
      auidenceAgeGroup: { type: String },
      visibility: {type: String}
    },
    thumbnails: {
      mainThumbNail: { type: String },
      secondaryThumbNails: [String]
    },
    trailer: {
      trailerType: { type: String },
      trailerLink: { type: String },
      trailerVideo: {type:String},
    },
    status: {
      type: String,
      default: "offline",
    },
    views: {
      type: Number,
      default: 0
    }
  },
  { timestamps: true }
);

export default mongoose.model("film", filmSchema);
