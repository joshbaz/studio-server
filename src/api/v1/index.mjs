import express from 'express';
import AdminAuthRoutes from './routes/adminAuthRoutes.js';
// import FilmRoutes from './routes/filmRoutes';
// import UserRoutes from './routes/userRoutes';
import prisma from './utils/db.mjs';

const router = express.Router();

const commentRoute = router.get('/comment', async (req, res) => {
   // const newComment = await prisma.comment.create({
   //    data: {
   //       title: 'Hello, World!',
   //       body: 'This is a test comment.',
   //    },
   // });
   // console.log(newComment);
   const comments = await prisma.comment.findMany();

   res.json({ comments });
});

const endpoints = [
   { path: '/admin/auth', router: AdminAuthRoutes },
   { path: '/post', router: commentRoute },
   // { path: '/film', router: FilmRoutes },
   // { path: '/user', router: UserRoutes },
];

// map the endpoints to the router
endpoints.forEach((endpoint) => router.use(endpoint.path, endpoint.router));

export default router;
