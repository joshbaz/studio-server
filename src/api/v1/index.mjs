import express from 'express';
import AdminAuthRoutes from './routes/adminAuthRoutes.js';
import FilmRoutes from './routes/filmRoutes';
import UserRoutes from './routes/userRoutes.js';
import PaymentRoutes from './routes/paymentRoutes.js';
import SubscriptionRoutes from './routes/subscriptionRoutes.js';

const router = express.Router();

const endpoints = [
   { path: '/film', router: FilmRoutes },
   { path: '/user', router: UserRoutes },
   { path: '/payment', router: PaymentRoutes },
   { path: '/admin/auth', router: AdminAuthRoutes },
   { path: '/subscription', router: SubscriptionRoutes },
];

// map the endpoints to the router
endpoints.forEach((endpoint) => router.use(endpoint.path, endpoint.router));

export default router;
