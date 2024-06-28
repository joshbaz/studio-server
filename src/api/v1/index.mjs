import express from 'express';
import AdminAuthRoutes from './routes/adminAuthRoutes.js';
// import FilmRoutes from './routes/filmRoutes';
// import UserRoutes from './routes/userRoutes';

const router = express.Router();

const endpoints = [
   { path: '/admin/auth', router: AdminAuthRoutes },
   // { path: '/film', router: FilmRoutes },
   // { path: '/user', router: UserRoutes },
];

// map the endpoints to the router
endpoints.forEach((endpoint) => router.use(endpoint.path, endpoint.router));

export default router;
