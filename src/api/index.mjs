import express from 'express';
import v1 from './v1/index.mjs';

const router = new express.Router();

// You can create more version of the API
router.use('/v1', v1);
// router.use('/v2', v2);

export default router;
