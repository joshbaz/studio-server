import filmModels from "../0-models/film.models.js";
import dotenv from "dotenv";
import fs from "fs";
dotenv.config();
import aws from "aws-sdk";
//import { pipeline } from "stream";
//import { promisify } from "util";

//const pipelineAsync = promisify(pipeline);
const spacesEndpoint = new aws.Endpoint(process.env.spacesEndPoint);
const bucketName = process.env.bucketName;

const s3 = new aws.S3({
  endpoint: spacesEndpoint,
  accessKeyId: process.env.DS_AccessKey,
  secretAccessKey: process.env.DS_SecretKey,
});

export const addFilm = async (req, res, next) => {
  try {
    const {
      createdBy,
      title,
      audioLanguage,
      embeddedSubtitles,
      runtime,
      YearOfProduction,
      genre,
      tags,
      plotSummary,
      plotSynopsis,
      cast,
      directors,
      producers,
      writers,
      soundcore,
      auidencetarget,
      auidenceAgeGroup,
      visibility,
    } = req.body;
    console.log("req.body", req.body, req.file);


    const params = {
      Bucket: bucketName,
      Key: req.file.originalname,
      Body: req.file.buffer,
      ContentType: req.file.mimetype,
      // acl: "public-read",
    };

    //         const uploadUrl = await s3.getSignedUrlPromise("putObject", params);
    //         console.log('url',uploadUrl);
    // res.status(200).json({ url: uploadUrl });
    s3.upload(params, (error, data) => {
      if (error) {
        console.error(error);
        res.sendStatus(500);
        return;
      }
      console.log("given", data);
      res.status(201).json(data);
    });
    // upload(req, res, function (error, values) {
    //   if (error) {
    //     console.log(error);
    //     return
    //     }

    //   console.log("File uploaded successfully.", values);
    //     //response.redirect("/success");
    //     res.status(200).json("done")
    // });
  } catch (error) {
    if (!error.statusCode) {
      error.statusCode = 500;
    }
    next(error);
  }
};

export const updateFilm = async (req, res, next) => {
  try {
  } catch (error) {
    if (!error.statusCode) {
      error.statusCode = 500;
    }
    next(error);
  }
};

export const viewFilms = async (req, res, next) => {
  try {
    const range = req.headers.range;
    if (!range) {
      res.status(400).send("Requires Range header");
    }

    let streamParams = {
      Bucket: bucketName,
      Key: "🎧Electronic Music.mp4",
    };

    s3.headObject(streamParams, async (err, data) => {
      if (err) {
        console.log(err);
        return res.status(500).end("Internal Server Error");
      }
      let { ContentLength, ContentType, AcceptRanges } = data;
      const CHUNK_SIZE = 10 ** 6;
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        console.log("starts here", parts);
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : ContentLength - 1;

        const chunkSize = end - start + 1;
        const headers = {
          "Content-Range": `bytes ${start}-${end}/${ContentLength}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize,
          "Content-Type": ContentType,
        };

        res.writeHead(206, headers);

        //readable stream
        const stream = s3
          .getObject({ ...streamParams, Range: `bytes=${start}-${end}` })
          .createReadStream();

         stream.pipe(res);
        
      } else {
        console.log("No headers - starts here");
        //no range provided.
        const headers = {
          "Content-Length": ContentLength,
          "Content-Type": ContentType,
        };

        res.writeHead(200, headers);
          s3.getObject(streamParams).createReadStream().pipe(res);
            
      }
      //   const videoPath = getURL;
      //   const videoSize = ContentLength;
      //   const CHUNK_SIZE = 10 ** 6; //1MB
      //   const start = Number(range.replace(/\D/g, ""));
      //   const end = Math.min(start + CHUNK_SIZE, videoSize - 1);
      //   const contentLength = end - start + 1;
      //   console.log("end", end, start, contentLength);
      //   const headers = {
      //     "Content-Range": `bytes ${start}-${end}/${videoSize}`,
      //     "Accept-Ranges": "bytes",
      //     "Content-Length": contentLength,
      //     "Content-Type": "video/mp4",
      //   };

      //   res.writeHead(206, headers);
      //   await pipeline(  res)
      //   const videoStream = fs.createReadStream(videoPath, { start, end });
      //   videoStream.pipe(res);
      // return { ContentLength, ContentType, AcceptRanges };
    });
    
  } catch (error) {
    if (!error.statusCode) {
      error.statusCode = 500;
    }
    next(error);
  }
};

export const viewFilms2 = async (req, res, next) => {
  try {
    const range = req.headers.range;
    if (!range) {
      res.status(400).send("Requires Range header");
    }

    let streamParams = {
      Bucket: bucketName,
      Key: req.params.keys,
    };

    s3.headObject(streamParams, async (err, data) => {
      if (err) {
        console.log(err);
        return res.status(500).end("Internal Server Error");
      }
      let { ContentLength, ContentType, AcceptRanges } = data;
      const CHUNK_SIZE = 10 ** 6;
      const MAX_CHUNK_SIZE = 10 * 1024 * 1024; // 10 MB
      if (range) {
        const parts = range.replace(/bytes=/, "").split("-");
        console.log("starts here", parts);
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : ContentLength - 1;

        const chunkSize = end - start + 1;
        const headers = {
          "Content-Range": `bytes ${start}-${end}/${ContentLength}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize,
          "Content-Type": ContentType,
        };

        res.writeHead(206, headers);

        //readable stream
        const stream = s3
          .getObject({ ...streamParams, Range: `bytes=${start}-${end}` })
          .createReadStream();

        stream.pipe(res);
       
      } else {
        console.log("No headers - starts here");
          //no range provided.
           let start = 0;
           let end = Math.min(MAX_CHUNK_SIZE, ContentLength);
       
            // const headers = {
            //   "Content-Range": `bytes ${start}-${end}/${ContentLength}`,
            //   "Accept-Ranges": "bytes",
            //   "Content-Length": chunkSize,
            //   "Content-Type": ContentType,
            // };
           while (start < ContentLength) {
             const ranges = `bytes=${start}-${end - 1}`;
             const data = await s3
               .getObject({ ...streamParams, Range: ranges })
               .promise();
             res.write(data.Body);

             start = end;
             end = Math.min(start + MAX_CHUNK_SIZE, ContentLength);

             if (start < ContentLength) {
               res.flushHeaders(); // Send the chunk immediately
             }
           }

           res.end();
        //s3.getObject(streamParams).createReadStream().pipe(res);
        //  await pipelineAsync(
        //    s3.getObject(streamParams).createReadStream(),
        //    res
        //  );
      }
      
    });
    //console.log("getSize", getSize.ContentLength)
  } catch (error) {
    if (!error.statusCode) {
      error.statusCode = 500;
    }
    next(error);
  }
};

export const watchFilms = async (req, res, next) => {
  try {
  } catch (error) {
    if (!error.statusCode) {
      error.statusCode = 500;
    }
    next(error);
  }
};

export const watchtrailerFilms = async (req, res, next) => {
  try {
  } catch (error) {
    if (!error.statusCode) {
      error.statusCode = 500;
    }
    next(error);
  }
};

//get film by tag
export const getFilmByTag = async (req, res, next) => {
  try {
    const tags = req.query.tags.split(",");

    const getfilms = await filmModels.find({ tags: { $in: tags } }).limit(20);
    res.status(200).json(getfilms);
  } catch (error) {
    if (!error.statusCode) {
      error.statusCode = 500;
    }
    next(error);
  }
};

//get film by tag
export const getFilmBySearch = async (req, res, next) => {
  try {
    const query = req.query.q;

    const getfilms = await filmModels
      .find({ title: { $regex: query, $options: "i" } })
      .limit(40);
    res.status(200).json(getfilms);
  } catch (error) {
    if (!error.statusCode) {
      error.statusCode = 500;
    }
    next(error);
  }
};
