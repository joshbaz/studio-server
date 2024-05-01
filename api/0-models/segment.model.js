import mongoose from "mongoose";

const segmentSchema = mongoose.Schema(
  {
    _id: mongoose.Schema.Types.ObjectId,
    email: {
      type: String,
      required: true,
    },
    password: { type: String, required: true },
    firstname: { type: String, required: true },
    lastname: { type: String, required: true },
    privileges: { type: String },
    role: {
      type: String,
      default: "admin",
    },
    img: { type: String },
    createdDate: { type: Date },
    phoneNumber: { type: String, required: true },
    active: {
      type: Boolean,
      default: false,
      required: true,
    },
    deactivated: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      default: "offline",
    },
    oneTimePassword: String,
    passwordExpiration: Date,
  },
  { timestamps: true }
);

export default mongoose.model("segment", segmentSchema);
