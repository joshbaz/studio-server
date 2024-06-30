import { z } from 'zod';

export const filmSchema = z.object({
   title: z.string({ message: 'Film title is required' }),
   overview: z.string({ message: 'Film overview is required' }),
   plotSummary: z.string({ message: 'Film plot summary is required' }),
   releaseDate: z.string({ message: 'Film release date is required' }),
   type: z.string({ message: 'Film type is required' }).superRefine((data) => {
      const types = [
         'movie',
         'series',
         'documentary',
         'shortfilm',
         'animation',
      ];
      if (!types.includes(data)) {
         throw new Error('Film type is invalid');
      }
   }),
   adminId: z.string({ message: 'Admin ID is required' }),
});

export const filmSchemaUpdate = z.object({
   adminId: z.string({ message: 'Admin ID is required' }),
});
