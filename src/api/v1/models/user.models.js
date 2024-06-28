import mongoose from "mongoose";

const userSchema = mongoose.Schema({
  _id: mongoose.Schema.Types.ObjectId,
  email: {
    type: String,
    required: true,
  },
  password: { type: String, required: true },
  fullname: { type: String, required: true },
  username: { type: String, required: true },
  phoneNumber: { type: String, required: true },
  watchedfilm: [{ type: mongoose.Schema.Types.ObjectId, ref: "Film" }],
  continueWatchingfilm: [{ type: mongoose.Schema.Types.ObjectId, ref: "Film" }],
  watched: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Series",
    },
  ],
  continueWatching: [
    {
      seriesId: { type: mongoose.Schema.Types.ObjectId, ref: "Series" },
      lastWatchedSeason: { type: Number, default: 1 },
      lastWatchedEpisode: { type: Number, default: 1 },
    },
  ],
  releaseAlerts: [{ type: mongoose.Schema.Types.ObjectId, ref: "Film" }],
  accountVerified: { type: Boolean, default: false },
  oneTimePassword: String,
  passwordExpiration: Date,
});

export default mongoose.model("user", userSchema);
