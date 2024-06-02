import express from "express";
import cors from "cors"
import cookieParser from "cookie-parser";
import dotenv from "dotenv";
import mongoose from 'mongoose';
import bluebird from "bluebird"
import authRoute from './api/2-routes/adminAuthRoutes.js'
import filmRoute from './api/2-routes/filmRoutes.js'
import userRoute from './api/2-routes/userRoutes.js'
import bodyParser from "body-parser"
dotenv.config();
const app = express();
app.use(express.json());



//app.use(bodyParser());
app.use(express.urlencoded({ extended: false }));
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(cookieParser());

app.use("/api/admin/auth", authRoute);
app.use("/api/user", userRoute);
app.use("/api/film", filmRoute);
app.use((error, req, res, next) => {
    const status = error.statusCode || 500;
    const message = error.message || "something went wrong";

    res.status(status).json(message);
})

let mongoUrl = process.env.MONGO_L_URL;
mongoose.Promise = bluebird;
mongoose.connect(mongoUrl).then((result) => {
    console.log("Database connected successfully to", result.connections[0].name)
}).catch((error) => {
    console.log("DB Connections failed")
})

app.listen(8000, () => {
    console.log("server is running")
})