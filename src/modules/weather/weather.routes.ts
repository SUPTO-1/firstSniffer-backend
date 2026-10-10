import { Router } from 'express';
import { authRequired } from '../../middleware/auth';
import { adminOnly } from '../../middleware/admin';
import { validate } from '../../middleware/validateRequest';
import * as controller from './weather.controller';
import {
  createWeatherSchema,
  listWeatherQuerySchema,
  updateWeatherSchema,
  weatherIdParamSchema,
} from './weather.validation';

const router = Router();
router.use(authRequired, adminOnly);
router.get('/', validate(listWeatherQuerySchema, 'query'), controller.listWeathers);
router.post('/', validate(createWeatherSchema), controller.createWeather);
router.get('/:id', validate(weatherIdParamSchema, 'params'), controller.getWeather);
router.put('/:id', validate(weatherIdParamSchema, 'params'), validate(updateWeatherSchema), controller.updateWeather);
router.delete('/:id', validate(weatherIdParamSchema, 'params'), controller.removeWeather);

export default router;
