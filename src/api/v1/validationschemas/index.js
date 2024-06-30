import { z } from 'zod';

export const filmSchema = z.object({
   title: z.string({ message: 'Film title is required' }),
   overview: z.string({ message: 'Film overview is required' }),
   plotSummary: z.string({ message: 'Film plot summary is required' }),
   releaseDate: z.string({ message: 'Film release date is required' }),
   adminId: z.string({ message: 'Admin ID is required' }),
});
