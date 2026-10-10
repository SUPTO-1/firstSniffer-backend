import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { validate } from '../../middleware/validateRequest';
import * as controller from './genre.controller';
import {
  createGenreSchema,
  genreIdParamSchema,
  listGenreQuerySchema,
  updateGenreSchema,
} from './genre.validation';

const router = Router();
router.use(authRequired, adminOnly);

router.get('/', validate(listGenreQuerySchema, 'query'), controller.listGenres);
router.post('/', validate(createGenreSchema), controller.createGenre);
router.get('/:id', validate(genreIdParamSchema, 'params'), controller.getGenre);
router.put(
  '/:id',
  validate(genreIdParamSchema, 'params'),
  validate(updateGenreSchema),
  controller.updateGenre
);
router.delete(
  '/:id',
  validate(genreIdParamSchema, 'params'),
  controller.removeGenre
);

export default router;
