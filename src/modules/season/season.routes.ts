import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { validate } from '../../middleware/validateRequest';
import * as controller from './season.controller';
import {
  createSeasonSchema,
  listSeasonQuerySchema,
  seasonIdParamSchema,
  updateSeasonSchema,
} from './season.validation';

const router = Router();
router.use(authRequired, adminOnly);
router.get('/', validate(listSeasonQuerySchema, 'query'), controller.listSeasons);
router.post('/', validate(createSeasonSchema), controller.createSeason);
router.get('/:id', validate(seasonIdParamSchema, 'params'), controller.getSeason);
router.put('/:id', validate(seasonIdParamSchema, 'params'), validate(updateSeasonSchema), controller.updateSeason);
router.delete('/:id', validate(seasonIdParamSchema, 'params'), controller.removeSeason);
export default router;
